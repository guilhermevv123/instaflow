// InstaFlow · API pública: leituras que o painel fazia direto no banco,
// grupos, biblioteca, desempenho, chaves de API e webhooks do time.
// Tudo aqui recebe o `caller` já resolvido (painel ou chave ifk_…) e respeita
// a restrição de contas da chave, quando houver.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { accountAllowed, type Caller, canWrite, HttpError, isAdmin, randomToken, sha256Hex } from "./util.ts";
import { deliver, makePayload, WEBHOOK_EVENTS, type TeamWebhook } from "./webhooks-time.ts";

type Db = SupabaseClient;
type Row = Record<string, unknown>;
const OFF_BAHIA = 3 * 3600_000;

// ---------------------------------------------------------------- utilidades
export function paging(q: URLSearchParams, maxLimit = 100) {
  const limit = Math.min(maxLimit, Math.max(1, Math.floor(Number(q.get("limit")) || 25)));
  const offset = Math.max(0, Math.floor(Number(q.get("offset")) || 0));
  return { limit, offset };
}
const meta = (limit: number, offset: number, total: number | null) => ({ limit, offset, total: total ?? 0, has_more: total !== null && offset + limit < total });

export function requireWrite(c: Caller) {
  if (!canWrite(c)) throw new HttpError(403, "Esta chave de API é só de leitura: ela só pode fazer chamadas GET.", "somente_leitura");
}
// Gerenciar chaves e webhooks: dono/admin no painel, ou chave com escopo de escrita.
function requireManage(c: Caller) {
  if (c.via === "key") { requireWrite(c); return; }
  if (!isAdmin(c)) throw new HttpError(403, "Só o dono ou um admin do time faz isso.");
}
function requireAdminUser(c: Caller) {
  if (c.via !== "jwt") throw new HttpError(403, "Chaves de API são criadas e revogadas só pelo painel (Config → API).", "so_painel");
  if (!isAdmin(c)) throw new HttpError(403, "Só o dono ou um admin do time gerencia as chaves de API.");
}
const fail = (error: { message: string } | null) => { if (error) throw new HttpError(500, error.message); };
const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const dayBahia = (d: Date) => new Date(d.getTime() - OFF_BAHIA).toISOString().slice(0, 10);
const daysAgo = (n: number) => dayBahia(new Date(Date.now() - n * 86_400_000));
const clean = (s: unknown, max: number) => String(s ?? "").trim().slice(0, max);

// Conta do time (e permitida para a chave); erro amigável se não.
async function teamAccountIds(db: Db, caller: Caller, ids: string[], { mustExist = true } = {}) {
  const unique = [...new Set(ids.map((x) => String(x)))];
  if (!unique.length) return [];
  const { data, error } = await db.from("accounts").select("id").eq("team_id", caller.teamId).in("id", unique);
  fail(error);
  const found = new Set((data ?? []).map((a) => a.id as string));
  const missing = unique.filter((id) => !found.has(id));
  if (mustExist && missing.length) throw new HttpError(400, `Conta não encontrada neste time: ${missing.join(", ")}. Veja GET /accounts.`, "conta_desconhecida");
  const blocked = unique.filter((id) => found.has(id) && !accountAllowed(caller, id));
  if (blocked.length) throw new HttpError(403, `Esta chave não tem acesso à conta ${blocked.join(", ")}.`, "conta_bloqueada");
  return unique.filter((id) => found.has(id));
}

// ---------------------------------------------------------------- /me
export async function me(db: Db, caller: Caller) {
  const { count } = await db.from("accounts").select("id", { count: "exact", head: true }).eq("team_id", caller.teamId).eq("archived", false);
  const team = { id: caller.teamId, name: caller.teamName, accounts: count ?? 0, max_accounts: caller.maxAccounts, max_posts_month: caller.maxPostsMonth };
  if (caller.via === "key" && caller.apiKey) {
    const k = caller.apiKey;
    return { via: "api_key", key: { id: k.id, name: k.name, prefix: k.prefix, scopes: k.scopes, read_only: !canWrite(caller), account_ids: k.accountIds, rate_limit: k.rateLimit }, team };
  }
  return { via: "user", user: { id: caller.id, email: caller.email, role: caller.role }, team };
}

