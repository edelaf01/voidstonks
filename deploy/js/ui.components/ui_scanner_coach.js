import { state } from "../state.js";
import { TEXTS } from "../config.js";
import { showToast } from "./ui_components.js";
import { exposeGlobals } from "../utils/global_registry.js";
import { PASOS_TOUR, siguientePaso, tocaAvisar, marcaVisto, olvidaVistos } from "../utils/scanner_coach.js";

/**
 * Scanner tutorial: a one line notice the first time each screen shows, and a guided tour that dims
 * everything and highlights the HUD step by step. utils/scanner_coach.js decides and persists; this
 * only paints.
 */

let paso = -1;
let bloqueoPrevio = null;

const textos = () => (TEXTS[state.currentLang] || TEXTS.en).scannerCoach || {};

function pausaEscaner(pausar) {
    const svc = globalThis.ScannerService;
    if (!svc) return;
    if (pausar) {
        bloqueoPrevio = svc.detectionLocked;
        svc.detectionLocked = true;
    } else {
        svc.detectionLocked = bloqueoPrevio === true;
        bloqueoPrevio = null;
    }
}

function overlay() {
    let el = document.getElementById("coach-overlay");
    if (el) return el;
    el = document.createElement("div");
    el.id = "coach-overlay";
    el.className = "coach-overlay";
    el.innerHTML = `
      <div class="coach-hole" id="coach-hole"></div>
      <div class="coach-box" id="coach-box">
        <p class="coach-text" id="coach-text"></p>
        <div class="coach-actions">
          <span class="coach-step" id="coach-step"></span>
          <button type="button" class="coach-btn ghost" onclick="globalThis.cierraTourEscaner()"></button>
          <button type="button" class="coach-btn" onclick="globalThis.avanzaTourEscaner()"></button>
        </div>
      </div>`;
    document.body.appendChild(el);
    return el;
}

function coloca(el, caja, hueco) {
    if (!el) {
        hueco.style.cssText = "display:none";
        caja.style.cssText = "top:50%;left:50%;transform:translate(-50%,-50%)";
        return;
    }
    const r = el.getBoundingClientRect();
    const pad = 6;
    hueco.style.cssText = `display:block;top:${r.top - pad}px;left:${r.left - pad}px;` +
        `width:${r.width + pad * 2}px;height:${r.height + pad * 2}px`;
    // 150px is the card height with two lines
    const debajo = r.bottom + 150 < globalThis.innerHeight;
    const top = debajo ? r.bottom + 12 : Math.max(8, r.top - 12);
    caja.style.cssText = `top:${top}px;left:12px;right:12px;` +
        (debajo ? "" : "transform:translateY(-100%)");
}

/** A hidden element measures 0×0 and the cutout jumped to the top left corner. */
function visible(el) {
    if (!el?.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
}

function pinta() {
    const t = textos();
    const el = overlay();
    // skip steps whose element is not on screen: inventory buttons only exist there and the HUD can be folded
    while (paso >= 0 && PASOS_TOUR[paso]?.id && !visible(document.getElementById(PASOS_TOUR[paso].id))) {
        paso = siguientePaso(paso);
    }
    const actual = paso >= 0 ? PASOS_TOUR[paso] : null;
    if (!actual) return cierraTourEscaner();

    const objetivo = actual.id ? document.getElementById(actual.id) : null;
    // no "smooth": the box is measured right after
    objetivo?.scrollIntoView?.({ block: "center" });
    coloca(objetivo, document.getElementById("coach-box"), document.getElementById("coach-hole"));

    const texto = document.getElementById("coach-text");
    if (texto) texto.innerText = t.pasos?.[actual.clave] || "";
    const cuenta = document.getElementById("coach-step");
    if (cuenta) cuenta.innerText = `${paso + 1}/${PASOS_TOUR.length}`;

    const botones = el.querySelectorAll(".coach-btn");
    if (botones[0]) botones[0].innerText = t.saltar || "Skip";
    if (botones[1]) botones[1].innerText = siguientePaso(paso) === -1 ? (t.hecho || "Done") : (t.siguiente || "Next");
    el.style.display = "block";
}

/**
 * The HUD is what the tour explains, so it opens even before any screen is recognized; restored on close.
 */
let hudPrevio = null;
function abreHud(abrir) {
    const hud = document.getElementById("inv-hud");
    if (!hud) return;
    if (abrir) {
        hudPrevio = hud.style.display;
        hud.style.display = "block";
    } else {
        hud.style.display = hudPrevio ?? "";
        hudPrevio = null;
    }
}

export function abreTourEscaner() {
    paso = 0;
    pausaEscaner(true);
    abreHud(true);
    pinta();
}

export function avanzaTourEscaner() {
    const siguiente = siguientePaso(paso);
    if (siguiente === -1) return cierraTourEscaner();
    paso = siguiente;
    pinta();
}

export function cierraTourEscaner() {
    paso = -1;
    pausaEscaner(false);
    abreHud(false);
    const el = document.getElementById("coach-overlay");
    if (el) el.style.display = "none";
}

/**
 * Called by ScannerHUD.updateContext, which only fires when the context changes.
 */
export function avisaContexto(contextType) {
    if (!tocaAvisar(contextType, state.settings?.scannerCoach !== false)) return;
    marcaVisto(contextType);
    const t = textos();
    const pista = t.pistas?.[contextType];
    if (!pista) return;
    const toast = showToast(pista, { type: "info", tag: "coach" });
    if (!toast) return;
    const ver = document.createElement("button");
    ver.className = "toast-action";
    ver.textContent = t.verTutorial || "Tutorial";
    ver.onclick = () => abreTourEscaner();
    toast.appendChild(ver);
}

export function reiniciaTutorialEscaner() {
    olvidaVistos();
    abreTourEscaner();
}

exposeGlobals({
    abreTourEscaner, avanzaTourEscaner, cierraTourEscaner, reiniciaTutorialEscaner,
}, "ui.components/ui_scanner_coach.js");
