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
    "Access-Control-Allow-Origin": ok ? origin : (extraOrigins[0] ?? "null"),
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-team",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export function json(req: Request, body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(req), ...extra },
  });
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function serviceClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}

export interface Caller {
  id: string;
  email: string;
  teamId: string;
  teamName: string;
  role: "owner" | "admin" | "editor";
  maxAccounts: number;
  maxPostsMonth: number;
}

// Confere o JWT do usuário chamando o Auth e resolve o time em que ele está
// trabalhando (cabeçalho X-Team; sem ele, o primeiro time da pessoa).
export async function requireMember(req: Request): Promise<Caller> {
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.toLowerCase().startsWith("bearer ")) throw new HttpError(401, "Faça login para continuar.");
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
    maxAccounts: team?.max_accounts ?? 20,
    maxPostsMonth: team?.max_posts_month ?? 300,
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
