-- ═══════════════════════════════════════════════════════════════════════════
-- Desempenho das contas (11/09/2026)
--
-- Seguidores, visualizações, curtidas, comentários, compartilhamentos e
-- salvamentos de cada conta e de cada post, para a página Desempenho e o Início.
-- De onde vem (com a chave que o Post for Me guarda de cada conta):
--   - seguidores/seguindo/posts da conta e curtidas/comentários de cada post:
--     Graph API do Instagram — funciona com a permissão básica de hoje;
--   - visualizações, alcance, compartilhamentos, salvos, novos seguidores e
--     tempo assistido: feed do Post for Me com expand=metrics — só vem com a
--     conta conectada com a permissão "feeds" (o painel pede desde 11/09).
-- A função `api` (rota /metrics/cron) atualiza tudo a cada 3 horas pelo
-- pg_cron. URL, chave pública e segredo da chamada ficam em
-- app_settings('metrics_cron'), fora deste arquivo (o repositório é público).
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

alter table public.accounts
  add column if not exists followers       int,
  add column if not exists follows         int,
  add column if not exists media_count     int,
  add column if not exists insights_ok     boolean,      -- null = ainda sem post para medir
  add column if not exists stats_synced_at timestamptz;

-- Um retrato por dia (Bahia) de cada conta → seguidores ganhos por dia.
create table if not exists public.account_stats_daily (
  account_id  text not null references public.accounts (id) on delete cascade,
  day         date not null,
  team_id     uuid not null references public.teams (id) on delete cascade,
  followers   int,
  follows     int,
  media_count int,
  captured_at timestamptz not null default now(),
  primary key (account_id, day)
);
create index if not exists account_stats_daily_team_day_idx on public.account_stats_daily (team_id, day);

-- Último valor de cada post das contas (publicado pelo InstaFlow ou não).
create table if not exists public.post_metrics (
  platform_post_id   text primary key,
  account_id         text not null references public.accounts (id) on delete cascade,
  team_id            uuid not null references public.teams (id) on delete cascade,
  post_id            uuid references public.posts (id) on delete set null,
  social_post_id     text,
  platform           text not null,
  product_type       text,
  media_type         text,
  permalink          text,
  caption            text,
  thumbnail_url      text,
  posted_at          timestamptz,
  views              int,
  reach              int,
  likes              int,
  comments           int,
  shares             int,
  saved              int,
  follows            int,
  profile_visits     int,
  total_interactions int,
  avg_watch_ms       int,
  total_watch_ms     bigint,
  nivel              text not null default 'basico' check (nivel in ('completo', 'basico')), -- completo = veio visualização/alcance
  raw                jsonb not null default '{}'::jsonb,
  updated_at         timestamptz not null default now()
);
create index if not exists post_metrics_team_posted_idx on public.post_metrics (team_id, posted_at desc);
create index if not exists post_metrics_account_posted_idx on public.post_metrics (account_id, posted_at desc);

-- Curva de cada post: o valor do fim de cada dia (Bahia).
create table if not exists public.post_metrics_daily (
  platform_post_id   text not null references public.post_metrics (platform_post_id) on delete cascade,
  day                date not null,
  team_id            uuid not null references public.teams (id) on delete cascade,
  account_id         text not null,
  views              int,
  reach              int,
  likes              int,
  comments           int,
  shares             int,
  saved              int,
  total_interactions int,
  primary key (platform_post_id, day)
);
create index if not exists post_metrics_daily_team_day_idx on public.post_metrics_daily (team_id, day);

-- Leitura por time; escrita só pela função (service role).
alter table public.account_stats_daily enable row level security;
alter table public.post_metrics        enable row level security;
alter table public.post_metrics_daily  enable row level security;
drop policy if exists account_stats_daily_team on public.account_stats_daily;
drop policy if exists post_metrics_team on public.post_metrics;
drop policy if exists post_metrics_daily_team on public.post_metrics_daily;
create policy account_stats_daily_team on public.account_stats_daily for select to authenticated using (team_id in (select public.my_team_ids()));
create policy post_metrics_team        on public.post_metrics        for select to authenticated using (team_id in (select public.my_team_ids()));
create policy post_metrics_daily_team  on public.post_metrics_daily  for select to authenticated using (team_id in (select public.my_team_ids()));

-- Atualização automática a cada 3 horas (minuto 7). Sem app_settings('metrics_cron'), não chama nada.
select cron.unschedule(jobid) from cron.job where jobname = 'instaflow-metricas';
select cron.schedule('instaflow-metricas', '7 */3 * * *', $cron$
  select net.http_post(
    url := (select value->>'url' from public.app_settings where key = 'metrics_cron'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (select value->>'apikey' from public.app_settings where key = 'metrics_cron'),
      'x-cron-secret', (select value->>'secret' from public.app_settings where key = 'metrics_cron')),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000)
  where exists (select 1 from public.app_settings where key = 'metrics_cron');
$cron$);
