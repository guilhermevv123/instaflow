-- Upgrade do plano do Post for Me: Pro 2.5K (2.500 publicações/mês, US$ 25) →
-- 5K (5.000 publicações/mês, US$ 50). Mesma lógica de 20260922120000_plan_2500.sql:
-- cada time pode usar o plano inteiro; quem barra de verdade é o total somado de
-- todos os times (app_settings.plan). Time com limite próprio (≠ 2500) não muda.
alter table public.teams alter column max_posts_month set default 5000;
update public.teams set max_posts_month = 5000 where max_posts_month = 2500;

update public.app_settings set value = '{"posts_month": 5000}'
  where key = 'plan' and value = '{"posts_month": 2500}';
