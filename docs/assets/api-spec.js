// InstaFlow · especificação da API pública v1.
// Fonte única da referência da documentação (docs/api/) e do arquivo OpenAPI
// que a página gera para importar no Postman, Insomnia, n8n etc.
// Textos em HTML simples; {BASE} vira o endereço da API na hora de mostrar.

export const VERSION = "1.2.0";
export const UPDATED = "14/09/2026";

// ------------------------------------------------------------------ exemplos reutilizados
const ID_POST = "6f1d2c8a-3b1e-4f7a-9d2c-8e5b4a1c0f37";
const ID_POST_2 = "b2a7e9d4-1c3f-4e8b-a6d5-7f9c0e2b4a18";
const ID_GRUPO = "3c9e7a1b-5d2f-4b8e-9a6c-1f0d8e7b2c45";
const ID_MIDIA = "9a4b2c7d-8e1f-4a3b-b5c6-d7e8f9a0b1c2";
const ID_HOOK = "e7d6c5b4-a3f2-4e1d-8c9b-0a1f2e3d4c5b";
const CONTA_IG = "spc_Lj3Kd82hQx1mNp4";
const CONTA_IG_2 = "spc_Pq8Wm2Zt6Rv9Yb3";
const CONTA_TT = "spc_Tk5Hn7Jd1Lc3Vx8";
const CONTA_FB = "spc_Fb2Gs9Kw4Mq6Nd1";
const LEGENDA = "Promoção de sexta: tudo com 20% off na loja! 🔥 Corre que é só hoje.\n\n#ofertas #sexta";

export const EXEMPLOS = { ID_POST, ID_GRUPO, ID_MIDIA, ID_HOOK, CONTA_IG, CONTA_IG_2, CONTA_TT, CONTA_FB, LEGENDA };

const conta = (id, platform, username, extra = {}) => ({
  id, platform, username, label: null, status: "connected", archived: false,
  profile_photo_url: `https://cdn.postforme.dev/avatars/${id}.jpg`, access_token_expires_at: "2026-11-10T14:02:11.000Z",
  followers: 12840, follows: 312, media_count: 486, insights_ok: true, published_24h: 3,
  stats_synced_at: "2026-09-14T15:07:00.000Z", synced_at: "2026-09-14T12:00:03.000Z", ...extra,
});

const resultado = (account_id, username, platform, status, extra = {}) => ({
  account_id, username, platform, label: null, status,
  permalink: status === "published" ? `https://www.instagram.com/reel/C${account_id.slice(4, 10)}/` : null,
  platform_post_id: status === "published" ? "18043921876543210" : null,
  error: status === "failed" ? "O Instagram não conseguiu baixar a mídia. Tente de novo em alguns minutos." : null,
  published_at: status === "published" ? "2026-09-20T21:01:12.000Z" : null,
  updated_at: "2026-09-20T21:01:12.000Z", ...extra,
});

// ------------------------------------------------------------------ códigos de erro
export const ERROS = [
  [400, "(sem code)", "Algum dado não passou nas regras. A mensagem diz exatamente o quê (ex.: \"Instagram: Reels precisa de exatamente um vídeo.\")."],
  [400, "conta_desconhecida", "Um id de conta não existe neste time. Liste com GET /accounts."],
  [400, "grupo_desconhecido", "Um id de grupo não existe neste time. Liste com GET /groups."],
  [400, "ia_chave", "A IA do time recusou a chave configurada (só com mode \"ai\")."],
  [400, "idempotencia_invalida", "O cabeçalho Idempotency-Key tem espaço, acento ou passa de 255 caracteres."],
  [401, "sem_autorizacao", "Faltou o cabeçalho Authorization: Bearer ifk_… (ou ele veio sem a palavra Bearer)."],
  [401, "chave_invalida", "A chave não existe ou está em formato errado: foi copiada cortada, com espaço, ou é de outro sistema."],
  [401, "chave_revogada", "A chave foi revogada no painel. Gere outra em Config → API."],
  [403, "somente_leitura", "A chave é só de leitura e a chamada tentou criar, mudar ou apagar algo."],
  [403, "conta_bloqueada", "A chave está presa a algumas contas e a chamada envolve outra conta."],
  [403, "so_painel", "Isto só é feito pelo painel (ex.: criar ou revogar chaves)."],
  [404, "rota_desconhecida", "O método ou o caminho não existem. Confira a referência."],
  [404, "(sem code)", "O item (publicação, grupo, mídia, webhook…) não existe neste time ou nas contas da chave."],
  [409, "idempotencia_conflito", "A mesma Idempotency-Key já foi usada com outro corpo ou outra rota. Use uma chave nova por operação."],
  [409, "idempotencia_em_andamento", "A primeira requisição com essa Idempotency-Key ainda está rodando. Espere alguns segundos e repita com a mesma chave."],
  [409, "sem_ia", "Pediu variações só com IA (mode \"ai\"), mas o time não tem IA ligada."],
  [429, "limite_chamadas", "Passou do limite de chamadas por minuto da chave. Espere o minuto virar (cabeçalho X-RateLimit-Reset)."],
  [429, "limite_ia", "O time usou as 150 gerações com IA das últimas 24 horas (só com mode \"ai\")."],
  [429, "ia_cota", "O provedor de IA do time recusou por cota (só com mode \"ai\")."],
  [502, "ia_rede · ia_modelo · ia_resposta", "O provedor de IA não respondeu direito (só com mode \"ai\")."],
  [502, "(sem code)", "O Post for Me (serviço que publica nas redes) recusou ou não respondeu. O campo details traz a resposta dele."],
  [500, "(sem code)", "Erro inesperado do nosso lado. Tente de novo; se repetir, fale com o suporte com o X-Request-Id."],
];

// ------------------------------------------------------------------ eventos de webhook
export const EVENTOS = [
  {
    type: "post.published",
    quando: "A publicação saiu numa conta. Chega um aviso por conta, logo que a rede confirma.",
    data: { post_id: ID_POST, title: "Reels da promoção", placement: "reels", scheduled_at: "2026-09-20T21:00:00.000Z", account_id: CONTA_IG, username: "lojacentro", platform: "instagram", status: "published", permalink: "https://www.instagram.com/reel/C8xYz12AbCd/", platform_post_id: "18043921876543210", error: null, published_at: "2026-09-20T21:01:12.000Z" },
  },
  {
    type: "post.failed",
    quando: "A publicação falhou numa conta. O campo error explica o motivo em português.",
    data: { post_id: ID_POST, title: "Reels da promoção", placement: "reels", scheduled_at: "2026-09-20T21:00:00.000Z", account_id: CONTA_TT, username: "lojacentro.tt", platform: "tiktok", status: "failed", permalink: null, platform_post_id: null, error: "Vídeo fora do formato aceito pelo TikTok.", published_at: null },
  },
  {
    type: "post.completed",
    quando: "Todas as contas da publicação já têm resultado (publicada ou falhou). Sai uma vez só por publicação.",
    data: { post_id: ID_POST, title: "Reels da promoção", status: "partial", targets: { total: 3, published: 2, failed: 1, pending: 0 } },
  },
  {
    type: "account.updated",
    quando: "Uma conta foi conectada, reconectada, desconectada ou removida (inclusive pelo painel).",
    data: { account_id: CONTA_IG, platform: "instagram", username: "lojacentro", status: "connected", access_token_expires_at: "2026-11-10T14:02:11.000Z" },
  },
  {
    type: "ping",
    quando: "Só quando você clica em Testar (ou chama POST /webhooks/{webhook_id}/test).",
    data: { message: "Olá do InstaFlow! Se você recebeu isto, o webhook está funcionando.", webhook_id: ID_HOOK, team: "Loja Centro" },
  },
];

