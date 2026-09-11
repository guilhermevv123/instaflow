// InstaFlow · editor de enquadramento para fotos do Instagram.
// A pessoa escolhe a proporção, dá zoom, arrasta (Cortar) ou faz a foto caber
// inteira com fundo (Caber). O resultado sai já no tamanho ideal (até 1440 px
// de largura, JPEG 92%) e é enviado com skip_processing para o Post for Me
// não mexer mais nele.

export const RATIOS = {
  timeline: [["4:5", 4 / 5, "Vertical 4:5"], ["1:1", 1, "Quadrado 1:1"], ["1.91:1", 1.91, "Paisagem 1.91:1"]],
  stories: [["9:16", 9 / 16, "Story 9:16"]],
  reels: [["9:16", 9 / 16, "Reels 9:16"]],
  // TikTok (fotos): as quatro proporções que ele aceita
  tiktok: [["9:16", 9 / 16, "Vertical 9:16"], ["3:4", 3 / 4, "Vertical 3:4"], ["1:1", 1, "Quadrado 1:1"], ["16:9", 16 / 9, "Paisagem 16:9"]],
  // Facebook aceita qualquer proporção; estas são as que ficam bem no feed
  facebook: [["4:5", 4 / 5, "Vertical 4:5"], ["1:1", 1, "Quadrado 1:1"], ["1.91:1", 1.91, "Paisagem 1.91:1"], ["9:16", 9 / 16, "Vertical 9:16"]],
};
// Proporções a oferecer conforme as redes escolhidas (o Instagram é o mais rígido, manda).
export function ratiosFor(platforms, placement) {
  const p = platforms && platforms.size ? platforms : new Set(["instagram"]);
  if (p.has("instagram")) return RATIOS[placement] || RATIOS.timeline;
  if (p.has("facebook") && (placement === "stories" || placement === "reels")) return RATIOS.stories;
  if (p.has("tiktok") && !p.has("facebook")) return RATIOS.tiktok;
  return RATIOS.facebook;
}
const FEED_MIN = 4 / 5, FEED_MAX = 1.91;
const MAX_W = 1440, IDEAL_W = 1080, MIN_W = 320;

// A foto já serve para este tipo de post sem ajuste?
export function fitsPlacement(width, height, placement) {
  if (!width || !height) return true; // sem dimensões, não dá para julgar
  const r = width / height;
  if (placement === "timeline") return r >= FEED_MIN - 0.005 && r <= FEED_MAX + 0.005;
  return Math.abs(r - 9 / 16) <= 0.02; // stories/reels
}

// Proporção recomendada para uma foto neste tipo de post.
export function suggestRatio(width, height, placement) {
  const list = RATIOS[placement] || RATIOS.timeline;
  if (placement !== "timeline") return list[0][0];
  const r = width && height ? width / height : 1;
  if (r < 0.95) return "4:5";
  if (r > 1.35) return "1.91:1";
  return "1:1";
}

function ensureDialog() {
  let dlg = document.getElementById("crop-dlg");
  if (dlg) return dlg;
  dlg = document.createElement("dialog");
  dlg.id = "crop-dlg";
  dlg.className = "modal crop-dlg";
  dlg.innerHTML = `
    <div class="inner">
      <div class="modal-head"><div><h2>Ajustar foto</h2><p class="help" id="crop-help"></p></div><button type="button" class="btn ghost small" id="crop-close">Fechar</button></div>
      <div class="crop-body">
        <div class="crop-stage" id="crop-stage"><canvas id="crop-canvas"></canvas><div class="crop-hint" id="crop-hint">Arraste para posicionar</div></div>
        <div class="crop-side">
          <div class="field"><span class="label">Proporção</span><div class="seg wrap" id="crop-ratios"></div></div>
          <div class="field"><span class="label">Como encaixar</span>
            <div class="seg" id="crop-mode"><button type="button" data-v="cover" class="on">Cortar</button><button type="button" data-v="contain">Caber inteira</button></div>
            <p class="help" id="crop-mode-help">Cortar: a foto preenche o quadro e o que sobra fica de fora.</p>
          </div>
          <div class="field" id="crop-zoom-field"><label for="crop-zoom">Zoom</label><input id="crop-zoom" type="range" min="1" max="4" step="0.01" value="1"></div>
          <div class="field" id="crop-bg-field" hidden><span class="label">Fundo</span>
            <div class="seg wrap" id="crop-bg"><button type="button" data-v="auto" class="on">Cor da foto</button><button type="button" data-v="blur">Desfocado</button><button type="button" data-v="#ffffff">Branco</button><button type="button" data-v="#000000">Preto</button></div>
          </div>
          <div class="stack small" id="crop-info"></div>
          <div class="inline"><button type="button" class="btn ghost small" id="crop-center">Centralizar</button></div>
          <div class="split" style="margin-top:auto"><button type="button" class="btn ghost" id="crop-cancel">Cancelar</button><button type="button" class="btn" id="crop-apply">Aplicar</button></div>
        </div>
      </div>
    </div>`;
  document.body.appendChild(dlg);
  return dlg;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (!src.startsWith("blob:") && !src.startsWith("data:")) img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Não consegui abrir a imagem para ajustar."));
    img.src = src;
  });
}

