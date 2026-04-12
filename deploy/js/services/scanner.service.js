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
    virtualCanvas: null,

    async start() {
        if (this.scanInterval) return;

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

    async routeFrameAction(contextType, video, dims) {
        ScannerHUD.updateContext(contextType);

        if (contextType === "INVENTORY") {
            this.currentRate = 1500;
            const video = document.getElementById("live-video");
            const snapshot = document.createElement("canvas");
            snapshot.width = video.videoWidth; snapshot.height = video.videoHeight;
            snapshot.getContext("2d").drawImage(video, 0, 0);
            await this.processInventoryGrid(snapshot, dims.width, dims.height, dims.scale);
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

        const worker1 = OCRRepository.workers[0];
        const { data } = await OCRRepository.recognize(worker1, ocrCanvas);

        const foundItems = OCRService.parseRewards(data);
        if (foundItems.length > 0 && !this.detectionLocked) {
            this.detectionLocked = true;

            const snapshot = document.createElement("canvas");
            snapshot.width = width; snapshot.height = height;
            snapshot.getContext("2d").drawImage(video, 0, 0, width, height);

            ScannerModal.open(snapshot.toDataURL("image/jpeg", 0.85), foundItems, width, height, scale, data.text);
        }
    },

    async processInventoryGrid(snapshot, width, height, scale) {
        const grid = globalThis.LiveCalibration?.getGrid();
        if (!grid) return;

        const cellRects = this.calculateCellRects(grid);
        const ocrCanvas = VisionService.createFilteredOcrCanvas(snapshot, width, height, grid);

        ScannerHUD.updateScrollStatus("scanning");

        const chunks = [[], [], []];
        cellRects.forEach((cell, i) => chunks[i % 3].push(cell));

        const workers = OCRRepository.workers;
        const bWorkers = OCRRepository.badgeWorkers;
        //sequential read to avoid future possible mobile errors
        await this.processCellChunk(chunks, workers, bWorkers, ocrCanvas, snapshot, grid);
        await this.processCellChunk(chunks[1], workers[1], bWorkers[1], ocrCanvas, snapshot, grid);
        await this.processCellChunk(chunks[2], workers[2], bWorkers[2], ocrCanvas, snapshot, grid);


        ScannerHUD.updateScrollStatus("done", this.sessionInventory.size);
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
