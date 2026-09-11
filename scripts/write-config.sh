#!/usr/bin/env bash
# Escreve docs/assets/config.js com a URL e a chave pública (anon/publishable) do projeto.
# Uso: scripts/write-config.sh <PROJECT_REF>
set -euo pipefail
cd "$(dirname "$0")/.."
REF="${1:-}"
[[ -n "$REF" ]] || { echo "uso: scripts/write-config.sh <PROJECT_REF>"; exit 1; }

KEYS_JSON="$(supabase projects api-keys --project-ref "$REF" --output json)"
ANON="$(printf '%s' "$KEYS_JSON" | python3 -c '
import json,sys
keys=json.load(sys.stdin)
if isinstance(keys, dict): keys = keys.get("api_keys") or keys.get("keys") or []
# prefere a chave publishable nova; cai para a anon (legacy)
pub=[k for k in keys if str(k.get("name","")).startswith("sb_publishable") or k.get("type")=="publishable"]
anon=[k for k in keys if k.get("name")=="anon" or k.get("type")=="legacy" and k.get("name")=="anon"]
k=(pub or anon or [{}])[0]
print(k.get("api_key") or k.get("apiKey") or "")
')"
[[ -n "$ANON" ]] || { echo "não achei a chave pública; rode: supabase projects api-keys --project-ref $REF"; exit 1; }

cat > docs/assets/config.js <<EOF
// Gerado por scripts/write-config.sh em $(date -u +%Y-%m-%dT%H:%M:%SZ). A chave abaixo é pública por desenho:
// o que protege os dados é o RLS no banco e a checagem de e-mail na função \`api\`.
window.INSTAFLOW_CONFIG = {
  SUPABASE_URL: "https://${REF}.supabase.co",
  SUPABASE_ANON_KEY: "${ANON}",
  PLAN_MONTHLY_LIMIT: 1000,
};
EOF
echo "✔ docs/assets/config.js escrito para https://${REF}.supabase.co"
