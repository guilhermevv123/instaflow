// deno test --allow-env --allow-net supabase/functions/_shared/metricas_test.ts
import assert from "node:assert/strict";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { diaBahia, mapMetrics, metricsCron, syncTeam, syncTeamManual, type MetricasDeps } from "./metricas.ts";
import { HttpError } from "./util.ts";

const IG = "https://graph.instagram.com/v23.0";
const FB = "https://graph.facebook.com/v23.0";
type Row = Record<string, unknown>;

function fakeDb() {
  const st = {
    accounts: [
      { id: "spc_ig1", team_id: "t1", platform: "instagram", username: "conta_basica", status: "connected", archived: false, stats_synced_at: null },
      { id: "spc_ig2", team_id: "t1", platform: "instagram", username: "conta_completa", status: "connected", archived: false, stats_synced_at: null },
      { id: "spc_fb", team_id: "t1", platform: "facebook", username: "Página", status: "connected", archived: false, stats_synced_at: null },
      { id: "spc_ig3", team_id: "t1", platform: "instagram", username: "conta_quebrada", status: "connected", archived: false, stats_synced_at: null },
      { id: "spc_outra", team_id: "t2", platform: "instagram", username: "de_outro_time", status: "connected", archived: false, stats_synced_at: null },
    ] as Row[],
    posts: [{ id: "p-nosso", team_id: "t1", pfm_post_id: "sp_nosso" }, { id: "p-t2", team_id: "t2", pfm_post_id: "sp_t2" }] as Row[],
    app_settings: [{ key: "metrics_cron", value: { secret: "segredo-certo" } }] as Row[],
    upserts: { post_metrics: [] as Row[], post_metrics_daily: [] as Row[], account_stats_daily: [] as Row[] } as Record<string, Row[]>,
    conflitos: {} as Record<string, string>,
  };
  const db = {
    from(tabela: string) {
      const f: Array<[string, string, unknown]> = [];
      let op = "select", payload: Row | Row[] | null = null, lim = Infinity, ordem: string | null = null;
      const filtra = (rows: Row[]) => rows.filter((r) => f.every(([o, k, v]) => (o === "eq" ? r[k] === v : o === "notnull" ? r[k] !== null && r[k] !== undefined : true)));
      const run = () => {
        if (op === "upsert") { st.upserts[tabela].push(...(payload as Row[])); return { data: null, error: null }; }
        if (op === "update") { filtra(st[tabela as "accounts"]).forEach((r) => Object.assign(r, payload)); return { data: null, error: null }; }
        let rows = filtra((st as unknown as Record<string, Row[]>)[tabela] ?? []);
        if (ordem) rows = [...rows].sort((a, b) => String(b[ordem!] ?? "").localeCompare(String(a[ordem!] ?? "")));
        return { data: rows.slice(0, lim), error: null };
      };
      const q: Record<string, unknown> = {
        select() { return q; },
        eq(k: string, v: unknown) { f.push(["eq", k, v]); return q; },
        not(k: string) { f.push(["notnull", k, null]); return q; },
        order(k: string) { ordem = k; return q; },
        limit(n: number) { lim = n; return q; },
        upsert(rows: Row[], o: { onConflict: string }) { op = "upsert"; payload = rows; st.conflitos[tabela] = o.onConflict; return q; },
        update(c: Row) { op = "update"; payload = c; return q; },
        maybeSingle() { const r = run(); return Promise.resolve({ data: (r.data as Row[])[0] ?? null, error: null }); },
        then(ok: (v: unknown) => unknown, err: (e: unknown) => unknown) { return Promise.resolve(run()).then(ok, err); },
      };
      return q;
    },
  };
  return { db: db as unknown as SupabaseClient, st };
}

