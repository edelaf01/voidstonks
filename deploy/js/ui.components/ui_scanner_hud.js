import { state } from "../state.js";
import { TEXTS } from "../config.js";

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
        if (counter) counter.textContent = count > 0 ? `FRAME ${count}` : "";
    },

    updateDebugSnapshot(dataUrl) {
        const img = document.getElementById("live-debug-snapshot-img");
        if (img) {
            img.src = dataUrl;
            img.style.display = "block";
        }
    },

    updateScrollStatus(status, count = 0) {
        const scrollGuide = document.getElementById("live-scroll-guide");
        if (!scrollGuide) return;
        const sh = TEXTS[state.currentLang]?.scannerHUD;

        if (status === "detected") {
            scrollGuide.innerHTML = `<div style="color:#f1c40f;font-weight:800;font-size:0.82em;">${sh.autoScanDetected}</div><div style="color:#506070;font-size:0.75em;margin-top:3px;">${sh.autoScanDetectedDesc}</div>`;
        } else if (status === "scanning") {
            scrollGuide.innerHTML = `<div style="color:#00e5ff;font-weight:800;font-size:0.82em;">${sh.autoScanScanning}</div><div style="color:#506070;font-size:0.75em;margin-top:3px;">${sh.autoScanScanningDesc}</div>`;
        } else if (status === "done") {
            const doneDesc = sh.autoScanDoneDesc.replace("{count}", count);
            scrollGuide.innerHTML = `<div style="color:#00ff78;font-weight:800;font-size:0.82em;">${sh.autoScanDone}</div><div style="color:#506070;font-size:0.75em;margin-top:3px;">${doneDesc}</div>`;
        }
    },

    updateDetectedItems(sessionInventory) {
        const listContainer = document.getElementById("live-inventory-items-list");
        const countEl = document.getElementById("live-inv-count");
        const hud = document.getElementById("inv-hud");

        if (countEl) countEl.innerText = sessionInventory.size;
        if (!listContainer) return;

        if (sessionInventory.size > 0 && hud && hud.style.display === "none") {
            hud.style.display = "block";
        }
        const items = Array.from(sessionInventory.entries()).map(([name, qty]) => ({ name, qty }));
        items.sort((a, b) => a.name.localeCompare(b.name));

        if (items.length === 0) {
            const sh = TEXTS[state.currentLang]?.scannerHUD;
            listContainer.innerHTML = `<div style="text-align:center;color:#444;font-size:0.75em;padding:20px 0;">${sh?.lblEmpty || "PRESS SCAN TO START"}</div>`;
            return;
        }

        listContainer.innerHTML = items.map(item => {
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
    }
};
