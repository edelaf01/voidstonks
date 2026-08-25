import { state } from "../state.js";
import { TEXTS } from "../config.js";
import { exposeGlobals } from "../utils/global_registry.js";

/**
 * Component for the Scanner HUD (status badges, counters, scroll guides).
 */
export const ScannerHUD = {
    updateContext(contextType) {
        const sh = TEXTS[state.currentLang].scannerHUD;
        const hud = document.getElementById("inv-hud");
        const badge = document.getElementById("hud-context-badge");

        // The VOIDSCANNER inventory HUD is only for item scanning. The mod/riven context
        // (INVENTORY_MODS) uses the separate riven appraisal HUD, so keep this one hidden there.
        if (contextType === "INVENTORY") {
            if (hud) hud.style.display = "block";
            this.setUIBadge(badge, sh.statusInventory, "#f1c40f", "rgba(241,196,15,0.4)", "rgba(241,196,15,0.1)");
            const msgEl = document.getElementById("live-inv-msg");
            if (msgEl) msgEl.innerText = sh.statusIdle;
        } else if (state.squadRun) {
            // El panel del run vive DENTRO de este HUD, y esta función corre en cada frame:
            // durante una misión el contexto es UNKNOWN, así que sin esta rama el HUD se
            // volvía a esconder al frame siguiente de leer las reliquias del squad y el
            // panel no llegaba a verse nunca.
            if (hud) hud.style.display = "block";
            this.setUIBadge(badge, sh.statusSquad, "#00e5ff", "rgba(0,229,255,0.4)", "rgba(0,229,255,0.1)");
        } else {
            if (hud) hud.style.display = "none";
            if (contextType === "INVENTORY_MODS") {
                this.setUIBadge(badge, "MODS", "#d060ff", "rgba(208,96,255,0.4)", "rgba(208,96,255,0.1)");
            } else if (contextType === "RELICS") {
                this.setUIBadge(badge, sh.statusRelics, "#00e5ff", "rgba(0,229,255,0.3)", "rgba(0,229,255,0.1)");
            } else if (contextType === "REWARD") {
                this.setUIBadge(badge, sh.statusReward, "#a0ff80", "rgba(160,255,128,0.3)", "rgba(160,255,128,0.08)");
            }
        }
    },

    setUIBadge(badgeElement, text, color, borderColor, background) {
        if (!badgeElement) return;
        badgeElement.textContent = text;
        badgeElement.style.color = color;
        badgeElement.style.borderColor = borderColor;
        badgeElement.style.background = background;
    },

    updateFrameCounter(count) {
        const counter = document.getElementById("hud-scan-counter");
        if (!counter) return;
        const lbl = TEXTS[state.currentLang]?.scannerHUD?.lblFrame || "FRAME";
        counter.textContent = count > 0 ? `${lbl} ${count}` : "";
    },

    /** ¿Está abierto el panel de debug? Quien produzca imágenes caras debe preguntarlo antes. */
    isDebugOpen() {
        return document.getElementById("live-debug-snapshot")?.style.display === "block";
    },

    updateDebugSnapshot(dataUrl) {
        const img = document.getElementById("live-debug-snapshot-img");
        if (img) {
            img.src = dataUrl;
            img.style.display = "block";
        }
    },

    // ── Historial de escaneos de debug ──────────────────────────────────────
    // history = ScannerService.debugHistory (más reciente primero). Cada nuevo
    // escaneo selecciona automáticamente la entrada 0; clicar una miniatura fija
    // esa entrada (imagen grande + summary) y COPY LOG copia SU log.
    debugSelectedIndex: 0,

    updateDebugHistory(history) {
        this.debugSelectedIndex = 0;
        this._renderDebugHistory(history);
        this.selectDebugEntry(history, 0);
    },

    _renderDebugHistory(history) {
        const strip = document.getElementById("live-debug-history");
        if (!strip) return;
        strip.innerHTML = "";
        history.forEach((entry, i) => {
            // Las entradas grabadas con el panel cerrado no llevan imagen (ver el porqué en
            // scanner.service.js): sin esto el <img> se quedaba con src="null".
            if (!entry.img) return;
            const th = document.createElement("img");
            th.src = entry.img;
            th.title = `[${entry.time}] ${entry.summary}`;
            th.style.cssText =
                "width:64px;height:36px;object-fit:cover;border-radius:3px;cursor:pointer;flex-shrink:0;" +
                `border:1px solid ${entry.warning ? "rgba(255,30,80,0.85)" : "rgba(0,229,255,0.35)"};` +
                (i === this.debugSelectedIndex ? "outline:2px solid #f1c40f;" : "");
            th.addEventListener("click", () => {
                this.debugSelectedIndex = i;
                this._renderDebugHistory(history);
                this.selectDebugEntry(history, i);
            });
            strip.appendChild(th);
        });
    },

    selectDebugEntry(history, i) {
        const entry = history[i];
        if (!entry?.img) return;
        this.updateDebugSnapshot(entry.img);
        const sum = document.getElementById("live-debug-summary");
        if (sum) {
            sum.textContent = `[${entry.time}] ${entry.summary}`;
            sum.style.color = entry.warning ? "#ff5252" : "#8ca0b8";
        }
    },

    updateScrollStatus(status, count = 0) {
        const scrollGuide = document.getElementById("live-scroll-guide");
        if (!scrollGuide) return;
        const sh = TEXTS[state.currentLang]?.scannerHUD;

        if (status === "detected") {
            scrollGuide.innerHTML = `<div style="color:#f1c40f;font-weight:800;font-size:1.25em;letter-spacing:0.3px;">${sh.autoScanDetected}</div><div style="color:#607590;font-size:0.95em;margin-top:5px;">${sh.autoScanDetectedDesc}</div>`;
        } else if (status === "scanning") {
            scrollGuide.innerHTML = `<div style="color:#00e5ff;font-weight:800;font-size:1.25em;letter-spacing:0.3px;">${sh.autoScanScanning}</div><div style="color:#607590;font-size:0.95em;margin-top:5px;">${sh.autoScanScanningDesc}</div>`;
        } else if (status === "done") {
            const doneDesc = sh.autoScanDoneDesc.replace("{count}", count);
            scrollGuide.innerHTML = `<div style="color:#00ff78;font-weight:800;font-size:1.25em;letter-spacing:0.3px;">${sh.autoScanDone}</div><div style="color:#607590;font-size:0.95em;margin-top:5px;">${doneDesc}</div>`;
        }
    },

    // sessionRelics es opcional (Map relicName->qty) — reliquias detectadas en el mismo grid
    // de inventario vía el fallback de OCRService.getRelicMatch. Se pintan aparte (acento cian)
    // porque se persisten en un sitio distinto (state.inventory, no primeInventory).
    updateDetectedItems(sessionInventory, sessionRelics = null) {
        const listContainer = document.getElementById("live-inventory-items-list");
        const countEl = document.getElementById("live-inv-count");
        const hud = document.getElementById("inv-hud");
        const sh = TEXTS[state.currentLang]?.scannerHUD;

        const relicCount = sessionRelics ? sessionRelics.size : 0;
        const totalCount = sessionInventory.size + relicCount;

        if (countEl) countEl.innerText = totalCount;
        if (!listContainer) return;

        if (totalCount > 0 && hud && hud.style.display === "none") {
            hud.style.display = "block";
        }

        if (relicCount > sessionInventory.size) {
            const badge = document.getElementById("hud-context-badge");
            this.setUIBadge(badge, sh?.statusRelics || "RELIQUIAS", "#00e5ff", "rgba(0,229,255,0.4)", "rgba(0,229,255,0.1)");
        }
        const items = Array.from(sessionInventory.entries()).map(([name, qty]) => ({ name, qty }));
        items.sort((a, b) => a.name.localeCompare(b.name));

        if (items.length === 0 && relicCount === 0) {
            listContainer.innerHTML = `<div style="text-align:center;color:#444;font-size:0.75em;padding:20px 0;">${sh?.lblEmpty || "PRESS SCAN TO START"}</div>`;
            return;
        }

        let html = items.map(item => {
            const shortName = item.name.replace(/PRIME/gi, "").trim();
            return `
                <div style="display:flex;justify-content:space-between;align-items:center;
                    background:rgba(0,229,255,0.04);padding:5px 8px;border-radius:4px;
                    border-left:2px solid rgba(0,229,255,0.4);
                    font-size:0.78em;gap:6px;">
                    <span style="color:#ddd;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:190px;">${shortName}</span>
                    <span style="color:#f1c40f;font-weight:900;flex-shrink:0;">×${item.qty}</span>
                </div>
            `;
        }).join("");

        if (relicCount > 0) {
            const relicItems = Array.from(sessionRelics.entries()).map(([name, qty]) => ({ name, qty }));
            relicItems.sort((a, b) => a.name.localeCompare(b.name));

            html += `<div style="margin-top:8px;padding-top:6px;border-top:1px dashed rgba(0,229,255,0.25);
                    color:#00e5ff;font-weight:800;font-size:0.72em;letter-spacing:0.5px;">${sh?.lblRelicsDetected || "RELICS"}</div>`;

            html += relicItems.map(item => `
                <div style="display:flex;justify-content:space-between;align-items:center;
                    background:rgba(0,229,255,0.06);padding:5px 8px;border-radius:4px;
                    border-left:2px solid rgba(0,229,255,0.7);
                    font-size:0.78em;gap:6px;">
                    <span style="color:#ddd;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:190px;">${item.name}</span>
                    <span style="color:#00e5ff;font-weight:900;flex-shrink:0;">×${item.qty}</span>
                </div>
            `).join("");
        }

        listContainer.innerHTML = html;
    }
};

/**
 * Pliega/despliega el cuerpo del HUD. Antes era una IIFE de ocho líneas dentro del
 * onclick del propio botón, así que ni el lint ni los tests la veían.
 */
export function toggleScannerHud() {
    const body = document.getElementById("inv-hud-body");
    const btn = document.getElementById("hud-collapse-btn");
    if (!body) return;
    const open = body.style.display === "none";
    body.style.display = open ? "flex" : "none";
    if (btn) {
        btn.textContent = open ? "▾" : "▸";
        btn.setAttribute("aria-expanded", String(open));
    }
}

exposeGlobals({ toggleScannerHud }, "ui.components/ui_scanner_hud.js");
