// InstaFlow · IA para variações de legenda.
//
// A chave é do TIME (tela Config; só dono/admin grava) e fica numa tabela que
// só o service_role lê — nunca volta para o navegador. O provedor sai do
// prefixo da chave: Google Gemini (AIza…, tem plano grátis), Groq (gsk_…,
// grátis), OpenRouter (sk-or-…), Anthropic (sk-ant-…) e OpenAI (sk-…).
// Todos menos a Anthropic falam o formato de chat da OpenAI.
//
// A resposta é conferida: números (ex.: 44144), @menções e links do original
// têm que estar em todas as versões, sem nenhum a mais; hashtags novas saem e
// as que faltarem voltam no fim. Versão repetida ou fora da regra é descartada
// (o painel completa com o gerador local).

export type Provider = "gemini" | "groq" | "openrouter" | "anthropic" | "openai";

export const PROVIDERS: Record<Provider, { label: string; base: string; models: string[] }> = {
  gemini: { label: "Google Gemini", base: "https://generativelanguage.googleapis.com/v1beta/openai", models: ["gemini-2.5-flash", "gemini-flash-latest", "gemini-2.5-flash-lite"] },
  groq: { label: "Groq", base: "https://api.groq.com/openai/v1", models: ["llama-3.3-70b-versatile", "openai/gpt-oss-120b"] },
  openrouter: { label: "OpenRouter", base: "https://openrouter.ai/api/v1", models: ["google/gemini-2.5-flash", "meta-llama/llama-3.3-70b-instruct:free"] },
  anthropic: { label: "Anthropic (Claude)", base: "https://api.anthropic.com/v1", models: ["claude-haiku-4-5-20251001", "claude-haiku-4-5"] },
  openai: { label: "OpenAI", base: "https://api.openai.com/v1", models: ["gpt-4.1-mini", "gpt-4o-mini"] },
};

// Chave que NÃO é de IA (o GitHub Models foi desativado em 2026; o gh/GitHub não gera texto).
export const isGithubToken = (key: string) => /^(gh[pousr]_|github_pat_)/.test(key.trim());

export function detectProvider(key: string): Provider | null {
  const k = key.trim();
  if (/^AIza[0-9A-Za-z_-]{20,}$/.test(k)) return "gemini";
  if (/^gsk_[0-9A-Za-z]{20,}$/.test(k)) return "groq";
  if (/^sk-or-[0-9A-Za-z_-]{20,}$/.test(k)) return "openrouter";
  if (/^sk-ant-[0-9A-Za-z_-]{20,}$/.test(k)) return "anthropic";
  if (/^sk-[0-9A-Za-z_-]{20,}$/.test(k)) return "openai";
  return null;
}

export function keyHint(key: string): string {
  const k = key.trim();
  return k.length <= 12 ? "••••" : `${k.slice(0, 4)}…${k.slice(-4)}`;
}

export type IaKind = "chave" | "cota" | "modelo" | "rede" | "resposta";
export class IaError extends Error {
  kind: IaKind;
  status: number;
  constructor(kind: IaKind, status: number, message: string) {
    super(message);
    this.kind = kind;
    this.status = status;
  }
}

export function classify(status: number, msg: string): IaKind {
  const m = msg.toLowerCase();
  if (status === 401 || status === 403 || /api[ _-]?key|invalid.*key|unauthori[sz]ed|authentication|permission denied/.test(m)) return "chave";
  if (status === 429 || /quota|rate.?limit|resource_exhausted|too many requests|insufficient_quota|credit/.test(m)) return "cota";
  if (status === 404 || /model.{0,40}(not found|does not exist|not supported|unknown|decommissioned|deprecated|not available)|no such model|unsupported model|invalid model/.test(m)) return "modelo";
  if (status >= 500 || status === 0) return "rede";
  return "resposta";
}

