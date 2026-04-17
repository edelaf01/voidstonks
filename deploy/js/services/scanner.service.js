import { VisionService } from "./vision.service.js";
import { OCRService } from "./ocr.service.js";
import { OCRRepository } from "../repositories/ocr.repository.js";
import { OpenCVRepository } from "../repositories/opencv.repository.js";
import { ScannerHUD } from "../ui.components/ui_scanner_hud.js";
import { ScannerModal } from "../ui.components/ui_scanner_modal.js";

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
        if (this.scanInterval) return;
        globalThis.ScannerService = this;
        if (!this.virtualCanvas) {
            this.virtualCanvas = document.createElement("canvas");
            this.virtualCanvas.id = "scanner-virtual-canvas";
        }

        await OCRRepository.warmUp();
        await OpenCVRepository.waitReady();
        OCRService.initMatcherData();
        this.loop();
    },

    stop() {
        if (this.scanInterval) clearTimeout(this.scanInterval);
        this.scanInterval = null;
        OCRRepository.terminateAll();
    },

    async loop() {
        if (this.scanInterval === null && this.scanCounter > 0) return; // Prevent loop after stop

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
            this.scanInterval = setTimeout(() => this.loop(), this.currentRate);
        }
    },

    async processFrame(video, virtualCanvas) {
        if (this.detectionLocked) return;
        this.scanCounter++;

        const dims = VisionService.prepareVirtualCanvas(video, virtualCanvas);

        if (document.getElementById("live-debug-snapshot")?.style.display === "block") {
            const now = Date.now();
            if (!this.lastDebugUpdate || now - this.lastDebugUpdate > 2000) {
                const debugImg = document.getElementById("live-debug-snapshot-img");
                if (debugImg) {
                    debugImg.src = virtualCanvas.toDataURL("image/jpeg", 0.5);
                    debugImg.style.display = "block";
                    this.lastDebugUpdate = now;
                }
            }
        }

        const worker1 = OCRRepository.workers[0];
        const { data: headerData } = await OCRRepository.recognize(worker1, virtualCanvas);

        const contextType = VisionService.determineContext(headerData.text);
        await this.routeFrameAction(contextType, video, dims);

        ScannerHUD.updateFrameCounter(this.scanCounter);
    },

    autoScrollHash: null,
    autoScrollStableTimer: null,

    async routeFrameAction(contextType, video, dims) {
        ScannerHUD.updateContext(contextType);

        if (contextType === "INVENTORY") {
            this.currentRate = 500; // Check faster to catch scrolls

            if (!globalThis.state.autoScanEnabled) {
                this.autoScrollHash = null;
                return;
            }

            const sampleCvs = document.createElement("canvas");
            sampleCvs.width = 48; sampleCvs.height = 27;
            const sCtx = sampleCvs.getContext("2d");
            sCtx.drawImage(video, 0, Math.floor(video.videoHeight * 0.25), video.videoWidth, Math.floor(video.videoHeight * 0.5), 0, 0, 48, 27);
            const currentHash = VisionService.getFrameHash(sCtx, 48, 27);

            if (this.autoScrollHash && Math.abs(currentHash - this.autoScrollHash) < 80) {
                return; // Hasn't changed significantly enough yet
            }

            ScannerHUD.updateScrollStatus("detected");
            this.autoScrollHash = null;

            if (this.autoScrollStableTimer) clearTimeout(this.autoScrollStableTimer);

            this.autoScrollStableTimer = setTimeout(async () => {
                if (!globalThis.state.autoScanEnabled || this.detectionLocked) return;

                const v = document.getElementById("live-video");
                const snapshot = document.createElement("canvas");
                snapshot.width = v.videoWidth; snapshot.height = v.videoHeight;
                snapshot.getContext("2d").drawImage(v, 0, 0);

                await this.processInventoryGrid(snapshot, dims.width, dims.height, dims.scale);
                this.autoScrollHash = currentHash;

            }, 2000);

        } else if (contextType === "RELICS") {
            this.currentRate = 600;
            await this.processRelicSelection(video, dims);
        } else if (contextType === "REWARD") {
            if (this.detectionLocked) return;
            this.currentRate = 1200;
            await this.processRewards(video, dims);
        } else {
            this.currentRate = 1000;
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

        if (globalThis.OpenCVEngine?.isReady) {
            globalThis.OpenCVEngine.processForOCR(ocrCanvas, "hard");
        }

        const dbgPanel = document.getElementById("live-debug-snapshot");
        if (dbgPanel?.style.display === "block") {
            const debugImg = document.getElementById("live-debug-snapshot-img");
            if (debugImg) debugImg.src = ocrCanvas.toDataURL("image/jpeg", 0.85);
        }

        const worker1 = OCRRepository.workers[0];
        const { data } = await OCRRepository.recognize(worker1, ocrCanvas);
        const rawOcr = data.text || "";
        const foundItems = OCRService.parseRewards(data);

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

        if (globalThis.LiveCalibration && !globalThis.LiveCalibration.hasCalibration()) {
            console.log("No Grid Calibration found. Starting calibration...");
            const calibCvs = document.createElement("canvas");
            calibCvs.width = width;
            calibCvs.height = height;
            const calibCtx = calibCvs.getContext("2d");
            calibCtx.drawImage(snapshot, 0, 0);
            await globalThis.LiveCalibration.runCalibrationFlow(
                calibCtx.getImageData(0, 0, width, height)
            );
            return;
        }

        const grid = globalThis.LiveCalibration?.getGrid();
        if (!grid) return;

        const cellRects = this.calculateCellRects(grid);
        const ocrCanvas = VisionService.createFilteredOcrCanvas(snapshot, width, height, grid);

        const debugCanvas = document.createElement("canvas");
        debugCanvas.width = width;
        debugCanvas.height = height;
        const dCtx = debugCanvas.getContext("2d");
        dCtx.drawImage(snapshot, 0, 0);
        dCtx.strokeStyle = "rgba(0,255,255,0.3)";
        dCtx.lineWidth = 1;
        cellRects.forEach(cell => dCtx.strokeRect(cell.sx, cell.sy, grid.cellW, grid.cellH));

        ScannerHUD.updateScrollStatus("scanning");

        const chunks = [[], [], []];
        cellRects.forEach((cell, i) => chunks[i % 3].push(cell));

        const workers = OCRRepository.workers;
        const bWorkers = OCRRepository.badgeWorkers;

        this.lastRawOcrLog = [];

        const processChunk = async (chunk, worker, bWorker) => {
            for (const cell of chunk) {
                const textCanvas = VisionService.createTextCanvas(ocrCanvas, cell, grid);
                const combinedText = await OCRService.extractCellText(worker, textCanvas);
                if (!combinedText) {
                    this.lastRawOcrLog.push(`[r${cell.r}c${cell.c}] NONE`);
                    continue;
                }

                let logStr = `[r${cell.r}c${cell.c}] OCR: ${combinedText.join(" ")}`;

                const bestItem = OCRService.getValidItemMatch(combinedText);
                if (bestItem) {
                    const badgeCanvas = VisionService.createBadgeCanvas(snapshot, cell, grid);
                    const qtyResult = await OCRService.extractCellQuantity(bWorker, badgeCanvas);

                    logStr += ` || BDG: ${qtyResult.raw}`;
                    this.lastRawOcrLog.push(logStr);

                    this.sessionInventory.set(bestItem.originalName, qtyResult.qty);
                    ScannerHUD.updateDetectedItems(this.sessionInventory);

                    // Draw success on debug canvas
                    dCtx.fillStyle = "rgba(0,0,0,0.8)";
                    dCtx.fillRect(cell.sx, cell.sy + grid.cellH - 20, grid.cellW, 20);
                    dCtx.fillStyle = "#00ff78";
                    dCtx.font = "bold 11px monospace";
                    const shortName = bestItem.originalName.replace(/Prime/gi, "").trim();
                    dCtx.fillText(`${shortName} x${qtyResult.qty}`, cell.sx + 4, cell.sy + grid.cellH - 5);
                } else {
                    this.lastRawOcrLog.push(logStr);
                    // Draw failure/debug info
                    dCtx.fillStyle = "rgba(255,0,0,0.5)";
                    dCtx.fillRect(cell.sx, cell.sy + grid.cellH - 15, grid.cellW, 15);
                }
            }
        };

        try {
            await Promise.all([
                processChunk(chunks[0], workers[0], bWorkers[0]),
                processChunk(chunks[1], workers[1], bWorkers[1]),
                processChunk(chunks[2], workers[2], bWorkers[2])
            ]);

            console.log(`Scan Page Complete. Found ${this.sessionInventory.size} unique items.`);
            ScannerHUD.updateScrollStatus("done", this.sessionInventory.size);
            ScannerHUD.updateDetectedItems(this.sessionInventory);

            if (ScannerHUD.updateDebugSnapshot) {
                ScannerHUD.updateDebugSnapshot(debugCanvas.toDataURL("image/jpeg", 0.7));
                // Prevent processFrame from overwriting this painted image for 5 seconds
                this.lastDebugUpdate = Date.now() + 5000;
            }
        } catch (e) {
            console.error("Grid processing failed:", e);
        } finally {
            this.detectionLocked = false;
        }
    },

    async processCellChunk(chunk, worker, bWorker, ocrCanvas, snapshot, grid) {
        for (const cell of chunk) {
            const textCanvas = VisionService.createTextCanvas(ocrCanvas, cell, grid);
            const combinedText = await OCRService.extractCellText(worker, textCanvas);
            if (!combinedText) continue;

            const bestMatch = OCRService.getValidItemMatch(combinedText);
            if (!bestMatch) continue;

            const badgeCanvas = VisionService.createBadgeCanvas(snapshot, cell, grid);
            const qty = await OCRService.extractCellQuantity(bWorker, badgeCanvas);

            const existing = this.sessionInventory.get(bestMatch.originalName) || 0;
            if (qty >= existing) this.sessionInventory.set(bestMatch.originalName, qty);
        }
    },

    calculateCellRects(grid) {
        const rects = [];
        const editor = globalThis.GridCellEditor;
        const off = editor ? editor.getOffset() : { dx: 0, dy: 0 };
        for (let r = 0; r < grid.rows; r++) {
            for (let c = 0; c < grid.cols; c++) {
                const sx = Math.floor(grid.gridX + c * (grid.cellW + grid.gapX) + off.dx);
                const sy = Math.floor(grid.gridY + r * (grid.cellH + grid.gapY) + off.dy);
                rects.push({ r, c, sx, sy, cx: sx + grid.cellW / 2, cy: sy + grid.cellH / 2 });
            }
        }
        return rects;
    }
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