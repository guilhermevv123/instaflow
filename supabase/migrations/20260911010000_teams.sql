-- InstaFlow · times (multi-tenant)
-- Cada pessoa que se cadastra ganha o próprio time; convites juntam pessoas a um
-- time existente. Contas, grupos, mídia e publicações passam a pertencer a um time,
-- e o RLS só mostra o que é dos times de quem está logado.

-- ---------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------
create table public.teams (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  owner_id        uuid references auth.users (id) on delete set null,
  max_accounts    int  not null default 20,   -- contas de Instagram por time
  max_posts_month int  not null default 300,  -- publicações (conta a conta) por mês
  created_at      timestamptz not null default now()
);

create table public.team_members (
  team_id   uuid not null references public.teams (id) on delete cascade,
  user_id   uuid not null references auth.users (id) on delete cascade,
  email     text not null,
  role      text not null default 'admin' check (role in ('owner', 'admin', 'editor')),
  joined_at timestamptz not null default now(),
  primary key (team_id, user_id)
);
create index team_members_user_idx on public.team_members (user_id);

create table public.team_invites (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams (id) on delete cascade,
  email       text not null,
  role        text not null default 'editor' check (role in ('admin', 'editor')),
  invited_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  accepted_at timestamptz
);
create unique index team_invites_pending_idx on public.team_invites (team_id, lower(email)) where accepted_at is null;

alter table public.accounts       add column team_id uuid references public.teams (id) on delete cascade;
alter table public.account_groups add column team_id uuid references public.teams (id) on delete cascade;
alter table public.media          add column team_id uuid references public.teams (id) on delete cascade;
alter table public.posts          add column team_id uuid references public.teams (id) on delete cascade;
create index accounts_team_idx       on public.accounts (team_id);
create index account_groups_team_idx on public.account_groups (team_id);
create index media_team_idx          on public.media (team_id, created_at desc);
create index posts_team_idx          on public.posts (team_id, scheduled_at);

-- ---------------------------------------------------------------------------
-- Funções de apoio (security definer: leem team_members sem passar pelo RLS)
-- ---------------------------------------------------------------------------
create or replace function public.my_team_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select team_id from public.team_members where user_id = auth.uid()
$$;

create or replace function public.is_team_admin(t uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.team_members
    where team_id = t and user_id = auth.uid() and role in ('owner', 'admin')
  )
$$;

-- Publicações do mês (conta a conta) de um time: publicadas + aguardando.
create or replace function public.team_month_usage(p_team uuid)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int
  from public.post_targets t
  join public.posts p on p.id = t.post_id
  where p.team_id = p_team
    and p.status <> 'canceled'
    and t.status <> 'failed'
    and coalesce(t.published_at, p.scheduled_at, p.created_at) >= date_trunc('month', now())
$$;

-- Novo usuário: entra nos times que o convidaram ou ganha um time só dele.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  inv record;
  n   int := 0;
  tid uuid;
begin
  for inv in
    select id, team_id, role from public.team_invites
    where lower(email) = lower(new.email) and accepted_at is null
  loop
    insert into public.team_members (team_id, user_id, email, role)
      values (inv.team_id, new.id, lower(new.email), inv.role)
      on conflict do nothing;
    update public.team_invites set accepted_at = now() where id = inv.id;
    n := n + 1;
  end loop;
  if n = 0 then
    insert into public.teams (name, owner_id)
      values ('Time de ' || split_part(new.email, '@', 1), new.id)
      returning id into tid;
    insert into public.team_members (team_id, user_id, email, role)
      values (tid, new.id, lower(new.email), 'owner');
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Convidar por e-mail: quem já tem conta entra na hora; quem não tem entra ao cadastrar.
create or replace function public.team_invite(p_team uuid, p_email text, p_role text default 'editor')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  e   text := lower(trim(p_email));
  uid uuid;
begin
  if not public.is_team_admin(p_team) then raise exception 'Só administradores do time convidam pessoas.'; end if;
  if p_role not in ('admin', 'editor') then raise exception 'Papel inválido.'; end if;
  if e !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'E-mail inválido.'; end if;
  select id into uid from auth.users where lower(email) = e limit 1;
  if uid is not null then
    insert into public.team_members (team_id, user_id, email, role) values (p_team, uid, e, p_role)
      on conflict (team_id, user_id) do update set role = excluded.role
      where public.team_members.role <> 'owner';
    return jsonb_build_object('status', 'member', 'email', e);
  end if;
  insert into public.team_invites (team_id, email, role, invited_by) values (p_team, e, p_role, auth.uid())
    on conflict (team_id, lower(email)) where accepted_at is null do update set role = excluded.role;
  return jsonb_build_object('status', 'invited', 'email', e);
end $$;

