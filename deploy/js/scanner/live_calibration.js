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
    return this.gridData;
  }

  /**
   * Loads calibration from localStorage.
   * Migrates old 2-cell format to null (requires recalibration).
   */
  loadGrid() {
    const stored = localStorage.getItem("vs_scanner_grid_calib");
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    // Migrate: old format had cellW/cellH instead of gridZone — discard it
    if (!parsed.gridZone) {
      console.log("[Calib] Old 2-cell calibration format detected — clearing, recalibration needed.");
      localStorage.removeItem("vs_scanner_grid_calib");
      return null;
    }
    return parsed;
  }

  saveGrid() {
    const x = Math.round(Math.min(this.startX, this.currentX));
    const y = Math.round(Math.min(this.startY, this.currentY));
    const w = Math.round(Math.abs(this.currentX - this.startX));
    const h = Math.round(Math.abs(this.currentY - this.startY));

    // Warframe inventory is strictly 3 rows vertical
    const rows = 3;
    const aspectRatio = w / h;
    let cols = Math.round(aspectRatio * rows);
    if (cols < 3) cols = 3;
    if (cols > 12) cols = 12;

    const cellW = Math.round(w / cols);
    const cellH = Math.round(h / rows);

    // Generate a small preview of the calibrated zone
    const pCvs = document.createElement("canvas");
    pCvs.width = Math.min(w, 200);
    pCvs.height = Math.min(h, 200);
    const pCtx = pCvs.getContext("2d");
    pCtx.putImageData(this.snapshotData, -x, -y);
    const demoDataUrl = pCvs.toDataURL("image/jpeg", 0.5);

    const grid = {
      gridZone: { x, y, w, h },
      gridX: x,
      gridY: y,
      gridW: w,
      gridH: h,
      cellW: cellW,
      cellH: cellH,
      gapX: 0,
      gapY: 0,
      cols: cols,
      rows: rows,
      demoDataUrl,
    };

    this.gridData = grid;
    localStorage.setItem("vs_scanner_grid_calib", JSON.stringify(grid));
    console.log(`[Calib] Zone calibrated: ${rows}r x ${cols}c (W:${cellW} H:${cellH})`, grid.gridZone);
  }

  clearCalibration() {
    this.gridData = null;
    localStorage.removeItem("vs_scanner_grid_calib");
    console.log("[Calib] Calibration cleared");
  }

  attachEvents() {
    this.canvas.addEventListener("mousedown", (e) => this.onInteractStart(e));
    this.canvas.addEventListener("mousemove", (e) => this.onInteractMove(e));
    globalThis.addEventListener("mouseup", (e) => this.onInteractEnd(e));

    this.canvas.addEventListener("touchstart", (e) => {
      e.preventDefault();
      this.onInteractStart(e.touches[0]);
    });
    this.canvas.addEventListener("touchmove", (e) => {
      e.preventDefault();
      this.onInteractMove(e.touches[0]);
    });
    globalThis.addEventListener("touchend", (e) => this.onInteractEnd(e));
  }

  getMousePos(evt) {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    return {
      x: (evt.clientX - rect.left) * scaleX,
      y: (evt.clientY - rect.top) * scaleY,
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
    this.ctx.putImageData(this.snapshotData, 0, 0);

    if (this.isDrawing || this.startX !== this.currentX) {
      const x = Math.min(this.startX, this.currentX);
      const y = Math.min(this.startY, this.currentY);
      const w = Math.abs(this.currentX - this.startX);
      const h = Math.abs(this.currentY - this.startY);

      this.ctx.fillStyle = "rgba(0, 229, 255, 0.12)";
      this.ctx.fillRect(x, y, w, h);
      this.ctx.strokeStyle = "#00e5ff";
      this.ctx.lineWidth = 2;
      this.ctx.setLineDash([6, 3]);
      this.ctx.strokeRect(x, y, w, h);
      this.ctx.setLineDash([]);

      // Show dimensions hint
      this.ctx.fillStyle = "rgba(0,229,255,0.9)";
      this.ctx.font = "bold 13px monospace";
      this.ctx.fillText(`${Math.round(w)} × ${Math.round(h)}`, x + 4, y + 16);
    }
  }

  updateUI() {
    const t = globalThis.TEXTS[globalThis.state.currentLang].calib;
    const titleEl = document.getElementById("lbl-calib-title");
    if (titleEl) titleEl.innerText = t.title;

    const skipBtn = document.getElementById("btn-calib-skip");
    if (skipBtn) skipBtn.innerText = t.btnSkip;

    this.instructions.innerHTML = `${t.step1}`;
    this.btnNext.innerText = t.btnNext;
  }

  async runCalibrationFlow(imageData) {
    return new Promise((resolve) => {
      this.snapshotData = imageData;
      this.startX = 0;
      this.currentX = 0;

      this.canvas.width = imageData.width;
      this.canvas.height = imageData.height;

      this.updateUI();
      this.drawState();

      this.modal.classList.remove("hidden");
      this.resolvePromise = resolve;
    });
  }

  confirmCalibration() {
    const w = Math.abs(this.currentX - this.startX);
    const h = Math.abs(this.currentY - this.startY);

    if (w < 50 || h < 50) {
      alert("Please draw a clear box around the inventory grid first.");
      return;
    }

    this.saveGrid();
    this.closeModal(true);
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

globalThis.confirmCalibration = () =>
  globalThis.LiveCalibration.confirmCalibration();
globalThis.cancelCalibration = () =>
  globalThis.LiveCalibration.cancelCalibration();
