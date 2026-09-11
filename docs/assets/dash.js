// InstaFlow · Início: desenha os números e gráficos com o resultado de
// public.dashboard(time, dias) — tudo já contado no banco, no horário da Bahia.
import { esc, fmt, avatar, accountHealth, handle } from "./app.js";
import { areaChart, barChart, donutChart, funnelChart, heatmap, nf } from "./charts.js";

const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const MES_LONGO = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const WD = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const parts = (iso) => String(iso).split("-").map(Number);
const dayLabel = (iso) => { const [, m, d] = parts(iso); return `${d} ${MES[m - 1]}`; };
const dayTitle = (iso) => { const [y, m, d] = parts(iso); return `${WD[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}, ${d} de ${MES[m - 1]}`; };
const monLabel = (ym, i, long) => { const [y, m] = parts(ym); return long ? `${MES_LONGO[m - 1]} de ${y}` : `${MES[m - 1]} ${String(y).slice(2)}`; };
const pctTxt = (a, b) => (b ? `${String(Math.round((a / b) * 1000) / 10).replace(".", ",")}%` : "—");

const ICONS = {
  ritmo: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
  funil: '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>',
  dist: '<path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/>',
  mes: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
  hora: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  contas: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  cal: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  ok: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
  alerta: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  uso: '<path d="M12 2a10 10 0 1 0 10 10"/><path d="M12 12 19 5"/><circle cx="12" cy="12" r="1.5"/>',
  baixar: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
};
export const icon = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[k] || ""}</svg>`;
export function paintIcons(root) { root.querySelectorAll("[data-ico]").forEach((el) => { el.innerHTML = icon(el.dataset.ico); }); }

const NET = { instagram: ["Instagram", "#E1306C"], facebook: ["Facebook", "#1877F2"], tiktok: ["TikTok", "#25F4EE"] };
const TYPE = { timeline: ["Feed", "--accent"], reels: ["Reels", "--time"], stories: ["Stories", "#8B5CF6"] };
const REDS = ["#7F1D1D", "#991B1B", "#B91C1C", "#DC2626", "#EF4444", "#F87171", "#FCA5A5", "#FECACA"];

function trend(cur, prev) {
  if (!prev && !cur) return `<span class="trend flat">sem publicações no período</span>`;
  if (!prev) return `<span class="trend up">▲ primeiras do período</span>`;
  const d = Math.round(((cur - prev) / prev) * 100);
  return d === 0 ? `<span class="trend flat">igual ao anterior</span>` : `<span class="trend ${d > 0 ? "up" : "down"}" title="Comparado com o período anterior de mesmo tamanho">${d > 0 ? "▲" : "▼"} ${Math.abs(d)}% vs anterior</span>`;
}

export function paintKpis(el, data) {
  const k = data.kpis || {}, accs = data.accounts || [];
  const nets = Object.entries(accs.reduce((m, a) => ((m[a.platform] = (m[a.platform] || 0) + 1), m), {})).map(([p, n]) => `${NET[p]?.[0] || p} ${n}`).join(" · ");
  const used = k.month_used || 0, limit = k.month_limit || 0, up = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  el.innerHTML = `
    <a class="kpi" href="calendario/"><h3>Agendadas ${icon("cal")}</h3><div class="big">${nf.format(k.today_posts || 0)} <small>hoje</small></div>
      <div class="ln">Envios hoje (conta a conta): <b>${nf.format(k.today_targets || 0)}</b></div>
      <div class="ln">Próximos 7 dias: <b>${nf.format(k.next7_posts || 0)}</b></div>
      ${k.next_at ? `<div class="ln">Próxima: <b>${esc(fmt.relative(k.next_at))}</b></div>` : ""}</a>
    <a class="kpi" href="fila/?tab=done"><h3>Publicadas ${icon("ok")}</h3><div class="big">${nf.format(k.published || 0)}</div>
      <div class="ln">Taxa de sucesso: <b>${pctTxt(k.published || 0, (k.published || 0) + (k.failed || 0))}</b></div>${trend(k.published || 0, k.prev_published || 0)}</a>
    <a class="kpi" href="fila/?tab=failed"><h3>Falhas ${icon("alerta")}</h3><div class="big">${nf.format(k.failed || 0)}</div>
      <div class="ln">Últimos 7 dias: <b>${nf.format(k.failed_7d || 0)}</b></div>
      <div class="ln">${k.failed ? "Veja e reenvie na Fila" : "Tudo saindo certinho"}</div></a>
    <a class="kpi" href="contas/"><h3>Contas ${icon("contas")}</h3><div class="big">${nf.format(k.accounts_connected || 0)} <small>de ${nf.format(k.accounts || 0)} conectadas</small></div>
      ${nets ? `<div class="ln">${esc(nets)}</div>` : `<div class="ln">Nenhuma conta ainda</div>`}</a>
    <a class="kpi" href="config/"><h3>Uso do mês ${icon("uso")}</h3><div class="big">${nf.format(used)} <small>${limit ? `de ${nf.format(limit)}` : ""}</small></div>
      <div class="bar ${up >= 90 ? "bad" : up >= 70 ? "warn" : ""}"><i style="width:${up}%"></i></div>
      <div class="ln">Posts conta a conta (publicados + agendados)</div></a>`;
}

export function paintRitmo(el, data) {
  // histórico só com dias completos (hoje ainda está acontecendo); de hoje em diante, o agendado
  const rows = data.daily || [], ti = rows.findIndex((r) => r.d === data.today);
  const past = (i) => ti < 0 || i < ti;
  areaChart(el, {
    labels: rows.map((r) => r.d),
    marker: ti >= 0 ? ti : null,
    series: [
      { name: "Publicadas", color: "--accent", type: "area", values: rows.map((r, i) => (past(i) ? r.published : null)) },
      { name: "Falhas", color: "--bad", dashed: true, dots: rows.length <= 40, values: rows.map((r, i) => (past(i) ? r.failed : null)) },
      { name: "Agendadas", color: "--time", dashed: true, values: rows.map((r, i) => (ti >= 0 && i >= ti ? r.scheduled : null)) },
    ],
    fmtLabel: dayLabel,
    fmtTitle: dayTitle,
  });
}

export function paintFunil(el, badge, monthEl, data) {
  const f = data.funnel || {}, [, m] = parts(data.today);
  monthEl.textContent = `· ${MES_LONGO[m - 1]}`;
  badge.hidden = !f.sent;
  badge.textContent = `Aproveitamento: ${pctTxt(f.published || 0, f.sent || 0)}`;
  badge.title = "Publicadas ÷ as que já saíram neste mês";
  if (!f.scheduled) { el.innerHTML = `<div class="ch-empty">Nada programado neste mês ainda. <a href="criar/">Criar publicação</a></div>`; return; }
  funnelChart(el, { stages: [
    { label: "Programadas", value: f.scheduled || 0 },
    { label: "Já saíram", value: f.sent || 0 },
    { label: "Publicadas", value: f.published || 0 },
    { label: "Com link do post", value: f.with_link || 0 },
  ] });
}

export function paintDist(el, sub, data, tab) {
  if (tab === "tipo") {
    sub.textContent = `Publicações dos últimos ${data.days} dias, por tipo`;
    donutChart(el, { items: (data.by_placement || []).map((x) => ({ label: TYPE[x.k]?.[0] || x.k, value: x.n, color: TYPE[x.k]?.[1] || "--muted" })), center: "publicações" });
  } else if (tab === "falhas") {
    sub.textContent = `Falhas dos últimos ${data.days} dias, pelo motivo`;
    donutChart(el, { items: (data.failures || []).map((x, i) => ({ label: x.k, value: x.n, color: REDS[i % REDS.length] })), center: "falhas", empty: "Nenhuma falha no período. 🎉" });
  } else {
    sub.textContent = `Publicadas nos últimos ${data.days} dias, conta a conta`;
    donutChart(el, { items: (data.by_platform || []).map((x) => ({ label: NET[x.k]?.[0] || x.k, value: x.n, color: NET[x.k]?.[1] || "--muted" })), center: "publicadas" });
  }
}

export function paintMes(el, data) {
  const rows = data.monthly || [];
  barChart(el, {
    labels: rows.map((r) => r.m),
    series: [{ name: "Publicadas", color: "--accent", values: rows.map((r) => r.published) }, { name: "Falhas", color: "--bad", values: rows.map((r) => r.failed) }],
    fmtLabel: monLabel,
  });
}

export function exportCsv(data) {
  const lines = [["Mês", "Publicadas", "Falhas"], ...(data.monthly || []).map((r) => [monLabel(r.m, 0, true), r.published, r.failed])];
  const csv = `﻿${lines.map((l) => l.join(";")).join("\r\n")}`;
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })), download: `instaflow-publicacoes-por-mes-${data.today}.csv` });
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export function paintTop(el, data, accounts) {
  const byId = new Map((accounts || []).map((a) => [a.id, a]));
  const list = (data.accounts || []).slice(0, 7);
  if (!list.length) { el.innerHTML = `<div class="ch-empty">Nenhuma conta conectada. <a href="contas/">Conectar</a></div>`; return; }
  const max = Math.max(1, ...list.map((a) => a.published));
  el.innerHTML = list.map((a) => {
    const full = { ...a, ...(byId.get(a.id) || {}) };
    const [label, kind] = accountHealth(full);
    const name = a.label ? `${esc(a.label)} <span class="muted">${esc(handle(a))}</span>` : esc(handle(a));
    const side = kind !== "ok" ? `<span class="pill ${kind}">${esc(label)}</span>` : a.platform === "instagram" ? `24 h: ${a.last24}/100` : "publicadas";
    return `<a class="top-row" href="contas/">${avatar(full, 34)}<span style="min-width:0"><div class="top-name">${name}</div><div class="top-bar"><i style="width:${Math.round((a.published / max) * 100)}%"></i></div></span><span class="top-num">${nf.format(a.published)}<small>${side}</small></span></a>`;
  }).join("");
}

export function paintAll(data, { accounts = [] } = {}) {
  const $ = (s) => document.querySelector(s);
  paintKpis($("#kpis"), data);
  $("#ritmo-sub").textContent = `Por dia, conta a conta · últimos ${data.days} dias e o que já está agendado para os próximos 7`;
  paintRitmo($("#ch-ritmo"), data);
  paintFunil($("#ch-funil"), $("#funil-badge"), $("#funil-mes"), data);
  paintDist($("#ch-dist"), $("#dist-sub"), data, document.querySelector("#dist-tabs .on")?.dataset.t || "rede");
  paintMes($("#ch-mes"), data);
  heatmap($("#ch-heat"), { cells: data.heat || [] });
  $("#top-sub").textContent = `Publicadas nos últimos ${data.days} dias`;
  paintTop($("#ch-top"), data, accounts);
}
