-- Upgrade do plano do Post for Me: Pro 1K (1.000 publicações/mês, US$ 10) →
-- Pro 2.5K (2.500 publicações/mês, US$ 25). Mesma lógica da migration anterior
-- (20260911070000_plan_limit.sql): cada time pode usar o plano inteiro; quem
-- barra de verdade é o total somado de todos os times (app_settings.plan).
alter table public.teams alter column max_posts_month set default 2500;
update public.teams set max_posts_month = 2500 where max_posts_month = 1000;

update public.app_settings set value = '{"posts_month": 2500}'
  where key = 'plan' and value = '{"posts_month": 1000}';
