// InstaFlow · código compartilhado do painel (ES module, sem build).
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

export const cfg = window.INSTAFLOW_CONFIG || {};
export const TZ = "America/Bahia"; // UTC-3, sem horário de verão

// Menu lateral: aplica o estado salvo (recolhido/aberto) antes da primeira pintura.
try { if (localStorage.getItem("if.side") === "min") document.documentElement.classList.add("side-min"); } catch {}

// Barra fina de progresso no topo enquanto os dados da página carregam.
const pagebar = document.createElement("div");
pagebar.className = "pagebar";
pagebar.setAttribute("aria-hidden", "true");
document.documentElement.appendChild(pagebar);
const pagebarTimer = setTimeout(() => pageReady(), 8000);
export function pageReady() {
  clearTimeout(pagebarTimer);
  pagebar.classList.add("done");
  setTimeout(() => pagebar.remove(), 400);
}
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
  paintNavFoot(data.session.user.email);
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
// no celular vira gaveta aberta pelo botão ☰. É pintado na hora em que a página
// abre (antes da sessão carregar); o rodapé (e-mail e time) entra em paintNavFoot.
let navRootRel = "../";
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
  navRootRel = rootRel;
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
    <div class="side-foot"></div>`;
  paintNavFoot(email);

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
}

// Rodapé do menu: time (com seletor se houver mais de um), e-mail e Sair.
// Antes da sessão carregar mostra placeholders discretos.
export function paintNavFoot(email) {
  const foot = document.querySelector("header.top .side-foot");
  if (!foot) return;
  const known = Boolean(email || team);
  foot.innerHTML = `
    <div class="side-team" title="Time atual">
      ${!known ? `<span class="sk sk-line" style="width:70%"></span>`
        : teams.length > 1
          ? `<select id="team-switch" class="side-select" aria-label="Trocar de time">${teams.map((t) => `<option value="${t.id}" ${t.id === team?.id ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select>`
          : `<span class="side-team-name">${esc(team?.name || "")}</span>`}
    </div>
    <div class="side-user" title="${esc(email || "")}">
      <span class="av">${known ? esc((email || "?")[0].toUpperCase()) : ""}</span>
      ${known ? `<span class="side-email">${esc(email || "")}</span>` : `<span class="sk sk-line" style="width:80%"></span>`}
    </div>
    <button class="side-link" id="btn-sair" type="button" title="Sair">${ico("sair")}<span>Sair</span></button>`;
  foot.querySelector("#team-switch")?.addEventListener("change", (e) => switchTeam(e.target.value));
  foot.querySelector("#btn-sair")?.addEventListener("click", () => signOut(navRootRel));
}

// Redes suportadas (ids iguais aos do Post for Me).
export const PLATFORMS = {
  instagram: { label: "Instagram", short: "Instagram", color: "#E1306C", icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.4" cy="6.6" r="1" fill="currentColor" stroke="none"/></svg>', hint: "conta Profissional (Empresa ou Criador)" },
  facebook: { label: "Facebook (Página)", short: "Facebook", color: "#1877F2", icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M13.5 22v-8h2.7l.4-3.2h-3.1V8.8c0-.9.3-1.6 1.6-1.6h1.7V4.4c-.3 0-1.3-.1-2.5-.1-2.5 0-4.1 1.5-4.1 4.2v2.3H7.4V14h2.8v8h3.3z"/></svg>', hint: "você precisa administrar a Página" },
  tiktok: { label: "TikTok", short: "TikTok", color: "#111111", icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12.53.02C13.84 0 15.14.01 16.44 0c.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/></svg>', hint: "perfil pessoal ou de criador" },
};
export function platformOf(acc) { return PLATFORMS[acc?.platform] ? acc.platform : "instagram"; }
export function platformIcon(p, size = 14) {
  const pf = PLATFORMS[p] || PLATFORMS.instagram;
  return `<i class="pf pf-${p}" style="--pf:${pf.color};width:${size}px;height:${size}px" title="${pf.label}" aria-label="${pf.label}">${pf.icon}</i>`;
}
export function platformName(p) { return (PLATFORMS[p] || PLATFORMS.instagram).label; }
// Nome de exibição: @usuario no Instagram/TikTok; nome da Página no Facebook.
export function handle(acc) {
  const name = acc?.username || acc?.id || "";
  return platformOf(acc) === "facebook" ? name : `@${name}`;
}

export function avatar(acc, size = 28) {
  const letter = (acc?.username || acc?.label || "?")[0].toUpperCase();
  const p = platformOf(acc);
  const badge = acc?.platform ? platformIcon(p, Math.max(12, Math.round(size * 0.45))) : "";
  const inner = acc?.profile_photo_url
    ? `<img class="av" width="${size}" height="${size}" src="${esc(acc.profile_photo_url)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'av',textContent:'${esc(letter)}',style:'width:${size}px;height:${size}px'}))">`
    : `<span class="av" style="width:${size}px;height:${size}px">${esc(letter)}</span>`;
  return `<span class="av-wrap" style="width:${size}px;height:${size}px">${inner}${badge}</span>`;
}

export function accountName(acc) {
  const h = esc(handle(acc));
  return acc?.label ? `${esc(acc.label)} <span class="muted">${h}</span>` : h;
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

// ---------------------------------------------------------------------------
// Diálogos do painel (no lugar dos alertas nativos do navegador)
// ---------------------------------------------------------------------------
function dialog({ title = "", text = "", okLabel = "OK", cancelLabel = "Cancelar", danger = false, input = null }) {
  return new Promise((resolve) => {
    const d = document.createElement("dialog");
    d.className = "modal ifd";
    d.innerHTML = `<form class="inner ifd-inner" novalidate>
      ${title ? `<h2>${esc(title)}</h2>` : ""}
      <p class="ifd-text">${esc(text)}</p>
      ${input ? `<input class="input" id="ifd-input" type="text" value="${esc(input.value ?? "")}" placeholder="${esc(input.placeholder ?? "")}" maxlength="${input.maxlength ?? 80}" autocomplete="off">` : ""}
      <div class="ifd-actions"><button type="button" class="btn ghost" data-act="cancel">${esc(cancelLabel)}</button><button type="submit" class="btn ${danger ? "danger-solid" : ""}" data-act="ok">${esc(okLabel)}</button></div>
    </form>`;
    document.body.appendChild(d);
    const done = (v) => { try { d.close(); } catch {} d.remove(); resolve(v); };
    d.querySelector('[data-act="cancel"]').addEventListener("click", () => done(input ? null : false));
    d.querySelector("form").addEventListener("submit", (e) => { e.preventDefault(); done(input ? d.querySelector("#ifd-input").value : true); });
    d.addEventListener("cancel", (e) => { e.preventDefault(); done(input ? null : false); });
    d.addEventListener("click", (e) => { if (e.target === d) done(input ? null : false); });
    d.showModal();
    const focus = d.querySelector("#ifd-input") || d.querySelector('[data-act="ok"]');
    focus.focus(); if (focus.select) focus.select();
  });
}
// confirmDialog("Remover?", { okLabel: "Remover", danger: true }) → true/false
export function confirmDialog(text, opts = {}) { return dialog({ text, ...opts }); }
// promptDialog("Apelido:", "valor atual", { placeholder }) → string ou null
export function promptDialog(text, value = "", opts = {}) { return dialog({ text, input: { value, placeholder: opts.placeholder, maxlength: opts.maxlength }, okLabel: opts.okLabel || "Salvar", cancelLabel: opts.cancelLabel || "Cancelar", title: opts.title || "" }); }

// Esqueleto de carregamento (linhas cinza pulsando) para listas e cards.
export function skeleton(rows = 3, { avatar = true } = {}) {
  return `<div class="sk-list" aria-busy="true" aria-label="Carregando">${Array.from({ length: rows }, () => `
    <div class="sk-row">${avatar ? '<span class="sk sk-av"></span>' : ""}<span class="sk-lines"><span class="sk sk-line" style="width:${45 + Math.round(Math.random() * 30)}%"></span><span class="sk sk-line thin" style="width:${25 + Math.round(Math.random() * 30)}%"></span></span><span class="sk sk-pill"></span></div>`).join("")}</div>`;
}
export function skeletonGrid(n = 8) {
  return Array.from({ length: n }, () => '<div class="thumb sk-thumb"><span class="sk" style="position:absolute;inset:0;border-radius:inherit"></span></div>').join("");
}
