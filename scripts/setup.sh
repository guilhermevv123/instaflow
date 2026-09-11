#!/usr/bin/env bash
# InstaFlow · liga o projeto ao Supabase e ao Post for Me.
#
# Uso:
#   scripts/setup.sh <PROJECT_REF> <EMAIL_DO_ADMIN> [URL_DO_SITE]
#
# Exemplo:
#   scripts/setup.sh abcdefghijklmnop guilhermevvui765@gmail.com https://guilhermevv123.github.io
#
# Pré-requisitos:
#   - supabase CLI logado (supabase login)
#   - ~/.config/instaflow/postforme.env com POSTFORME_API_KEY=...
#   - senha do banco do projeto (o `supabase link` pede; ou exporte SUPABASE_DB_PASSWORD)
#
# O que faz, nesta ordem:
#   1. supabase link no projeto
#   2. aplica as migrations (db push)
#   3. grava os secrets (chave do Post for Me, origens permitidas)
#   4. publica as funções api e pfm-webhook
#   5. insere o primeiro admin em allowed_users
#   6. escreve site/assets/config.js
#   (o webhook do Post for Me é registrado sozinho na primeira vez que a página
#    Contas sincroniza, ou pelo botão em Config → "Registrar avisos")
#
# NUNCA rode `supabase config push` aqui (sobrescreve o Auth do painel).
set -euo pipefail
cd "$(dirname "$0")/.."

REF="${1:-}"; ADMIN="${2:-}"; SITE_URL="${3:-}"
if [[ -z "$REF" || -z "$ADMIN" ]]; then
  echo "uso: scripts/setup.sh <PROJECT_REF> <EMAIL_DO_ADMIN> [URL_DO_SITE]"; exit 1
fi
ENV_FILE="$HOME/.config/instaflow/postforme.env"
[[ -s "$ENV_FILE" ]] || { echo "faltou $ENV_FILE com POSTFORME_API_KEY=..."; exit 1; }

echo "▶ 1/6 link"
if [[ -n "${SUPABASE_DB_PASSWORD:-}" ]]; then
  supabase link --project-ref "$REF" --password "$SUPABASE_DB_PASSWORD"
else
  supabase link --project-ref "$REF"
fi

echo "▶ 2/6 migrations"
supabase db push

echo "▶ 3/6 secrets"
ORIGINS="${SITE_URL:-}"
supabase secrets set --env-file "$ENV_FILE"
if [[ -n "$ORIGINS" ]]; then supabase secrets set ALLOWED_ORIGINS="$ORIGINS"; fi

echo "▶ 4/6 funções"
supabase functions deploy api --no-verify-jwt
supabase functions deploy pfm-webhook --no-verify-jwt

echo "▶ 5/6 primeiro admin: $ADMIN"
supabase db query --linked "insert into public.allowed_users (email, role) values (lower('$ADMIN'), 'admin') on conflict (email) do update set role = 'admin';"

echo "▶ 6/6 config do site"
scripts/write-config.sh "$REF"

cat <<EOF

✔ Pronto. Próximos passos:
  1. Publique a pasta site/ (GitHub Pages) e anote a URL, ex.: https://usuario.github.io/instaflow/
  2. No painel do Post for Me (app.postforme.dev), no projeto Quickstart, defina o "Auth callback URL":
       <URL_DO_SITE>/contas/
  3. Entre no painel com $ADMIN (Primeiro acesso → cria a senha).
  4. Em Config, clique em "Testar conexão" e "Registrar avisos (webhook)".
  5. Em Contas, clique em "Conectar Instagram".
EOF
