// InstaFlow · código compartilhado do painel (ES module, sem build).
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

export const cfg = window.INSTAFLOW_CONFIG || {};
export const TZ = "America/Bahia"; // UTC-3, sem horário de verão

// Menu lateral: aplica o estado salvo (recolhido/aberto) antes da primeira pintura.
try { if (localStorage.getItem("if.side") === "min") document.documentElement.classList.add("side-min"); } catch {}
export const configured = Boolean(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);

export const supa = configured
  ? createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY)
  : null;

// ---------------------------------------------------------------------------
// Sessão
// ---------------------------------------------------------------------------
// Time em que a pessoa está trabalhando (cada conta nasce no próprio time;
// convites juntam pessoas a um time). `team` é um binding vivo do módulo.
export let team = null;
export let teams = [];

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
  const ok = await loadTeamContext();
  if (!ok) {
    location.replace(`${rootRel}entrar/?semtime=1`);
    return new Promise(() => {});
  }
  return data.session;
}

async function loadTeamContext() {
  const { data, error } = await supa.from("team_members")
    .select("team_id, role, joined_at, teams(id, name, max_accounts, max_posts_month)")
    .order("joined_at");
  if (error) { console.error("times:", error.message); return false; }
  teams = (data || []).map((m) => ({
    id: m.team_id,
    role: m.role,
    name: m.teams?.name || "Time",
    max_accounts: m.teams?.max_accounts ?? 20,
    max_posts_month: m.teams?.max_posts_month ?? 300,
  }));
  let saved = null;
  try { saved = localStorage.getItem("if.team"); } catch {}
  team = teams.find((t) => t.id === saved) || teams[0] || null;
  return Boolean(team);
}

export function switchTeam(id) {
  try { localStorage.setItem("if.team", id); } catch {}
  location.reload();
}

export async function signOut(rootRel = "../") {
  try { localStorage.removeItem("if.team"); } catch {}
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
      ...(team?.id ? { "X-Team": team.id } : {}),
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

// Ícones do menu (traço, 24×24, estilo Feather).
const ICONS = {
  inicio: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  calendario: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  criar: '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>',
  contas: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  fila: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
  biblioteca: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
  config: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  sair: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
  recolher: '<polyline points="11 17 6 12 11 7"/><polyline points="18 17 13 12 18 7"/>',
  menu: '<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>',
};
const ico = (k) => `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[k]}</svg>`;

// Menu lateral retrátil: no computador recolhe para só ícones (lembra a escolha);
// no celular vira gaveta aberta pelo botão ☰.
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
  const root = document.documentElement;
  nav.id = "menu";
  nav.innerHTML = `
    <div class="side-head">
      <a class="brand" href="${rootRel}" aria-label="InstaFlow, início">
        <img class="brand-logo" src="${rootRel}assets/brand/instaflow-logo.svg" alt="InstaFlow">
        <img class="brand-icon" src="${rootRel}assets/brand/instaflow-icon.svg" alt="">
      </a>
      <button class="side-toggle" type="button" aria-controls="menu">${ico("recolher")}</button>
    </div>
    <nav class="side-nav" aria-label="Seções">
      ${items.map(([k, label, href]) => `<a href="${rootRel}${href}" class="${k === active ? "on" : ""}" ${k === active ? 'aria-current="page"' : ""} title="${label}">${ico(k)}<span>${label}</span></a>`).join("")}
    </nav>
    <div class="side-foot">
      <div class="side-team" title="Time atual">
        ${teams.length > 1
          ? `<select id="team-switch" class="side-select" aria-label="Trocar de time">${teams.map((t) => `<option value="${t.id}" ${t.id === team?.id ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select>`
          : `<span class="side-team-name">${esc(team?.name || "")}</span>`}
      </div>
      <div class="side-user" title="${esc(email || "")}"><span class="av">${esc((email || "?")[0].toUpperCase())}</span><span class="side-email">${esc(email || "")}</span></div>
      <button class="side-link" id="btn-sair" type="button" title="Sair">${ico("sair")}<span>Sair</span></button>
    </div>`;
  nav.querySelector("#team-switch")?.addEventListener("change", (e) => switchTeam(e.target.value));

  const bar = document.createElement("div");
  bar.className = "mbar";
  bar.innerHTML = `<button class="mbar-btn" type="button" aria-controls="menu" aria-expanded="false" aria-label="Abrir menu">${ico("menu")}</button>
    <a href="${rootRel}" aria-label="InstaFlow, início"><img class="brand-logo" src="${rootRel}assets/brand/instaflow-logo.svg" alt="InstaFlow"></a>`;
  nav.after(bar);
  const scrim = document.createElement("div");
  scrim.className = "scrim";
  scrim.hidden = true;
  document.body.appendChild(scrim);

  const toggle = nav.querySelector(".side-toggle");
  const menuBtn = bar.querySelector(".mbar-btn");
  const mq = window.matchMedia("(max-width: 860px)");
  const syncToggle = () => {
    const min = root.classList.contains("side-min");
    const label = mq.matches ? "Fechar menu" : min ? "Expandir menu" : "Recolher menu";
    toggle.title = label;
    toggle.setAttribute("aria-label", label);
    toggle.setAttribute("aria-expanded", String(mq.matches ? root.classList.contains("side-open") : !min));
  };
  const setMin = (on) => {
    root.classList.toggle("side-min", on);
    try { localStorage.setItem("if.side", on ? "min" : "full"); } catch {}
    syncToggle();
  };
  const setOpen = (on) => {
    root.classList.toggle("side-open", on);
    scrim.hidden = !on;
    menuBtn.setAttribute("aria-expanded", String(on));
    syncToggle();
  };
  toggle.addEventListener("click", () => (mq.matches ? setOpen(false) : setMin(!root.classList.contains("side-min"))));
  menuBtn.addEventListener("click", () => setOpen(!root.classList.contains("side-open")));
  scrim.addEventListener("click", () => setOpen(false));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && root.classList.contains("side-open")) { setOpen(false); menuBtn.focus(); }
  });
  mq.addEventListener?.("change", () => setOpen(false));
  syncToggle();
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
