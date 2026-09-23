// deno test --allow-env --allow-net supabase/functions/_shared/ia-rotas_test.ts
import assert from "node:assert/strict";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { AI_DAILY_LIMIT, aiModels, aiRemove, aiSave, aiSetModel, aiStatus, varyCaptions } from "./ia-rotas.ts";
import { IaError, type IaModel } from "./ia.ts";
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
const dono: Caller = { id: "u1", email: "dono@x", teamId: "t1", teamName: "Time", role: "owner", maxAccounts: 20, maxPostsMonth: 1000, via: "jwt" };
const editor: Caller = { ...dono, id: "u2", role: "editor" };
const chave: Caller = { ...dono, id: null, email: "chave:teste", role: "api", via: "key" };
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

Deno.test("variar (mode ai): sem IA = 409 sem_ia; com IA devolve só versões válidas, tenta de novo o que faltou e não troca o modelo escolhido", async () => {
  const { db, st } = fakeDb();
  const caption = "Big Lobo 44144 com a Bahia! #Bahia";
  await assert.rejects(varyCaptions(db, editor, { caption, count: 3, mode: "ai" }), httpErr(409, "sem_ia"));
  await assert.rejects(varyCaptions(db, editor, { caption: "  ", count: 3 }), httpErr(400));
  await assert.rejects(varyCaptions(db, editor, { caption, count: 0 }), httpErr(400));
  await assert.rejects(varyCaptions(db, editor, { caption, count: 50 }), httpErr(400));
  await assert.rejects(varyCaptions(db, editor, { caption, count: 2, mode: "gpt" }), httpErr(400));
  st.keys.set("t1", { team_id: "t1", provider: "gemini", api_key: KEY, model: "gemini-2.5-flash", updated_at: "x" });
  const pedidos: string[] = [];
  const r = await varyCaptions(db, editor, { caption, count: 3, mode: "ai" }, async (a) => {
    assert.equal(a.preferred, "gemini-2.5-flash"); assert.equal(a.json, true);
    pedidos.push(a.user.match(/Quantidade de versões: (\d+)/)![1]);
    return pedidos.length === 1
      ? { text: JSON.stringify({ variacoes: ["Com a Bahia, Big Lobo 44144! #Bahia", "Big Lobo 4414 com a Bahia! #Bahia", "Pela Bahia: Big Lobo 44144!"] }), model: "gemini-flash-latest" }
      : { text: JSON.stringify({ variacoes: ["Big Lobo 44144, sempre ao lado da Bahia! #Bahia"] }), model: "gemini-flash-latest" };
  });
  assert.deepEqual(pedidos, ["3", "1"], "a 2ª rodada pede só a que faltou");
  assert.deepEqual(r.variations, ["Com a Bahia, Big Lobo 44144! #Bahia", "Pela Bahia: Big Lobo 44144!\n\n#Bahia", "Big Lobo 44144, sempre ao lado da Bahia! #Bahia"]);
  assert.equal(r.provider_label, "Google Gemini"); assert.equal(r.ai_count, 3);
  assert.equal(st.calls.length, 2); assert.equal(st.calls[0].returned, 2); assert.equal(st.calls[1].requested, 1); assert.equal(st.calls[1].returned, 1);
  assert.equal(st.keys.get("t1")!.model, "gemini-2.5-flash", "o modelo escolhido em Config fica, mesmo que outro tenha respondido");
});

Deno.test("variar (mode ai): cota esgotada vira 429 ia_cota e conta no uso; passou do limite diário = 429 limite_ia", async () => {
  const { db, st } = fakeDb();
  st.keys.set("t1", { team_id: "t1", provider: "groq", api_key: "gsk_x", model: null, updated_at: "x" });
  await assert.rejects(varyCaptions(db, dono, { caption: "Oi", count: 2, mode: "ai" }, async () => { throw new IaError("cota", 429, "rate limit"); }), httpErr(429, "ia_cota"));
  assert.equal(st.calls.length, 1); assert.equal(st.calls[0].ok, false);
  for (let i = 0; i < AI_DAILY_LIMIT; i++) st.calls.push({ team_id: "t1", created_at: new Date().toISOString() });
  await assert.rejects(varyCaptions(db, dono, { caption: "Oi", count: 2, mode: "ai" }, async () => ({ text: "{}", model: "m" })), httpErr(429, "limite_ia"));
});

