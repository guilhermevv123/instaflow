// InstaFlow · camada do meio entre o painel e o Post for Me.
// Guarda a chave da API, valida quem chama e espelha os dados no banco.
//
// Rotas (todas sob /functions/v1/api):
//   GET    /health                    testa a chave do Post for Me
//   GET    /accounts/sync             puxa as contas do Post for Me e devolve a lista
//   POST   /accounts/connect          gera o link "Conectar Instagram"
//   POST   /accounts/:id/disconnect   desconecta no Post for Me
//   DELETE /accounts/:id              remove (ou arquiva, se já tem histórico)
//   POST   /media/upload-url          URL assinada para subir um arquivo
//   POST   /posts                     cria/agenda uma publicação em N contas
//   PUT    /posts/:id                 edita (só enquanto agendada)
//   DELETE /posts/:id                 cancela (só enquanto agendada)
//   POST   /posts/:id/sync            confere status/resultados no Post for Me
//   POST   /posts/:id/retry           reenvia agora para as contas que falharam
//   POST   /sync                      confere todas as publicações pendentes
//   GET    /usage                     uso do mês e estado do webhook
//   POST   /webhooks/setup            registra o webhook no Post for Me

import { friendlyError } from "../_shared/friendly.ts";
import { listData, pfm, PfmError, pfmListAll, type PfmAccount, type PfmPost, type PfmResult, type PfmWebhook } from "../_shared/pfm.ts";
import { background, type Caller, corsHeaders, HttpError, json, readJson, requireMember, serviceClient, SUPABASE_URL } from "../_shared/util.ts";

const PLAN_MONTHLY_LIMIT = 1000; // plano de US$ 10 do Post for Me: posts bem-sucedidos por mês (conta por conta)
const WEBHOOK_EVENTS = [
  "social.post.result.created",
  "social.post.updated",
  "social.account.created",
  "social.account.updated",
];

type Db = ReturnType<typeof serviceClient>;

interface PostInput {
  title?: string | null;
  caption: string;
  placement?: "timeline" | "reels" | "stories";
  media: Array<{ url: string; kind: "image" | "video"; thumbnail_url?: string | null }>;
  account_ids: string[];
  scheduled_at?: string | null;
  caption_overrides?: Record<string, string>;
  options?: { share_to_feed?: boolean; collaborators?: string[] };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(req) });
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/functions\/v1/, "").replace(/^\/api/, "").replace(/\/+$/, "") || "/";
  const seg = path.split("/").filter(Boolean);
  const db = serviceClient();

  try {
    const caller = await requireMember(req);

    if (req.method === "GET" && path === "/health") return json(req, await health());
    if (req.method === "GET" && path === "/accounts/sync") return json(req, await syncAccounts(db));
    if (req.method === "POST" && path === "/accounts/connect") return json(req, await connectUrl(await readJson(req).catch(() => ({}))));
    if (req.method === "POST" && seg[0] === "accounts" && seg[2] === "disconnect") return json(req, await disconnectAccount(db, seg[1]));
    if (req.method === "DELETE" && seg[0] === "accounts" && seg.length === 2) return json(req, await removeAccount(db, seg[1]));
    if (req.method === "POST" && path === "/media/upload-url") return json(req, await pfm("/media/create-upload-url", { method: "POST" }));
    if (req.method === "POST" && path === "/posts") return json(req, await createPost(db, caller, await readJson<PostInput>(req)), 201);
    if (req.method === "PUT" && seg[0] === "posts" && seg.length === 2) return json(req, await updatePost(db, seg[1], await readJson<PostInput>(req)));
    if (req.method === "DELETE" && seg[0] === "posts" && seg.length === 2) return json(req, await cancelPost(db, seg[1]));
    if (req.method === "POST" && seg[0] === "posts" && seg[2] === "sync") return json(req, await syncPost(db, seg[1]));
    if (req.method === "POST" && seg[0] === "posts" && seg[2] === "retry") return json(req, await retryPost(db, caller, seg[1]), 201);
    if (req.method === "POST" && path === "/sync") return json(req, await syncPending(db));
    if (req.method === "GET" && path === "/usage") return json(req, await usage(db));
    if (req.method === "POST" && path === "/webhooks/setup") return json(req, await ensureWebhook(db, true));

    throw new HttpError(404, `Rota não encontrada: ${req.method} ${path}`);
  } catch (e) {
    if (e instanceof HttpError) return json(req, { error: e.message }, e.status);
    if (e instanceof PfmError) {
      console.error("Post for Me:", e.status, e.message, JSON.stringify(e.body).slice(0, 500));
      return json(req, { error: `Post for Me: ${e.message}`, details: e.body }, e.status >= 500 ? 502 : e.status);
    }
    console.error(e);
    return json(req, { error: (e as Error).message ?? "Erro interno" }, 500);
  }
});

