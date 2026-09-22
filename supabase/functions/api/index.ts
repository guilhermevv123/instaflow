// InstaFlow · camada do meio entre o painel e o Post for Me.
// Guarda a chave da API, valida quem chama, resolve o time (X-Team) e espelha
// os dados no banco — sempre dentro do time de quem chamou.
//
// Rotas (todas sob /functions/v1/api):
//   GET    /health                    testa a chave do Post for Me
//   GET    /team                      time atual, papel, limites e uso do mês
//   GET    /accounts/sync             puxa as contas do time no Post for Me e devolve a lista
//   POST   /accounts/connect          gera o link "Conectar Instagram" (marcado com o time)
//   POST   /accounts/:id/disconnect   desconecta no Post for Me
//   DELETE /accounts/:id              remove (ou arquiva, se já tem histórico)
//   POST   /media/upload-url          URL assinada para subir um arquivo
//   POST   /posts                     cria/agenda uma publicação em N contas
//   PUT    /posts/:id                 edita (só enquanto agendada)
//   POST   /posts/:id/reschedule      muda só o horário (arrastar no calendário)
//   DELETE /posts/:id                 cancela (só enquanto agendada)
//   POST   /posts/:id/sync            confere status/resultados no Post for Me
//   POST   /posts/:id/retry           reenvia agora para as contas que falharam
//   POST   /sync                      confere todas as publicações pendentes do time
//   GET    /usage                     uso do mês e estado do webhook
//   POST   /webhooks/setup            registra o webhook no Post for Me (global)
//   GET    /ai                        IA do time para variar legendas (estado, nunca a chave)
//   PUT    /ai                        liga/troca a chave de IA do time (dono/admin; testa antes de salvar)
//   DELETE /ai                        desliga a IA do time (dono/admin)
//   POST   /captions/vary             N variações da legenda com a IA do time
//   POST   /metrics/sync              atualiza agora seguidores e métricas dos posts do time
//   POST   /metrics/cron              o mesmo para todos os times (pg_cron, com segredo; sem login)
//
// API pública (mesmas rotas, com `Authorization: Bearer ifk_…`; `/v1` opcional no caminho):
//   GET    /me                        quem está chamando (chave, time, limites)
//   GET    /accounts, /accounts/:id   contas do time (com uso das 24 h e seguidores)
//   GET/POST /groups, GET/PUT/DELETE /groups/:id
//   GET/POST /media, GET/DELETE /media/:id   biblioteca (POST registra um arquivo já hospedado)
//   GET    /posts, /posts/:id         publicações com o resultado em cada conta
//   GET    /metrics/accounts, /metrics/posts, /metrics/posts/:platform_post_id
//   GET/POST /keys, DELETE /keys/:id, GET /keys/:id/requests   (só pelo painel, dono/admin)
//   GET/POST /webhooks, PUT/DELETE /webhooks/:id, POST /webhooks/:id/test, GET /webhooks/:id/deliveries
// Cada chamada com chave devolve X-RateLimit-* e fica registrada em api_requests.

import * as pub from "../_shared/api-publica.ts";
import { aiRemove, aiSave, aiStatus, generateVariations, varyCaptions, VARY_MODES, type VaryMode } from "../_shared/ia-rotas.ts";
import { metricsCron, syncTeamManual } from "../_shared/metricas.ts";
import { listData, pfm, PfmError, pfmListAll, type PfmAccount, type PfmPost, type PfmResult, type PfmWebhook } from "../_shared/pfm.ts";
import { applyResult } from "../_shared/resultados.ts";
import { accountAllowed, background, type Caller, canWrite, corsHeaders, HttpError, isAdmin, json, readJson, requireMember, serviceClient, sha256Hex, SUPABASE_URL, teamOf, teamTag } from "../_shared/util.ts";
import { emit } from "../_shared/webhooks-time.ts";
import { isSupported, type Platform, SUPPORTED } from "../_shared/redes.ts";
import { lookupAccounts } from "../_shared/contas-lookup.ts";

// Redes que o painel sabe publicar (ids do Post for Me): lista única em _shared/redes.ts.
export { SUPPORTED };

const WEBHOOK_EVENTS = [
  "social.post.result.created",
  "social.post.updated",
  "social.account.created",
  "social.account.updated",
];

type Db = ReturnType<typeof serviceClient>;

interface MediaInput {
  url: string;
  kind: "image" | "video";
  thumbnail_url?: string | null;
  thumbnail_timestamp_ms?: number | null; // capa do vídeo: o quadro deste instante
  skip_processing?: boolean | null; // já ajustada no painel: o Post for Me não mexe
}

interface TikTokOptions {
  title?: string;
  privacy_status?: "public" | "private";
  allow_comment?: boolean;
  allow_duet?: boolean;
  allow_stitch?: boolean;
  disclose_your_brand?: boolean;
  disclose_branded_content?: boolean;
  is_ai_generated?: boolean;
  auto_add_music?: boolean;
}

interface PlatformOptions {
  instagram?: { share_to_feed?: boolean; collaborators?: string[] };
  facebook?: { set_caption_for_each_image?: boolean };
  tiktok?: TikTokOptions;
  tiktok_business?: TikTokOptions;
  youtube?: {
    title?: string; // até 100 caracteres; sem título, vai a primeira linha da legenda
    privacy_status?: "public" | "unlisted" | "private";
    made_for_kids?: boolean;
    tags?: string[];
    category_id?: string;
    contains_synthetic_media?: boolean;
  };
}

interface PostInput {
  title?: string | null;
  caption: string;
  placement?: "timeline" | "reels" | "stories"; // vale para Instagram e Facebook
  media: MediaInput[];
  account_ids: string[];
  group_ids?: string[];                        // API: contas dos grupos entram em account_ids
  scheduled_at?: string | null;
  caption_overrides?: Record<string, string>;
  vary_captions?: boolean | VaryMode;          // API: gera uma legenda diferente para cada conta
  dry_run?: boolean;                           // API: só confere e mostra o que seria enviado
  options?: { share_to_feed?: boolean; collaborators?: string[] }; // legado (Instagram)
  platform_options?: PlatformOptions;
  _variations?: Record<string, unknown> | null; // interno: resumo das variações geradas
}

