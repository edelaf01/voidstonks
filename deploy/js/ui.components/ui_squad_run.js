import { state } from "../state.js";
import { TEXTS } from "../config.js";
import { escapeHTML } from "../utils/escape_html.js";
import { SquadService } from "../services/scanner/squad.service.js";
import { ScannerHUD } from "./ui_scanner_hud.js";
import { exposeGlobals } from "../utils/global_registry.js";

/**
 * RUN panel of the scanner HUD: what the squad carries and what can drop. Filled from
 * services/scanner/squad.service.js, which cannot touch the DOM and reports through `onUpdate`.
 */

const REF_KEY = { radiant: "rad", flawless: "flawless", exceptional: "exceptional", intact: "intact" };

const plat = (n) => `${Math.round(n)}<span class="plat-icon-inline"></span>`;

/**
 * Two players with the same relic and refinement are one ×2 row: the drop table below is the same.
 */
function agrupaRelics(relics) {
    const grupos = new Map();
    for (const r of relics || []) {
        const clave = `${r?.name}|${r?.refinement || "intact"}`;
        const previo = grupos.get(clave);
        if (previo) previo.copias += 1;
        else grupos.set(clave, { ...r, copias: 1 });
    }
    return [...grupos.values()];
}

function relicRow(relic, t) {
    // a relic missing from the database skips squadRunOutlook and arrives unnormalized
    const key = REF_KEY[relic.refinement] || "intact";
    const ref = t.refs?.[key] || key;
    const title = relic.assumedRefinement ? ` title="${escapeHTML(t.scannerHUD.squadAssumed)}"` : "";
    const copias = relic.copias > 1 ? `<span class="squad-relic-x">×${relic.copias}</span>` : "";
    return `<div class="squad-relic">
      <span class="squad-relic-name">${escapeHTML(relic.name)}</span>${copias}
      <span class="squad-relic-ref is-${escapeHTML(relic.refinement || "intact")}"${title}>${escapeHTML(ref)}${relic.assumedRefinement ? "?" : ""}</span>
      <span class="squad-relic-ev" title="${escapeHTML(t.scannerHUD.squadRelicEV)}">${relic.ev > 0 ? plat(relic.ev) : "-"}</span>
    </div>`;
}

function dropRow(drop, t) {
    const sh = t.scannerHUD;
    // `help` only arrives when the part is missing (setHelpOf returns null if owned)
    const tag = !drop.help ? ""
        : drop.help.left === 0
            ? `<span class="squad-tag is-closes">${escapeHTML(sh.squadCloses)}</span>`
            : `<span class="squad-tag">${escapeHTML(sh.squadMissing)} · ${escapeHTML(sh.squadLeft)} ${drop.help.left}</span>`;
    return `<div class="squad-drop${drop.help ? " is-missing" : ""}">
      <span class="squad-drop-name">${escapeHTML(drop.name)}</span>
      ${tag}
      <span class="squad-drop-chance">${(drop.chance * 100).toFixed(0)}%</span>
      <span class="squad-drop-plat">${drop.plat > 0 ? plat(drop.plat) : "-"}</span>
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

    // ScannerHUD.updateContext already ran this frame, before the run existed: without this the panel waits
    // for the next frame, up to 3 s in a mission
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
      <div class="squad-relics">${agrupaRelics(run.relics).map((r) => relicRow(r, t)).join("")}</div>
      ${run.drops?.length
        ? `<div class="squad-drops-label">${escapeHTML(sh.squadDrops)}</div>
           <div class="squad-drops">${run.drops.map((d) => dropRow(d, t)).join("")}</div>`
        : ""}
    `;
}

SquadService.onUpdate = renderSquadRun;

// the HUD DIAG button shows what the OCR reads; the dump only runs with the panel open (toDataURL on ~2 MP)
SquadService.onDebugFrame = (canvas) => {
    if (ScannerHUD.isDebugOpen()) ScannerHUD.updateDebugSnapshot(canvas.toDataURL("image/webp"));
};

exposeGlobals({ renderSquadRun }, "ui.components/ui_squad_run.js");
