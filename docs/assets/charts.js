// InstaFlow · gráficos em SVG puro (sem biblioteca), com as cores do tema.
// Cada função desenha dentro de um elemento e se redesenha quando ele muda
// de largura. Cores: nomes de variáveis CSS (ex.: "--accent").
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const nf = new Intl.NumberFormat("pt-BR");
const col = (c) => (c.startsWith("--") ? `var(${c})` : c);
let uid = 0;

// redesenha quando o contêiner muda de largura (celular girando, menu recolhendo)
const ro = typeof ResizeObserver === "function" ? new ResizeObserver((entries) => {
  for (const e of entries) { const el = e.target; if (el._chart && Math.abs(el.clientWidth - el._w) > 4) el._chart(); }
}) : null;
function mount(el, draw) {
  el._chart = () => { el._w = el.clientWidth; draw(); };
  el._chart();
  ro?.observe(el);
}

// Escala "redonda" para contagens (passos 1, 2, 5, 10, 20, 25, 50…; nunca fração)
function scale(v) {
  const top = Math.max(1, v), raw = top / 4, mag = 10 ** Math.floor(Math.log10(raw)), f = raw / mag;
  let step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag;
  step = Math.max(1, Number.isInteger(step) ? step : Math.ceil(step));
  const n = Math.max(2, Math.ceil(top / step));
  return { max: step * n, step, n };
}

// Curva suave que não "passa" dos pontos (monótona, Fritsch–Carlson)
function smooth(pts) {
  const n = pts.length;
  if (n === 1) return `M${pts[0][0]},${pts[0][1]}`;
  const dx = [], m = [], t = [];
  for (let i = 0; i < n - 1; i++) { dx[i] = pts[i + 1][0] - pts[i][0]; m[i] = (pts[i + 1][1] - pts[i][1]) / dx[i]; }
  t[0] = m[0]; t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i] / m[i], b = t[i + 1] / m[i], s = a * a + b * b;
    if (s > 9) { const k = 3 / Math.sqrt(s); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
  }
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += ` C${pts[i][0] + h},${pts[i][1] + t[i] * h} ${pts[i + 1][0] - h},${pts[i + 1][1] - t[i + 1] * h} ${pts[i + 1][0]},${pts[i + 1][1]}`;
  }
  return d;
}

function tipBox(el) {
  let tip = el.querySelector(":scope > .ch-tip");
  if (!tip) { tip = document.createElement("div"); tip.className = "ch-tip"; tip.hidden = true; el.appendChild(tip); }
  return tip;
}
function placeTip(el, tip, x, y) {
  const w = tip.offsetWidth, max = el.clientWidth - w - 4;
  tip.style.left = `${Math.max(4, Math.min(max, x - w / 2))}px`;
  tip.style.top = `${Math.max(0, y - tip.offsetHeight - 12)}px`;
}

