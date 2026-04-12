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

        if (contextType === "INVENTORY") {
            if (hud) hud.style.display = "block";
            this.setUIBadge(badge, sh.statusInventory, "#f1c40f", "rgba(241,196,15,0.4)", "rgba(241,196,15,0.1)");
            
            const msgEl = document.getElementById("live-inv-msg");
            if (msgEl) msgEl.innerText = sh.statusIdle;
        } else {
            if (hud) hud.style.display = "none";
            if (contextType === "RELICS") {
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
    }
};