Deno.test("variar (auto, padrão da API): sem IA usa o gerador automático; com IA falhando avisa e completa", async () => {
  const { db, st } = fakeDb();
  const caption = "Continue firme, Big! Vamos juntos pela Bahia 💪 #Bahia #44144";
  // o painel (login) sem mode continua pedindo só a IA
  await assert.rejects(varyCaptions(db, dono, { caption, count: 2 }), httpErr(409, "sem_ia"));
  const r = await varyCaptions(db, chave, { caption, count: 4 });
  assert.equal(r.source, "local"); assert.equal(r.variations.length, 4); assert.equal(r.ai_count, 0); assert.equal(r.provider, null);
  assert.equal(new Set(r.variations).size, 4, "sem repetidas");
  for (const v of r.variations) { assert.notEqual(v, caption); assert.ok(v!.includes("#Bahia") && v!.includes("#44144")); }
  const so = await varyCaptions(db, dono, { caption, count: 2, mode: "local" });
  assert.equal(so.source, "local"); assert.equal(st.calls.length, 0, "gerador automático não conta como uso de IA");
  st.keys.set("t1", { team_id: "t1", provider: "gemini", api_key: KEY, model: null, updated_at: "x" });
  const falhou = await varyCaptions(db, chave, { caption, count: 3 }, async () => { throw new IaError("rede", 0, "sem conexão com o provedor"); });
  assert.equal(falhou.source, "local"); assert.equal(falhou.variations.length, 3); assert.ok(String(falhou.warning).includes("gerador automático"));
  const misto = await varyCaptions(db, chave, { caption, count: 3 }, async () => ({ text: JSON.stringify({ variacoes: ["Vamos juntos pela Bahia! Continue firme, Big 💪\n\n#44144 #Bahia"] }), model: "gemini-2.5-flash" }));
  assert.equal(misto.source, "mixed"); assert.equal(misto.ai_count, 1); assert.equal(misto.local_count, 2); assert.equal(misto.variations.length, 3);
});

Deno.test("variar: a IA não pode devolver a mesma frase só trocando emoji ou pontuação", async () => {
  const { db, st } = fakeDb();
  st.keys.set("t1", { team_id: "t1", provider: "gemini", api_key: KEY, model: null, updated_at: "x" });
  const caption = "Mais um Baratino de Jero!!1 🙌";
  const r = await varyCaptions(db, dono, { caption, count: 3, mode: "ai" }, async () => ({
    text: JSON.stringify({ variacoes: ["Mais um Baratino de Jero!! 🙌", "Mais um Baratino de Jero!!1 👏", "Chegou mais um Baratino de Jero! 🙌", "Mais um Baratino de Jero!!1 🙌"] }),
    model: "gemini-2.5-flash",
  }));
  assert.deepEqual(r.variations, ["Chegou mais um Baratino de Jero! 🙌"]);
});

