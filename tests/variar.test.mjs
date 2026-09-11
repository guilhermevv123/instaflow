// node --test tests/  — gerador local de variações (docs/assets/variar.js)
import { test } from "node:test";
import assert from "node:assert/strict";
import { variarLegenda, __interno } from "../docs/assets/variar.js";

const tokens = (s) => ({
  nums: (s.replace(/(?:https?:\/\/|www\.)\S+|@[\p{L}\p{N}_.]*[\p{L}\p{N}_]|#[\p{L}\p{N}_]+/gu, " ").match(/\d+(?:[.,:/]\d+)*/g) || []).sort(),
  men: (s.match(/@[\p{L}\p{N}_.]*[\p{L}\p{N}_]/gu) || []).sort(),
  urls: (s.match(/(?:https?:\/\/|www\.)\S+/g) || []).sort(),
  tags: (s.match(/#[\p{L}\p{N}_]+/gu) || []).sort(),
});

test("a legenda real do dono gera 9 versões diferentes, todas com mudança de texto", () => {
  const base = "Quem acompanha sabe que tem trabalho sendo feito. Continue firme, Big!";
  const { variacoes, fracas } = variarLegenda(base, 9, { seed: 1 });
  assert.equal(variacoes.length, 9);
  assert.equal(fracas, 0);
  assert.equal(new Set(variacoes.map((v) => v.toLowerCase())).size, 9);
  for (const v of variacoes) assert.notEqual(v, base);
  assert.ok(variacoes.some((v) => /^Big, /m.test(v)), "alguma move o vocativo para o começo");
  assert.ok(variacoes.some((v) => /[Ss]iga firme|[Ss]egue firme/.test(v)));
});

test("números, @menções, links e #hashtags nunca mudam (hashtags só de ordem)", () => {
  const base = "Vamos juntos! Big Lobo 44144 é compromisso com a Bahia. Confira em https://biglobo.com.br/agenda e siga @big.lobo 💪\n\n#Bahia #44144 #BigLobo #Ilhéus";
  const alvo = tokens(base);
  const { variacoes } = variarLegenda(base, 15, { seed: 7 });
  assert.equal(variacoes.length, 15);
  for (const v of variacoes) assert.deepEqual(tokens(v), alvo, v);
  assert.ok(variacoes.some((v) => !v.endsWith("#Bahia #44144 #BigLobo #Ilhéus")), "alguma reordena as hashtags");
});

test("corações e bandeiras nunca trocam de cor", () => {
  const base = "Bahia no coração ❤️🇧🇷 Vamos juntos! 💪";
  for (const v of variarLegenda(base, 10, { seed: 3 }).variacoes) {
    assert.ok(v.includes("❤️"), v);
    assert.ok(v.includes("🇧🇷"), v);
    assert.ok(!/[💙💚💛🧡💜🖤🤍]/u.test(v), v);
  }
});

test("sem nada para variar, completa com emoji e avisa em `fracas`", () => {
  const base = "Inauguração da ponte neste sábado.";
  const { variacoes, fracas } = variarLegenda(base, 12, { seed: 5 });
  assert.equal(variacoes.length, 12);
  assert.equal(fracas, 12);
  assert.equal(new Set(variacoes).size, 12);
  for (const v of variacoes) assert.ok(v.includes("Inauguração da ponte neste sábado."), v);
});

test("mesma semente = mesmo resultado; outra semente = outro resultado; `evitar` é respeitado", () => {
  const base = "Obrigado a todos que vieram! Com certeza foi incrível. Até breve, Ilhéus! 🙌\n#Ilhéus #Bahia";
  const a = variarLegenda(base, 6, { seed: 11 }).variacoes;
  const b = variarLegenda(base, 6, { seed: 11 }).variacoes;
  const c = variarLegenda(base, 6, { seed: 12 }).variacoes;
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  const d = variarLegenda(base, 6, { seed: 11, evitar: a.slice(0, 3) }).variacoes;
  for (const x of a.slice(0, 3)) assert.ok(!d.map((s) => s.toLowerCase()).includes(x.toLowerCase()));
});

test("não quebra frase em abreviação (Dep., Dr.) nem transforma advérbio em vocativo", () => {
  const { frases, vocativo } = __interno;
  assert.deepEqual(frases("Dep. Big Lobo esteve em Ilhéus. Obrigado, Ilhéus!"), ["Dep. Big Lobo esteve em Ilhéus.", "Obrigado, Ilhéus!"]);
  assert.deepEqual(frases("Continue firme! 💪 Vamos juntos."), ["Continue firme! 💪", "Vamos juntos."]);
  assert.equal(vocativo("Continue firme, Big!"), "Big, continue firme!");
  assert.equal(vocativo("Big, continue firme!"), "Continue firme, Big!");
  assert.equal(vocativo("Pessoal, vamos juntos! 🙌"), "Vamos juntos, pessoal! 🙌");
  assert.equal(vocativo("Vamos juntos, pessoal!"), "Pessoal, vamos juntos!");
  assert.equal(vocativo("Hoje, vamos juntos!"), null);
  assert.equal(vocativo("Ilhéus, 10 de setembro."), null);
  for (const v of variarLegenda("Dep. Big Lobo esteve em Ilhéus. Obrigado, Ilhéus!", 8, { seed: 2 }).variacoes) assert.ok(!/Dep\.\n/.test(v), v);
});

test("troca de expressão respeita maiúscula e não mexe dentro de palavra", () => {
  const { trocarExpressoes } = __interno;
  let seed = 1;
  const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const r = trocarExpressoes("Continue firme e confira!", rng, 2);
  assert.ok(/^(Siga|Segue) firme e confira!$/.test(r.t), r.t); // "confira" no meio da frase não troca
  assert.equal(trocarExpressoes("reconfirado", rng, 2).n, 0);
  assert.equal(trocarExpressoes("Quero que você veja isso.", rng, 2).n, 0);
  assert.ok(/^Pessoal, (veja|olha só) o vídeo!$/.test(trocarExpressoes("Pessoal, confira o vídeo!", rng, 1).t));
});

test("legenda longa: nenhuma versão passa de 2.200 caracteres; texto vazio ou n=0 não gera nada", () => {
  const longa = ("Vamos juntos pela Bahia. ".repeat(80)).trim();
  for (const v of variarLegenda(longa, 5, { seed: 9 }).variacoes) assert.ok(v.length <= 2200);
  assert.deepEqual(variarLegenda("", 5), { variacoes: [], fracas: 0 });
  assert.deepEqual(variarLegenda("Oi", 0), { variacoes: [], fracas: 0 });
});

test("só hashtags: reordena sem inventar texto", () => {
  const base = "#Bahia #44144 #BigLobo";
  const { variacoes } = variarLegenda(base, 3, { seed: 4 });
  assert.ok(variacoes.length >= 3);
  for (const v of variacoes) assert.deepEqual(tokens(v).tags, tokens(base).tags, v);
});

test("verbo que também é descrição não vira ordem ('quem acompanha' nunca vira 'quem acompanhe')", () => {
  const base = "Quem acompanha sabe que tem trabalho sendo feito. Continue firme, Big!";
  for (let seed = 1; seed <= 40; seed++) {
    for (const v of variarLegenda(base, 9, { seed }).variacoes) assert.ok(!/quem acompanhe/i.test(v), v);
  }
  for (const v of variarLegenda("Ele participa e compartilha tudo. Vamos juntos!", 6, { seed: 3 }).variacoes) {
    assert.ok(v.includes("Ele participa e compartilha tudo."), v);
  }
});

test("as versões escolhidas são diferentes entre si, não todas com a mesma mudança", () => {
  const base = "Quem acompanha sabe que tem trabalho sendo feito. Continue firme, Big!";
  const { variacoes } = variarLegenda(base, 5, { seed: 20260911 });
  const finais = new Set(variacoes.map((v) => v.split(/[.!?]\s+|\n/).filter(Boolean).pop()));
  assert.ok(finais.size >= 3, [...finais].join(" | "));
  assert.ok(variacoes.some((v) => !/^Big, |\nBig, /m.test(v)), "nem todas movem o vocativo");
});
