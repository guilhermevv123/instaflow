// InstaFlow · documentação da API: monta a referência a partir de api-spec.js,
// o menu lateral com busca, as abas de linguagem, os botões de copiar, as
// tabelas de erros e eventos, o "Experimentar" e o download do OpenAPI.
import { ERROS, EVENTOS, GROUPS, UPDATED, VERSION } from "./api-spec.js";
import { escHtml, highlight, LANGS, sample, toOpenApi } from "./api-codegen.js";
import { openConsole } from "./api-console.js";

const cfg = window.INSTAFLOW_CONFIG || {};
const SUPA = (cfg.SUPABASE_URL || "https://SEU-PROJETO.supabase.co").replace(/\/+$/, "");
const BASE = `${SUPA}/functions/v1/api/v1`;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const sub = (s) => String(s ?? "").replaceAll("{BASE}", BASE).replaceAll("{SUPABASE}", SUPA);
const semAcento = (s) => String(s).toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
const ENDPOINTS = new Map(GROUPS.flatMap((g) => g.endpoints.map((ep) => [ep.id, ep])));
const LANG_KEY = "if.api.lang";
let lang = "curl";
try { const salvo = localStorage.getItem(LANG_KEY); if (LANGS.some(([k]) => k === salvo)) lang = salvo; } catch { /* sem armazenamento */ }

// ------------------------------------------------------------------ referência
function campos(fields, nivel = 0) {
  return fields.map((f) => `
    <div class="param">
      <div class="param-head"><code>${escHtml(f.name)}</code><span class="tipo">${escHtml(f.type)}</span>${f.required ? `<span class="obrig">obrigatório</span>` : ""}${f.default !== undefined ? `<span class="padrao">padrão: <code>${escHtml(JSON.stringify(f.default))}</code></span>` : ""}</div>
      ${f.desc ? `<div class="param-desc">${sub(f.desc)}</div>` : ""}
      ${f.enum ? `<div class="param-enum">Valores aceitos: ${f.enum.map((v) => `<code>${escHtml(typeof v === "string" ? v : JSON.stringify(v))}</code>`).join(" ")}</div>` : ""}
      ${f.children ? `<details class="param-children"${nivel === 0 && f.children.length <= 4 ? " open" : ""}><summary>Campos de ${escHtml(f.name)} (${f.children.length})</summary>${campos(f.children, nivel + 1)}</details>` : ""}
    </div>`).join("");
}

function errosDo(ep) {
  const lista = [...(ep.errors || [])];
  if (ep.method !== "GET") lista.push([403, "somente_leitura"]);
  lista.push([401, "chave_invalida"], [429, "limite_chamadas"]);
  const vistos = new Set();
  return `<ul class="erros-ep">${lista.filter(([s, c]) => !vistos.has(`${s}${c}`) && vistos.add(`${s}${c}`)).map(([s, c, txt]) => {
    const info = ERROS.find((e) => e[0] === s && e[1] === c);
    return `<li><span class="st ${s >= 500 ? "bad" : "warn"}">${s}</span>${c.startsWith("(") ? "" : `<code>${escHtml(c)}</code>`}<span>${escHtml(txt || info?.[2] || "")}</span></li>`;
  }).join("")}</ul>`;
}

