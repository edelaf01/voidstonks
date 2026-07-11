import { state, saveAppState } from "../state.js";
import { TEXTS } from "../config.js";
import { getSlug, getPriceValue } from "../api.js";
import { showToast, escapeHTML } from "./ui_components.js";
import { renderItemsInPiP } from "../utils/pip_overlay.js";
import { ClipboardService } from "../services/clipboard.service.js";
import { getItemIcon } from "../utils/ui_utils.js";

/**
 * Component for the Scanner Success/Results Modal.
 */
export const ScannerModal = {
    currentResults: [],
    autoCloseTimer: null,
    AUTO_CLOSE_DELAY_MS: 20000,
    isHistoric: false,

    async open(imageUrl, items, width, height, scale, rawOcr = "", isHistoric = false) {
        const modal = document.getElementById("scan-success-modal");
        const imgEl = document.getElementById("scan-snapshot");
        const badgesContainer = document.getElementById("scan-badges-container");

        if (!modal || !imgEl || !badgesContainer) return;

        this.isHistoric = isHistoric;

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

        // Save to past detections history (in-memory)
        if (!state.scanHistory) state.scanHistory = [];
        const isDuplicate = state.scanHistory.length > 0 &&
            state.scanHistory[0].items.length === itemsWithDetails.length &&
            state.scanHistory[0].items.every((it, idx) => it.name === itemsWithDetails[idx].name);
        
        if (!isDuplicate) {
            state.scanHistory.unshift({
                id: Date.now(),
                timestamp: new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
                items: itemsWithDetails,
                imageUrl: imageUrl,
                width,
                height,
                scale,
                rawOcr
            });
            if (state.scanHistory.length > 10) {
                state.scanHistory.pop();
            }
        }

        this.renderBadges(itemsWithDetails, imgEl, width, height, scale);

        // Restore PiP update
        renderItemsInPiP(itemsWithDetails);

        // Restore Auto-Actions
        this.handleAutoActions(itemsWithDetails);
    },

    handleAutoActions(items) {
        if (state.autoCopyScanResults && items.length > 0) {
            const filtered = items.filter(i => !i.name.toUpperCase().includes("FORMA"));
            if (filtered.length > 0) {
                const text = filtered.map(i => {
                    const p = i.price || 0;
                    return p > 0 ? `[${i.name}] ${p} :platinum:` : `[${i.name}]`;
                }).join(", ") + " - voidstonks";
                // ClipboardService: extensión (copia sin foco) → clipboard nativo → cola
                // al recuperar el foco. El write directo fallaba en silencio mientras se
                // jugaba porque la pestaña no tiene el foco.
                ClipboardService.copy(text).then((via) => {
                    const t = TEXTS[state.currentLang].rewardScanner;
                    showToast(via === "queued"
                        ? (t.toastCopyQueued || "Se copiará al volver a la pestaña")
                        : (t.toastCopied || "Copiado al portapapeles"));
                }).catch(console.warn);
            }
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

        // Anti-overlap en píxeles reales: los badges miden 200px fijos, así que la
        // separación mínima depende del ancho visual del wrapper, no de un % fijo.
        const BADGE_W_PX = 200;
        const BADGE_MARGIN_PX = 8;
        const n = positionedItems.length;
        const wrapperW = parseFloat(wrapper.style.width) || wrapper.clientWidth || imgEl.clientWidth || 0;
        // Si no caben n badges lado a lado, se reducen con scale() hasta que quepan.
        const badgeScale = wrapperW > 0
            ? Math.max(0.4, Math.min(1, (wrapperW / n - BADGE_MARGIN_PX) / BADGE_W_PX))
            : 1;
        const gapPct = wrapperW > 0
            ? ((BADGE_W_PX * badgeScale + BADGE_MARGIN_PX) / wrapperW) * 100
            : 100 / n;
        const halfPct = gapPct / 2;

        for (let i = 1; i < n; i++) {
            const prev = positionedItems[i - 1];
            const curr = positionedItems[i];
            if (curr.leftPct - prev.leftPct < gapPct) {
                curr.leftPct = prev.leftPct + gapPct;
            }
        }
        // Reencaje dentro del wrapper: si el empuje hacia la derecha desborda,
        // se recoloca en cascada hacia la izquierda manteniendo el gap.
        if (n > 0) {
            const maxLeft = 100 - halfPct;
            if (positionedItems[n - 1].leftPct > maxLeft) positionedItems[n - 1].leftPct = maxLeft;
            for (let i = n - 2; i >= 0; i--) {
                if (positionedItems[i].leftPct > positionedItems[i + 1].leftPct - gapPct) {
                    positionedItems[i].leftPct = positionedItems[i + 1].leftPct - gapPct;
                }
            }
            if (positionedItems[0].leftPct < halfPct) positionedItems[0].leftPct = halfPct;
        }

        const fragment = document.createDocumentFragment();
        positionedItems.forEach((item) => {
            const isBestPl = item.price === maxPl && item.price > 0;
            const isBestEff = item.potential === maxPotential && item.potential > 0;

            this.createBadge(item, fragment, isBestPl, isBestEff, badgeScale);
        });

        badgesContainer.innerHTML = "";
        badgesContainer.appendChild(fragment);
    },

    createBadge(item, container, isBestPl, isBestEff, badgeScale = 1) {
        const badge = document.createElement("div");
        badge.className = `modal-badge ${isBestPl ? "best-pl" : ""} ${isBestEff ? "best-duc" : ""}`;
        badge.style.left = `${item.leftPct}%`;
        if (badgeScale < 1) badge.style.setProperty("--badge-scale", badgeScale);

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
    if (state.autoSyncRewards && ScannerModal.currentResults && !ScannerModal.isHistoric) {
        ScannerModal.currentResults.forEach(item => {
            if (!item.name) return;
            const currentAppQty = state.primeInventory[item.name] || 0;
            const isSelected = (globalThis.selectedScanItem === item.name);
            // "Crafted": el juego OCULTA el número de Owned (podrías tener 9 pero solo pone
            // "Crafted"). No sabemos el conteo real, así que NO lo sobrescribimos: si el usuario
            // seleccionó esta recompensa, sumamos +1 sobre lo que ya tenía (9→10, 0→1); si no,
            // se deja intacto.
            if (item.crafted) {
                if (isSelected) state.primeInventory[item.name] = currentAppQty + 1;
                return;
            }
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
    const filtered = ScannerModal.currentResults.filter(i => !i.name.toUpperCase().includes("FORMA"));
    if (filtered.length > 0) {
        const text = filtered.map(i => {
            const p = i.price || 0;
            return p > 0 ? `[${i.name}] ${p} :platinum:` : `[${i.name}]`;
        }).join(", ") + " - voidstonks";
        navigator.clipboard.writeText(text).then(() => {
            showToast(TEXTS[state.currentLang].rewardScanner.toastCopied || "Copied to clipboard");
        });
    } else {
        showToast(state.currentLang === "es" ? "No hay ítems comerciables para copiar" : "No tradeable items to copy");
    }
};

globalThis.toggleScanHistoryDropdown = (event) => {
    if (event) event.stopPropagation();
    const dropdown = document.getElementById("scan-history-dropdown");
    if (!dropdown) return;
    
    const isHidden = dropdown.classList.contains("hidden");
    if (isHidden) {
        dropdown.classList.remove("hidden");
        renderScanHistory();
    } else {
        dropdown.classList.add("hidden");
    }
};

globalThis.clearScanHistory = (event) => {
    if (event) event.stopPropagation();
    state.scanHistory = [];
    renderScanHistory();
    const t = TEXTS[state.currentLang].history || {};
    showToast(t.toastCleared || "History cleared");
};

document.addEventListener("click", (e) => {
    const dropdown = document.getElementById("scan-history-dropdown");
    const button = document.getElementById("btn-scan-history");
    if (dropdown && !dropdown.classList.contains("hidden")) {
        if (!dropdown.contains(e.target) && (!button || !button.contains(e.target))) {
            dropdown.classList.add("hidden");
        }
    }
});

function renderScanHistory() {
    const container = document.getElementById("scan-history-dropdown-list");
    if (!container) return;
    
    const history = state.scanHistory || [];
    const t = TEXTS[state.currentLang].history || {};
    
    if (history.length === 0) {
        container.innerHTML = `<div class="scan-history-empty">
            ${t.empty || "No rewards detected yet."}
        </div>`;
        return;
    }
    
    const fragment = document.createDocumentFragment();
    
    history.forEach((detection) => {
        const itemCard = document.createElement("div");
        itemCard.className = "scan-history-card";
        
        // Header row
        const headerRow = document.createElement("div");
        headerRow.className = "scan-card-header";
        
        const timeSpan = document.createElement("span");
        timeSpan.className = "scan-card-time";
        timeSpan.innerHTML = `
            <svg class="icon-clock-mini" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <polyline points="12 6 12 12 16 14"></polyline>
            </svg>
            ${detection.timestamp}
        `;
        
        const viewBtn = document.createElement("button");
        viewBtn.className = "scan-card-view-btn";
        viewBtn.innerHTML = `
            <svg class="icon-eye" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
              <circle cx="12" cy="12" r="3"></circle>
            </svg>
            ${t.btnView || "VIEW CAPTURE"}
        `;
        viewBtn.onclick = (e) => {
            e.stopPropagation();
            const dropdown = document.getElementById("scan-history-dropdown");
            if (dropdown) dropdown.classList.add("hidden");
            ScannerModal.open(detection.imageUrl, detection.items, detection.width, detection.height, detection.scale, detection.rawOcr, true);
        };
        
        headerRow.appendChild(timeSpan);
        headerRow.appendChild(viewBtn);
        itemCard.appendChild(headerRow);
        
        // Items list
        const itemsList = document.createElement("div");
        itemsList.className = "scan-card-items";
        
        detection.items.forEach((item) => {
            const itemRow = document.createElement("div");
            itemRow.className = "scan-card-item-row";
            
            const itemLeft = document.createElement("div");
            itemLeft.className = "scan-card-item-left";
            
            const imgPath = getItemIcon(item.name);
            if (imgPath) {
                const imgEl = document.createElement("img");
                imgEl.src = imgPath;
                imgEl.className = "scan-card-item-image";
                imgEl.alt = item.name;
                imgEl.loading = "lazy";
                imgEl.onerror = () => { imgEl.style.display = "none"; };
                itemLeft.appendChild(imgEl);
            }
            
            const nameCol = document.createElement("div");
            nameCol.className = "scan-card-item-info";
            
            const nameSpan = document.createElement("span");
            nameSpan.className = "scan-card-item-name";
            nameSpan.innerText = item.name.toUpperCase();
            
            const statsSpan = document.createElement("span");
            statsSpan.className = "scan-card-item-stats";
            statsSpan.innerHTML = `
                <span><img src="assets/relic_contents/platinum.webp" class="scan-card-plat-icon"> ${item.price || 0}p</span>
                <span style="color: var(--wf-gold-text);"><img src="assets/Ducats.webp" class="scan-card-ducat-icon"> ${item.ducats || 0}</span>
            `;
            
            nameCol.appendChild(nameSpan);
            nameCol.appendChild(statsSpan);
            itemLeft.appendChild(nameCol);
            itemRow.appendChild(itemLeft);
            
            const selectBtn = document.createElement("button");
            selectBtn.className = "scan-card-choose-btn";
            selectBtn.innerHTML = `
                <svg class="icon-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
                <span>${t.btnChoose || "CHOOSE"}</span>
            `;
            
            selectBtn.onclick = (e) => {
                e.stopPropagation();
                if (typeof globalThis.selectRewardToInventory === "function") {
                    globalThis.selectRewardToInventory(item.name);
                    selectBtn.innerHTML = `
                        <svg class="icon-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                          <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                        <span>${t.btnAdded || "ADDED"}</span>
                    `;
                    selectBtn.disabled = true;
                    setTimeout(() => {
                        const dropdown = document.getElementById("scan-history-dropdown");
                        if (dropdown) dropdown.classList.add("hidden");
                    }, 500);
                }
            };
            
            itemRow.appendChild(selectBtn);
            itemsList.appendChild(itemRow);
        });
        
        itemCard.appendChild(itemsList);
        fragment.appendChild(itemCard);
    });
    
    container.replaceChildren(fragment);
}
