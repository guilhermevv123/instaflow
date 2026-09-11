# InstaFlow

Um post agendado → publicado em várias contas de Instagram na hora marcada.
Painel estático (GitHub Pages) + Supabase (banco, login e duas funções) + [Post for Me](https://www.postforme.dev) (API que conecta as contas, hospeda a mídia, agenda e publica pela API oficial do Instagram).

```
site/                  painel (HTML/CSS/JS, sem build)
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
supabase secrets set ALLOWED_ORIGINS=https://<usuario>.github.io

# 4. no painel do Post for Me → projeto → Auth callback URL:
#    https://<usuario>.github.io/instaflow/contas/
```

Depois: entre com o e-mail admin ("Primeiro acesso" cria a senha), vá em **Config** → "Testar conexão" e "Registrar avisos", e em **Contas** → "Conectar Instagram".

## Segurança

- A chave do Post for Me só existe nos secrets do Supabase; o navegador nunca a vê.
- Toda tabela tem RLS: só e-mails em `allowed_users` leem/escrevem; `app_settings` e `webhook_events` só a service role.
- O webhook confere o segredo do Post for Me (cabeçalho `Post-For-Me-Webhook-Secret`) antes de aceitar.
- Nunca rode `supabase config push` neste projeto (sobrescreve o Auth do painel).

## Manutenção

- Nova migration: `supabase migration new nome` → editar → `supabase db push`.
- Funções: `supabase functions deploy api --no-verify-jwt` (idem `pfm-webhook`). Checagem local: `cd supabase/functions && deno check api/index.ts pfm-webhook/index.ts`.
- Site: editar `site/` e `git push` (Pages publica sozinho).
