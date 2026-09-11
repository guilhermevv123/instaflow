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

import { friendlyError } from "../_shared/friendly.ts";
import { aiRemove, aiSave, aiStatus, varyCaptions } from "../_shared/ia-rotas.ts";
import { metricsCron, syncTeamManual } from "../_shared/metricas.ts";
import { listData, pfm, PfmError, pfmListAll, type PfmAccount, type PfmPost, type PfmResult, type PfmWebhook } from "../_shared/pfm.ts";
import { background, type Caller, corsHeaders, HttpError, json, readJson, requireMember, serviceClient, SUPABASE_URL, teamOf, teamTag } from "../_shared/util.ts";

// Redes que o painel sabe publicar (ids do Post for Me).
export const SUPPORTED = ["instagram", "facebook", "tiktok"] as const;
type Platform = typeof SUPPORTED[number];

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
  skip_processing?: boolean | null; // já ajustada no painel: o Post for Me não mexe
}

interface PlatformOptions {
  instagram?: { share_to_feed?: boolean; collaborators?: string[] };
  facebook?: { set_caption_for_each_image?: boolean };
  tiktok?: {
    title?: string;
    privacy_status?: "public" | "private";
    allow_comment?: boolean;
    allow_duet?: boolean;
    allow_stitch?: boolean;
    disclose_your_brand?: boolean;
    disclose_branded_content?: boolean;
    is_ai_generated?: boolean;
    auto_add_music?: boolean;
  };
}

interface PostInput {
  title?: string | null;
  caption: string;
  placement?: "timeline" | "reels" | "stories"; // vale para Instagram e Facebook
  media: MediaInput[];
  account_ids: string[];
  scheduled_at?: string | null;
  caption_overrides?: Record<string, string>;
  options?: { share_to_feed?: boolean; collaborators?: string[] }; // legado (Instagram)
  platform_options?: PlatformOptions;
}

// Aceita o formato antigo (options = Instagram) e o novo (por rede).
function normalizeOptions(input: PostInput): PlatformOptions {
  const po = input.platform_options ?? {};
  const ig = po.instagram ?? input.options ?? {};
  return {
    instagram: { share_to_feed: ig.share_to_feed, collaborators: ig.collaborators?.slice(0, 3) },
    facebook: { set_caption_for_each_image: po.facebook?.set_caption_for_each_image ?? true },
    tiktok: {
      title: po.tiktok?.title?.trim().slice(0, 85) || undefined,
      privacy_status: po.tiktok?.privacy_status === "private" ? "private" : "public",
      allow_comment: po.tiktok?.allow_comment ?? true,
      allow_duet: po.tiktok?.allow_duet ?? true,
      allow_stitch: po.tiktok?.allow_stitch ?? true,
      disclose_your_brand: po.tiktok?.disclose_your_brand ?? false,
      disclose_branded_content: po.tiktok?.disclose_branded_content ?? false,
      is_ai_generated: po.tiktok?.is_ai_generated ?? false,
      auto_add_music: po.tiktok?.auto_add_music ?? true,
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(req) });
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/functions\/v1/, "").replace(/^\/api/, "").replace(/\/+$/, "") || "/";
  const seg = path.split("/").filter(Boolean);
  const db = serviceClient();

  try {
    // O agendador (pg_cron) chama sem usuário: confere o segredo guardado em app_settings.
    if (req.method === "POST" && path === "/metrics/cron") return json(req, await metricsCron(db, req));
    const caller = await requireMember(req);

    if (req.method === "GET" && path === "/health") return json(req, await health(db, caller));
    if (req.method === "GET" && path === "/team") return json(req, await teamInfo(db, caller));
    if (req.method === "GET" && path === "/accounts/sync") return json(req, await syncAccounts(db, caller));
    if (req.method === "POST" && path === "/accounts/connect") return json(req, await connectUrl(db, caller, await readJson<{ platform?: string; reconnect?: boolean }>(req).catch(() => ({}))));
    if (req.method === "POST" && seg[0] === "accounts" && seg[2] === "disconnect") return json(req, await disconnectAccount(db, caller, seg[1]));
    if (req.method === "DELETE" && seg[0] === "accounts" && seg.length === 2) return json(req, await removeAccount(db, caller, seg[1]));
    if (req.method === "POST" && path === "/media/upload-url") return json(req, await pfm("/media/create-upload-url", { method: "POST" }));
    if (req.method === "POST" && path === "/posts") return json(req, await createPost(db, caller, await readJson<PostInput>(req)), 201);
    if (req.method === "PUT" && seg[0] === "posts" && seg.length === 2) return json(req, await updatePost(db, caller, seg[1], await readJson<PostInput>(req)));
    if (req.method === "DELETE" && seg[0] === "posts" && seg.length === 2) return json(req, await cancelPost(db, caller, seg[1]));
    if (req.method === "POST" && seg[0] === "posts" && seg[2] === "sync") return json(req, await syncPost(db, caller, seg[1]));
    if (req.method === "POST" && seg[0] === "posts" && seg[2] === "retry") return json(req, await retryPost(db, caller, seg[1]), 201);
    if (req.method === "POST" && seg[0] === "posts" && seg[2] === "reschedule") return json(req, await reschedulePost(db, caller, seg[1], await readJson<{ scheduled_at?: string }>(req)));
    if (req.method === "POST" && path === "/sync") return json(req, await syncPending(db, caller));
    if (req.method === "GET" && path === "/usage") return json(req, await usage(db, caller));
    if (req.method === "POST" && path === "/webhooks/setup") return json(req, await ensureWebhook(db, true));

    if (req.method === "GET" && path === "/ai") return json(req, await aiStatus(db, caller));
    if (req.method === "PUT" && path === "/ai") return json(req, await aiSave(db, caller, await readJson<{ key?: string }>(req)));
    if (req.method === "DELETE" && path === "/ai") return json(req, await aiRemove(db, caller));
    if (req.method === "POST" && path === "/metrics/sync") return json(req, await syncTeamManual(db, caller.teamId));
    if (req.method === "POST" && path === "/captions/vary") return json(req, await varyCaptions(db, caller, await readJson<{ caption?: string; count?: number }>(req)));

    throw new HttpError(404, `Rota não encontrada: ${req.method} ${path}`);
  } catch (e) {
    if (e instanceof HttpError) return json(req, { error: e.message, ...(e.code ? { code: e.code } : {}) }, e.status);
    if (e instanceof PfmError) {
      console.error("Post for Me:", e.status, e.message, JSON.stringify(e.body).slice(0, 500));
      return json(req, { error: `Post for Me: ${e.message}`, details: e.body }, e.status >= 500 ? 502 : e.status);
    }
    console.error(e);
    return json(req, { error: (e as Error).message ?? "Erro interno" }, 500);
  }
});

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
  return { used: Number(used ?? 0), limit: Number((plan?.value as { posts_month?: number } | null)?.posts_month) || 1000 };
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
  return { accounts: data ?? [], synced: rows.length };
}

