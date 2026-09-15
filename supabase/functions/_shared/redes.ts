// Redes que o InstaFlow sabe conectar e publicar (ids do Post for Me). Lista única
// para a API, o webhook e a sincronização das contas.
export const SUPPORTED = ["instagram", "facebook", "tiktok", "youtube", "threads", "linkedin", "tiktok_business", "bluesky"] as const;
export type Platform = typeof SUPPORTED[number];
export const isSupported = (p: unknown): p is Platform => (SUPPORTED as readonly unknown[]).includes(p);
