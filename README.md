# InstaFlow

Um post agendado → publicado em várias contas de Instagram na hora marcada.
Painel estático (GitHub Pages) + Supabase (banco, login e duas funções) + [Post for Me](https://www.postforme.dev) (API que conecta as contas, hospeda a mídia, agenda e publica pela API oficial do Instagram).

```
docs/                  painel (HTML/CSS/JS, sem build)
  entrar/              login, primeiro acesso, redefinir senha
  index.html           Início
  calendario/ criar/ contas/ fila/ biblioteca/ config/
  assets/app.js        sessão, chamada à função api, datas (America/Bahia), UI
  assets/media.js      upload e regras de mídia do Instagram
  assets/config.js     URL e chave pública do Supabase (gerado)
supabase/
  migrations/          esquema + RLS + views
  functions/api        camada do meio: guarda a chave, valida o usuário, espelha no banco
  functions/pfm-webhook  recebe "publicou/falhou" do Post for Me
scripts/setup.sh       liga tudo (link, db push, secrets, deploy, admin, config)
scripts/publish-site.sh  cria o repo público e ativa o GitHub Pages
```

## Como funciona

1. **Contas** → "Conectar Instagram" abre a autorização oficial do Instagram (via app do Post for Me). A conta precisa ser Profissional. Nenhuma senha é guardada.
2. **Criar** → tipo (Feed, Reels, Stories), mídia (sobe direto para o Post for Me), legenda (com variação por conta), contas/grupos, data e hora (Bahia).
3. A função `api` cria **1 post no Post for Me com N contas** e grava `posts` + `post_targets` (uma linha por conta).
4. No horário, o Post for Me publica (checa a cada 2 min) e chama `pfm-webhook` com o resultado de cada conta. A **Fila** mostra publicado/falhou/link do post; "Atualizar status" confere direto na API se algum aviso se perder.
5. Falhou em 2 de 20? "Reenviar agora para as que falharam" cria um reenvio só para elas.

Limites: Instagram aceita 100 posts por conta a cada 24 h via API; o plano do Post for Me (US$ 10) cobre 1.000 publicações/mês contadas **por conta** (20 contas × 1 post/dia ≈ 600).

## Ligar pela primeira vez

```bash
# 0. chave do Post for Me (Dashboard → API Keys) em arquivo privado
mkdir -p ~/.config/instaflow && printf 'POSTFORME_API_KEY=pfm_live_...\n' > ~/.config/instaflow/postforme.env && chmod 600 ~/.config/instaflow/postforme.env

# 1. projeto novo no Supabase (região sa-east-1) → anote o ref e a senha do banco
# 2. tudo de uma vez
scripts/setup.sh <PROJECT_REF> <seu@email> https://<usuario>.github.io

# 3. site no ar
scripts/publish-site.sh instaflow
supabase secrets set INSTAFLOW_ALLOWED_ORIGINS=https://<usuario>.github.io

# 4. no painel do Post for Me → projeto → Auth callback URL:
#    https://<usuario>.github.io/instaflow/contas/
```

Depois: entre com o e-mail admin ("Primeiro acesso" cria a senha; se o e-mail já existir no Auth do projeto, use a senha que já tem ou "Esqueci a senha"), vá em **Config** → "Testar conexão" e "Registrar avisos", e em **Contas** → "Conectar Instagram".

## Onde está ligado hoje (10/09/2026)

- **Supabase:** projeto `zxaiearxsuulhkfyybke` (us-east-2), o mesmo do app Meu Auxiliar. As tabelas do InstaFlow convivem em `public` sem colisão de nomes; secrets com prefixo (`INSTAFLOW_ALLOWED_ORIGINS`, `POSTFORME_API_KEY`).
- Esse projeto está em outra conta, então o `supabase link` não funciona por aqui. Deploy sem link:
  ```bash
  set -a; . ~/.config/instaflow/supabase.env; set +a   # SUPABASE_ACCESS_TOKEN e SUPABASE_PROJECT_REF
  supabase functions deploy api --project-ref $SUPABASE_PROJECT_REF --no-verify-jwt --use-api
  supabase functions deploy pfm-webhook --project-ref $SUPABASE_PROJECT_REF --no-verify-jwt --use-api
  ```
  SQL: Management API `POST /v1/projects/<ref>/database/query` (ver histórico em `supabase_migrations.schema_migrations`).
- **Site:** https://guilhermevv123.github.io/instaflow/ (repo público `guilhermevv123/instaflow`, Pages em `/docs`).
- **Post for Me:** webhook `wbh_12qyxP1lGGAuLCWogv0I` → `…/functions/v1/pfm-webhook` (segredo em `app_settings.pfm_webhook`). Auth callback URL do projeto deve ser `https://guilhermevv123.github.io/instaflow/contas/`.
- **Auth:** cadastro auto-confirmado; `uri_allow_list` inclui `https://guilhermevv123.github.io/instaflow/**`.

## Segurança

- A chave do Post for Me só existe nos secrets do Supabase; o navegador nunca a vê.
- Toda tabela tem RLS: só e-mails em `allowed_users` leem/escrevem; `app_settings` e `webhook_events` só a service role.
- O webhook confere o segredo do Post for Me (cabeçalho `Post-For-Me-Webhook-Secret`) antes de aceitar.
- Nunca rode `supabase config push` neste projeto (sobrescreve o Auth do painel).

## Manutenção

- Nova migration: `supabase migration new nome` → editar → `supabase db push`.
- Funções: `supabase functions deploy api --no-verify-jwt` (idem `pfm-webhook`). Checagem local: `cd supabase/functions && deno check api/index.ts pfm-webhook/index.ts`.
- Site: editar `docs/` e `git push` (Pages publica sozinho).
