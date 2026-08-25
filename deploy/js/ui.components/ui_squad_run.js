import { state } from "../state.js";
import { TEXTS } from "../config.js";
import { escapeHTML } from "../utils/escape_html.js";
import { SquadService } from "../services/scanner/squad.service.js";
import { ScannerHUD } from "./ui_scanner_hud.js";
import { exposeGlobals } from "../utils/global_registry.js";

/**
 * El panel "RUN ACTUAL" del HUD del escáner: qué lleva la escuadra y qué puede caer.
 *
 * Se rellena solo, desde services/scanner/squad.service.js — el servicio no puede tocar
 * el DOM, así que avisa por `onUpdate` y quien pinta es esto.
 */

const REF_KEY = { radiant: "rad", flawless: "flawless", exceptional: "exceptional", intact: "intact" };

const plat = (n) => `${Math.round(n)}<span class="plat-icon-inline"></span>`;

function relicRow(relic, t) {
    // Una reliquia que no está en la base de datos no pasa por squadRunOutlook, así que
    // llega sin normalizar: sin este respaldo el chip salía vacío.
    const key = REF_KEY[relic.refinement] || "intact";
    const ref = t.refs?.[key] || key;
    const title = relic.assumedRefinement ? ` title="${escapeHTML(t.scannerHUD.squadAssumed)}"` : "";
    return `<div class="squad-relic">
      <span class="squad-relic-name">${escapeHTML(relic.name)}</span>
      <span class="squad-relic-ref is-${escapeHTML(relic.refinement || "intact")}"${title}>${escapeHTML(ref)}${relic.assumedRefinement ? "?" : ""}</span>
      <span class="squad-relic-ev" title="${escapeHTML(t.scannerHUD.squadRelicEV)}">${relic.ev > 0 ? plat(relic.ev) : "—"}</span>
    </div>`;
}

function dropRow(drop, t) {
    const sh = t.scannerHUD;
    // `help` solo llega cuando la pieza te FALTA (setHelpOf devuelve null si ya la tienes):
    // por eso la etiqueta puede afirmar "te falta" sin volver a comprobar el inventario.
    const tag = !drop.help ? ""
        : drop.help.left === 0
            ? `<span class="squad-tag is-closes">${escapeHTML(sh.squadCloses)}</span>`
            : `<span class="squad-tag">${escapeHTML(sh.squadMissing)} · ${escapeHTML(sh.squadLeft)} ${drop.help.left}</span>`;
    return `<div class="squad-drop${drop.help ? " is-missing" : ""}">
      <span class="squad-drop-name">${escapeHTML(drop.name)}</span>
      ${tag}
      <span class="squad-drop-chance">${(drop.chance * 100).toFixed(0)}%</span>
      <span class="squad-drop-plat">${drop.plat > 0 ? plat(drop.plat) : "—"}</span>
    </div>`;
}

export function renderSquadRun(run = state.squadRun) {
    const panel = document.getElementById("squad-run-panel");
    if (!panel) return;
    if (!run?.relics?.length) {
        panel.style.display = "none";
        panel.innerHTML = "";
        return;
    }

    // ScannerHUD.updateContext ya corrió en ESTE frame, cuando todavía no había run: sin
    // abrirlo aquí el panel no aparecería hasta el frame siguiente, que en misión llega
    // hasta 3 s después.
    const hud = document.getElementById("inv-hud");
    if (hud) hud.style.display = "block";

    const t = TEXTS[state.currentLang] || TEXTS.en;
    const sh = t.scannerHUD;
    const n = run.relics.length;
    const countLabel = n === 1 ? sh.squadRelicCount : sh.squadRelicsCount;

    panel.style.display = "block";
    panel.innerHTML = `
      <div class="squad-head">
        <span class="squad-title">${escapeHTML(sh.squadTitle)}</span>
        <span class="squad-count">${n} ${escapeHTML(countLabel)}</span>
        ${run.runEV > 0
        ? `<span class="squad-ev" title="${escapeHTML(sh.squadRunEV)}">~${plat(run.runEV)}</span>`
        : ""}
      </div>
      <div class="squad-relics">${run.relics.map((r) => relicRow(r, t)).join("")}</div>
      ${run.drops?.length
        ? `<div class="squad-drops-label">${escapeHTML(sh.squadDrops)}</div>
           <div class="squad-drops">${run.drops.map((d) => dropRow(d, t)).join("")}</div>`
        : ""}
    `;
}

SquadService.onUpdate = renderSquadRun;

// El botón DIAG del HUD enseña "lo que lee el OCR". El volcado solo se paga con el panel
// abierto: toDataURL sobre la franja son ~2 MP.
SquadService.onDebugFrame = (canvas) => {
    if (ScannerHUD.isDebugOpen()) ScannerHUD.updateDebugSnapshot(canvas.toDataURL("image/webp"));
};

exposeGlobals({ renderSquadRun }, "ui.components/ui_squad_run.js");