function endpoint(ep) {
  const m = ep.method.toLowerCase();
  const resp = ep.response
    ? `<div class="code-card"><div class="code-bar"><span class="title">Resposta ${ep.response.status}</span></div><pre class="code"><code>${highlight(sub(JSON.stringify(ep.response.body, null, 2)), "json")}</code></pre></div>`
    : "";
  return `
  <section class="ep" id="${ep.id}">
    <div class="ep-text">
      <div class="ep-head"><span class="metodo ${m}">${ep.method}</span><code class="rota">${escHtml(ep.path)}</code><span class="escopo ${ep.auth}">${ep.auth === "write" ? "chave de escrita" : "qualquer chave"}</span></div>
      <h3>${escHtml(ep.title)}</h3>
      <p class="lead">${sub(ep.summary)}</p>
      ${ep.desc ? `<div class="desc">${sub(ep.desc)}</div>` : ""}
      ${ep.headers?.length ? `<h4>Cabeçalhos</h4>${campos(ep.headers)}` : ""}
      ${ep.pathParams?.length ? `<h4>No caminho</h4>${campos(ep.pathParams)}` : ""}
      ${ep.query?.length ? `<h4>Na URL (query)</h4>${campos(ep.query)}` : ""}
      ${ep.body?.length ? `<h4>Corpo (JSON)</h4>${campos(ep.body)}` : ""}
      <h4>Erros possíveis</h4>${errosDo(ep)}
    </div>
    <div class="ep-code">
      <div class="code-card" data-exemplo="${ep.id}">
        <div class="code-bar" role="tablist" aria-label="Linguagem do exemplo">${LANGS.map(([k, nome]) => `<button type="button" role="tab" data-lang="${k}">${nome}</button>`).join("")}</div>
        <pre class="code"><code></code></pre>
      </div>
      ${resp}
      <div class="try-row"><button type="button" class="btn small" data-try="${ep.id}">▶ Experimentar com a sua chave</button></div>
    </div>
  </section>`;
}

function montarReferencia() {
  const alvo = $("#referencia");
  if (!alvo) return;
  alvo.innerHTML = GROUPS.map((g) => `
    <section class="ref-grupo" id="${g.id}" data-ref="${escHtml(g.title)}">
      <span class="eyebrow-api">Referência</span>
      <h2>${escHtml(g.title)}</h2>
      <p>${sub(g.intro)}</p>
      ${g.endpoints.map(endpoint).join("")}
    </section>`).join("");
}

// ------------------------------------------------------------------ abas de linguagem
function pintarLinguagem() {
  $$("[data-exemplo]").forEach((card) => {
    const ep = ENDPOINTS.get(card.dataset.exemplo);
    $("pre code", card).innerHTML = highlight(sample(lang, ep, BASE), "code");
  });
  $$(".code-card[data-tabs]").forEach((card) => {
    const tem = $$("pre[data-tab]", card).map((p) => p.dataset.tab);
    const atual = tem.includes(lang) ? lang : tem[0];
    $$("pre[data-tab]", card).forEach((p) => { p.hidden = p.dataset.tab !== atual; });
    $$(".code-bar button[data-lang]", card).forEach((b) => { b.classList.toggle("on", b.dataset.lang === atual); b.setAttribute("aria-selected", String(b.dataset.lang === atual)); });
  });
  $$("[data-exemplo] .code-bar button[data-lang]").forEach((b) => { b.classList.toggle("on", b.dataset.lang === lang); b.setAttribute("aria-selected", String(b.dataset.lang === lang)); });
}

