import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

export const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// Origens que podem chamar a API pelo navegador. Configure INSTAFLOW_ALLOWED_ORIGINS
// (separadas por vírgula) nos secrets; localhost entra sempre para testes.
// (Nome com prefixo para não colidir com secrets de outros apps no mesmo projeto.)
const extraOrigins = (Deno.env.get("INSTAFLOW_ALLOWED_ORIGINS") ?? Deno.env.get("ALLOWED_ORIGINS") ?? "")
  .split(",").map((s) => s.trim()).filter(Boolean);

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const ok = extraOrigins.includes(origin) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ||
    // painel hospedado no EasyPanel (domínio padrão) ou direto no IP do servidor
    /^https:\/\/([a-z0-9-]+\.)+easypanel\.host$/i.test(origin) ||
    /^https?:\/\/5\.181\.218\.72(:\d+)?$/.test(origin) ||
    origin.startsWith("file://") || extraOrigins.includes("*");
  return {
    // com chave de API (ifk_…) qualquer origem pode chamar: a chave é a credencial. A consulta
    // prévia do navegador (OPTIONS) não leva o token, então também libera; sem cookie, não há CSRF.
    "Access-Control-Allow-Origin": ok || isApiKeyRequest(req) || req.method === "OPTIONS" ? (origin || "*") : (extraOrigins[0] ?? "null"),
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-team, idempotency-key",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Expose-Headers": "X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, X-Request-Id, Idempotent-Replayed",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

// Chaves da API pública: ifk_ + 40 letras/números. Guardamos só o SHA-256.
export const API_KEY_RE = /^ifk_[A-Za-z0-9]{40}$/;
export function bearerOf(req: Request): string {
  const auth = req.headers.get("authorization") ?? "";
  return auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
}
export const isApiKeyRequest = (req: Request) => API_KEY_RE.test(bearerOf(req));

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const B62 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
export function randomToken(prefix: string, len: number): string {
  let out = "";
  while (out.length < len) {
    const bytes = crypto.getRandomValues(new Uint8Array(len * 2));
    for (const b of bytes) { if (b < 248 && out.length < len) out += B62[b % 62]; } // 248 = 4×62: sem viés
  }
  return prefix + out;
}

export function json(req: Request, body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(req), ...extra },
  });
}

export class HttpError extends Error {
  status: number;
  code?: string; // para o painel decidir o que fazer (ex.: "sem_ia" → gerador local)
  apiKey?: ApiKeyInfo; // preenchido quando a chave existe mas passou do limite (para registrar a chamada)
  teamId?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function serviceClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}

export interface ApiKeyInfo {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];        // vazio = tudo; "read" = só leitura
  accountIds: string[] | null; // null = todas as contas do time
  rateLimit: number;
  count: number;           // chamadas neste minuto (esta inclusa)
  reset: string;           // quando o minuto vira
}

export interface Caller {
  id: string | null;       // null quando quem chama é uma chave de API
  email: string;
  teamId: string;
  teamName: string;
  role: "owner" | "admin" | "editor" | "api";
  maxAccounts: number | null; // nulo = sem limite de contas
  maxPostsMonth: number;
  via: "jwt" | "key";
  apiKey?: ApiKeyInfo;
}

export const isAdmin = (c: Caller) => c.role === "owner" || c.role === "admin";
export const canWrite = (c: Caller) => !(c.apiKey?.scopes ?? []).includes("read");
// Conta permitida para esta chave (chave sem restrição vê todas do time).
export const accountAllowed = (c: Caller, accountId: string) => !c.apiKey?.accountIds || c.apiKey.accountIds.includes(accountId);