// ---------------------------------------------------------------------------
// Saúde e contas
// ---------------------------------------------------------------------------
async function health() {
  const res = await pfm("/social-accounts", { query: { limit: "1" } });
  const meta = (res as { meta?: { total?: number } }).meta;
  return { ok: true, accounts_total: meta?.total ?? listData(res).length };
}

async function syncAccounts(db: Db) {
  const all = await pfmListAll<PfmAccount>("/social-accounts", { platform: "instagram" });
  const rows = all.map((a) => ({
    id: a.id,
    platform: a.platform,
    username: a.username,
    user_id: a.user_id,
    profile_photo_url: a.profile_photo_url,
    status: a.status,
    external_id: a.external_id,
    access_token_expires_at: a.access_token_expires_at || null,
    metadata: a.metadata ?? null,
    synced_at: new Date().toISOString(),
  }));
  if (rows.length) {
    const { error } = await db.from("accounts").upsert(rows, { onConflict: "id" });
    if (error) throw new HttpError(500, error.message);
  }
  // contas que sumiram do Post for Me ficam como desconectadas
  const ids = rows.map((r) => r.id);
  if (ids.length) {
    await db.from("accounts").update({ status: "disconnected" }).not("id", "in", `(${ids.map((i) => `"${i}"`).join(",")})`).eq("status", "connected");
  } else {
    await db.from("accounts").update({ status: "disconnected" }).eq("status", "connected");
  }
  background(ensureWebhook(db, false).catch((e) => console.error("webhook", e)));
  const { data } = await db.from("accounts").select("*").order("username");
  return { accounts: data ?? [], synced: rows.length };
}

async function connectUrl(body: { external_id?: string }) {
  const res = await pfm<{ url: string; platform: string }>("/social-accounts/auth-url", {
    method: "POST",
    body: {
      platform: "instagram",
      platform_data: { instagram: { connection_type: "instagram" } },
      external_id: body.external_id || undefined,
      permissions: ["posts"],
    },
  });
  return { url: res.url };
}

async function disconnectAccount(db: Db, id: string) {
  await pfm(`/social-accounts/${encodeURIComponent(id)}/disconnect`, { method: "POST" });
  await db.from("accounts").update({ status: "disconnected" }).eq("id", id);
  return { ok: true };
}

