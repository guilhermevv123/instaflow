// deno test supabase/functions/_shared/ia_test.ts --allow-net
import assert from "node:assert/strict";
import { chat, chatWithFallback, classify, detectProvider, IaError, keyHint, maxTokensFor, parseVariacoes, promptVariacoes, tokens, validarVariacoes } from "./ia.ts";

Deno.test("provedor pelo prefixo da chave (e dica sem mostrar a chave)", () => {
  assert.equal(detectProvider("AIzaSyA1234567890abcdefghijklmnopqrstu"), "gemini");
  assert.equal(detectProvider(" gsk_abcdefghijklmnopqrstuvwxyz0123 "), "groq");
  assert.equal(detectProvider("sk-or-v1-abcdefghijklmnopqrstuvwxyz0123"), "openrouter");
  assert.equal(detectProvider("sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123"), "anthropic");
  assert.equal(detectProvider("sk-proj-abcdefghijklmnopqrstuvwxyz0123"), "openai");
  assert.equal(detectProvider("sbp_EXEMPLO_QUE_NAO_E_CHAVE_DE_VERDADE_00"), null);
  assert.equal(detectProvider("uma chave qualquer"), null);
  assert.equal(keyHint("AIzaSyA1234567890abcdefghijklmnopqrstu"), "AIza…rstu");
  assert.equal(keyHint("curta"), "••••");
});

Deno.test("classifica os erros dos provedores", () => {
  assert.equal(classify(400, "API key not valid. Please pass a valid API key."), "chave");
  assert.equal(classify(401, "Invalid API Key"), "chave");
  assert.equal(classify(429, "Resource has been exhausted (e.g. check quota)."), "cota");
  assert.equal(classify(404, "models/gemini-9 is not found"), "modelo");
  assert.equal(classify(400, "The model `llama-2` has been decommissioned"), "modelo");
  assert.equal(classify(503, "overloaded"), "rede");
  assert.equal(classify(400, "Invalid JSON payload received"), "resposta");
});

Deno.test("lê a resposta em JSON puro, com cerca de código, em lista ou com texto em volta", () => {
  assert.deepEqual(parseVariacoes('{"variacoes":["a","b"]}'), ["a", "b"]);
  assert.deepEqual(parseVariacoes('```json\n{"variacoes": ["x"]}\n```'), ["x"]);
  assert.deepEqual(parseVariacoes('["um", " dois "]'), ["um", "dois"]);
  assert.deepEqual(parseVariacoes('Aqui estão: {"variacoes": ["ok"]} Espero ter ajudado'), ["ok"]);
  assert.deepEqual(parseVariacoes('{"variations":[{"texto":"t1"}, "t2", 3, ""]}'), ["t1", "t2"]);
  assert.deepEqual(parseVariacoes("não é json"), []);
});

Deno.test("confere cada versão: números/menções/links exatos, hashtags repostas, repetidas fora", () => {
  const orig = "Big Lobo 44144 com a Bahia! Siga @big.lobo e veja https://biglobo.com.br/agenda.\n\n#Bahia #Força";
  const t = tokens(orig);
  assert.deepEqual(t.nums, ["44144"]);
  assert.deepEqual(t.mencoes, ["@big.lobo"]);
  assert.deepEqual(t.urls, ["https://biglobo.com.br/agenda"]);
  const out = validarVariacoes(orig, [
    "Com a Bahia, Big Lobo 44144! Siga @big.lobo e veja https://biglobo.com.br/agenda.\n\n#Força #Bahia", // ok
    "Big Lobo 4414 com a Bahia! Siga @big.lobo e veja https://biglobo.com.br/agenda. #Bahia #Força", // número mudou
    "Big Lobo 44144 e 2026 com a Bahia! @big.lobo https://biglobo.com.br/agenda #Bahia #Força", // número inventado
    "Big Lobo 44144 com a Bahia! Siga @outra e veja https://biglobo.com.br/agenda #Bahia #Força", // menção trocada
    "“Pela Bahia, Big Lobo 44144! Siga @big.lobo: https://biglobo.com.br/agenda #Bahia”", // falta #Força → volta no fim; aspas saem
    "Big Lobo 44144 sempre com a Bahia! Siga @big.lobo e veja https://biglobo.com.br/agenda. #Bahia #Força #Novidade", // hashtag nova sai
    "com a bahia, big lobo 44144! siga @big.lobo e veja https://biglobo.com.br/agenda.\n\n#força #bahia", // repetida (maiúsculas)
    orig, // igual ao original
  ], 10);
  assert.equal(out.length, 3, JSON.stringify(out, null, 1));
  assert.ok(out[1].startsWith("Pela Bahia") && out[1].endsWith("#Força"), out[1]);
  assert.ok(!out[1].includes("“") && !out[1].includes("”"), out[1]);
  assert.ok(!out[2].includes("#Novidade"), out[2]);
  assert.equal(validarVariacoes(orig, [out[0], out[1], out[2]], 2).length, 2);
});

