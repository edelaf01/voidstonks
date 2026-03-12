/**
 * GridCellEditor — screenshot-based grid calibration fine-tuner.
 *
 * • Drag any cell  → moves the ENTIRE grid (global dx/dy)
 * • ↑↓←→ keys     → 1px nudge (SHIFT = 5px)
 * • W / H buttons  → resize all cells (cellW / cellH)
 *
 * On "SAVE", all changes are baked into the stored grid calibration.
 */
class GridCellEditor {
    constructor() {
        this._modal = null;
        this._canvas = null;
        this._ctx = null;
        this._grid = null;
        this._snapshot = null;

        this._offset = this._loadOffset();

        this._dragging = false;
        this._dragStartX = 0;
        this._dragStartY = 0;
        this._origDx = 0;
        this._origDy = 0;

        this._active = false;
        this._keyHandler = null;
    }


    open(grid, videoEl) {
        if (this._active) return;
        this._grid = Object.assign({}, grid);
        this._active = true;
        this._buildModal(videoEl);
    }

    close() {
        this._active = false;
        if (this._keyHandler) {
            window.removeEventListener('keydown', this._keyHandler);
            this._keyHandler = null;
        }
        if (this._modal) {
            this._modal.remove();
            this._modal = null;
            this._canvas = null;
            this._ctx = null;
        }
    }

    getOffset() { return this._offset; }
    getEditedGrid() { return this._grid; }

    resetOffsets() {
        this._offset = { dx: 0, dy: 0 };
        localStorage.removeItem('vs_scanner_grid_offset');
    }

    // ── INTERNALS ──────────────────────────────────────────────────────────

    _loadOffset() {
        try {
            const s = localStorage.getItem('vs_scanner_grid_offset');
            if (s) return JSON.parse(s);
        } catch (e) { }
        return { dx: 0, dy: 0 };
    }

    _saveOffset() {
        localStorage.setItem('vs_scanner_grid_offset', JSON.stringify(this._offset));
    }

    _cellRect(r, c) {
        const { gridX, gridY, cellW, cellH, gapX, gapY } = this._grid;
        return {
            sx: gridX + c * (cellW + gapX) + this._offset.dx,
            sy: gridY + r * (cellH + gapY) + this._offset.dy,
        };
    }