// Mensagem em português para quem está na tela.
export function iaMessage(e: IaError, provider: Provider): string {
  const nome = PROVIDERS[provider].label;
  switch (e.kind) {
    case "chave": return `${nome} recusou a chave. Confira se ela foi copiada inteira ou gere outra.`;
    case "cota": return `A cota de uso em ${nome} acabou por agora. Tente de novo mais tarde (no plano grátis o limite volta sozinho).`;
    case "modelo": return `Nenhum modelo de ${nome} respondeu para esta chave.`;
    case "rede": return `${nome} não respondeu (${e.message}).`;
    default: return `${nome} devolveu uma resposta que não deu para usar (${e.message.slice(0, 160)}).`;
  }
}

type Fetch = typeof fetch;
export interface ChatArgs {
  provider: Provider;
  key: string;
  model: string;
  system: string;
  user: string;
  maxTokens: number;
  temperature: number;
  json: boolean;
  allowEmpty?: boolean;
  base?: string; // testes
  fetchImpl?: Fetch; // testes
  timeoutMs?: number;
}

function errText(d: unknown): string | null {
  let x = d as Record<string, unknown> | unknown[] | null;
  if (!x) return null;
  if (Array.isArray(x)) x = (x[0] ?? null) as Record<string, unknown> | null;
  if (!x || typeof x !== "object") return null;
  const e = (x as Record<string, unknown>).error ?? x;
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && typeof (e as Record<string, unknown>).message === "string") return (e as Record<string, string>).message;
  return null;
}

export async function chat(a: ChatArgs): Promise<string> {
  const f = a.fetchImpl ?? fetch;
  const base = (a.base ?? PROVIDERS[a.provider].base).replace(/\/+$/, "");
  const signal = AbortSignal.timeout(a.timeoutMs ?? 50_000);
  let res: Response;
  try {
    if (a.provider === "anthropic") {
      res = await f(`${base}/messages`, {
        method: "POST",
        signal,
        headers: { "x-api-key": a.key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: a.model, max_tokens: a.maxTokens, temperature: Math.min(1, a.temperature), system: a.system, messages: [{ role: "user", content: a.user }] }),
      });
    } else {
      const body: Record<string, unknown> = {
        model: a.model,
        messages: [{ role: "system", content: a.system }, { role: "user", content: a.user }],
        max_tokens: a.maxTokens,
        temperature: a.temperature,
      };
      if (a.json) body.response_format = { type: "json_object" };
      // Gemini 2.5 "pensa" antes de responder e gasta tokens/tempo; aqui não precisa.
      if (a.provider === "gemini" && /^gemini-2\.5/.test(a.model)) body.reasoning_effort = "none";
      const headers: Record<string, string> = { Authorization: `Bearer ${a.key}`, "Content-Type": "application/json" };
      if (a.provider === "openrouter") { headers["HTTP-Referer"] = "https://guilhermevv123.github.io/instaflow/"; headers["X-Title"] = "InstaFlow"; }
      res = await f(`${base}/chat/completions`, { method: "POST", signal, headers, body: JSON.stringify(body) });
    }
  } catch (e) {
    const name = (e as Error)?.name;
    throw new IaError("rede", 0, name === "TimeoutError" || name === "AbortError" ? "demorou demais para responder" : "sem conexão com o provedor");
  }
  const text = await res.text();
  let data: Record<string, unknown> | null = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    const msg = errText(data) ?? (text.slice(0, 200) || `HTTP ${res.status}`);
    throw new IaError(classify(res.status, msg), res.status, msg);
  }
  let content = "";
  if (a.provider === "anthropic") {
    const parts = (data?.content ?? []) as Array<{ type?: string; text?: string }>;
    content = parts.filter((c) => c?.type === "text").map((c) => c.text ?? "").join("");
  } else {
    const choices = (data?.choices ?? []) as Array<{ message?: { content?: unknown } }>;
    const c = choices[0]?.message?.content;
    content = typeof c === "string" ? c : Array.isArray(c) ? c.map((p) => (typeof p === "string" ? p : (p as { text?: string })?.text ?? "")).join("") : "";
  }
  if (!content.trim() && !a.allowEmpty) throw new IaError("resposta", 200, "resposta vazia");
  return content;
}

