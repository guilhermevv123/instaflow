// InstaFlow · Desempenho: seguidores, visualizações e engajamento das contas.
// Lê o que a função `api` grava a cada 3 horas (accounts, account_stats_daily,
// post_metrics, post_metrics_daily) e calcula tudo aqui, no horário da Bahia.
// "No período" = posts publicados nos últimos N dias (os números de cada post
// são os de hoje); seguidores ganhos = diferença entre o 1º e o último retrato.
import { esc, avatar, handle, platformName, fmt } from "./app.js";
import { areaChart, barChart, nf } from "./charts.js";

const DIA = 86_400_000;
export const hojeBahia = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
const diaBahiaDe = (iso) => { const t = Date.parse(String(iso ?? "").replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00")); return Number.isFinite(t) ? new Date(t - 3 * 3600_000).toISOString().slice(0, 10) : null; };
const somaDias = (dia, n) => new Date(Date.parse(`${dia}T12:00:00Z`) + n * DIA).toISOString().slice(0, 10);
const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const WD = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const rotuloDia = (d) => { const [, m, dd] = d.split("-").map(Number); return `${dd} ${MES[m - 1]}`; };
const tituloDia = (d) => { const [y, m, dd] = d.split("-").map(Number); return `${WD[new Date(Date.UTC(y, m - 1, dd)).getUTCDay()]}, ${dd} de ${MES[m - 1]}`; };
export const compacto = (n) => (n == null ? "—" : Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(1).replace(".", ",")} mi` : Math.abs(n) >= 1e4 ? `${(n / 1e3).toFixed(1).replace(".", ",")} mil` : nf.format(n));
const sinal = (n) => (n > 0 ? `+${nf.format(n)}` : n < 0 ? `−${nf.format(-n)}` : "0");
const pct = (x) => `${String(Math.round(x * 1000) / 10).replace(".", ",")}%`;
const soma = (xs) => xs.reduce((s, v) => s + (v ?? 0), 0);
const somaOuNada = (xs) => (xs.some((v) => v != null) ? soma(xs) : null);
const interacoes = (p) => (p.likes ?? 0) + (p.comments ?? 0) + (p.shares ?? 0) + (p.saved ?? 0);
const TIPO = { REELS: "Reels", FEED: "Feed", STORY: "Story", AD: "Anúncio" };
const tipoDe = (p) => TIPO[p.product_type] || (p.media_type === "VIDEO" ? "Vídeo" : p.media_type === "CAROUSEL_ALBUM" ? "Carrossel" : p.media_type === "IMAGE" ? "Foto" : "Post");

const ICO = {
  seg: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/>',
  olho: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  coracao: '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>',
  grade: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
  chave: '<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>',
};
const ic = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICO[k]}</svg>`;

// `conta`: só os números dessa conta (página de desempenho da conta)
// `ate`: último dia do período (AAAA-MM-DD, ex.: ontem); sem ele, o período termina hoje
export async function carregar(supa, teamId, dias, conta = "", ate = "") {
  const hoje = ate && ate < hojeBahia() ? ate : hojeBahia();
  const inicio = somaDias(hoje, -(dias - 1));
  const antes = somaDias(inicio, -1);
  const daConta = (q, coluna = "account_id") => (conta ? q.eq(coluna, conta) : q);
  const [c, s, p, d] = await Promise.all([
    daConta(supa.from("accounts").select("id, username, label, platform, profile_photo_url, status, access_token_expires_at, followers, follows, media_count, insights_ok, stats_synced_at").eq("team_id", teamId).eq("archived", false), "id"),
    daConta(supa.from("account_stats_daily").select("account_id, day, followers").eq("team_id", teamId).gte("day", antes).lte("day", hoje).order("day")),
    daConta(supa.from("post_metrics").select("platform_post_id, account_id, post_id, platform, product_type, media_type, permalink, caption, thumbnail_url, posted_at, views, reach, likes, comments, shares, saved, follows, total_interactions, avg_watch_ms, nivel, updated_at").eq("team_id", teamId).order("posted_at", { ascending: false }).limit(2000)),
    daConta(supa.from("post_metrics_daily").select("platform_post_id, day, views, likes, comments, shares, saved").eq("team_id", teamId).gte("day", antes).lte("day", hoje).order("day")),
  ]);
  for (const r of [c, s, p, d]) if (r.error) throw new Error(r.error.message);
  return montar({ hoje, inicio, dias, contas: c.data || [], snaps: s.data || [], posts: p.data || [], diario: d.data || [] });
}

export function montar({ hoje, inicio, dias, contas, snaps, posts, diario }) {
  const lista = Array.from({ length: dias }, (_, i) => somaDias(inicio, i));
  // --- seguidores: último retrato conhecido de cada conta, dia a dia
  const porConta = new Map();
  for (const r of snaps) { if (r.followers == null) continue; if (!porConta.has(r.account_id)) porConta.set(r.account_id, []); porConta.get(r.account_id).push(r); }
  const total = lista.map(() => null);
  const ganhos = new Map();
  let desde = null;
  for (const [id, rs] of porConta) {
    rs.sort((a, b) => a.day.localeCompare(b.day));
    if (!desde || rs[0].day < desde) desde = rs[0].day;
    let k = 0, ultimo = rs[0].followers; // antes do 1º retrato, repete o 1º (conta nova não vira "salto")
    lista.forEach((dia, i) => {
      while (k < rs.length && rs[k].day <= dia) { ultimo = rs[k].followers; k++; }
      if (dia >= rs[0].day || desde <= dia) total[i] = (total[i] ?? 0) + ultimo;
    });
    ganhos.set(id, rs.length >= 2 ? rs[rs.length - 1].followers - rs[0].followers : null);
  }
  for (let i = 0; i < lista.length; i++) if (desde && lista[i] < desde) total[i] = null;
  const ganhosDia = total.map((v, i) => (i && v != null && total[i - 1] != null ? v - total[i - 1] : null));

  // --- posts do período
  const noPeriodo = posts.filter((p) => { const dia = diaBahiaDe(p.posted_at) ?? ""; return dia >= inicio && dia <= hoje; });
  const agg = (ps) => ({
    posts: ps.length, views: somaOuNada(ps.map((p) => p.views)), reach: somaOuNada(ps.map((p) => p.reach)),
    likes: soma(ps.map((p) => p.likes)), comments: soma(ps.map((p) => p.comments)),
    shares: somaOuNada(ps.map((p) => p.shares)), saved: somaOuNada(ps.map((p) => p.saved)), eng: soma(ps.map(interacoes)),
  });
  const linhas = contas.map((a) => ({ a, seguidores: a.followers, ganhos: ganhos.has(a.id) ? ganhos.get(a.id) : null, ...agg(noPeriodo.filter((p) => p.account_id === a.id)) }));
  const tot = agg(noPeriodo);
  tot.seguidores = somaOuNada(contas.map((a) => a.followers));
  tot.ganhos = somaOuNada([...ganhos.values()]);
  tot.taxa = tot.reach ? tot.eng / tot.reach : null;
  tot.completas = contas.filter((a) => a.insights_ok === true).length;
  tot.basicas = contas.filter((a) => a.insights_ok === false && a.status === "connected").length;
  const medidas = contas.filter((a) => a.stats_synced_at).length;
  const atualizado = contas.map((a) => a.stats_synced_at).filter(Boolean).sort().pop() || null;

  // --- interações e visualizações novas por dia (diferença entre retratos de cada post)
  const porPost = new Map();
  for (const r of diario) { if (!porPost.has(r.platform_post_id)) porPost.set(r.platform_post_id, []); porPost.get(r.platform_post_id).push(r); }
  const postPorId = new Map(posts.map((p) => [p.platform_post_id, p]));
  const novasInter = lista.map(() => null), novasViews = lista.map(() => null);
  let temViews = false;
  for (const [pid, rs] of porPost) {
    rs.sort((a, b) => a.day.localeCompare(b.day));
    const diaPost = postPorId.get(pid)?.posted_at ? diaBahiaDe(postPorId.get(pid).posted_at) : null;
    let prev = null;
    for (const r of rs) {
      const i = lista.indexOf(r.day);
      const e = interacoes(r);
      const soma1 = (arr, v) => { if (i >= 0) arr[i] = (arr[i] ?? 0) + Math.max(0, v); };
      if (prev) { soma1(novasInter, e - prev.e); if (r.views != null && prev.v != null) { soma1(novasViews, r.views - prev.v); temViews = true; } }
      else if (diaPost === r.day) { soma1(novasInter, e); if (r.views != null) { soma1(novasViews, r.views); temViews = true; } }
      prev = { e, v: r.views };
    }
  }
  const temViewsPost = noPeriodo.some((p) => p.views != null);
  const ordenados = [...noPeriodo].sort((x, y) => (temViewsPost ? (y.views ?? -1) - (x.views ?? -1) : 0) || interacoes(y) - interacoes(x));
  return { hoje, inicio, dias, lista, contas, linhas, tot, total, ganhosDia, desde, medidas, atualizado, posts, noPeriodo, top: ordenados.slice(0, 8), temViewsPost, novasInter, novasViews, temViews };
}

// ---------------------------------------------------------------- desenho
export function paintKpis(el, d, { link = null } = {}) {
  const t = d.tot;
  const card = (inner) => (link ? `<a class="kpi" href="${link}">${inner}</a>` : `<div class="kpi">${inner}</div>`);
  const ganhos = t.ganhos == null
    ? `<div class="ln">Ganhos: <b>${d.desde ? `histórico desde ${esc(rotuloDia(d.desde))}` : "aparecem após a 1ª atualização"}</b></div>`
    : `<div class="ln">No período: <b class="${t.ganhos > 0 ? "up" : t.ganhos < 0 ? "down" : ""}">${sinal(t.ganhos)}</b></div>`;
  el.innerHTML = [
    card(`<h3>Seguidores ${ic("seg")}</h3><div class="big">${compacto(t.seguidores)}</div>${ganhos}<div class="ln">${d.contas.length === 1 ? "Só esta conta" : `${nf.format(d.contas.length)} contas somadas`}</div>`),
    card(`<h3>Visualizações ${ic("olho")}</h3><div class="big">${compacto(t.views)}</div>
      <div class="ln">${t.views == null ? "Liberadas depois de reconectar as contas" : `Dos ${nf.format(t.posts)} posts do período`}</div>
      ${t.reach != null ? `<div class="ln">Alcance: <b>${compacto(t.reach)}</b></div>` : ""}`),
    card(`<h3>Engajamento ${ic("coracao")}</h3><div class="big">${compacto(t.eng)} <small>interações</small></div>
      <div class="ln">Curtidas <b>${nf.format(t.likes)}</b> · Comentários <b>${nf.format(t.comments)}</b></div>
      <div class="ln">${t.shares != null || t.saved != null ? `Compart. <b>${nf.format(t.shares ?? 0)}</b> · Salvos <b>${nf.format(t.saved ?? 0)}</b>` : "Compartilhamentos e salvos: depois de reconectar"}</div>`),
    card(`<h3>Posts ${ic("grade")}</h3><div class="big">${nf.format(t.posts)} <small>no período</small></div>
      <div class="ln">Média: <b>${t.posts ? nf.format(Math.round((t.eng / t.posts) * 10) / 10) : "—"}</b> interações por post</div>
      ${t.taxa != null ? `<div class="ln">Taxa sobre o alcance: <b>${pct(t.taxa)}</b></div>` : ""}`),
    link ? "" : card(`<h3>Métricas ${ic("chave")}</h3><div class="big">${nf.format(t.completas)} <small>de ${nf.format(d.medidas || d.contas.length)} contas completas</small></div>
      <div class="ln">${t.basicas ? `${nf.format(t.basicas)} só com curtidas e comentários` : "Nenhuma conta pendente"}</div>
      <div class="ln">Atualizado ${d.atualizado ? esc(fmt.relative(d.atualizado)) : "—"}</div>`),
  ].join("");
}

export function paintAvisos(el, d, contasHref = "../contas/") {
  const pend = d.contas.filter((a) => a.insights_ok === false && a.status === "connected");
  el.innerHTML = pend.length
    ? `<div class="warn-box perf-aviso"><span><b>${pend.length} ${pend.length === 1 ? "conta mostra" : "contas mostram"} só curtidas e comentários.</b> Para ver visualizações, alcance, compartilhamentos e salvos de cada vídeo, reconecte cada uma em Contas no botão <b>Liberar métricas</b> (antes, entre no instagram.com com a conta certa).</span><a class="btn small" href="${contasHref}">Ir para Contas</a></div>`
    : "";
}

// barChart escreve um rótulo por barra: mostra só alguns (e o último) e usa o dia completo na dica
const rotulosEspacados = (n) => { const passo = Math.max(1, Math.ceil(n / 7)); return (l, i, dica) => (dica ? tituloDia(l) : i % passo === 0 || i === n - 1 ? rotuloDia(l) : ""); };

export function paintSeguidores(el, sub, d, aba) {
  if (!d.desde) { el.innerHTML = `<div class="ch-empty">O histórico de seguidores começa na primeira atualização. Os ganhos por dia aparecem a partir do dia seguinte.</div>`; sub.textContent = "Soma das contas, dia a dia"; return; }
  sub.textContent = `${d.contas.length === 1 ? "Só esta conta" : `Soma das ${d.contas.length} contas`} · histórico desde ${rotuloDia(d.desde)}`;
  if (aba === "ganhos") {
    if (!d.ganhosDia.some((v) => v != null)) { el.innerHTML = `<div class="ch-empty">Os ganhos aparecem quando houver dois dias de histórico (volte amanhã).</div>`; return; }
    barChart(el, { labels: d.lista, series: [{ name: "Seguidores ganhos", color: "--ok", values: d.ganhosDia.map((v) => v ?? 0) }], fmtLabel: rotulosEspacados(d.lista.length) });
    return;
  }
  areaChart(el, { labels: d.lista, series: [{ name: "Seguidores", color: "--accent", type: "area", dots: d.total.filter((v) => v != null).length <= 3, values: d.total }], fmtLabel: rotuloDia, fmtTitle: tituloDia });
}

export function paintNovas(el, sub, d, aba) {
  const serie = aba === "views" ? d.novasViews : d.novasInter;
  sub.textContent = aba === "views" ? "Visualizações novas por dia, somando os posts" : "Curtidas, comentários, compartilhamentos e salvos novos por dia";
  if (!serie.some((v) => v != null)) {
    const semLiberar = aba === "views" && !d.tot.completas;
    el.innerHTML = `<div class="ch-empty">${semLiberar ? "As visualizações aparecem depois de liberar as métricas das contas (Contas → Liberar métricas)." : "A curva diária começa no dia seguinte à primeira atualização: cada dia guarda o total e o gráfico mostra o que entrou de um dia para o outro."}</div>`;
    return;
  }
  barChart(el, { labels: d.lista, series: [{ name: aba === "views" ? "Visualizações" : "Interações", color: aba === "views" ? "--time" : "--accent", values: serie.map((v) => v ?? 0) }], fmtLabel: rotulosEspacados(d.lista.length) });
}

const COLS = [
  ["seguidores", "Seguidores"], ["ganhos", "Ganhos"], ["posts", "Posts"], ["views", "Visualiz."], ["reach", "Alcance"],
  ["likes", "Curtidas"], ["comments", "Coment."], ["shares", "Compart."], ["saved", "Salvos"], ["porPost", "Interações/post"],
];
export function paintTabela(el, d, ord = { k: "seguidores", dir: -1 }) {
  const v = (l, k) => (k === "porPost" ? (l.posts ? l.eng / l.posts : null) : l[k]);
  const nome = (l) => String(l.a.label || handle(l.a));
  // dir −1 = do maior para o menor; vazio (—) sempre por último
  const rows = [...d.linhas].sort((x, y) => { const a = v(x, ord.k), b = v(y, ord.k); if (a == null || b == null) return a == null && b == null ? nome(x).localeCompare(nome(y)) : a == null ? 1 : -1; return (a - b) * ord.dir || nome(x).localeCompare(nome(y)); });
  const cel = (l, k) => {
    const n = v(l, k);
    if (n == null) return `<td class="muted">—</td>`;
    if (k === "ganhos") return `<td class="${n > 0 ? "up" : n < 0 ? "down" : ""}">${sinal(n)}</td>`;
    if (k === "porPost") return `<td>${nf.format(Math.round(n * 10) / 10)}</td>`;
    return `<td>${nf.format(n)}</td>`;
  };
  el.innerHTML = `<div class="tbl-wrap"><table class="tbl"><thead><tr><th scope="col" data-k="conta">Conta</th>${COLS.map(([k, t]) => `<th scope="col" data-k="${k}" ${ord.k === k ? `aria-sort="${ord.dir < 0 ? "descending" : "ascending"}"` : ""}>${t}${ord.k === k ? (ord.dir < 0 ? " ▾" : " ▴") : ""}</th>`).join("")}<th scope="col">Métricas</th></tr></thead><tbody>
    ${rows.map((l) => `<tr><td><a class="cta cta-link" href="?conta=${encodeURIComponent(l.a.id)}" title="Ver todos os posts e o desempenho de ${esc(handle(l.a))}">${avatar(l.a, 28)}<span class="nome">${esc(l.a.label || handle(l.a))}</span><span class="muted small">${esc(platformName(l.a.platform))}</span></a></td>${COLS.map(([k]) => cel(l, k)).join("")}
      <td>${l.a.insights_ok ? `<span class="pill ok">completas</span>` : l.a.insights_ok === false ? `<a class="pill warn" href="../contas/" title="Reconecte para liberar visualizações, alcance, compartilhamentos e salvos">básicas · liberar</a>` : `<span class="pill neutral">sem posts</span>`}</td></tr>`).join("")}
  </tbody></table></div>`;
}

const thumb = (p, cls = "") => p.thumbnail_url
  ? `<img class="${cls}" src="${esc(p.thumbnail_url)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:(this.className+' sem').trim()}))">`
  : `<span class="${cls} sem" aria-hidden="true"></span>`;

export function paintTop(el, sub, d) {
  const quando = d.dias === 1 ? "hoje" : `nos últimos ${d.dias} dias`;
  sub.textContent = d.temViewsPost ? `Mais vistos ${d.dias === 1 ? "hoje" : `dos últimos ${d.dias} dias`}` : `Com mais curtidas e comentários ${quando} (as visualizações aparecem depois de reconectar)`;
  if (!d.top.length) { el.innerHTML = `<div class="ch-empty">Nenhum post publicado neste período.</div>`; return; }
  const porId = new Map(d.contas.map((a) => [a.id, a]));
  el.innerHTML = `<div class="tops">${d.top.map((p, i) => {
    const a = porId.get(p.account_id);
    const principal = d.temViewsPost && p.views != null ? `${compacto(p.views)} <small>visualizações</small>` : `${compacto(interacoes(p))} <small>interações</small>`;
    return `<a class="tp" href="${esc(p.permalink || "#")}" target="_blank" rel="noopener" title="${esc((p.caption || "").slice(0, 200))}">
      <span class="th">${thumb(p)}<span class="tipo">${esc(tipoDe(p))}</span><span class="rank">${i + 1}º</span></span>
      <span class="meta"><span class="big">${principal}</span>
        <span class="sub">♥ ${nf.format(p.likes ?? 0)} · 💬 ${nf.format(p.comments ?? 0)}${p.shares != null ? ` · ↗ ${nf.format(p.shares)}` : ""}${p.saved != null ? ` · 🔖 ${nf.format(p.saved)}` : ""}</span>
        <span class="sub">${esc(a ? handle(a) : "")} · ${esc(fmt.date(p.posted_at))}</span></span></a>`;
  }).join("")}</div>`;
}

export function paintTodos(el, d, { conta = "", limite = 30 } = {}) {
  const porId = new Map(d.contas.map((a) => [a.id, a]));
  const ps = d.posts.filter((p) => !conta || p.account_id === conta);
  if (!ps.length) { el.innerHTML = `<div class="ch-empty">Nenhum post medido ainda.</div>`; return; }
  const n = (x) => (x == null ? `<td class="muted">—</td>` : `<td>${nf.format(x)}</td>`);
  el.innerHTML = `<div class="tbl-wrap"><table class="tbl tbl-posts"><thead><tr><th scope="col">Post</th><th scope="col">Data</th><th scope="col">Visualiz.</th><th scope="col">Alcance</th><th scope="col">Curtidas</th><th scope="col">Coment.</th><th scope="col">Compart.</th><th scope="col">Salvos</th><th scope="col">Assistido (média)</th></tr></thead><tbody>
    ${ps.slice(0, limite).map((p) => { const a = porId.get(p.account_id); return `<tr>
      <td><a class="cta pl" href="${esc(p.permalink || "#")}" target="_blank" rel="noopener">${thumb(p, "pthumb")}<span class="pt"><b>${esc(a ? handle(a) : "")}</b><span class="muted small">${esc(tipoDe(p))} · ${esc((p.caption || "sem legenda").slice(0, 60))}</span></span></a></td>
      <td>${esc(fmt.date(p.posted_at))}</td>${n(p.views)}${n(p.reach)}${n(p.likes)}${n(p.comments)}${n(p.shares)}${n(p.saved)}
      <td>${p.avg_watch_ms != null ? `${String(Math.round(p.avg_watch_ms / 100) / 10).replace(".", ",")} s` : `<span class="muted">—</span>`}</td></tr>`; }).join("")}
  </tbody></table></div>${ps.length > limite ? `<div class="inline" style="justify-content:center;margin-top:10px"><button class="btn ghost small" type="button" data-mais="${limite + 30}">Mostrar mais (${ps.length - limite} restantes)</button></div>` : ""}`;
}
