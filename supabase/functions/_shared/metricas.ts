// InstaFlow · desempenho das contas (seguidores e métricas de cada post).
//
// Duas fontes, com a mesma chave que o Post for Me guarda de cada conta:
//   1. Graph API (graph.instagram.com / graph.facebook.com): seguidores,
//      seguindo e posts da conta; curtidas e comentários de cada mídia do
//      Instagram. Funciona com a permissão básica que toda conta já tem.
//   2. Feed do Post for Me com expand=metrics: visualizações, alcance,
//      compartilhamentos, salvamentos, novos seguidores, tempo assistido…
//      Só vem preenchido quando a conta foi conectada com a permissão "feeds"
//      (o painel pede desde 11/09; contas antigas precisam reconectar).
// Grava por time: accounts (último número), account_stats_daily (retrato do
// dia na Bahia → seguidores ganhos), post_metrics (último valor de cada post)
// e post_metrics_daily (curva de cada post).

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { listData, pfm as pfmReal } from "./pfm.ts";
import { HttpError, timingSafeEqual } from "./util.ts";
import { perfilDaRede } from "./seguidores.ts";

type Db = SupabaseClient;
type Query = Record<string, string | string[] | undefined>;
export interface MetricasDeps {
  pfm: (path: string, init?: { query?: Query }) => Promise<unknown>;
  fetch: typeof fetch;
  agora: () => Date;
}
export const depsPadrao: MetricasDeps = {
  pfm: (path, init) => pfmReal(path, init),
  fetch: (input, init) => fetch(input, init),
  agora: () => new Date(),
};

const IG = "https://graph.instagram.com/v23.0";
const FB = "https://graph.facebook.com/v23.0";
const PAGINAS_DO_FEED = 2; // 2 × 50 = os 100 posts mais recentes de cada conta

// Dia na Bahia (UTC−3, sem horário de verão).
export const diaBahia = (d: Date) => new Date(d.getTime() - 3 * 3600_000).toISOString().slice(0, 10);

const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return Math.round(v);
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Math.round(Number(v));
  return null;
};
const primeiro = (...vs: unknown[]) => { for (const v of vs) { const n = num(v); if (n !== null) return n; } return null; };

export interface Numeros {
  views: number | null; reach: number | null; likes: number | null; comments: number | null; shares: number | null; saved: number | null;
  follows: number | null; profile_visits: number | null; total_interactions: number | null; avg_watch_ms: number | null; total_watch_ms: number | null;
}

// Nomes de cada rede no Post for Me → um formato só.
export function mapMetrics(platform: string, m: unknown): Numeros {
  const x = (m && typeof m === "object" ? m : {}) as Record<string, unknown>;
  if (platform === "facebook") {
    return {
      views: primeiro(x.media_views, x.video_views), reach: primeiro(x.reach), likes: primeiro(x.reactions_total, x.reactions_like, x.likes),
      comments: primeiro(x.comments), shares: primeiro(x.shares), saved: null, follows: null, profile_visits: null, total_interactions: null,
      avg_watch_ms: primeiro(x.video_avg_time_watched), total_watch_ms: primeiro(x.video_view_time),
    };
  }
  if (platform === "tiktok" || platform === "tiktok_business") {
    return {
      views: primeiro(x.view_count, x.video_views, x.views), reach: primeiro(x.reach), likes: primeiro(x.like_count, x.likes),
      comments: primeiro(x.comment_count, x.comments), shares: primeiro(x.share_count, x.shares), saved: primeiro(x.favorites, x.saved),
      follows: primeiro(x.new_followers, x.follows), profile_visits: primeiro(x.profile_views), total_interactions: null,
      avg_watch_ms: primeiro(x.average_time_watched), total_watch_ms: primeiro(x.total_time_watched),
    };
  }
  if (platform === "youtube") {
    const segundos = num(x.averageViewDuration), minutos = num(x.estimatedMinutesWatched);
    return {
      views: primeiro(x.views), reach: null, likes: primeiro(x.likes), comments: primeiro(x.comments), shares: primeiro(x.shares), saved: null,
      follows: primeiro(x.subscribersGained), profile_visits: null, total_interactions: null,
      avg_watch_ms: segundos === null ? null : segundos * 1000, total_watch_ms: minutos === null ? null : minutos * 60_000,
    };
  }
  if (platform === "threads") {
    const partes = [num(x.reposts), num(x.quotes), num(x.shares)];
    return {
      views: primeiro(x.views), reach: null, likes: primeiro(x.likes), comments: primeiro(x.replies),
      shares: partes.every((v) => v === null) ? null : partes.reduce((s: number, v) => s + (v ?? 0), 0),
      saved: null, follows: null, profile_visits: null, total_interactions: null, avg_watch_ms: null, total_watch_ms: null,
    };
  }
  if (platform === "linkedin") {
    return {
      views: primeiro(x.videoView, x.impressionCount), reach: null, likes: primeiro(x.likeCount), comments: primeiro(x.commentCount),
      shares: primeiro(x.shareCount), saved: null, follows: null, profile_visits: null, total_interactions: null, avg_watch_ms: null, total_watch_ms: null,
    };
  }
  if (platform === "bluesky") {
    const partes = [num(x.repostCount), num(x.quoteCount)];
    return {
      views: null, reach: null, likes: primeiro(x.likeCount), comments: primeiro(x.replyCount),
      shares: partes.every((v) => v === null) ? null : partes.reduce((s: number, v) => s + (v ?? 0), 0),
      saved: null, follows: null, profile_visits: null, total_interactions: null, avg_watch_ms: null, total_watch_ms: null,
    };
  }
  return {
    views: primeiro(x.views, x.plays, x.video_views), reach: primeiro(x.reach), likes: primeiro(x.likes, x.like_count),
    comments: primeiro(x.comments, x.comments_count), shares: primeiro(x.shares), saved: primeiro(x.saved), follows: primeiro(x.follows),
    profile_visits: primeiro(x.profile_visits), total_interactions: primeiro(x.total_interactions),
    avg_watch_ms: primeiro(x.ig_reels_avg_watch_time), total_watch_ms: primeiro(x.ig_reels_video_view_total_time),
  };
}
// "Completa" = a rede mandou visualizações ou alcance (o que só vem com a permissão de métricas).
const completa = (n: Numeros) => n.views !== null || n.reach !== null;