// ------------------------------------------------------------------ parâmetros comuns
const P_LIMIT = { name: "limit", type: "integer", desc: "Quantos itens por página (1 a 100).", default: 25 };
const P_OFFSET = { name: "offset", type: "integer", desc: "Quantos itens pular (para ir às próximas páginas).", default: 0 };
const H_IDEM = { name: "Idempotency-Key", type: "string", desc: "Opcional. Um valor único por operação (ex.: um UUID novo). Se a mesma requisição for repetida com a mesma chave em até 24 horas, a API devolve a primeira resposta sem fazer de novo (e manda <code>Idempotent-Replayed: true</code>). Veja <a href=\"#idempotencia\">Idempotência</a>." };
const MIDIA_ITEM = [
  { name: "url", type: "string", required: true, desc: "Link público <b>https</b> do arquivo. Pode ser o <code>media_url</code> de POST /media/upload-url ou qualquer link direto (não serve página do Google Drive/Dropbox: tem que abrir o arquivo em si)." },
  { name: "kind", type: "string", enum: ["image", "video"], desc: "Tipo do arquivo. <b>Mande sempre que puder.</b> Se não mandar, vale o final do link (<code>.mp4</code>, <code>.mov</code>, <code>.m4v</code>, <code>.webm</code> = vídeo; <code>.jpg</code>, <code>.png</code>, <code>.webp</code> = foto) e, se o link não tiver extensão (como o <code>media_url</code> do upload), a API pergunta ao próprio link o tipo do arquivo." },
  { name: "thumbnail_url", type: "string", desc: "Só vídeo. Capa: link https de uma imagem JPEG (no Instagram vira a capa do Reels). Sem capa, a rede usa o primeiro quadro." },
  { name: "thumbnail_timestamp_ms", type: "integer", desc: "Só vídeo. Capa pelo instante do vídeo, em milissegundos (ex.: <code>1500</code> = 1,5 s). Se mandar <code>thumbnail_url</code> também, a imagem tem prioridade." },
  { name: "skip_processing", type: "boolean", desc: "<code>true</code> quando o arquivo já está no tamanho e formato finais (o Post for Me não reprocessa). Deixe de fora na dúvida." },
];
const PLATFORM_OPTIONS = [
  { name: "instagram", type: "object", desc: "Opções do Instagram.", children: [
    { name: "share_to_feed", type: "boolean", desc: "Reels: mostrar também no Feed do perfil.", default: true },
    { name: "collaborators", type: "string[]", desc: "Até 3 @usuários convidados como colaboradores (Feed e Reels). Ex.: <code>[\"parceiro\", \"loja2\"]</code>." },
  ] },
  { name: "facebook", type: "object", desc: "Opções do Facebook (Páginas).", children: [
    { name: "set_caption_for_each_image", type: "boolean", desc: "Carrossel: repetir a legenda em cada foto.", default: true },
  ] },
  { name: "youtube", type: "object", desc: "Opções do YouTube.", children: [
    { name: "title", type: "string", desc: "Título do vídeo (até 100 caracteres). Vazio = primeira linha da legenda. A legenda inteira vira a descrição do vídeo." },
    { name: "privacy_status", type: "string", enum: ["public", "unlisted", "private"], desc: "Quem pode ver: público, não listado (só com o link) ou privado.", default: "public" },
    { name: "made_for_kids", type: "boolean", desc: "Declara que o vídeo é feito para crianças (regra do YouTube).", default: false },
    { name: "tags", type: "string[]", desc: "Tags do vídeo, até 500 caracteres somando todas. Ex.: <code>[\"ofertas\", \"bahia\"]</code>." },
    { name: "category_id", type: "string", desc: "Categoria do YouTube (ex.: <code>\"22\"</code> = Pessoas e blogs). Sem ela, fica a padrão do canal." },
    { name: "contains_synthetic_media", type: "boolean", desc: "Marca como conteúdo alterado ou gerado por IA (o YouTube mostra um aviso no vídeo).", default: false },
  ] },
  { name: "tiktok_business", type: "object", desc: "Opções do TikTok Business: os mesmos campos de <code>tiktok</code>. Sem este objeto, vale o que veio em <code>tiktok</code>." },
  { name: "tiktok", type: "object", desc: "Opções do TikTok (e do TikTok Business, quando <code>tiktok_business</code> não vier).", children: [
    { name: "title", type: "string", desc: "Título (até 85 caracteres). Vazio = começo da legenda." },
    { name: "privacy_status", type: "string", enum: ["public", "private"], desc: "Quem pode ver.", default: "public" },
    { name: "allow_comment", type: "boolean", desc: "Permitir comentários.", default: true },
    { name: "allow_duet", type: "boolean", desc: "Permitir dueto.", default: true },
    { name: "allow_stitch", type: "boolean", desc: "Permitir stitch.", default: true },
    { name: "auto_add_music", type: "boolean", desc: "Fotos: o TikTok coloca música automática.", default: true },
    { name: "disclose_your_brand", type: "boolean", desc: "Marca como conteúdo da sua própria marca.", default: false },
    { name: "disclose_branded_content", type: "boolean", desc: "Marca como parceria paga (conteúdo de marca de terceiros).", default: false },
    { name: "is_ai_generated", type: "boolean", desc: "Marca como conteúdo gerado por IA.", default: false },
  ] },
];
const CORPO_POST = [
  { name: "caption", type: "string", required: true, desc: "Legenda principal (até 2.200 caracteres). Pode ter emojis, quebras de linha (<code>\\n</code>), #hashtags e @menções. Pode ficar vazia só em Stories e em post só de Facebook com mídia. No <b>Threads</b> o texto de cada conta vai até 500 caracteres e no <b>Bluesky</b> até 300: use <code>caption_overrides</code> para dar uma versão menor a essas contas." },
  { name: "account_ids", type: "string[]", required: true, desc: "Ids das contas que recebem a publicação (GET /accounts). Pode ser vazio se mandar <code>group_ids</code>. Todas precisam estar conectadas." },
  { name: "group_ids", type: "string[]", desc: "Ids de grupos (GET /groups): as contas deles entram junto com <code>account_ids</code>, sem repetir." },
  { name: "media", type: "array", desc: "Fotos e vídeos, na ordem do carrossel. Facebook, Threads, LinkedIn e Bluesky aceitam post sem mídia. Cada item pode ser só o link (string) ou um objeto:", children: MIDIA_ITEM },
  { name: "placement", type: "string", enum: ["timeline", "reels", "stories"], default: "timeline", desc: "Onde sai no Instagram e no Facebook: <code>timeline</code> = Feed (foto, vídeo ou carrossel), <code>reels</code>, <code>stories</code>. No TikTok, TikTok Business, YouTube, Threads, LinkedIn e Bluesky não muda nada." },
  { name: "scheduled_at", type: "string | null", desc: "Quando publicar, em ISO 8601. <b>Sem fuso</b> (ex.: <code>2026-09-20T18:00</code>) vale o horário da Bahia. Com fuso (<code>…Z</code> ou <code>…-03:00</code>) vale o que veio. <code>null</code>, <code>\"now\"</code> ou não mandar = publicar agora (sai em até 2 minutos). Precisa estar no futuro." },
  { name: "title", type: "string", desc: "Nome interno para achar a publicação depois (até 80 caracteres). Não aparece nas redes." },
  { name: "vary_captions", type: "boolean | string", enum: [true, false, "auto", "ai", "local"], desc: "Gera uma legenda diferente para cada conta, a partir de <code>caption</code>. A primeira conta fica com a original; as outras sem legenda própria em <code>caption_overrides</code> ganham uma versão. <code>true</code> = <code>\"auto\"</code> (IA do time se ligada, senão o gerador automático). Veja <a href=\"#variacoes\">Variações de legenda</a>." },
  { name: "caption_overrides", type: "object", desc: "Legenda própria por conta: <code>{ \"id_da_conta\": \"legenda\" }</code>. As contas que não estiverem aqui usam <code>caption</code>. Toda chave precisa estar na lista de contas." },
  { name: "platform_options", type: "object", desc: "Opções de cada rede (só valem para as redes das contas escolhidas).", children: PLATFORM_OPTIONS },
  { name: "dry_run", type: "boolean", desc: "<code>true</code> = só confere tudo e mostra o que seria enviado, sem salvar nem publicar (também aceita <code>?dry_run=true</code> no endereço). Ótimo para testar a integração.", default: false },
];

