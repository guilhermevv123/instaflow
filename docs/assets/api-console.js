// InstaFlow · documentação da API: botão "Experimentar". Manda a chamada de
// verdade para a API com a chave que a pessoa colar. A chave fica só nesta aba
// (sessionStorage) e só vai para o endereço da API.
import { escHtml, fillPath, highlight } from "./api-codegen.js";

const KEY_STORE = "if.api.key";
let dlg = null;

function ensure() {
  if (dlg) return dlg;
  dlg = document.createElement("dialog");
  dlg.className = "cons";
  dlg.setAttribute("aria-labelledby", "c-title");
  dlg.innerHTML = `
    <form class="cons-in" novalidate>
      <div class="cons-head">
        <div class="cons-id"><span class="metodo" id="c-met"></span><code id="c-path"></code><div class="cons-title" id="c-title"></div></div>
        <button type="button" class="btn ghost small" data-close>Fechar</button>
      </div>
      <div class="callout warn" id="c-warn" hidden></div>
      <label class="cons-field"><span>Chave de acesso</span>
        <input id="c-key" type="password" autocomplete="off" spellcheck="false" placeholder="ifk_…">
        <small>Fica só nesta aba e some quando você fechar. Gere a sua no painel em Config → API e integrações.</small></label>
      <div id="c-params"></div>
      <label class="cons-field" id="c-query-f"><span>Parâmetros na URL (query)</span>
        <input id="c-query" type="text" spellcheck="false" placeholder="ex.: status=scheduled&amp;limit=10"></label>
      <div class="cons-field" id="c-idem-f" hidden><span>Idempotency-Key (opcional)</span>
        <span class="cons-row"><input id="c-idem" type="text" spellcheck="false" aria-label="Idempotency-Key"><button type="button" class="btn ghost small" id="c-idem-new">Gerar</button></span></div>
      <label class="cons-field" id="c-body-f"><span>Corpo (JSON)</span>
        <textarea id="c-body" rows="14" spellcheck="false"></textarea></label>
      <div class="cons-actions"><button type="submit" class="btn" id="c-send">Enviar requisição</button><code class="cons-url" id="c-url"></code></div>
      <div class="cons-out" id="c-out" hidden>
        <div class="cons-status" id="c-status" aria-live="polite"></div>
        <pre class="code"><code id="c-resp"></code></pre>
      </div>
    </form>`;
  document.body.appendChild(dlg);
  dlg.querySelector("[data-close]").addEventListener("click", () => dlg.close());
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
  return dlg;
}

export function openConsole(ep, base) {
  const d = ensure();
  const $ = (s) => d.querySelector(s);
  const ex = ep.example || {};
  const write = ep.method !== "GET";
  const dryRun = ep.id === "create-post";

  $("#c-met").textContent = ep.method;
  $("#c-met").className = `metodo ${ep.method.toLowerCase()}`;
  $("#c-path").textContent = ep.path;
  $("#c-title").textContent = ep.title;
  $("#c-warn").hidden = !write;
  $("#c-warn").innerHTML = !write ? "" : dryRun
    ? `Já deixei <code>"dry_run": true</code> no corpo: a API confere tudo e mostra o que seria enviado, <b>sem publicar</b>. Tire o <code>dry_run</code> para publicar de verdade.`
    : "Esta chamada age de verdade no seu time (cria, muda, publica ou apaga).";
  try { $("#c-key").value = sessionStorage.getItem(KEY_STORE) || ""; } catch { /* sem armazenamento */ }

  $("#c-params").innerHTML = (ep.pathParams || []).map((p) => `
    <label class="cons-field"><span>${escHtml(p.name)} <em>(no caminho)</em></span>
      <input data-param="${escHtml(p.name)}" type="text" spellcheck="false" value="${escHtml(ex.path?.[p.name] ?? "")}"></label>`).join("");
  $("#c-query-f").hidden = !(ep.query || []).length;
  $("#c-query").value = ex.query || "";
  const idem = (ep.headers || []).some((h) => h.name === "Idempotency-Key");
  $("#c-idem-f").hidden = !idem;
  $("#c-idem").value = "";
  const hasBody = Boolean(ep.body);
  $("#c-body-f").hidden = !hasBody;
  const body = hasBody ? structuredClone(ex.body ?? {}) : null;
  if (dryRun && body) body.dry_run = true;
  $("#c-body").value = hasBody ? JSON.stringify(body, null, 2) : "";
  $("#c-out").hidden = true;

  const urlNow = () => {
    const params = Object.fromEntries([...d.querySelectorAll("[data-param]")].map((i) => [i.dataset.param, encodeURIComponent(i.value.trim())]));
    const q = $("#c-query-f").hidden ? "" : $("#c-query").value.trim().replace(/^\?/, "");
    return `${base}${fillPath(ep.path, params)}${q ? `?${q}` : ""}`;
  };
  const paintUrl = () => { $("#c-url").textContent = `${ep.method} ${urlNow()}`; };
  d.oninput = paintUrl;
  paintUrl();
  $("#c-idem-new").onclick = () => { $("#c-idem").value = crypto.randomUUID(); };

  function show(status, text, extra = "") {
    $("#c-out").hidden = false;
    const cls = status && status < 300 ? "ok" : status && status < 500 ? "warn" : "bad";
    $("#c-status").innerHTML = `<span class="st ${cls}">${status || "sem resposta"}</span> ${escHtml(extra)}`;
    $("#c-resp").innerHTML = highlight(text, "json");
    $("#c-out").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  d.querySelector("form").onsubmit = async (e) => {
    e.preventDefault();
    const key = $("#c-key").value.trim();
    if (!key) { $("#c-key").focus(); return; }
    try { sessionStorage.setItem(KEY_STORE, key); } catch { /* sem armazenamento */ }
    let payload;
    if (hasBody) {
      try { payload = JSON.stringify(JSON.parse($("#c-body").value || "{}")); }
      catch (err) { show(0, `O corpo não é um JSON válido: ${err.message}`); return; }
    }
    const btn = $("#c-send");
    btn.disabled = true;
    btn.textContent = "Enviando…";
    const t0 = performance.now();
    try {
      const headers = { Authorization: `Bearer ${key}` };
      if (hasBody) headers["Content-Type"] = "application/json";
      if (idem && $("#c-idem").value.trim()) headers["Idempotency-Key"] = $("#c-idem").value.trim();
      const res = await fetch(urlNow(), { method: ep.method, headers, body: payload });
      const text = await res.text();
      let pretty = text;
      try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch { /* não é JSON */ }
      const partes = [`${Math.round(performance.now() - t0)} ms`];
      const rest = res.headers.get("x-ratelimit-remaining");
      if (rest !== null) partes.push(`${rest} chamadas restantes neste minuto`);
      if (res.headers.get("idempotent-replayed")) partes.push("resposta repetida (Idempotency-Key)");
      show(res.status, pretty, partes.join(" · "));
    } catch (err) {
      show(0, `Não consegui falar com a API: ${err.message}`);
    } finally {
      btn.disabled = false;
      btn.textContent = "Enviar requisição";
    }
  };

  d.showModal();
  ($("#c-key").value ? $("#c-send") : $("#c-key")).focus();
}