// Área + linhas. series: [{ name, values (null = sem ponto), color, type: "area"|"line", dashed }]
export function areaChart(el, { labels, series, marker = null, height = 280, fmtLabel = (l) => l, fmtTitle = (l) => l }) {
  mount(el, () => {
    const W = Math.max(280, el.clientWidth), H = height, L = 40, R = 14, T = 16, B = 30;
    const iw = W - L - R, ih = H - T - B, n = labels.length;
    const { max, step, n: ticks } = scale(Math.max(...series.flatMap((s) => s.values.filter((v) => v != null)), 0));
    const X = (i) => L + (n <= 1 ? iw / 2 : (i * iw) / (n - 1)), Y = (v) => T + ih - (v / max) * ih;
    const id = `g${++uid}`;
    let svg = `<defs>${series.map((s, k) => `<linearGradient id="${id}-${k}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:${col(s.color)};stop-opacity:.34"/><stop offset="1" style="stop-color:${col(s.color)};stop-opacity:0"/></linearGradient>`).join("")}</defs>`;
    for (let k = 0; k <= ticks; k++) {
      const v = step * k, y = Y(v);
      svg += `<line class="ch-grid" x1="${L}" x2="${W - R}" y1="${y}" y2="${y}"/><text class="ch-ax" x="${L - 8}" y="${y + 4}" text-anchor="end">${nf.format(v)}</text>`;
    }
    const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 70))));
    labels.forEach((l, i) => { if (i % every === 0 || i === n - 1) svg += `<text class="ch-ax ch-x" x="${X(i)}" y="${H - 8}" text-anchor="${i === 0 ? "start" : i === n - 1 ? "end" : "middle"}">${esc(fmtLabel(l, i))}</text>`; });
    if (marker != null) svg += `<line class="ch-mark" x1="${X(marker)}" x2="${X(marker)}" y1="${T}" y2="${T + ih}"/><text class="ch-ax ch-mark-t" x="${X(marker) + 5}" y="${T + 10}">hoje</text>`;
    series.forEach((s, k) => {
      // trechos contínuos (valores nulos quebram a linha)
      const runs = [];
      let cur = [];
      s.values.forEach((v, i) => { if (v == null) { if (cur.length) runs.push(cur); cur = []; } else cur.push([X(i), Y(v)]); });
      if (cur.length) runs.push(cur);
      for (const r of runs) {
        const d = smooth(r);
        if (s.type === "area" && r.length > 1) svg += `<path d="${d} L${r[r.length - 1][0]},${T + ih} L${r[0][0]},${T + ih} Z" style="fill:url(#${id}-${k})"/>`;
        svg += `<path class="ch-line${s.dashed ? " dashed" : ""}" d="${d}" style="stroke:${col(s.color)}"/>`;
        if (s.dots) svg += r.map(([x, y]) => `<circle class="ch-dot" cx="${x}" cy="${y}" r="3" style="fill:${col(s.color)}"/>`).join("");
      }
    });
    svg += `<line class="ch-guide" x1="0" x2="0" y1="${T}" y2="${T + ih}" visibility="hidden"/><g class="ch-hl"></g><rect class="ch-hit" x="${L}" y="${T}" width="${iw}" height="${ih}"/>`;
    el.innerHTML = `<svg class="ch" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img">${svg}</svg>`;
    const s = el.querySelector("svg"), guide = s.querySelector(".ch-guide"), hl = s.querySelector(".ch-hl"), tip = tipBox(el);
    const hide = () => { guide.setAttribute("visibility", "hidden"); hl.innerHTML = ""; tip.hidden = true; };
    s.querySelector(".ch-hit").addEventListener("pointermove", (e) => {
      const r = s.getBoundingClientRect(), x = ((e.clientX - r.left) / r.width) * W;
      const i = Math.max(0, Math.min(n - 1, Math.round(((x - L) / iw) * (n - 1))));
      guide.setAttribute("x1", X(i)); guide.setAttribute("x2", X(i)); guide.setAttribute("visibility", "visible");
      hl.innerHTML = series.map((ser) => (ser.values[i] == null ? "" : `<circle cx="${X(i)}" cy="${Y(ser.values[i])}" r="5" class="ch-dot-hl" style="fill:${col(ser.color)}"/>`)).join("");
      tip.innerHTML = `<b>${esc(fmtTitle(labels[i], i))}</b>${series.filter((ser) => ser.values[i] != null).map((ser) => `<span><i style="background:${col(ser.color)}"></i>${esc(ser.name)}<em>${nf.format(ser.values[i])}</em></span>`).join("")}`;
      tip.hidden = false;
      placeTip(el, tip, (X(i) / W) * r.width, (T / H) * r.height + 8);
    });
    s.querySelector(".ch-hit").addEventListener("pointerleave", hide);
  });
}

