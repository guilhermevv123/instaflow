// InstaFlow · recebe os avisos do Post for Me (publicou / falhou / conta mudou).
// O Post for Me espera a resposta em 1 segundo, então respondemos na hora e
// processamos em segundo plano.

import type { PfmAccount, PfmPost, PfmResult } from "../_shared/pfm.ts";
import { applyResult, refreshPostStatus } from "../_shared/resultados.ts";
import { background, serviceClient, teamOf, timingSafeEqual } from "../_shared/util.ts";
import { emit } from "../_shared/webhooks-time.ts";
import { isSupported } from "../_shared/redes.ts";

type Db = ReturnType<typeof serviceClient>;

interface Event {
  event_type: string;
  data: unknown;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  const db = serviceClient();

  const given = req.headers.get("post-for-me-webhook-secret") ?? "";
  const { data: saved } = await db.from("app_settings").select("value").eq("key", "pfm_webhook").maybeSingle();
  const expected = (saved?.value as { secret?: string } | null)?.secret ?? "";
  if (!expected || !given || !timingSafeEqual(given, expected)) {
    return new Response(JSON.stringify({ error: "segredo inválido" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }

  let event: Event;
  try {
    event = (await req.json()) as Event;
  } catch {
    return new Response(JSON.stringify({ error: "JSON inválido" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  background(handle(db, event));
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
});

async function handle(db: Db, event: Event) {
  const { data: logged } = await db.from("webhook_events")
    .insert({ event_type: event.event_type, payload: event.data as Record<string, unknown> })
    .select("id").single();
  try {
    switch (event.event_type) {
      case "social.post.result.created":
        await onResult(db, event.data as PfmResult);
        break;
      case "social.post.updated":
      case "social.post.created":
        await onPost(db, event.data as PfmPost);
        break;
      case "social.account.created":
      case "social.account.updated":
        await onAccount(db, event.data as PfmAccount);
        break;
      default:
        console.log("evento ignorado", event.event_type);
    }
    if (logged) await db.from("webhook_events").update({ processed: true }).eq("id", logged.id);
  } catch (e) {
    console.error("webhook", event.event_type, e);
    if (logged) await db.from("webhook_events").update({ error: (e as Error).message }).eq("id", logged.id);
  }
}

// Grava o resultado (e avisa os webhooks do time) e recalcula o estado do post.
async function onResult(db: Db, r: PfmResult) {
  const applied = await applyResult(db, r);
  if (applied) await refreshPostStatus(db, applied.postId);
}

async function onPost(db: Db, p: PfmPost) {
  if (!p?.id) return;
  const status = ["draft", "scheduled", "processing", "processed"].includes(p.status) ? p.status : null;
  if (!status) return;
  // Quando o Post for Me marca "processed" mas alguma conta ficou sem resultado,
  // deixamos "processing" para o botão "Atualizar" da Fila buscar o que falta.
  const { data: post } = await db.from("posts").select("id").eq("pfm_post_id", p.id).maybeSingle();
  if (!post) return;
  if (status === "processed") {
    const { data: targets } = await db.from("post_targets").select("status").eq("post_id", post.id);
    const pending = (targets ?? []).filter((t) => t.status === "pending").length;
    if (pending > 0) return;
  }
  await db.from("posts").update({ status }).eq("id", post.id);
}

async function onAccount(db: Db, a: PfmAccount) {
  if (!a?.id || !isSupported(a.platform)) return;
  // O time vem do external_id gerado no "Conectar Instagram"; uma conta que já
  // tem time continua nele (quem conectou primeiro fica com ela).
  const { data: existing } = await db.from("accounts").select("team_id").eq("id", a.id).maybeSingle();
  const teamId = existing?.team_id ?? teamOf(a.external_id);
  if (!teamId) { console.log("conta sem time reconhecido", a.id, a.external_id); return; }
  const { data: team } = await db.from("teams").select("id").eq("id", teamId).maybeSingle();
  if (!team) { console.log("time não existe", teamId); return; }
  await db.from("accounts").upsert({
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
  }, { onConflict: "id" });
  background(emit(db, teamId, "account.updated", { account_id: a.id, platform: a.platform, username: a.username, status: a.status, access_token_expires_at: a.access_token_expires_at || null }).catch((e) => console.error("webhooks", e)));
}