// ------------------------------------------------------------------ guias (HTML estático)
function prepararGuias() {
  // {BASE} em qualquer texto dos guias (listas, tabelas, código de uma linha)
  const textos = document.createTreeWalker($("#topo"), NodeFilter.SHOW_TEXT);
  for (let n = textos.nextNode(); n; n = textos.nextNode()) {
    if (n.nodeValue.includes("{BASE}") || n.nodeValue.includes("{SUPABASE}")) n.nodeValue = sub(n.nodeValue);
  }
  $$("[data-base]").forEach((el) => { el.textContent = BASE; });
  $$("[data-versao]").forEach((el) => { el.textContent = VERSION; });
  $$("[data-atualizado]").forEach((el) => { el.textContent = UPDATED; });
  $$("pre.code[data-lang]").forEach((pre) => {
    const code = $("code", pre) || pre;
    code.innerHTML = highlight(sub(code.textContent.replace(/^\n/, "").replace(/\n\s*$/, "")), pre.dataset.lang === "json" ? "json" : "code");
  });
  $$(".code-card[data-tabs]").forEach((card) => {
    const nomes = Object.fromEntries(LANGS);
    const tabs = $$("pre[data-tab]", card).map((p) => p.dataset.tab);
    card.insertAdjacentHTML("afterbegin", `<div class="code-bar" role="tablist">${tabs.map((t) => `<button type="button" role="tab" data-lang="${t}">${escHtml(nomes[t] || t)}</button>`).join("")}</div>`);
  });
  const tabela = $("#tabela-erros");
  if (tabela) {
    tabela.innerHTML = `<div class="tbl-wrap"><table class="doc"><thead><tr><th>HTTP</th><th>code</th><th>O que aconteceu e o que fazer</th></tr></thead><tbody>${ERROS.map(([s, c, t]) => `<tr><td><span class="st ${s >= 500 ? "bad" : s === 429 ? "warn" : "warn"}">${s}</span></td><td>${c.startsWith("(") ? `<span class="muted">${escHtml(c)}</span>` : `<code>${escHtml(c)}</code>`}</td><td>${escHtml(t)}</td></tr>`).join("")}</tbody></table></div>`;
  }
  const eventos = $("#eventos-webhook");
  if (eventos) {
    eventos.innerHTML = EVENTOS.map((ev) => `
      <h4 id="evento-${ev.type.replace(/\./g, "-")}"><code>${escHtml(ev.type)}</code></h4>
      <p>${escHtml(ev.quando)}</p>
      <pre class="code"><code>${highlight(JSON.stringify({ id: "evt_5c1b0a9f8e7d6c5b4a3f2e1d", type: ev.type, created_at: "2026-09-20T21:01:13.000Z", team_id: "c0ffee00-1234-4abc-9def-0123456789ab", data: ev.data }, null, 2), "json")}</code></pre>`).join("");
  }
}

