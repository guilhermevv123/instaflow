// node --test tests/  — leitura em páginas (docs/assets/paginar.js)
import { test } from "node:test";
import assert from "node:assert/strict";
import { todas } from "../docs/assets/paginar.js";

// imita o PostgREST do Supabase: nunca devolve mais que `teto` linhas por pedido
const fonte = (linhas, teto = 1000) => (de, ate) => Promise.resolve({ data: linhas.slice(de, Math.min(ate + 1, de + teto)), error: null });
const n = (k) => Array.from({ length: k }, (_, i) => ({ i }));

test("junta tudo quando passa de 1000 linhas (90 dias de retratos)", async () => {
  const r = await todas(fonte(n(2537)));
  assert.equal(r.error, null);
  assert.equal(r.data.length, 2537);
  assert.deepEqual(r.data.at(-1), { i: 2536 });
});

test("15 mil linhas (30 dias reais de post_metrics_daily) chegam inteiras e em ordem", async () => {
  const r = await todas(fonte(n(14944)));
  assert.equal(r.data.length, 14944);
  assert.ok(r.data.every((x, i) => x.i === i));
});

test("uma página só quando cabe", async () => {
  let pedidos = 0;
  const f = fonte(n(620));
  const r = await todas((de, ate) => { pedidos++; return f(de, ate); }, { lote: 1 });
  assert.equal(r.data.length, 620);
  assert.equal(pedidos, 1);
});

test("múltiplo exato de 1000 termina com uma página vazia", async () => {
  const r = await todas(fonte(n(2000)));
  assert.equal(r.data.length, 2000);
});

test("respeita o máximo pedido", async () => {
  const r = await todas(fonte(n(5000)), { max: 2000 });
  assert.equal(r.data.length, 2000);
});

test("erro em qualquer página volta como erro", async () => {
  const f = fonte(n(3000));
  const r = await todas((de, ate) => (de >= 1000 ? Promise.resolve({ data: null, error: { message: "statement timeout" } }) : f(de, ate)));
  assert.equal(r.error.message, "statement timeout");
});