async function connectUrl(db: Db, caller: Caller, body: { platform?: string; reconnect?: boolean }) {
  const platform = (body.platform ?? "instagram") as Platform;
  if (!(SUPPORTED as readonly string[]).includes(platform)) throw new HttpError(400, "Rede não suportada. Use instagram, facebook ou tiktok.");
  if (!body.reconnect) {
    const { count } = await db.from("accounts").select("id", { count: "exact", head: true }).eq("team_id", caller.teamId).eq("archived", false);
    if ((count ?? 0) >= caller.maxAccounts) {
      throw new HttpError(400, `Este time chegou ao limite de ${caller.maxAccounts} contas. Remova uma conta ou peça para aumentar o limite.`);
    }
  }
  // Instagram: login do próprio Instagram (sem Página do Facebook).
  // Facebook: cada Página escolhida na autorização vira uma conta.
  // TikTok: perfil pessoal/criador (Login Kit).
  const platformData = platform === "instagram"
    ? { instagram: { connection_type: "instagram" } }
    : platform === "facebook"
    ? { facebook: {} }
    : { tiktok: {} };
  const res = await pfm<{ url: string; platform: string }>("/social-accounts/auth-url", {
    method: "POST",
    body: {
      platform,
      platform_data: platformData,
      external_id: teamTag(caller.teamId),
      // "feeds" libera visualizações, alcance, compartilhamentos e salvos de cada post (Desempenho)
      permissions: ["posts", "feeds"],
    },
  });
  return { url: res.url, platform };
}

async function accountOf(db: Db, caller: Caller, id: string) {
  const { data, error } = await db.from("accounts").select("id, team_id").eq("id", id).eq("team_id", caller.teamId).maybeSingle();
  if (error) throw new HttpError(500, error.message);
  if (!data) throw new HttpError(404, "Esta conta não está no seu time.");
  return data;
}

async function disconnectAccount(db: Db, caller: Caller, id: string) {
  await accountOf(db, caller, id);
  await pfm(`/social-accounts/${encodeURIComponent(id)}/disconnect`, { method: "POST" });
  await db.from("accounts").update({ status: "disconnected" }).eq("id", id);
  return { ok: true };
}

async function removeAccount(db: Db, caller: Caller, id: string) {
  await accountOf(db, caller, id);
  const { count } = await db.from("post_targets").select("post_id", { count: "exact", head: true }).eq("account_id", id);
  try {
    await pfm(`/social-accounts/${encodeURIComponent(id)}`, { method: "DELETE" });
  } catch (e) {
    if (!(e instanceof PfmError && e.status === 404)) throw e;
  }
  if ((count ?? 0) > 0) {
    await db.from("accounts").update({ status: "disconnected", archived: true }).eq("id", id);
    return { ok: true, archived: true };
  }
  await db.from("accounts").delete().eq("id", id);
  return { ok: true, archived: false };
}

