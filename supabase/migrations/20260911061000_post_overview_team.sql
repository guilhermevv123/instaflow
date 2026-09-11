-- post_overview passa a expor team_id: o "p.*" da visão ficou congelado com as
-- colunas de posts de antes do time existir (create or replace não acrescenta
-- coluna no meio, então é drop + create numa transação só).
drop view if exists public.post_overview;
create view public.post_overview
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
         count(*)                                     as total,
         count(*) filter (where status = 'published') as published,
         count(*) filter (where status = 'failed')    as failed,
         count(*) filter (where status = 'pending')   as pending
  from public.post_targets group by post_id
) t on t.post_id = p.id;

grant select on public.post_overview to anon, authenticated, service_role;
