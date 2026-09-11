-- ═══════════════════════════════════════════════════════════════════════════
-- IA das variações de legenda (11/09/2026)
--
-- O botão "✨ Criar variações" do Criar faz uma legenda diferente para cada
-- conta. Sem IA ele usa o gerador automático do navegador; com IA, cada time
-- liga a sua na tela Config: o dono ou um admin cola a chave (Google Gemini
-- tem plano grátis; também aceita Groq, OpenAI, Anthropic e OpenRouter).
--
-- A chave fica em `team_ai_keys` e SÓ o service_role (a função `api`) lê:
-- a tabela não tem policy nenhuma, então o navegador não enxerga a chave.
-- `ai_calls` registra cada geração para o limite diário por time.
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.team_ai_keys (
  team_id    uuid primary key references public.teams (id) on delete cascade,
  provider   text not null check (provider in ('gemini', 'groq', 'openrouter', 'anthropic', 'openai')),
  api_key    text not null,
  model      text,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.team_ai_keys enable row level security;
revoke all on public.team_ai_keys from anon, authenticated;
comment on table public.team_ai_keys is 'Chave de IA de cada time (variações de legenda). Sem policy: só o service_role lê.';

create table if not exists public.ai_calls (
  id         bigint generated always as identity primary key,
  team_id    uuid not null references public.teams (id) on delete cascade,
  user_id    uuid references auth.users (id) on delete set null,
  kind       text not null default 'variacoes',
  provider   text,
  model      text,
  requested  int not null default 0,
  returned   int not null default 0,
  ok         boolean not null default true,
  error      text,
  created_at timestamptz not null default now()
);
create index if not exists ai_calls_team_created_idx on public.ai_calls (team_id, created_at desc);
alter table public.ai_calls enable row level security;
revoke all on public.ai_calls from anon, authenticated;
comment on table public.ai_calls is 'Cada geração de variações com IA (limite diário por time). Só o service_role lê.';