// ---------------------------------------------------------------------------
// Publicações
// ---------------------------------------------------------------------------
// Regras por rede (as do Post for Me + as das próprias redes). `platforms` são
// as redes das contas escolhidas; uma publicação pode ir para várias de uma vez.
function validatePost(input: PostInput, platforms: Set<string>) {
  const errors: string[] = [];
  const placement = input.placement ?? "timeline";
  if (!["timeline", "reels", "stories"].includes(placement)) errors.push("Tipo de post inválido.");
  const media = Array.isArray(input.media) ? input.media : [];
  for (const m of media) {
    if (!m?.url || !/^https:\/\//.test(m.url)) errors.push("Mídia com link inválido.");
    if (!["image", "video"].includes(m?.kind)) errors.push("Tipo de mídia inválido.");
  }
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
  if (platforms.has("tiktok")) {
    if (media.length === 0) errors.push("TikTok: adicione um vídeo ou de 1 a 32 fotos.");
    if (videos > 1 || (videos === 1 && images > 0)) errors.push("TikTok: ou um vídeo sozinho, ou só fotos (até 32).");
    const tt = input.platform_options?.tiktok;
    if (tt?.privacy_status && !["public", "private"].includes(tt.privacy_status)) errors.push("TikTok: privacidade inválida.");
    if (tt?.title && tt.title.trim().length > 85) errors.push("TikTok: o título tem no máximo 85 caracteres.");
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
  if (!unique.length) throw new HttpError(400, "Escolha pelo menos uma conta.");
  const { data, error } = await db.from("accounts").select("id, username, status, archived, platform").eq("team_id", caller.teamId).in("id", unique);
  if (error) throw new HttpError(500, error.message);
  const found = new Map((data ?? []).map((a) => [a.id, a]));
  const missing = unique.filter((id) => !found.has(id));
  if (missing.length) throw new HttpError(400, "Uma das contas escolhidas não está no seu time. Sincronize as contas.");
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
  if (platforms.has("tiktok")) {
    const tt = opts.tiktok ?? {};
    platform_configurations.tiktok = {
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
      skip_processing: m.skip_processing ? true : undefined,
    })),
    platform_configurations,
    account_configurations: accountConfigs.length ? accountConfigs : undefined,
    external_id: externalId,
  };
}

function cleanMedia(media: MediaInput[]): MediaInput[] {
  return media.map((m) => ({ url: m.url, kind: m.kind, thumbnail_url: m.thumbnail_url ?? null, skip_processing: m.skip_processing ? true : null }));
}

async function createPost(db: Db, caller: Caller, input: PostInput) {
  input.account_ids = [...new Set(Array.isArray(input.account_ids) ? input.account_ids : [])];
  const accs = await loadAccounts(db, caller, input.account_ids);
  const platforms = new Set(accs.map((a) => a.platform as string));
  const placement = validatePost(input, platforms);
  await checkMonthLimit(db, caller, input.account_ids.length);
  const scheduled = input.scheduled_at ? new Date(input.scheduled_at).toISOString() : null;

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
  return { id: post.id, pfm_post_id: pfmPost.id, status: pfmPost.status, scheduled_at: scheduled };
}

async function getPost(db: Db, caller: Caller, id: string) {
  const { data, error } = await db.from("posts").select("*").eq("id", id).eq("team_id", caller.teamId).maybeSingle();
  if (error) throw new HttpError(500, error.message);
  if (!data) throw new HttpError(404, "Publicação não encontrada neste time.");
  return data;
}

async function updatePost(db: Db, caller: Caller, id: string, input: PostInput) {
  const post = await getPost(db, caller, id);
  if (!["scheduled", "draft"].includes(post.status)) throw new HttpError(400, "Só dá para editar uma publicação que ainda está agendada.");
  input.account_ids = [...new Set(Array.isArray(input.account_ids) ? input.account_ids : [])];
  const accs = await loadAccounts(db, caller, input.account_ids);
  const platforms = new Set(accs.map((a) => a.platform as string));
  const placement = validatePost(input, platforms);
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
  for (const r of results) await applyResult(db, r);
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

// Aplica um resultado (de webhook ou de sync) na tabela post_targets.
export async function applyResult(db: Db, r: PfmResult) {
  const { data: post } = await db.from("posts").select("id").eq("pfm_post_id", r.post_id).maybeSingle();
  if (!post) return false;
  const row = {
    post_id: post.id,
    account_id: r.social_account_id,
    status: r.success ? "published" : "failed",
    result_id: r.id,
    permalink: r.platform_data?.url ?? null,
    platform_post_id: r.platform_data?.id ?? null,
    error: r.success ? null : friendlyError(r.error),
    details: r.success ? null : { error: r.error, details: r.details },
    published_at: r.success ? new Date().toISOString() : null,
  };
  const { error } = await db.from("post_targets").upsert(row, { onConflict: "post_id,account_id" });
  if (error) console.error("post_targets upsert", error.message);
  return true;
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