// Deixa a entrada da API no formato do painel: contas dos grupos, mídia só com
// o link (tipo pelo nome do arquivo), horário sem fuso = horário da Bahia.
async function normalizeInput(db: Db, caller: Caller, input: PostInput): Promise<PostInput> {
  if (!input || typeof input !== "object") throw new HttpError(400, "Corpo da requisição precisa ser um objeto JSON.");
  const ids = Array.isArray(input.account_ids) ? input.account_ids.map(String) : [];
  const fromGroups = Array.isArray(input.group_ids) && input.group_ids.length ? await pub.accountsOfGroups(db, caller, input.group_ids) : [];
  input.account_ids = [...new Set([...ids, ...fromGroups])];
  const rawMedia = Array.isArray(input.media) ? input.media : [];
  input.media = await Promise.all(rawMedia.map(async (m) => {
    const url = typeof m === "string" ? m : String((m as MediaInput)?.url ?? "");
    const obj = typeof m === "string" ? ({} as MediaInput) : (m as MediaInput);
    const ts = obj.thumbnail_timestamp_ms;
    return {
      url,
      kind: await pub.detectKind(url, obj.kind),
      thumbnail_url: obj.thumbnail_url ?? null,
      thumbnail_timestamp_ms: ts === null || ts === undefined || String(ts) === "" ? null : Number(ts),
      skip_processing: obj.skip_processing ?? null,
    };
  }));
  if (typeof input.scheduled_at === "string") {
    const s = input.scheduled_at.trim();
    if (!s || s === "now") input.scheduled_at = null;
    else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(s)) input.scheduled_at = `${s}-03:00`;
  }
  input.caption = String(input.caption ?? "");
  if (input.caption_overrides !== undefined && input.caption_overrides !== null) {
    const o = input.caption_overrides;
    if (typeof o !== "object" || Array.isArray(o) || Object.values(o).some((v) => typeof v !== "string")) throw new HttpError(400, "caption_overrides precisa ser um objeto { \"id_da_conta\": \"legenda\" }.");
    const extra = Object.keys(o).filter((id) => !input.account_ids.includes(id));
    if (extra.length) throw new HttpError(400, `caption_overrides tem conta que não está em account_ids: ${extra.join(", ")}.`);
  }
  const vary = input.vary_captions;
  if (vary !== undefined && vary !== false && vary !== true && !(VARY_MODES as readonly unknown[]).includes(vary)) throw new HttpError(400, 'vary_captions precisa ser true, false, "auto", "ai" ou "local".');
  if (vary && input.account_ids.length > 1 && input.caption.trim()) {
    const overrides: Record<string, string> = { ...(input.caption_overrides ?? {}) };
    // a primeira conta fica com a legenda original; as outras sem legenda própria ganham uma versão
    const need = input.account_ids.slice(1).filter((id) => !overrides[id]?.trim());
    if (need.length) {
      const r = await generateVariations(db, caller, input.caption.trim(), need.length, vary === true ? "auto" : vary);
      need.forEach((id, i) => { if (r.variations[i]) overrides[id] = r.variations[i]; });
      input._variations = { source: r.source, generated: r.variations.length, ai_count: r.ai_count, local_count: r.local_count, weak: r.weak, provider: r.provider_label, warning: r.warning };
    }
    input.caption_overrides = overrides;
  }
  return input;
}

