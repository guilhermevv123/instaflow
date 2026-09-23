// InstaFlow · rotas da IA das variações de legenda (chamadas por api/index.ts).
// Ficam fora do index.ts para dar para testar sem subir o servidor: o banco e a
// chamada à IA entram como parâmetro (ia-rotas_test.ts usa versões falsas).
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { type Caller, HttpError, isAdmin } from "./util.ts";
import { chat, chatWithFallback, conferirVariacoes, detectProvider, IaError, iaMessage, type IaModel, isGithubToken, keyHint, listModels, maxTokensFor, MODEL_ID_RE, parseVariacoes, promptVariacoes, PROVIDERS, type Provider, validarVariacoes } from "./ia.ts";
// cópia exata de docs/assets/variar.js (variar_sync_test.ts confere): o mesmo gerador do painel
import { variarLegenda } from "./variar.js";

export const AI_DAILY_LIMIT = 150;
type Db = SupabaseClient;
type ChatFn = typeof chatWithFallback;
type ModelsFn = typeof listModels;
type TestFn = typeof chat;

interface TeamAiKey { provider: Provider; api_key: string; model: string | null; updated_at: string }

async function teamAi(db: Db, teamId: string): Promise<TeamAiKey | null> {
  const { data, error } = await db.from("team_ai_keys").select("provider, api_key, model, updated_at").eq("team_id", teamId).maybeSingle();
  if (error) throw new HttpError(500, error.message);
  return (data as TeamAiKey | null) ?? null;
}

async function aiCallsToday(db: Db, teamId: string): Promise<number> {
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { count, error } = await db.from("ai_calls").select("id", { count: "exact", head: true }).eq("team_id", teamId).gte("created_at", since);
  if (error) throw new HttpError(500, error.message);
  return count ?? 0;
}

// Estado da IA do time. Nunca devolve a chave: só o começo e o fim dela.
export async function aiStatus(db: Db, caller: Caller) {
  const [cfg, used] = await Promise.all([teamAi(db, caller.teamId), aiCallsToday(db, caller.teamId)]);
  return {
    configured: Boolean(cfg),
    provider: cfg?.provider ?? null,
    provider_label: cfg ? PROVIDERS[cfg.provider].label : null,
    model: cfg?.model ?? null,
    key_hint: cfg ? keyHint(cfg.api_key) : null,
    updated_at: cfg?.updated_at ?? null,
    calls_today: used,
    limit_day: AI_DAILY_LIMIT,
    can_edit: isAdmin(caller),
  };
}

export async function aiSave(db: Db, caller: Caller, body: { key?: string }, chatFn: ChatFn = chatWithFallback) {
  if (!isAdmin(caller)) throw new HttpError(403, "Só o dono ou um admin do time liga ou troca a IA.");
  const key = String(body.key ?? "").trim();
  if (!key) throw new HttpError(400, "Cole a chave da IA.");
  if (key.length > 300 || /\s/.test(key)) throw new HttpError(400, "Essa chave parece incompleta ou com espaço no meio. Copie de novo.");
  if (isGithubToken(key)) throw new HttpError(400, "Essa é uma chave do GitHub, e o GitHub não gera texto (o GitHub Models foi desativado). Crie uma chave grátis no Google AI Studio (começa com AIza) e cole aqui.");
  const provider = detectProvider(key);
  if (!provider) throw new HttpError(400, "Não reconheci essa chave. Use uma do Google AI Studio (começa com AIza), Groq (gsk_), OpenAI (sk-), Anthropic (sk-ant-) ou OpenRouter (sk-or-).");
  // Testa antes de salvar. Chave recusada não entra; cota esgotada entra (a chave vale, só o limite do dia acabou).
  let model = PROVIDERS[provider].models[0];
  let warning: string | null = null;
  try {
    ({ model } = await chatFn({ provider, key, system: "Responda apenas: ok", user: "ok?", maxTokens: 32, temperature: 0, json: false, allowEmpty: true, timeoutMs: 25_000 }));
  } catch (e) {
    if (!(e instanceof IaError)) throw e;
    if (e.kind === "cota") warning = iaMessage(e, provider);
    else throw new HttpError(e.kind === "chave" ? 400 : 502, iaMessage(e, provider), `ia_${e.kind}`);
  }
  const { error } = await db.from("team_ai_keys").upsert(
    { team_id: caller.teamId, provider, api_key: key, model, updated_by: caller.id, updated_at: new Date().toISOString() },
    { onConflict: "team_id" },
  );
  if (error) throw new HttpError(500, error.message);
  return { ...(await aiStatus(db, caller)), warning };
}

export async function aiRemove(db: Db, caller: Caller) {
  if (!isAdmin(caller)) throw new HttpError(403, "Só o dono ou um admin do time desliga a IA.");
  const { error } = await db.from("team_ai_keys").delete().eq("team_id", caller.teamId);
  if (error) throw new HttpError(500, error.message);
  return aiStatus(db, caller);
}

