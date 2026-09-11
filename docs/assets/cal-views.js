// InstaFlow · calendário: as visões (mês, mês compacto do celular, grade de
// horários para semana/3 dias/dia, e agenda). Cada uma devolve HTML pronto.
import { esc } from "./app.js";
import { addDays, todayKey, nowMin, hhmm, label, rangeFor, chip, block, agendaItem } from "./cal-core.js";

const VIS = 45; // minutos que cada bloco ocupa na grade (a publicação é um instante)
const weekdays = (start) => Array.from({ length: 7 }, (_, i) => label.wd(addDays(start, i)));
const plural = (n) => `${n} publicaç${n === 1 ? "ão" : "ões"}`;
export function group(posts) {
  const m = new Map();
  for (const p of posts) { if (!m.has(p.key)) m.set(p.key, []); m.get(p.key).push(p); }
  return m;
}
export const hourPx = (el) => parseFloat(getComputedStyle(el).getPropertyValue("--ec-hour")) || 48;

export function monthView(posts, anchor, max = 3) {
  const { start, days } = rangeFor("month", anchor);
  const by = group(posts), today = todayKey(), ym = anchor.slice(0, 7);
  let html = weekdays(start).map((w) => `<div class="ec-wd">${w}</div>`).join("");
  for (let i = 0; i < days; i++) {
    const k = addDays(start, i), items = by.get(k) || [];
    const shown = items.length > max ? max - 1 : items.length;
    html += `<div class="ec-cell${k.slice(0, 7) !== ym ? " out" : ""}${k === today ? " today" : ""}" data-drop-day="${k}" data-day="${k}">
      <div class="ec-cell-h"><span class="ec-num">${Number(k.slice(8))}</span>${k >= today ? `<button type="button" class="ec-add" data-add="${k}" title="Criar neste dia" aria-label="Criar publicação em ${esc(label.dayLong(k))}">+</button>` : ""}</div>
      ${items.slice(0, shown).map(chip).join("")}
      ${items.length > shown ? `<button type="button" class="ec-more" data-more="${k}">+${items.length - shown} mais</button>` : ""}
    </div>`;
  }
  return `<div class="ec-month">${html}</div>`;
}

// Celular: mês com bolinhas por dia; o dia tocado mostra a lista embaixo.
export function miniView(posts, anchor, sel) {
  const { start, days } = rangeFor("month", anchor);
  const by = group(posts), today = todayKey(), ym = anchor.slice(0, 7);
  let cells = weekdays(start).map((w) => `<div class="ec-wd">${w}</div>`).join("");
  for (let i = 0; i < days; i++) {
    const k = addDays(start, i), items = by.get(k) || [];
    const cls = [k.slice(0, 7) !== ym && "out", k === today && "today", k === sel && "sel"].filter(Boolean).join(" ");
    cells += `<button type="button" class="${cls}" data-pick="${k}" aria-pressed="${k === sel}" aria-label="${esc(label.dayLong(k))}${items.length ? `, ${plural(items.length)}` : ""}">${Number(k.slice(8))}${items.length ? `<span class="ec-dots">${items.slice(0, 6).map((p) => `<i class="k-${p.kind}"></i>`).join("")}</span>` : ""}</button>`;
  }
  const items = by.get(sel) || [];
  return `<div class="ec-mini">${cells}</div>
    <div class="ec-dayl">
      <div class="ec-dayl-h"><h3>${esc(label.dayLong(sel))}</h3>${sel >= today ? `<button type="button" class="btn ghost small" data-add="${sel}">+ Criar</button>` : ""}</div>
      ${items.length ? `<div class="ec-alist">${items.map(agendaItem).join("")}</div>` : `<div class="empty small">Nada agendado neste dia.</div>`}
    </div>`;
}

// Blocos que se sobrepõem dividem a largura da coluna.
function lanes(items) {
  const out = [];
  let cluster = [], end = -1;
  const flush = () => {
    const cols = [];
    for (const p of cluster) {
      let c = cols.findIndex((last) => last <= p.min);
      if (c < 0) { c = cols.length; cols.push(0); }
      cols[c] = p.min + VIS;
      out.push({ p, c, n: 0 });
    }
    for (const o of out.slice(out.length - cluster.length)) o.n = cols.length;
    cluster = [];
  };
  for (const p of items) {
    if (cluster.length && p.min >= end) flush();
    cluster.push(p);
    end = Math.max(end, p.min + VIS);
  }
  if (cluster.length) flush();
  return out;
}

export function gridView(posts, start, days) {
  const by = group(posts), today = todayKey(), now = nowMin();
  const keys = Array.from({ length: days }, (_, i) => addDays(start, i));
  const head = keys.map((k) => `<button type="button" class="ec-dh${k === today ? " today" : ""}" data-goto="${k}" title="Ver só este dia"><span>${label.wd(k)}</span><b>${Number(k.slice(8))}</b></button>`).join("");
  const gutter = Array.from({ length: 23 }, (_, h) => `<span class="ec-hl" style="top:calc(var(--ec-hour) * ${h + 1})">${hhmm((h + 1) * 60)}</span>`).join("");
  const cols = keys.map((k) => {
    const evs = lanes(by.get(k) || []).map(({ p, c, n }) => block(p, `top:calc(var(--ec-hour) * ${p.min / 60});height:calc(var(--ec-hour) * ${VIS / 60} - 2px);left:calc(${(c / n) * 100}% + 2px);width:calc(${100 / n}% - 4px)`)).join("");
    const line = k === today ? `<div class="ec-now" style="top:calc(var(--ec-hour) * ${now / 60})"></div>` : "";
    return `<div class="ec-col${k === today ? " today" : ""}${k < today ? " past" : ""}" data-col="${k}">${evs}${line}</div>`;
  }).join("");
  return `<div class="ec-scroll" style="--cols:${days}"><div class="ec-ghead"><div></div>${head}</div><div class="ec-gbody"><div class="ec-gutter">${gutter}</div>${cols}</div></div>`;
}

// Rola a grade para um horário útil: agora (se hoje aparece) ou a primeira publicação.
export function scrollGrid(body, posts) {
  const sc = body.querySelector(".ec-scroll");
  if (!sc) return;
  let min = posts.length ? Math.min(...posts.map((p) => p.min)) : 8 * 60;
  if (body.querySelector(".ec-col.today")) min = Math.min(min, nowMin());
  sc.scrollTop = Math.max(0, ((min - 60) / 60) * hourPx(body));
}

export function agendaView(posts, start, days) {
  const by = group(posts), today = todayKey();
  const keys = [...by.keys()].sort();
  if (!keys.length) return `<div class="ec-empty">Nada agendado de ${esc(label.span(start, addDays(start, days - 1)))}.<br><a href="../criar/">Criar publicação</a></div>`;
  return `<div class="ec-agenda">${keys.map((k) => `
    <div class="ec-aday${k === today ? " today" : ""}">
      <div class="ec-adate"><b>${Number(k.slice(8))}</b><span>${esc(label.wdLong(k))}, ${esc(label.mon(k))}</span></div>
      <div class="ec-alist">${by.get(k).map(agendaItem).join("")}</div>
    </div>`).join("")}</div>`;
}