// Tenta o modelo salvo e depois os do provedor. Chave recusada para na hora;
// modelo sumido ou cota esgotada passam para o próximo; falha de rede tenta de novo uma vez.
export async function chatWithFallback(a: Omit<ChatArgs, "model"> & { preferred?: string | null }): Promise<{ text: string; model: string }> {
  const lista = [...new Set([a.preferred, ...PROVIDERS[a.provider].models].filter((m): m is string => Boolean(m)))];
  let ultimo: IaError | null = null;
  for (const model of lista) {
    for (let tentativa = 0; tentativa < 2; tentativa++) {
      try {
        return { text: await chat({ ...a, model }), model };
      } catch (e) {
        if (!(e instanceof IaError)) throw e;
        ultimo = e;
        if (e.kind === "chave") throw e;
        if (e.kind === "rede" && tentativa === 0) continue;
        break;
      }
    }
  }
  throw ultimo ?? new IaError("modelo", 0, "nenhum modelo disponível");
}

// ---------------------------------------------------------------- prompt
export function promptVariacoes(caption: string, count: number): { system: string; user: string } {
  const system = [
    "Você é redator de redes sociais no Brasil. Reescreva a legenda recebida em várias versões para publicar o MESMO post em contas diferentes, sem repetir o texto.",
    "Regras obrigatórias:",
    "1. Mesma mensagem, mesmo tom e a mesma pessoa gramatical do original, em português do Brasil natural.",
    "2. Não invente fatos, promessas, números, datas, lugares, nomes, @menções nem links, e não acrescente hashtags.",
    "3. Copie exatamente, sem mudar nenhum caractere, todos os números (por exemplo 44144), @menções, links e #hashtags do original. As hashtags do fim podem trocar de ordem.",
    "4. Emojis: pode trocar por equivalentes ou mudar de lugar, mas não troque a cor de corações nem bandeiras, e não coloque emoji se o original não tem.",
    "5. Tamanho parecido com o original (entre 80% e 120% dos caracteres) e quebras de linha no mesmo estilo. Se a legenda tiver menos de 80 caracteres, cada versão pode ter até o dobro do tamanho, com uma frase curta de reforço no mesmo sentido (sem fatos novos).",
    "6. Cada versão precisa ser claramente diferente do original e das outras: mude a abertura, a ordem das ideias e as palavras, sem mudar o sentido. Trocar só emoji ou pontuação não conta como versão diferente.",
    "7. Não use aspas em volta, não numere, não explique nada.",
    'Responda somente com JSON no formato {"variacoes": ["versão 1", "versão 2"]}.',
  ].join("\n");
  const user = `Quantidade de versões: ${count}\n\nLegenda original:\n<<<\n${caption}\n>>>`;
  return { system, user };
}

export function maxTokensFor(caption: string, count: number): number {
  return Math.min(16_000, Math.max(1_024, Math.ceil((caption.length / 2.6) * count * 1.35) + 400));
}

