// InstaFlow · calendário: datas no relógio da Bahia, dados e peças visuais.
// Dias são chaves "AAAA-MM-DD"; a conta usa "instantes de parede" em UTC
// (Bahia = UTC−3 fixo, sem horário de verão), então não depende do fuso do aparelho.
import { supa, esc, PLACEMENT, platformIcon, postSummaryPill } from "./app.js";

const DAY = 86400000, OFF = 3 * 3600000;
export const pad = (n) => String(n).padStart(2, "0");
const wallKey = (w) => { const d = new Date(w); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
export const wallOf = (key) => { const [y, m, d] = key.split("-").map(Number); return Date.UTC(y, m - 1, d); };
export const keyOf = (ms) => wallKey(ms - OFF);
export const minOf = (ms) => { const d = new Date(ms - OFF); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
export const addDays = (key, n) => wallKey(wallOf(key) + n * DAY);
export const dow = (key) => new Date(wallOf(key)).getUTCDay();
export const isoAt = (key, min) => new Date(wallOf(key) + min * 60000 + OFF).toISOString();
export const todayKey = () => keyOf(Date.now());
export const nowMin = () => minOf(Date.now());
export const hhmm = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
export const WEEK_START = 1; // segunda

const F = (o) => new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", ...o });
const fMonth = F({ month: "long", year: "numeric" }), fLong = F({ weekday: "long", day: "numeric", month: "long" });
const fMon = F({ month: "short" }), fWd = F({ weekday: "short" }), fWdLong = F({ weekday: "long" });
const cap = (s) => s.replace(/^./, (c) => c.toUpperCase());
const mon = (key) => fMon.format(wallOf(key)).replace(".", "");
const dnum = (key) => Number(key.slice(8));
export const label = {
  month: (key) => cap(fMonth.format(wallOf(key))),
  dayLong: (key) => cap(fLong.format(wallOf(key))),
  wd: (key) => fWd.format(wallOf(key)).replace(".", ""),
  wdLong: (key) => cap(fWdLong.format(wallOf(key))),
  mon,
  span(a, b) {
    const y = b.slice(0, 4);
    if (a.slice(0, 7) === b.slice(0, 7)) return `${dnum(a)} – ${dnum(b)} de ${mon(b)} de ${y}`;
    if (a.slice(0, 4) === b.slice(0, 4)) return `${dnum(a)} de ${mon(a)} – ${dnum(b)} de ${mon(b)} de ${y}`;
    return `${dnum(a)} de ${mon(a)} de ${a.slice(0, 4)} – ${dnum(b)} de ${mon(b)} de ${y}`;
  },
};

// Visões: quantos dias cada uma mostra e como anda para frente/trás.
export const VIEWS = {
  month: { name: "Mês", key: "m" },
  week: { name: "Semana", key: "s", days: 7 },
  days3: { name: "3 dias", key: "3", days: 3 },
  day: { name: "Dia", key: "d", days: 1 },
  agenda: { name: "Agenda", key: "a", days: 30 },
};
export const weekStartOf = (key) => addDays(key, -((dow(key) - WEEK_START + 7) % 7));
export function rangeFor(view, anchor) {
  if (view === "month") return { start: weekStartOf(anchor.slice(0, 8) + "01"), days: 42 };
  if (view === "week") return { start: weekStartOf(anchor), days: 7 };
  return { start: anchor, days: VIEWS[view].days };
}
export function step(view, anchor, dir) {
  if (view === "month") { const [y, m] = anchor.split("-").map(Number); return wallKey(Date.UTC(y, m - 1 + dir, 1)); }
  return addDays(anchor, dir * VIEWS[view].days);
}
export function titleFor(view, anchor) {
  if (view === "month") return label.month(anchor);
  if (view === "day") return label.dayLong(anchor);
  const r = rangeFor(view, anchor);
  return label.span(r.start, addDays(r.start, r.days - 1));
}

// Situação da publicação → cor no calendário.
export const KIND_LABEL = { sched: "Agendada", run: "Publicando", ok: "Publicada", bad: "Com falha" };
export function kindOf(p) {
  if (p.targets_failed > 0 || p.status === "error") return "bad";
  if (p.status === "processed" && !p.targets_pending) return "ok";
  if (p.status === "processing" || p.status === "processed") return "run";
  return "sched";
}

export async function loadPosts(startKey, days) {
  const from = new Date(wallOf(startKey) + OFF).toISOString();
  const to = new Date(wallOf(startKey) + days * DAY + OFF).toISOString();
  const { data, error } = await supa.from("post_overview")
    .select("id, title, caption, placement, status, scheduled_at, targets_total, targets_published, targets_failed, targets_pending")
    .gte("scheduled_at", from).lt("scheduled_at", to).neq("status", "canceled").order("scheduled_at");
  if (error) throw error;
  const posts = (data || []).map((p) => {
    const ms = Date.parse(p.scheduled_at);
    return { ...p, ms, key: keyOf(ms), min: minOf(ms), kind: kindOf(p), nets: new Set(), movable: p.status === "scheduled" && ms > Date.now() + 60000 };
  });
  if (posts.length) {
    const byId = new Map(posts.map((p) => [p.id, p]));
    const { data: t } = await supa.from("post_targets").select("post_id, accounts(platform)").in("post_id", [...byId.keys()]);
    for (const r of t || []) if (r.accounts?.platform) byId.get(r.post_id)?.nets.add(r.accounts.platform);
  }
  return posts;
}

// Peças visuais
export const nameOf = (p) => p.title || (p.caption || "").slice(0, 60) || "(sem título)";
const contas = (n) => `${n} conta${n === 1 ? "" : "s"}`;
const tip = (p) => `${hhmm(p.min)} · ${nameOf(p)} · ${PLACEMENT[p.placement] || ""} · ${contas(p.targets_total)} · ${KIND_LABEL[p.kind]}${p.movable ? " · arraste para mudar o horário" : ""}`;
const nets = (p, size) => [...p.nets].sort().map((n) => platformIcon(n, size)).join("");
const attrs = (p) => `href="../fila/?post=${p.id}" data-id="${p.id}" draggable="false"${p.movable ? ' data-drag="1"' : ""} title="${esc(tip(p))}"`;

export const chip = (p) => `<a class="ec-chip k-${p.kind}" ${attrs(p)}><i class="ec-dot"></i><span class="ec-t">${hhmm(p.min)}</span><span class="ec-n">${esc(nameOf(p))}</span></a>`;
export const block = (p, style) => `<a class="ec-ev k-${p.kind}" style="${style}" ${attrs(p)}><span class="ec-row"><span class="ec-t">${hhmm(p.min)}</span>${nets(p, 14)}</span><span class="ec-n">${esc(nameOf(p))}</span></a>`;
export const agendaItem = (p) => `<a class="ec-aitem k-${p.kind}" ${attrs(p)}><span class="ec-t">${hhmm(p.min)}</span><span><div class="title">${esc(nameOf(p))}</div><div class="sub">${nets(p, 15)}<span>${PLACEMENT[p.placement] || ""} · ${contas(p.targets_total)}</span></div></span>${postSummaryPill(p)}</a>`;

// Balão flutuante (+N mais, criar num horário). rect = onde ancorar.
let popOff = null;
export function openPop(rect, html) {
  closePop();
  const el = document.getElementById("ec-pop");
  el.innerHTML = html;
  el.hidden = false;
  const w = el.offsetWidth, h = el.offsetHeight;
  el.style.left = `${Math.min(Math.max(12, rect.left), innerWidth - w - 12)}px`;
  el.style.top = `${rect.bottom + 6 + h > innerHeight - 12 ? Math.max(12, rect.top - h - 6) : rect.bottom + 6}px`;
  const onDoc = (e) => { if (!el.contains(e.target)) closePop(); };
  const onKey = (e) => { if (e.key === "Escape") closePop(); };
  const onScroll = (e) => { if (!el.contains(e.target)) closePop(); };
  setTimeout(() => { document.addEventListener("pointerdown", onDoc); document.addEventListener("keydown", onKey); addEventListener("scroll", onScroll, true); });
  popOff = () => { document.removeEventListener("pointerdown", onDoc); document.removeEventListener("keydown", onKey); removeEventListener("scroll", onScroll, true); el.hidden = true; };
  el.querySelector("a, button")?.focus({ preventScroll: true });
}
export function closePop() { popOff?.(); popOff = null; }
