import { state } from "../state.js";
import { TEXTS } from "../config.js";
import { showToast } from "./ui_components.js";
import { exposeGlobals } from "../utils/global_registry.js";
import { PASOS_TOUR, siguientePaso, tocaAvisar, marcaVisto, olvidaVistos } from "../utils/scanner_coach.js";

let paso = -1;
const textos = () => (TEXTS[state.currentLang] || TEXTS.en).scannerCoach || {};

// own switch, not detectionLocked: restoring that on close left the scanner stopped
function pausaEscaner(pausar) {
    if (globalThis.ScannerService) globalThis.ScannerService.pausado = pausar;
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
    const debajo = r.bottom + 150 < globalThis.innerHeight;
    const top = debajo ? r.bottom + 12 : Math.max(8, r.top - 12);
    caja.style.cssText = `top:${top}px;left:12px;right:12px;` +
        (debajo ? "" : "transform:translateY(-100%)");
}

function visible(el) {
    if (!el?.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
}

function pinta() {
    const t = textos();
    const el = overlay();
    while (paso >= 0 && PASOS_TOUR[paso]?.id && !visible(document.getElementById(PASOS_TOUR[paso].id))) {
        paso = siguientePaso(paso);
    }
    const actual = paso >= 0 ? PASOS_TOUR[paso] : null;
    if (!actual) return cierraTourEscaner();

    const objetivo = actual.id ? document.getElementById(actual.id) : null;
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
