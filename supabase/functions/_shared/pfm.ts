// Cliente mínimo da API do Post for Me (https://api.postforme.dev/docs).
// Só roda no servidor: a chave nunca vai para o navegador.

const BASE = "https://api.postforme.dev/v1";

export class PfmError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

function apiKey(): string {
  const key = Deno.env.get("POSTFORME_API_KEY");
  if (!key) throw new PfmError(500, "POSTFORME_API_KEY não configurada no Supabase", null);
  return key;
}

// O Post for Me aceita 5 chamadas por segundo por chave (a mesma chave para todos os
// times). Com o cron de métricas, o /sync do painel e a API pública ao mesmo tempo,
// passa disso: um 429 espera a janela virar e tenta de novo (até 4 tentativas).
// 429 é recusa antes de processar, então repetir não duplica publicação.
const TENTATIVAS = 4;
export interface PfmDeps { fetch: typeof fetch; dormir: (ms: number) => Promise<void> }
const depsPadrao: PfmDeps = { fetch: (i, o) => fetch(i, o), dormir: (ms) => new Promise((r) => setTimeout(r, ms)) };

// Quanto esperar depois de um 429: Retry-After (segundos) ou X-Ratelimit-Reset (epoch em
// segundos); sem cabeçalho, ~1 s crescendo a cada tentativa. Entre 250 ms e 3 s, com um
// pouco de sorteio para as chamadas paradas não voltarem todas juntas.
export function esperaDo429(h: Headers, tentativa: number, agora = Date.now()): number {
  const ra = Number(h.get("retry-after"));
  const reset = Number(h.get("x-ratelimit-reset"));
  let ms = Number.isFinite(ra) && h.has("retry-after") ? ra * 1000
    : Number.isFinite(reset) && reset > 0 ? reset * 1000 - agora
    : 1000 * (tentativa + 1) + Math.random() * 250;
  if (!h.has("retry-after") && Number.isFinite(reset) && reset > 0) ms += Math.random() * 100 * (tentativa + 1);
  return Math.round(Math.min(3000, Math.max(250, ms)));
}

export async function pfm<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown; query?: Record<string, string | string[] | undefined> } = {},
  deps: PfmDeps = depsPadrao,
): Promise<T> {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(init.query ?? {})) {
    if (v === undefined) continue;
    if (Array.isArray(v)) v.forEach((x) => url.searchParams.append(k, x));
    else url.searchParams.set(k, v);
  }
  let res: Response;
  for (let tentativa = 0; ; tentativa++) {
    res = await deps.fetch(url, {
      method: init.method ?? "GET",
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    if (res.status !== 429 || tentativa >= TENTATIVAS - 1) break;
    await res.body?.cancel();
    const ms = esperaDo429(res.headers, tentativa);
    console.warn(`Post for Me: 429 em ${init.method ?? "GET"} ${path}; nova tentativa em ${ms} ms`);
    await deps.dormir(ms);
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const msg = extractMessage(data) ?? `Post for Me respondeu ${res.status}`;
    throw new PfmError(res.status, msg, data);
  }
  return data as T;
}

function extractMessage(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const err = d.error as Record<string, unknown> | string | undefined;
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    if (typeof err.message === "string") return err.message;
    if (Array.isArray(err.message)) return err.message.join("; ");
  }
  if (typeof d.message === "string") return d.message;
  if (Array.isArray(d.message)) return d.message.join("; ");
  if (Array.isArray(d.errors)) return (d.errors as unknown[]).join("; ");
  return null;
}

// Listagens vêm como { data: [...], meta: {...} }; aceitamos também um array puro.
export function listData<T>(res: unknown): T[] {
  if (Array.isArray(res)) return res as T[];
  const d = (res as { data?: unknown })?.data;
  return Array.isArray(d) ? (d as T[]) : [];
}

export async function pfmListAll<T>(path: string, query: Record<string, string | string[] | undefined> = {}): Promise<T[]> {
  const out: T[] = [];
  const limit = 100;
  for (let offset = 0; offset < 5000; offset += limit) {
    const page = listData<T>(await pfm(path, { query: { ...query, limit: String(limit), offset: String(offset) } }));
    out.push(...page);
    if (page.length < limit) break;
  }
  return out;
}

// ---- Tipos (subconjunto do OpenAPI) ---------------------------------------
export interface PfmAccount {
  id: string;
  platform: string;
  username: string | null;
  user_id: string;
  profile_photo_url: string | null;
  status: "connected" | "disconnected";
  external_id: string | null;
  access_token_expires_at: string;
  metadata: Record<string, unknown> | null;
}

export interface PfmMedia {
  url: string;
  thumbnail_url?: string | null;
  thumbnail_timestamp_ms?: number | null;
}

export interface PfmPost {
  id: string;
  external_id: string | null;
  caption: string;
  status: "draft" | "scheduled" | "processing" | "processed";
  scheduled_at: string | null;
  social_accounts: PfmAccount[];
  media: PfmMedia[] | null;
  created_at: string;
  updated_at: string;
}

export interface PfmResult {
  id: string;
  social_account_id: string;
  post_id: string;
  success: boolean;
  error: unknown;
  details: unknown;
  platform_data: { id?: string; url?: string } | null;
}

export interface PfmWebhook {
  id: string;
  url: string;
  secret: string;
  event_types: string[];
}
