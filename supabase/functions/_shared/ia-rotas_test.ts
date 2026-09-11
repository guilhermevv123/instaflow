// deno test --allow-env --allow-net supabase/functions/_shared/ia-rotas_test.ts
import assert from "node:assert/strict";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { AI_DAILY_LIMIT, aiRemove, aiSave, aiStatus, varyCaptions } from "./ia-rotas.ts";
import { IaError } from "./ia.ts";
import { type Caller, HttpError } from "./util.ts";

// Banco falso só com o que as rotas usam (team_ai_keys e ai_calls).
function fakeDb() {
  const st = { keys: new Map<string, Record<string, unknown>>(), calls: [] as Record<string, unknown>[] };
  const db = {
    from(table: string) {
      const f: Array<[string, string, unknown]> = [];
      let op = "select", payload: Record<string, unknown> | null = null, head = false;
      const run = () => {
        const team = f.find(([, k]) => k === "team_id")?.[2] as string;
        if (table === "team_ai_keys") {
          if (op === "select") return { data: st.keys.get(team) ?? null, error: null };
          if (op === "upsert") { st.keys.set(payload!.team_id as string, { ...payload }); return { data: null, error: null }; }
          if (op === "update") { st.keys.set(team, { ...st.keys.get(team), ...payload }); return { data: null, error: null }; }
          if (op === "delete") { st.keys.delete(team); return { data: null, error: null }; }
        }
        if (table === "ai_calls") {
          if (op === "insert") { st.calls.push({ ...payload, created_at: new Date().toISOString() }); return { data: null, error: null }; }
          const since = f.find(([o]) => o === "gte")?.[2] as string;
          const n = st.calls.filter((c) => c.team_id === team && (!since || String(c.created_at) >= since)).length;
          return head ? { count: n, data: null, error: null } : { data: [], error: null };
        }
        return { data: null, error: { message: `tabela inesperada ${table}` } };
      };
      const q: Record<string, unknown> = {
        select(_c?: string, o?: { head?: boolean }) { head = Boolean(o?.head); return q; },
        eq(k: string, v: unknown) { f.push(["eq", k, v]); return q; },
        gte(k: string, v: unknown) { f.push(["gte", k, v]); return q; },
        insert(p: Record<string, unknown>) { op = "insert"; payload = p; return q; },
        upsert(p: Record<string, unknown>) { op = "upsert"; payload = p; return q; },
        update(p: Record<string, unknown>) { op = "update"; payload = p; return q; },
        delete() { op = "delete"; return q; },
        maybeSingle() { return Promise.resolve(run()); },
        then(ok: (v: unknown) => unknown, err: (e: unknown) => unknown) { return Promise.resolve(run()).then(ok, err); },
      };
      return q;
    },
  };
  return { db: db as unknown as SupabaseClient, st };
}
const dono: Caller = { id: "u1", email: "dono@x", teamId: "t1", teamName: "Time", role: "owner", maxAccounts: 20, maxPostsMonth: 1000 };
const editor: Caller = { ...dono, id: "u2", role: "editor" };
const KEY = "AIzaSyA1234567890abcdefghijklmnopqrstu";
const httpErr = (status: number, code?: string) => (e: unknown) => e instanceof HttpError && e.status === status && (code === undefined || e.code === code);

Deno.test("estado: sem IA; só dono/admin pode mexer; a chave nunca volta inteira", async () => {
  const { db } = fakeDb();
  const s = await aiStatus(db, editor);
  assert.equal(s.configured, false); assert.equal(s.can_edit, false); assert.equal(s.limit_day, AI_DAILY_LIMIT);
  await assert.rejects(aiSave(db, editor, { key: KEY }, async () => ({ text: "ok", model: "x" })), httpErr(403));
  await assert.rejects(aiRemove(db, editor), httpErr(403));
});