// Modelos de texto que a chave do time enxerga (para escolher em Config).
export async function aiModels(db: Db, caller: Caller, modelsFn: ModelsFn = listModels) {
  const cfg = await teamAi(db, caller.teamId);
  if (!cfg) throw new HttpError(409, "A IA ainda não foi ligada neste time (Config → Variações de legenda com IA).", "sem_ia");
  let models: IaModel[];
  try { models = await modelsFn(cfg.provider, cfg.api_key); }
  catch (e) {
    if (!(e instanceof IaError)) throw e;
    throw new HttpError(e.kind === "chave" ? 400 : 502, e.kind === "chave" ? iaMessage(e, cfg.provider) : `Não consegui a lista de modelos de ${PROVIDERS[cfg.provider].label} agora (${e.message}).`, `ia_${e.kind}`);
  }
  return { provider: cfg.provider, provider_label: PROVIDERS[cfg.provider].label, current: cfg.model, suggested: PROVIDERS[cfg.provider].models, models };
}

// Troca o modelo do time (dono/admin). Testa com a chave antes de salvar:
// modelo recusado não entra; cota esgotada entra com aviso (o modelo existe, só o limite acabou).
export async function aiSetModel(db: Db, caller: Caller, body: { model?: unknown }, testFn: TestFn = chat) {
  if (!isAdmin(caller)) throw new HttpError(403, "Só o dono ou um admin do time troca o modelo da IA.");
  const cfg = await teamAi(db, caller.teamId);
  if (!cfg) throw new HttpError(409, "A IA ainda não foi ligada neste time (Config → Variações de legenda com IA).", "sem_ia");
  const model = String(body.model ?? "").trim();
  if (!MODEL_ID_RE.test(model)) throw new HttpError(400, "Escolha um modelo da lista.");
  let warning: string | null = null;
  try {
    await testFn({ provider: cfg.provider, key: cfg.api_key, model, system: "Responda apenas: ok", user: "ok?", maxTokens: 32, temperature: 0, json: false, allowEmpty: true, timeoutMs: 30_000 });
  } catch (e) {
    if (!(e instanceof IaError)) throw e;
    if (e.kind === "cota") warning = iaMessage(e, cfg.provider);
    else if (e.kind === "modelo" || e.kind === "resposta") throw new HttpError(400, `${model} não respondeu com esta chave (${e.message.slice(0, 160)}). Escolha outro.`, "ia_modelo");
    else throw new HttpError(e.kind === "chave" ? 400 : 502, iaMessage(e, cfg.provider), `ia_${e.kind}`);
  }
  const { error } = await db.from("team_ai_keys").update({ model, updated_by: caller.id, updated_at: new Date().toISOString() }).eq("team_id", caller.teamId);
  if (error) throw new HttpError(500, error.message);
  return { ...(await aiStatus(db, caller)), warning };
}

// Como gerar: "auto" = IA do time quando ligada e o gerador automático no que
// faltar; "ai" = só IA (erro se não houver); "local" = só o gerador automático.
export const VARY_MODES = ["auto", "ai", "local"] as const;
export type VaryMode = typeof VARY_MODES[number];

export interface VaryResult {
  variations: Array<string | null>;
  requested: number;
  source: "ai" | "local" | "mixed" | "none";
  ai_count: number;
  local_count: number;
  weak: number; // do gerador automático, quantas só ganharam um emoji (legenda com pouco para variar)
  provider: Provider | null;
  provider_label: string | null;
  model: string | null;
  warning: string | null;
}

export interface VaryBody { caption?: unknown; count?: unknown; mode?: unknown; styles?: unknown }
export function checkVaryInput(body: VaryBody) {
  const caption = String(body.caption ?? "").replace(/\r\n/g, "\n").trim();
  if (!caption) throw new HttpError(400, "Escreva a legenda primeiro: as variações saem dela.");
  if (caption.length > 2200) throw new HttpError(400, "A legenda passa de 2.200 caracteres.");
  const count = Math.floor(Number(body.count));
  if (!Number.isFinite(count) || count < 1) throw new HttpError(400, "Diga quantas variações quer (count de 1 a 49).");
  if (count > 49) throw new HttpError(400, "No máximo 49 variações por vez.");
  if (body.mode !== undefined && !(VARY_MODES as readonly unknown[]).includes(body.mode)) throw new HttpError(400, 'mode inválido: use "auto", "ai" ou "local".');
  let styles: Array<string | null> = [];
  if (body.styles !== undefined && body.styles !== null) {
    if (!Array.isArray(body.styles) || body.styles.length !== count) throw new HttpError(400, "styles precisa ser uma lista com um estilo (ou null) para cada variação.");
    styles = body.styles.map((x) => {
      if (x === null || x === undefined || x === "") return null;
      if (typeof x !== "string") throw new HttpError(400, "Cada estilo precisa ser texto (ou null).");
      const t = x.replace(/\s+/g, " ").trim();
      if (t.length > 300) throw new HttpError(400, "Cada estilo pode ter até 300 caracteres.");
      return t || null;
    });
  }
  return { caption, count, mode: (body.mode ?? "auto") as VaryMode, styles };
}