// ---------------------------------------------------------------- contas
function shapeAccount(a: Row, usage: Map<string, number>) {
  return {
    id: a.id, platform: a.platform, username: a.username ?? null, label: a.label ?? null, status: a.status, archived: Boolean(a.archived),
    profile_photo_url: a.profile_photo_url ?? null, access_token_expires_at: a.access_token_expires_at ?? null,
    followers: a.followers ?? null, follows: a.follows ?? null, media_count: a.media_count ?? null, insights_ok: a.insights_ok ?? null,
    published_24h: usage.get(a.id as string) ?? 0, stats_synced_at: a.stats_synced_at ?? null, synced_at: a.synced_at ?? null,
  };
}
async function usage24h(db: Db, teamId: string) {
  const { data } = await db.from("account_usage_24h").select("account_id, published_24h").eq("team_id", teamId);
  return new Map((data ?? []).map((u) => [u.account_id as string, Number(u.published_24h ?? 0)]));
}

export async function listAccounts(db: Db, caller: Caller, q: URLSearchParams) {
  let query = db.from("accounts").select("*").eq("team_id", caller.teamId).order("username");
  if (q.get("archived") !== "true") query = query.eq("archived", false);
  if (q.get("status")) query = query.eq("status", q.get("status")!);
  if (q.get("platform")) query = query.eq("platform", q.get("platform")!);
  if (caller.apiKey?.accountIds) query = query.in("id", caller.apiKey.accountIds);
  const [{ data, error }, usage] = await Promise.all([query, usage24h(db, caller.teamId)]);
  fail(error);
  const rows = (data ?? []) as Row[];
  return { data: rows.map((a) => shapeAccount(a, usage)), meta: meta(rows.length, 0, rows.length) };
}

export async function getAccount(db: Db, caller: Caller, id: string) {
  const { data, error } = await db.from("accounts").select("*").eq("team_id", caller.teamId).eq("id", id).maybeSingle();
  fail(error);
  if (!data || !accountAllowed(caller, id)) throw new HttpError(404, "Conta não encontrada neste time.");
  const [usage, { data: groups }] = await Promise.all([
    usage24h(db, caller.teamId),
    db.from("account_group_members").select("group_id, account_groups!inner(id, name)").eq("account_id", id),
  ]);
  return { ...shapeAccount(data as Row, usage), groups: (groups ?? []).map((g) => { const ag = g.account_groups as unknown as { id: string; name: string }; return { id: ag.id, name: ag.name }; }) };
}

