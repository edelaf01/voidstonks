class ScannerCalibration {
    constructor() {
        this.modal = document.getElementById("calibration-modal");
        this.canvas = document.getElementById("calibration-canvas");
        this.ctx = this.canvas ? this.canvas.getContext("2d") : null;
        this.btnNext = document.getElementById("calib-btn-next");
        this.instructions = document.getElementById("calibration-instructions");

        this.snapshotData = null;

        this.isDrawing = false;
        this.startX = 0;
        this.startY = 0;
        this.currentX = 0;
        this.currentY = 0;

        // Phase 1: Draw Top-Left Cell
        // Phase 2: Draw Bottom-Right Cell
        this.phase = 1;

        this.cellTL = null; // {x, y, w, h}
        this.cellBR = null; // {x, y, w, h}

        this.gridData = this.loadGrid();

        this.resolvePromise = null;

        if (this.canvas) {
            this.attachEvents();
        }
    }

    hasCalibration() {
        return this.gridData !== null;
    }

    getGrid() {
        return this.gridData; // {gridX, gridY, gridW, gridH, cellW, cellH, cols, rows}
    }

    loadGrid() {
        try {
            const stored = localStorage.getItem("vs_scanner_grid_calib");
            if (stored) return JSON.parse(stored);
        } catch (e) {
            console.error("Failed to load grid calibration");
        }
        return null;
    }

    saveGrid() {
        // We now have the exact Top-Left Cell and Bottom-Right Cell
        const cellW = (this.cellTL.w + this.cellBR.w) / 2;
        const cellH = (this.cellTL.h + this.cellBR.h) / 2;

        const gridX = this.cellTL.x;
        const gridY = this.cellTL.y;

        // Horizontal distance from TopLeft X to BotRight X = 5 column jumps
        const distX = this.cellBR.x - this.cellTL.x;
        const cols = 6;
        const totalJumpsX = cols - 1; // 5 jumps
        const gapX = (distX / totalJumpsX) - cellW;

        // Vertical distance
        const distY = this.cellBR.y - this.cellTL.y;
        // Estimate rows based on cell height + roughly gapX for Y gap
        const estimatedJumpY = cellH + gapX;
        const jumpsY = Math.max(1, Math.round(distY / estimatedJumpY));
        const rows = jumpsY + 1;

        let gapY = gapX;
        if (jumpsY > 0) {
            gapY = (distY / jumpsY) - cellH;
        }

        const gridW = (cols * cellW) + ((cols - 1) * gapX);
        const gridH = (rows * cellH) + (jumpsY * gapY);

        // Generate a preview tile out of the top-left cell
        const pCvs = document.createElement("canvas");
        pCvs.width = Math.floor(cellW); pCvs.height = Math.floor(cellH);
        const pCtx = pCvs.getContext("2d");
        pCtx.putImageData(this.snapshotData, -this.cellTL.x, -this.cellTL.y);
        const demoDataUrl = pCvs.toDataURL("image/jpeg", 0.5);

        const grid = {
            gridX: gridX,
            gridY: gridY,
            gridW: gridW,
            gridH: gridH,
            cellW: cellW,
            cellH: cellH,
            gapX: Math.max(0, gapX),
            gapY: Math.max(0, gapY),
            cols: cols,
            rows: rows,
            demoDataUrl: demoDataUrl
        };

        this.gridData = grid;
        localStorage.setItem("vs_scanner_grid_calib", JSON.stringify(grid));
        console.log("Grid calibrated from TL/BR anchors:", grid);
    }

    clearCalibration() {
        this.gridData = null;
        localStorage.removeItem("vs_scanner_grid_calib");
        console.log("Grid Calibration cleared");
    }

    attachEvents() {
        this.canvas.addEventListener("mousedown", (e) => this.onInteractStart(e));
        this.canvas.addEventListener("mousemove", (e) => this.onInteractMove(e));
        window.addEventListener("mouseup", (e) => this.onInteractEnd(e));

        // Touch support
        this.canvas.addEventListener("touchstart", (e) => {
            e.preventDefault();
            this.onInteractStart(e.touches[0]);
        });
        this.canvas.addEventListener("touchmove", (e) => {
            e.preventDefault();
            this.onInteractMove(e.touches[0]);
        });
        window.addEventListener("touchend", (e) => this.onInteractEnd(e));
    }

    getMousePos(evt) {
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.canvas.width / rect.width;
        const scaleY = this.canvas.height / rect.height;
        return {
            x: (evt.clientX - rect.left) * scaleX,
            y: (evt.clientY - rect.top) * scaleY
        };
    }

    onInteractStart(e) {
        if (!this.snapshotData || e.target !== this.canvas) return;
        const pos = this.getMousePos(e);
        this.isDrawing = true;
        this.startX = pos.x;
        this.startY = pos.y;
        this.currentX = pos.x;
        this.currentY = pos.y;
        this.drawState();
    }

    onInteractMove(e) {
        if (!this.isDrawing) return;
        const pos = this.getMousePos(e);
        this.currentX = pos.x;
        this.currentY = pos.y;
        this.drawState();
    }

    onInteractEnd(e) {
        if (!this.isDrawing) return;
        this.isDrawing = false;
    }

    drawState() {
        if (!this.ctx || !this.snapshotData) return;

        // Redraw base image
        this.ctx.putImageData(this.snapshotData, 0, 0);

        // Draw saved Phase 1 box if we are in Phase 2
        if (this.phase === 2 && this.cellTL) {
            this.ctx.strokeStyle = "rgba(0, 255, 255, 0.4)";
            this.ctx.lineWidth = 2;
            this.ctx.strokeRect(this.cellTL.x, this.cellTL.y, this.cellTL.w, this.cellTL.h);
            this.ctx.fillStyle = "rgba(0, 255, 255, 0.1)";
            this.ctx.fillRect(this.cellTL.x, this.cellTL.y, this.cellTL.w, this.cellTL.h);
        }

        // Draw current selection
        if (this.isDrawing || (this.startX !== this.currentX)) {
            const x = Math.min(this.startX, this.currentX);
            const y = Math.min(this.startY, this.currentY);
            const w = Math.abs(this.currentX - this.startX);
            const h = Math.abs(this.currentY - this.startY);

            const color = this.phase === 1 ? "0, 255, 255" : "255, 165, 0"; // Cyan for Grid, Orange for Cell
            this.ctx.fillStyle = `rgba(${color}, 0.2)`;
            this.ctx.fillRect(x, y, w, h);
            this.ctx.strokeStyle = `rgb(${color})`;
            this.ctx.lineWidth = 2;
            this.ctx.strokeRect(x, y, w, h);
        }
    }

    updateUI() {
        const t = globalThis.TEXTS[globalThis.state.currentLang].calib;
        if (this.phase === 1) {
            this.instructions.innerHTML = `<strong>STEP 1/2:</strong> ${t.step1}`;
            this.btnNext.innerText = t.btnNext;
            this.cellTL = null;
        } else if (this.phase === 2) {
            this.instructions.innerHTML = `<strong>STEP 2/2:</strong> ${t.step2}`;
            this.btnNext.innerText = t.btnNext;
            this.cellBR = null;
        }
    }

    async runCalibrationFlow(imageData) {
        return new Promise((resolve) => {
            this.snapshotData = imageData;
            this.phase = 1;
            this.startX = 0; this.currentX = 0;

            this.canvas.width = imageData.width;
            this.canvas.height = imageData.height;

            this.updateUI();
            this.drawState();

            this.modal.classList.remove("hidden");
            this.resolvePromise = resolve;
        });
    }

    confirmCalibration() {
        const x = Math.min(this.startX, this.currentX);
        const y = Math.min(this.startY, this.currentY);
        const w = Math.abs(this.currentX - this.startX);
        const h = Math.abs(this.currentY - this.startY);

        if (w < 20 || h < 20) {
            alert("Please draw a clear box first.");
            return;
        }

        if (this.phase === 1) {
            this.cellTL = { x, y, w, h };
            this.phase = 2;
            this.startX = 0; this.currentX = 0; // Reset drawing
            this.updateUI();
            this.drawState();
        } else if (this.phase === 2) {
            this.cellBR = { x, y, w, h };
            this.saveGrid();
            this.closeModal(true);
        }
    }

    cancelCalibration() {
        this.closeModal(false);
    }

    closeModal(success) {
        this.modal.classList.add("hidden");
        if (this.resolvePromise) {
            this.resolvePromise(success);
            this.resolvePromise = null;
        }
    }
}

globalThis.LiveCalibration = new ScannerCalibration();

// Expose confirm/cancel to global for HTML buttons
globalThis.confirmCalibration = () => globalThis.LiveCalibration.confirmCalibration();
globalThis.cancelCalibration = () => globalThis.LiveCalibration.cancelCalibration();
