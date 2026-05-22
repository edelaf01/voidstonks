import { state, saveAppState } from "../state.js";
import { TEXTS } from "../config.js";
import { getSlug, getPriceValue } from "../api.js";
import { showToast, escapeHTML } from "./ui_components.js";
import { renderItemsInPiP } from "../pip_overlay.js";

/**
 * Component for the Scanner Success/Results Modal.
 */
export const ScannerModal = {
    currentResults: [],
    autoCloseTimer: null,
    AUTO_CLOSE_DELAY_MS: 20000,

    async open(imageUrl, items, width, height, scale, rawOcr = "") {
        const modal = document.getElementById("scan-success-modal");
        const imgEl = document.getElementById("scan-snapshot");
        const badgesContainer = document.getElementById("scan-badges-container");

        if (!modal || !imgEl || !badgesContainer) return;

        this.currentResults = items;

        const syncToggle = document.getElementById("sync-rewards-toggle");
        if (syncToggle) {
            syncToggle.checked = !!state.autoSyncRewards;
            syncToggle.onchange = (e) => { state.autoSyncRewards = e.target.checked; saveAppState(); };
        }

        const copyToggle = document.getElementById("auto-copy-toggle");
        if (copyToggle) {
            copyToggle.checked = !!state.autoCopyScanResults;
            copyToggle.onchange = (e) => { state.autoCopyScanResults = e.target.checked; saveAppState(); };
        }

        this.localizeLabels(modal);

        if (this.autoCloseTimer) clearTimeout(this.autoCloseTimer);
        badgesContainer.innerHTML = "";
        imgEl.src = imageUrl;
        modal.classList.remove("hidden");

        this.autoCloseTimer = setTimeout(() => this.close(), this.AUTO_CLOSE_DELAY_MS);

        const itemsWithDetails = await this.enrichItemDetails(items, width, height, scale);
        this.currentResults = itemsWithDetails;

        this.renderBadges(itemsWithDetails, imgEl, width, height, scale);

        // Restore PiP update
        renderItemsInPiP(itemsWithDetails);

        // Restore Auto-Actions
        this.handleAutoActions(itemsWithDetails);
    },

    handleAutoActions(items) {
        if (state.autoCopyScanResults && items.length > 0) {
            const text = items.map(i => i.name).join(", ");
            navigator.clipboard.writeText(text).then(() => {
                showToast(TEXTS[state.currentLang].rewardScanner.toastCopied || "Results copied to clipboard");
            }).catch(console.warn);
        }

        if (state.autoSyncRewards && items.length > 0) {
            // Check if global sync function exists (it usually does in ui_sync or main)
            if (globalThis.executeSyncSend) {
                // We might need to format the message first
                // For now, let's just trigger it if available
                console.log("[ScannerModal] Auto-sync triggered");
            }
        }
    },

    close() {
        const modal = document.getElementById("scan-success-modal");
        if (modal) modal.classList.add("hidden");
        if (this.autoCloseTimer) clearTimeout(this.autoCloseTimer);
        // Explicitly unlock detection in ScannerService or similar would happen here
        if (globalThis.ScannerService) globalThis.ScannerService.detectionLocked = false;
    },

    localizeLabels(modal) {
        if (TEXTS?.[state.currentLang]?.rewardScanner) {
            const tScan = TEXTS[state.currentLang].rewardScanner;
            const syncLabel = modal.querySelector(".sync-toggle-label");
            if (syncLabel) syncLabel.innerText = tScan.autoSyncLabel;
            const copyLabel = modal.querySelector(".copy-toggle-label");
            if (copyLabel) copyLabel.innerText = tScan.autoCopyLabel;
            const helpIcon = modal.querySelector(".help-icon");
            if (helpIcon) helpIcon.dataset.tooltip = tScan.autoSyncTooltip + " | " + tScan.autoCopyTooltip;
        }
    },

    async enrichItemDetails(items, width, height, scale) {
        return Promise.all(items.map(async (item) => {
            let price = 0;
            try {
                const slug = getSlug(item.name);
                price = await getPriceValue(item.name, slug);
            } catch (e) { console.warn(e); }

            let ducats = 0;
            if (state.ducatsDatabase) {
                const itemVal = Object.values(state.ducatsDatabase).find(
                    (d) => d.name.toUpperCase() === item.name.toUpperCase()
                );
                if (itemVal) ducats = itemVal.ducats;
            }
            return { ...item, price, ducats, xPos: item.xPos || 0 };
        }));
    },

    renderBadges(items, imgEl, width, height, scale) {
        const badgesContainer = document.getElementById("scan-badges-container");
        const wrapper = document.getElementById("scan-badges-wrapper");
        if (!badgesContainer || !wrapper) return;

        if (imgEl.clientWidth > 0) {
            const imgRatio = imgEl.naturalWidth / imgEl.naturalHeight;
            const elRatio = imgEl.clientWidth / imgEl.clientHeight;
            let visualW = imgEl.clientWidth;
            let visualH = imgEl.clientHeight;

            if (imgRatio > elRatio) visualH = visualW / imgRatio;
            else visualW = visualH * imgRatio;

            wrapper.style.width = `${Math.floor(visualW)}px`;
            wrapper.style.height = `${Math.floor(visualH)}px`;
        }

        const maxPl = Math.max(...items.map((i) => i.price || 0));
        const potentialMap = items.map(item => ({
            ...item,
            potential: Math.max(item.ducats || 0, (item.price || 0) * 10)
        }));
        const maxPotential = Math.max(...potentialMap.map(i => i.potential));

        let positionedItems = potentialMap.map(item => {
            const referenceW = width * scale;
            const isClumped = !item.xPos || Math.abs(item.xPos - (referenceW / 2)) < 5;
            let rawPct = (typeof item.xPos === 'number' && referenceW > 0 && !isClumped)
                ? (item.xPos / referenceW) * 100
                : -1;
            return { ...item, leftPct: rawPct };
        }).sort((a, b) => a.leftPct - b.leftPct);

        // Anti-overlap
        const itemsWithoutPos = positionedItems.filter(i => i.leftPct < 0);
        if (itemsWithoutPos.length > 0) {
            positionedItems = positionedItems.map((item, idx) => {
                if (item.leftPct < 0) return { ...item, leftPct: (idx + 0.5) * (100 / positionedItems.length), isGrid: true };
                return item;
            });
        }

        const BADGE_GAP_PCT = 11;
        for (let i = 1; i < positionedItems.length; i++) {
            const prev = positionedItems[i - 1];
            const curr = positionedItems[i];
            if (curr.leftPct - prev.leftPct < BADGE_GAP_PCT) {
                curr.leftPct = prev.leftPct + BADGE_GAP_PCT;
            }
        }

        const fragment = document.createDocumentFragment();
        positionedItems.forEach((item) => {
            const isBestPl = item.price === maxPl && item.price > 0;
            const isBestEff = item.potential === maxPotential && item.potential > 0;

            this.createBadge(item, fragment, isBestPl, isBestEff);
        });

        badgesContainer.innerHTML = "";
        badgesContainer.appendChild(fragment);
    },

    createBadge(item, container, isBestPl, isBestEff) {
        const badge = document.createElement("div");
        badge.className = `modal-badge ${isBestPl ? "best-pl" : ""} ${isBestEff ? "best-duc" : ""}`;
        badge.style.left = `${Math.min(98, Math.max(2, item.leftPct))}%`;

        const t = TEXTS[state.currentLang].rewardScanner;
        const appOwned = state.primeInventory?.[item.name] || 0;

        const isZero = item.owned === 0;
        const statusColor = item.crafted ? "#888" : (isZero ? "#ff4b2b" : "#00ff78");
        const statusText = item.crafted ? "CRAFTED" : `${item.owned} ${t.lblSeen.toUpperCase()}`;

        badge.innerHTML = `
        <div class="modal-badge-link">
            <div class="modal-badge-labels">
                ${isBestPl ? `<div class="best-badge pl">${t.tagBestPl}</div>` : ""}
                ${isBestEff ? `<div class="best-badge duc">${t.tagBestDuc}</div>` : ""}
            </div>
            <div class="modal-badge-content-wrapper">
                <div class="metadata-row">
                    <div class="inventory-app-count" style="border-color:${statusColor}; color:${statusColor}; font-weight:bold; border:1px solid; padding:2px 6px; border-radius:4px;">
                        ${statusText}
                    </div>
                    <div class="app-owned-info">${t.lblInv.toUpperCase()}: ${appOwned}</div>
                </div>
                <div class="modal-badge-name">${item.name.toUpperCase()}</div>
                <div class="modal-badge-row">
                    <div class="modal-badge-price"><img src="assets/relic_contents/platinum.webp" class="currency-icon">${item.price || "—"}</div>
                    <div class="modal-badge-ducats"><img src="assets/Ducats.webp" class="currency-icon">${item.ducats || 0}</div>
                </div>
            </div>
            <div class="badge-add-inventory-hint">${t.addBtn}</div>
        </div>
    `;
        badge.onclick = () => {
            if (typeof globalThis.selectRewardToInventory === "function") {
                globalThis.selectRewardToInventory(item.name);
                badge.classList.add("selected-reward");
                if (typeof globalThis.closeScanModal === "function") {
                    globalThis.closeScanModal();
                }
            }
        };
        container.appendChild(badge);
    }
};

