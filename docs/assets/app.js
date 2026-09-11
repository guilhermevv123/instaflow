// InstaFlow · código compartilhado do painel (ES module, sem build).
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

export const cfg = window.INSTAFLOW_CONFIG || {};
export const TZ = "America/Bahia"; // UTC-3, sem horário de verão
export const configured = Boolean(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);

export const supa = configured
  ? createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY)
  : null;

// ---------------------------------------------------------------------------
// Sessão
// ---------------------------------------------------------------------------
export async function requireAuth(rootRel = "../") {
  if (!configured) {
    showSetupNotice();
    return new Promise(() => {}); // para o módulo aqui, sem erro no console
  }
  const { data } = await supa.auth.getSession();
  if (!data.session) {
    const next = encodeURIComponent(location.pathname + location.search);
    location.replace(`${rootRel}entrar/?next=${next}`);
    return new Promise(() => {}); // a página está saindo; nada mais roda
  }
  return data.session;
}

export async function signOut(rootRel = "../") {
  await supa?.auth.signOut();
  location.href = `${rootRel}entrar/`;
}

function showSetupNotice() {
  document.body.innerHTML = `
    <main class="shell narrow">
      <h1 class="h1">Falta ligar o InstaFlow ao Supabase</h1>
      <p class="muted">O arquivo <code>assets/config.js</code> ainda está vazio. Rode <code>scripts/write-config.sh</code>
      depois de criar o projeto no Supabase, ou preencha <code>SUPABASE_URL</code> e <code>SUPABASE_ANON_KEY</code> à mão.</p>
    </main>`;
}