export function parseVariacoes(text: string): string[] {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const tryParse = (s: string): unknown => { try { return JSON.parse(s); } catch { return undefined; } };
  let d = tryParse(t);
  if (d === undefined) { const i = t.indexOf("{"), j = t.lastIndexOf("}"); if (i >= 0 && j > i) d = tryParse(t.slice(i, j + 1)); }
  if (d === undefined) { const i = t.indexOf("["), j = t.lastIndexOf("]"); if (i >= 0 && j > i) d = tryParse(t.slice(i, j + 1)); }
  const o = d as Record<string, unknown> | unknown[] | undefined;
  const arr = Array.isArray(o) ? o
    : o && typeof o === "object" ? ((o.variacoes ?? o.variações ?? o.variations ?? o.versoes ?? o.versões ?? []) as unknown[])
    : [];
  if (!Array.isArray(arr)) return [];
  return arr
    .map((x) => (typeof x === "string" ? x : x && typeof x === "object" && typeof (x as { texto?: unknown }).texto === "string" ? (x as { texto: string }).texto : ""))
    .map((s) => s.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------- conferência
const RE_URL = /(?:https?:\/\/|www\.)[^\s]+/gi;
const RE_MEN = /@[\p{L}\p{N}_.]*[\p{L}\p{N}_]/gu;
const RE_TAG = /#[\p{L}\p{N}_]+/gu;
const RE_NUM = /\d+(?:[.,:/]\d+)*/g;
const limpaUrl = (u: string) => u.replace(/[.,!?;:)\]]+$/, "");
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Só as palavras, números, @ e # (sem emoji, pontuação, "!!1" e ordem de espaços).
export const soPalavras = (s: string) =>
  norm(s).replace(/(?<=[!?])1+(?![\p{L}\p{N}])/gu, "").replace(/[^\p{L}\p{N}#@\s]/gu, " ").replace(/\s+/g, " ").trim();

export function tokens(text: string) {
  const urls = [...text.matchAll(RE_URL)].map((m) => limpaUrl(m[0]));
  // "!!1" é pontuação de brincadeira, não número que precisa ficar igual
  const semUrl = text.replace(RE_URL, " ").replace(/(?<=[!?])1+(?![\p{L}\p{N}])/gu, " ");
  const mencoes = [...semUrl.matchAll(RE_MEN)].map((m) => m[0].toLowerCase());
  const tags = [...semUrl.matchAll(RE_TAG)].map((m) => m[0]);
  const nums = [...semUrl.replace(RE_MEN, " ").replace(RE_TAG, " ").matchAll(RE_NUM)].map((m) => m[0]);
  return { urls, mencoes, tags, nums };
}

export function validarVariacoes(original: string, candidatas: string[], max: number): string[] {
  const o = tokens(original);
  const oNums = new Set(o.nums), oMen = new Set(o.mencoes), oUrls = new Set(o.urls);
  const oTags = new Map(o.tags.map((t) => [t.toLowerCase(), t]));
  const vistos = new Set([norm(original), `w:${soPalavras(original)}`]);
  const out: string[] = [];
  for (let c of candidatas) {
    if (out.length >= max) break;
    c = String(c).replace(/\r\n/g, "\n").trim().replace(/^["“'«]+(?=\S)/, "").replace(/(?<=\S)["”'»]+$/, "").replace(/\n{3,}/g, "\n\n").trim();
    if (!c) continue;
    const t = tokens(c);
    if (o.nums.some((n) => !t.nums.includes(n)) || t.nums.some((n) => !oNums.has(n))) continue;
    if ([...oMen].some((m) => !t.mencoes.includes(m)) || t.mencoes.some((m) => !oMen.has(m))) continue;
    if ([...oUrls].some((u) => !t.urls.includes(u)) || t.urls.some((u) => !oUrls.has(u))) continue;
    for (const tag of t.tags) {
      if (!oTags.has(tag.toLowerCase())) c = c.replace(new RegExp(`[ \\t]*${escRe(tag)}(?![\\p{L}\\p{N}_])`, "u"), "");
    }
    const tem = new Set(tokens(c).tags.map((x) => x.toLowerCase()));
    const faltam = [...new Set(o.tags.filter((tag) => !tem.has(tag.toLowerCase())))];
    if (faltam.length) c = `${c.trimEnd()}\n\n${faltam.join(" ")}`;
    c = c.split("\n").map((l) => l.replace(/[ \t]+$/, "")).join("\n").replace(/\n{3,}/g, "\n\n").trim();
    if (!c || c.length > 2200) continue;
    const k = norm(c);
    // igual ao original (ou a outra versão) tirando emojis e pontuação = não é variação de verdade
    const kPalavras = `w:${soPalavras(c)}`;
    if (vistos.has(k) || vistos.has(kPalavras)) continue;
    vistos.add(k);
    vistos.add(kPalavras);
    out.push(c);
  }
  return out;
}