// Global hooks for index
globalThis.closeScanModal = () => {
    if (state.autoSyncRewards && ScannerModal.currentResults) {
        ScannerModal.currentResults.forEach(item => {
            if (!item.name) return;
            const currentAppQty = state.primeInventory[item.name] || 0;
            const isSelected = (globalThis.selectedScanItem === item.name);
            const ocrOwned = (typeof item.owned === 'number') ? item.owned : currentAppQty;
            state.primeInventory[item.name] = ocrOwned + (isSelected ? 1 : 0);
        });
        saveAppState();
        if (globalThis.renderPrimeInventory) globalThis.renderPrimeInventory();
    }
    globalThis.selectedScanItem = null;
    ScannerModal.close();
    if (globalThis.ScannerService) globalThis.ScannerService.detectionLocked = false;
};

globalThis.toggleRewardsAutoSync = (val) => {
    state.autoSyncRewards = val;
    saveAppState();
};

globalThis.toggleAutoCopyScanResults = (val) => {
    state.autoCopyScanResults = val;
    saveAppState();
};

globalThis.copyScanResultsToClipboard = () => {
    if (ScannerModal.currentResults.length === 0) return;
    const text = ScannerModal.currentResults.map(i => i.name).join(", ");
    navigator.clipboard.writeText(text).then(() => {
        showToast(TEXTS[state.currentLang].rewardScanner.toastCopied || "Copied to clipboard");
    });
};