// Cor média das bordas da foto (para o fundo "Cor da foto").
function edgeColor(img) {
  const c = document.createElement("canvas"); c.width = c.height = 24;
  const x = c.getContext("2d"); x.drawImage(img, 0, 0, 24, 24);
  const d = x.getImageData(0, 0, 24, 24).data;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < 24; i++) for (const j of [0, 23]) {
    for (const [px, py] of [[i, j], [j, i]]) { const k = (py * 24 + px) * 4; r += d[k]; g += d[k + 1]; b += d[k + 2]; n++; }
  }
  return `rgb(${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)})`;
}

// Abre o editor. Devolve { blob, width, height, ratioKey, mode } ou null se cancelar.
export function openCropper({ src, placement = "timeline", ratioKey, mode = "cover", name = "foto", ratios: ratiosOverride }) {
  return new Promise(async (resolve) => {
    const dlg = ensureDialog();
    const $ = (s) => dlg.querySelector(s);
    let img;
    try { img = await loadImage(src); } catch (e) { resolve({ error: e.message }); return; }
    const iw = img.naturalWidth, ih = img.naturalHeight;
    const ratios = ratiosOverride || RATIOS[placement] || RATIOS.timeline;
    const suggested = ratios.find(([k]) => k === (ratioKey || suggestRatio(iw, ih, placement))) ? (ratioKey || suggestRatio(iw, ih, placement)) : ratios[0][0];
    const st = { ratioKey: suggested, mode, zoom: 1, ox: 0, oy: 0, bg: "auto" };
    const auto = edgeColor(img);
    const canvas = $("#crop-canvas"), ctx = canvas.getContext("2d");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    $("#crop-help").textContent = `${name} · original ${iw}×${ih} px`;
    $("#crop-ratios").innerHTML = ratios.map(([k, , label]) => `<button type="button" data-v="${k}" class="${k === st.ratioKey ? "on" : ""}">${label}</button>`).join("");

    function ratio() { return (ratios.find(([k]) => k === st.ratioKey) || ratios[0])[1]; }
    function frame() {
      const box = $("#crop-stage").getBoundingClientRect();
      const maxW = Math.max(200, box.width - 24), maxH = Math.max(200, box.height - 24);
      const r = ratio();
      let fw = maxW, fh = fw / r;
      if (fh > maxH) { fh = maxH; fw = fh * r; }
      return { fw, fh, r };
    }
    function geometry() {
      const { fw, fh } = frame();
      const base = st.mode === "cover" ? Math.max(fw / iw, fh / ih) : Math.min(fw / iw, fh / ih);
      const s = base * (st.mode === "cover" ? st.zoom : 1);
      const dw = iw * s, dh = ih * s;
      const maxOx = Math.max(0, (dw - fw) / 2), maxOy = Math.max(0, (dh - fh) / 2);
      st.ox = Math.max(-maxOx, Math.min(maxOx, st.ox));
      st.oy = Math.max(-maxOy, Math.min(maxOy, st.oy));
      return { fw, fh, s, dw, dh, dx: (fw - dw) / 2 + st.ox, dy: (fh - dh) / 2 + st.oy };
    }
    function outSize() {
      const g = geometry();
      const srcW = g.fw / g.s; // largura do quadro em pixels da foto original
      const outW = Math.round(Math.max(MIN_W, Math.min(MAX_W, srcW)));
      return { outW, outH: Math.round(outW / ratio()), srcW };
    }
    function paint(target, scaleTo) {
      const g = geometry();
      const k = scaleTo / g.fw;
      const W = Math.round(g.fw * k), H = Math.round(g.fh * k);
      const c = target.getContext("2d");
      c.imageSmoothingEnabled = true; c.imageSmoothingQuality = "high";
      c.clearRect(0, 0, W, H);
      if (st.mode === "contain") {
        if (st.bg === "blur") {
          const cover = Math.max(W / iw, H / ih) * 1.1;
          c.save(); c.filter = "blur(28px)";
          c.drawImage(img, (W - iw * cover) / 2, (H - ih * cover) / 2, iw * cover, ih * cover);
          c.restore();
          c.fillStyle = "rgba(0,0,0,.15)"; c.fillRect(0, 0, W, H);
        } else {
          c.fillStyle = st.bg === "auto" ? auto : st.bg; c.fillRect(0, 0, W, H);
        }
      }
      c.drawImage(img, g.dx * k, g.dy * k, g.dw * k, g.dh * k);
    }
    function render() {
      const g = geometry();
      canvas.width = Math.round(g.fw * dpr); canvas.height = Math.round(g.fh * dpr);
      canvas.style.width = `${Math.round(g.fw)}px`; canvas.style.height = `${Math.round(g.fh)}px`;
      paint(canvas, g.fw * dpr);
      const { outW, outH, srcW } = outSize();
      const small = srcW < IDEAL_W;
      $("#crop-info").innerHTML = `<div class="split"><span class="muted">Vai sair com</span><b class="num">${outW}×${outH} px</b></div>` +
        (small ? `<div class="warn-box">Foto pequena para este enquadramento (${Math.round(srcW)} px de largura). O Instagram vai ampliar e perder nitidez. Se puder, use o arquivo original em vez de uma foto do WhatsApp.</div>` : `<div class="ok-box">Nitidez boa para o Instagram.</div>`);
      $("#crop-zoom-field").hidden = st.mode !== "cover";
      $("#crop-bg-field").hidden = st.mode !== "contain";
      $("#crop-hint").hidden = st.mode !== "cover";
      $("#crop-mode-help").textContent = st.mode === "cover" ? "Cortar: a foto preenche o quadro e o que sobra fica de fora." : "Caber inteira: nada é cortado; as faixas que sobram ganham um fundo.";
    }

    // controles
    $("#crop-ratios").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; st.ratioKey = b.dataset.v; $("#crop-ratios").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); st.ox = st.oy = 0; render(); };
    $("#crop-mode").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; st.mode = b.dataset.v; $("#crop-mode").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); st.zoom = 1; $("#crop-zoom").value = 1; st.ox = st.oy = 0; render(); };
    $("#crop-mode").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x.dataset.v === st.mode));
    $("#crop-bg").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; st.bg = b.dataset.v; $("#crop-bg").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); render(); };
    $("#crop-zoom").value = 1;
    $("#crop-zoom").oninput = (e) => { st.zoom = Number(e.target.value); render(); };
    $("#crop-center").onclick = () => { st.ox = st.oy = 0; render(); };
    // roda do mouse = zoom
    canvas.onwheel = (e) => { if (st.mode !== "cover") return; e.preventDefault(); st.zoom = Math.max(1, Math.min(4, st.zoom * (e.deltaY < 0 ? 1.06 : 0.94))); $("#crop-zoom").value = st.zoom; render(); };
    // arrastar
    let drag = null;
    canvas.onpointerdown = (e) => { if (st.mode !== "cover") return; drag = { x: e.clientX, y: e.clientY, ox: st.ox, oy: st.oy }; canvas.setPointerCapture(e.pointerId); };
    canvas.onpointermove = (e) => { if (!drag) return; st.ox = drag.ox + (e.clientX - drag.x); st.oy = drag.oy + (e.clientY - drag.y); render(); };
    canvas.onpointerup = canvas.onpointercancel = () => { drag = null; };

    let done = false;
    const finish = (val) => { if (done) return; done = true; dlg.close(); window.removeEventListener("resize", render); resolve(val); };
    $("#crop-close").onclick = $("#crop-cancel").onclick = () => finish(null);
    dlg.oncancel = (e) => { e.preventDefault(); finish(null); };
    $("#crop-apply").onclick = async () => {
      const { outW, outH } = outSize();
      const out = document.createElement("canvas"); out.width = outW; out.height = outH;
      paint(out, outW);
      let blob;
      try { blob = await new Promise((ok, bad) => out.toBlob((b) => (b ? ok(b) : bad(new Error("Falha ao gerar a imagem."))), "image/jpeg", 0.92)); }
      catch (e) { finish({ error: /tainted|insecure|SecurityError/i.test(String(e)) ? "Esta imagem da biblioteca não pode ser editada aqui. Envie o arquivo de novo." : e.message }); return; }
      finish({ blob, width: outW, height: outH, ratioKey: st.ratioKey, mode: st.mode });
    };

    window.addEventListener("resize", render);
    if (!dlg.open) dlg.showModal();
    render(); // já com o diálogo aberto; não depende de requestAnimationFrame (aba oculta congela)
    requestAnimationFrame(render);
  });
}