    // ─── build the modal ────────────────────────────────────────────────────
    _buildModal(videoEl) {
        const vw = videoEl.videoWidth || 1280;
        const vh = videoEl.videoHeight || 720;

        // Capture frame
        const snap = document.createElement('canvas');
        snap.width = vw; snap.height = vh;
        try { snap.getContext('2d').drawImage(videoEl, 0, 0); } catch (e) { }
        this._snapshot = snap;

        // Backdrop
        const modal = document.createElement('div');
        modal.id = 'grid-editor-modal';
        modal.style.cssText = `
      position:fixed;inset:0;z-index:20000;
      background:rgba(0,0,0,0.92);
      display:flex;flex-direction:column;align-items:center;
      padding:8px;box-sizing:border-box;
      font-family:'Segoe UI',system-ui,sans-serif;
      gap:6px;
    `;

        // ── Top bar ───────────────────────────────────────────────────────────
        const bar = document.createElement('div');
        bar.style.cssText = `
      display:flex;align-items:center;gap:10px;padding:7px 14px;
      background:rgba(0,10,20,0.97);border:1px solid rgba(0,229,255,0.4);
      border-radius:7px;width:100%;max-width:1100px;box-sizing:border-box;
      flex-shrink:0;flex-wrap:wrap;row-gap:6px;
    `;

        const sh = globalThis.TEXTS[globalThis.state.currentLang].scannerHUD;
        const g = this._grid;

        bar.innerHTML = `
      <span style="font-size:0.72em;font-weight:800;letter-spacing:2px;color:#00e5ff;white-space:nowrap;">${sh.editTitle}</span>
      <span style="font-size:0.6em;color:#3a5060;flex:1;min-width:120px;">
        ${sh.editGuide}
      </span>

      <!-- Position readout -->
      <span id="ge-pos-label" style="font-size:0.65em;color:#7cada8;font-family:monospace;white-space:nowrap;">dx=0 dy=0</span>

      <!-- Separator -->
      <span style="color:#1e2e3e;font-size:0.8em;">│</span>

      <!-- Cell Width control -->
      <div style="display:flex;align-items:center;gap:4px;">
        <span style="font-size:0.6em;color:#506070;letter-spacing:1px;">W</span>
        <button id="ge-w-minus" style="${this._btnStyle('#7cada8')}">−</button>
        <span id="ge-w-val" style="font-size:0.68em;color:#e0e0e0;font-family:monospace;min-width:30px;text-align:center;">${Math.round(g.cellW)}</span>
        <button id="ge-w-plus"  style="${this._btnStyle('#7cada8')}">+</button>
      </div>

      <!-- Cell Height control -->
      <div style="display:flex;align-items:center;gap:4px;">
        <span style="font-size:0.6em;color:#506070;letter-spacing:1px;">H</span>
        <button id="ge-h-minus" style="${this._btnStyle('#7cada8')}">−</button>
        <span id="ge-h-val" style="font-size:0.68em;color:#e0e0e0;font-family:monospace;min-width:30px;text-align:center;">${Math.round(g.cellH)}</span>
        <button id="ge-h-plus"  style="${this._btnStyle('#7cada8')}">+</button>
      </div>

      <!-- Separator -->
      <span style="color:#1e2e3e;font-size:0.8em;">│</span>

      <!-- Reset + Save -->
      <button id="ge-reset" style="${this._btnStyle('#c07070', 'rgba(255,100,100,0.3)')}">${sh.btnReset} Reset</button>
      <button id="ge-done"  style="
        background:rgba(0,229,255,0.15);border:1px solid rgba(0,229,255,0.5);
        color:#00e5ff;font-size:0.7em;padding:5px 18px;
        border-radius:5px;cursor:pointer;font-weight:800;letter-spacing:1px;
        white-space:nowrap;
      ">${sh.btnDone}</button>
    `;

        // ── Canvas ───────────────────────────────────────────────────────────
        const canvas = document.createElement('canvas');
        canvas.style.cssText = `
      max-width:100%;max-height:calc(100vh - 90px);
      border:1px solid rgba(0,229,255,0.18);border-radius:4px;
      cursor:crosshair;display:block;flex-shrink:1;
    `;
        canvas.width = vw;
        canvas.height = vh;

        modal.appendChild(bar);
        modal.appendChild(canvas);
        document.body.appendChild(modal);

        this._modal = modal;
        this._canvas = canvas;
        this._ctx = canvas.getContext('2d');

        this._draw();

        // ── Events ─────────────────────────────────────────────────────────
        canvas.addEventListener('mousedown', e => this._onDown(e));
        canvas.addEventListener('mousemove', e => this._onMove(e));
        window.addEventListener('mouseup', e => this._onUp(e));

        this._keyHandler = e => this._onKey(e);
        window.addEventListener('keydown', this._keyHandler);

        const step = e => e.shiftKey ? 5 : 1;

        document.getElementById('ge-done').onclick = () => globalThis.closeGridEditor();
        document.getElementById('ge-reset').onclick = () => {
            this.resetOffsets();
            this._draw();
            this._updateLabel();
        };
        document.getElementById('ge-w-minus').onclick = () => this._resize('cellW', -step(window.event || {}));
        document.getElementById('ge-w-plus').onclick = () => this._resize('cellW', +step(window.event || {}));
        document.getElementById('ge-h-minus').onclick = () => this._resize('cellH', -step(window.event || {}));
        document.getElementById('ge-h-plus').onclick = () => this._resize('cellH', +step(window.event || {}));

        // Shift+click for bigger steps
        ['ge-w-minus', 'ge-w-plus', 'ge-h-minus', 'ge-h-plus'].forEach(id => {
            const btn = document.getElementById(id);
            btn.addEventListener('click', e => {
                const delta = (e.shiftKey ? 5 : 1) * (id.includes('minus') ? -1 : 1);
                const key = id.includes('-w-') ? 'cellW' : 'cellH';
                this._resize(key, delta);
                e.stopPropagation();
            }, true);
            // override the simple onclick above
            btn.onclick = null;
        });
    }

    _btnStyle(color, border) {
        const b = border || `rgba(100,160,180,0.3)`;
        return `background:none;border:1px solid ${b};color:${color};
      font-size:0.72em;padding:3px 8px;border-radius:4px;cursor:pointer;
      font-weight:700;min-width:24px;white-space:nowrap;`;
    }

    _resize(key, delta) {
        this._grid[key] = Math.max(20, Math.round(this._grid[key] + delta));
        const id = key === 'cellW' ? 'ge-w-val' : 'ge-h-val';
        const el = document.getElementById(id);
        if (el) el.textContent = Math.round(this._grid[key]);
        this._draw();
    }

    // ── Interaction ─────────────────────────────────────────────────────────
    _getPos(e) {
        const r = this._canvas.getBoundingClientRect();
        return {
            x: (e.clientX - r.left) * (this._canvas.width / r.width),
            y: (e.clientY - r.top) * (this._canvas.height / r.height),
        };
    }

