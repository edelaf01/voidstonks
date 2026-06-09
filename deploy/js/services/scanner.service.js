import { VisionService, WF_THEMES } from "./vision.service.js";
import { OCRService } from "./ocr.service.js";
import { OCRRepository } from "../repositories/ocr.repository.js";
import { OpenCVRepository } from "../repositories/opencv.repository.js";
import { ScannerHUD } from "../ui.components/ui_scanner_hud.js";
import { ScannerModal } from "../ui.components/ui_scanner_modal.js";
import { initializeOCRDatabase } from "../repositories/api.repository.js";

/**
 */
export const ScannerService = {
    isScanning: false,
    scanInterval: null,
    currentRate: 1200,
    lastTrackedRelic: "",
    sessionInventory: new Map(),
    detectionLocked: false,
    scanCounter: 0,
    inventoryHasScanned: false,
    lastStableHash: null,
    virtualCanvas: null,

    async start() {
        if (this.isScanning) return;
        this.isScanning = true;
        globalThis.ScannerService = this;
        if (!this.virtualCanvas) {
            this.virtualCanvas = document.createElement("canvas");
            this.virtualCanvas.id = "scanner-virtual-canvas";
        }

        // On-demand fetch of the fresh prime items reference list from worker/backend cache
        initializeOCRDatabase().catch(err => console.warn("Error fetching OCR reference database from backend:", err));

        await OCRRepository.warmUp();
        OpenCVRepository.waitReady().catch(() => { });
        OCRService.initMatcherData();
        this.loop();
    },

    stop() {
        this.isScanning = false;
        if (this.scanInterval) clearTimeout(this.scanInterval);
        this.scanInterval = null;
        OCRRepository.terminateAll();
    },

    async loop() {
        if (!this.isScanning) return;

        const video = document.getElementById("live-video");
        if (!video || video.paused || video.ended) {
            this.scanInterval = setTimeout(() => this.loop(), 1000);
            return;
        }

        try {
            await this.processFrame(video, this.virtualCanvas);
        } catch (e) {
            console.warn("Scanner loop error:", e);
        } finally {
            if (this.isScanning) {
                this.scanInterval = setTimeout(() => this.loop(), this.currentRate);
            }
        }
    },

    async processFrame(video, virtualCanvas) {
        if (this.detectionLocked) return;
        this.scanCounter++;

        const dims = VisionService.prepareVirtualCanvas(video, virtualCanvas);



        const worker1 = OCRRepository.workers[0];
        const { data: headerData } = await OCRRepository.recognize(worker1, virtualCanvas);

        const contextType = VisionService.determineContext(headerData.text);
        console.log(`[SCAN] Context: ${contextType} | Header OCR: "${(headerData.text || "").trim().slice(0, 60)}"`);
        await this.routeFrameAction(contextType, video, dims);

        ScannerHUD.updateFrameCounter(this.scanCounter);
    },

    autoScrollHash: null,
    autoScrollStableTimer: null,
    lastFrameHash: null,
    scrollDirectionAccumulator: 0,
    lastRowLums: null,

    async routeFrameAction(contextType, video, dims) {
        ScannerHUD.updateContext(contextType);

        if (contextType === "INVENTORY") {
            if (!globalThis.state.autoScanEnabled) {
                this.currentRate = 3000; // 3 seconds idle check when autoScan is disabled
                this.autoScrollHash = null;
                this.lastFrameHash = null;
                if (this.autoScrollStableTimer) {
                    clearTimeout(this.autoScrollStableTimer);
                    this.autoScrollStableTimer = null;
                }
                return;
            }

            this.currentRate = 300; // Check faster (every 300ms) for extremely responsive scroll detection!

            const sampleCvs = document.createElement("canvas");
            sampleCvs.width = 48; sampleCvs.height = 27;
            const sCtx = sampleCvs.getContext("2d", { willReadFrequently: true });
            sCtx.drawImage(video, 0, Math.floor(video.videoHeight * 0.25), video.videoWidth, Math.floor(video.videoHeight * 0.5), 0, 0, 48, 27);
            const currentHash = VisionService.getFrameHash(sCtx, 48, 27);

            if (this.lastFrameHash === null || this.lastFrameHash === undefined) {
                this.lastFrameHash = currentHash;
                return;
            }

            // Compute average row luminance of the center strip
            const rowLums = [];
            const imgData = sCtx.getImageData(0, 0, 48, 27);
            const px = imgData.data;
            for (let r = 0; r < 27; r++) {
                let sum = 0;
                const rowStart = r * 48 * 4;
                for (let c = 0; c < 48; c++) {
                    const idx = rowStart + c * 4;
                    sum += px[idx] * 0.299 + px[idx+1] * 0.587 + px[idx+2] * 0.114;
                }
                rowLums.push(sum / 48);
            }

            let bestDy = 0;
            let mseZero = 0;
            if (this.lastRowLums) {
                let minError = Infinity;
                for (let dy = -6; dy <= 6; dy++) {
                    let errorSum = 0;
                    let count = 0;
                    for (let r = 0; r < 27; r++) {
                        const prevR = r + dy;
                        if (prevR >= 0 && prevR < 27) {
                            const diff = rowLums[r] - this.lastRowLums[prevR];
                            errorSum += diff * diff;
                            count++;
                        }
                    }
                    const mse = count > 0 ? (errorSum / count) : Infinity;
                    if (dy === 0) mseZero = mse;
                    if (mse < minError) {
                        minError = mse;
                        bestDy = dy;
                    }
                }
            }
            this.lastRowLums = rowLums;

            // Screen is scrolling if there is a clear vertical shift OR a massive whole-frame change (MSE > 80)
            const isScrolling = (bestDy !== 0 && minError < mseZero - 5) || mseZero > 80;

            if (isScrolling) {
                // Screen is currently in motion (user is scrolling)
                this.scrollDirectionAccumulator += bestDy;
                if (this.autoScrollStableTimer) {
                    clearTimeout(this.autoScrollStableTimer);
                    this.autoScrollStableTimer = null;
                }
                ScannerHUD.updateScrollStatus("detected");
                return;
            }

            // Screen is stable (still). If we haven't scanned this stable page yet (threshold lowered to 120 for sensitivity):
            const hasPageChanged = !this.autoScrollHash || Math.abs(currentHash - this.autoScrollHash) >= 120;
            const isScrollDown = this.scrollDirectionAccumulator > 1;
            const isFirstScan = !this.autoScrollHash;

            if (hasPageChanged && !this.autoScrollStableTimer && !this.detectionLocked) {
                // Only ignore auto-scan when we have confirmed an upward scroll (negative accumulator)
                if (!isFirstScan && this.scrollDirectionAccumulator < 0) {
                    // It was an upward scroll. Ignore auto-scan.
                    this.scrollDirectionAccumulator = 0;
                    this.autoScrollHash = currentHash; // Mark as done to prevent repeat triggers
                    ScannerHUD.updateScrollStatus("done", this.sessionInventory.size);
                    return;
                }

                ScannerHUD.updateScrollStatus("detected"); // Show stabilizing message

                // Wait 800ms of continuous stability before capturing & scanning for premium, instant responsiveness!
                this.autoScrollStableTimer = setTimeout(async () => {
                    this.scrollDirectionAccumulator = 0;
                    if (!globalThis.state.autoScanEnabled || this.detectionLocked) {
                        this.autoScrollStableTimer = null;
                        return;
                    }

                    const v = document.getElementById("live-video");
                    const snapshot = document.createElement("canvas");
                    snapshot.width = v.videoWidth; snapshot.height = v.videoHeight;
                    snapshot.getContext("2d").drawImage(v, 0, 0);

                    await this.processInventoryGrid(snapshot, dims.width, dims.height, dims.scale);
                    this.autoScrollHash = currentHash;
                    this.autoScrollStableTimer = null;

                }, 800);
            } else if (!this.autoScrollStableTimer) {
                // Screen is stable, and we've already scanned this page (or there is no active timer).
                // Safely clear accumulator and immediately restore visual "done" status to prevent HUD from sticking!
                this.scrollDirectionAccumulator = 0;
                ScannerHUD.updateScrollStatus("done", this.sessionInventory.size);
            }

        } else if (contextType === "RELICS") {
            this.currentRate = 600;
            await this.processRelicSelection(video, dims);
        } else if (contextType === "REWARD") {
            if (this.detectionLocked) return;
            this.currentRate = 1200;
            await this.processRewards(video, dims);
        } else {
            this.currentRate = globalThis.state.autoScanEnabled ? 1000 : 3000;
        }
    },

    async processRelicSelection(video, dims) {
        const { scale } = dims;
        const canvas = VisionService.prepareRelicSelectionCanvas(video, scale);
        const worker1 = OCRRepository.workers[0];
        const { data } = await OCRRepository.recognize(worker1, canvas);

        const relicMatch = OCRService.parseRelicSelection(data.text);
        if (relicMatch && relicMatch !== this.lastTrackedRelic) {
            this.lastTrackedRelic = relicMatch;
            // Emit event or call UI
            if (globalThis.showTrackConfirm) globalThis.showTrackConfirm(relicMatch, data.text);
        }
    },

    async processRewards(video, dims) {
        const { width, height, scale } = dims;
        const ocrCanvas = VisionService.prepareRewardOCRCanvas(video, width, height, scale);
        console.log(`[REWARD] Canvas: ${ocrCanvas.width}x${ocrCanvas.height}`);

        if (globalThis.OpenCVEngine?.isReady) {
            globalThis.OpenCVEngine.processForOCR(ocrCanvas, "hard");
            console.log("[REWARD] Binarization: OpenCV");
        } else {
            // Canvas is already grayscale from CSS filter.
            // Invert: bright=text → black(0), dark=background → white(255)
            const ctx = ocrCanvas.getContext("2d", { willReadFrequently: true });
            const imgData = ctx.getImageData(0, 0, ocrCanvas.width, ocrCanvas.height);
            const px = imgData.data;
            let textPixels = 0;
            for (let i = 0; i < px.length; i += 4) {
                const v = px[i] > 128 ? 0 : 255;
                if (v === 0) textPixels++;
                px[i] = px[i + 1] = px[i + 2] = v;
            }
            ctx.putImageData(imgData, 0, 0);
            const totalPx = px.length / 4;
            console.log(`[REWARD] Binarization: ${textPixels} text pixels / ${totalPx} total (${(100 * textPixels / totalPx).toFixed(2)}%)`);
        }

        const dbgPanel = document.getElementById("live-debug-snapshot");
        if (dbgPanel?.style.display === "block") {
            const debugImg = document.getElementById("live-debug-snapshot-img");
            if (debugImg) debugImg.src = ocrCanvas.toDataURL("image/jpeg", 0.85);
        }

        const worker1 = OCRRepository.workers[0];
        const { data } = await OCRRepository.recognize(worker1, ocrCanvas);
        const rawOcr = data.text || "";
        console.log(`[REWARD] OCR raw: "${rawOcr.replaceAll(/\n+/g, " ").trim().slice(0, 120)}"`);
        // Pass the real canvas width so parseRewards uses correct coordinates
        data.imageW = ocrCanvas.width;
        const foundItems = OCRService.parseRewards(data);
        console.log(`[REWARD] Items found: ${foundItems.length}`, foundItems.map(i => i.name));

        clearRewardDebugLogs();
        const cleanOcrText = rawOcr.replaceAll(/\n+/g, ' ').trim();
        addRewardDebugLog("OCR", `Read: ${cleanOcrText}`, "info");
        addRewardDebugLog("SCAN", `Items found: ${foundItems.length}`, foundItems.length > 0 ? "match" : "warn");

        if (foundItems.length > 0 && !this.detectionLocked) {
            foundItems.forEach(item => {
                const status = item.crafted ? "CRAFTED" : `${item.owned} OWNED`;
                addRewardDebugLog("ITEM", `${item.name} -> ${status}`, "match");
            });

            this.detectionLocked = true;
            const snapshot = document.createElement("canvas");
            snapshot.width = width; snapshot.height = height;
            snapshot.getContext("2d").drawImage(video, 0, 0, width, height);
            ScannerModal.open(snapshot.toDataURL("image/jpeg", 0.85), foundItems, width, height, scale, rawOcr);
        }
    },

    async processInventoryGrid(snapshot, width, height, scale) {
        if (this.detectionLocked) return;
        this.detectionLocked = true;

        try {
            // 1. Ensure calibration exists (single-zone format)
            if (globalThis.LiveCalibration && !globalThis.LiveCalibration.hasCalibration()) {
                console.log("[INV] No calibration found. Starting zone calibration...");
                const calibCvs = document.createElement("canvas");
                calibCvs.width = width;
                calibCvs.height = height;
                const calibCtx = calibCvs.getContext("2d", { willReadFrequently: true });
                calibCtx.drawImage(snapshot, 0, 0);
                await globalThis.LiveCalibration.runCalibrationFlow(
                    calibCtx.getImageData(0, 0, width, height)
                );
                return;
            }

            const calibData = globalThis.LiveCalibration?.getGrid();
            if (!calibData?.gridZone) {
                console.warn("[INV] No grid zone calibration available.");
                return;
            }

            const { gridZone } = calibData;

            // 2. Detect UI theme from within the calibrated zone
            const theme = VisionService.detectThemeFromSnapshot(
                snapshot,
                gridZone.x, gridZone.y, gridZone.w, gridZone.h
            );
            console.log(`[INV] Theme detected: ${theme.name} (r:${theme.r} g:${theme.g} b:${theme.b})`);

            // 3. Auto-detect grid cell positions from theme pixel density
            const autoGrid = VisionService.buildAutoGrid(snapshot, gridZone, theme, calibData);
            if (!autoGrid || autoGrid.cellRects.length === 0) {
                console.warn("[INV] Auto-grid detection failed — inventory may not be visible or zone needs recalibration.");
                ScannerHUD.updateScrollStatus("done", 0);
                return;
            }

            const { cellRects, cellW, cellH } = autoGrid;
            console.log(`[INV] Auto-grid: ${autoGrid.rows}r × ${autoGrid.cols}c, ${cellRects.length} cells`);

            ScannerHUD.updateScrollStatus("scanning");

            // Debug overlay canvas (cropped to the calibrated section for a clear, high-res zoom in UI)
            const debugCanvas = document.createElement("canvas");
            debugCanvas.width = gridZone.w;
            debugCanvas.height = gridZone.h;
            const dCtx = debugCanvas.getContext("2d");
            dCtx.drawImage(snapshot, gridZone.x, gridZone.y, gridZone.w, gridZone.h, 0, 0, gridZone.w, gridZone.h);

            // Draw detected cell grid borders (cyan) relative to the calibrated section
            dCtx.strokeStyle = "rgba(0,229,255,0.4)";
            dCtx.lineWidth = 1;
            cellRects.forEach(cell => dCtx.strokeRect(cell.sx - gridZone.x, cell.sy - gridZone.y, cellW, cellH));

            // Draw horizontal dashed amber guidelines representing the quantity baselines for the 3 rows
            const gridLeft = Math.min(...cellRects.map(c => c.sx)) - gridZone.x;
            const gridRight = Math.max(...cellRects.map(c => c.sx + cellW)) - gridZone.x;
            dCtx.strokeStyle = "rgba(255, 193, 7, 0.5)"; // elegant amber
            dCtx.lineWidth = 1.5;
            dCtx.setLineDash([6, 4]);
            for (let ri = 0; ri < autoGrid.rows; ri++) {
                const rowCell = cellRects.find(c => c.r === ri);
                if (rowCell) {
                    dCtx.beginPath();
                    dCtx.moveTo(gridLeft, rowCell.sy - gridZone.y);
                    dCtx.lineTo(gridRight, rowCell.sy - gridZone.y);
                    dCtx.stroke();
                }
            }
            dCtx.setLineDash([]); // Reset line dash

            // 4. Extract active non-empty cells
            const activeCells = [];
            for (const cell of cellRects) {
                // Crop precisely the bottom portion of the card (starting at 58% height) 
                // where the 1-line or 2-line item names are printed, completely avoiding 
                // the weapon/warframe illustration in the middle of the card.
                const textSrcY = Math.round(cellH * 0.58);
                const textSrcH = cellH - textSrcY;
                const textCvs = VisionService.cropThemeBinarized(snapshot, cell.sx, cell.sy + textSrcY, cellW, textSrcH, theme);

                const tCtx = textCvs.getContext("2d");
                const imgData = tCtx.getImageData(0, 0, textCvs.width, textCvs.height);
                const pixels = imgData.data;
                let whitePixelCount = 0;
                for (let p = 0; p < pixels.length; p += 4) {
                    if (pixels[p] > 200) whitePixelCount++;
                }

                if (whitePixelCount < 40) {
                    this.lastRawOcrLog.push(`[r${cell.r}c${cell.c}] SKIPPED (empty)`);
                    const relX = cell.sx - gridZone.x;
                    const relY = cell.sy - gridZone.y;
                    dCtx.strokeStyle = "rgba(255, 255, 255, 0.04)";
                    dCtx.lineWidth = 1;
                    dCtx.strokeRect(relX + 2, relY + 2, cellW - 4, cellH - 4);
                } else {
                    activeCells.push({ cell, textCvs });
                }
            }

            const workers = OCRRepository.workers;
            const bWorkers = OCRRepository.badgeWorkers;
            this.lastRawOcrLog = [];

            let cellIndex = 0;
            const runWorker = async (worker, bWorker) => {
                while (cellIndex < activeCells.length) {
                    const task = activeCells[cellIndex++];
                    if (!task) break;

                    const { cell, textCvs } = task;
                    const combinedText = await OCRService.extractCellText(worker, textCvs);

                    if (!combinedText) {
                        this.lastRawOcrLog.push(`[r${cell.r}c${cell.c}] NONE`);
                        continue;
                    }

                    let logStr = `[r${cell.r}c${cell.c}] OCR: ${combinedText.join(" ")}`;
                    let bestItem = OCRService.getValidItemMatch(combinedText);
                    
                    // Fallback: if no match, try full cell OCR (captures text at top/left like Octavia Prime Blueprint)
                    if (!bestItem) {
                        const fullCellCvs = VisionService.cropThemeBinarized(snapshot, cell.sx, Math.max(0, cell.sy - 16), cellW, cellH + 16, theme);
                        const fallbackText = await OCRService.extractCellText(worker, fullCellCvs);
                        if (fallbackText && fallbackText.length) {
                            logStr = `[r${cell.r}c${cell.c}] OCR (fallback): ${fallbackText.join(" ")}`;
                            bestItem = OCRService.getValidItemMatch(fallbackText);
                        }
                    }

                    // Debug log disabled for production performance boost (reduces console render lag)
                    /*
                    console.log(`%c[INV CELL r${cell.r}c${cell.c}]%c OCR: %c"${combinedText.join(" ")}"%c -> Match: %c${bestItem ? bestItem.originalName : "NONE"}`, 
                        "color: #00e5ff; font-weight: bold;", 
                        "color: #ffffff;", 
                        "color: #ffc107; font-style: italic; font-weight: bold;", 
                        "color: #ffffff;", 
                        bestItem ? "color: #00ff78; font-weight: bold;" : "color: #ff3d00; font-weight: bold;"
                    );
                    */

                    if (bestItem) {
                        // 4b. Extract badge (quantity) using improved color-based crop
                        const badgeCanvas = VisionService.extractBadgeByColor(snapshot, cell, cellW, cellH, theme);
                        const qtyResult = await OCRService.extractCellQuantity(bWorker, badgeCanvas);

                        logStr += ` || BDG: ${qtyResult.raw}`;
                        this.lastRawOcrLog.push(logStr);

                        this.sessionInventory.set(bestItem.originalName, qtyResult.qty);

                        const relX = cell.sx - gridZone.x;
                        const relY = cell.sy - gridZone.y;

                        // Draw a single elegant opaque label block at the bottom of the card to fully cover underlying text
                        dCtx.fillStyle = "rgba(10, 15, 28, 0.98)";
                        dCtx.fillRect(relX, relY + cellH - 50, cellW, 50);
                        
                        // Thin cyan line top separator for premium feel
                        dCtx.fillStyle = "rgba(0, 229, 255, 0.7)";
                        dCtx.fillRect(relX, relY + cellH - 50, cellW, 1.5);

                        // 1. Raw Tesseract OCR Text (Amber, italic, 9px)
                        dCtx.fillStyle = "#ffb300";
                        dCtx.font = "italic 9px system-ui, -apple-system, sans-serif";
                        const rawText = combinedText.join(" ");
                        const badgeRawText = qtyResult.raw ? qtyResult.raw.trim().replaceAll(/\s+/g, " ") : "Ø";
                        const maxCharsItem = Math.floor(cellW / 5.5);
                        const truncatedItem = rawText.length > maxCharsItem ? rawText.slice(0, maxCharsItem - 3) + "..." : rawText;
                        dCtx.fillText(truncatedItem, relX + 6, relY + cellH - 37);

                        // Line 2: Raw Badge Text
                        dCtx.fillText(`BDG: "${badgeRawText}"`, relX + 6, relY + cellH - 25);

                        // 2. Clean Matched Catalog Name (Green, bold, 12px)
                        dCtx.fillStyle = "#00ff78";
                        dCtx.font = "bold 12px system-ui, -apple-system, sans-serif";
                        const shortName = bestItem.originalName.replace(/Prime/gi, "").trim();
                        dCtx.fillText(shortName, relX + 6, relY + cellH - 8);

                        // Draw a premium, beautiful pill badge at the TOP-LEFT exactly over the physical badge
                        const shiftLeft = (cell.c === 0) ? 14 : 2;
                        dCtx.fillStyle = "rgba(0, 0, 0, 0.85)";
                        dCtx.fillRect(relX - shiftLeft, relY + 4, 44 + (shiftLeft - 2), 18);
                        dCtx.fillStyle = "#ffc107"; // elegant amber/gold
                        dCtx.font = "bold 11px monospace";
                        dCtx.fillText(`x${qtyResult.qty}`, relX - shiftLeft + 8, relY + 17);

                        // Highlight the exact auto-calibrated cropping region of the badge in golden outline
                        if (badgeCanvas) {
                            const bX = (badgeCanvas.cropX !== undefined ? badgeCanvas.cropX : cell.sx) - gridZone.x;
                            const bY = badgeCanvas.bestY - gridZone.y;
                            const bW = badgeCanvas.cropW !== undefined ? badgeCanvas.cropW : Math.round(cellW * 0.28);
                            const bH = badgeCanvas.cropH !== undefined ? badgeCanvas.cropH : Math.round(cellH * 0.12);
                            dCtx.strokeStyle = "rgba(255, 193, 7, 0.85)";
                            dCtx.lineWidth = 1.5;
                            dCtx.strokeRect(bX, bY, bW, bH);
                        }
                    } else {
                        this.lastRawOcrLog.push(logStr);
                        // Clean, premium thin red border for unmatched cells instead of heavy solid blocks
                        const relX = cell.sx - gridZone.x;
                        const relY = cell.sy - gridZone.y;
                        dCtx.strokeStyle = "rgba(255, 30, 80, 0.6)";
                        dCtx.lineWidth = 2;
                        dCtx.strokeRect(relX + 2, relY + 2, cellW - 4, cellH - 4);

                        // Draw a single elegant red-tinted opaque label block at the bottom
                        dCtx.fillStyle = "rgba(25, 10, 15, 0.98)";
                        dCtx.fillRect(relX, relY + cellH - 50, cellW, 50);
                        
                        // Thin red line top separator
                        dCtx.fillStyle = "rgba(255, 30, 80, 0.7)";
                        dCtx.fillRect(relX, relY + cellH - 50, cellW, 1.5);

                        // 1. Raw Tesseract OCR Text (Red-orange, italic, 9px)
                        dCtx.fillStyle = "#ff5252";
                        dCtx.font = "italic 9px system-ui, -apple-system, sans-serif";
                        const rawText = combinedText ? combinedText.join(" ") : "EMPTY";
                        const maxCharsItem = Math.floor(cellW / 5.5);
                        const truncatedItem = rawText.length > maxCharsItem ? rawText.slice(0, maxCharsItem - 3) + "..." : rawText;
                        dCtx.fillText(truncatedItem, relX + 6, relY + cellH - 37);

                        // Line 2: Raw Badge Text
                        dCtx.fillText(`BDG: "Ø"`, relX + 6, relY + cellH - 25);

                        // 2. Unmatched Status Label (Gray, bold, 12px)
                        dCtx.fillStyle = "#8c9eff";
                        dCtx.font = "bold 12px system-ui, -apple-system, sans-serif";
                        dCtx.fillText("UNMATCHED CELL", relX + 6, relY + cellH - 8);
                    }
                }
            };

            try {
                // Dynamically load-balance Tesseract workers to maximize parallel scan throughput
                const workerPromises = [];
                const activeWorkerCount = Math.min(workers.length, activeCells.length);
                for (let w = 0; w < activeWorkerCount; w++) {
                    workerPromises.push(runWorker(workers[w], bWorkers[w]));
                }
                await Promise.all(workerPromises);

                // Console logs disabled for production performance boost (reduces console render lag)
                /*
                console.log(`%c[INV] Scan complete. ${this.sessionInventory.size} unique items.`, "color: #00ff78; font-weight: bold; font-size: 13px;");
                console.log("%c=== RAW OCR LOG SUMMARY ===", "color: #ffc107; font-weight: bold;");
                this.lastRawOcrLog.forEach(log => console.log(`%c${log}`, "color: #e0e0e0; font-family: monospace;"));
                console.log("%c===========================", "color: #ffc107; font-weight: bold;");
                */
                ScannerHUD.updateScrollStatus("done", this.sessionInventory.size);
                ScannerHUD.updateDetectedItems(this.sessionInventory);

                if (ScannerHUD.updateDebugSnapshot) {
                    ScannerHUD.updateDebugSnapshot(debugCanvas.toDataURL("image/jpeg", 0.7));
                    this.lastDebugUpdate = Date.now() + 5000;
                }
            } catch (e) {
                console.error("[INV] Grid processing failed:", e);
            } finally {
                this.detectionLocked = false;
            }

        } finally {
            this.detectionLocked = false;
        }
    },

};
function clearRewardDebugLogs() {
    const container = document.getElementById("rewards-raw-ocr-content");
    if (container) container.innerHTML = "";
}

function addRewardDebugLog(tag, msg, type = "info") {
    const container = document.getElementById("rewards-raw-ocr-content");
    if (!container) return;

    const entry = document.createElement("div");

    const colors = {
        info: "#ff9800",
        match: "#00ff78",
        warn: "#f1c40f"
    };

    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour12: false });

    entry.innerHTML = `
        <span style="color:#555;">[${timeStr}]</span>
        <span style="color:${colors[type]}; font-weight:bold;">${tag.toUpperCase()}</span>
        <span style="color:#eee;">${msg}</span>
    `;

    container.appendChild(entry);

    const parent = document.getElementById("rewards-dbg-text");
    if (parent) parent.scrollTop = parent.scrollHeight;
}