Deno.test("salvar: chave estranha não passa; recusada não grava; aceita grava com o modelo que respondeu", async () => {
  const { db, st } = fakeDb();
  await assert.rejects(aiSave(db, dono, { key: "" }), httpErr(400));
  await assert.rejects(aiSave(db, dono, { key: "AIza com espaço 1234567890abcdef" }), httpErr(400));
  await assert.rejects(aiSave(db, dono, { key: "sbp_EXEMPLO_QUE_NAO_E_CHAVE_DE_VERDADE_00" }), httpErr(400));
  await assert.rejects(aiSave(db, dono, { key: KEY }, async () => { throw new IaError("chave", 400, "API key not valid"); }), httpErr(400, "ia_chave"));
  assert.equal(st.keys.size, 0);
  const s = await aiSave(db, dono, { key: KEY }, async (a) => { assert.equal(a.provider, "gemini"); assert.equal(a.allowEmpty, true); return { text: "ok", model: "gemini-flash-latest" }; });
  assert.equal(s.configured, true); assert.equal(s.provider_label, "Google Gemini"); assert.equal(s.model, "gemini-flash-latest");
  assert.equal(s.key_hint, "AIza…rstu"); assert.equal(s.warning, null);
  assert.ok(!JSON.stringify(s).includes(KEY), "a resposta não pode trazer a chave");
  assert.equal(st.keys.get("t1")!.api_key, KEY);
});

Deno.test("salvar com a cota do dia esgotada: grava e avisa", async () => {
  const { db, st } = fakeDb();
  const s = await aiSave(db, dono, { key: KEY }, async () => { throw new IaError("cota", 429, "Resource exhausted"); });
  assert.equal(s.configured, true); assert.ok(String(s.warning).includes("cota")); assert.equal(st.keys.get("t1")!.model, "gemini-2.5-flash");
  const off = await aiRemove(db, dono);
  assert.equal(off.configured, false);
});

Deno.test("variar: sem IA = 409 sem_ia; com IA devolve só versões válidas, registra o uso e guarda o modelo novo", async () => {
  const { db, st } = fakeDb();
  const caption = "Big Lobo 44144 com a Bahia! #Bahia";
  await assert.rejects(varyCaptions(db, editor, { caption, count: 3 }), httpErr(409, "sem_ia"));
  await assert.rejects(varyCaptions(db, editor, { caption: "  ", count: 3 }), httpErr(400));
  await assert.rejects(varyCaptions(db, editor, { caption, count: 0 }), httpErr(400));
  await assert.rejects(varyCaptions(db, editor, { caption, count: 50 }), httpErr(400));
  st.keys.set("t1", { team_id: "t1", provider: "gemini", api_key: KEY, model: "gemini-2.5-flash", updated_at: "x" });
  const r = await varyCaptions(db, editor, { caption, count: 3 }, async (a) => {
    assert.equal(a.preferred, "gemini-2.5-flash"); assert.equal(a.json, true); assert.ok(a.user.includes("Quantidade de versões: 3"));
    return { text: JSON.stringify({ variacoes: ["Com a Bahia, Big Lobo 44144! #Bahia", "Big Lobo 4414 com a Bahia! #Bahia", "Pela Bahia: Big Lobo 44144!"] }), model: "gemini-flash-latest" };
  });
  assert.deepEqual(r.variations, ["Com a Bahia, Big Lobo 44144! #Bahia", "Pela Bahia: Big Lobo 44144!\n\n#Bahia"]);
  assert.equal(r.provider_label, "Google Gemini");
  assert.equal(st.calls.length, 1); assert.equal(st.calls[0].returned, 2); assert.equal(st.calls[0].ok, true);
  assert.equal(st.keys.get("t1")!.model, "gemini-flash-latest");
});

Deno.test("variar: cota esgotada vira 429 ia_cota e conta no uso; passou do limite diário = 429 limite_ia", async () => {
  const { db, st } = fakeDb();
  st.keys.set("t1", { team_id: "t1", provider: "groq", api_key: "gsk_x", model: null, updated_at: "x" });
  await assert.rejects(varyCaptions(db, dono, { caption: "Oi", count: 2 }, async () => { throw new IaError("cota", 429, "rate limit"); }), httpErr(429, "ia_cota"));
  assert.equal(st.calls.length, 1); assert.equal(st.calls[0].ok, false);
  for (let i = 0; i < AI_DAILY_LIMIT; i++) st.calls.push({ team_id: "t1", created_at: new Date().toISOString() });
  await assert.rejects(varyCaptions(db, dono, { caption: "Oi", count: 2 }, async () => ({ text: "{}", model: "m" })), httpErr(429, "limite_ia"));
});
