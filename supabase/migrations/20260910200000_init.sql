-- InstaFlow · esquema inicial
-- Um post agendado → publicado em N contas de Instagram via Post for Me.
-- Tudo em horário UTC no banco; o painel mostra em America/Bahia.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Quem pode entrar (lista de e-mails). Login é do Supabase Auth; aqui só a
-- permissão. O primeiro admin é inserido pelo script de deploy.
-- ---------------------------------------------------------------------------
create table public.allowed_users (
  email      text primary key,
  role       text not null default 'admin' check (role in ('admin', 'editor')),
  added_at   timestamptz not null default now()
);

create or replace function public.current_email()
returns text language sql stable as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''));
$$;

create or replace function public.is_member()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.allowed_users a where lower(a.email) = public.current_email()
  );
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.allowed_users a
    where lower(a.email) = public.current_email() and a.role = 'admin'
  );
$$;

-- ---------------------------------------------------------------------------
-- Contas de Instagram conectadas (espelho das "social accounts" do Post for Me)
-- ---------------------------------------------------------------------------
create table public.accounts (
  id                      text primary key,            -- id no Post for Me (spc_...)
  platform                text not null default 'instagram',
  username                text,
  user_id                 text,
  profile_photo_url       text,
  status                  text not null default 'connected' check (status in ('connected', 'disconnected')),
  external_id             text,
  access_token_expires_at timestamptz,
  metadata                jsonb,
  label                   text,                        -- apelido interno (ex.: "Loja Centro")
  archived                boolean not null default false,
  synced_at               timestamptz not null default now(),
  created_at              timestamptz not null default now()
);

create table public.account_groups (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  color      text,
  created_at timestamptz not null default now()
);

create table public.account_group_members (
  group_id   uuid not null references public.account_groups (id) on delete cascade,
  account_id text not null references public.accounts (id) on delete cascade,
  primary key (group_id, account_id)
);

-- ---------------------------------------------------------------------------
-- Biblioteca de mídia (arquivos já hospedados no Post for Me)
-- ---------------------------------------------------------------------------
create table public.media (
  id         uuid primary key default gen_random_uuid(),
  url        text not null,
  kind       text not null check (kind in ('image', 'video')),
  name       text,
  mime       text,
  size_bytes bigint,
  width      int,
  height     int,
  duration_s numeric,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index media_created_at_idx on public.media (created_at desc);

-- ---------------------------------------------------------------------------
-- Publicações. Uma linha = um agendamento "mãe"; post_targets = uma "filha"
-- por conta, cada uma com o próprio status.
-- ---------------------------------------------------------------------------
create table public.posts (
  id                uuid primary key default gen_random_uuid(),   -- vai como external_id no Post for Me
  pfm_post_id       text unique,
  title             text,
  caption           text not null,
  placement         text not null default 'timeline' check (placement in ('timeline', 'reels', 'stories')),
  media             jsonb not null default '[]'::jsonb,           -- [{url, kind, thumbnail_url}]
  options           jsonb not null default '{}'::jsonb,           -- share_to_feed, collaborators, ...
  caption_overrides jsonb not null default '{}'::jsonb,           -- {"spc_...": "legenda desta conta"}
  scheduled_at      timestamptz,                                  -- null = publicar agora
  status            text not null default 'scheduled'
                    check (status in ('draft', 'scheduled', 'processing', 'processed', 'canceled', 'error')),
  error             text,
  created_by        uuid references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index posts_scheduled_at_idx on public.posts (scheduled_at);
create index posts_status_idx on public.posts (status);

create table public.post_targets (
  post_id          uuid not null references public.posts (id) on delete cascade,
  account_id       text not null references public.accounts (id),
  status           text not null default 'pending' check (status in ('pending', 'published', 'failed')),
  result_id        text,
  permalink        text,
  platform_post_id text,
  error            text,
  details          jsonb,
  published_at     timestamptz,
  updated_at       timestamptz not null default now(),
  primary key (post_id, account_id)
);
create index post_targets_account_idx on public.post_targets (account_id, published_at desc);

-- ---------------------------------------------------------------------------
-- Só a camada do servidor (service role) lê estas duas.
-- ---------------------------------------------------------------------------
create table public.app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

create table public.webhook_events (
  id          bigserial primary key,
  event_type  text,
  payload     jsonb,
  received_at timestamptz not null default now(),
  processed   boolean not null default false,
  error       text
);

-- updated_at automático
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;
create trigger posts_touch before update on public.posts
  for each row execute function public.touch_updated_at();
create trigger post_targets_touch before update on public.post_targets
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: membros leem e escrevem; admins mexem na lista de e-mails;
-- app_settings e webhook_events ficam sem política (só service role).
-- ---------------------------------------------------------------------------
alter table public.allowed_users         enable row level security;
alter table public.accounts              enable row level security;
alter table public.account_groups        enable row level security;
alter table public.account_group_members enable row level security;
alter table public.media                 enable row level security;
alter table public.posts                 enable row level security;
alter table public.post_targets          enable row level security;
alter table public.app_settings          enable row level security;
alter table public.webhook_events        enable row level security;

create policy allowed_users_select on public.allowed_users for select to authenticated using (public.is_member());
create policy allowed_users_insert on public.allowed_users for insert to authenticated with check (public.is_admin());
create policy allowed_users_update on public.allowed_users for update to authenticated using (public.is_admin());
create policy allowed_users_delete on public.allowed_users for delete to authenticated
  using (public.is_admin() and lower(email) <> public.current_email());

create policy accounts_all on public.accounts for all to authenticated using (public.is_member()) with check (public.is_member());
create policy account_groups_all on public.account_groups for all to authenticated using (public.is_member()) with check (public.is_member());
create policy account_group_members_all on public.account_group_members for all to authenticated using (public.is_member()) with check (public.is_member());
create policy media_all on public.media for all to authenticated using (public.is_member()) with check (public.is_member());
create policy posts_all on public.posts for all to authenticated using (public.is_member()) with check (public.is_member());
create policy post_targets_all on public.post_targets for all to authenticated using (public.is_member()) with check (public.is_member());

-- ---------------------------------------------------------------------------
-- Visões de apoio para o painel
-- ---------------------------------------------------------------------------
create or replace view public.post_overview
with (security_invoker = true) as
select
  p.*,
  coalesce(t.total, 0)     as targets_total,
  coalesce(t.published, 0) as targets_published,
  coalesce(t.failed, 0)    as targets_failed,
  coalesce(t.pending, 0)   as targets_pending
from public.posts p
left join (
  select post_id,
         count(*)                                   as total,
         count(*) filter (where status = 'published') as published,
         count(*) filter (where status = 'failed')    as failed,
         count(*) filter (where status = 'pending')   as pending
  from public.post_targets group by post_id
) t on t.post_id = p.id;

-- Posts publicados por conta nas últimas 24 h (limite do Instagram: 100/24 h)
create or replace view public.account_usage_24h
with (security_invoker = true) as
select a.id as account_id,
       count(t.post_id) filter (where t.status = 'published' and t.published_at > now() - interval '24 hours') as published_24h
from public.accounts a
left join public.post_targets t on t.account_id = a.id
group by a.id;