// Barras agrupadas. series: [{ name, values, color }]
export function barChart(el, { labels, series, height = 260, fmtLabel = (l) => l }) {
  mount(el, () => {
    const W = Math.max(260, el.clientWidth), H = height, L = 40, R = 10, T = 14, B = 28;
    const iw = W - L - R, ih = H - T - B, n = labels.length, k = series.length;
    const { max, step, n: ticks } = scale(Math.max(...series.flatMap((s) => s.values), 0));
    const gw = iw / n, bw = Math.min(28, (gw * 0.64) / k), Y = (v) => T + ih - (v / max) * ih;
    let svg = "";
    for (let j = 0; j <= ticks; j++) { const v = step * j; svg += `<line class="ch-grid" x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/><text class="ch-ax" x="${L - 8}" y="${Y(v) + 4}" text-anchor="end">${nf.format(v)}</text>`; }
    labels.forEach((l, i) => {
      const gx = L + gw * i + (gw - bw * k - 4 * (k - 1)) / 2;
      svg += `<g class="ch-grp" data-i="${i}"><rect class="ch-band" x="${L + gw * i}" y="${T}" width="${gw}" height="${ih}"/>`;
      series.forEach((s, j) => { const v = s.values[i] || 0, h = Math.max(v ? 3 : 0, (v / max) * ih); svg += `<rect class="ch-bar" x="${gx + j * (bw + 4)}" y="${T + ih - h}" width="${bw}" height="${h}" rx="4" style="fill:${col(s.color)}"/>`; });
      svg += `<text class="ch-ax ch-x" x="${L + gw * i + gw / 2}" y="${H - 8}" text-anchor="middle">${esc(fmtLabel(l, i))}</text></g>`;
    });
    el.innerHTML = `<svg class="ch" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img">${svg}</svg>`;
    const s = el.querySelector("svg"), tip = tipBox(el);
    s.querySelectorAll(".ch-grp").forEach((g) => {
      g.addEventListener("pointerenter", () => {
        const i = Number(g.dataset.i), r = s.getBoundingClientRect();
        tip.innerHTML = `<b>${esc(fmtLabel(labels[i], i, true))}</b>${series.map((ser) => `<span><i style="background:${col(ser.color)}"></i>${esc(ser.name)}<em>${nf.format(ser.values[i] || 0)}</em></span>`).join("")}`;
        tip.hidden = false;
        placeTip(el, tip, ((L + gw * i + gw / 2) / W) * r.width, (Y(Math.max(...series.map((ser) => ser.values[i] || 0))) / H) * r.height);
      });
      g.addEventListener("pointerleave", () => { tip.hidden = true; });
    });
  });
}

// Rosca com legenda. items: [{ label, value, color }]
export function donutChart(el, { items, center = "total", empty = "Sem dados no período." }) {
  const total = items.reduce((a, b) => a + b.value, 0);
  if (!total) { el.innerHTML = `<div class="ch-empty">${esc(empty)}</div>`; return; }
  const R = 70, C = 2 * Math.PI * R;
  let off = 0;
  const segs = items.map((it, i) => {
    const len = (it.value / total) * C, gap = items.length > 1 ? Math.min(3, len / 3) : 0;
    const seg = `<circle class="ch-seg" data-i="${i}" cx="100" cy="100" r="${R}" style="stroke:${col(it.color)}" stroke-dasharray="${Math.max(0.01, len - gap)} ${C}" stroke-dashoffset="${-off}"/>`;
    off += len;
    return seg;
  }).join("");
  el.innerHTML = `<div class="ch-donut">
    <div class="ch-donut-g"><svg viewBox="0 0 200 200" role="img"><g transform="rotate(-90 100 100)"><circle class="ch-ring" cx="100" cy="100" r="${R}"/>${segs}</g></svg>
      <div class="ch-donut-c"><b>${nf.format(total)}</b><span>${esc(center)}</span></div></div>
    <ul class="ch-legend">${items.map((it, i) => `<li data-i="${i}"><i style="background:${col(it.color)}"></i><span class="lbl" title="${esc(it.label)}">${esc(it.label)}</span><b>${nf.format(it.value)}</b><em>${Math.round((it.value / total) * 100)}%</em></li>`).join("")}</ul>
  </div>`;
  const c = el.querySelector(".ch-donut-c");
  const show = (i) => {
    el.querySelectorAll("[data-i]").forEach((x) => x.classList.toggle("dim", i != null && Number(x.dataset.i) !== i));
    c.innerHTML = i == null ? `<b>${nf.format(total)}</b><span>${esc(center)}</span>` : `<b>${Math.round((items[i].value / total) * 100)}%</b><span>${esc(items[i].label)}</span>`;
  };
  el.querySelectorAll("[data-i]").forEach((x) => { x.addEventListener("pointerenter", () => show(Number(x.dataset.i))); x.addEventListener("pointerleave", () => show(null)); });
}