async function removeAccount(db: Db, id: string) {
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
function validatePost(input: PostInput) {
  const errors: string[] = [];
  const placement = input.placement ?? "timeline";
  if (!["timeline", "reels", "stories"].includes(placement)) errors.push("Tipo de post inválido.");
  if (!input.caption?.trim() && placement !== "stories") errors.push("Escreva uma legenda.");
  if (!Array.isArray(input.media) || input.media.length === 0) errors.push("Adicione pelo menos uma foto ou vídeo.");
  if (Array.isArray(input.media)) {
    if (input.media.length > 10) errors.push("O carrossel aceita no máximo 10 itens.");
    for (const m of input.media) {
      if (!m?.url || !/^https:\/\//.test(m.url)) errors.push("Mídia com link inválido.");
      if (!["image", "video"].includes(m?.kind)) errors.push("Tipo de mídia inválido.");
    }
    if (placement === "reels" && (input.media.length !== 1 || input.media[0]?.kind !== "video")) {
      errors.push("Reels precisa de exatamente um vídeo.");
    }
  }
  if (!Array.isArray(input.account_ids) || input.account_ids.length === 0) errors.push("Escolha pelo menos uma conta.");
  if (input.scheduled_at) {
    const t = Date.parse(input.scheduled_at);
    if (Number.isNaN(t)) errors.push("Data e hora inválidas.");
    else if (t < Date.now() - 60_000) errors.push("A data e hora precisam estar no futuro.");
  }
  if (errors.length) throw new HttpError(400, errors.join(" "));
  return placement as "timeline" | "reels" | "stories";
}

async function loadAccounts(db: Db, ids: string[]) {
  const { data, error } = await db.from("accounts").select("id, username, status, archived").in("id", ids);
  if (error) throw new HttpError(500, error.message);
  const found = new Map((data ?? []).map((a) => [a.id, a]));
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length) throw new HttpError(400, "Uma das contas escolhidas não existe mais. Sincronize as contas.");
  const off = (data ?? []).filter((a) => a.status !== "connected" || a.archived).map((a) => "@" + (a.username ?? a.id));
  if (off.length) throw new HttpError(400, `Estas contas precisam ser reconectadas antes: ${off.join(", ")}.`);
  return data ?? [];
}

function buildPfmBody(input: PostInput, placement: string, externalId: string) {
  const caption = input.caption?.trim() || " ";
  const overrides = input.caption_overrides ?? {};
  const instagram: Record<string, unknown> = { placement };
  if (placement !== "stories") {
    if (typeof input.options?.share_to_feed === "boolean") instagram.share_to_feed = input.options.share_to_feed;
    if (input.options?.collaborators?.length) instagram.collaborators = input.options.collaborators.slice(0, 3);
  }
  const accountConfigs = input.account_ids
    .filter((id) => overrides[id]?.trim() && overrides[id].trim() !== caption)
    .map((id) => ({ social_account_id: id, configuration: { caption: overrides[id].trim() } }));
  return {
    caption,
    scheduled_at: input.scheduled_at || null,
    social_accounts: input.account_ids,
    media: input.media.map((m) => ({ url: m.url, thumbnail_url: m.thumbnail_url || undefined })),
    platform_configurations: { instagram },
    account_configurations: accountConfigs.length ? accountConfigs : undefined,
    external_id: externalId,
  };
}

async function createPost(db: Db, caller: Caller, input: PostInput) {
  const placement = validatePost(input);
  await loadAccounts(db, input.account_ids);
  const scheduled = input.scheduled_at ? new Date(input.scheduled_at).toISOString() : null;

  const { data: post, error } = await db.from("posts").insert({
    title: input.title?.trim() || null,
    caption: input.caption?.trim() || "",
    placement,
    media: input.media,
    options: input.options ?? {},
    caption_overrides: input.caption_overrides ?? {},
    scheduled_at: scheduled,
    status: scheduled ? "scheduled" : "processing",
    created_by: caller.id,
  }).select("*").single();
  if (error || !post) throw new HttpError(500, error?.message ?? "Não consegui salvar a publicação.");

  let pfmPost: PfmPost;
  try {
    pfmPost = await pfm<PfmPost>("/social-posts", { method: "POST", body: buildPfmBody({ ...input, scheduled_at: scheduled }, placement, post.id) });
  } catch (e) {
    await db.from("posts").delete().eq("id", post.id);
    throw e;
  }

  await db.from("posts").update({ pfm_post_id: pfmPost.id, status: pfmPost.status }).eq("id", post.id);
  await db.from("post_targets").insert(input.account_ids.map((account_id) => ({ post_id: post.id, account_id, status: "pending" })));
  return { id: post.id, pfm_post_id: pfmPost.id, status: pfmPost.status, scheduled_at: scheduled };
}

async function getPost(db: Db, id: string) {
  const { data, error } = await db.from("posts").select("*").eq("id", id).maybeSingle();
  if (error) throw new HttpError(500, error.message);
  if (!data) throw new HttpError(404, "Publicação não encontrada.");
  return data;
}

async function updatePost(db: Db, id: string, input: PostInput) {
  const post = await getPost(db, id);
  if (!["scheduled", "draft"].includes(post.status)) throw new HttpError(400, "Só dá para editar uma publicação que ainda está agendada.");
  const placement = validatePost(input);
  await loadAccounts(db, input.account_ids);
  const scheduled = input.scheduled_at ? new Date(input.scheduled_at).toISOString() : null;
  if (!scheduled) throw new HttpError(400, "Para publicar agora, cancele esta e crie uma nova publicação.");

  const pfmPost = await pfm<PfmPost>(`/social-posts/${encodeURIComponent(post.pfm_post_id)}`, {
    method: "PUT",
    body: buildPfmBody({ ...input, scheduled_at: scheduled }, placement, post.id),
  });
  await db.from("posts").update({
    title: input.title?.trim() || null,
    caption: input.caption?.trim() || "",
    placement,
    media: input.media,
    options: input.options ?? {},
    caption_overrides: input.caption_overrides ?? {},
    scheduled_at: scheduled,
    status: pfmPost.status,
  }).eq("id", id);
  await db.from("post_targets").delete().eq("post_id", id);
  await db.from("post_targets").insert(input.account_ids.map((account_id) => ({ post_id: id, account_id, status: "pending" })));
  return { id, status: pfmPost.status };
}

async function cancelPost(db: Db, id: string) {
  const post = await getPost(db, id);
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
async function syncPost(db: Db, id: string) {
  const post = await getPost(db, id);
  if (!post.pfm_post_id) return { status: post.status, results: 0 };
  const remote = await pfm<PfmPost>(`/social-posts/${encodeURIComponent(post.pfm_post_id)}`);
  const results = await pfmListAll<PfmResult>("/social-post-results", { post_id: post.pfm_post_id });
  for (const r of results) await applyResult(db, r);
  const { data: targets } = await db.from("post_targets").select("status").eq("post_id", id);
  const pending = (targets ?? []).filter((t) => t.status === "pending").length;
  const status = remote.status === "processed" && pending > 0 && results.length === 0
    ? "processed"
    : remote.status;
  await db.from("posts").update({ status }).eq("id", id);
  return { status, results: results.length, pending };
}

async function syncPending(db: Db) {
  const { data } = await db.from("posts")
    .select("id, scheduled_at")
    .in("status", ["scheduled", "processing"])
    .or(`scheduled_at.is.null,scheduled_at.lte.${new Date().toISOString()}`)
    .order("scheduled_at", { ascending: true })
    .limit(25);
  const out: Array<{ id: string; status: string }> = [];
  for (const p of data ?? []) {
    try {
      const r = await syncPost(db, p.id);
      out.push({ id: p.id, status: r.status });
    } catch (e) {
      console.error("sync", p.id, (e as Error).message);
    }
  }
  return { checked: out.length, posts: out };
}

async function retryPost(db: Db, caller: Caller, id: string) {
  const post = await getPost(db, id);
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
    options: post.options,
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
async function usage(db: Db) {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  const { count } = await db.from("post_targets").select("post_id", { count: "exact", head: true })
    .eq("status", "published").gte("published_at", start.toISOString());
  const { data: wh } = await db.from("app_settings").select("value, updated_at").eq("key", "pfm_webhook").maybeSingle();
  const { data: last } = await db.from("webhook_events").select("received_at, event_type").order("id", { ascending: false }).limit(1).maybeSingle();
  return {
    month_published: count ?? 0,
    month_limit: PLAN_MONTHLY_LIMIT,
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
