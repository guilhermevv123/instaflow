// InstaFlow · aplica o resultado de uma publicação numa conta (vindo do webhook
// do Post for Me ou da conferência manual) e avisa os webhooks do time.
// Usado pela função `api` (sync) e pela `pfm-webhook`.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { friendlyError } from "./friendly.ts";
import type { PfmResult } from "./pfm.ts";
import { background } from "./util.ts";
import { emit } from "./webhooks-time.ts";

type Db = SupabaseClient;

// Grava o resultado em post_targets. Devolve o id do post (ou null se não é nosso).
export async function applyResult(db: Db, r: PfmResult): Promise<{ postId: string; teamId: string } | null> {
  if (!r?.post_id || !r.social_account_id) return null;
  const { data: post } = await db.from("posts").select("id, team_id").eq("pfm_post_id", r.post_id).maybeSingle();
  if (!post) return null;
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
  if (error) { console.error("post_targets upsert", error.message); return null; }
  background(notifyTarget(db, post.team_id as string, post.id as string, row).catch((e) => console.error("webhooks", e)));
  return { postId: post.id as string, teamId: post.team_id as string };
}

async function notifyTarget(db: Db, teamId: string, postId: string, row: { account_id: string; status: string; permalink: string | null; platform_post_id: string | null; error: string | null; published_at: string | null }) {
  const [{ data: acc }, { data: post }] = await Promise.all([
    db.from("accounts").select("username, platform").eq("id", row.account_id).maybeSingle(),
    db.from("posts").select("title, placement, scheduled_at").eq("id", postId).maybeSingle(),
  ]);
  await emit(db, teamId, row.status === "published" ? "post.published" : "post.failed", {
    post_id: postId,
    title: post?.title ?? null,
    placement: post?.placement ?? null,
    scheduled_at: post?.scheduled_at ?? null,
    account_id: row.account_id,
    username: acc?.username ?? null,
    platform: acc?.platform ?? null,
    status: row.status,
    permalink: row.permalink,
    platform_post_id: row.platform_post_id,
    error: row.error,
    published_at: row.published_at,
  });
  await notifyCompleted(db, teamId, postId);
}

// "post.completed" sai uma vez só: quem marca completed_at (de null) avisa.
export async function notifyCompleted(db: Db, teamId: string, postId: string) {
  const { data: targets } = await db.from("post_targets").select("status").eq("post_id", postId);
  const list = targets ?? [];
  if (!list.length || list.some((t) => t.status === "pending")) return;
  const { data: marked } = await db.from("posts").update({ completed_at: new Date().toISOString() }).eq("id", postId).is("completed_at", null).select("id, title, status").maybeSingle();
  if (!marked) return;
  const published = list.filter((t) => t.status === "published").length;
  await emit(db, teamId, "post.completed", {
    post_id: postId,
    title: marked.title ?? null,
    status: published === list.length ? "published" : published === 0 ? "failed" : "partial",
    targets: { total: list.length, published, failed: list.length - published, pending: 0 },
  });
}

// Estado do post a partir dos resultados (para o webhook do Post for Me).
export async function refreshPostStatus(db: Db, postId: string) {
  const { data: targets } = await db.from("post_targets").select("status").eq("post_id", postId);
  const pending = (targets ?? []).filter((t) => t.status === "pending").length;
  await db.from("posts").update({ status: pending === 0 ? "processed" : "processing" }).eq("id", postId);
}