// ------------------------------------------------------------------ menu lateral, busca e posição
function montarMenu() {
  const grupos = new Map();
  $$("[data-guia]").forEach((s) => {
    const g = s.dataset.grupoNav || "Guias";
    if (!grupos.has(g)) grupos.set(g, []);
    grupos.get(g).push(`<a href="#${s.id}" data-busca="${escHtml(semAcento(`${s.dataset.guia} ${s.dataset.busca || ""}`))}">${escHtml(s.dataset.guia)}</a>`);
  });
  const guias = [...grupos].map(([t, links]) => `<div class="nav-sec"><h4>${escHtml(t)}</h4>${links.join("")}</div>`).join("");
  const ref = GROUPS.map((g) => `<div class="nav-sec"><h4>${escHtml(g.title)}</h4>${g.endpoints.map((ep) => `<a href="#${ep.id}" data-busca="${escHtml(semAcento(`${ep.method} ${ep.path} ${ep.title} ${ep.summary}`))}"><span class="metodo ${ep.method.toLowerCase()}">${ep.method}</span><span>${escHtml(ep.title)}</span></a>`).join("")}</div>`).join("");
  $("#nav-links").innerHTML = `${guias}${ref}<div class="nav-empty" hidden>Nada encontrado. Tente outra palavra.</div>`;

  $("#nav-busca")?.addEventListener("input", (e) => {
    const q = semAcento(e.target.value.trim());
    let algum = false;
    $$(".nav-sec").forEach((sec) => {
      let visiveis = 0;
      $$("a", sec).forEach((a) => { const ok = !q || a.dataset.busca.includes(q); a.hidden = !ok; if (ok) visiveis++; });
      sec.hidden = !visiveis;
      if (visiveis) algum = true;
    });
    $(".nav-empty").hidden = algum;
  });

  const links = new Map($$("#nav-links a").map((a) => [a.getAttribute("href").slice(1), a]));
  const alvos = [...$$("[data-guia]"), ...$$(".ep")];
  const obs = new IntersectionObserver((entradas) => {
    const visivel = entradas.filter((x) => x.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
    if (!visivel) return;
    const id = visivel.target.id;
    $$("#nav-links a.on").forEach((a) => a.classList.remove("on"));
    const a = links.get(id);
    if (a) {
      a.classList.add("on");
      const nav = $("#docs-nav");
      const r = a.getBoundingClientRect(), n = nav.getBoundingClientRect();
      if (r.top < n.top + 60 || r.bottom > n.bottom - 20) a.scrollIntoView({ block: "nearest" });
      $("#crumb").textContent = a.textContent.replace(/^(GET|POST|PUT|PATCH|DELETE)/, "").trim();
    }
  }, { rootMargin: "-72px 0px -65% 0px" });
  alvos.forEach((el) => obs.observe(el));

  const fechar = () => document.documentElement.classList.remove("nav-open");
  $("#nav-toggle")?.addEventListener("click", () => document.documentElement.classList.toggle("nav-open"));
  $("#docs-scrim")?.addEventListener("click", fechar);
  $("#nav-links").addEventListener("click", (e) => { if (e.target.closest("a")) fechar(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") fechar(); if (e.key === "/" && !e.target.closest("input, textarea")) { e.preventDefault(); $("#nav-busca")?.focus(); } });
}

// ------------------------------------------------------------------ copiar, experimentar e OpenAPI
async function copiar(texto, botao) {
  try { await navigator.clipboard.writeText(texto); }
  catch {
    const t = Object.assign(document.createElement("textarea"), { value: texto });
    document.body.appendChild(t); t.select(); document.execCommand("copy"); t.remove();
  }
  if (botao) { const antes = botao.textContent; botao.textContent = "Copiado ✓"; setTimeout(() => { botao.textContent = antes; }, 1600); }
}

function ligarAcoes() {
  const botaoCopiar = `<button type="button" class="copy-btn" data-copiar-pre>Copiar</button>`;
  $$("pre.code").forEach((pre) => {
    const barra = pre.closest(".code-card")?.querySelector(":scope > .code-bar");
    if (!barra) pre.insertAdjacentHTML("beforeend", botaoCopiar);
    else if (!$("[data-copiar-pre]", barra)) barra.insertAdjacentHTML("beforeend", botaoCopiar);
  });
  document.addEventListener("click", (e) => {
    const tab = e.target.closest(".code-bar button[data-lang]");
    if (tab) { lang = tab.dataset.lang; try { localStorage.setItem(LANG_KEY, lang); } catch { /* sem armazenamento */ } pintarLinguagem(); return; }
    const cp = e.target.closest("[data-copiar-pre]");
    if (cp) { const pre = cp.closest("pre") || $$("pre.code", cp.closest(".code-card")).find((p) => !p.hidden); copiar($("code", pre).textContent, cp); return; }
    const base = e.target.closest("[data-copiar-base]");
    if (base) { copiar(BASE, base); return; }
    const tentar = e.target.closest("[data-try]");
    if (tentar) { openConsole(ENDPOINTS.get(tentar.dataset.try), BASE); return; }
    const oa = e.target.closest("[data-openapi]");
    if (oa) {
      const spec = toOpenApi(GROUPS, { base: BASE, version: VERSION, errors: ERROS, intro: "API do InstaFlow: contas, mídia, publicações em várias redes, variações de legenda, desempenho e webhooks. Autentique com Authorization: Bearer <chave ifk_…>." });
      const url = URL.createObjectURL(new Blob([JSON.stringify(spec, null, 2)], { type: "application/json" }));
      const a = Object.assign(document.createElement("a"), { href: url, download: `instaflow-openapi-${VERSION}.json` });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }
  });
}

// ------------------------------------------------------------------ início
prepararGuias();
montarReferencia();
montarMenu();
ligarAcoes();
pintarLinguagem();
if (location.hash) requestAnimationFrame(() => document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView());
window.__instaflowDocs = { BASE, VERSION, endpoints: ENDPOINTS.size, openapi: () => toOpenApi(GROUPS, { base: BASE, version: VERSION, errors: ERROS, intro: "" }) };
