#!/usr/bin/env bash
# Publica a pasta docs/ no GitHub Pages (repositório público, branch main, pasta /docs).
# Uso: scripts/publish-site.sh [nome-do-repo]   (padrão: instaflow)
set -euo pipefail
cd "$(dirname "$0")/.."
REPO="${1:-instaflow}"
USER="$(gh api user -q .login)"

if ! gh repo view "$USER/$REPO" >/dev/null 2>&1; then
  echo "▶ criando repositório público $USER/$REPO"
  gh repo create "$USER/$REPO" --public --source . --remote origin --push
else
  git remote get-url origin >/dev/null 2>&1 || git remote add origin "https://github.com/$USER/$REPO.git"
  git push -u origin main
fi

echo "▶ ativando GitHub Pages (main, pasta /docs)"
if gh api "repos/$USER/$REPO/pages" >/dev/null 2>&1; then
  printf '{"source":{"branch":"main","path":"/docs"}}' | gh api -X PUT "repos/$USER/$REPO/pages" --input - >/dev/null
else
  printf '{"source":{"branch":"main","path":"/docs"}}' | gh api -X POST "repos/$USER/$REPO/pages" --input - >/dev/null
fi

echo "✔ Site: https://$USER.github.io/$REPO/   (leva 1–2 min para ficar no ar)"
echo "  Depois rode: supabase secrets set INSTAFLOW_ALLOWED_ORIGINS=https://$USER.github.io"
