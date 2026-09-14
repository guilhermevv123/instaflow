// InstaFlow · avisos para o desenvolvedor (webhooks de saída da API pública).
//
// Cada time cadastra URLs (Config → API ou POST /webhooks). Quando algo acontece
// (post publicado numa conta, falhou, terminou em todas; conta mudou), mandamos
// um POST JSON assinado com HMAC-SHA256 do segredo do webhook:
//   X-InstaFlow-Event: post.published
//   X-InstaFlow-Delivery: evt_…
//   X-InstaFlow-Signature: t=<unix>,v1=<hex de HMAC(segredo, "<t>.<corpo>")>
// Até 3 tentativas (1 s e 5 s de espera); 50 falhas seguidas desligam o webhook.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

type Db = SupabaseClient;
export const WEBHOOK_EVENTS = ["post.published", "post.failed", "post.completed", "account.updated", "ping"] as const;
export type WebhookEvent = typeof WEBHOOK_EVENTS[number];

export interface TeamWebhook { id: string; team_id: string; url: string; secret: string; events: string[] | null; active: boolean; failures: number }
export interface WebhookPayload { id: string; type: WebhookEvent; created_at: string; team_id: string; data: Record<string, unknown> }

export async function sign(secret: string, ts: number, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${ts}.${body}`));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Uma tentativa de entrega. Devolve status HTTP (0 = não conectou).
export async function deliverOnce(hook: TeamWebhook, payload: WebhookPayload, fetchImpl: typeof fetch = fetch): Promise<{ status: number; ms: number; error: string | null }> {
  const body = JSON.stringify(payload);
  const ts = Math.floor(Date.now() / 1000);
  const t0 = Date.now();
  try {
    const res = await fetchImpl(hook.url, {
      method: "POST",
      signal: AbortSignal.timeout(10_000),
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "InstaFlow-Webhooks/1.0",
        "X-InstaFlow-Event": payload.type,
        "X-InstaFlow-Delivery": payload.id,
        "X-InstaFlow-Signature": `t=${ts},v1=${await sign(hook.secret, ts, body)}`,
      },
      body,
    });
    await res.text().catch(() => "");
    return { status: res.status, ms: Date.now() - t0, error: res.ok ? null : `HTTP ${res.status}` };
  } catch (e) {
    const name = (e as Error)?.name;
    return { status: 0, ms: Date.now() - t0, error: name === "TimeoutError" || name === "AbortError" ? "não respondeu em 10 s" : (e as Error).message.slice(0, 200) };
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function deliver(db: Db, hook: TeamWebhook, payload: WebhookPayload, fetchImpl: typeof fetch = fetch, waits = [1000, 5000]) {
  let last = { status: 0, ms: 0, error: "sem tentativa" as string | null };
  for (let attempt = 1; attempt <= waits.length + 1; attempt++) {
    last = await deliverOnce(hook, payload, fetchImpl);
    await db.from("webhook_deliveries").insert({ webhook_id: hook.id, team_id: hook.team_id, event_id: payload.id, event: payload.type, attempt, status: last.status || null, ms: last.ms, error: last.error });
    if (!last.error) break;
    if (attempt <= waits.length) await sleep(waits[attempt - 1]);
  }
  const ok = !last.error;
  const failures = ok ? 0 : (hook.failures ?? 0) + 1;
  await db.from("team_webhooks").update({ last_status: last.status || null, last_error: last.error, last_at: new Date().toISOString(), failures, ...(failures >= 50 ? { active: false } : {}) }).eq("id", hook.id);
  return { ok, ...last, attempts: Math.min(waits.length + 1, ok ? 1 : waits.length + 1) };
}

export function makePayload(teamId: string, type: WebhookEvent, data: Record<string, unknown>): WebhookPayload {
  return { id: `evt_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`, type, created_at: new Date().toISOString(), team_id: teamId, data };
}

// Manda um evento para todos os webhooks ativos do time que o assinam.
export async function emit(db: Db, teamId: string, type: WebhookEvent, data: Record<string, unknown>, fetchImpl: typeof fetch = fetch) {
  const { data: hooks, error } = await db.from("team_webhooks").select("id, team_id, url, secret, events, active, failures").eq("team_id", teamId).eq("active", true);
  if (error) { console.error("team_webhooks:", error.message); return 0; }
  const list = ((hooks ?? []) as TeamWebhook[]).filter((h) => !h.events?.length || h.events.includes(type) || h.events.includes("*"));
  if (!list.length) return 0;
  const payload = makePayload(teamId, type, data);
  await Promise.all(list.map((h) => deliver(db, h, payload, fetchImpl).catch((e) => console.error("webhook", h.id, e))));
  return list.length;
}