// ---------------------------------------------------------------- grupos
async function groupsWithMembers(db: Db, caller: Caller, id?: string) {
  let q = db.from("account_groups").select("id, name, color, created_at").eq("team_id", caller.teamId).order("name");
  if (id) q = q.eq("id", id);
  const { data: groups, error } = await q;
  fail(error);
  const ids = (groups ?? []).map((g) => g.id as string);
  const { data: members } = ids.length ? await db.from("account_group_members").select("group_id, account_id").in("group_id", ids) : { data: [] };
  return (groups ?? []).map((g) => ({
    id: g.id, name: g.name, color: g.color ?? null, created_at: g.created_at,
    account_ids: (members ?? []).filter((m) => m.group_id === g.id && accountAllowed(caller, m.account_id as string)).map((m) => m.account_id as string),
  }));
}
export async function listGroups(db: Db, caller: Caller) {
  const data = await groupsWithMembers(db, caller);
  return { data, meta: meta(data.length, 0, data.length) };
}
export async function getGroup(db: Db, caller: Caller, id: string) {
  if (!isUuid(id)) throw new HttpError(404, "Grupo não encontrado.");
  const [g] = await groupsWithMembers(db, caller, id);
  if (!g) throw new HttpError(404, "Grupo não encontrado neste time.");
  return g;
}
export async function createGroup(db: Db, caller: Caller, body: { name?: string; account_ids?: string[]; color?: string }) {
  requireWrite(caller);
  const name = clean(body.name, 40);
  if (!name) throw new HttpError(400, "Dê um nome ao grupo (até 40 caracteres).");
  const ids = await teamAccountIds(db, caller, Array.isArray(body.account_ids) ? body.account_ids : []);
  const { data, error } = await db.from("account_groups").insert({ team_id: caller.teamId, name, color: clean(body.color, 20) || null }).select("id").single();
  fail(error);
  if (ids.length) fail((await db.from("account_group_members").insert(ids.map((account_id) => ({ group_id: data!.id, account_id })))).error);
  return getGroup(db, caller, data!.id as string);
}
export async function updateGroup(db: Db, caller: Caller, id: string, body: { name?: string; account_ids?: string[]; color?: string }) {
  requireWrite(caller);
  await getGroup(db, caller, id);
  const patch: Row = {};
  if (body.name !== undefined) { const name = clean(body.name, 40); if (!name) throw new HttpError(400, "O nome não pode ficar vazio."); patch.name = name; }
  if (body.color !== undefined) patch.color = clean(body.color, 20) || null;
  if (Object.keys(patch).length) fail((await db.from("account_groups").update(patch).eq("id", id)).error);
  if (Array.isArray(body.account_ids)) {
    const ids = await teamAccountIds(db, caller, body.account_ids);
    fail((await db.from("account_group_members").delete().eq("group_id", id)).error);
    if (ids.length) fail((await db.from("account_group_members").insert(ids.map((account_id) => ({ group_id: id, account_id })))).error);
  }
  return getGroup(db, caller, id);
}
export async function deleteGroup(db: Db, caller: Caller, id: string) {
  requireWrite(caller);
  await getGroup(db, caller, id);
  fail((await db.from("account_groups").delete().eq("id", id)).error);
  return { ok: true, deleted: id };
}
// Contas de uma lista de grupos (para account_ids/group_ids no POST /posts).
export async function accountsOfGroups(db: Db, caller: Caller, groupIds: string[]) {
  const ids = [...new Set(groupIds.map(String))].filter(isUuid);
  if (!ids.length) return [];
  const { data: groups, error } = await db.from("account_groups").select("id").eq("team_id", caller.teamId).in("id", ids);
  fail(error);
  const found = new Set((groups ?? []).map((g) => g.id as string));
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length) throw new HttpError(400, `Grupo não encontrado neste time: ${missing.join(", ")}. Veja GET /groups.`, "grupo_desconhecido");
  const { data: members } = await db.from("account_group_members").select("account_id").in("group_id", ids);
  return [...new Set((members ?? []).map((m) => m.account_id as string))];
}