// Funil (etapas com a forma afinando e o % de cada uma em relação à primeira)
export function funnelChart(el, { stages, height = 250 }) {
  mount(el, () => {
    const W = Math.max(300, el.clientWidth), H = height, n = stages.length, cw = W / n, mid = H / 2, top = stages[0]?.value || 0;
    const hh = stages.map((s) => (top ? Math.max(5, ((H * 0.62) / 2) * (s.value / top)) : 5));
    const edge = (sign, grow) => {
      let d = `M0,${mid + sign * (hh[0] * grow)}`;
      for (let i = 0; i < n; i++) {
        const y = mid + sign * hh[i] * grow, x1 = (i + 1) * cw;
        if (i === n - 1) { d += ` L${W},${y}`; break; }
        const ny = mid + sign * hh[i + 1] * grow, t = cw * 0.34;
        d += ` L${x1 - t},${y} C${x1},${y} ${x1},${ny} ${x1 + t},${ny}`;
      }
      return d;
    };
    // borda de cima (esquerda→direita) + borda de baixo (direita→esquerda)
    const shape = (grow) => `${edge(-1, grow)} L${W},${mid + hh[n - 1] * grow} ${reverseEdge(1, grow)} Z`;
    const reverseEdge = (sign, grow) => {
      let d = "";
      for (let i = n - 1; i >= 0; i--) {
        const y = mid + sign * hh[i] * grow, x0 = i * cw;
        if (i === 0) { d += ` L0,${y}`; break; }
        const py = mid + sign * hh[i - 1] * grow, t = cw * 0.34;
        d += ` L${x0 + t},${y} C${x0},${y} ${x0},${py} ${x0 - t},${py}`;
      }
      return d;
    };
    const id = `f${++uid}`;
    const seps = Array.from({ length: n - 1 }, (_, i) => `<line class="ch-sep" x1="${(i + 1) * cw}" x2="${(i + 1) * cw}" y1="0" y2="${H}"/>`).join("");
    el.innerHTML = `<div class="ch-funnel" style="--n:${n}"><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" preserveAspectRatio="none" role="img">
      <defs><linearGradient id="${id}" x1="0" x2="1"><stop offset="0" style="stop-color:var(--fun-a)"/><stop offset="1" style="stop-color:var(--fun-b)"/></linearGradient></defs>
      ${seps}<path class="ch-fun-halo" d="${shape(1.16)}"/><path d="${shape(1)}" style="fill:url(#${id})"/></svg>
      ${stages.map((s, i) => `<div class="ch-fun-col"><b>${nf.format(s.value)}</b><span class="ch-pill">${top ? Math.round((s.value / top) * 100) : 0}%</span><em>${esc(s.label)}</em></div>`).join("")}</div>`;
  });
}

// Mapa de calor semana × hora. cells: [{ dow: 1-7 (seg=1), h: 0-23, n }]
// (em telas estreitas junta de 2 em 2 horas para caber sem rolar)
export function heatmap(el, { cells, unit = "publicação", units = "publicações" }) {
  mount(el, () => {
    const days = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"], grid = new Map(cells.map((c) => [`${c.dow}-${c.h}`, c.n]));
    const step = el.clientWidth && el.clientWidth < 470 ? 2 : 1, cols = 24 / step;
    const val = (dow, h) => { let v = 0; for (let k = 0; k < step; k++) v += grid.get(`${dow}-${h + k}`) || 0; return v; };
    let max = 1;
    for (let d = 1; d <= 7; d++) for (let c = 0; c < cols; c++) max = Math.max(max, val(d, c * step));
    let html = `<div class="ch-heat" style="grid-template-columns:34px repeat(${cols}, minmax(0, 1fr));min-width:${step === 2 ? 0 : 540}px"><span></span>`;
    for (let c = 0; c < cols; c++) { const h = c * step; html += `<span class="ch-hh">${h % (step === 2 ? 6 : 3) === 0 ? `${h}h` : ""}</span>`; }
    days.forEach((d, i) => {
      html += `<span class="ch-hd">${d}</span>`;
      for (let c = 0; c < cols; c++) {
        const h = c * step, v = val(i + 1, h);
        html += `<i style="--a:${v ? Math.round(18 + (v / max) * 82) : 0}%" title="${d} ${h}h${step > 1 ? `–${h + step}h` : ""}: ${v} ${v === 1 ? unit : units}"></i>`;
      }
    });
    el.innerHTML = `${html}</div>`;
  });
}
