// deno test --allow-env supabase/functions/_shared/pfm_test.ts
import assert from "node:assert/strict";
import { esperaDo429, pfm, PfmError } from "./pfm.ts";

Deno.env.set("POSTFORME_API_KEY", "teste");

const resposta = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
const limite = (reset?: number) => resposta(429, { error: { code: "err:frontline:client:rate_limited", message: "Rate limit exceeded. Please try again later." } }, reset ? { "X-Ratelimit-Limit": "5", "X-Ratelimit-Remaining": "0", "X-Ratelimit-Reset": String(reset) } : {});

Deno.test("429 do Post for Me: espera a janela virar e tenta de novo", async () => {
  const respostas = [limite(), limite(), resposta(200, { data: [{ id: "spc_1" }] })];
  const esperas: number[] = [];
  let chamadas = 0;
  const r = await pfm("/social-accounts", {}, { fetch: () => { chamadas++; return Promise.resolve(respostas.shift()!); }, dormir: (ms) => { esperas.push(ms); return Promise.resolve(); } });
  assert.deepEqual(r, { data: [{ id: "spc_1" }] });
  assert.equal(chamadas, 3);
  assert.equal(esperas.length, 2);
});

Deno.test("429 que não passa: desiste depois de 4 tentativas com o erro do Post for Me", async () => {
  let chamadas = 0;
  await assert.rejects(
    pfm("/social-accounts", {}, { fetch: () => { chamadas++; return Promise.resolve(limite()); }, dormir: () => Promise.resolve() }),
    (e: unknown) => e instanceof PfmError && e.status === 429 && /Rate limit/.test(e.message),
  );
  assert.equal(chamadas, 4);
});

Deno.test("outros erros não são repetidos", async () => {
  let chamadas = 0;
  await assert.rejects(pfm("/x", {}, { fetch: () => { chamadas++; return Promise.resolve(resposta(400, { message: "ruim" })); }, dormir: () => Promise.resolve() }), PfmError);
  assert.equal(chamadas, 1);
});

Deno.test("tempo de espera: usa Retry-After ou X-Ratelimit-Reset, com piso e teto", () => {
  const agora = 1_790_000_000_000;
  assert.equal(esperaDo429(new Headers({ "Retry-After": "2" }), 0, agora), 2000);
  const ateReset = esperaDo429(new Headers({ "X-Ratelimit-Reset": String(agora / 1000 + 1) }), 0, agora);
  assert.ok(ateReset >= 1000 && ateReset <= 1100, String(ateReset)); // até o reset + sorteio curto
  assert.equal(esperaDo429(new Headers({ "X-Ratelimit-Reset": String(agora / 1000 - 5) }), 0, agora), 250); // já virou: piso
  assert.equal(esperaDo429(new Headers({ "Retry-After": "60" }), 0, agora), 3000); // teto
  assert.ok(esperaDo429(new Headers(), 0, agora) >= 1000); // sem cabeçalho: ~1 s (a janela do Post for Me)
  assert.ok(esperaDo429(new Headers(), 2, agora) > esperaDo429(new Headers(), 0, agora));
});
