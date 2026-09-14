// deno test --allow-env supabase/functions/_shared/webhooks-time_test.ts
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { deliver, deliverOnce, emit, makePayload, sign, type TeamWebhook } from "./webhooks-time.ts";

const hook = (over: Partial<TeamWebhook> = {}): TeamWebhook => ({ id: "wh1", team_id: "t1", url: "https://exemplo.test/hook", secret: "whsec_teste", events: [], active: true, failures: 0, ...over });

// Banco falso: team_webhooks (select/update) e webhook_deliveries (insert).
function fakeDb(hooks: TeamWebhook[]) {
  const st = { hooks, deliveries: [] as Record<string, unknown>[], updates: [] as Record<string, unknown>[] };
  const db = {
    from(table: string) {
      let op = "select", payload: Record<string, unknown> | null = null;
      const f: Record<string, unknown> = {};
      const run = () => {
        if (table === "webhook_deliveries") { st.deliveries.push(payload!); return { data: null, error: null }; }
        if (table === "team_webhooks" && op === "update") { st.updates.push({ id: f.id, ...payload }); return { data: null, error: null }; }
        return { data: st.hooks.filter((h) => h.team_id === f.team_id && (f.active === undefined || h.active === f.active)), error: null };
      };
      const q: Record<string, unknown> = {
        select() { return q; },
        insert(p: Record<string, unknown>) { op = "insert"; payload = p; return q; },
        update(p: Record<string, unknown>) { op = "update"; payload = p; return q; },
        eq(k: string, v: unknown) { f[k] = v; return q; },
        then(ok: (v: unknown) => unknown, err: (e: unknown) => unknown) { return Promise.resolve(run()).then(ok, err); },
      };
      return q;
    },
  };
  return { db: db as unknown as SupabaseClient, st };
}

Deno.test("assinatura: HMAC-SHA256 de \"<t>.<corpo>\" com o segredo, em hexadecimal", async () => {
  const esperado = createHmac("sha256", "whsec_teste").update('1700000000.{"a":1}').digest("hex");
  assert.equal(await sign("whsec_teste", 1700000000, '{"a":1}'), esperado);
});

Deno.test("entrega: manda JSON com os cabeçalhos do InstaFlow e a assinatura confere", async () => {
  let visto: Request | null = null, corpo = "";
  const payload = makePayload("t1", "post.published", { post_id: "p1" });
  const r = await deliverOnce(hook(), payload, async (input, init) => { visto = new Request(input, init); corpo = await visto.clone().text(); return new Response("ok", { status: 200 }); });
  assert.equal(r.status, 200); assert.equal(r.error, null);
  const req = visto as unknown as Request;
  assert.equal(req.headers.get("x-instaflow-event"), "post.published");
  assert.equal(req.headers.get("x-instaflow-delivery"), payload.id);
  const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(req.headers.get("x-instaflow-signature") ?? "");
  assert.ok(m, "formato t=…,v1=…");
  assert.equal(m![2], createHmac("sha256", "whsec_teste").update(`${m![1]}.${corpo}`).digest("hex"));
  assert.deepEqual(JSON.parse(corpo), payload);
});

Deno.test("entrega: tenta de novo quando falha, registra cada tentativa e zera as falhas quando dá certo", async () => {
  const { db, st } = fakeDb([hook({ failures: 3 })]);
  const respostas = [500, 502, 200];
  const r = await deliver(db, hook({ failures: 3 }), makePayload("t1", "post.failed", {}), async () => new Response("", { status: respostas.shift()! }), [0, 0]);
  assert.equal(r.ok, true);
  assert.deepEqual(st.deliveries.map((d) => [d.attempt, d.status]), [[1, 500], [2, 502], [3, 200]]);
  assert.equal(st.updates.at(-1)!.failures, 0);
});

Deno.test("entrega: sem conexão conta falha; na 50ª seguida o webhook é desligado", async () => {
  const { db, st } = fakeDb([]);
  const r = await deliver(db, hook({ failures: 49 }), makePayload("t1", "ping", {}), async () => { throw new TypeError("connection refused"); }, []);
  assert.equal(r.ok, false); assert.equal(r.status, 0);
  assert.equal(st.updates.at(-1)!.failures, 50); assert.equal(st.updates.at(-1)!.active, false);
});

Deno.test("emitir: só os webhooks ativos do time que assinam o evento (lista vazia = todos)", async () => {
  const { db } = fakeDb([hook({ id: "todos" }), hook({ id: "so-falhas", events: ["post.failed"] }), hook({ id: "outro-time", team_id: "t2" }), hook({ id: "desligado", active: false })]);
  const urls: string[] = [];
  const n = await emit(db, "t1", "post.published", { post_id: "p1" }, async (input) => { urls.push(String(input)); return new Response(null, { status: 204 }); });
  assert.equal(n, 1);
  assert.equal(urls.length, 1);
});