    _hitAnyCell(x, y) {
        const { rows, cols, cellW, cellH } = this._grid;
        for (let r = 0; r < rows; r++)
            for (let c = 0; c < cols; c++) {
                const { sx, sy } = this._cellRect(r, c);
                if (x >= sx && x <= sx + cellW && y >= sy && y <= sy + cellH) return true;
            }
        return false;
    }

    _onDown(e) {
        const pos = this._getPos(e);
        if (this._hitAnyCell(pos.x, pos.y)) {
            this._dragging = true;
            this._dragStartX = pos.x;
            this._dragStartY = pos.y;
            this._origDx = this._offset.dx;
            this._origDy = this._offset.dy;
            this._canvas.style.cursor = 'grabbing';
        }
        e.preventDefault();
    }

    _onMove(e) {
        if (!this._dragging) return;
        const pos = this._getPos(e);
        this._offset.dx = Math.round(this._origDx + (pos.x - this._dragStartX));
        this._offset.dy = Math.round(this._origDy + (pos.y - this._dragStartY));
        this._saveOffset();
        this._draw();
        this._updateLabel();
        e.preventDefault();
    }

    _onUp() {
        this._dragging = false;
        if (this._canvas) this._canvas.style.cursor = 'crosshair';
    }

    _onKey(e) {
        if (!this._active) return;
        const step = e.shiftKey ? 5 : 1;
        const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
        const d = moves[e.key];
        if (d) {
            e.preventDefault();
            this._offset.dx += d[0];
            this._offset.dy += d[1];
            this._saveOffset();
            this._draw();
            this._updateLabel();
        }
    }

    _updateLabel() {
        const lbl = document.getElementById('ge-pos-label');
        if (lbl) lbl.textContent = `dx=${this._offset.dx} dy=${this._offset.dy}`;
    }

    // ── Draw ────────────────────────────────────────────────────────────────
    _draw() {
        const ctx = this._ctx;
        if (!ctx) return;
        const { rows, cols, cellW, cellH } = this._grid;

        ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
        if (this._snapshot) ctx.drawImage(this._snapshot, 0, 0);

        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const { sx, sy } = this._cellRect(r, c);

                ctx.fillStyle = 'rgba(0,229,255,0.07)';
                ctx.strokeStyle = '#00e5ff';
                ctx.lineWidth = 1.5;
                ctx.fillRect(sx, sy, cellW, cellH);
                ctx.strokeRect(sx, sy, cellW, cellH);

                ctx.fillStyle = 'rgba(0,229,255,0.65)';
                ctx.font = 'bold 10px monospace';
                ctx.fillText(`${r},${c}`, sx + 4, sy + 13);
            }
        }

        // Dim crosshair
        const cx = (this._grid.gridX + this._offset.dx) + (cols * (cellW + this._grid.gapX)) / 2;
        const cy = (this._grid.gridY + this._offset.dy) + (rows * (cellH + this._grid.gapY)) / 2;
        ctx.strokeStyle = 'rgba(0,229,255,0.2)';
        ctx.lineWidth = 0.5;
        ctx.setLineDash([4, 6]);
        ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, this._canvas.height); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(this._canvas.width, cy); ctx.stroke();
        ctx.setLineDash([]);
    }
}

// ── Global singleton + API ──────────────────────────────────────────────────
globalThis.GridCellEditor = new GridCellEditor();

globalThis.openGridEditor = function () {
    const grid = globalThis.LiveCalibration?.getGrid();
    if (!grid) {
        (typeof showToast === 'function' ? showToast : alert)('No grid calibration found. Calibrate first.');
        return;
    }
    const video = document.getElementById('live-video');
    globalThis.GridCellEditor.open(grid, video || document.createElement('video'));
};

globalThis.closeGridEditor = function () {
    const editor = globalThis.GridCellEditor;
    const calib = globalThis.LiveCalibration;
    if (calib && editor) {
        const off = editor.getOffset();
        const edited = editor.getEditedGrid();
        // Merge position shift + size changes back into the stored grid
        edited.gridX += off.dx;
        edited.gridY += off.dy;
        // Update the live calibration object's gridData directly
        calib.gridData = edited;
        localStorage.setItem('vs_scanner_grid_calib', JSON.stringify(edited));
        editor.resetOffsets();
        const msg = `Grid saved — W:${Math.round(edited.cellW)} H:${Math.round(edited.cellH)} dx:${off.dx} dy:${off.dy}`;
        if (typeof showToast === 'function') showToast(msg);
    }
    editor.close();
};

globalThis.resetGridOffsets = function () {
    globalThis.GridCellEditor.resetOffsets();
    (typeof showToast === 'function' ? showToast : alert)('Grid offset reset.');
};