interface PfmConta { id: string; platform: string; username?: string | null; access_token?: string | null }
interface ItemFeed {
  platform: string; platform_post_id: string; platform_url?: string | null; caption?: string | null; posted_at?: string | null;
  social_post_id?: string | null; metrics?: unknown; media?: Array<{ url?: string | null; thumbnail_url?: string | null } | unknown> | null;
}
interface MidiaGraph { id: string; like_count?: number; comments_count?: number; media_type?: string; media_product_type?: string; permalink?: string; thumbnail_url?: string; media_url?: string; timestamp?: string; caption?: string }

async function getJson(deps: MetricasDeps, url: string, token: string): Promise<Record<string, unknown>> {
  const res = await deps.fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
  const txt = await res.text();
  let d: Record<string, unknown> = {};
  try { d = txt ? JSON.parse(txt) : {}; } catch { /* resposta não-JSON */ }
  if (!res.ok) {
    const msg = (d.error as { message?: string } | undefined)?.message ?? `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return d;
}

async function contasDoPfm(deps: MetricasDeps): Promise<Map<string, PfmConta>> {
  const out = new Map<string, PfmConta>();
  for (let offset = 0; offset < 2000; offset += 100) {
    const page = listData<PfmConta>(await deps.pfm("/social-accounts", { query: { limit: "100", offset: String(offset) } }));
    page.forEach((a) => out.set(a.id, a));
    if (page.length < 100) break;
  }
  return out;
}

async function feedDaConta(deps: MetricasDeps, id: string): Promise<ItemFeed[]> {
  const itens: ItemFeed[] = [];
  let cursor: string | undefined;
  for (let p = 0; p < PAGINAS_DO_FEED; p++) {
    const r = (await deps.pfm(`/social-account-feeds/${encodeURIComponent(id)}`, { query: { expand: ["metrics"], limit: "50", cursor } })) as { data?: ItemFeed[]; meta?: { cursor?: string; has_more?: boolean } };
    itens.push(...(r.data ?? []));
    if (!r.meta?.has_more || !r.meta.cursor) break;
    cursor = r.meta.cursor;
  }
  return itens;
}

async function emLotes<T>(itens: T[], tamanho: number, fn: (x: T) => Promise<void>) {
  for (let i = 0; i < itens.length; i += tamanho) await Promise.all(itens.slice(i, i + tamanho).map(fn));
}

async function upsertEmPartes(db: Db, tabela: string, linhas: Record<string, unknown>[], onConflict: string) {
  for (let i = 0; i < linhas.length; i += 400) {
    const { error } = await db.from(tabela).upsert(linhas.slice(i, i + 400), { onConflict });
    if (error) throw new Error(`${tabela}: ${error.message}`);
  }
}

export interface ResumoSync { team_id: string; contas: number; posts: number; completas: number; so_basico: number; erros: Array<{ conta: string; erro: string }>; em: string }

// Atualiza os números de um time. Erro numa conta não para as outras.
export async function syncTeam(db: Db, teamId: string, deps: MetricasDeps = depsPadrao, pfmContas?: Map<string, PfmConta>): Promise<ResumoSync> {
  const agora = deps.agora();
  const dia = diaBahia(agora);
  const { data: contas, error } = await db.from("accounts").select("id, platform, username").eq("team_id", teamId).eq("status", "connected").eq("archived", false);
  if (error) throw new HttpError(500, error.message);
  const resumo: ResumoSync = { team_id: teamId, contas: 0, posts: 0, completas: 0, so_basico: 0, erros: [], em: agora.toISOString() };
  if (!contas?.length) return resumo;
  const pfmMap = pfmContas ?? (await contasDoPfm(deps));
  const { data: posts } = await db.from("posts").select("id, pfm_post_id").eq("team_id", teamId).not("pfm_post_id", "is", null);
  const nossoPost = new Map((posts ?? []).map((p) => [p.pfm_post_id as string, p.id as string]));

  const linhasPost: Record<string, unknown>[] = [];
  const linhasDia: Record<string, unknown>[] = [];
  const linhasConta: Record<string, unknown>[] = [];
  const atualizacoes: Array<{ id: string; campos: Record<string, unknown> }> = [];

  await emLotes(contas, 3, async (c) => {
    const conta = c as { id: string; platform: string; username: string | null };
    const token = pfmMap.get(conta.id)?.access_token ?? null;
    const nome = conta.username ?? conta.id;
    try {
      // 1) seguidores da conta
      let perfil: { followers: number | null; follows: number | null; media_count: number | null } = { followers: null, follows: null, media_count: null };
      if (token && conta.platform === "instagram") {
        const d = await getJson(deps, `${IG}/me?fields=followers_count,follows_count,media_count`, token);
        perfil = { followers: num(d.followers_count), follows: num(d.follows_count), media_count: num(d.media_count) };
      } else if (token && conta.platform === "facebook") {
        try { const d = await getJson(deps, `${FB}/me?fields=followers_count,fan_count`, token); perfil.followers = primeiro(d.followers_count, d.fan_count); } catch { /* página sem essa permissão */ }
      } else {
        // YouTube, TikTok, Threads, Bluesky: direto na rede, quando a conexão permite (sem travar os posts)
        try { perfil = await perfilDaRede(deps.fetch, conta.platform, token, conta.username); } catch { /* a rede não liberou esse número */ }
      }
      // 2) posts: feed do Post for Me (+ curtidas/comentários pela Graph quando o feed não traz métricas)
      const itens = await feedDaConta(deps, conta.id);
      let graph = new Map<string, MidiaGraph>();
      const faltaBasico = itens.some((it) => { const n = mapMetrics(it.platform, it.metrics); return n.likes === null || n.comments === null; });
      if (token && conta.platform === "instagram" && faltaBasico) {
        const d = await getJson(deps, `${IG}/me/media?fields=id,like_count,comments_count,media_type,media_product_type,permalink,thumbnail_url,media_url,timestamp,caption&limit=50`, token);
        graph = new Map(((d.data as MidiaGraph[]) ?? []).map((m) => [m.id, m]));
      }
      let completas = 0;
      for (const it of itens) {
        if (!it.platform_post_id) continue;
        const n = mapMetrics(it.platform || conta.platform, it.metrics);
        const g = graph.get(it.platform_post_id);
        const likes = n.likes ?? num(g?.like_count);
        const comments = n.comments ?? num(g?.comments_count);
        const cheia = completa(n);
        if (cheia) completas++;
        const m0 = (it.media ?? [])[0] as { url?: string | null; thumbnail_url?: string | null } | undefined;
        const ehVideo = /\.(mp4|mov)(\?|$)/i.test(m0?.url ?? "") || g?.media_type === "VIDEO";
        linhasPost.push({
          platform_post_id: it.platform_post_id,
          account_id: conta.id,
          team_id: teamId,
          post_id: (it.social_post_id && nossoPost.get(it.social_post_id)) || null,
          social_post_id: it.social_post_id ?? null,
          platform: it.platform || conta.platform,
          product_type: g?.media_product_type ?? null,
          media_type: g?.media_type ?? (ehVideo ? "VIDEO" : m0 ? "IMAGE" : null),
          permalink: it.platform_url ?? g?.permalink ?? null,
          caption: (it.caption ?? g?.caption ?? "").slice(0, 2200),
          thumbnail_url: m0?.thumbnail_url ?? g?.thumbnail_url ?? (!ehVideo ? m0?.url ?? g?.media_url : null) ?? null,
          posted_at: it.posted_at ?? g?.timestamp ?? null,
          ...n,
          likes,
          comments,
          nivel: cheia ? "completo" : "basico",
          raw: it.metrics && typeof it.metrics === "object" ? it.metrics : {},
          updated_at: agora.toISOString(),
        });
        linhasDia.push({ platform_post_id: it.platform_post_id, day: dia, team_id: teamId, account_id: conta.id, views: n.views, reach: n.reach, likes, comments, shares: n.shares, saved: n.saved, total_interactions: n.total_interactions });
      }
      resumo.posts += itens.length;
      if (completas) resumo.completas++; else if (itens.length) resumo.so_basico++;
      if (perfil.followers !== null || perfil.follows !== null || perfil.media_count !== null) {
        linhasConta.push({ account_id: conta.id, day: dia, team_id: teamId, ...perfil, captured_at: agora.toISOString() });
      }
      atualizacoes.push({ id: conta.id, campos: { ...perfil, insights_ok: itens.length ? completas > 0 : null, stats_synced_at: agora.toISOString() } });
      resumo.contas++;
    } catch (e) {
      resumo.erros.push({ conta: nome, erro: (e as Error).message.slice(0, 200) });
    }
  });

  await upsertEmPartes(db, "post_metrics", linhasPost, "platform_post_id");
  await upsertEmPartes(db, "post_metrics_daily", linhasDia, "platform_post_id,day");
  await upsertEmPartes(db, "account_stats_daily", linhasConta, "account_id,day");
  for (const u of atualizacoes) {
    const { error: e2 } = await db.from("accounts").update(u.campos).eq("id", u.id);
    if (e2) resumo.erros.push({ conta: u.id, erro: e2.message });
  }
  return resumo;
}

// Todos os times com conta conectada (chamado pelo pg_cron a cada 3 horas).
export async function syncAll(db: Db, deps: MetricasDeps = depsPadrao) {
  const { data, error } = await db.from("accounts").select("team_id").eq("status", "connected").eq("archived", false);
  if (error) throw new HttpError(500, error.message);
  const times = [...new Set((data ?? []).map((r) => r.team_id as string).filter(Boolean))];
  const pfmMap = times.length ? await contasDoPfm(deps) : new Map();
  const resumos: ResumoSync[] = [];
  for (const t of times) resumos.push(await syncTeam(db, t, deps, pfmMap));
  return { times: resumos.length, contas: resumos.reduce((s, r) => s + r.contas, 0), posts: resumos.reduce((s, r) => s + r.posts, 0), erros: resumos.flatMap((r) => r.erros), resumos };
}

// POST /metrics/cron — só com o segredo guardado em app_settings('metrics_cron').
export async function metricsCron(db: Db, req: Request, deps: MetricasDeps = depsPadrao) {
  const { data } = await db.from("app_settings").select("value").eq("key", "metrics_cron").maybeSingle();
  const segredo = String((data?.value as { secret?: string } | null)?.secret ?? "");
  const veio = req.headers.get("x-cron-secret") ?? "";
  if (!segredo || !veio || !timingSafeEqual(segredo, veio)) throw new HttpError(401, "Chamada do agendador sem o segredo certo.");
  return syncAll(db, deps);
}

// POST /metrics/sync — botão "Atualizar agora" do painel (no máximo 1 vez por minuto por time).
export async function syncTeamManual(db: Db, teamId: string, deps: MetricasDeps = depsPadrao) {
  const { data } = await db.from("accounts").select("stats_synced_at").eq("team_id", teamId).not("stats_synced_at", "is", null).order("stats_synced_at", { ascending: false }).limit(1);
  const ultimo = data?.[0]?.stats_synced_at ? new Date(data[0].stats_synced_at as string).getTime() : 0;
  if (deps.agora().getTime() - ultimo < 60_000) return { recente: true, em: data?.[0]?.stats_synced_at ?? null };
  return syncTeam(db, teamId, deps);
}
