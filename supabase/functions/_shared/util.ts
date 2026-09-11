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
    origin.startsWith("file://") || extraOrigins.includes("*");
  return {
    "Access-Control-Allow-Origin": ok ? origin : (extraOrigins[0] ?? "null"),
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
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
  role: "admin" | "editor";
}

// Confere o JWT do usuário chamando o Auth (funciona com qualquer tipo de
// chave) e depois confere se o e-mail está na lista de permitidos.
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
  const { data: allowed } = await serviceClient()
    .from("allowed_users").select("role").ilike("email", email).maybeSingle();
  if (!allowed) throw new HttpError(403, `O e-mail ${email} não tem acesso a este painel.`);
  return { id: data.user.id, email, role: allowed.role as Caller["role"] };
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