// ---------------------------------------------------------------------------
// Chamada à função `api` (camada do meio) com o token do usuário
// ---------------------------------------------------------------------------
export async function api(path, { method = "GET", body } = {}) {
  const { data } = await supa.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Sessão expirada. Entre de novo.");
  const res = await fetch(`${cfg.SUPABASE_URL}/functions/v1/api${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: cfg.SUPABASE_ANON_KEY,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let payload = null;
  const text = await res.text();
  try { payload = text ? JSON.parse(text) : null; } catch { payload = { error: text }; }
  if (!res.ok) throw new Error(payload?.error || `Erro ${res.status}`);
  return payload;
}

// ---------------------------------------------------------------------------
// Datas (sempre mostradas no horário da Bahia)
// ---------------------------------------------------------------------------
const dtf = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const dtfLong = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const tf = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const df = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" });
const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export const fmt = {
  dateTime: (iso) => (iso ? dtf.format(new Date(iso)) : "—"),
  dateTimeLong: (iso) => (iso ? dtfLong.format(new Date(iso)).replace(".", "") : "—"),
  time: (iso) => (iso ? tf.format(new Date(iso)) : "—"),
  date: (iso) => (iso ? df.format(new Date(iso)) : "—"),
  // 'YYYY-MM-DD' no fuso da Bahia (para agrupar no calendário)
  dayKey(iso) {
    const p = Object.fromEntries(parts.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}`;
  },
  // ISO → valor de <input type="datetime-local"> no fuso da Bahia
  toLocalInput(iso) {
    const p = Object.fromEntries(parts.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
  },
  // valor de <input type="datetime-local"> (horário da Bahia) → ISO UTC
  fromLocalInput(value) {
    if (!value) return null;
    return new Date(`${value}:00-03:00`).toISOString();
  },
  bytes(n) {
    if (!n && n !== 0) return "";
    if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  },
  relative(iso) {
    if (!iso) return "";
    const diff = new Date(iso) - Date.now();
    const abs = Math.abs(diff);
    const m = Math.round(abs / 60000);
    let txt;
    if (m < 1) txt = "agora";
    else if (m < 60) txt = `${m} min`;
    else if (m < 60 * 36) txt = `${Math.round(m / 60)} h`;
    else txt = `${Math.round(m / 1440)} dias`;
    return diff >= 0 ? `em ${txt}` : `há ${txt}`;
  },
};

// Próximo horário "redondo" (daqui a 1 h, minutos zerados) para o agendador
export function defaultScheduleValue() {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setMinutes(0, 0, 0);
  return fmt.toLocalInput(d.toISOString());
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function toast(message, kind = "info", ms = 4200) {
  let host = document.querySelector(".toasts");
  if (!host) {
    host = document.createElement("div");
    host.className = "toasts";
    document.body.appendChild(host);
  }
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.setAttribute("role", "status");
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => el.classList.add("show"));
  setTimeout(() => { el.classList.remove("show"); setTimeout(() => el.remove(), 300); }, ms);
}

export function renderNav(active, rootRel, email) {
  const items = [
    ["inicio", "Início", ""],
    ["calendario", "Calendário", "calendario/"],
    ["criar", "Criar", "criar/"],
    ["contas", "Contas", "contas/"],
    ["fila", "Fila", "fila/"],
    ["biblioteca", "Biblioteca", "biblioteca/"],
    ["config", "Config", "config/"],
  ];
  const nav = document.querySelector("header.top");
  if (!nav) return;
  nav.innerHTML = `
    <a class="brand" href="${rootRel}" aria-label="InstaFlow, início"><img class="brand-logo" src="${rootRel}assets/brand/instaflow-logo.svg" alt="InstaFlow"></a>
    <nav class="tabs" aria-label="Seções">
      ${items.map(([k, label, href]) => `<a href="${rootRel}${href}" class="${k === active ? "on" : ""}" ${k === active ? 'aria-current="page"' : ""}>${label}</a>`).join("")}
    </nav>
    <div class="who"><span class="muted small">${esc(email || "")}</span><button class="btn ghost small" id="btn-sair">Sair</button></div>`;
  nav.querySelector("#btn-sair")?.addEventListener("click", () => signOut(rootRel));
}

export function avatar(acc, size = 28) {
  const letter = (acc?.username || acc?.label || "?")[0].toUpperCase();
  if (acc?.profile_photo_url) {
    return `<img class="av" width="${size}" height="${size}" src="${esc(acc.profile_photo_url)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'av',textContent:'${esc(letter)}'}))">`;
  }
  return `<span class="av" style="width:${size}px;height:${size}px">${esc(letter)}</span>`;
}

export function accountName(acc) {
  return acc?.label ? `${acc.label} <span class="muted">@${esc(acc.username || "")}</span>` : `@${esc(acc?.username || acc?.id || "")}`;
}

export const POST_STATUS = {
  draft: ["Rascunho", "neutral"],
  scheduled: ["Agendada", "time"],
  processing: ["Publicando…", "time"],
  processed: ["Concluída", "ok"],
  canceled: ["Cancelada", "neutral"],
  error: ["Erro", "bad"],
};
export const TARGET_STATUS = {
  pending: ["Aguardando", "time"],
  published: ["Publicado", "ok"],
  failed: ["Falhou", "bad"],
};
export const PLACEMENT = { timeline: "Feed", reels: "Reels", stories: "Stories" };

export function pill(map, status) {
  const [label, kind] = map[status] || [status, "neutral"];
  return `<span class="pill ${kind}">${esc(label)}</span>`;
}

// Resume o estado de uma publicação com base nas contas (18 de 20 etc.)
export function postSummaryPill(p) {
  const total = p.targets_total ?? 0;
  if (p.status === "canceled") return pill(POST_STATUS, "canceled");
  if (p.status === "scheduled" || p.status === "draft") return pill(POST_STATUS, p.status);
  const ok = p.targets_published ?? 0, bad = p.targets_failed ?? 0, pend = p.targets_pending ?? 0;
  if (pend > 0) return `<span class="pill time">${ok + bad} de ${total}</span>`;
  if (bad === 0) return `<span class="pill ok">${ok} de ${total} publicadas</span>`;
  if (ok === 0) return `<span class="pill bad">${bad} falharam</span>`;
  return `<span class="pill warn">${ok} de ${total} · ${bad} falharam</span>`;
}

// ---------------------------------------------------------------------------
// Dados
// ---------------------------------------------------------------------------
export async function loadAccounts({ includeArchived = false } = {}) {
  let q = supa.from("accounts").select("*").order("label", { ascending: true, nullsFirst: false }).order("username");
  if (!includeArchived) q = q.eq("archived", false);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function loadGroups() {
  const [{ data: groups, error }, { data: members }] = await Promise.all([
    supa.from("account_groups").select("*").order("name"),
    supa.from("account_group_members").select("*"),
  ]);
  if (error) throw error;
  return (groups || []).map((g) => ({ ...g, account_ids: (members || []).filter((m) => m.group_id === g.id).map((m) => m.account_id) }));
}

export function daysUntil(iso) {
  if (!iso) return null;
  return Math.floor((new Date(iso) - Date.now()) / 86400000);
}

// Estado de saúde da conta para o painel
export function accountHealth(acc) {
  if (acc.status !== "connected") return ["Reconectar", "bad"];
  const d = daysUntil(acc.access_token_expires_at);
  if (d !== null && d <= 7) return [`Renova em ${Math.max(d, 0)} d`, "warn"];
  return ["Conectada", "ok"];
}

export function qs(name) {
  return new URLSearchParams(location.search).get(name);
}

export function confirmDialog(text) {
  return Promise.resolve(window.confirm(text));
}