// Aceita o formato antigo (options = Instagram) e o novo (por rede).
function normalizeTikTok(tt: TikTokOptions | undefined): TikTokOptions {
  return {
    title: tt?.title?.trim().slice(0, 85) || undefined,
    privacy_status: tt?.privacy_status === "private" ? "private" : "public",
    allow_comment: tt?.allow_comment ?? true,
    allow_duet: tt?.allow_duet ?? true,
    allow_stitch: tt?.allow_stitch ?? true,
    disclose_your_brand: tt?.disclose_your_brand ?? false,
    disclose_branded_content: tt?.disclose_branded_content ?? false,
    is_ai_generated: tt?.is_ai_generated ?? false,
    auto_add_music: tt?.auto_add_music ?? true,
  };
}
function normalizeOptions(input: PostInput): PlatformOptions {
  const po = input.platform_options ?? {};
  const ig = po.instagram ?? input.options ?? {};
  const yt = po.youtube ?? {};
  const tags = Array.isArray(yt.tags) ? yt.tags.map((t) => String(t).trim().replace(/^#/, "")).filter(Boolean).slice(0, 30) : [];
  return {
    instagram: { share_to_feed: ig.share_to_feed, collaborators: ig.collaborators?.slice(0, 3) },
    facebook: { set_caption_for_each_image: po.facebook?.set_caption_for_each_image ?? true },
    tiktok: normalizeTikTok(po.tiktok),
    // TikTok Business usa as mesmas opções; sem nada próprio, vale o que veio para o TikTok
    tiktok_business: normalizeTikTok(po.tiktok_business ?? po.tiktok),
    youtube: {
      title: yt.title?.trim().slice(0, 100) || undefined,
      privacy_status: yt.privacy_status === "unlisted" || yt.privacy_status === "private" ? yt.privacy_status : "public",
      made_for_kids: yt.made_for_kids === true,
      tags: tags.length ? tags : undefined,
      category_id: yt.category_id ? String(yt.category_id).trim() || undefined : undefined,
      contains_synthetic_media: yt.contains_synthetic_media === true,
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(req) });
  const url = new URL(req.url);
  // /functions/v1/api/v1/posts e /functions/v1/api/posts são a mesma coisa
  const path = url.pathname.replace(/^\/functions\/v1/, "").replace(/^\/api/, "").replace(/^\/v1(?=\/|$)/, "").replace(/\/+$/, "") || "/";
  const seg = path.split("/").filter(Boolean);
  const db = serviceClient();
  const started = Date.now();
  const requestId = crypto.randomUUID();
  let caller: Caller | null = null;
  let res: Response;

  try {
    // O agendador (pg_cron) chama sem usuário: confere o segredo guardado em app_settings.
    if (req.method === "POST" && path === "/metrics/cron") return json(req, await metricsCron(db, req));
    const who = await requireMember(req);
    caller = who;
    // chave só de leitura: apenas GET
    if (req.method !== "GET" && who.via === "key" && !canWrite(who)) pub.requireWrite(who);
    const idem = req.method === "POST" ? (req.headers.get("idempotency-key") ?? "").trim() : "";
    res = idem
      ? await withIdempotency(db, who, req, path, idem, (r) => route(r, db, who, path, seg, url.searchParams))
      : await route(req, db, who, path, seg, url.searchParams);
  } catch (e) {
    res = errorResponse(req, e);
    const he = e instanceof HttpError ? e : null;
    if (!caller && he?.apiKey && he.teamId) caller = { id: null, email: "", teamId: he.teamId, teamName: "", role: "api", maxAccounts: 0, maxPostsMonth: 0, via: "key", apiKey: he.apiKey };
  }
  res.headers.set("X-Request-Id", requestId);
  if (caller?.apiKey) {
    const k = caller.apiKey;
    res.headers.set("X-RateLimit-Limit", String(k.rateLimit));
    res.headers.set("X-RateLimit-Remaining", String(Math.max(0, k.rateLimit - k.count)));
    res.headers.set("X-RateLimit-Reset", String(Math.ceil(new Date(k.reset).getTime() / 1000)));
    const ip = (req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || null;
    background(Promise.resolve(db.from("api_requests").insert({ key_id: k.id, team_id: caller.teamId, method: req.method, path: path.slice(0, 200), status: res.status, ms: Date.now() - started, ip })).then(({ error }) => { if (error) console.error("api_requests:", error.message); }));
  }
  return res;
});

// Idempotency-Key: o mesmo POST repetido com a mesma chave (dentro de 24 h, no
// mesmo time) devolve a resposta guardada em vez de fazer tudo de novo.
// Corpo diferente = 409 idempotencia_conflito; primeira ainda rodando = 409
// idempotencia_em_andamento. 5xx, 409 e 429 não ficam guardados (dá para tentar de novo).
async function withIdempotency(db: Db, caller: Caller, req: Request, path: string, key: string, run: (r: Request) => Promise<Response>): Promise<Response> {
  if (key.length > 255 || !/^[\x21-\x7e]+$/.test(key)) throw new HttpError(400, "Idempotency-Key inválida: use até 255 caracteres visíveis, sem espaço (um UUID novo por operação é o ideal).", "idempotencia_invalida");
  const raw = await req.text();
  const hash = await sha256Hex(`${req.method} ${path}\n${raw}`);
  const where = () => db.from("api_idempotency").delete().eq("team_id", caller.teamId).eq("key", key);
  const { data: old, error: selErr } = await db.from("api_idempotency").select("request_hash, status, response, created_at").eq("team_id", caller.teamId).eq("key", key).maybeSingle();
  if (selErr) throw new HttpError(500, selErr.message);
  if (old) {
    const age = Date.now() - new Date(old.created_at as string).getTime();
    const abandoned = old.status === null && age > 5 * 60_000; // a função tem no máximo 150 s
    if (age > 24 * 3600_000 || abandoned) {
      await where();
    } else {
      if (old.request_hash !== hash) throw new HttpError(409, "Esta Idempotency-Key já foi usada com outra requisição. Gere uma chave nova para cada operação.", "idempotencia_conflito");
      if (old.status === null) throw new HttpError(409, "Uma requisição com esta Idempotency-Key ainda está em andamento. Espere alguns segundos e tente de novo com a mesma chave.", "idempotencia_em_andamento");
      const replay = json(req, old.response, old.status as number);
      replay.headers.set("Idempotent-Replayed", "true");
      return replay;
    }
  }
  const { error: insErr } = await db.from("api_idempotency").insert({ team_id: caller.teamId, key, method: req.method, path: path.slice(0, 200), request_hash: hash });
  if (insErr) {
    if (insErr.code === "23505") throw new HttpError(409, "Uma requisição com esta Idempotency-Key ainda está em andamento. Espere alguns segundos e tente de novo com a mesma chave.", "idempotencia_em_andamento");
    throw new HttpError(500, insErr.message);
  }
  let res: Response;
  try {
    res = await run(new Request(req.url, { method: req.method, headers: req.headers, body: raw }));
  } catch (e) {
    res = errorResponse(req, e);
  }
  if (res.status >= 500 || res.status === 409 || res.status === 429) {
    await where();
  } else {
    const body = await res.clone().json().catch(() => null);
    const { error: upErr } = await db.from("api_idempotency").update({ status: res.status, response: body }).eq("team_id", caller.teamId).eq("key", key);
    if (upErr) console.error("api_idempotency:", upErr.message);
  }
  return res;
}

function errorResponse(req: Request, e: unknown): Response {
  if (e instanceof HttpError) return json(req, { error: e.message, ...(e.code ? { code: e.code } : {}) }, e.status);
  if (e instanceof PfmError) {
    console.error("Post for Me:", e.status, e.message, JSON.stringify(e.body).slice(0, 500));
    return json(req, { error: `Post for Me: ${e.message}`, details: e.body }, e.status >= 500 ? 502 : e.status);
  }
  console.error(e);
  return json(req, { error: (e as Error).message ?? "Erro interno" }, 500);
}

async function route(req: Request, db: Db, caller: Caller, path: string, seg: string[], q: URLSearchParams): Promise<Response> {
  const m = req.method;
  const is = (method: string, ...pattern: (string | null)[]) => m === method && seg.length === pattern.length && pattern.every((p, i) => p === null || seg[i] === p);

  if (is("GET", "health")) return json(req, await health(db, caller));
  if (is("GET", "me")) return json(req, await pub.me(db, caller));
  if (is("GET", "team")) return json(req, await teamInfo(db, caller));
  // contas
  if (is("GET", "accounts")) return json(req, await pub.listAccounts(db, caller, q));
  if (is("GET", "accounts", "sync")) return json(req, await syncAccounts(db, caller));
  if (is("POST", "accounts", "sync")) return json(req, await syncAccounts(db, caller));
  if (is("POST", "accounts", "connect")) return json(req, await connectUrl(db, caller, await readJson<{ platform?: string; reconnect?: boolean }>(req).catch(() => ({}))));
  if (is("POST", "accounts", "lookup")) return json(req, await lookupAccounts(db, caller, await readJson<{ ids?: unknown }>(req).catch(() => ({}))));
  if (is("GET", "accounts", null)) return json(req, await pub.getAccount(db, caller, seg[1]));
  if (is("POST", "accounts", null, "disconnect")) return json(req, await disconnectAccount(db, caller, seg[1]));
  if (is("DELETE", "accounts", null)) return json(req, await removeAccount(db, caller, seg[1]));
  // grupos
  if (is("GET", "groups")) return json(req, await pub.listGroups(db, caller));
  if (is("POST", "groups")) return json(req, await pub.createGroup(db, caller, await readJson(req)), 201);
  if (is("GET", "groups", null)) return json(req, await pub.getGroup(db, caller, seg[1]));
  if (is("PUT", "groups", null) || is("PATCH", "groups", null)) return json(req, await pub.updateGroup(db, caller, seg[1], await readJson(req)));
  if (is("DELETE", "groups", null)) return json(req, await pub.deleteGroup(db, caller, seg[1]));
  // biblioteca
  if (is("POST", "media", "upload-url")) { pub.requireWrite(caller); return json(req, await pfm("/media/create-upload-url", { method: "POST" })); }
  if (is("GET", "media")) return json(req, await pub.listMedia(db, caller, q));
  if (is("POST", "media")) return json(req, await pub.registerMedia(db, caller, await readJson(req)), 201);
  if (is("GET", "media", null)) return json(req, await pub.getMedia(db, caller, seg[1]));
  if (is("DELETE", "media", null)) return json(req, await pub.deleteMedia(db, caller, seg[1]));
  // publicações
  if (is("GET", "posts")) return json(req, await pub.listPosts(db, caller, q));
  if (is("POST", "posts")) {
    const input = await normalizeInput(db, caller, await readJson<PostInput>(req));
    if (q.get("dry_run") === "true") input.dry_run = true;
    const out = await createPost(db, caller, input);
    return json(req, out, "dry_run" in out ? 200 : 201);
  }
  if (is("GET", "posts", null)) return json(req, await pub.getPostFull(db, caller, seg[1]));
  if (is("PUT", "posts", null) || is("PATCH", "posts", null)) return json(req, await updatePost(db, caller, seg[1], await normalizeInput(db, caller, await readJson<PostInput>(req))));
  if (is("DELETE", "posts", null)) return json(req, await cancelPost(db, caller, seg[1]));
  if (is("POST", "posts", null, "sync")) return json(req, await syncPost(db, caller, seg[1]));
  if (is("POST", "posts", null, "retry")) return json(req, await retryPost(db, caller, seg[1]), 201);
  if (is("POST", "posts", null, "reschedule")) return json(req, await reschedulePost(db, caller, seg[1], await readJson<{ scheduled_at?: string }>(req)));
  if (is("POST", "sync")) return json(req, await syncPending(db, caller));
  if (is("GET", "usage")) return json(req, await usage(db, caller));
  // webhook do Post for Me (global) — só dono/admin no painel
  if (is("POST", "webhooks", "setup")) { if (caller.via !== "jwt") throw new HttpError(403, "O webhook do Post for Me é registrado só pelo painel.", "so_painel"); return json(req, await ensureWebhook(db, true)); }
  // webhooks do time (API pública)
  if (is("GET", "webhooks")) return json(req, await pub.listWebhooks(db, caller));
  if (is("POST", "webhooks")) return json(req, await pub.createWebhook(db, caller, await readJson(req)), 201);
  if (is("PUT", "webhooks", null) || is("PATCH", "webhooks", null)) return json(req, await pub.updateWebhook(db, caller, seg[1], await readJson(req)));
  if (is("DELETE", "webhooks", null)) return json(req, await pub.deleteWebhook(db, caller, seg[1]));
  if (is("POST", "webhooks", null, "test")) return json(req, await pub.testWebhook(db, caller, seg[1]));
  if (is("GET", "webhooks", null, "deliveries")) return json(req, await pub.webhookDeliveries(db, caller, seg[1], q));
  // chaves de API (só painel)
  if (is("GET", "keys")) return json(req, await pub.listKeys(db, caller));
  if (is("POST", "keys")) return json(req, await pub.createKey(db, caller, await readJson(req)), 201);
  if (is("DELETE", "keys", null)) return json(req, await pub.revokeKey(db, caller, seg[1]));
  if (is("GET", "keys", null, "requests")) return json(req, await pub.keyRequests(db, caller, seg[1], q));
  // IA e legendas
  if (is("GET", "ai")) return json(req, await aiStatus(db, caller));
  if (is("PUT", "ai")) return json(req, await aiSave(db, caller, await readJson<{ key?: string }>(req)));
  if (is("DELETE", "ai")) return json(req, await aiRemove(db, caller));
  if (is("POST", "captions", "vary")) return json(req, await varyCaptions(db, caller, await readJson<{ caption?: string; count?: number }>(req)));
  // desempenho
  if (is("GET", "metrics", "accounts")) return json(req, await pub.metricsAccounts(db, caller));
  if (is("GET", "metrics", "posts")) return json(req, await pub.metricsPosts(db, caller, q));
  if (is("GET", "metrics", "posts", null)) return json(req, await pub.metricsPost(db, caller, seg[2]));
  if (is("POST", "metrics", "sync")) return json(req, await syncTeamManual(db, caller.teamId));

  throw new HttpError(404, `Rota não encontrada: ${m} ${path}. Veja a documentação em /api/.`, "rota_desconhecida");
}

// ---------------------------------------------------------------------------
// Saúde, time e contas
// ---------------------------------------------------------------------------
async function health(db: Db, caller: Caller) {
  await pfm("/social-accounts", { query: { limit: "1" } }); // confere a chave
  const { count } = await db.from("accounts").select("id", { count: "exact", head: true }).eq("team_id", caller.teamId).eq("archived", false);
  return { ok: true, accounts_total: count ?? 0, team: caller.teamName };
}

async function monthUsage(db: Db, teamId: string): Promise<number> {
  const { data, error } = await db.rpc("team_month_usage", { p_team: teamId });
  if (error) throw new HttpError(500, error.message);
  return Number(data ?? 0);
}

// Plano do Post for Me: limite do mês somando todos os times (app_settings.plan.posts_month).
async function planUsage(db: Db): Promise<{ used: number; limit: number }> {
  const [{ data: used, error }, { data: plan }] = await Promise.all([
    db.rpc("plan_month_usage"),
    db.from("app_settings").select("value").eq("key", "plan").maybeSingle(),
  ]);
  if (error) throw new HttpError(500, error.message);
  return { used: Number(used ?? 0), limit: Number((plan?.value as { posts_month?: number } | null)?.posts_month) || 2500 };
}

async function teamInfo(db: Db, caller: Caller) {
  const [{ count }, used] = await Promise.all([
    db.from("accounts").select("id", { count: "exact", head: true }).eq("team_id", caller.teamId).eq("archived", false),
    monthUsage(db, caller.teamId),
  ]);
  return {
    id: caller.teamId,
    name: caller.teamName,
    role: caller.role,
    accounts: count ?? 0,
    max_accounts: caller.maxAccounts,
    month_used: used,
    max_posts_month: caller.maxPostsMonth,
  };
}

function accountRow(a: PfmAccount, teamId: string) {
  return {
    id: a.id,
    team_id: teamId,
    platform: a.platform,
    username: a.username,
    user_id: a.user_id,
    profile_photo_url: a.profile_photo_url,
    status: a.status,
    external_id: a.external_id,
    access_token_expires_at: a.access_token_expires_at || null,
    metadata: a.metadata ?? null,
    synced_at: new Date().toISOString(),
  };
}

// Todas as contas do Post for Me são do mesmo projeto; só entram as do time:
// as que já estão nele ou as marcadas com o external_id do time.
async function syncAccounts(db: Db, caller: Caller) {
  const all = (await pfmListAll<PfmAccount>("/social-accounts")).filter((a) => (SUPPORTED as readonly string[]).includes(a.platform));
  const { data: mine } = await db.from("accounts").select("id").eq("team_id", caller.teamId);
  const mineIds = new Set((mine ?? []).map((a) => a.id));
  const ours = all.filter((a) => mineIds.has(a.id) || teamOf(a.external_id) === caller.teamId);
  const rows = ours.map((a) => accountRow(a, caller.teamId));
  if (rows.length) {
    const { error } = await db.from("accounts").upsert(rows, { onConflict: "id" });
    if (error) throw new HttpError(500, error.message);
  }
  // contas do time que sumiram do Post for Me ficam como desconectadas
  let q = db.from("accounts").update({ status: "disconnected" }).eq("team_id", caller.teamId).eq("status", "connected");
  if (rows.length) q = q.not("id", "in", `(${rows.map((r) => `"${r.id}"`).join(",")})`);
  await q;
  background(ensureWebhook(db, false).catch((e) => console.error("webhook", e)));
  const { data } = await db.from("accounts").select("*").eq("team_id", caller.teamId).order("username");
  return { accounts: (data ?? []).filter((a) => accountAllowed(caller, a.id as string)), synced: rows.length };
}

async function connectUrl(db: Db, caller: Caller, body: { platform?: string; reconnect?: boolean; account_id?: string }) {
  let platform = (body.platform ?? "instagram") as Platform;
  let externalId: string | null = null;
  const accountId = typeof body.account_id === "string" && body.account_id.trim() ? body.account_id.trim() : null;
  if (accountId) {
    // Reconectar (ou pedir permissões de novo para) uma conta que já existe: o Post for Me
    // só aceita se a autorização levar o MESMO external_id que ela já tem; com outro,
    // recusa com "External Id already exists for account …". Sem external_id, ganha a marca do time.
    const acc = await accountOf(db, caller, accountId);
    platform = acc.platform as Platform;
    const atual = await pfm<PfmAccount>(`/social-accounts/${encodeURIComponent(accountId)}`).catch(() => null);
    externalId = atual?.external_id || acc.external_id || null;
  } else if (caller.apiKey?.accountIds) {
    throw new HttpError(403, "Esta chave está presa a algumas contas e não pode conectar contas novas.", "conta_bloqueada");
  }
  if (!isSupported(platform)) throw new HttpError(400, `Rede não suportada. Use uma destas: ${SUPPORTED.join(", ")}.`);
  // limite de contas só quando o time tem um (nulo = sem limite)
  if (!accountId && !body.reconnect && caller.maxAccounts !== null) {
    const { count } = await db.from("accounts").select("id", { count: "exact", head: true }).eq("team_id", caller.teamId).eq("archived", false);
    if ((count ?? 0) >= caller.maxAccounts) {
      throw new HttpError(400, `Este time chegou ao limite de ${caller.maxAccounts} contas. Remova uma conta ou peça para aumentar o limite.`);
    }
  }
  // Instagram: login do próprio Instagram (sem Página do Facebook). Facebook e LinkedIn: cada
  // Página escolhida vira uma conta (no LinkedIn, com as credenciais do Post for Me, só páginas
  // de empresa). Bluesky não tem tela de login: vai o usuário e uma senha de app, que o Post for
  // Me confere e guarda do lado dele (nada disso fica no InstaFlow).
  let platformData: Record<string, unknown> = { [platform]: {} };
  if (platform === "instagram") platformData = { instagram: { connection_type: "instagram" } };
  if (platform === "linkedin") platformData = { linkedin: { connection_type: "organization" } };
  // TikTok: o número de seguidores precisa de user.info.stats, que o Post for Me não pede sozinho
  // (a lista substitui a padrão, então vão também as permissões de sempre)
  if (platform === "tiktok" && (body as { seguidores?: unknown }).seguidores === true) {
    platformData = { tiktok: { permission_overrides: ["user.info.basic", "user.info.stats", "video.list", "video.upload", "video.publish"] } };
  }
  if (platform === "bluesky") {
    const bs = (body as { bluesky?: { handle?: unknown; app_password?: unknown } }).bluesky;
    const handle = String(bs?.handle ?? "").trim().replace(/^@/, "");
    const appPassword = String(bs?.app_password ?? "").trim();
    if (!handle || !appPassword) throw new HttpError(400, "Bluesky: mande bluesky.handle (ex.: loja.bsky.social) e bluesky.app_password (uma senha de app criada nas configurações do Bluesky, não a senha da conta).");
    platformData = { bluesky: { handle: handle.includes(".") ? handle : `${handle}.bsky.social`, app_password: appPassword } };
  }
  const res = await pfm<{ url: string; platform: string }>("/social-accounts/auth-url", {
    method: "POST",
    body: {
      platform,
      platform_data: platformData,
      external_id: externalId || teamTag(caller.teamId),
      // "feeds" libera visualizações, alcance, compartilhamentos e salvos de cada post (Desempenho)
      permissions: ["posts", "feeds"],
    },
  });
  return accountId ? { url: res.url, platform, account_id: accountId } : { url: res.url, platform };
}

async function accountOf(db: Db, caller: Caller, id: string) {
  const { data, error } = await db.from("accounts").select("id, team_id, platform, username, external_id").eq("id", id).eq("team_id", caller.teamId).maybeSingle();
  if (error) throw new HttpError(500, error.message);
  if (!data || !accountAllowed(caller, id)) throw new HttpError(404, "Esta conta não está no seu time.");
  return data;
}

async function disconnectAccount(db: Db, caller: Caller, id: string) {
  const acc = await accountOf(db, caller, id);
  await pfm(`/social-accounts/${encodeURIComponent(id)}/disconnect`, { method: "POST" });
  await db.from("accounts").update({ status: "disconnected" }).eq("id", id);
  background(emit(db, caller.teamId, "account.updated", { account_id: id, platform: acc.platform, username: acc.username, status: "disconnected" }).catch((e) => console.error("webhooks", e)));
  return { ok: true };
}

async function removeAccount(db: Db, caller: Caller, id: string) {
  const acc = await accountOf(db, caller, id);
  const { count } = await db.from("post_targets").select("post_id", { count: "exact", head: true }).eq("account_id", id);
  try {
    await pfm(`/social-accounts/${encodeURIComponent(id)}`, { method: "DELETE" });
  } catch (e) {
    if (!(e instanceof PfmError && e.status === 404)) throw e;
  }
  const archived = (count ?? 0) > 0;
  if (archived) await db.from("accounts").update({ status: "disconnected", archived: true }).eq("id", id);
  else await db.from("accounts").delete().eq("id", id);
  background(emit(db, caller.teamId, "account.updated", { account_id: id, platform: acc.platform, username: acc.username, status: "disconnected", removed: true, archived }).catch((e) => console.error("webhooks", e)));
  return { ok: true, archived };
}

// ---------------------------------------------------------------------------
// Publicações
// ---------------------------------------------------------------------------
// Regras por rede (as do Post for Me + as das próprias redes). `platforms` são
// as redes das contas escolhidas; uma publicação pode ir para várias de uma vez.
// Limite de texto por rede: o Post for Me corta o que passa sem avisar, então aqui vira erro.
const LIMITE_TEXTO: Record<string, [number, string]> = { threads: [500, "Threads"], bluesky: [300, "Bluesky"] };

function validatePost(input: PostInput, platforms: Set<string>, accs: { id: string; platform: string }[] = []) {
  const errors: string[] = [];
  const placement = input.placement ?? "timeline";
  if (!["timeline", "reels", "stories"].includes(placement)) errors.push("Tipo de post inválido.");
  const media = Array.isArray(input.media) ? input.media : [];
  media.forEach((m, i) => {
    const n = media.length > 1 ? `Mídia ${i + 1}: ` : "Mídia: ";
    if (!m?.url || !/^https:\/\//.test(m.url)) errors.push(`${n}link inválido (precisa ser um link público começando com https://).`);
    if (!["image", "video"].includes(m?.kind)) errors.push(`${n}tipo inválido (use "image" ou "video").`);
    if (m?.thumbnail_url && !/^https:\/\//.test(m.thumbnail_url)) errors.push(`${n}a capa (thumbnail_url) precisa ser um link https.`);
    if (m?.thumbnail_timestamp_ms !== null && m?.thumbnail_timestamp_ms !== undefined && !(Number.isFinite(m.thumbnail_timestamp_ms) && m.thumbnail_timestamp_ms >= 0)) errors.push(`${n}thumbnail_timestamp_ms precisa ser um número de milissegundos (0 ou mais).`);
    if (m?.kind === "image" && (m.thumbnail_url || (m.thumbnail_timestamp_ms !== null && m.thumbnail_timestamp_ms !== undefined))) errors.push(`${n}capa (thumbnail_url/thumbnail_timestamp_ms) só vale para vídeo.`);
  });
  const videos = media.filter((m) => m.kind === "video").length;
  const images = media.length - videos;
  const caption = input.caption?.trim() ?? "";
  if (media.length > 32) errors.push("Máximo de 32 itens por publicação.");
  if (caption.length > 2200) errors.push("A legenda tem no máximo 2.200 caracteres.");
  if (!caption && placement !== "stories" && !(platforms.size === 1 && platforms.has("facebook") && media.length > 0)) errors.push("Escreva uma legenda.");

  if (platforms.has("instagram")) {
    if (media.length === 0) errors.push("Instagram: adicione pelo menos uma foto ou vídeo.");
    if (media.length > 10) errors.push("Instagram: o carrossel aceita no máximo 10 itens.");
    if (placement === "reels" && (media.length !== 1 || videos !== 1)) errors.push("Instagram: Reels precisa de exatamente um vídeo.");
  }
  if (platforms.has("facebook")) {
    if (media.length === 0 && !caption) errors.push("Facebook: escreva um texto ou adicione mídia.");
    if (media.length > 1 && videos > 0) errors.push("Facebook: o carrossel só aceita fotos (vídeos ficariam de fora).");
    if (placement === "reels" && (media.length !== 1 || videos !== 1)) errors.push("Facebook: Reels precisa de exatamente um vídeo.");
    if (placement === "stories" && media.length !== 1) errors.push("Facebook: Stories aceita uma foto ou um vídeo por publicação.");
  }
  for (const [rede, nome] of [["tiktok", "TikTok"], ["tiktok_business", "TikTok Business"]] as const) {
    if (!platforms.has(rede)) continue;
    if (media.length === 0) errors.push(`${nome}: adicione um vídeo ou de 1 a 32 fotos.`);
    if (videos > 1 || (videos === 1 && images > 0)) errors.push(`${nome}: ou um vídeo sozinho, ou só fotos (até 32).`);
    const tt = input.platform_options?.[rede] ?? input.platform_options?.tiktok;
    if (tt?.privacy_status && !["public", "private"].includes(tt.privacy_status)) errors.push(`${nome}: privacidade inválida.`);
    if (tt?.title && tt.title.trim().length > 85) errors.push(`${nome}: o título tem no máximo 85 caracteres.`);
  }
  if (platforms.has("youtube")) {
    if (media.length !== 1 || videos !== 1) errors.push("YouTube: publique exatamente um vídeo (fotos não entram no YouTube).");
    const yt = input.platform_options?.youtube;
    if (yt?.privacy_status && !["public", "unlisted", "private"].includes(yt.privacy_status)) errors.push("YouTube: privacidade inválida (use public, unlisted ou private).");
    if (yt?.title && yt.title.trim().length > 100) errors.push("YouTube: o título tem no máximo 100 caracteres.");
    if (yt?.tags !== undefined && (!Array.isArray(yt.tags) || yt.tags.join(",").length > 500)) errors.push("YouTube: tags precisam ser uma lista com até 500 caracteres somando todas.");
  }
  if (platforms.has("threads") && media.length > 4) errors.push("Threads: no máximo 4 fotos ou vídeos por post.");
  if (platforms.has("linkedin")) {
    if (videos > 1 || (videos === 1 && images > 0)) errors.push("LinkedIn: ou um vídeo sozinho, ou só fotos (até 20).");
    if (images > 20) errors.push("LinkedIn: no máximo 20 fotos por post.");
  }
  if (platforms.has("bluesky")) {
    if (videos > 1 || (videos === 1 && images > 0)) errors.push("Bluesky: ou um vídeo sozinho, ou só fotos (até 4).");
    if (images > 4) errors.push("Bluesky: no máximo 4 fotos por post.");
  }
  // o texto de cada conta (a legenda própria dela, se tiver) cabe no limite da rede
  const overrides = input.caption_overrides ?? {};
  for (const [rede, [max, nome]] of Object.entries(LIMITE_TEXTO)) {
    if (!platforms.has(rede)) continue;
    const contas = accs.filter((a) => a.platform === rede);
    const textos = contas.length ? contas.map((a) => overrides[a.id]?.trim() || caption) : [caption];
    const acima = textos.filter((t) => t.length > max).length;
    if (acima) errors.push(`${nome}: o texto tem no máximo ${max} caracteres e ${acima === 1 ? "uma conta ficaria acima" : `${acima} contas ficariam acima`}. Encurte a legenda ou dê uma legenda própria para ${acima === 1 ? "essa conta" : "essas contas"}.`);
  }
  if (input.scheduled_at) {
    const ts = Date.parse(input.scheduled_at);
    if (Number.isNaN(ts)) errors.push("Data e hora inválidas.");
    else if (ts < Date.now() - 60_000) errors.push("A data e hora precisam estar no futuro.");
  }
  if (errors.length) throw new HttpError(400, errors.join(" "));
  return placement as "timeline" | "reels" | "stories";
}

async function loadAccounts(db: Db, caller: Caller, ids: string[]) {
  const unique = [...new Set(ids)];
  if (!unique.length) throw new HttpError(400, "Escolha pelo menos uma conta (account_ids ou group_ids).");
  const blocked = unique.filter((id) => !accountAllowed(caller, id));
  if (blocked.length) throw new HttpError(403, `Esta chave não tem acesso à conta ${blocked.join(", ")}.`, "conta_bloqueada");
  const { data, error } = await db.from("accounts").select("id, username, status, archived, platform").eq("team_id", caller.teamId).in("id", unique);
  if (error) throw new HttpError(500, error.message);
  const found = new Map((data ?? []).map((a) => [a.id, a]));
  const missing = unique.filter((id) => !found.has(id));
  if (missing.length) throw new HttpError(400, `Conta não encontrada neste time: ${missing.join(", ")}. Veja GET /accounts ou sincronize as contas.`, "conta_desconhecida");
  const off = (data ?? []).filter((a) => a.status !== "connected" || a.archived).map((a) => "@" + (a.username ?? a.id));
  if (off.length) throw new HttpError(400, `Estas contas precisam ser reconectadas antes: ${off.join(", ")}.`);
  return data ?? [];
}

async function checkMonthLimit(db: Db, caller: Caller, adding: number) {
  const [used, plan] = await Promise.all([monthUsage(db, caller.teamId), planUsage(db)]);
  if (used + adding > caller.maxPostsMonth) {
    throw new HttpError(400, `Limite do mês do time: ${caller.maxPostsMonth} publicações (conta a conta). Já usadas ou agendadas: ${used}. Esta publicação precisaria de mais ${adding}.`);
  }
  if (plan.used + adding > plan.limit) {
    throw new HttpError(400, `O plano do Post for Me permite ${plan.limit} publicações por mês (conta a conta, somando todos os times). Já usadas ou agendadas: ${plan.used}. Esta publicação precisaria de mais ${adding}.`);
  }
}

function buildPfmBody(input: PostInput, placement: string, externalId: string, platforms: Set<string>) {
  const caption = input.caption?.trim() || " ";
  const overrides = input.caption_overrides ?? {};
  const opts = normalizeOptions(input);
  const platform_configurations: Record<string, unknown> = {};
  if (platforms.has("instagram")) {
    const instagram: Record<string, unknown> = { placement };
    if (placement !== "stories") {
      if (typeof opts.instagram?.share_to_feed === "boolean") instagram.share_to_feed = opts.instagram.share_to_feed;
      if (opts.instagram?.collaborators?.length) instagram.collaborators = opts.instagram.collaborators;
    }
    platform_configurations.instagram = instagram;
  }
  if (platforms.has("facebook")) {
    platform_configurations.facebook = { placement, set_caption_for_each_image: opts.facebook?.set_caption_for_each_image ?? true };
  }
  for (const rede of ["tiktok", "tiktok_business"] as const) {
    if (!platforms.has(rede)) continue;
    const tt = opts[rede] ?? {};
    platform_configurations[rede] = {
      title: (tt.title || caption).slice(0, 85),
      privacy_status: tt.privacy_status ?? "public",
      allow_comment: tt.allow_comment ?? true,
      allow_duet: tt.allow_duet ?? true,
      allow_stitch: tt.allow_stitch ?? true,
      disclose_your_brand: tt.disclose_your_brand ?? false,
      disclose_branded_content: tt.disclose_branded_content ?? false,
      is_ai_generated: tt.is_ai_generated ?? false,
      auto_add_music: tt.auto_add_music ?? true,
    };
  }
  if (platforms.has("youtube")) {
    const yt = opts.youtube ?? {};
    // sem título próprio, vai a primeira linha da legenda (a descrição do vídeo é a legenda inteira)
    const primeiraLinha = caption.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
    platform_configurations.youtube = {
      title: (yt.title || primeiraLinha || input.title?.trim() || "Vídeo").slice(0, 100),
      privacy_status: yt.privacy_status ?? "public",
      made_for_kids: yt.made_for_kids ?? false,
      ...(yt.tags?.length ? { tags: yt.tags } : {}),
      ...(yt.category_id ? { category_id: yt.category_id } : {}),
      ...(yt.contains_synthetic_media ? { contains_synthetic_media: true } : {}),
    };
  }
  // Threads não tem Reels: vídeo sozinho sai como vídeo no feed
  if (platforms.has("threads")) platform_configurations.threads = { placement: "timeline" };
  const accountConfigs = input.account_ids
    .filter((id) => overrides[id]?.trim() && overrides[id].trim() !== caption)
    .map((id) => ({ social_account_id: id, configuration: { caption: overrides[id].trim() } }));
  return {
    caption,
    scheduled_at: input.scheduled_at || null,
    social_accounts: [...new Set(input.account_ids)],
    media: input.media.map((m) => ({
      url: m.url,
      thumbnail_url: m.thumbnail_url || undefined,
      thumbnail_timestamp_ms: m.thumbnail_timestamp_ms ?? undefined,
      skip_processing: m.skip_processing ? true : undefined,
    })),
    platform_configurations,
    account_configurations: accountConfigs.length ? accountConfigs : undefined,
    external_id: externalId,
  };
}

function cleanMedia(media: MediaInput[]): MediaInput[] {
  return media.map((m) => ({ url: m.url, kind: m.kind, thumbnail_url: m.thumbnail_url ?? null, ...(m.thumbnail_timestamp_ms !== null && m.thumbnail_timestamp_ms !== undefined ? { thumbnail_timestamp_ms: m.thumbnail_timestamp_ms } : {}), skip_processing: m.skip_processing ? true : null }));
}

async function createPost(db: Db, caller: Caller, input: PostInput) {
  input.account_ids = [...new Set(Array.isArray(input.account_ids) ? input.account_ids : [])];
  const accs = await loadAccounts(db, caller, input.account_ids);
  const platforms = new Set(accs.map((a) => a.platform as string));
  const placement = validatePost(input, platforms, accs);
  await checkMonthLimit(db, caller, input.account_ids.length);
  const scheduled = input.scheduled_at ? new Date(input.scheduled_at).toISOString() : null;
  // teste sem publicar: passou por todas as regras; mostra o que iria para o Post for Me
  if (input.dry_run) {
    return {
      dry_run: true as const, valid: true, placement, scheduled_at: scheduled, account_ids: input.account_ids, platforms: [...platforms],
      caption: input.caption?.trim() ?? "", caption_overrides: input.caption_overrides ?? {}, variations: input._variations ?? null,
      request: buildPfmBody({ ...input, scheduled_at: scheduled }, placement, "dry_run", platforms),
    };
  }

  const { data: post, error } = await db.from("posts").insert({
    team_id: caller.teamId,
    title: input.title?.trim() || null,
    caption: input.caption?.trim() || "",
    placement,
    media: cleanMedia(input.media),
    options: normalizeOptions(input),
    caption_overrides: input.caption_overrides ?? {},
    scheduled_at: scheduled,
    status: scheduled ? "scheduled" : "processing",
    created_by: caller.id,
  }).select("*").single();
  if (error || !post) throw new HttpError(500, error?.message ?? "Não consegui salvar a publicação.");

  let pfmPost: PfmPost;
  try {
    pfmPost = await pfm<PfmPost>("/social-posts", { method: "POST", body: buildPfmBody({ ...input, scheduled_at: scheduled }, placement, post.id, platforms) });
  } catch (e) {
    await db.from("posts").delete().eq("id", post.id);
    throw e;
  }

  await db.from("posts").update({ pfm_post_id: pfmPost.id, status: pfmPost.status }).eq("id", post.id);
  await db.from("post_targets").insert(input.account_ids.map((account_id) => ({ post_id: post.id, account_id, status: "pending" })));
  return {
    id: post.id, pfm_post_id: pfmPost.id, status: pfmPost.status, scheduled_at: scheduled, placement,
    account_ids: input.account_ids, caption: post.caption, caption_overrides: input.caption_overrides ?? {}, variations: input._variations ?? null,
  };
}

async function getPost(db: Db, caller: Caller, id: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new HttpError(404, "Publicação não encontrada.");
  const { data, error } = await db.from("posts").select("*").eq("id", id).eq("team_id", caller.teamId).maybeSingle();
  if (error) throw new HttpError(500, error.message);
  if (!data) throw new HttpError(404, "Publicação não encontrada neste time.");
  // chave presa a algumas contas: só mexe em publicações que vão apenas para elas
  if (caller.apiKey?.accountIds) {
    const { data: targets } = await db.from("post_targets").select("account_id").eq("post_id", id);
    if (!(targets ?? []).length || (targets ?? []).some((t) => !accountAllowed(caller, t.account_id as string))) throw new HttpError(404, "Publicação não encontrada nas contas desta chave.");
  }
  return data;
}

async function updatePost(db: Db, caller: Caller, id: string, input: PostInput) {
  const post = await getPost(db, caller, id);
  if (!["scheduled", "draft"].includes(post.status)) throw new HttpError(400, "Só dá para editar uma publicação que ainda está agendada.");
  input.account_ids = [...new Set(Array.isArray(input.account_ids) ? input.account_ids : [])];
  const accs = await loadAccounts(db, caller, input.account_ids);
  const platforms = new Set(accs.map((a) => a.platform as string));
  const placement = validatePost(input, platforms, accs);
  const scheduled = input.scheduled_at ? new Date(input.scheduled_at).toISOString() : null;
  if (!scheduled) throw new HttpError(400, "Para publicar agora, cancele esta e crie uma nova publicação.");
  const { count: before } = await db.from("post_targets").select("post_id", { count: "exact", head: true }).eq("post_id", id);
  if (input.account_ids.length > (before ?? 0)) await checkMonthLimit(db, caller, input.account_ids.length - (before ?? 0));

  const pfmPost = await pfm<PfmPost>(`/social-posts/${encodeURIComponent(post.pfm_post_id)}`, {
    method: "PUT",
    body: buildPfmBody({ ...input, scheduled_at: scheduled }, placement, post.id, platforms),
  });
  await db.from("posts").update({
    title: input.title?.trim() || null,
    caption: input.caption?.trim() || "",
    placement,
    media: cleanMedia(input.media),
    options: normalizeOptions(input),
    caption_overrides: input.caption_overrides ?? {},
    scheduled_at: scheduled,
    status: pfmPost.status,
  }).eq("id", id);
  await db.from("post_targets").delete().eq("post_id", id);
  await db.from("post_targets").insert(input.account_ids.map((account_id) => ({ post_id: id, account_id, status: "pending" })));
  return { id, status: pfmPost.status };
}

// Muda só o horário (arrastar no calendário): reenvia ao Post for Me o que já
// está salvo (legenda, mídia, contas e opções), com a nova data.
async function reschedulePost(db: Db, caller: Caller, id: string, body: { scheduled_at?: string }) {
  if (!body?.scheduled_at) throw new HttpError(400, "Informe o novo horário.");
  const post = await getPost(db, caller, id);
  const { data: targets, error } = await db.from("post_targets").select("account_id").eq("post_id", id);
  if (error) throw new HttpError(500, error.message);
  return updatePost(db, caller, id, {
    title: post.title,
    caption: post.caption ?? "",
    placement: post.placement,
    media: Array.isArray(post.media) ? post.media : [],
    account_ids: (targets ?? []).map((t) => t.account_id),
    scheduled_at: body.scheduled_at,
    caption_overrides: post.caption_overrides ?? {},
    platform_options: (post.options ?? {}) as PlatformOptions,
  });
}

async function cancelPost(db: Db, caller: Caller, id: string) {
  const post = await getPost(db, caller, id);
  if (!["scheduled", "draft"].includes(post.status)) throw new HttpError(400, "Esta publicação já está em andamento e não pode mais ser cancelada.");
  if (post.pfm_post_id) {
    try {
      await pfm(`/social-posts/${encodeURIComponent(post.pfm_post_id)}`, { method: "DELETE" });
    } catch (e) {
      if (!(e instanceof PfmError && e.status === 404)) throw e;
    }
  }
  await db.from("posts").update({ status: "canceled" }).eq("id", id);
  await db.from("post_targets").delete().eq("post_id", id);
  return { ok: true };
}

// Confere no Post for Me o status do post e o resultado em cada conta.
async function syncPost(db: Db, caller: Caller, id: string) {
  const post = await getPost(db, caller, id);
  if (!post.pfm_post_id) return { status: post.status, results: 0 };
  const remote = await pfm<PfmPost>(`/social-posts/${encodeURIComponent(post.pfm_post_id)}`);
  const results = await pfmListAll<PfmResult>("/social-post-results", { post_id: post.pfm_post_id });
  for (const r of results) await applyResult(db, r as PfmResult);
  const { data: targets } = await db.from("post_targets").select("status").eq("post_id", id);
  const pending = (targets ?? []).filter((t) => t.status === "pending").length;
  const status = remote.status === "processed" && pending > 0 && results.length === 0 ? "processed" : remote.status;
  await db.from("posts").update({ status }).eq("id", id);
  return { status, results: results.length, pending };
}

async function syncPending(db: Db, caller: Caller) {
  const { data } = await db.from("posts")
    .select("id, scheduled_at")
    .eq("team_id", caller.teamId)
    .in("status", ["scheduled", "processing"])
    .or(`scheduled_at.is.null,scheduled_at.lte.${new Date().toISOString()}`)
    .order("scheduled_at", { ascending: true })
    .limit(25);
  const out: Array<{ id: string; status: string }> = [];
  for (const p of data ?? []) {
    try {
      const r = await syncPost(db, caller, p.id);
      out.push({ id: p.id, status: r.status });
    } catch (e) {
      console.error("sync", p.id, (e as Error).message);
    }
  }
  return { checked: out.length, posts: out };
}

async function retryPost(db: Db, caller: Caller, id: string) {
  const post = await getPost(db, caller, id);
  const { data: failed } = await db.from("post_targets").select("account_id").eq("post_id", id).eq("status", "failed");
  const ids = (failed ?? []).map((t) => t.account_id);
  if (!ids.length) throw new HttpError(400, "Nenhuma conta falhou nesta publicação.");
  return createPost(db, caller, {
    title: post.title ? `${post.title} (reenvio)` : "Reenvio",
    caption: post.caption,
    placement: post.placement,
    media: post.media,
    account_ids: ids,
    scheduled_at: null,
    caption_overrides: post.caption_overrides,
    platform_options: post.options,
  });
}

// ---------------------------------------------------------------------------
// Uso e webhook
// ---------------------------------------------------------------------------
async function usage(db: Db, caller: Caller) {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  const [{ count }, reserved, { data: wh }, { data: last }, plan] = await Promise.all([
    db.from("post_targets").select("post_id, posts!inner(team_id)", { count: "exact", head: true })
      .eq("posts.team_id", caller.teamId).eq("status", "published").gte("published_at", start.toISOString()),
    monthUsage(db, caller.teamId),
    db.from("app_settings").select("value, updated_at").eq("key", "pfm_webhook").maybeSingle(),
    db.from("webhook_events").select("received_at, event_type").order("id", { ascending: false }).limit(1).maybeSingle(),
    planUsage(db),
  ]);
  return {
    team: { id: caller.teamId, name: caller.teamName, role: caller.role, max_accounts: caller.maxAccounts },
    month_published: count ?? 0,
    month_reserved: reserved,
    month_limit: caller.maxPostsMonth,
    plan_used: plan.used,
    plan_limit: plan.limit,
    webhook: wh ? { id: (wh.value as { id: string }).id, url: (wh.value as { url: string }).url, since: wh.updated_at } : null,
    last_event: last ?? null,
  };
}

async function ensureWebhook(db: Db, force: boolean) {
  const target = `${SUPABASE_URL}/functions/v1/pfm-webhook`;
  const { data: saved } = await db.from("app_settings").select("value").eq("key", "pfm_webhook").maybeSingle();
  if (saved && !force) return { ok: true, webhook: saved.value, created: false };

  const existing = listData<PfmWebhook>(await pfm("/webhooks", { query: { limit: "50" } }));
  let hook = existing.find((w) => w.url === target);
  let created = false;
  if (!hook) {
    hook = await pfm<PfmWebhook>("/webhooks", { method: "POST", body: { url: target, event_types: WEBHOOK_EVENTS } });
    created = true;
  } else if (WEBHOOK_EVENTS.some((e) => !hook!.event_types?.includes(e))) {
    hook = await pfm<PfmWebhook>(`/webhooks/${encodeURIComponent(hook.id)}`, { method: "PATCH", body: { event_types: WEBHOOK_EVENTS } });
  }
  await db.from("app_settings").upsert({
    key: "pfm_webhook",
    value: { id: hook.id, url: hook.url, secret: hook.secret, event_types: hook.event_types },
    updated_at: new Date().toISOString(),
  });
  return { ok: true, webhook: { id: hook.id, url: hook.url, event_types: hook.event_types }, created };
}
