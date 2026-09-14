-- ═══════════════════════════════════════════════════════════════════════════
-- API pública: Idempotency-Key (14/09/2026)
--
-- Um POST repetido com o mesmo cabeçalho Idempotency-Key (ex.: o seu sistema
-- caiu antes de ler a resposta e tentou de novo) devolve a MESMA resposta, sem
-- criar ou publicar duas vezes. Vale 24 horas, por time. Só o service_role lê.
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.api_idempotency (
  team_id      uuid not null references public.teams (id) on delete cascade,
  key          text not null,
  method       text not null,
  path         text not null,
  request_hash text not null,          -- sha256 de "MÉTODO caminho\ncorpo"
  status       int,                    -- null = ainda rodando
  response     jsonb,
  created_at   timestamptz not null default now(),
  primary key (team_id, key)
);
alter table public.api_idempotency enable row level security;
revoke all on public.api_idempotency from anon, authenticated;
comment on table public.api_idempotency is 'Respostas guardadas por Idempotency-Key (24 h). Só o service_role lê.';

-- Limpeza diária dos registros da API (inclui as chaves de idempotência).
select cron.unschedule(jobid) from cron.job where jobname = 'instaflow-api-limpeza';
select cron.schedule('instaflow-api-limpeza', '23 4 * * *', $cron$
  delete from public.api_requests where created_at < now() - interval '30 days';
  delete from public.webhook_deliveries where created_at < now() - interval '30 days';
  delete from public.api_key_rate where minute < now() - interval '10 minutes';
  delete from public.api_idempotency where created_at < now() - interval '24 hours';
$cron$);