Deno.test("prompt pede exatamente N versões e protege números/hashtags; tokens escalam com o tamanho", () => {
  const { system, user } = promptVariacoes("Oi 44144 #Bahia", 7);
  assert.ok(user.includes("Quantidade de versões: 7") && user.includes("Oi 44144 #Bahia"));
  assert.ok(system.includes("44144") && system.includes('{"variacoes"'));
  assert.equal(maxTokensFor("x".repeat(100), 1), 1024);
  assert.ok(maxTokensFor("x".repeat(2000), 19) <= 16000);
});

Deno.test("chama o provedor no formato certo e troca de modelo quando precisa (servidor falso local)", async () => {
  const pedidos: Array<{ path: string; auth: string | null; xkey: string | null; body: Record<string, unknown> }> = [];
  let tudo429 = false;
  const srv = Deno.serve({ port: 0, hostname: "127.0.0.1", onListen() {} }, async (req) => {
    const body = await req.json();
    pedidos.push({ path: new URL(req.url).pathname, auth: req.headers.get("authorization"), xkey: req.headers.get("x-api-key"), body });
    const j = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
    if (tudo429) return j(429, { error: { message: "Resource has been exhausted" } });
    if (new URL(req.url).pathname.endsWith("/messages")) return j(200, { content: [{ type: "text", text: '{"variacoes":["claude"]}' }] });
    if (body.model === "m-401") return j(401, { error: { message: "Invalid API Key" } });
    if (body.model === "m-404") return j(404, { error: { message: "model not found" } });
    if (body.model === "m-vazio") return j(200, { choices: [{ message: { content: "" } }] });
    return j(200, { choices: [{ message: { content: `{"variacoes":["${body.model}"]}` } }] });
  });
  const base = `http://127.0.0.1:${srv.addr.port}`;
  const comum = { key: "AIzaFAKE", system: "s", user: "u", maxTokens: 50, temperature: 0.9, json: true, base } as const;
  try {
    // modelo salvo sumiu → cai no primeiro do Gemini, que "pensa" menos e responde JSON
    const r = await chatWithFallback({ ...comum, provider: "gemini", preferred: "m-404" });
    assert.equal(r.model, "gemini-2.5-flash");
    assert.deepEqual(parseVariacoes(r.text), ["gemini-2.5-flash"]);
    const ult = pedidos.at(-1)!;
    assert.equal(ult.path, "/chat/completions");
    assert.equal(ult.auth, "Bearer AIzaFAKE");
    assert.deepEqual(ult.body.response_format, { type: "json_object" });
    assert.equal(ult.body.reasoning_effort, "none");
    assert.equal((ult.body.messages as unknown[]).length, 2);

    // resposta vazia → próximo modelo; sem reasoning_effort fora do 2.5
    pedidos.length = 0;
    const r2 = await chatWithFallback({ ...comum, provider: "gemini", preferred: "m-vazio" });
    assert.equal(r2.model, "gemini-2.5-flash");

    // chave recusada para na hora (um pedido só)
    pedidos.length = 0;
    await assert.rejects(chatWithFallback({ ...comum, provider: "groq", preferred: "m-401" }), (e: unknown) => e instanceof IaError && e.kind === "chave");
    assert.equal(pedidos.length, 1);

    // Anthropic usa /messages com x-api-key e system separado
    pedidos.length = 0;
    const r3 = await chat({ ...comum, provider: "anthropic", key: "sk-ant-FAKE", model: "claude-haiku-4-5-20251001" });
    assert.deepEqual(parseVariacoes(r3), ["claude"]);
    assert.equal(pedidos[0].path, "/messages");
    assert.equal(pedidos[0].xkey, "sk-ant-FAKE");
    assert.equal(pedidos[0].body.system, "s");

    // cota esgotada em todos os modelos → erro "cota" depois de tentar cada um uma vez
    pedidos.length = 0;
    tudo429 = true;
    await assert.rejects(chatWithFallback({ ...comum, provider: "gemini", preferred: null }), (e: unknown) => e instanceof IaError && e.kind === "cota");
    assert.equal(pedidos.length, 3);
  } finally {
    await srv.shutdown();
  }
});