// Com `styles` (um por conta), a resposta mantém a posição: variations[i] é da conta i
// (null onde a IA não entregou nada que preste e mode = "ai"). Sem estilos, a lista vem compacta.
export async function generateVariations(db: Db, caller: Caller, caption: string, count: number, mode: VaryMode = "auto", chatFn: ChatFn = chatWithFallback, styles: Array<string | null> = []): Promise<VaryResult> {
  const comEstilo = styles.some(Boolean);
  const cfg = mode === "local" ? null : await teamAi(db, caller.teamId);
  if (mode === "ai" && !cfg) throw new HttpError(409, "A IA ainda não foi ligada neste time (Config → Variações de legenda com IA).", "sem_ia");
  // slots[i] = versão da posição i (null = ainda falta)
  const slots: Array<string | null> = Array(count).fill(null);
  let model: string | null = null, warning: string | null = null;
  if (cfg) {
    if ((await aiCallsToday(db, caller.teamId)) >= AI_DAILY_LIMIT) {
      const msg = `Este time já usou as ${AI_DAILY_LIMIT} gerações com IA das últimas 24 horas.`;
      if (mode === "ai") throw new HttpError(429, msg, "limite_ia");
      warning = `${msg} Usei o gerador automático.`;
    } else {
      const log = async (row: Record<string, unknown>) => {
        const { error } = await db.from("ai_calls").insert({ team_id: caller.teamId, user_id: caller.id, provider: cfg.provider, requested: count, ...row });
        if (error) console.error("ai_calls:", error.message);
      };
      // até 2 rodadas: a 2ª só pede as posições que a 1ª não entregou (ex.: versão que só trocou emoji)
      try {
        for (let rodada = 0; rodada < 2; rodada++) {
          const faltam = slots.map((v, i) => (v === null ? i : -1)).filter((i) => i >= 0);
          if (!faltam.length) break;
          const { system, user } = promptVariacoes(caption, faltam.length, comEstilo ? faltam.map((i) => styles[i] ?? null) : []);
          const out = await chatFn({ provider: cfg.provider, key: cfg.api_key, preferred: cfg.model, system, user, maxTokens: maxTokensFor(caption, faltam.length), temperature: 0.9, json: true });
          const prontas = slots.filter((v): v is string => v !== null);
          const novas = comEstilo
            ? conferirVariacoes(caption, parseVariacoes(out.text).slice(0, faltam.length), prontas)
            : validarVariacoes(caption, parseVariacoes(out.text), faltam.length, prontas);
          novas.forEach((v, k) => { if (v !== null && k < faltam.length) slots[faltam[k]] = v; });
          model = out.model;
          await log({ model: out.model, requested: faltam.length, returned: novas.filter(Boolean).length, ok: true });
        }
      } catch (e) {
        if (!(e instanceof IaError)) throw e;
        await log({ ok: false, error: `${e.kind}: ${e.message}`.slice(0, 300) });
        // se a 1ª rodada já trouxe versões, não perde elas por causa da 2ª
        if (slots.some(Boolean)) warning = `${iaMessage(e, cfg.provider)} Algumas legendas ficaram de fora.`;
        else if (mode === "ai") throw new HttpError(e.kind === "chave" ? 400 : e.kind === "cota" ? 429 : 502, iaMessage(e, cfg.provider), `ia_${e.kind}`);
        else warning = `${iaMessage(e, cfg.provider)} Usei o gerador automático.`;
      }
    }
  }
  const aiCount = slots.filter(Boolean).length;
  let localCount = 0, weak = 0;
  if (mode !== "ai" && aiCount < count) {
    const faltam = slots.map((v, i) => (v === null ? i : -1)).filter((i) => i >= 0);
    const r = variarLegenda(caption, faltam.length, { seed: Date.now() & 0x7fffffff, evitar: slots.filter(Boolean) }) as { variacoes: string[]; fracas: number };
    r.variacoes.forEach((v, k) => { slots[faltam[k]] = v; });
    localCount = r.variacoes.length;
    weak = r.fracas;
  }
  return {
    variations: comEstilo ? slots : slots.filter((v): v is string => v !== null),
    requested: count,
    source: aiCount && localCount ? "mixed" : aiCount ? "ai" : localCount ? "local" : "none",
    ai_count: aiCount,
    local_count: localCount,
    weak,
    provider: cfg?.provider ?? null,
    provider_label: cfg ? PROVIDERS[cfg.provider].label : null,
    model,
    warning,
  };
}

export async function varyCaptions(db: Db, caller: Caller, body: VaryBody, chatFn: ChatFn = chatWithFallback) {
  // sem mode: o painel quer só a IA (ele mesmo completa com o gerador do navegador); a API usa "auto"
  const { caption, count, mode, styles } = checkVaryInput({ ...body, mode: body.mode ?? (caller.via === "jwt" ? "ai" : "auto") });
  return generateVariations(db, caller, caption, count, mode, chatFn, styles);
}