// ------------------------------------------------------------------ grupos de rotas
export const GROUPS = [
  {
    id: "ref-chave",
    title: "Chave, time e uso",
    intro: "Confira se a chave está funcionando, de qual time ela é e quanto do limite do mês já foi usado.",
    endpoints: [
      {
        id: "get-me", method: "GET", path: "/me", auth: "read",
        title: "Conferir a chave",
        summary: "Diz qual chave está sendo usada, o time dela, se é só leitura, as contas liberadas e o limite por minuto.",
        desc: "<p>É a primeira chamada a fazer numa integração nova: se voltar <code>200</code>, a chave e o endereço estão certos.</p>",
        response: { status: 200, body: { via: "api_key", key: { id: "5d1c0b9a-7e6f-4d3c-b2a1-908f7e6d5c4b", name: "n8n", prefix: "ifk_a1B2c3D4", scopes: [], read_only: false, account_ids: null, rate_limit: 120 }, team: { id: "c0ffee00-1234-4abc-9def-0123456789ab", name: "Loja Centro", accounts: 12, max_accounts: null, max_posts_month: 1000 } } },
        errors: [[401, "sem_autorizacao"], [401, "chave_invalida"], [401, "chave_revogada"], [429, "limite_chamadas"]],
      },
      {
        id: "get-team", method: "GET", path: "/team", auth: "read",
        title: "Dados do time",
        summary: "Nome do time, contas conectadas, limite de contas e uso do mês (conta a conta).",
        desc: "<p><code>month_used</code> soma o que já foi publicado e o que está agendado para este mês, contando <b>cada conta</b> que recebe uma publicação (1 post em 10 contas = 10).</p>",
        response: { status: 200, body: { id: "c0ffee00-1234-4abc-9def-0123456789ab", name: "Loja Centro", role: "api", accounts: 12, max_accounts: null, month_used: 184, max_posts_month: 1000 } },
      },
      {
        id: "get-usage", method: "GET", path: "/usage", auth: "read",
        title: "Uso do mês e do plano",
        summary: "Quanto o time já usou no mês e quanto o plano inteiro (todos os times) já usou.",
        desc: "<p>O plano do Post for Me permite <b>1.000 publicações por mês, conta a conta, somando todos os times</b>. A API recusa uma publicação nova quando ela passaria do limite do time ou do plano (erro <code>400</code> com a conta explicada).</p>",
        response: { status: 200, body: { team: { id: "c0ffee00-1234-4abc-9def-0123456789ab", name: "Loja Centro", role: "api", max_accounts: null }, month_published: 131, month_reserved: 184, month_limit: 1000, plan_used: 402, plan_limit: 1000, webhook: { id: "wbh_iXyhiF3oyitrTzFHPFeg", url: "{SUPABASE}/functions/v1/pfm-webhook", since: "2026-09-10T23:40:00.000Z" }, last_event: { received_at: "2026-09-14T14:59:31.000Z", event_type: "social.post.result.created" } } },
      },
      {
        id: "get-health", method: "GET", path: "/health", auth: "read",
        title: "Testar a ligação com as redes",
        summary: "Confere se o serviço de publicação (Post for Me) está respondendo.",
        response: { status: 200, body: { ok: true, accounts_total: 12, team: "Loja Centro" } },
        errors: [[502, "(sem code)"]],
      },
    ],
  },
  {
    id: "ref-contas",
    title: "Contas",
    intro: "As contas de Instagram, Facebook (Páginas) e TikTok do time. O <code>id</code> de cada conta (começa com <code>spc_</code>) é o que vai em <code>account_ids</code> nas publicações.",
    endpoints: [
      {
        id: "list-accounts", method: "GET", path: "/accounts", auth: "read",
        title: "Listar contas",
        summary: "Todas as contas do time (ou só as liberadas para a chave), com seguidores e posts das últimas 24 horas.",
        query: [
          { name: "platform", type: "string", enum: ["instagram", "facebook", "tiktok", "youtube", "threads", "linkedin", "tiktok_business", "bluesky"], desc: "Só uma rede." },
          { name: "status", type: "string", enum: ["connected", "disconnected"], desc: "Só conectadas ou só desconectadas." },
          { name: "archived", type: "boolean", desc: "<code>true</code> inclui contas removidas que ficaram arquivadas por terem histórico.", default: false },
        ],
        example: { query: "platform=instagram&status=connected" },
        desc: "<p><code>published_24h</code> é importante no Instagram: cada conta aceita no máximo <b>100 publicações pela API a cada 24 horas</b>. <code>access_token_expires_at</code> é renovado sozinho; se uma conta ficar <code>disconnected</code>, ela precisa ser reconectada (POST /accounts/connect com o <code>account_id</code> dela).</p>",
        response: { status: 200, body: { data: [conta(CONTA_IG, "instagram", "lojacentro", { label: "Loja Centro" }), conta(CONTA_TT, "tiktok", "lojacentro.tt", { followers: 5310, published_24h: 1 })], meta: { limit: 2, offset: 0, total: 2, has_more: false } } },
      },
      {
        id: "get-account", method: "GET", path: "/accounts/{account_id}", auth: "read",
        title: "Ver uma conta",
        summary: "Detalhes de uma conta, com os grupos em que ela está.",
        pathParams: [{ name: "account_id", type: "string", required: true, desc: "Id da conta (spc_…)." }],
        example: { path: { account_id: CONTA_IG } },
        response: { status: 200, body: { ...conta(CONTA_IG, "instagram", "lojacentro", { label: "Loja Centro" }), groups: [{ id: ID_GRUPO, name: "Lojas da Bahia" }] } },
        errors: [[404, "(sem code)"]],
      },
      {
        id: "sync-accounts", method: "POST", path: "/accounts/sync", auth: "write",
        title: "Sincronizar contas",
        summary: "Busca de novo as contas no serviço de publicação: atualiza foto, nome, validade da chave e marca como desconectadas as que sumiram.",
        desc: "<p>Chame depois que alguém terminar de conectar uma conta (se você não usa o webhook <code>account.updated</code>).</p>",
        response: { status: 200, body: { accounts: [{ id: CONTA_IG, platform: "instagram", username: "lojacentro", status: "connected", "…": "…" }], synced: 12 } },
      },
      {
        id: "connect-account", method: "POST", path: "/accounts/connect", auth: "write",
        title: "Conectar conta (link de autorização)",
        summary: "Gera o link que a pessoa abre no navegador para autorizar a conta dela.",
        body: [
          { name: "platform", type: "string", enum: ["instagram", "facebook", "tiktok", "youtube", "threads", "linkedin", "tiktok_business", "bluesky"], default: "instagram", desc: "Rede a conectar. Com <code>account_id</code>, vale a rede da conta." },
          { name: "account_id", type: "string", desc: "Id (spc_…) de uma conta que <b>já está no time</b>, para reconectar ou pedir de novo as permissões dela (por exemplo, as de métricas). A autorização leva a identificação dessa conta: sem ela, o serviço de publicação recusa a conta que já existe. Não conta no limite de contas, e a resposta repete o <code>account_id</code>." },
          { name: "reconnect", type: "boolean", default: false, desc: "<code>true</code> não conta no limite de contas (quando o time tem um). Para uma conta que já está no time, mande <code>account_id</code>." },
          { name: "bluesky", type: "object", desc: "Só para <code>platform: \"bluesky\"</code>, que não tem tela de login.", children: [
            { name: "handle", type: "string", required: true, desc: "Usuário do Bluesky, ex.: <code>loja.bsky.social</code> (sem o @; sem ponto, vira <code>usuario.bsky.social</code>)." },
            { name: "app_password", type: "string", required: true, desc: "Senha de app criada no Bluesky (Configurações → Privacidade e segurança → Senhas de app). Não é a senha da conta. Vai direto para o serviço de publicação; o InstaFlow não guarda." },
          ] },
        ],
        example: { body: { platform: "instagram" } },
        desc: `<ol class="passos">
          <li>Chame esta rota e pegue o <code>url</code>.</li>
          <li>Abra o <code>url</code> no navegador da pessoa (o login usa a conta que estiver aberta no navegador: no Instagram, troque de conta antes, se preciso).</li>
          <li>A pessoa autoriza. <b>Instagram</b>: precisa ser conta Profissional (Empresa ou Criador). <b>Facebook</b>: marque as Páginas; cada Página vira uma conta. <b>TikTok</b>: perfil pessoal ou de criador.</li>
          <li>A conta aparece no time em poucos segundos. Receba o webhook <code>account.updated</code> ou chame POST /accounts/sync.</li>
        </ol><p>O link vale por pouco tempo: gere na hora de usar. Chaves presas a algumas contas não conectam contas novas, só reconectam as delas (com <code>account_id</code>).</p>
        <p><b>Conta que já existe.</b> Se a pessoa autorizar uma conta que já está conectada sem o <code>account_id</code> dela (por exemplo, esqueceu de trocar de conta no navegador), a volta chega com <code>isSuccess=false</code> e <code>error=External Id already exists for account spc_…|No valid accounts found</code>. Nada muda na conta: se ela for do seu time, gere o link de novo com o <code>account_id</code> que veio no erro; se a ideia era conectar outra, troque para a conta certa no navegador.</p>`,
        response: { status: 200, body: { url: "https://www.instagram.com/oauth/authorize?client_id=…&state=…", platform: "instagram" } },
        errors: [[400, "(sem code)", "O time já está no limite de contas, ou a rede não é suportada."], [403, "conta_bloqueada"], [404, "(sem code)", "O account_id não é de uma conta do time (ou a chave não pode usar essa conta)."]],
      },
      {
        id: "disconnect-account", method: "POST", path: "/accounts/{account_id}/disconnect", auth: "write",
        title: "Desconectar conta",
        summary: "Desliga a conta: publicações agendadas para ela vão falhar até reconectar.",
        pathParams: [{ name: "account_id", type: "string", required: true, desc: "Id da conta." }],
        example: { path: { account_id: CONTA_IG } },
        response: { status: 200, body: { ok: true } },
      },
      {
        id: "remove-account", method: "DELETE", path: "/accounts/{account_id}", auth: "write",
        title: "Remover conta",
        summary: "Tira a conta do time. Se ela já tem publicações, fica arquivada (o histórico continua).",
        pathParams: [{ name: "account_id", type: "string", required: true, desc: "Id da conta." }],
        example: { path: { account_id: CONTA_IG } },
        response: { status: 200, body: { ok: true, archived: true } },
      },
    ],
  },
  {
    id: "ref-grupos",
    title: "Grupos de contas",
    intro: "Grupos juntam contas (ex.: \"Lojas da Bahia\"). Na hora de publicar, mande <code>group_ids</code> em vez de listar conta por conta.",
    endpoints: [
      {
        id: "list-groups", method: "GET", path: "/groups", auth: "read",
        title: "Listar grupos",
        summary: "Todos os grupos do time com os ids das contas de cada um.",
        response: { status: 200, body: { data: [{ id: ID_GRUPO, name: "Lojas da Bahia", color: null, created_at: "2026-09-11T02:10:00.000Z", account_ids: [CONTA_IG, CONTA_IG_2, CONTA_TT] }], meta: { limit: 1, offset: 0, total: 1, has_more: false } } },
      },
      {
        id: "create-group", method: "POST", path: "/groups", auth: "write",
        headers: [H_IDEM],
        title: "Criar grupo",
        summary: "Cria um grupo com as contas informadas.",
        body: [
          { name: "name", type: "string", required: true, desc: "Nome (até 40 caracteres)." },
          { name: "account_ids", type: "string[]", desc: "Contas do grupo." },
          { name: "color", type: "string", desc: "Cor livre para você usar na sua tela (ex.: <code>#FF8A00</code>)." },
        ],
        example: { body: { name: "Lojas da Bahia", account_ids: [CONTA_IG, CONTA_IG_2, CONTA_TT] } },
        response: { status: 201, body: { id: ID_GRUPO, name: "Lojas da Bahia", color: null, created_at: "2026-09-14T15:20:00.000Z", account_ids: [CONTA_IG, CONTA_IG_2, CONTA_TT] } },
        errors: [[400, "conta_desconhecida"]],
      },
      {
        id: "get-group", method: "GET", path: "/groups/{group_id}", auth: "read",
        title: "Ver um grupo",
        summary: "Um grupo e as contas dele.",
        pathParams: [{ name: "group_id", type: "string", required: true, desc: "Id do grupo." }],
        example: { path: { group_id: ID_GRUPO } },
        response: { status: 200, body: { id: ID_GRUPO, name: "Lojas da Bahia", color: null, created_at: "2026-09-11T02:10:00.000Z", account_ids: [CONTA_IG, CONTA_IG_2, CONTA_TT] } },
      },
      {
        id: "update-group", method: "PUT", path: "/groups/{group_id}", auth: "write",
        title: "Alterar grupo",
        summary: "Muda o nome, a cor e/ou as contas. O que não for mandado continua igual; <code>account_ids</code>, quando vem, <b>substitui</b> a lista inteira.",
        pathParams: [{ name: "group_id", type: "string", required: true, desc: "Id do grupo." }],
        body: [
          { name: "name", type: "string", desc: "Novo nome." },
          { name: "account_ids", type: "string[]", desc: "Nova lista completa de contas." },
          { name: "color", type: "string", desc: "Nova cor." },
        ],
        example: { path: { group_id: ID_GRUPO }, body: { name: "Lojas do Nordeste", account_ids: [CONTA_IG, CONTA_TT] } },
        response: { status: 200, body: { id: ID_GRUPO, name: "Lojas do Nordeste", color: null, created_at: "2026-09-11T02:10:00.000Z", account_ids: [CONTA_IG, CONTA_TT] } },
      },
      {
        id: "delete-group", method: "DELETE", path: "/groups/{group_id}", auth: "write",
        title: "Apagar grupo",
        summary: "Apaga o grupo. As contas não mudam.",
        pathParams: [{ name: "group_id", type: "string", required: true, desc: "Id do grupo." }],
        example: { path: { group_id: ID_GRUPO } },
        response: { status: 200, body: { ok: true, deleted: ID_GRUPO } },
      },
    ],
  },
  {
    id: "ref-midia",
    title: "Mídia: fotos e vídeos",
    intro: "Para publicar, cada foto ou vídeo precisa de um link público <b>https</b>. Você pode mandar o arquivo para o nosso armazenamento (recomendado para vídeo) ou usar um link direto que já tenha. Antes, confira os <a href=\"#requisitos\">requisitos de cada rede</a>.",
    endpoints: [
      {
        id: "upload-url", method: "POST", path: "/media/upload-url", auth: "write",
        title: "Pedir link para subir um arquivo",
        summary: "Devolve um endereço temporário para enviar o arquivo (upload_url) e o link público que ele terá (media_url).",
        desc: `<ol class="passos">
          <li>Chame esta rota (sem corpo).</li>
          <li>Envie o arquivo com <b>PUT</b> para o <code>upload_url</code>, com o cabeçalho <code>Content-Type</code> do arquivo (ex.: <code>video/mp4</code>, <code>image/jpeg</code>) e o conteúdo binário no corpo. Não mande a chave da API nesse PUT.</li>
          <li>Resposta 200 no PUT = arquivo guardado. Use o <code>media_url</code> em <code>media[].url</code> no POST /posts.</li>
          <li>Opcional: registre na biblioteca com POST /media para achar depois.</li>
        </ol>
        <p>O <code>upload_url</code> vale por pouco tempo (use logo) e serve para um arquivo só. Vídeo grande? O PUT aceita o arquivo inteiro de uma vez (até os limites de cada rede).</p>`,
        response: { status: 200, body: { upload_url: "https://data.postforme.dev/storage/v1/object/upload/sign/post-media/proj_…/a1b2c3?token=…", media_url: "https://data.postforme.dev/storage/v1/object/public/post-media/proj_…/a1b2c3" } },
        extraSamples: {
          curl: `# 1) pedir o link\ncurl -X POST "{BASE}/media/upload-url" \\\n  -H "Authorization: Bearer $INSTAFLOW_KEY"\n\n# 2) enviar o vídeo para o upload_url que voltou\ncurl -X PUT "UPLOAD_URL_QUE_VOLTOU" \\\n  -H "Content-Type: video/mp4" \\\n  --data-binary @video.mp4`,
          javascript: `// Node 18+\nimport { readFile } from "node:fs/promises";\n\nconst api = (path, init = {}) => fetch("{BASE}" + path, { ...init, headers: { Authorization: \`Bearer \${process.env.INSTAFLOW_KEY}\`, "Content-Type": "application/json", ...init.headers } }).then((r) => r.json());\n\nconst { upload_url, media_url } = await api("/media/upload-url", { method: "POST" });\nconst arquivo = await readFile("video.mp4");\nconst put = await fetch(upload_url, { method: "PUT", headers: { "Content-Type": "video/mp4" }, body: arquivo });\nif (!put.ok) throw new Error("upload falhou: " + put.status);\nconsole.log("pronto para publicar:", media_url);`,
          python: `import os, requests\n\nBASE = "{BASE}"\nH = {"Authorization": f"Bearer {os.environ['INSTAFLOW_KEY']}"}\n\nr = requests.post(f"{BASE}/media/upload-url", headers=H).json()\nwith open("video.mp4", "rb") as f:\n    put = requests.put(r["upload_url"], data=f, headers={"Content-Type": "video/mp4"})\nput.raise_for_status()\nprint("pronto para publicar:", r["media_url"])`,
        },
      },
      {
        id: "register-media", method: "POST", path: "/media", auth: "write",
        headers: [H_IDEM],
        title: "Registrar na biblioteca",
        summary: "Guarda um arquivo (já hospedado) na biblioteca do time, para aparecer no painel e em GET /media.",
        body: [
          { name: "url", type: "string", required: true, desc: "Link https do arquivo (ex.: o <code>media_url</code>)." },
          { name: "kind", type: "string", enum: ["image", "video"], desc: "Se não mandar, vale o final do link ou, sem extensão, o tipo que o próprio link responde." },
          { name: "name", type: "string", desc: "Nome do arquivo (ex.: <code>promo-sexta.mp4</code>)." },
          { name: "mime", type: "string", desc: "Tipo (ex.: <code>video/mp4</code>)." },
          { name: "size_bytes", type: "integer", desc: "Tamanho em bytes." },
          { name: "width", type: "integer", desc: "Largura em pixels." },
          { name: "height", type: "integer", desc: "Altura em pixels." },
          { name: "duration_s", type: "number", desc: "Duração do vídeo em segundos." },
        ],
        example: { body: { url: "https://data.postforme.dev/storage/v1/object/public/post-media/proj_…/a1b2c3", kind: "video", name: "promo-sexta.mp4", mime: "video/mp4", size_bytes: 18450211, width: 1080, height: 1920, duration_s: 27.4 } },
        response: { status: 201, body: { id: ID_MIDIA, url: "https://data.postforme.dev/storage/v1/object/public/post-media/proj_…/a1b2c3", kind: "video", name: "promo-sexta.mp4", mime: "video/mp4", size_bytes: 18450211, width: 1080, height: 1920, duration_s: 27.4, created_at: "2026-09-14T15:31:00.000Z" } },
      },
      {
        id: "list-media", method: "GET", path: "/media", auth: "read",
        title: "Listar a biblioteca",
        summary: "Arquivos da biblioteca do time, do mais novo para o mais antigo.",
        query: [{ name: "kind", type: "string", enum: ["image", "video"], desc: "Só fotos ou só vídeos." }, P_LIMIT, P_OFFSET],
        example: { query: "kind=video&limit=10" },
        response: { status: 200, body: { data: [{ id: ID_MIDIA, url: "https://data.postforme.dev/…/a1b2c3", kind: "video", name: "promo-sexta.mp4", mime: "video/mp4", size_bytes: 18450211, width: 1080, height: 1920, duration_s: 27.4, created_at: "2026-09-14T15:31:00.000Z" }], meta: { limit: 10, offset: 0, total: 1, has_more: false } } },
      },
      {
        id: "get-media", method: "GET", path: "/media/{media_id}", auth: "read",
        title: "Ver um arquivo",
        summary: "Um arquivo da biblioteca.",
        pathParams: [{ name: "media_id", type: "string", required: true, desc: "Id do arquivo na biblioteca." }],
        example: { path: { media_id: ID_MIDIA } },
        response: { status: 200, body: { id: ID_MIDIA, url: "https://data.postforme.dev/…/a1b2c3", kind: "video", name: "promo-sexta.mp4", mime: "video/mp4", size_bytes: 18450211, width: 1080, height: 1920, duration_s: 27.4, created_at: "2026-09-14T15:31:00.000Z" } },
      },
      {
        id: "delete-media", method: "DELETE", path: "/media/{media_id}", auth: "write",
        title: "Tirar da biblioteca",
        summary: "Remove da lista. Publicações que já usaram o arquivo não mudam.",
        pathParams: [{ name: "media_id", type: "string", required: true, desc: "Id do arquivo." }],
        example: { path: { media_id: ID_MIDIA } },
        response: { status: 200, body: { ok: true, deleted: ID_MIDIA } },
      },
    ],
  },
  {
    id: "ref-posts",
    title: "Publicações",
    intro: "Uma publicação é <b>um post que vai para uma ou várias contas</b>, na hora ou num horário marcado. Cada conta tem o próprio resultado (publicada, falhou, aguardando). Veja o <a href=\"#ciclo\">ciclo de uma publicação</a>.",
    endpoints: [
      {
        id: "create-post", method: "POST", path: "/posts", auth: "write",
        headers: [H_IDEM],
        title: "Criar publicação (agendar ou publicar agora)",
        summary: "Publica ou agenda o mesmo post em várias contas, com legenda igual, legenda própria por conta ou variações automáticas.",
        body: CORPO_POST,
        example: { body: { title: "Reels da promoção", caption: LEGENDA, placement: "reels", media: [{ url: "https://data.postforme.dev/storage/v1/object/public/post-media/proj_…/a1b2c3", kind: "video", thumbnail_url: "https://meusite.com/capa-promo.jpg" }], account_ids: [CONTA_IG, CONTA_IG_2, CONTA_TT], scheduled_at: "2026-09-20T18:00", vary_captions: true, platform_options: { instagram: { share_to_feed: true }, tiktok: { title: "Promo de sexta 🔥", privacy_status: "public" } } } },
        desc: `<p><b>O que a API confere antes de aceitar</b> (se algo falhar, volta <code>400</code> dizendo o quê, e nada é criado):</p>
          <ul>
            <li>Todas as contas são do time, estão conectadas e liberadas para a chave.</li>
            <li>Regras de cada rede das contas escolhidas (veja <a href="#requisitos">requisitos</a>): Instagram precisa de mídia, carrossel até 10 itens, Reels = exatamente 1 vídeo; Facebook: carrossel só de fotos, Stories = 1 mídia; TikTok: 1 vídeo <b>ou</b> de 1 a 32 fotos, nunca misturado.</li>
            <li>Horário no futuro e limite do mês do time e do plano.</li>
          </ul>
          <p><b>Depois de aceita</b>: <code>status</code> é <code>scheduled</code> (agendada) ou <code>processing</code> (publicando agora). O resultado de cada conta chega pelos webhooks <code>post.published</code>/<code>post.failed</code> e aparece em GET /posts/{post_id}. O serviço publica em até 2 minutos depois do horário.</p>
          <p>Para testar sem publicar, mande <code>"dry_run": true</code>: a resposta é <code>200</code> e mostra as contas, o horário final em UTC, as legendas por conta e o pedido completo que iria para as redes.</p>`,
        response: { status: 201, body: { id: ID_POST, pfm_post_id: "sp_7Hc2Kq9LmN3xR5t", status: "scheduled", scheduled_at: "2026-09-20T21:00:00.000Z", placement: "reels", account_ids: [CONTA_IG, CONTA_IG_2, CONTA_TT], caption: LEGENDA, caption_overrides: { [CONTA_IG_2]: "Sexta de promoção: 20% off em tudo na loja! 🔥 É só hoje, corre.\n\n#sexta #ofertas", [CONTA_TT]: "Tudo com 20% off na loja nesta sexta! 🔥 Corre que é só hoje.\n\n#ofertas #sexta" }, variations: { source: "ai", generated: 2, ai_count: 2, local_count: 0, weak: 0, provider: "Google Gemini", warning: null } } },
        errors: [[400, "(sem code)"], [400, "conta_desconhecida"], [400, "grupo_desconhecido"], [403, "somente_leitura"], [403, "conta_bloqueada"], [409, "idempotencia_conflito"], [409, "idempotencia_em_andamento"], [502, "(sem code)"]],
      },
      {
        id: "list-posts", method: "GET", path: "/posts", auth: "read",
        title: "Listar publicações",
        summary: "Publicações do time com o resumo de resultados, das mais novas (por horário) para as mais antigas.",
        query: [
          { name: "status", type: "string", desc: "Um ou vários, separados por vírgula: <code>scheduled</code>, <code>processing</code>, <code>processed</code>, <code>canceled</code>, <code>error</code>, <code>draft</code>." },
          { name: "from", type: "string", desc: "Horário marcado a partir de (ISO 8601)." },
          { name: "to", type: "string", desc: "Horário marcado até (ISO 8601)." },
          { name: "account_id", type: "string", desc: "Só publicações que vão para esta conta." },
          { name: "q", type: "string", desc: "Busca no título e na legenda." },
          { name: "order", type: "string", enum: ["desc", "asc"], default: "desc", desc: "<code>asc</code> = próximas primeiro." },
          P_LIMIT, P_OFFSET,
        ],
        example: { query: "status=scheduled&from=2026-09-14T00:00:00Z&order=asc" },
        response: { status: 200, body: { data: [{ id: ID_POST, title: "Reels da promoção", caption: LEGENDA, placement: "reels", status: "scheduled", scheduled_at: "2026-09-20T21:00:00.000Z", media: [{ url: "https://data.postforme.dev/…/a1b2c3", kind: "video", thumbnail_url: "https://meusite.com/capa-promo.jpg", skip_processing: null }], targets: { total: 3, published: 0, failed: 0, pending: 3 }, account_ids: [CONTA_IG, CONTA_IG_2, CONTA_TT], created_at: "2026-09-14T15:40:00.000Z", updated_at: "2026-09-14T15:40:01.000Z", completed_at: null }], meta: { limit: 25, offset: 0, total: 1, has_more: false } } },
      },
      {
        id: "get-post", method: "GET", path: "/posts/{post_id}", auth: "read",
        title: "Ver publicação e resultado por conta",
        summary: "Tudo sobre a publicação: legendas por conta, opções e o resultado em cada conta (link do post, erro).",
        pathParams: [{ name: "post_id", type: "string", required: true, desc: "Id da publicação." }],
        example: { path: { post_id: ID_POST } },
        desc: "<p>Em <code>results</code>, cada conta tem <code>status</code> <code>pending</code> (aguardando), <code>published</code> (com <code>permalink</code>, o link do post na rede) ou <code>failed</code> (com <code>error</code> em português). Se o webhook atrasar, chame POST /posts/{post_id}/sync para conferir na hora.</p>",
        response: { status: 200, body: { id: ID_POST, title: "Reels da promoção", caption: LEGENDA, placement: "reels", status: "processed", scheduled_at: "2026-09-20T21:00:00.000Z", media: [{ url: "https://data.postforme.dev/…/a1b2c3", kind: "video", thumbnail_url: null, skip_processing: null }], targets: { total: 3, published: 2, failed: 1, pending: 0 }, account_ids: [CONTA_IG, CONTA_IG_2, CONTA_TT], created_at: "2026-09-14T15:40:00.000Z", updated_at: "2026-09-20T21:01:14.000Z", completed_at: "2026-09-20T21:01:14.000Z", caption_overrides: {}, platform_options: { instagram: { share_to_feed: true }, facebook: { set_caption_for_each_image: true }, tiktok: { privacy_status: "public", allow_comment: true, allow_duet: true, allow_stitch: true, disclose_your_brand: false, disclose_branded_content: false, is_ai_generated: false, auto_add_music: true } }, error: null, pfm_post_id: "sp_7Hc2Kq9LmN3xR5t", results: [resultado(CONTA_IG, "lojacentro", "instagram", "published"), resultado(CONTA_IG_2, "lojanorte", "instagram", "published"), resultado(CONTA_TT, "lojacentro.tt", "tiktok", "failed", { error: "Vídeo fora do formato aceito pelo TikTok." })] } },
        errors: [[404, "(sem code)"]],
      },
      {
        id: "update-post", method: "PUT", path: "/posts/{post_id}", auth: "write",
        title: "Editar publicação agendada",
        summary: "Troca tudo de uma publicação que ainda está agendada: legenda, mídia, contas, horário e opções.",
        pathParams: [{ name: "post_id", type: "string", required: true, desc: "Id da publicação." }],
        body: CORPO_POST.filter((p) => p.name !== "dry_run"),
        example: { path: { post_id: ID_POST }, body: { title: "Reels da promoção (corrigido)", caption: "Promoção de sexta: tudo com 25% off! 🔥\n\n#ofertas", placement: "reels", media: [{ url: "https://data.postforme.dev/storage/v1/object/public/post-media/proj_…/a1b2c3", kind: "video" }], account_ids: [CONTA_IG, CONTA_IG_2], scheduled_at: "2026-09-20T19:00" } },
        desc: "<p>Funciona como <b>substituição completa</b>: mande a publicação inteira de novo (o que não vier volta ao padrão). Só vale enquanto <code>status</code> é <code>scheduled</code>, e <code>scheduled_at</code> é obrigatório. Para mudar só o horário, use POST /posts/{post_id}/reschedule.</p>",
        response: { status: 200, body: { id: ID_POST, status: "scheduled" } },
        errors: [[400, "(sem code)", "Publicação já em andamento, ou sem horário."]],
      },
      {
        id: "reschedule-post", method: "POST", path: "/posts/{post_id}/reschedule", auth: "write",
        title: "Mudar só o horário",
        summary: "Reagenda mantendo legenda, mídia, contas e opções.",
        pathParams: [{ name: "post_id", type: "string", required: true, desc: "Id da publicação." }],
        body: [{ name: "scheduled_at", type: "string", required: true, desc: "Novo horário (sem fuso = Bahia). Precisa estar no futuro." }],
        example: { path: { post_id: ID_POST }, body: { scheduled_at: "2026-09-21T09:30" } },
        response: { status: 200, body: { id: ID_POST, status: "scheduled" } },
      },
      {
        id: "cancel-post", method: "DELETE", path: "/posts/{post_id}", auth: "write",
        title: "Cancelar publicação agendada",
        summary: "Cancela em todas as contas. Só enquanto está agendada; depois de começar a publicar, não dá mais.",
        pathParams: [{ name: "post_id", type: "string", required: true, desc: "Id da publicação." }],
        example: { path: { post_id: ID_POST } },
        response: { status: 200, body: { ok: true } },
      },
      {
        id: "retry-post", method: "POST", path: "/posts/{post_id}/retry", auth: "write",
        headers: [H_IDEM],
        title: "Reenviar para as contas que falharam",
        summary: "Cria uma publicação nova, para agora, só com as contas que falharam (mesma legenda, mídia e opções).",
        pathParams: [{ name: "post_id", type: "string", required: true, desc: "Id da publicação original." }],
        example: { path: { post_id: ID_POST } },
        desc: "<p>Antes de reenviar, leia o <code>error</code> de cada conta em GET /posts/{post_id}: se o problema for o arquivo (formato, tamanho, proporção), corrija e crie uma publicação nova em vez de reenviar.</p>",
        response: { status: 201, body: { id: ID_POST_2, pfm_post_id: "sp_9Jd4Mn2PqR6sT8v", status: "processing", scheduled_at: null, placement: "reels", account_ids: [CONTA_TT], caption: LEGENDA, caption_overrides: {}, variations: null } },
        errors: [[400, "(sem code)", "Nenhuma conta falhou nesta publicação."]],
      },
      {
        id: "sync-post", method: "POST", path: "/posts/{post_id}/sync", auth: "write",
        title: "Conferir resultado agora",
        summary: "Busca na hora o estado da publicação e o resultado de cada conta (normalmente chega sozinho pelo webhook).",
        pathParams: [{ name: "post_id", type: "string", required: true, desc: "Id da publicação." }],
        example: { path: { post_id: ID_POST } },
        response: { status: 200, body: { status: "processed", results: 3, pending: 0 } },
      },
      {
        id: "sync-all", method: "POST", path: "/sync", auth: "write",
        title: "Conferir todas as pendentes",
        summary: "Confere até 25 publicações do time cujo horário já passou e ainda não têm resultado completo.",
        response: { status: 200, body: { checked: 2, posts: [{ id: ID_POST, status: "processed" }, { id: ID_POST_2, status: "processing" }] } },
      },
    ],
  },
  {
    id: "ref-legendas",
    title: "Legendas e variações",
    intro: "Publicar o mesmo texto em muitas contas parece repetição para as redes e para quem segue várias delas. Aqui você cria uma versão diferente para cada conta, com o mesmo sentido.",
    endpoints: [
      {
        id: "vary-captions", method: "POST", path: "/captions/vary", auth: "write",
        title: "Criar variações de uma legenda",
        summary: "Devolve N versões diferentes da legenda, mantendo números, preços, @menções, links e #hashtags.",
        body: [
          { name: "caption", type: "string", required: true, desc: "Legenda original (até 2.200 caracteres)." },
          { name: "count", type: "integer", required: true, desc: "Quantas versões (1 a 49). Para N contas, normalmente N − 1 (a primeira fica com a original)." },
          { name: "mode", type: "string", enum: ["auto", "ai", "local"], default: "auto", desc: "<code>auto</code> = IA do time se ligada, e o gerador automático completa o que faltar. <code>ai</code> = só IA (erro se não houver). <code>local</code> = só o gerador automático (grátis, instantâneo, variações mais leves)." },
        ],
        example: { body: { caption: LEGENDA, count: 3, mode: "auto" } },
        desc: "<p>Veja como funciona e como ligar a IA em <a href=\"#variacoes\">Variações de legenda</a>. Para usar direto na publicação, mande <code>vary_captions: true</code> no POST /posts.</p>",
        response: { status: 200, body: { variations: ["Sexta de promoção: 20% off em tudo na loja! 🔥 É só hoje, corre.\n\n#sexta #ofertas", "Tudo com 20% off na loja nesta sexta! 🔥 Corre que é só hoje.\n\n#ofertas #sexta", "Só hoje: 20% off em toda a loja nesta sexta! 🔥 Não deixa para depois.\n\n#ofertas #sexta"], requested: 3, source: "ai", ai_count: 3, local_count: 0, weak: 0, provider: "gemini", provider_label: "Google Gemini", model: "gemini-2.5-flash", warning: null } },
        errors: [[400, "(sem code)"], [409, "sem_ia"], [429, "limite_ia"], [429, "ia_cota"], [502, "ia_rede · ia_modelo · ia_resposta"]],
      },
      {
        id: "get-ai", method: "GET", path: "/ai", auth: "read",
        title: "Ver a IA do time",
        summary: "Se o time tem IA ligada, qual provedor e quantas gerações usou nas últimas 24 horas. A chave da IA nunca aparece inteira.",
        desc: "<p>A IA é ligada pelo dono ou admin em <b>Config → Variações de legenda com IA</b> (não pela API). Aceita Google Gemini (tem plano grátis), Groq, OpenAI, Anthropic e OpenRouter.</p>",
        response: { status: 200, body: { configured: true, provider: "gemini", provider_label: "Google Gemini", model: "gemini-2.5-flash", key_hint: "AIza…x9Qk", updated_at: "2026-09-14T13:10:00.000Z", calls_today: 12, limit_day: 150, can_edit: false } },
      },
    ],
  },
  {
    id: "ref-desempenho",
    title: "Desempenho",
    intro: "Seguidores das contas e números de cada post (visualizações, alcance, curtidas, comentários, compartilhamentos, salvamentos). Atualiza sozinho a cada 3 horas.",
    endpoints: [
      {
        id: "metrics-accounts", method: "GET", path: "/metrics/accounts", auth: "read",
        title: "Seguidores das contas",
        summary: "Seguidores hoje e quantos ganhou em 7 e 30 dias, por conta.",
        response: { status: 200, body: { data: [{ account_id: CONTA_IG, username: "lojacentro", label: "Loja Centro", platform: "instagram", followers: 12840, follows: 312, media_count: 486, followers_7d_ago: 12510, followers_30d_ago: 11020, gained_7d: 330, gained_30d: 1820, insights_ok: true, stats_synced_at: "2026-09-14T15:07:00.000Z" }], meta: { limit: 1, offset: 0, total: 1, has_more: false } } },
        desc: "<p><code>gained_7d</code>/<code>gained_30d</code> ficam <code>null</code> até existir o retrato daquele dia. <code>insights_ok: false</code> = a conta foi conectada antes da permissão de métricas: reconecte para receber visualizações e alcance.</p>",
      },
      {
        id: "metrics-posts", method: "GET", path: "/metrics/posts", auth: "read",
        title: "Números dos posts",
        summary: "Os posts mais recentes das contas (publicados pelo InstaFlow ou não) com seus números.",
        query: [
          { name: "account_id", type: "string", desc: "Só uma conta." },
          { name: "platform", type: "string", enum: ["instagram", "facebook", "tiktok", "youtube", "threads", "linkedin", "tiktok_business", "bluesky"], desc: "Só uma rede." },
          { name: "since", type: "string", desc: "Publicados a partir de (ISO 8601)." },
          { name: "post_id", type: "string", desc: "Só os posts de uma publicação do InstaFlow." },
          { name: "order", type: "string", enum: ["posted_at", "views", "reach", "likes", "comments", "shares", "saved", "total_interactions"], default: "posted_at", desc: "Ordena do maior para o menor." },
          P_LIMIT, P_OFFSET,
        ],
        example: { query: "order=views&since=2026-09-01T00:00:00Z&limit=10" },
        desc: "<p><code>nivel</code> <code>completo</code> = veio visualização/alcance; <code>basico</code> = só curtidas e comentários (conta sem a permissão de métricas).</p>",
        response: { status: 200, body: { data: [{ platform_post_id: "18043921876543210", account_id: CONTA_IG, post_id: ID_POST, social_post_id: "sp_7Hc2Kq9LmN3xR5t", platform: "instagram", product_type: "REELS", media_type: "VIDEO", permalink: "https://www.instagram.com/reel/C8xYz12AbCd/", caption: LEGENDA, thumbnail_url: "https://scontent.cdninstagram.com/…jpg", posted_at: "2026-09-20T21:01:12.000Z", views: 48210, reach: 31077, likes: 2204, comments: 97, shares: 312, saved: 188, follows: 41, profile_visits: 530, total_interactions: 2801, avg_watch_ms: 8400, total_watch_ms: 404964000, nivel: "completo", updated_at: "2026-09-21T03:07:00.000Z" }], meta: { limit: 10, offset: 0, total: 1, has_more: false } } },
      },
      {
        id: "metrics-post", method: "GET", path: "/metrics/posts/{platform_post_id}", auth: "read",
        title: "Curva de um post",
        summary: "Os números de um post e o valor no fim de cada dia (para gráfico).",
        pathParams: [{ name: "platform_post_id", type: "string", required: true, desc: "Id do post na rede (vem em <code>platform_post_id</code> dos resultados e das métricas)." }],
        example: { path: { platform_post_id: "18043921876543210" } },
        response: { status: 200, body: { platform_post_id: "18043921876543210", account_id: CONTA_IG, platform: "instagram", views: 48210, likes: 2204, comments: 97, "…": "…", daily: [{ day: "2026-09-20", views: 12033, reach: 9120, likes: 801, comments: 40, shares: 90, saved: 61, total_interactions: 992 }, { day: "2026-09-21", views: 48210, reach: 31077, likes: 2204, comments: 97, shares: 312, saved: 188, total_interactions: 2801 }] } },
      },
      {
        id: "metrics-sync", method: "POST", path: "/metrics/sync", auth: "write",
        title: "Atualizar números agora",
        summary: "Busca os números na hora (no máximo 1 vez por minuto por time).",
        response: { status: 200, body: { team_id: "c0ffee00-1234-4abc-9def-0123456789ab", contas: 12, posts: 840, completas: 10, so_basico: 2, erros: [], em: "2026-09-14T15:44:00.000Z" } },
      },
    ],
  },
  {
    id: "ref-webhooks",
    title: "Webhooks",
    intro: "Em vez de ficar perguntando se já publicou, cadastre uma URL e receba um aviso na hora. Veja <a href=\"#webhooks\">como receber e conferir a assinatura</a>.",
    endpoints: [
      {
        id: "list-webhooks", method: "GET", path: "/webhooks", auth: "read",
        title: "Listar webhooks",
        summary: "Webhooks do time, com o resultado do último aviso. O <code>secret</code> só aparece para chaves de escrita.",
        response: { status: 200, body: { data: [{ id: ID_HOOK, url: "https://meusistema.com/webhooks/instaflow", events: ["post.published", "post.failed"], active: true, description: "n8n produção", failures: 0, last_status: 200, last_error: null, last_at: "2026-09-14T15:01:12.000Z", created_at: "2026-09-12T10:00:00.000Z", secret: "whsec_3Fh8Kd2Lq9Mn4Pr7St1Vw6Xz5Yb0Cc2De" }] } },
      },
      {
        id: "create-webhook", method: "POST", path: "/webhooks", auth: "write",
        headers: [H_IDEM],
        title: "Cadastrar webhook",
        summary: "Cadastra uma URL para receber os eventos. Devolve o segredo para conferir a assinatura.",
        body: [
          { name: "url", type: "string", required: true, desc: "Endereço <b>https</b> que recebe um POST com JSON." },
          { name: "events", type: "string[]", desc: "Eventos: <code>post.published</code>, <code>post.failed</code>, <code>post.completed</code>, <code>account.updated</code>, ou <code>[\"*\"]</code> (todos, padrão)." },
          { name: "description", type: "string", desc: "Anotação livre (até 120 caracteres)." },
        ],
        example: { body: { url: "https://meusistema.com/webhooks/instaflow", events: ["post.published", "post.failed"], description: "n8n produção" } },
        response: { status: 201, body: { id: ID_HOOK, url: "https://meusistema.com/webhooks/instaflow", events: ["post.published", "post.failed"], active: true, description: "n8n produção", failures: 0, last_status: null, last_error: null, last_at: null, created_at: "2026-09-14T15:50:00.000Z", secret: "whsec_3Fh8Kd2Lq9Mn4Pr7St1Vw6Xz5Yb0Cc2De", warning: "Guarde o `secret`: é com ele que você confere a assinatura de cada aviso." } },
        errors: [[400, "(sem code)", "URL sem https, evento inválido ou já tem 10 webhooks."]],
      },
      {
        id: "update-webhook", method: "PUT", path: "/webhooks/{webhook_id}", auth: "write",
        title: "Alterar ou pausar webhook",
        summary: "Muda URL, eventos e descrição, ou pausa/ativa. Ativar de novo zera o contador de falhas.",
        pathParams: [{ name: "webhook_id", type: "string", required: true, desc: "Id do webhook." }],
        body: [
          { name: "url", type: "string", desc: "Nova URL (https)." },
          { name: "events", type: "string[]", desc: "Nova lista de eventos." },
          { name: "active", type: "boolean", desc: "<code>false</code> pausa; <code>true</code> ativa." },
          { name: "description", type: "string", desc: "Nova anotação." },
        ],
        example: { path: { webhook_id: ID_HOOK }, body: { active: false } },
        response: { status: 200, body: { id: ID_HOOK, url: "https://meusistema.com/webhooks/instaflow", events: ["post.published", "post.failed"], active: false, description: "n8n produção", failures: 0, last_status: 200, last_error: null, last_at: "2026-09-14T15:01:12.000Z", created_at: "2026-09-12T10:00:00.000Z" } },
      },
      {
        id: "delete-webhook", method: "DELETE", path: "/webhooks/{webhook_id}", auth: "write",
        title: "Apagar webhook",
        summary: "Para de mandar avisos para esta URL.",
        pathParams: [{ name: "webhook_id", type: "string", required: true, desc: "Id do webhook." }],
        example: { path: { webhook_id: ID_HOOK } },
        response: { status: 200, body: { ok: true, deleted: ID_HOOK } },
      },
      {
        id: "test-webhook", method: "POST", path: "/webhooks/{webhook_id}/test", auth: "write",
        title: "Mandar aviso de teste",
        summary: "Envia um evento <code>ping</code> agora (uma tentativa) e diz o que a sua URL respondeu.",
        pathParams: [{ name: "webhook_id", type: "string", required: true, desc: "Id do webhook." }],
        example: { path: { webhook_id: ID_HOOK } },
        response: { status: 200, body: { ok: true, status: 200, ms: 184, error: null, event_id: "evt_8f2a1c9d4e7b3a6f5c0d2e1b" } },
      },
      {
        id: "webhook-deliveries", method: "GET", path: "/webhooks/{webhook_id}/deliveries", auth: "read",
        title: "Histórico de entregas",
        summary: "Cada tentativa de aviso dos últimos 30 dias, com a resposta da sua URL.",
        pathParams: [{ name: "webhook_id", type: "string", required: true, desc: "Id do webhook." }],
        query: [P_LIMIT, P_OFFSET],
        example: { path: { webhook_id: ID_HOOK }, query: "limit=20" },
        response: { status: 200, body: { data: [{ id: 5012, event_id: "evt_5c1b0a9f8e7d6c5b4a3f2e1d", event: "post.published", attempt: 1, status: 200, ms: 211, error: null, created_at: "2026-09-20T21:01:13.000Z" }, { id: 5011, event_id: "evt_1a2b3c4d5e6f7a8b9c0d1e2f", event: "post.failed", attempt: 2, status: 500, ms: 90, error: "HTTP 500", created_at: "2026-09-20T21:01:10.000Z" }], meta: { limit: 20, offset: 0, total: 2, has_more: false } } },
      },
    ],
  },
];

export const ALL_ENDPOINTS = GROUPS.flatMap((g) => g.endpoints.map((e) => ({ ...e, group: g.id })));
