// Arrastar para reagendar: no mouse, arrasta; no toque, segura um instante e
// arrasta. Solta num dia do mês ([data-drop-day], mantém o horário) ou num
// horário da grade ([data-col], de 15 em 15 min). A página decide o que fazer
// com o novo horário em onDrop(post, { key, min }).
import { hhmm } from "./cal-core.js";

export function enableDrag(root, { find, onDrop, hourPx, snap = 15 }) {
  let s = null;
  const markDragged = () => { root.dataset.dragged = "1"; setTimeout(() => delete root.dataset.dragged, 350); };

  root.addEventListener("pointerdown", (e) => {
    const el = e.target.closest("[data-drag]");
    if (!el || e.button > 0) return;
    const post = find(el.dataset.id);
    if (!post) return;
    s = { el, post, id: e.pointerId, x: e.clientX, y: e.clientY, touch: e.pointerType !== "mouse", on: false, timer: 0, target: null };
    if (s.touch) s.timer = setTimeout(() => activate(s.x, s.y), 380);
  });
  document.addEventListener("pointermove", (e) => {
    if (!s || e.pointerId !== s.id) return;
    const far = Math.hypot(e.clientX - s.x, e.clientY - s.y);
    if (!s.on) {
      if (s.touch) { if (far > 8) cleanup(); return; } // era rolagem
      if (far < 5) return;
      activate(e.clientX, e.clientY);
    }
    move(e.clientX, e.clientY);
  });
  document.addEventListener("pointerup", (e) => {
    if (!s || e.pointerId !== s.id) return;
    const st = s;
    cleanup();
    if (!st.on) return; // foi só um toque: abre a publicação normalmente
    markDragged();
    const t = st.target;
    if (t && (t.key !== st.post.key || t.min !== st.post.min)) onDrop(st.post, t);
  });
  document.addEventListener("pointercancel", (e) => { if (s && e.pointerId === s.id) { if (s.on) markDragged(); cleanup(); } });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && s?.on) { markDragged(); cleanup(); } });
  // o arraste termina com um clique no link: não abrir a publicação
  root.addEventListener("click", (e) => { if (root.dataset.dragged) { e.preventDefault(); e.stopPropagation(); } }, true);
  root.addEventListener("contextmenu", (e) => { if (s) e.preventDefault(); });
  // o arraste nativo de links do navegador cancelaria o nosso (pointercancel)
  root.addEventListener("dragstart", (e) => e.preventDefault());
  // registrado desde o começo: o navegador só deixa segurar a rolagem se o
  // ouvinte já existia quando o dedo encostou
  root.addEventListener("touchmove", (e) => { if (s?.on) e.preventDefault(); }, { passive: false });

  function activate(x, y) {
    if (!s || s.on) return;
    s.on = true;
    const r = s.el.getBoundingClientRect();
    s.offX = s.x - r.left; // o bloco fica preso no ponto onde foi pego
    s.offY = s.y - r.top;
    s.ghost = s.el.cloneNode(true);
    s.ghost.classList.add("ec-ghost");
    s.ghost.removeAttribute("href");
    Object.assign(s.ghost.style, { width: `${r.width}px`, height: `${r.height}px`, left: `${r.left}px`, top: `${r.top}px`, right: "auto", bottom: "auto" });
    document.body.appendChild(s.ghost);
    s.el.classList.add("ec-src");
    document.documentElement.classList.add("ec-dragging");
    navigator.vibrate?.(12);
    move(x, y);
  }

  function move(x, y) {
    s.ghost.style.left = `${x - s.offX}px`;
    s.ghost.style.top = `${y - s.offY}px`;
    clearMarks();
    const hit = document.elementFromPoint(x, y);
    const cell = hit?.closest?.("[data-drop-day]");
    const col = hit?.closest?.("[data-col]");
    s.target = null;
    if (cell && root.contains(cell)) {
      cell.classList.add("drop");
      s.target = { key: cell.dataset.dropDay, min: s.post.min };
    } else if (col && root.contains(col)) {
      const px = hourPx();
      const top = y - s.offY - col.getBoundingClientRect().top; // topo do bloco, não o dedo
      const min = Math.max(0, Math.min(24 * 60 - snap, Math.round((top / px) * 60 / snap) * snap));
      s.target = { key: col.dataset.col, min };
      s.ind = document.createElement("div");
      s.ind.className = "ec-ind";
      s.ind.style.top = `${(min / 60) * px}px`;
      s.ind.textContent = hhmm(min);
      col.appendChild(s.ind);
    }
    // perto da borda da grade, rola sozinho
    const sc = root.querySelector(".ec-scroll");
    if (sc) {
      const r = sc.getBoundingClientRect();
      if (y < r.top + 40) sc.scrollTop -= 14;
      else if (y > r.bottom - 40) sc.scrollTop += 14;
    }
  }

  function clearMarks() {
    root.querySelectorAll(".drop").forEach((x) => x.classList.remove("drop"));
    s?.ind?.remove();
    if (s) s.ind = null;
  }

  function cleanup() {
    if (!s) return;
    clearTimeout(s.timer);
    clearMarks();
    s.ghost?.remove();
    s.el.classList.remove("ec-src");
    document.documentElement.classList.remove("ec-dragging");
    s = null;
  }
}
