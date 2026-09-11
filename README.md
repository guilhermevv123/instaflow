# InstaFlow

Um post agendado → publicado em várias contas de **Instagram, Facebook (Páginas) e TikTok** na hora marcada.
Painel estático (GitHub Pages) + Supabase (banco, login e duas funções) + [Post for Me](https://www.postforme.dev) (API que conecta as contas, hospeda a mídia, agenda e publica pelas APIs oficiais de cada rede).

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

## Times (multi-tenant)

- Toda conta nova ganha o **próprio time** (gatilho `handle_new_user` em `auth.users`). Se o e-mail tinha convite pendente, entra no time que convidou em vez de criar um.
- `teams`, `team_members` (owner/admin/editor), `team_invites`. Contas, grupos, mídia e posts têm `team_id`; o RLS filtra por `my_team_ids()`.
- Convites/remoção/renomear via RPC (`team_invite`, `team_remove_member`, `team_cancel_invite`, `team_rename`) — só admins do time. O dono não pode ser removido.
- O painel manda `X-Team: <id>` para a função `api`; sem o cabeçalho, vale o primeiro time. Trocar de time: seletor no menu lateral (quando há mais de um).
- Limites por time (`max_accounts` 20, `max_posts_month` 300, conta a conta) — a função `api` recusa acima disso. Ajuste no banco se precisar.
- Post for Me é um projeto só para todos os times: o link "Conectar Instagram" leva `external_id = ifteam_<team_id>_xxxx`, e é por isso que o webhook e o `sync` sabem de que time é cada conta.

## Redes

| Rede | O que vira uma conta | Aceita | Regras que o painel aplica |
|---|---|---|---|
| Instagram | perfil Profissional (login do Instagram, sem Página) | foto, vídeo/Reels, Stories, carrossel ≤ 10 | Feed exige 4:5–1.91:1 (✂ Ajustar), legenda obrigatória, 100 posts/24 h |
| Facebook | cada Página escolhida na autorização | texto puro, foto, vídeo, Reels, Stories, carrossel só de fotos | Reels = 1 vídeo; Stories = 1 mídia; legenda opcional com mídia |
| TikTok | perfil (Login Kit) | 1 vídeo (MP4/MOV/WebM) ou 1–32 fotos (≤ 20 MB cada) | nunca misturar; título ≤ 85; privacidade público/privado; opções de comentário/dueto/stitch/marca/IA/música |

"Tipo" (Feed/Reels/Stories) vale para Instagram e Facebook; o TikTok recebe a mídia como está. A publicação vai com `platform_configurations` por rede (`instagram`, `facebook`, `tiktok`) e as opções ficam em `posts.options` no mesmo formato. No Post for Me, cada rede precisa ser ativada uma vez em **Setup → Get Started** (a API responde "Social provider app credentials not found" até isso).

## Como funciona

1. **Contas** → "+ Conectar" → escolhe a rede; a autorização oficial abre numa janela pop-up; ao voltar, a janela avisa a página que abriu (`postMessage`) e fecha — a sessão de quem clicou nunca se perde, seja no local, no Pages ou num domínio próprio. Sem pop-up, segue na mesma aba.
2. **Criar** → tipo (Feed, Reels, Stories), mídia (sobe direto para o Post for Me), legenda (com variação por conta), contas/grupos, data e hora (Bahia). O botão **✨ Criar variações** preenche uma legenda diferente para cada conta escolhida: a 1ª fica com a original e as outras ganham versões com o mesmo sentido — escritas pela IA do time, se ligada em Config, ou pelo gerador automático `assets/variar.js` (grátis, no navegador: troca expressões comuns, vocativo, quebras de linha, emojis equivalentes e a ordem das hashtags). Números (ex.: 44144), @menções, links e #hashtags nunca mudam; contas com legenda repetida ficam marcadas. Foto fora de 4:5–1.91:1 abre o **✂ Ajustar** (`assets/cropper.js`): proporção, zoom/arrastar (Cortar) ou Caber inteira com fundo (cor da foto, desfocado, branco, preto). Sai JPEG 92% com até 1440 px de largura e vai com `skip_processing: true`. Foto com menos de 1080 px de largura recebe aviso de nitidez.
3. A função `api` cria **1 post no Post for Me com N contas** e grava `posts` + `post_targets` (uma linha por conta).
4. No horário, o Post for Me publica (checa a cada 2 min) e chama `pfm-webhook` com o resultado de cada conta. A **Fila** mostra publicado/falhou/link do post; "Atualizar status" confere direto na API se algum aviso se perder.
5. Falhou em 2 de 20? "Reenviar agora para as que falharam" cria um reenvio só para elas.
6. **Desempenho** (menu lateral, com resumo no Início) → seguidores e ganhos por dia, visualizações, alcance, curtidas, comentários, compartilhamentos, salvos e tempo assistido de cada post e de cada conta; tabela por conta, melhores posts e todos os posts. A função `api` atualiza sozinha a cada 3 horas (pg_cron → `POST /metrics/cron`): seguidores, curtidas e comentários pela Graph API com a chave que o Post for Me guarda de cada conta; o resto pelo feed do Post for Me com `expand=metrics`, que só vem de contas conectadas com a permissão "feeds" (pedida desde 11/09; contas antigas usam **Liberar métricas** em Contas).

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

Depois: "Criar conta" na tela de login (entra direto, com o próprio time), **Config** → "Testar conexão" e "Registrar avisos", e **Contas** → "Conectar Instagram".

## Onde está ligado hoje (10/09/2026)

- **Supabase:** projeto exclusivo `bcopmfxhfsyfwaajnnfm` (us-west-2, conta guilhermevv123). Secrets: `POSTFORME_API_KEY`, `INSTAFLOW_ALLOWED_ORIGINS`. Auth: `mailer_autoconfirm=true` (cadastro entra direto, sem e-mail), `site_url` = painel.
- O projeto está em outra conta Supabase, então o `supabase link` deste Mac não funciona. Deploy sem link:
  ```bash
  set -a; . ~/.config/instaflow/supabase.env; set +a   # SUPABASE_ACCESS_TOKEN e SUPABASE_PROJECT_REF
  supabase functions deploy api --project-ref $SUPABASE_PROJECT_REF --no-verify-jwt --use-api
  supabase functions deploy pfm-webhook --project-ref $SUPABASE_PROJECT_REF --no-verify-jwt --use-api
  ```
  SQL: Management API `POST /v1/projects/<ref>/database/query` (ver histórico em `supabase_migrations.schema_migrations`).
- **Site:** https://guilhermevv123.github.io/instaflow/ (repo público `guilhermevv123/instaflow`, Pages em `/docs`).
- **Post for Me:** webhook → `https://bcopmfxhfsyfwaajnnfm.supabase.co/functions/v1/pfm-webhook` (id e segredo em `app_settings.pfm_webhook`). Auth callback URL do projeto deve ser `https://guilhermevv123.github.io/instaflow/contas/`.
- **Auth:** `uri_allow_list` inclui o painel e `http://localhost:8765/**` (servidor local: `.claude/launch.json` → `instaflow-local`).

## Rodar com Docker

O painel é estático; o container só serve a pasta `docs/` com nginx (≈77 MB).

```bash
docker build -t instaflow .
docker run -d -p 8080:80 --name instaflow instaflow   # http://localhost:8080/
```

- `/healthz` responde `ok` (usado pelo HEALTHCHECK).
- HTML e `assets/config.js` saem sem cache; CSS/JS/imagens com 1 h de cache.
- Em domínio próprio, libere o domínio em: secret `INSTAFLOW_ALLOWED_ORIGINS` (CORS da função `api`), Supabase → Auth → Redirect URLs (`https://seu-dominio/**`) e Post for Me → Project Redirect URL (`https://seu-dominio/contas/`).

## Segurança

- A chave do Post for Me só existe nos secrets do Supabase; o navegador nunca a vê.
- Toda tabela tem RLS por time (`team_id in my_team_ids()`); `app_settings` e `webhook_events` só a service role.
- A chave de IA de cada time fica em `team_ai_keys` (sem policy: só a service role lê); a API devolve só o começo e o fim dela e testa a chave antes de salvar. Limite de 150 gerações com IA por time a cada 24 h (`ai_calls`).
- O agendador das métricas chama `POST /metrics/cron` com um segredo guardado em `app_settings('metrics_cron')` (url, chave pública e segredo — nunca neste repositório); sem ele a rota responde 401.
- O webhook confere o segredo do Post for Me (cabeçalho `Post-For-Me-Webhook-Secret`) antes de aceitar.
- Nunca rode `supabase config push` neste projeto (sobrescreve o Auth do painel).

## Manutenção

- Nova migration: `supabase migration new nome` → editar → `supabase db push`.
- Funções: `supabase functions deploy api --no-verify-jwt` (idem `pfm-webhook`). Checagem local: `cd supabase/functions && deno check api/index.ts pfm-webhook/index.ts`.
- Site: editar `docs/` e `git push` (Pages publica sozinho).
- Testes: `node --test tests/variar.test.mjs` (gerador local de variações) e `cd supabase/functions && deno test --allow-env --allow-net _shared/` (IA e métricas: provedores, conferência das versões, rotas e sincronização com banco e APIs falsos).
