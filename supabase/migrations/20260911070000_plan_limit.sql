-- O limite que vale é o do plano do Post for Me: 1.000 publicações por mês
-- (conta a conta), somando todos os times. Cada time pode usar o plano inteiro;
-- a API barra quando o total dos times chegaria no limite do plano.
alter table public.teams alter column max_posts_month set default 1000;
update public.teams set max_posts_month = 1000 where max_posts_month = 300;

insert into public.app_settings (key, value) values ('plan', '{"posts_month": 1000}')
  on conflict (key) do nothing;

-- Uso do mês somando todos os times (mesma regra de team_month_usage). Só o servidor chama.
create or replace function public.plan_month_usage()
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int
  from public.post_targets t
  join public.posts p on p.id = t.post_id
  where p.status <> 'canceled'
    and t.status <> 'failed'
    and coalesce(t.published_at, p.scheduled_at, p.created_at) >= date_trunc('month', now())
$$;
revoke all on function public.plan_month_usage() from public, anon, authenticated;
grant execute on function public.plan_month_usage() to service_role;
