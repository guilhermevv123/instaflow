-- Contas sem limite por time: max_accounts nulo = sem limite. O que continua valendo é o
-- limite de publicações do mês (do time e do plano do Post for Me).
alter table public.teams alter column max_accounts drop not null;
alter table public.teams alter column max_accounts set default null;
update public.teams set max_accounts = null;
comment on column public.teams.max_accounts is 'Limite de contas do time; nulo = sem limite.';