// ---------------------------------------------------------------- biblioteca
const shapeMedia = (m: Row) => ({ id: m.id, url: m.url, kind: m.kind, name: m.name ?? null, mime: m.mime ?? null, size_bytes: m.size_bytes ?? null, width: m.width ?? null, height: m.height ?? null, duration_s: m.duration_s ?? null, created_at: m.created_at });
export const guessKind = (url: string): "image" | "video" => (/\.(mp4|mov|m4v|webm)(\?|#|$)/i.test(url) ? "video" : "image");
// Tipo do arquivo: o que veio em `kind`, a extensão do link ou, sem extensão (ex.: o media_url
// do upload), o Content-Type que o próprio link responde. Na dúvida, foto.
export async function detectKind(url: string, declared?: unknown, fetchImpl: typeof fetch = fetch): Promise<"image" | "video"> {
  if (declared === "image" || declared === "video") return declared;
  if (/\.(mp4|mov|m4v|webm)(\?|#|$)/i.test(url)) return "video";
  if (/\.(jpe?g|png|webp|gif|heic|heif|bmp|tiff?)(\?|#|$)/i.test(url)) return "image";
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || /^(localhost|\d+\.\d+\.\d+\.\d+|\[[0-9a-f:.]+\])$/i.test(u.hostname)) return "image";
    const r = await fetchImpl(u, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(5000) });
    if ((r.headers.get("content-type") ?? "").toLowerCase().startsWith("video/")) return "video";
  } catch { /* o link não respondeu: segue como foto e a validação avisa */ }
  return "image";
}

export async function listMedia(db: Db, caller: Caller, q: URLSearchParams) {
  const { limit, offset } = paging(q);
  let query = db.from("media").select("*", { count: "exact" }).eq("team_id", caller.teamId).order("created_at", { ascending: false }).range(offset, offset + limit - 1);
  if (q.get("kind")) query = query.eq("kind", q.get("kind")!);
  const { data, error, count } = await query;
  fail(error);
  return { data: ((data ?? []) as Row[]).map(shapeMedia), meta: meta(limit, offset, count) };
}
export async function getMedia(db: Db, caller: Caller, id: string) {
  if (!isUuid(id)) throw new HttpError(404, "Mídia não encontrada.");
  const { data, error } = await db.from("media").select("*").eq("team_id", caller.teamId).eq("id", id).maybeSingle();
  fail(error);
  if (!data) throw new HttpError(404, "Mídia não encontrada nesta biblioteca.");
  return shapeMedia(data as Row);
}
export async function registerMedia(db: Db, caller: Caller, body: Row) {
  requireWrite(caller);
  const url = clean(body.url, 2000);
  if (!/^https:\/\//.test(url)) throw new HttpError(400, "Informe `url` começando com https:// (o link público do arquivo).");
  const kind = await detectKind(url, body.kind);
  const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
  const { data, error } = await db.from("media").insert({
    team_id: caller.teamId, url, kind, name: clean(body.name, 200) || null, mime: clean(body.mime, 100) || null,
    size_bytes: num(body.size_bytes), width: num(body.width), height: num(body.height), duration_s: num(body.duration_s), created_by: caller.id,
  }).select("*").single();
  fail(error);
  return shapeMedia(data as Row);
}
export async function deleteMedia(db: Db, caller: Caller, id: string) {
  requireWrite(caller);
  await getMedia(db, caller, id);
  fail((await db.from("media").delete().eq("id", id)).error);
  return { ok: true, deleted: id };
}

// ---------------------------------------------------------------- publicações (leitura)
interface TargetRow { post_id: string; account_id: string; status: string; permalink: string | null; platform_post_id: string | null; error: string | null; published_at: string | null; updated_at: string; accounts: { username: string | null; platform: string; label?: string | null } | null }
async function targetsOf(db: Db, caller: Caller, postIds: string[]) {
  if (!postIds.length) return new Map<string, TargetRow[]>();
  const { data, error } = await db.from("post_targets").select("post_id, account_id, status, permalink, platform_post_id, error, published_at, updated_at, accounts(username, platform, label)").in("post_id", postIds);
  fail(error);
  const out = new Map<string, TargetRow[]>();
  for (const t of (data ?? []) as unknown as TargetRow[]) {
    if (!accountAllowed(caller, t.account_id)) continue;
    if (!out.has(t.post_id)) out.set(t.post_id, []);
    out.get(t.post_id)!.push(t);
  }
  return out;
}
const shapeTarget = (t: TargetRow) => ({ account_id: t.account_id, username: t.accounts?.username ?? null, platform: t.accounts?.platform ?? null, label: t.accounts?.label ?? null, status: t.status, permalink: t.permalink, platform_post_id: t.platform_post_id, error: t.error, published_at: t.published_at, updated_at: t.updated_at });
function shapePost(p: Row, targets: TargetRow[], full: boolean) {
  const published = targets.filter((t) => t.status === "published").length, failed = targets.filter((t) => t.status === "failed").length;
  const base = {
    id: p.id, title: p.title ?? null, caption: p.caption, placement: p.placement, status: p.status, scheduled_at: p.scheduled_at ?? null,
    media: Array.isArray(p.media) ? p.media : [], targets: { total: targets.length, published, failed, pending: targets.length - published - failed },
    account_ids: targets.map((t) => t.account_id), created_at: p.created_at, updated_at: p.updated_at ?? null, completed_at: p.completed_at ?? null,
  };
  if (!full) return base;
  return { ...base, caption_overrides: p.caption_overrides ?? {}, platform_options: p.options ?? {}, error: p.error ?? null, pfm_post_id: p.pfm_post_id ?? null, results: targets.map(shapeTarget) };
}
const STATUSES = ["draft", "scheduled", "processing", "processed", "canceled", "error"];

export async function listPosts(db: Db, caller: Caller, q: URLSearchParams) {
  const { limit, offset } = paging(q);
  let query = db.from("posts").select("*", { count: "exact" }).eq("team_id", caller.teamId);
  const statuses = (q.get("status") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const bad = statuses.filter((s) => !STATUSES.includes(s));
  if (bad.length) throw new HttpError(400, `Status inválido: ${bad.join(", ")}. Use ${STATUSES.join(", ")}.`);
  if (statuses.length) query = query.in("status", statuses);
  if (q.get("from")) query = query.gte("scheduled_at", q.get("from")!);
  if (q.get("to")) query = query.lte("scheduled_at", q.get("to")!);
  if (q.get("q")) query = query.or(`title.ilike.%${q.get("q")!.replace(/[%,]/g, "")}%,caption.ilike.%${q.get("q")!.replace(/[%,]/g, "")}%`);
  const accountFilter = q.get("account_id") ? [q.get("account_id")!] : caller.apiKey?.accountIds ?? null;
  if (accountFilter) {
    const allowed = await teamAccountIds(db, caller, accountFilter, { mustExist: false });
    const { data: pt } = await db.from("post_targets").select("post_id").in("account_id", allowed.length ? allowed : ["-"]).limit(5000);
    const ids = [...new Set((pt ?? []).map((t) => t.post_id as string))];
    query = query.in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
  }
  const asc = q.get("order") === "asc";
  query = query.order("scheduled_at", { ascending: asc, nullsFirst: !asc }).order("created_at", { ascending: asc }).range(offset, offset + limit - 1);
  const { data, error, count } = await query;
  fail(error);
  const rows = (data ?? []) as Row[];
  const targets = await targetsOf(db, caller, rows.map((p) => p.id as string));
  return { data: rows.map((p) => shapePost(p, targets.get(p.id as string) ?? [], false)), meta: meta(limit, offset, count) };
}
export async function getPostFull(db: Db, caller: Caller, id: string) {
  if (!isUuid(id)) throw new HttpError(404, "Publicação não encontrada.");
  const { data, error } = await db.from("posts").select("*").eq("team_id", caller.teamId).eq("id", id).maybeSingle();
  fail(error);
  if (!data) throw new HttpError(404, "Publicação não encontrada neste time.");
  const targets = (await targetsOf(db, caller, [id])).get(id) ?? [];
  if (caller.apiKey?.accountIds && !targets.length) throw new HttpError(404, "Publicação não encontrada nas contas desta chave.");
  return shapePost(data as Row, targets, true);
}

// ---------------------------------------------------------------- desempenho
export async function metricsAccounts(db: Db, caller: Caller) {
  let q = db.from("accounts").select("id, username, label, platform, followers, follows, media_count, insights_ok, stats_synced_at").eq("team_id", caller.teamId).eq("archived", false).order("followers", { ascending: false, nullsFirst: false });
  if (caller.apiKey?.accountIds) q = q.in("id", caller.apiKey.accountIds);
  const [{ data: accs, error }, { data: hist }] = await Promise.all([
    q,
    db.from("account_stats_daily").select("account_id, day, followers").eq("team_id", caller.teamId).in("day", [daysAgo(7), daysAgo(30)]),
  ]);
  fail(error);
  const at = (id: string, day: string) => (hist ?? []).find((h) => h.account_id === id && h.day === day)?.followers ?? null;
  const data = (accs ?? []).map((a) => {
    const f7 = at(a.id as string, daysAgo(7)), f30 = at(a.id as string, daysAgo(30));
    return { account_id: a.id, username: a.username, label: a.label ?? null, platform: a.platform, followers: a.followers, follows: a.follows, media_count: a.media_count,
      followers_7d_ago: f7, followers_30d_ago: f30, gained_7d: a.followers != null && f7 != null ? Number(a.followers) - Number(f7) : null, gained_30d: a.followers != null && f30 != null ? Number(a.followers) - Number(f30) : null,
      insights_ok: a.insights_ok, stats_synced_at: a.stats_synced_at };
  });
  return { data, meta: meta(data.length, 0, data.length) };
}
const METRIC_COLS = "platform_post_id, account_id, post_id, social_post_id, platform, product_type, media_type, permalink, caption, thumbnail_url, posted_at, views, reach, likes, comments, shares, saved, follows, profile_visits, total_interactions, avg_watch_ms, total_watch_ms, nivel, updated_at";
const ORDERS = ["posted_at", "views", "reach", "likes", "comments", "shares", "saved", "total_interactions"];
export async function metricsPosts(db: Db, caller: Caller, q: URLSearchParams) {
  const { limit, offset } = paging(q);
  const order = q.get("order") || "posted_at";
  if (!ORDERS.includes(order)) throw new HttpError(400, `Ordenação inválida. Use ${ORDERS.join(", ")}.`);
  let query = db.from("post_metrics").select(METRIC_COLS, { count: "exact" }).eq("team_id", caller.teamId).order(order, { ascending: false, nullsFirst: false }).range(offset, offset + limit - 1);
  if (q.get("account_id")) { await teamAccountIds(db, caller, [q.get("account_id")!]); query = query.eq("account_id", q.get("account_id")!); }
  else if (caller.apiKey?.accountIds) query = query.in("account_id", caller.apiKey.accountIds);
  if (q.get("platform")) query = query.eq("platform", q.get("platform")!);
  if (q.get("since")) query = query.gte("posted_at", q.get("since")!);
  if (q.get("post_id")) query = query.eq("post_id", q.get("post_id")!);
  const { data, error, count } = await query;
  fail(error);
  return { data: data ?? [], meta: meta(limit, offset, count) };
}
export async function metricsPost(db: Db, caller: Caller, platformPostId: string) {
  const { data, error } = await db.from("post_metrics").select(METRIC_COLS).eq("team_id", caller.teamId).eq("platform_post_id", platformPostId).maybeSingle();
  fail(error);
  if (!data || !accountAllowed(caller, data.account_id as string)) throw new HttpError(404, "Post não encontrado no desempenho deste time.");
  const { data: daily } = await db.from("post_metrics_daily").select("day, views, reach, likes, comments, shares, saved, total_interactions").eq("platform_post_id", platformPostId).order("day");
  return { ...data, daily: daily ?? [] };
}

// ---------------------------------------------------------------- chaves de API (só painel)
const shapeKey = (k: Row, last24: Map<string, number>) => ({
  id: k.id, name: k.name, prefix: k.prefix, scopes: k.scopes ?? [], read_only: ((k.scopes as string[] | null) ?? []).includes("read"), account_ids: k.account_ids ?? null,
  rate_limit: k.rate_limit, created_at: k.created_at, last_used_at: k.last_used_at ?? null, revoked_at: k.revoked_at ?? null,
  requests_total: Number(k.requests_total ?? 0), requests_24h: last24.get(k.id as string) ?? 0,
});
async function requests24h(db: Db, teamId: string) {
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const { data } = await db.from("api_requests").select("key_id").eq("team_id", teamId).gte("created_at", since).limit(20000);
  const m = new Map<string, number>();
  for (const r of data ?? []) if (r.key_id) m.set(r.key_id as string, (m.get(r.key_id as string) ?? 0) + 1);
  return m;
}
export async function listKeys(db: Db, caller: Caller) {
  if (caller.via !== "jwt") throw new HttpError(403, "Chaves de API são listadas só pelo painel.", "so_painel");
  const [{ data, error }, last24] = await Promise.all([db.from("api_keys").select("*").eq("team_id", caller.teamId).order("created_at", { ascending: false }), requests24h(db, caller.teamId)]);
  fail(error);
  return { data: ((data ?? []) as Row[]).map((k) => shapeKey(k, last24)) };
}
export async function createKey(db: Db, caller: Caller, body: { name?: string; scopes?: string[]; read_only?: boolean; account_ids?: string[] | null; rate_limit?: number }) {
  requireAdminUser(caller);
  const name = clean(body.name, 60);
  if (!name) throw new HttpError(400, "Dê um nome à chave (ex.: n8n, Zapier, site).");
  const { count } = await db.from("api_keys").select("id", { count: "exact", head: true }).eq("team_id", caller.teamId).is("revoked_at", null);
  if ((count ?? 0) >= 20) throw new HttpError(400, "Este time já tem 20 chaves ativas. Revogue alguma antes de criar outra.");
  const scopes = body.read_only || (Array.isArray(body.scopes) && body.scopes.includes("read")) ? ["read"] : [];
  const accountIds = Array.isArray(body.account_ids) && body.account_ids.length ? await teamAccountIds(db, caller, body.account_ids) : null;
  const rate = Math.min(600, Math.max(10, Math.floor(Number(body.rate_limit)) || 120));
  const key = randomToken("ifk_", 40);
  const { data, error } = await db.from("api_keys").insert({
    team_id: caller.teamId, name, prefix: key.slice(0, 12), key_hash: await sha256Hex(key), scopes, account_ids: accountIds, rate_limit: rate, created_by: caller.id,
  }).select("*").single();
  fail(error);
  return { ...shapeKey(data as Row, new Map()), key, warning: "Guarde esta chave agora: ela não aparece de novo." };
}
export async function revokeKey(db: Db, caller: Caller, id: string) {
  requireAdminUser(caller);
  if (!isUuid(id)) throw new HttpError(404, "Chave não encontrada.");
  const { data, error } = await db.from("api_keys").update({ revoked_at: new Date().toISOString() }).eq("team_id", caller.teamId).eq("id", id).is("revoked_at", null).select("id").maybeSingle();
  fail(error);
  if (!data) throw new HttpError(404, "Chave não encontrada ou já revogada.");
  return { ok: true, revoked: id };
}
export async function keyRequests(db: Db, caller: Caller, id: string, q: URLSearchParams) {
  if (caller.via !== "jwt") throw new HttpError(403, "O histórico das chaves é visto só pelo painel.", "so_painel");
  const { limit, offset } = paging(q);
  const { data, error, count } = await db.from("api_requests").select("id, method, path, status, ms, ip, created_at", { count: "exact" }).eq("team_id", caller.teamId).eq("key_id", id).order("created_at", { ascending: false }).range(offset, offset + limit - 1);
  fail(error);
  return { data: data ?? [], meta: meta(limit, offset, count) };
}

// ---------------------------------------------------------------- webhooks do time
const shapeHook = (h: Row, withSecret: boolean) => ({
  id: h.id, url: h.url, events: (h.events as string[] | null)?.length ? h.events : ["*"], active: Boolean(h.active), description: h.description ?? null,
  failures: h.failures ?? 0, last_status: h.last_status ?? null, last_error: h.last_error ?? null, last_at: h.last_at ?? null, created_at: h.created_at,
  ...(withSecret ? { secret: h.secret } : {}),
});
const canSeeSecret = (c: Caller) => (c.via === "key" ? canWrite(c) : isAdmin(c));
function validEvents(events: unknown): string[] {
  if (!Array.isArray(events) || !events.length || events.includes("*")) return [];
  const bad = events.filter((e) => !(WEBHOOK_EVENTS as readonly string[]).includes(String(e)) || e === "ping");
  if (bad.length) throw new HttpError(400, `Evento inválido: ${bad.join(", ")}. Use ${WEBHOOK_EVENTS.filter((e) => e !== "ping").join(", ")} ou "*".`);
  return [...new Set(events.map(String))];
}
function validUrl(u: unknown) {
  const url = clean(u, 500);
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new HttpError(400, "URL do webhook inválida."); }
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && /^(localhost|127\.0\.0\.1)$/.test(parsed.hostname))) throw new HttpError(400, "A URL do webhook precisa começar com https://.");
  return url;
}
export async function listWebhooks(db: Db, caller: Caller) {
  const { data, error } = await db.from("team_webhooks").select("*").eq("team_id", caller.teamId).order("created_at");
  fail(error);
  const withSecret = canSeeSecret(caller);
  return { data: ((data ?? []) as Row[]).map((h) => shapeHook(h, withSecret)) };
}
async function hookOf(db: Db, caller: Caller, id: string) {
  if (!isUuid(id)) throw new HttpError(404, "Webhook não encontrado.");
  const { data, error } = await db.from("team_webhooks").select("*").eq("team_id", caller.teamId).eq("id", id).maybeSingle();
  fail(error);
  if (!data) throw new HttpError(404, "Webhook não encontrado neste time.");
  return data as Row;
}
export async function createWebhook(db: Db, caller: Caller, body: { url?: string; events?: string[]; description?: string }) {
  requireManage(caller);
  const url = validUrl(body.url);
  const events = validEvents(body.events);
  const { count } = await db.from("team_webhooks").select("id", { count: "exact", head: true }).eq("team_id", caller.teamId);
  if ((count ?? 0) >= 10) throw new HttpError(400, "Este time já tem 10 webhooks. Apague algum antes de criar outro.");
  const { data, error } = await db.from("team_webhooks").insert({ team_id: caller.teamId, url, secret: randomToken("whsec_", 32), events, description: clean(body.description, 120) || null, created_by: caller.id }).select("*").single();
  fail(error);
  return { ...shapeHook(data as Row, true), warning: "Guarde o `secret`: é com ele que você confere a assinatura de cada aviso." };
}
export async function updateWebhook(db: Db, caller: Caller, id: string, body: { url?: string; events?: string[]; active?: boolean; description?: string }) {
  requireManage(caller);
  await hookOf(db, caller, id);
  const patch: Row = {};
  if (body.url !== undefined) patch.url = validUrl(body.url);
  if (body.events !== undefined) patch.events = validEvents(body.events);
  if (body.description !== undefined) patch.description = clean(body.description, 120) || null;
  if (body.active !== undefined) { patch.active = Boolean(body.active); if (body.active) patch.failures = 0; }
  if (Object.keys(patch).length) fail((await db.from("team_webhooks").update(patch).eq("id", id)).error);
  return shapeHook(await hookOf(db, caller, id), canSeeSecret(caller));
}
export async function deleteWebhook(db: Db, caller: Caller, id: string) {
  requireManage(caller);
  await hookOf(db, caller, id);
  fail((await db.from("team_webhooks").delete().eq("id", id)).error);
  return { ok: true, deleted: id };
}
export async function testWebhook(db: Db, caller: Caller, id: string) {
  requireManage(caller);
  const h = (await hookOf(db, caller, id)) as unknown as TeamWebhook;
  const payload = makePayload(caller.teamId, "ping", { message: "Olá do InstaFlow! Se você recebeu isto, o webhook está funcionando.", webhook_id: h.id, team: caller.teamName });
  const r = await deliver(db, h, payload, fetch, []);
  return { ok: r.ok, status: r.status, ms: r.ms, error: r.error, event_id: payload.id };
}
export async function webhookDeliveries(db: Db, caller: Caller, id: string, q: URLSearchParams) {
  await hookOf(db, caller, id);
  const { limit, offset } = paging(q);
  const { data, error, count } = await db.from("webhook_deliveries").select("id, event_id, event, attempt, status, ms, error, created_at", { count: "exact" }).eq("webhook_id", id).order("created_at", { ascending: false }).range(offset, offset + limit - 1);
  fail(error);
  return { data: data ?? [], meta: meta(limit, offset, count) };
}
