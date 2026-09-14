// deno test --allow-env supabase/functions/_shared/util_test.ts
import assert from "node:assert/strict";
import { accountAllowed, API_KEY_RE, type Caller, canWrite, isApiKeyRequest, randomToken, sha256Hex } from "./util.ts";

Deno.test("chave de API: formato ifk_ + 40, sem repetir", () => {
  const vistas = new Set<string>();
  for (let i = 0; i < 2000; i++) {
    const k = randomToken("ifk_", 40);
    assert.ok(API_KEY_RE.test(k), k);
    vistas.add(k);
  }
  assert.equal(vistas.size, 2000);
  assert.ok(/^whsec_[A-Za-z0-9]{32}$/.test(randomToken("whsec_", 32)));
});

Deno.test("hash da chave: SHA-256 em hexadecimal", async () => {
  assert.equal(await sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

Deno.test("reconhece chamada com chave (e não confunde com o login do painel)", () => {
  const k = randomToken("ifk_", 40);
  assert.equal(isApiKeyRequest(new Request("https://x", { headers: { Authorization: `Bearer ${k}` } })), true);
  assert.equal(isApiKeyRequest(new Request("https://x", { headers: { Authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.e30.x" } })), false);
  assert.equal(isApiKeyRequest(new Request("https://x")), false);
});

Deno.test("permissões da chave: só leitura e contas liberadas", () => {
  const base: Caller = { id: null, email: "", teamId: "t1", teamName: "T", role: "api", maxAccounts: 20, maxPostsMonth: 1000, via: "key" };
  const livre: Caller = { ...base, apiKey: { id: "k", name: "n", prefix: "ifk_", scopes: [], accountIds: null, rateLimit: 120, count: 1, reset: "" } };
  const leitura: Caller = { ...base, apiKey: { ...livre.apiKey!, scopes: ["read"], accountIds: ["spc_1"] } };
  assert.equal(canWrite(livre), true); assert.equal(canWrite(leitura), false);
  assert.equal(accountAllowed(livre, "spc_9"), true);
  assert.equal(accountAllowed(leitura, "spc_1"), true); assert.equal(accountAllowed(leitura, "spc_9"), false);
  const painel: Caller = { ...base, id: "u1", role: "owner", via: "jwt" };
  assert.equal(canWrite(painel), true); assert.equal(accountAllowed(painel, "qualquer"), true);
});
