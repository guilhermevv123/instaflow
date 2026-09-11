# InstaFlow · painel estático servido por nginx.
# O painel é só HTML/CSS/JS (pasta docs/); o "back-end" roda no Supabase e no Post for Me.
#   docker build -t instaflow .
#   docker run -d -p 8080:80 --name instaflow instaflow   → http://localhost:8080/
# Ao publicar num domínio próprio, libere esse domínio no Supabase
# (secret INSTAFLOW_ALLOWED_ORIGINS e Auth → Redirect URLs) e no Post for Me (Project Redirect URL → /contas/).
FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY docs/ /usr/share/nginx/html/

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1/healthz || exit 1
