-- ═══════════════════════════════════════════════════════════════════════════
-- API pública (14/09/2026)
--
-- Cada time gera chaves de acesso (ifk_…) na tela Config e usa a mesma função
-- `api` que o painel usa, com `Authorization: Bearer ifk_…`. A chave inteira
-- nunca é guardada: só o SHA-256 dela e um prefixo para identificar.
--   api_keys            chaves do time (escopo, restrição por contas, limite por minuto)
--   api_key_rate        contagem por minuto (limite de uso)
--   api_requests        registro de cada chamada (30 dias)
--   team_webhooks       avisos que o time quer receber (post publicado/falhou…)
--   webhook_deliveries  cada entrega tentada (30 dias)
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.api_keys (
  id             uuid primary key default gen_random_uuid(),
  team_id        uuid not null references public.teams (id) on delete cascade,
  name           text not null,
  prefix         text not null,                       -- ex.: ifk_a1B2c3D4 (só para identificar)
  key_hash       text not null unique,                -- sha256 hex da chave inteira
  scopes         text[] not null default '{}',        -- vazio = tudo; {'read'} = só leitura
  account_ids    text[],                              -- null = todas as contas do time
  rate_limit     int  not null default 120,           -- chamadas por minuto
  created_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  last_used_at   timestamptz,
  revoked_at     timestamptz,
  requests_total bigint not null default 0
);
create index if not exists api_keys_team_idx on public.api_keys (team_id, created_at desc);
alter table public.api_keys enable row level security;
revoke all on public.api_keys from anon, authenticated;
-- quem é do time vê as chaves (nunca o hash); criar e revogar passa pela função `api`
grant select (id, team_id, name, prefix, scopes, account_ids, rate_limit, created_by, created_at, last_used_at, revoked_at, requests_total)
  on public.api_keys to authenticated;
drop policy if exists api_keys_team on public.api_keys;
create policy api_keys_team on public.api_keys for select to authenticated using (team_id in (select public.my_team_ids()));
comment on table public.api_keys is 'Chaves da API pública, por time. Guarda só o hash da chave.';

create table if not exists public.api_key_rate (
  key_id uuid not null references public.api_keys (id) on delete cascade,
  minute timestamptz not null,
  count  int not null default 0,
  primary key (key_id, minute)
);
alter table public.api_key_rate enable row level security;
revoke all on public.api_key_rate from anon, authenticated;

create table if not exists public.api_requests (
  id         bigint generated always as identity primary key,
  key_id     uuid references public.api_keys (id) on delete cascade,
  team_id    uuid not null references public.teams (id) on delete cascade,
  method     text not null,
  path       text not null,
  status     int  not null,
  ms         int,
  ip         text,
  created_at timestamptz not null default now()
);
create index if not exists api_requests_key_idx  on public.api_requests (key_id, created_at desc);
create index if not exists api_requests_team_idx on public.api_requests (team_id, created_at desc);
alter table public.api_requests enable row level security;
revoke all on public.api_requests from anon, authenticated;
grant select on public.api_requests to authenticated;
drop policy if exists api_requests_team on public.api_requests;
create policy api_requests_team on public.api_requests for select to authenticated using (team_id in (select public.my_team_ids()));

-- Uma chamada com chave: confere a chave, conta no minuto e devolve o time.
-- Só a função `api` (service_role) chama.
create or replace function public.api_key_hit(p_hash text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  k record;
  c int;
  m timestamptz := date_trunc('minute', now());
begin
  select id, team_id, name, prefix, scopes, account_ids, rate_limit, revoked_at into k from public.api_keys where key_hash = p_hash;
  if not found then return null; end if;
  if k.revoked_at is not null then return jsonb_build_object('revoked', true, 'id', k.id); end if;
  insert into public.api_key_rate (key_id, minute, count) values (k.id, m, 1)
    on conflict (key_id, minute) do update set count = api_key_rate.count + 1
    returning count into c;
  update public.api_keys set last_used_at = now(), requests_total = requests_total + 1 where id = k.id;
  if random() < 0.05 then delete from public.api_key_rate where minute < m - interval '5 minutes'; end if;
  return jsonb_build_object(
    'id', k.id, 'team_id', k.team_id, 'name', k.name, 'prefix', k.prefix, 'scopes', to_jsonb(k.scopes),
    'account_ids', to_jsonb(k.account_ids), 'rate_limit', k.rate_limit, 'count', c, 'reset', m + interval '1 minute');
end $$;
revoke all on function public.api_key_hit(text) from public, anon, authenticated;
grant execute on function public.api_key_hit(text) to service_role;

-- Avisos para o desenvolvedor (webhooks de saída).
create table if not exists public.team_webhooks (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams (id) on delete cascade,
  url         text not null,
  secret      text not null,                          -- whsec_…, assina cada entrega (HMAC-SHA256)
  events      text[] not null default '{}',           -- vazio = todos
  active      boolean not null default true,
  description text,
  failures    int not null default 0,                 -- seguidas; 50 desliga
  last_status int,
  last_error  text,
  last_at     timestamptz,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists team_webhooks_team_idx on public.team_webhooks (team_id);
alter table public.team_webhooks enable row level security;
revoke all on public.team_webhooks from anon, authenticated;
grant select (id, team_id, url, events, active, description, failures, last_status, last_error, last_at, created_at) on public.team_webhooks to authenticated;
drop policy if exists team_webhooks_team on public.team_webhooks;
create policy team_webhooks_team on public.team_webhooks for select to authenticated using (team_id in (select public.my_team_ids()));

create table if not exists public.webhook_deliveries (
  id         bigint generated always as identity primary key,
  webhook_id uuid not null references public.team_webhooks (id) on delete cascade,
  team_id    uuid not null references public.teams (id) on delete cascade,
  event_id   text not null,
  event      text not null,
  attempt    int  not null default 1,
  status     int,
  ms         int,
  error      text,
  created_at timestamptz not null default now()
);
create index if not exists webhook_deliveries_hook_idx on public.webhook_deliveries (webhook_id, created_at desc);
alter table public.webhook_deliveries enable row level security;
revoke all on public.webhook_deliveries from anon, authenticated;
grant select on public.webhook_deliveries to authenticated;
drop policy if exists webhook_deliveries_team on public.webhook_deliveries;
create policy webhook_deliveries_team on public.webhook_deliveries for select to authenticated using (team_id in (select public.my_team_ids()));

-- "post.completed" sai uma vez só, mesmo que o resultado chegue por dois caminhos.
alter table public.posts add column if not exists completed_at timestamptz;

-- Limpeza diária dos registros (30 dias).
select cron.unschedule(jobid) from cron.job where jobname = 'instaflow-api-limpeza';
select cron.schedule('instaflow-api-limpeza', '23 4 * * *', $cron$
  delete from public.api_requests where created_at < now() - interval '30 days';
  delete from public.webhook_deliveries where created_at < now() - interval '30 days';
  delete from public.api_key_rate where minute < now() - interval '10 minutes';
$cron$);