function fakeDeps(agoraIso = "2026-09-12T01:30:00Z") {
  const chamadas = { pfm: [] as string[], graph: [] as string[] };
  const feeds: Record<string, (cursor?: string) => unknown> = {
    spc_ig1: (cursor) => cursor === "c2"
      ? { data: [{ platform: "instagram", platform_post_id: "C", platform_url: "https://instagram.com/p/C", metrics: {}, media: [{ url: "https://cdn/c.jpg" }], posted_at: "2026-09-10T12:00:00Z" }], meta: { has_more: false } }
      : { data: [
          { platform: "instagram", platform_post_id: "A", platform_url: "https://instagram.com/reel/A", caption: "Reel A", metrics: {}, media: [{ url: "https://cdn/a.mp4", thumbnail_url: "https://cdn/a.jpg" }], posted_at: "2026-09-11T12:00:00Z" },
          { platform: "instagram", platform_post_id: "B", metrics: {}, media: [], posted_at: "2026-09-11T13:00:00Z" },
        ], meta: { has_more: true, cursor: "c2" } },
    spc_ig2: () => ({ data: [{ platform: "instagram", platform_post_id: "D", social_post_id: "sp_nosso", metrics: { views: 1200, reach: 900, likes: 50, comments: 5, shares: 7, saved: 3, follows: 2, profile_visits: 11, total_interactions: 65, ig_reels_avg_watch_time: 8000, ig_reels_video_view_total_time: 9600000 }, media: [{ url: "https://cdn/d.mp4", thumbnail_url: "https://cdn/d.jpg" }], posted_at: "2026-09-11T20:00:00Z" }], meta: { has_more: false } }),
    spc_fb: () => ({ data: [{ platform: "facebook", platform_post_id: "F", metrics: { comments: 1, shares: 2 }, media: [] }], meta: { has_more: false } }),
    spc_ig3: () => ({ data: [], meta: { has_more: false } }),
    spc_outra: () => ({ data: [], meta: { has_more: false } }),
  };
  const deps: MetricasDeps = {
    agora: () => new Date(agoraIso),
    pfm: (path, init) => {
      chamadas.pfm.push(`${path}${init?.query?.cursor ? `?cursor=${init.query.cursor}` : ""}`);
      if (path === "/social-accounts") return Promise.resolve({ data: [
        { id: "spc_ig1", platform: "instagram", access_token: "tok1" }, { id: "spc_ig2", platform: "instagram", access_token: "tok2" },
        { id: "spc_fb", platform: "facebook", access_token: "tokfb" }, { id: "spc_ig3", platform: "instagram", access_token: "tok3" },
      ] });
      const id = decodeURIComponent(path.split("/").pop()!);
      assert.deepEqual(init?.query?.expand, ["metrics"]);
      return Promise.resolve(feeds[id]?.(init?.query?.cursor as string | undefined) ?? { data: [] });
    },
    fetch: (input, init) => {
      const url = String(input);
      const tok = String((init as { headers?: Record<string, string> } | undefined)?.headers?.Authorization ?? "").replace("Bearer ", "");
      chamadas.graph.push(`${tok} ${url.replace(/\?.*/, "")}`);
      const j = (s: number, b: unknown) => Promise.resolve(new Response(JSON.stringify(b), { status: s }));
      if (tok === "tok3") return j(400, { error: { message: "Invalid OAuth access token" } });
      if (url.startsWith(`${IG}/me?`)) return j(200, tok === "tok1" ? { followers_count: 10, follows_count: 3, media_count: 3 } : { followers_count: 250, follows_count: 40, media_count: 12 });
      if (url.startsWith(`${IG}/me/media?`)) return j(200, { data: [{ id: "A", like_count: 4, comments_count: 1, media_type: "VIDEO", media_product_type: "REELS" }, { id: "B", like_count: 2, comments_count: 0, media_type: "IMAGE", media_product_type: "FEED", thumbnail_url: "https://cdn/b.jpg" }] });
      if (url.startsWith(`${FB}/me?`)) return j(200, { followers_count: 77 });
      return j(404, { error: { message: "rota falsa não existe" } });
    },
  };
  return { deps, chamadas };
}

Deno.test("dia da Bahia e mapeamento das redes", () => {
  assert.equal(diaBahia(new Date("2026-09-12T01:30:00Z")), "2026-09-11");
  assert.equal(diaBahia(new Date("2026-09-12T03:00:00Z")), "2026-09-12");
  assert.deepEqual(mapMetrics("tiktok", { view_count: 900, like_count: 30, comment_count: 4, share_count: 2 }).views, 900);
  const fb = mapMetrics("facebook", { media_views: 70, reactions_total: 9, comments: 1, shares: 2, video_avg_time_watched: 3000 });
  assert.equal(fb.views, 70); assert.equal(fb.likes, 9); assert.equal(fb.avg_watch_ms, 3000); assert.equal(fb.saved, null);
  assert.equal(mapMetrics("instagram", {}).views, null);
});

