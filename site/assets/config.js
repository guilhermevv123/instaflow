// Preenchido pelo script scripts/write-config.sh depois de criar o projeto no
// Supabase. A chave "anon/publishable" é pública por desenho: o que protege os
// dados é o RLS no banco e a checagem de e-mail na função `api`.
window.INSTAFLOW_CONFIG = {
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: "",
  // Limite mensal do plano do Post for Me (posts bem-sucedidos, contados por conta)
  PLAN_MONTHLY_LIMIT: 1000,
};