Deno.test("variar com estilo por conta: prompt leva a lista na ordem e a resposta mantém a posição de cada conta", async () => {
  const { db, st } = fakeDb();
  st.keys.set("t1", { team_id: "t1", provider: "openrouter", api_key: "sk-or-x", model: "openai/gpt-4.1-mini", updated_at: "x" });
  const caption = "Hoje tem show do Big Lobo na praça, venha curtir com a gente! #Bahia";
  await assert.rejects(varyCaptions(db, dono, { caption, count: 3, styles: ["a", "b"] }), httpErr(400));
  await assert.rejects(varyCaptions(db, dono, { caption, count: 1, styles: ["x".repeat(301)] }), httpErr(400));
  const users: string[] = [];
  const r = await varyCaptions(db, dono, { caption, count: 3, mode: "ai", styles: ["descontraído, com gírias baianas", null, "formal"] }, async (a) => {
    users.push(a.user);
    if (users.length === 1) {
      assert.ok(a.system.includes("jeito de escrever"));
      assert.ok(a.user.includes("1. descontraído, com gírias baianas\n2. como o original\n3. formal"), a.user);
      // a 2ª só trocou emoji: fica de fora e volta na 2ª rodada, na mesma posição
      return { text: JSON.stringify({ variacoes: ["Oxe, hoje o Big Lobo faz show na praça, bora curtir junto! #Bahia", "Hoje tem show do Big Lobo na praça, venha curtir com a gente! 🎉 #Bahia", "Convidamos todos para o show do Big Lobo hoje, na praça. #Bahia"] }), model: "m" };
    }
    // só falta a conta sem estilo: pede 1 versão, sem lista de estilos
    assert.ok(a.user.includes("Quantidade de versões: 1") && !a.user.includes("Estilo de cada versão"), a.user);
    return { text: JSON.stringify({ variacoes: ["Show do Big Lobo hoje na praça: vem curtir com a gente! #Bahia"] }), model: "m" };
  });
  assert.equal(users.length, 2);
  assert.deepEqual(r.variations, [
    "Oxe, hoje o Big Lobo faz show na praça, bora curtir junto! #Bahia",
    "Show do Big Lobo hoje na praça: vem curtir com a gente! #Bahia",
    "Convidamos todos para o show do Big Lobo hoje, na praça. #Bahia",
  ]);
  // sem 2ª chance útil e só IA: o buraco volta como null na posição dele
  const buraco = await varyCaptions(db, dono, { caption, count: 2, mode: "ai", styles: ["x", "y"] }, async () => ({ text: JSON.stringify({ variacoes: ["Hoje tem o show do Big Lobo na praça, venha curtir conosco! #Bahia", caption] }), model: "m" }));
  assert.deepEqual(buraco.variations, ["Hoje tem o show do Big Lobo na praça, venha curtir conosco! #Bahia", null]);
});

Deno.test("modelos: lista a do provedor do time; trocar exige dono/admin, testa o modelo e só grava se responder", async () => {
  const { db, st } = fakeDb();
  const lista: IaModel[] = [{ id: "openai/gpt-4.1-mini", name: "GPT-4.1 mini", free: false, price_in: 0.4, price_out: 1.6, context: 1_000_000 }];
  await assert.rejects(aiModels(db, dono, async () => lista), httpErr(409, "sem_ia"));
  st.keys.set("t1", { team_id: "t1", provider: "openrouter", api_key: "sk-or-x", model: "google/gemini-2.5-flash", updated_at: "x" });
  const m = await aiModels(db, editor, async (p, k) => { assert.equal(p, "openrouter"); assert.equal(k, "sk-or-x"); return lista; });
  assert.equal(m.current, "google/gemini-2.5-flash"); assert.deepEqual(m.models, lista); assert.ok(!JSON.stringify(m).includes("sk-or-x"));
  await assert.rejects(aiModels(db, dono, async () => { throw new IaError("chave", 401, "bad key"); }), httpErr(400, "ia_chave"));

  await assert.rejects(aiSetModel(db, editor, { model: "openai/gpt-4.1-mini" }, async () => "ok"), httpErr(403));
  await assert.rejects(aiSetModel(db, dono, { model: "rm -rf /" }, async () => "ok"), httpErr(400));
  await assert.rejects(aiSetModel(db, dono, { model: "x/sumiu" }, async () => { throw new IaError("modelo", 404, "No endpoints found"); }), httpErr(400, "ia_modelo"));
  assert.equal(st.keys.get("t1")!.model, "google/gemini-2.5-flash", "recusado não grava");
  const ok = await aiSetModel(db, dono, { model: "openai/gpt-4.1-mini" }, async (a) => { assert.equal(a.model, "openai/gpt-4.1-mini"); return "ok"; });
  assert.equal(ok.model, "openai/gpt-4.1-mini"); assert.equal(ok.warning, null);
  const cota = await aiSetModel(db, dono, { model: "meta-llama/llama-3.3-70b-instruct:free" }, async () => { throw new IaError("cota", 429, "rate limit"); });
  assert.equal(cota.model, "meta-llama/llama-3.3-70b-instruct:free"); assert.ok(cota.warning);
});
