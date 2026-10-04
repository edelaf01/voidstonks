import { state } from "../state.js";
import { TEXTS } from "../config.js";
import { escapeHTML } from "../utils/escape_html.js";
import { SquadService } from "../services/scanner/squad.service.js";
import { ScannerHUD } from "./ui_scanner_hud.js";
import { exposeGlobals } from "../utils/global_registry.js";

const REF_KEY = { radiant: "rad", flawless: "flawless", exceptional: "exceptional", intact: "intact" };

const plat = (n) => `${Math.round(n)}<span class="plat-icon-inline"></span>`;

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

    // without this the panel waits up to 3 s in a mission for the next frame
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

SquadService.onDebugFrame = (canvas) => {
    if (ScannerHUD.isDebugOpen()) ScannerHUD.updateDebugSnapshot(canvas.toDataURL("image/webp"));
};

exposeGlobals({ renderSquadRun }, "ui.components/ui_squad_run.js");
