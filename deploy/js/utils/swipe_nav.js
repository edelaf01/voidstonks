import { state } from "../state.js";

const MIN_DX = 72;
const MAX_MS = 700;
const RATIO = 1.7;
const EDGE_PX = 24;
const SUBVISTAS = ["bounties", "weapons", "traders"];
const SUBVISTA_KEY = "vs_farms_subview_v1";
const IGNORADO =
  'input, textarea, select, [contenteditable], [draggable="true"], .tabs, #tab-fan, #tab-fan-overlay, [role="dialog"], [aria-modal="true"], [role="slider"], canvas';
const DRAWERS_ABIERTOS =
  "#inventory-container.open, #best-missions-container.open, #cloud-sync-container.open, #ds-eelog.open";
const MODALES =
  '.palette-veil, .tutorial-veil, #scan-success-modal, #grading-modal, #update-modal, #calibration-modal, #orokin-confirm-modal, #orokin-prompt-modal, #ds-permisos, .orders-modal-backdrop, [role="dialog"], [aria-modal="true"]';

let inicio = null;
let ultimaSubvista = null;
let ultimaLeida = null;

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

function haySuperposicionAbierta() {
  if (
    document.body.classList.contains("tab-fan-open") ||
    document.body.classList.contains("palette-open") ||
    document.body.classList.contains("tutorial-open")
  ) {
    return true;
  }
  if (document.querySelector(DRAWERS_ABIERTOS)) return true;
  for (const el of document.querySelectorAll(MODALES)) {
    if (el.closest(".hidden, [hidden], .closed")) continue;
    if (getComputedStyle(el).display === "none") continue;
    return true;
  }
  return false;
}

function bloqueado(target) {
  if (haySuperposicionAbierta()) return true;
  if (!(target instanceof Element)) return true;
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

function leerSubvista() {
  try {
    const v = localStorage.getItem(SUBVISTA_KEY);
    if (SUBVISTAS.includes(v)) return v;
  } catch {}
  const dom = document.querySelector(".farms-sub-btn.active")?.dataset.subview;
  return SUBVISTAS.includes(dom) ? dom : null;
}

function subvistaActual() {
  const leida = leerSubvista();
  if (leida && leida !== ultimaLeida) {
    ultimaLeida = leida;
    ultimaSubvista = leida;
  }
  return SUBVISTAS.includes(ultimaSubvista) ? ultimaSubvista : leida || SUBVISTAS[0];
}

function mover(dir) {
  const activa = state.activeTab;
  if (activa === "bounties") {
    const actual = subvistaActual();
    ultimaSubvista = actual;
    const i = SUBVISTAS.indexOf(actual);
    const j = i + dir;
    if (j >= 0 && j < SUBVISTAS.length) {
      ultimaSubvista = SUBVISTAS[j];
      globalThis.switchFarmsSubview?.(ultimaSubvista);
      animar(dir);
      return;
    }
  }
  const lista = pestanas();
  const i = lista.indexOf(activa);
  const destino = lista[i + dir];
  if (i === -1 || !destino) return;
  globalThis.switchTab(destino);
  if (destino === "bounties" && dir < 0) globalThis.switchFarmsSubview?.(subvistaActual());
  animar(dir);
}

function alEmpezar(e) {
  inicio = null;
  if (e.touches.length !== 1 || bloqueado(e.target)) return;
  const t = e.touches[0];
  const w = globalThis.innerWidth || document.documentElement.clientWidth || 0;
  if (t.clientX < EDGE_PX || (w > 0 && w - t.clientX < EDGE_PX)) return;
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