Deno.test("sincroniza o time: seguidores do dia, posts com métricas completas ou básicas, erro numa conta não para as outras", async () => {
  const { db, st } = fakeDb();
  const { deps, chamadas } = fakeDeps();
  const r = await syncTeam(db, "t1", deps);
  assert.equal(r.contas, 3);
  assert.equal(r.posts, 5);
  assert.equal(r.completas, 1);
  assert.equal(r.so_basico, 2);
  assert.deepEqual(r.erros, [{ conta: "conta_quebrada", erro: "Invalid OAuth access token" }]);

  const pm = new Map(st.upserts.post_metrics.map((x) => [x.platform_post_id, x]));
  assert.equal(pm.size, 5);
  const a = pm.get("A")!;
  assert.equal(a.likes, 4); assert.equal(a.comments, 1); assert.equal(a.views, null); assert.equal(a.nivel, "basico");
  assert.equal(a.product_type, "REELS"); assert.equal(a.media_type, "VIDEO"); assert.equal(a.thumbnail_url, "https://cdn/a.jpg"); assert.equal(a.permalink, "https://instagram.com/reel/A");
  assert.equal(pm.get("C")!.thumbnail_url, "https://cdn/c.jpg"); // foto: a própria imagem vira miniatura
  const d = pm.get("D")!;
  assert.equal(d.views, 1200); assert.equal(d.reach, 900); assert.equal(d.shares, 7); assert.equal(d.saved, 3); assert.equal(d.follows, 2);
  assert.equal(d.avg_watch_ms, 8000); assert.equal(d.nivel, "completo"); assert.equal(d.post_id, "p-nosso");
  assert.equal(pm.get("F")!.comments, 1); assert.equal(pm.get("F")!.nivel, "basico");
  assert.ok(st.upserts.post_metrics.every((x) => x.team_id === "t1"));

  assert.deepEqual(st.upserts.account_stats_daily.map((x) => [x.account_id, x.day, x.followers]).sort(), [["spc_fb", "2026-09-11", 77], ["spc_ig1", "2026-09-11", 10], ["spc_ig2", "2026-09-11", 250]]);
  assert.ok(st.upserts.post_metrics_daily.every((x) => x.day === "2026-09-11"));
  assert.equal(st.conflitos.post_metrics_daily, "platform_post_id,day");

  const conta = (id: string) => st.accounts.find((x) => x.id === id)!;
  assert.equal(conta("spc_ig1").insights_ok, false); assert.equal(conta("spc_ig1").followers, 10);
  assert.equal(conta("spc_ig2").insights_ok, true);
  assert.equal(conta("spc_fb").followers, 77);
  assert.equal(conta("spc_ig3").stats_synced_at, null); // falhou: não finge que atualizou
  assert.equal(conta("spc_outra").stats_synced_at, null); // outro time: intocado

  assert.ok(chamadas.pfm.includes("/social-account-feeds/spc_ig1?cursor=c2"), "segue a 2ª página do feed");
  assert.ok(!chamadas.graph.some((c) => c.startsWith("tok2") && c.endsWith("/me/media")), "conta completa não precisa da Graph para curtidas");
  assert.ok(chamadas.graph.some((c) => c.startsWith("tok1") && c.endsWith("/me/media")));
});

Deno.test("atualizar agora: no máximo 1 vez por minuto por time", async () => {
  const { db, st } = fakeDb();
  const { deps } = fakeDeps("2026-09-11T15:00:30Z");
  st.accounts[0].stats_synced_at = "2026-09-11T15:00:00Z";
  const r = await syncTeamManual(db, "t1", deps);
  assert.deepEqual(r, { recente: true, em: "2026-09-11T15:00:00Z" });
  const { deps: depois } = fakeDeps("2026-09-11T15:02:00Z");
  const r2 = await syncTeamManual(db, "t1", depois) as { contas: number };
  assert.equal(r2.contas, 3);
});

Deno.test("agendador: sem o segredo certo = 401; com ele, sincroniza todos os times", async () => {
  const { db } = fakeDb();
  const { deps } = fakeDeps();
  const pedido = (s?: string) => new Request("https://x/functions/v1/api/metrics/cron", { method: "POST", headers: s ? { "x-cron-secret": s } : {} });
  await assert.rejects(metricsCron(db, pedido(), deps), (e: unknown) => e instanceof HttpError && e.status === 401);
  await assert.rejects(metricsCron(db, pedido("segredo-errado"), deps), (e: unknown) => e instanceof HttpError && e.status === 401);
  const r = await metricsCron(db, pedido("segredo-certo"), deps);
  assert.equal(r.times, 2);
  assert.equal(r.contas, 4); // 3 do t1 + 1 do t2 (sem chave no Post for Me: só o feed, vazio)
});
