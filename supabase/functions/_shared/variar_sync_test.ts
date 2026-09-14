// deno test --allow-read supabase/functions/_shared/variar_sync_test.ts
// O gerador automático roda no painel (docs/assets/variar.js) e na API
// (_shared/variar.js). Os dois arquivos precisam ser idênticos.
import assert from "node:assert/strict";
import { variarLegenda } from "./variar.js";

Deno.test("variar.js da API é cópia exata do painel", async () => {
  const api = await Deno.readTextFile(new URL("./variar.js", import.meta.url));
  const painel = await Deno.readTextFile(new URL("../../../docs/assets/variar.js", import.meta.url));
  assert.equal(api, painel, "rode: cp docs/assets/variar.js supabase/functions/_shared/variar.js");
});

Deno.test("gerador automático: frase curta ganha outra redação, não só emoji", () => {
  const caption = "Mais um Baratino de Jero!!1 🙌";
  const { variacoes } = variarLegenda(caption, 3, { seed: 11 }) as { variacoes: string[] };
  assert.ok(variacoes.some((v) => v.startsWith("Outro Baratino de Jero")), JSON.stringify(variacoes));
  assert.ok(!variacoes.includes(caption));
});

Deno.test("gerador automático: versões diferentes entre si e da original, sem mexer em número, @ e #", () => {
  const caption = "Obrigado a todos, pessoal! Muito obrigado mesmo pelo apoio @biglobo 🙏\n\n#Bahia #44144";
  const { variacoes } = variarLegenda(caption, 6, { seed: 7 }) as { variacoes: string[] };
  assert.equal(variacoes.length, 6);
  assert.equal(new Set(variacoes).size, 6);
  for (const v of variacoes) {
    assert.notEqual(v, caption);
    assert.ok(v.includes("@biglobo") && v.includes("#Bahia") && v.includes("#44144"));
  }
});