// Quem chama: o painel (JWT do Supabase Auth, time pelo cabeçalho X-Team) ou
// uma chave da API pública (ifk_…, presa a um time).
export async function requireMember(req: Request): Promise<Caller> {
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.toLowerCase().startsWith("bearer ")) throw new HttpError(401, "Faltou a autorização: envie o cabeçalho Authorization: Bearer <sua chave ifk_…> (ou entre no painel).", "sem_autorizacao");
  const token = bearerOf(req);
  if (API_KEY_RE.test(token)) return requireApiKey(req);
  if (token.startsWith("ifk_")) throw new HttpError(401, "Chave de API em formato inválido: ela começa com ifk_ e tem 44 caracteres. Copie de novo, sem espaços, ou gere outra em Config → API.", "chave_invalida");
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const { data, error } = await userClient.auth.getUser();
  if (error || !data.user?.email) throw new HttpError(401, "Sessão inválida ou expirada. Entre de novo.");
  const email = data.user.email.toLowerCase();

  const { data: memberships, error: mErr } = await serviceClient()
    .from("team_members")
    .select("team_id, role, joined_at, teams(name, max_accounts, max_posts_month)")
    .eq("user_id", data.user.id)
    .order("joined_at");
  if (mErr) throw new HttpError(500, mErr.message);
  if (!memberships?.length) throw new HttpError(403, "Sua conta ainda não está em nenhum time. Saia e entre de novo.");

  const wanted = req.headers.get("x-team")?.trim();
  const m = wanted ? memberships.find((x) => x.team_id === wanted) : memberships[0];
  if (!m) throw new HttpError(403, "Você não faz parte deste time.");
  const team = (Array.isArray(m.teams) ? m.teams[0] : m.teams) as { name: string; max_accounts: number; max_posts_month: number } | null;
  return {
    id: data.user.id,
    email,
    teamId: m.team_id,
    teamName: team?.name ?? "Time",
    role: m.role as Caller["role"],
    maxAccounts: team?.max_accounts ?? null,
    maxPostsMonth: team?.max_posts_month ?? 1000,
    via: "jwt",
  };
}

async function requireApiKey(req: Request): Promise<Caller> {
  const db = serviceClient();
  const { data, error } = await db.rpc("api_key_hit", { p_hash: await sha256Hex(bearerOf(req)) });
  if (error) throw new HttpError(500, error.message);
  const k = data as { id: string; team_id: string; name: string; prefix: string; scopes: string[] | null; account_ids: string[] | null; rate_limit: number; count: number; reset: string; revoked?: boolean } | null;
  if (!k) throw new HttpError(401, "Chave de API inválida. Gere uma nova em Config → API.", "chave_invalida");
  if (k.revoked) throw new HttpError(401, "Esta chave de API foi revogada.", "chave_revogada");
  const apiKey: ApiKeyInfo = { id: k.id, name: k.name, prefix: k.prefix, scopes: k.scopes ?? [], accountIds: k.account_ids ?? null, rateLimit: k.rate_limit, count: k.count, reset: k.reset };
  if (k.count > k.rate_limit) {
    const e = new HttpError(429, `Limite de ${k.rate_limit} chamadas por minuto desta chave. Tente de novo em instantes.`, "limite_chamadas");
    e.apiKey = apiKey;
    e.teamId = k.team_id;
    throw e;
  }
  const { data: team, error: tErr } = await db.from("teams").select("name, max_accounts, max_posts_month").eq("id", k.team_id).maybeSingle();
  if (tErr) throw new HttpError(500, tErr.message);
  if (!team) throw new HttpError(401, "O time desta chave não existe mais.", "chave_invalida");
  return {
    id: null,
    email: `chave:${k.name}`,
    teamId: k.team_id,
    teamName: team.name ?? "Time",
    role: "api",
    maxAccounts: team.max_accounts ?? null,
    maxPostsMonth: team.max_posts_month ?? 1000,
    via: "key",
    apiKey,
  };
}

// As contas conectadas pelo painel levam este prefixo no external_id do
// Post for Me, e é por ele que o webhook sabe de que time a conta é.
const TEAM_TAG = /^ifteam_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
export function teamTag(teamId: string): string {
  return `ifteam_${teamId}_${crypto.randomUUID().slice(0, 8)}`;
}
export function teamOf(externalId: string | null | undefined): string | null {
  const m = TEAM_TAG.exec(externalId ?? "");
  return m ? m[1].toLowerCase() : null;
}

export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, "Corpo da requisição não é JSON válido.");
  }
}

export function timingSafeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}

// Tarefa em segundo plano depois de responder (Supabase Edge Runtime).
export function background(p: Promise<unknown>): void {
  const rt = (globalThis as unknown as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(p);
  else p.catch((e) => console.error(e));
}
