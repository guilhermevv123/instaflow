// deno test --allow-env supabase/functions/_shared/seguidores_test.ts
import assert from "node:assert/strict";
import { perfilDaRede } from "./seguidores.ts";

// fetch de mentira: responde conforme o começo do endereço e guarda o que foi pedido
function fetchFalso(respostas: Array<[string, number, unknown]>) {
  const pedidos: Array<{ url: string; auth: string | null }> = [];
  const fn = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    pedidos.push({ url, auth: new Headers(init?.headers).get("Authorization") });
    const r = respostas.find(([inicio]) => url.startsWith(inicio));
    return Promise.resolve(new Response(JSON.stringify(r ? r[2] : {}), { status: r ? r[1] : 404 }));
  }) as typeof fetch;
  return { fn, pedidos };
}

Deno.test("YouTube: inscritos e vídeos do canal com a chave da conta", async () => {
  const f = fetchFalso([["https://www.googleapis.com/youtube/v3/channels", 200, { items: [{ statistics: { subscriberCount: "14", videoCount: "17", hiddenSubscriberCount: false } }] }]]);
  assert.deepEqual(await perfilDaRede(f.fn, "youtube", "chave-de-teste", "Canal"), { followers: 14, follows: null, media_count: 17 });
  assert.equal(f.pedidos[0].auth, "Bearer chave-de-teste");
});

Deno.test("YouTube com inscritos escondidos: sem número de seguidores", async () => {
  const f = fetchFalso([["https://www.googleapis.com/youtube/v3/channels", 200, { items: [{ statistics: { subscriberCount: "0", videoCount: "3", hiddenSubscriberCount: true } }] }]]);
  assert.deepEqual(await perfilDaRede(f.fn, "youtube", "k", null), { followers: null, follows: null, media_count: 3 });
});

Deno.test("TikTok sem a permissão de estatísticas: tudo nulo, sem erro", async () => {
  const f = fetchFalso([["https://open.tiktokapis.com/v2/user/info/", 401, { error: { code: "scope_not_authorized" } }]]);
  assert.deepEqual(await perfilDaRede(f.fn, "tiktok", "k", "loja"), { followers: null, follows: null, media_count: null });
});

Deno.test("TikTok com a permissão: seguidores, seguindo e vídeos", async () => {
  const f = fetchFalso([["https://open.tiktokapis.com/v2/user/info/", 200, { data: { user: { follower_count: 5310, following_count: 12, video_count: 44 } } }]]);
  assert.deepEqual(await perfilDaRede(f.fn, "tiktok_business", "k", "loja"), { followers: 5310, follows: 12, media_count: 44 });
});

Deno.test("Bluesky: perfil público, sem chave", async () => {
  const f = fetchFalso([["https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile", 200, { followersCount: 321, followsCount: 45, postsCount: 67 }]]);
  assert.deepEqual(await perfilDaRede(f.fn, "bluesky", null, "@loja.bsky.social"), { followers: 321, follows: 45, media_count: 67 });
  assert.ok(f.pedidos[0].url.endsWith("actor=loja.bsky.social"));
  assert.equal(f.pedidos[0].auth, null);
});

Deno.test("rede sem número disponível (LinkedIn) ou sem chave: tudo nulo", async () => {
  const f = fetchFalso([]);
  assert.deepEqual(await perfilDaRede(f.fn, "linkedin", "k", "Empresa"), { followers: null, follows: null, media_count: null });
  assert.deepEqual(await perfilDaRede(f.fn, "youtube", null, "Canal"), { followers: null, follows: null, media_count: null });
  assert.equal(f.pedidos.length, 0);
});
