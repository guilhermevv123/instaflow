// Seguidores das redes além de Instagram e Facebook: com a chave que o Post for Me guarda de
// cada conta (YouTube, TikTok, Threads) ou pelo perfil público (Bluesky). Quando a conexão não
// dá permissão para esse número, devolve tudo nulo; nunca derruba a atualização dos posts.
export interface Perfil { followers: number | null; follows: number | null; media_count: number | null }

const vazio = (): Perfil => ({ followers: null, follows: null, media_count: null });
const inteiro = (v: unknown): number | null => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? Math.round(n) : null;
};

async function lerJson(fetchFn: typeof fetch, url: string, token?: string | null): Promise<Record<string, unknown> | null> {
  const res = await fetchFn(url, { headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) return null;
  return (await res.json().catch(() => null)) as Record<string, unknown> | null;
}

export async function perfilDaRede(fetchFn: typeof fetch, platform: string, token: string | null, username: string | null): Promise<Perfil> {
  if (platform === "youtube" && token) {
    const d = await lerJson(fetchFn, "https://www.googleapis.com/youtube/v3/channels?part=statistics&mine=true", token);
    const s = (d?.items as Array<{ statistics?: Record<string, unknown> }> | undefined)?.[0]?.statistics;
    if (s) return { followers: s.hiddenSubscriberCount === true ? null : inteiro(s.subscriberCount), follows: null, media_count: inteiro(s.videoCount) };
  }
  if ((platform === "tiktok" || platform === "tiktok_business") && token) {
    // precisa da permissão user.info.stats; sem ela o TikTok responde 401 e fica sem número
    const d = await lerJson(fetchFn, "https://open.tiktokapis.com/v2/user/info/?fields=follower_count,following_count,video_count", token);
    const u = (d?.data as { user?: Record<string, unknown> } | undefined)?.user;
    if (u && u.follower_count !== undefined) return { followers: inteiro(u.follower_count), follows: inteiro(u.following_count), media_count: inteiro(u.video_count) };
  }
  if (platform === "threads" && token) {
    const d = await lerJson(fetchFn, "https://graph.threads.net/v1.0/me/threads_insights?metric=followers_count", token);
    const v = (d?.data as Array<{ total_value?: { value?: unknown } }> | undefined)?.[0]?.total_value?.value;
    if (v !== undefined) return { followers: inteiro(v), follows: null, media_count: null };
  }
  if (platform === "bluesky" && username) {
    const d = await lerJson(fetchFn, `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(username.replace(/^@/, ""))}`);
    if (d && d.followersCount !== undefined) return { followers: inteiro(d.followersCount), follows: inteiro(d.followsCount), media_count: inteiro(d.postsCount) };
  }
  return vazio();
}
