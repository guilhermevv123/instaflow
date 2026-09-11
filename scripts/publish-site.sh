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
gh api -X POST "repos/$USER/$REPO/pages" -f 'source[branch]=main' -f 'source[path]=/docs' >/dev/null 2>&1 || \
gh api -X PUT "repos/$USER/$REPO/pages" -f 'source[branch]=main' -f 'source[path]=/docs' >/dev/null

echo "✔ Site: https://$USER.github.io/$REPO/   (leva 1–2 min para ficar no ar)"
echo "  Depois rode: supabase secrets set ALLOWED_ORIGINS=https://$USER.github.io"
