import { state } from "../state.js";

const MIN_DX = 72;
const MAX_MS = 700;
const RATIO = 1.7;
const SUBVISTAS = ["bounties", "weapons", "traders"];
const SUBVISTA_KEY = "vs_farms_subview_v1";
const IGNORADO =
  'input, textarea, select, [contenteditable], [draggable="true"], .tabs, #tab-fan, #tab-fan-overlay, [role="dialog"], [aria-modal="true"], [role="slider"], canvas';

let inicio = null;

function pestanas() {
  return [...document.querySelectorAll('.tabs > .tab-btn[role="tab"]:not(.is-wip)')]
    .map((b) => b.id.replace(/^btn-/, ""))
    .filter(Boolean);
}

function desplazaEnX(el) {
  for (let n = el; n && n !== document.body; n = n.parentElement) {
    if (n.scrollWidth <= n.clientWidth + 1) continue;
    const ox = getComputedStyle(n).overflowX;
    if (ox === "auto" || ox === "scroll") return true;
  }
  return false;
}

function bloqueado(target) {
  if (!(target instanceof Element)) return true;
  if (document.body.classList.contains("tab-fan-open")) return true;
  if (target.closest(IGNORADO)) return true;
  return desplazaEnX(target);
}

function animar(dir) {
  if (globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const area = document.querySelector(".content-area");
  if (!area) return;
  area.classList.remove("swipe-next", "swipe-prev");
  void area.offsetWidth;
  area.classList.add(dir > 0 ? "swipe-next" : "swipe-prev");
}

function subvistaActual() {
  try {
    const v = localStorage.getItem(SUBVISTA_KEY);
    return SUBVISTAS.includes(v) ? v : SUBVISTAS[0];
  } catch {
    return SUBVISTAS[0];
  }
}

function mover(dir) {
  const activa = state.activeTab;
  if (activa === "bounties") {
    const i = SUBVISTAS.indexOf(subvistaActual());
    const j = i + dir;
    if (j >= 0 && j < SUBVISTAS.length) {
      globalThis.switchFarmsSubview?.(SUBVISTAS[j]);
      animar(dir);
      return;
    }
  }
  const lista = pestanas();
  const i = lista.indexOf(activa);
  const destino = lista[i + dir];
  if (i === -1 || !destino) return;
  globalThis.switchTab(destino);
  if (destino === "bounties" && dir < 0) globalThis.switchFarmsSubview?.(SUBVISTAS[0]);
  animar(dir);
}

function alEmpezar(e) {
  inicio = null;
  if (e.touches.length !== 1 || bloqueado(e.target)) return;
  const t = e.touches[0];
  inicio = { x: t.clientX, y: t.clientY, t: Date.now() };
}

function alTerminar(e) {
  const s = inicio;
  inicio = null;
  if (!s || e.changedTouches.length !== 1) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - s.x;
  const dy = t.clientY - s.y;
  if (Date.now() - s.t > MAX_MS) return;
  if (Math.abs(dx) < MIN_DX || Math.abs(dx) < Math.abs(dy) * RATIO) return;
  if (globalThis.getSelection?.()?.toString()) return;
  mover(dx < 0 ? 1 : -1);
}

export function initSwipeNav() {
  if (!globalThis.matchMedia?.("(pointer: coarse)").matches) return;
  document.addEventListener("touchstart", alEmpezar, { passive: true });
  document.addEventListener("touchend", alTerminar, { passive: true });
  document.addEventListener("touchcancel", () => (inicio = null), { passive: true });
}