create or replace function public.team_remove_member(p_team uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_user <> auth.uid() and not public.is_team_admin(p_team) then
    raise exception 'Só administradores do time removem pessoas.';
  end if;
  if exists (select 1 from public.team_members where team_id = p_team and user_id = p_user and role = 'owner') then
    raise exception 'O dono do time não pode ser removido.';
  end if;
  delete from public.team_members where team_id = p_team and user_id = p_user;
end $$;

create or replace function public.team_cancel_invite(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare t uuid;
begin
  select team_id into t from public.team_invites where id = p_id;
  if t is null then return; end if;
  if not public.is_team_admin(t) then raise exception 'Só administradores do time cancelam convites.'; end if;
  delete from public.team_invites where id = p_id;
end $$;

create or replace function public.team_rename(p_team uuid, p_name text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_team_admin(p_team) then raise exception 'Só administradores do time mudam o nome.'; end if;
  if length(trim(p_name)) < 2 then raise exception 'Nome muito curto.'; end if;
  update public.teams set name = left(trim(p_name), 60) where id = p_team;
end $$;

-- ---------------------------------------------------------------------------
-- Dados existentes: cada usuário sem time ganha um; o que já existia vai para
-- o time de quem entrou primeiro (quem conectou as contas).
-- ---------------------------------------------------------------------------
do $$
declare u record; tid uuid; first_team uuid;
begin
  for u in select id, email, created_at from auth.users order by created_at loop
    if not exists (select 1 from public.team_members where user_id = u.id) then
      insert into public.teams (name, owner_id) values ('Time de ' || split_part(u.email, '@', 1), u.id) returning id into tid;
      insert into public.team_members (team_id, user_id, email, role) values (tid, u.id, lower(u.email), 'owner');
    end if;
  end loop;
  select tm.team_id into first_team
    from public.team_members tm join auth.users au on au.id = tm.user_id
    where tm.role = 'owner' order by au.created_at limit 1;
  if first_team is not null then
    update public.accounts       set team_id = first_team where team_id is null;
    update public.account_groups set team_id = first_team where team_id is null;
    update public.media          set team_id = first_team where team_id is null;
    update public.posts          set team_id = first_team where team_id is null;
  end if;
end $$;

alter table public.account_groups alter column team_id set not null;
alter table public.media          alter column team_id set not null;
alter table public.posts          alter column team_id set not null;
-- accounts.team_id fica opcional: uma conta que chega pelo webhook sem time
-- reconhecido fica invisível até alguém sincronizar.

-- ---------------------------------------------------------------------------
-- RLS por time
-- ---------------------------------------------------------------------------
alter table public.teams        enable row level security;
alter table public.team_members enable row level security;
alter table public.team_invites enable row level security;

create policy teams_select on public.teams for select to authenticated
  using (id in (select public.my_team_ids()));
create policy team_members_select on public.team_members for select to authenticated
  using (team_id in (select public.my_team_ids()));
create policy team_invites_select on public.team_invites for select to authenticated
  using (public.is_team_admin(team_id));

drop policy if exists accounts_all on public.accounts;
drop policy if exists account_groups_all on public.account_groups;
drop policy if exists account_group_members_all on public.account_group_members;
drop policy if exists media_all on public.media;
drop policy if exists posts_all on public.posts;
drop policy if exists post_targets_all on public.post_targets;

create policy accounts_team on public.accounts for all to authenticated
  using (team_id in (select public.my_team_ids())) with check (team_id in (select public.my_team_ids()));
create policy account_groups_team on public.account_groups for all to authenticated
  using (team_id in (select public.my_team_ids())) with check (team_id in (select public.my_team_ids()));
create policy account_group_members_team on public.account_group_members for all to authenticated
  using (exists (select 1 from public.account_groups g where g.id = group_id and g.team_id in (select public.my_team_ids())))
  with check (exists (select 1 from public.account_groups g where g.id = group_id and g.team_id in (select public.my_team_ids())));
create policy media_team on public.media for all to authenticated
  using (team_id in (select public.my_team_ids())) with check (team_id in (select public.my_team_ids()));
create policy posts_team on public.posts for all to authenticated
  using (team_id in (select public.my_team_ids())) with check (team_id in (select public.my_team_ids()));
create policy post_targets_team on public.post_targets for all to authenticated
  using (exists (select 1 from public.posts p where p.id = post_id and p.team_id in (select public.my_team_ids())))
  with check (exists (select 1 from public.posts p where p.id = post_id and p.team_id in (select public.my_team_ids())));

-- Lista de e-mails antiga sai de cena.
drop table if exists public.allowed_users cascade;
drop function if exists public.is_member();
drop function if exists public.is_admin();
drop function if exists public.current_email();

-- A visão de uso por conta passa a expor o time (o RLS de accounts já filtra).
drop view if exists public.account_usage_24h;
create view public.account_usage_24h
with (security_invoker = true) as
select a.id as account_id,
       a.team_id,
       count(t.post_id) filter (where t.status = 'published' and t.published_at > now() - interval '24 hours') as published_24h
from public.accounts a
left join public.post_targets t on t.account_id = a.id
group by a.id, a.team_id;
