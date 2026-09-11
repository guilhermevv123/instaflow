-- Painel (Início): números e séries dos gráficos de um time, calculados no
-- banco no fuso da Bahia. security invoker: o RLS do time continua valendo.
-- Uso: select public.dashboard('<time>', 30)  → jsonb
create or replace function public.dashboard(p_team uuid, p_days int default 30)
returns jsonb
language sql stable security invoker set search_path = public as $$
with
rng as (
  select today, days,
         today - (days - 1)     as d0,  -- começo do período
         today - (2 * days - 1) as p0,  -- começo do período anterior (comparação)
         date_trunc('month', today)::date as m0
  from (select (now() at time zone 'America/Bahia')::date as today,
               greatest(1, least(coalesce(p_days, 30), 180))::int as days) c
),
p as (
  select id, placement, status, scheduled_at,
         (coalesce(scheduled_at, created_at) at time zone 'America/Bahia') as at_local
  from posts
  where team_id = p_team and status <> 'canceled'
),
t as (
  select t.post_id, t.account_id, t.status, t.error, t.permalink, t.published_at, p.placement, p.at_local,
         (coalesce(t.published_at, t.updated_at) at time zone 'America/Bahia')::date as done_d,
         coalesce(a.platform, 'instagram') as platform
  from post_targets t
  join p on p.id = t.post_id
  left join accounts a on a.id = t.account_id
),
daily_done as (
  select done_d as d,
         count(*) filter (where status = 'published') as published,
         count(*) filter (where status = 'failed')    as failed
  from t group by done_d
),
daily_next as (
  select at_local::date as d, count(*) as scheduled from t where status = 'pending' group by 1
),
daily as (
  select coalesce(jsonb_agg(jsonb_build_object(
           'd', g.d, 'published', coalesce(dd.published, 0), 'failed', coalesce(dd.failed, 0), 'scheduled', coalesce(dn.scheduled, 0)
         ) order by g.d), '[]'::jsonb) as v
  from rng
  cross join lateral (select gs::date as d from generate_series(rng.d0, rng.today + 7, interval '1 day') gs) g
  left join daily_done dd on dd.d = g.d
  left join daily_next dn on dn.d = g.d
),
monthly as (
  select coalesce(jsonb_agg(jsonb_build_object(
           'm', to_char(g.m, 'YYYY-MM'),
           'published', (select count(*) from t where t.status = 'published' and date_trunc('month', t.done_d) = g.m),
           'failed',    (select count(*) from t where t.status = 'failed' and date_trunc('month', t.done_d) = g.m)
         ) order by g.m), '[]'::jsonb) as v
  from rng cross join lateral generate_series(rng.m0 - interval '5 months', rng.m0, interval '1 month') as g(m)
),
by_platform as (
  select coalesce(jsonb_agg(jsonb_build_object('k', k, 'n', n) order by n desc), '[]'::jsonb) as v
  from (select t.platform as k, count(*) as n from t, rng
        where t.status = 'published' and t.done_d between rng.d0 and rng.today group by 1) x
),
by_placement as (
  select coalesce(jsonb_agg(jsonb_build_object('k', k, 'n', n) order by n desc), '[]'::jsonb) as v
  from (select p.placement as k, count(*) as n from p, rng
        where p.at_local::date between rng.d0 and rng.today group by 1) x
),
failures as (
  select coalesce(jsonb_agg(jsonb_build_object('k', k, 'n', n) order by n desc), '[]'::jsonb) as v
  from (select left(coalesce(nullif(btrim(t.error), ''), 'Sem detalhe do erro'), 90) as k, count(*) as n
        from t, rng where t.status = 'failed' and t.done_d between rng.d0 and rng.today
        group by 1 order by 2 desc limit 8) x
),
heat as (
  select coalesce(jsonb_agg(jsonb_build_object('dow', dow, 'h', h, 'n', n)), '[]'::jsonb) as v
  from (select extract(isodow from p.at_local)::int as dow, extract(hour from p.at_local)::int as h, count(*) as n
        from p, rng where p.at_local::date between rng.today - 89 and rng.today + 7 group by 1, 2) x
),
accs as (
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', a.id, 'username', a.username, 'label', a.label, 'platform', a.platform, 'status', a.status,
           'published', c.published, 'failed', c.failed, 'last24', c.last24
         ) order by c.published desc, a.username), '[]'::jsonb) as v
  from accounts a
  cross join rng
  cross join lateral (
    select count(*) filter (where t.status = 'published' and t.done_d between rng.d0 and rng.today) as published,
           count(*) filter (where t.status = 'failed' and t.done_d between rng.d0 and rng.today)    as failed,
           count(*) filter (where t.status = 'published' and t.published_at > now() - interval '24 hours') as last24
    from t where t.account_id = a.id
  ) c
  where a.team_id = p_team and not a.archived
),
funnel as (
  select jsonb_build_object(
           'scheduled', count(*),
           'sent',      count(*) filter (where t.status <> 'pending'),
           'published', count(*) filter (where t.status = 'published'),
           'with_link', count(*) filter (where t.status = 'published' and t.permalink is not null)
         ) as v
  from t, rng where t.at_local::date >= rng.m0 and t.at_local::date < (rng.m0 + interval '1 month')::date
),
kpis as (
  select jsonb_build_object(
    'today_posts',    (select count(*) from p, rng where p.scheduled_at is not null and p.at_local::date = rng.today),
    'today_targets',  (select count(*) from t, rng where t.at_local::date = rng.today),
    'next7_posts',    (select count(*) from p, rng where p.status in ('scheduled', 'draft') and p.at_local::date between rng.today and rng.today + 7),
    'next_at',        (select min(scheduled_at) from p where p.status = 'scheduled' and p.scheduled_at > now()),
    'published',      (select count(*) from t, rng where t.status = 'published' and t.done_d between rng.d0 and rng.today),
    'failed',         (select count(*) from t, rng where t.status = 'failed' and t.done_d between rng.d0 and rng.today),
    'prev_published', (select count(*) from t, rng where t.status = 'published' and t.done_d between rng.p0 and rng.d0 - 1),
    'failed_7d',      (select count(*) from t, rng where t.status = 'failed' and t.done_d > rng.today - 7),
    'accounts',       (select count(*) from accounts where team_id = p_team and not archived),
    'accounts_connected', (select count(*) from accounts where team_id = p_team and not archived and status = 'connected'),
    'month_used',     public.team_month_usage(p_team),
    'month_limit',    (select max_posts_month from teams where id = p_team)
  ) as v
)
select jsonb_build_object(
  'days', rng.days, 'today', rng.today,
  'kpis', (select v from kpis), 'daily', (select v from daily), 'monthly', (select v from monthly),
  'by_platform', (select v from by_platform), 'by_placement', (select v from by_placement),
  'failures', (select v from failures), 'heat', (select v from heat),
  'accounts', (select v from accs), 'funnel', (select v from funnel)
)
from rng
-- só quem é do time (ou o próprio servidor) recebe os números
where p_team in (select public.my_team_ids()) or coalesce(auth.role(), '') = 'service_role'
$$;

revoke all on function public.dashboard(uuid, int) from public, anon;
grant execute on function public.dashboard(uuid, int) to authenticated, service_role;
