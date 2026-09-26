import { state } from "../state.js";
import { TEXTS } from "../config.js";
import { showToast } from "./ui_components.js";
import { exposeGlobals } from "../utils/global_registry.js";
import { PASOS_TOUR, siguientePaso, tocaAvisar, marcaVisto, olvidaVistos } from "../utils/scanner_coach.js";

/**
 * El tutorial del escáner: un aviso de una línea la primera vez que aparece cada pantalla, y un
 * recorrido guiado que oscurece todo y va resaltando el HUD paso a paso.
 *
 * Decide y persiste utils/scanner_coach.js; aquí solo se pinta.
 */

let paso = -1;
const textos = () => (TEXTS[state.currentLang] || TEXTS.en).scannerCoach || {};

// Con su propio interruptor y no con `detectionLocked`: restaurar el valor de ese al cerrar dejaba
// el escáner parado para siempre si el modal de recompensas se había cerrado mientras tanto.
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

/** Coloca el recorte sobre el elemento del paso y la ficha justo debajo (o encima si no cabe). */
function coloca(el, caja, hueco) {
    if (!el) {
        // Paso de bienvenida: sin recorte y la ficha centrada.
        hueco.style.cssText = "display:none";
        caja.style.cssText = "top:50%;left:50%;transform:translate(-50%,-50%)";
        return;
    }
    const r = el.getBoundingClientRect();
    const pad = 6;
    hueco.style.cssText = `display:block;top:${r.top - pad}px;left:${r.left - pad}px;` +
        `width:${r.width + pad * 2}px;height:${r.height + pad * 2}px`;
    // Debajo si hay sitio; si no, encima. 150px es lo que ocupa la ficha con dos líneas.
    const debajo = r.bottom + 150 < globalThis.innerHeight;
    const top = debajo ? r.bottom + 12 : Math.max(8, r.top - 12);
    caja.style.cssText = `top:${top}px;left:12px;right:12px;` +
        (debajo ? "" : "transform:translateY(-100%)");
}

/** Un elemento oculto mide 0×0, y el recorte se iba a la esquina superior izquierda. */
function visible(el) {
    if (!el?.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
}

function pinta() {
    const t = textos();
    const el = overlay();
    // Se saltan los pasos cuyo elemento no está en pantalla: los botones de inventario no
    // existen en las demás pantallas y el HUD puede estar plegado.
    while (paso >= 0 && PASOS_TOUR[paso]?.id && !visible(document.getElementById(PASOS_TOUR[paso].id))) {
        paso = siguientePaso(paso);
    }
    const actual = paso >= 0 ? PASOS_TOUR[paso] : null;
    if (!actual) return cierraTourEscaner();

    const objetivo = actual.id ? document.getElementById(actual.id) : null;
    // Sin "smooth": la caja se mide justo después, y con animación se mediría a medio camino.
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
 * El HUD ES el tema del tour, así que se abre para explicarlo aunque el escáner no haya
 * reconocido ninguna pantalla todavía. Se restaura al cerrar, como el bloqueo.
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

/** Abre el recorrido guiado desde el principio. */
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
 * El aviso de una línea, la primera vez que se ve cada pantalla. Lo llama ScannerHUD.updateContext,
 * que ya solo dispara cuando el contexto CAMBIA.
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

/** Lo llama el botón del HUD: vuelve a enseñar los avisos y abre el recorrido. */
export function reiniciaTutorialEscaner() {
    olvidaVistos();
    abreTourEscaner();
}

exposeGlobals({
    abreTourEscaner, avanzaTourEscaner, cierraTourEscaner, reiniciaTutorialEscaner,
}, "ui.components/ui_scanner_coach.js");
