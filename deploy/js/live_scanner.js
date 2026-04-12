import { state, saveAppState } from "./state.js";
import { showToast } from "./ui.components/ui_components.js";
import { TEXTS } from "./config.js";
import { ScannerService } from "./services/scanner.service.js";

let DEBUG_MODE = false;

globalThis.toggleScannerDebug = () => {
    DEBUG_MODE = !DEBUG_MODE;
    const btn = document.getElementById("btn-debug-toggle");
    if (btn) btn.classList.toggle("active", DEBUG_MODE);
    const dbgPanel = document.getElementById("live-debug-snapshot");
    if (dbgPanel) dbgPanel.style.display = DEBUG_MODE ? "block" : "none";
    
    showToast(DEBUG_MODE ? "Debug mode ON" : "Debug mode OFF");
};

let liveStream = null;
let isStartingSession = false;

export async function startLiveSession() {
    if (isStartingSession || liveStream?.active) return;
    isStartingSession = true;

    const toggleBtn = document.getElementById("scanner-toggle");
    const t = TEXTS[state.currentLang].scanner;

    if (toggleBtn) {
        toggleBtn.classList.add("active");
        toggleBtn.querySelector(".label").innerText = t.starting;
    }

    try {
        liveStream = await navigator.mediaDevices.getDisplayMedia({
            video: { cursor: "never", displaySurface: "window", frameRate: { ideal: 10, max: 15 } },
            audio: false,
        });

        const video = document.getElementById("live-video");
        video.srcObject = liveStream;
        await video.play();

        const drawer = document.getElementById("scanner-drawer");
        if (drawer) {
            drawer.classList.remove("closed");
            drawer.classList.add("open");
        }

        await ScannerService.start();
        showToast(t.toastActive);
        
        if (toggleBtn) toggleBtn.querySelector(".label").innerText = t.active;

        liveStream.getVideoTracks()[0].onended = () => stopLiveSession();
    } catch (e) {
        console.error("Scanner startup failed:", e);
        showToast("Error: " + e.message);
        stopLiveSession();
    } finally {
        isStartingSession = false;
    }
}

export function stopLiveSession() {
    if (liveStream) {
        liveStream.getTracks().forEach((track) => track.stop());
        liveStream = null;
    }
    ScannerService.stop();
    const toggleBtn = document.getElementById("scanner-toggle");
    if (toggleBtn) {
        toggleBtn.classList.remove("active");
        const label = toggleBtn.querySelector(".label");
        if (label) label.innerText = "LIVE SCANNER"; 
    }
    const drawer = document.getElementById("scanner-drawer");
    if (drawer) {
        drawer.classList.remove("open");
        drawer.classList.add("closed");
    }
}

globalThis.showTrackConfirm = (relicName) => {
    const t = TEXTS[state.currentLang].scanner;
    showToast(`${t.relicDetected}: ${relicName}`, {
        action: {
            text: t.track,
            callback: () => {
                if (globalThis.trackRelic) globalThis.trackRelic(relicName);
                showToast(t.trackingToast.replace("{relic}", relicName));
            }
        }
    });
};

globalThis.selectRewardToInventory = (itemName) => {
    state.primeInventory[itemName] = (state.primeInventory[itemName] || 0) + 1;
    saveAppState();
    
    const t = TEXTS[state.currentLang].rewardScanner;
    showToast(`${t.toastAdded || "Added to inventory"}: ${itemName}`);
    
    if (globalThis.renderInventory) globalThis.renderInventory();
};

globalThis.saveLiveInventory = () => {
    const sh = TEXTS[state.currentLang].scannerHUD;
    for (const [name, count] of ScannerService.sessionInventory) {
        state.primeInventory[name] = count;
    }
    ScannerService.sessionInventory.clear();
    showToast(sh.saved);
    saveAppState();
    
    if (globalThis.renderInventory) globalThis.renderInventory();
};

globalThis.startLiveSession = startLiveSession;
globalThis.stopLiveSession = stopLiveSession;
globalThis.toggleScanner = () => {
    if (liveStream?.active) stopLiveSession();
    else startLiveSession();
};