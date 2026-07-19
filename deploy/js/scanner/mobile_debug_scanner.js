import { MobileScanner } from "./mobile_scanner.js";
import { OCRRepository } from "../repositories/ocr.repository.js";
import { OCRService } from "../services/ocr.service.js?v=264";
import { showToast } from "../ui.components/ui_components.js";


export class MobileDebugScanner extends MobileScanner {
    constructor() {
        super();
        this.debugPanel = null;
        this.frameCounter = 0;
        this.detectionCount = 0;
        this.isDebugScanner = true;
    }

    async start() {
        OCRService.initMatcherData();
        await OCRRepository.warmUp();

        try {
            await super.start();
        } catch (e) {
            console.warn("MobileDebugScanner: Camera blocked/unavailable. Loading UI anyway.", e);
            this.createOverlay();
            showToast("Camera blocked - Use SCREEN mode", "warning");
        }

        this.initDebugUI();
        this.makeGuideInteractive();

        this.onDiscoveryFrame = (matches, vidW, vidH, cY, cvs) => {
            this.frameCounter++;
            this.detectionCount = matches.length;

            const elY = document.getElementById("debug-crop-y");
            const elH = document.getElementById("debug-crop-h");
            const elF = document.getElementById("debug-frame-count");
            const elD = document.getElementById("debug-detect-count");

            if (elY) elY.innerText = `${cY}px`;
            if (elH) elH.innerText = `${vidH}px`;
            if (elF) elF.innerText = this.frameCounter;
            if (elD) {
                elD.innerText = this.detectionCount;
                elD.style.color = this.detectionCount > 0 ? "#00ff78" : "#f1c40f";
            }

            // Draw to Live Preview
            if (cvs && this.livePreview) {
                const ctx = this.livePreview.getContext("2d");
                this.livePreview.width = cvs.width;
                this.livePreview.height = cvs.height;
                ctx.drawImage(cvs, 0, 0);
            }

            // Log to Live Log
            if (this.liveLog) {
                if (matches.length > 0) {
                    const entry = document.createElement("div");
                    entry.style.cssText = "padding:2px 0; border-bottom:1px solid #222;";
                    entry.innerHTML = `<span style="color:#00ff78;">[${new Date().toLocaleTimeString()}]</span> ${matches.map(m => m.name).join(", ")}`;
                    this.liveLog.prepend(entry);
                } else if (this.frameCounter % 10 === 0) {
                    // Show heartbeat every 10 frames if empty to show it's working
                    const entry = document.createElement("div");
                    entry.style.cssText = "padding:2px 0; border-bottom:1px solid #111; opacity:0.3; font-style:italic;";
                    entry.innerHTML = `<span>[${new Date().toLocaleTimeString()}]</span> Scanning...`;
                    this.liveLog.prepend(entry);
                }
                if (this.liveLog.children.length > 30) this.liveLog.lastElementChild.remove();
            }
        };
    }

    initDebugUI() {
        if (document.getElementById("debug-scanner-dashboard")) return;

        const dash = document.createElement("div");
        dash.id = "debug-scanner-dashboard";
        dash.style.cssText = `
            position: fixed; top: 0; right: 0; width: 320px; height: 100vh;
            background: rgba(10, 15, 25, 0.98); border-left: 2px solid #00e5ff;
            color: #e0e0e0; font-family: 'Segoe UI', system-ui, sans-serif; font-size: 10px;
            z-index: 1000015; display: flex; flex-direction: column; 
            box-shadow: -10px 0 30px rgba(0,0,0,0.8); backdrop-filter: blur(20px);
            pointer-events: auto;
        `;

        dash.innerHTML = `
            <div style="background:linear-gradient(90deg, #00e5ff, #008cff); color:#000; padding:12px; font-weight:900; letter-spacing:1.5px; display:flex; justify-content:space-between; align-items:center;">
                <span>V CALIBRATION STATION</span>
                <button onclick="globalThis.currentScanner.close(); document.getElementById('debug-scanner-dashboard').remove();" style="background:rgba(0,0,0,0.2); border:none; color:white; padding:4px 8px; border-radius:4px; cursor:pointer; font-weight:bold;">✕</button>
            </div>
            <div style="flex:1; overflow-y:auto; padding-bottom:40px;">
                <!-- SECCIÓN 1: PROCESADO VISUAL (OPENCV) -->
                <div style="padding:15px; border-bottom:1px solid rgba(0,229,255,0.1); background:rgba(0,229,255,0.02);">
                    <div style="color:#00e5ff; font-weight:800; margin-bottom:10px; font-size:11px; display:flex; justify-content:space-between;">
                        <span> FILTROS OPENCV</span>
                    </div>

                    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-bottom:10px;">
                        <div>
                            <label style="display:flex; justify-content:space-between; font-size:8px; color:#888;">CONTRASTE: <span id="debug-val-contrast" style="color:#fff;">${state.visionSettings.contrast || 1.0}</span></label>
                            <input type="range" min="0.5" max="3.0" value="${state.visionSettings.contrast || 1.0}" step="0.1" style="width:100%;" oninput="document.getElementById('debug-val-contrast').innerText = this.value; globalThis.updateVisionSetting('contrast', parseFloat(this.value))">
                        </div>
                        <div>
                            <label style="display:flex; justify-content:space-between; font-size:8px; color:#888;">BRILLO: <span id="debug-val-bright" style="color:#fff;">${state.visionSettings.brightness || 0}</span></label>
                            <input type="range" min="-100" max="100" value="${state.visionSettings.brightness || 0}" step="1" style="width:100%;" oninput="document.getElementById('debug-val-bright').innerText = this.value; globalThis.updateVisionSetting('brightness', parseInt(this.value))">
                        </div>
                    </div>

                    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-bottom:10px;">
                        <div>
                            <label style="display:flex; justify-content:space-between; font-size:8px; color:#888;">THRESH C: <span id="debug-val-threshC" style="color:#fff;">${state.visionSettings.thresholdC}</span></label>
                            <input type="range" min="-30" max="10" value="${state.visionSettings.thresholdC}" step="1" style="width:100%;" oninput="document.getElementById('debug-val-threshC').innerText = this.value; globalThis.updateVisionSetting('thresholdC', parseInt(this.value))">
                        </div>
                        <div>
                            <label style="display:flex; justify-content:space-between; font-size:8px; color:#888;">BLOCK: <span id="debug-val-block" style="color:#fff;">${state.visionSettings.blockSize || 31}</span></label>
                            <input type="range" min="3" max="99" value="${state.visionSettings.blockSize || 31}" step="2" style="width:100%;" oninput="document.getElementById('debug-val-block').innerText = this.value; globalThis.updateVisionSetting('blockSize', parseInt(this.value))">
                        </div>
                    </div>

                    <div style="display:grid; grid-template-columns: 1fr 1fr 1fr 1fr 1fr; gap:6px; margin-bottom:10px;">
                        <div>
                            <label style="font-size:7px; color:#888;">DILATE</label>
                            <input type="range" min="0" max="5" value="${state.visionSettings.dilation || 0}" style="width:100%;" oninput="globalThis.updateVisionSetting('dilation', parseInt(this.value))">
                        </div>
                        <div>
                            <label style="font-size:7px; color:#888;">ERODE</label>
                            <input type="range" min="0" max="5" value="${state.visionSettings.erosion || 0}" style="width:100%;" oninput="globalThis.updateVisionSetting('erosion', parseInt(this.value))">
                        </div>
                        <div>
                            <label style="font-size:7px; color:#888;">CLAHE</label>
                            <input type="range" min="0" max="5" value="${state.visionSettings.claheClip}" step="0.5" style="width:100%;" oninput="globalThis.updateVisionSetting('claheClip', parseFloat(this.value))">
                        </div>
                        <div>
                            <label style="font-size:7px; color:#c0392b; font-weight:900;">MEDIAN</label>
                            <input type="range" min="0" max="9" step="1" value="${state.visionSettings.medianBlur || 0}" style="width:100%;" oninput="globalThis.updateVisionSetting('medianBlur', parseInt(this.value))">
                        </div>
                        <div>
                            <label style="font-size:7px; color:#f39c12; font-weight:900;">SHARP</label>
                            <input type="range" min="0" max="1" step="1" value="${state.visionSettings.sharpen || 0}" style="width:100%;" oninput="globalThis.updateVisionSetting('sharpen', parseInt(this.value))">
                        </div>
                    </div>
                </div>

                <!-- SECCIÓN 2: LECTURA TEXTO (TESSERACT) -->
                <div style="padding:15px; border-bottom:1px solid rgba(255,255,255,0.05); background:rgba(255,255,255,0.01);">
                    <div style="color:#f1c40f; font-weight:800; margin-bottom:10px; font-size:11px;">🔤 TESSERACT OCR</div>
                    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-bottom:10px;">
                        <div>
                            <label style="font-size:8px; color:#888;">PSM MODE</label>
                            <select style="width:100%; background:#222; color:#fff; border:1px solid #444; font-size:9px; padding:2px;" onchange="globalThis.updateVisionSetting('tesseractPSM', parseInt(this.value))">
                                <option value="3" ${state.visionSettings.tesseractPSM === 3 ? 'selected' : ''}>3 (Auto)</option>
                                <option value="6" ${state.visionSettings.tesseractPSM === 6 ? 'selected' : ''}>6 (Uniform)</option>
                                <option value="7" ${state.visionSettings.tesseractPSM === 7 ? 'selected' : ''}>7 (Single Line)</option>
                                <option value="11" ${state.visionSettings.tesseractPSM === 11 ? 'selected' : ''}>11 (Sparse)</option>
                            </select>
                        </div>
                        <div>
                            <label style="font-size:8px; color:#888;">IDIOMA</label>
                            <select style="width:100%; background:#222; color:#fff; border:1px solid #444; font-size:9px; padding:2px;" onchange="globalThis.updateVisionSetting('ocrLang', this.value)">
                                <option value="eng" ${state.visionSettings.ocrLang === 'eng' ? 'selected' : ''}>ENGLISH (Recomendado)</option>
                                <option value="spa" ${state.visionSettings.ocrLang === 'spa' ? 'selected' : ''}>SPANISH</option>
                            </select>
                        </div>
                    </div>
                    <div style="display:flex; gap:6px;">
                        <button id="btn-show-roi" onclick="globalThis.updateVisionSetting('showROI', !state.visionSettings.showROI); this.style.opacity = state.visionSettings.showROI ? 1 : 0.5;" style="flex:1; padding:4px; font-size:8px; background:#00ff78; color:#000; border:none; border-radius:3px; font-weight:bold;">👁️ SHOW ROI BOXES</button>
                        <button onclick="console.log('--- VISION SETTINGS EXPORT ---'); console.log(JSON.stringify(state.visionSettings, null, 2)); alert('Settings exportados a la Consola (F12)');" style="flex:1; padding:4px; font-size:8px; background:#222; color:#fff; border:1px solid #444; border-radius:3px;">📤 EXPORT JSON</button>
                    </div>
                </div>

                <!-- SECCIÓN 3: CALIBRACIÓN SEMÁNTICA -->
                <div style="padding:15px; border-bottom:1px solid rgba(255,255,255,0.05); background:rgba(0,0,0,0.1);">
                    <button id="btn-auto-calibrate" onclick="globalThis.currentScanner.toggleAutoCalibrate()" style="width:100%; padding:10px; border:1px solid #444; background:rgba(255,255,255,0.05); color:#aaa; font-size:10px; font-weight:bold; border-radius:4px; cursor:pointer; margin-bottom:8px;">
                        ${state.visionSettings.autoCalibrate ? '🟢 AUTO-CALIBRATE: ON' : '🔴 AUTO-CALIBRATE: OFF'}
                    </button>
                    <div id="debug-semantic-color" style="font-size:9px; color:#888; text-align:center;">HSV: NONE</div>
                </div>

                <!-- SECCIÓN 4: GEOMETRÍA Y SESIÓN -->
                <div style="padding:15px; border-bottom:1px solid #333; background:rgba(0,0,0,0.2);">
                    <div style="color:#00e5ff; font-weight:800; margin-bottom:10px; font-size:11px;">🛠️ GEOMETRÍA</div>
                    
                    <div style="margin-bottom:10px;">
                        <label style="display:flex; justify-content:space-between; font-size:8px; color:#888;">POSICIÓN Y (%): <span id="debug-val-guideY" style="color:#fff;">${this.guideY || 50}</span></label>
                        <input type="range" min="0" max="100" value="${this.guideY || 50}" style="width:100%;" oninput="document.getElementById('debug-val-guideY').innerText = this.value; globalThis.currentScanner.updateGuidePos(null, parseInt(this.value))">
                    </div>

                    <div style="margin-bottom:10px;">
                        <label style="display:flex; justify-content:space-between; font-size:8px; color:#888;">ALTURA CROP (PX): <span id="debug-val-guideH" style="color:#fff;">${this.guideH || 450}</span></label>
                        <input type="range" min="100" max="800" value="${this.guideH || 450}" step="10" style="width:100%;" oninput="document.getElementById('debug-val-guideH').innerText = this.value; globalThis.currentScanner.updateGuidePos(null, null, parseInt(this.value))">
                    </div>

                    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:6px; margin-bottom:12px;">
                        <button onclick="globalThis.currentScanner.switchToScreen()" style="padding:8px; background:rgba(0,229,255,0.1); border:1px solid #00e5ff; color:#00e5ff; font-size:10px; cursor:pointer; border-radius:4px; font-weight:900;">🖥️ PANTALLA</button>
                        <button onclick="globalThis.currentScanner.resetCalibration()" style="padding:8px; background:rgba(255,255,255,0.05); border:1px solid #444; color:#aaa; font-size:10px; cursor:pointer; border-radius:4px;">🔄 RESET</button>
                    </div>
                    <input type="file" id="debug-photo-input" accept="image/*" style="display:none;" onchange="globalThis.currentScanner.processUploadedPhoto(this.files[0]); this.value='';">
                    <button onclick="document.getElementById('debug-photo-input').click()" style="width:100%; padding:10px; background:rgba(0,255,120,0.12); border:1px solid #00ff78; color:#00ff78; font-size:11px; cursor:pointer; border-radius:4px; font-weight:900; margin-bottom:12px;">📁 SUBIR FOTO (procesar)</button>
                    <div style="display:flex; justify-content:space-between; font-size:9px; color:#888; margin-bottom:4px;">
                        <span>CROP Y:</span> <span id="debug-crop-y" style="font-weight:bold; color:#00ff78;">AUTO</span>
                    </div>
                    <div style="display:flex; justify-content:space-between; font-size:9px;">
                        <span>FRAMES:</span> <span id="debug-frame-count">0</span>
                    </div>
                    <div style="display:flex; justify-content:space-between; font-size:9px; margin-top:4px;">
                        <span>DETECT:</span> <span id="debug-detect-count" style="color:#f1c40f">0</span>
                    </div>
                </div>

                <div style="padding:15px; display:flex; flex-direction:column; gap:10px;">
                    <div style="color:#00e5ff; font-weight:800; font-size:11px;">🔍 LIVE VISION (ROI DETECT)</div>
                    <canvas id="debug-live-preview" style="width:100%; max-height:150px; background:#000; border:1px solid #333; border-radius:4px;"></canvas>
                    <canvas id="debug-live-original" style="display:none;"></canvas>
                    
                    <div style="color:#00e5ff; font-weight:800; font-size:11px; margin-top:10px;">📋 REAL-TIME OCR LOG</div>
                    <div id="debug-live-log" style="height:120px; background:rgba(0,0,0,0.3); border:1px solid #222; border-radius:4px; font-family:monospace; font-size:9px; color:#aaa; overflow-y:auto; padding:8px; display:flex; flex-direction:column-reverse;"></div>
                </div>
                
                <div id="debug-visual-feed" style="padding:12px; display:flex; flex-direction:column; gap:20px; border-top:1px solid #222;"></div>
            </div>
        `;

        const overlay = document.getElementById("mobile-scan-overlay");
        if (overlay) overlay.appendChild(dash);
        else document.body.appendChild(dash);

        this.debugPanel = document.getElementById("debug-visual-feed");
        this.livePreview = document.getElementById("debug-live-preview");
        this.liveOriginal = document.getElementById("debug-live-original");
        this.liveLog = document.getElementById("debug-live-log");
    }


    toggleAutoCalibrate() {
        const val = !state.visionSettings.autoCalibrate;
        globalThis.updateVisionSetting('autoCalibrate', val);
        const btn = document.getElementById("btn-auto-calibrate");
        if (btn) {
            btn.style.background = val ? '#f1c40f' : 'rgba(255,255,255,0.05)';
            btn.style.color = val ? '#000' : '#aaa';
            btn.style.borderColor = val ? '#000' : '#444';
            btn.innerText = val ? '🟢 AUTO-CALIBRATE: ON' : '🔴 AUTO-CALIBRATE: OFF';
        }
    }

    // En debug forzamos la galería de tiras para inspeccionar el preprocesado; el resto lo hace la base.
    async processUploadedPhoto(file) {
        this.debugMode = true;
        return super.processUploadedPhoto(file);
    }


    guideX = 50; guideY = 50;
    guideW = 90; guideH = 450;

    makeGuideInteractive() {
        const guide = this.guide;
        if (!guide) return;

        guide.style.cursor = "move";
        guide.style.borderStyle = "solid";
        guide.style.pointerEvents = "auto";
        guide.style.touchAction = "none";
        guide.style.maxWidth = "none";
        guide.style.userSelect = "none";
        guide.style.overflow = "visible";
        //TODO mal uso z index en general 
        guide.style.zIndex = "1000000";

        const handle = document.createElement("div");
        handle.id = "scanner-resize-handle";
        handle.style.cssText = `
        position: absolute; bottom: -10px; right: -10px; width: 60px; height: 60px;
        background: linear - gradient(135deg, transparent 50 %, #f1c40f 50 %);
        cursor: nwse - resize; z - index: 2000000; display: flex; align - items: flex - end;
        justify - content: flex - end; padding: 8px; color:#000; font - size: 18px;
        font - weight: bold; pointer - events: auto; border - radius: 0 0 10px 0;
        box - shadow: 5px 5px 15px rgba(0, 0, 0, 0.5); touch - action: none;
        `;
        handle.innerText = "⇲";
        guide.appendChild(handle);

        let activeAction = null;
        let lastX, lastY;

        const syncCalibration = () => {
            const videoRect = this.video.getBoundingClientRect();
            const rect = guide.getBoundingClientRect();
            const scaleH = this.video.videoHeight / videoRect.height;
            const scaleW = this.video.videoWidth / videoRect.width;

            // Mapeo pixels
            this.calibratedCropY = Math.max(0, (rect.top - videoRect.top) * scaleH);
            this.calibratedCropX = Math.max(0, (rect.left - videoRect.left) * scaleW);
            this.calibratedCropW = rect.width * scaleW;
            this.calibratedCropH = rect.height * scaleH;

            // Actualizar Dashboard
            const yEl = document.getElementById("debug-crop-y");
            const hEl = document.getElementById("debug-crop-h");
            if (yEl) yEl.innerText = `${Math.floor(this.calibratedCropY)} px`;
            if (hEl) hEl.innerText = `${Math.floor(this.calibratedCropH)} px`;
        };

        const onStart = (e) => {
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;

            const isHandle = e.target.closest('#scanner-resize-handle');
            activeAction = isHandle ? 'resize' : 'drag';

            lastX = clientX;
            lastY = clientY;

            guide.style.borderColor = isHandle ? "#f1c40f" : "#00ff78";
            guide.style.boxShadow = `0 0 30px ${isHandle ? "#f1c40f" : "#00ff78"} `;

            e.stopPropagation();
            if (e.cancelable) e.preventDefault();
        };

        const onMove = (e) => {
            if (!activeAction) return;
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;

            const dx = clientX - lastX;
            const dy = clientY - lastY;

            requestAnimationFrame(() => {
                const containerW = window.innerWidth;
                const containerH = window.innerHeight;

                if (activeAction === 'drag') {
                    this.guideX += (dx / containerW) * 100;
                    this.guideY += (dy / containerH) * 100;
                    guide.style.left = `${this.guideX}% `;
                    guide.style.top = `${this.guideY}% `;
                } else {
                    this.guideW += (dx / containerW) * 100;
                    this.guideH += dy;
                    guide.style.width = `${Math.max(10, this.guideW)}% `;
                    guide.style.height = `${Math.max(50, this.guideH)} px`;
                }

                lastX = clientX;
                lastY = clientY;
                syncCalibration();
            });
        };

        const onEnd = () => {
            activeAction = null;
            guide.style.borderColor = "rgba(255,255,255,0.7)";
            guide.style.boxShadow = "0 0 15px rgba(0,229,255,0.3)";
        };

        guide.addEventListener("mousedown", onStart);
        handle.addEventListener("mousedown", onStart);
        globalThis.addEventListener("mousemove", onMove);
        globalThis.addEventListener("mouseup", onEnd);
        guide.addEventListener("touchstart", onStart, { passive: false });
        handle.addEventListener("touchstart", onStart, { passive: false });
        globalThis.addEventListener("touchmove", onMove, { passive: false });
        globalThis.addEventListener("touchend", onEnd);
        setTimeout(syncCalibration, 500);
    }

    resetCalibration() {
        this.guideX = 50; this.guideY = 50;
        this.guideW = 90; this.guideH = 180;
        const guide = this.guide;
        if (guide) {
            guide.style.left = "50%";
            guide.style.top = "50%";
            guide.style.width = "90%";
            guide.style.height = "180px";
        }
        this.calibratedCropX = -1;
        this.calibratedCropY = -1;
        this.calibratedCropW = -1;
        this.calibratedCropH = 450;
    }

    updateGuidePos(nx, ny, nh) {
        if (nx !== null && nx !== undefined) this.guideX = nx;
        if (ny !== null && ny !== undefined) this.guideY = ny;
        if (nh !== null && nh !== undefined) this.guideH = nh;

        const g = this.guide;
        if (g) {
            g.style.top = `${this.guideY}%`;
            g.style.left = `${this.guideX}%`;
            g.style.height = `${this.guideH}px`;

            const el = document.getElementById("debug-crop-y");
            if (el) el.innerText = `${g.style.top} (${this.guideH}px)`;
        }
    }

    async captureAndProcess() {
        this.frameCounter++;
        const frameId = document.getElementById("debug-frame-count");
        if (frameId) frameId.innerText = this.frameCounter;

        await super.captureAndProcess();

    }

    showResults(results) {
        super.showResults(results);
        this.logScanSession({ strips: results });
    }
    logScanSession(sessionData) {
        if (!this.debugPanel) return;

        const sessionEntry = document.createElement("div");
        sessionEntry.style.cssText = `
        background: rgba(10, 15, 25, 0.6); border: 1px solid rgba(0, 229, 255, 0.2);
        border-radius: 12px; overflow: hidden; margin-bottom: 20px; animation: fadeIn 0.4s ease-out;
        box-shadow: 0 4px 15px rgba(0, 0, 0, 0.3);
        `;

        let itemsHtml = "";
        const strips = sessionData.strips || [];

        // Ordenamos los bloques del 1 al 4
        strips.sort((a, b) => a.idx - b.idx);

        strips.forEach((res) => {
            const rawOcrText = (res.rawText || "").replaceAll("\n", " ").trim();
            const hasMatches = res.matches && res.matches.length > 0;
            const itemNames = hasMatches ? res.matches.map(m => m.name).join(", ") : "NADA DETECTADO";
            const matchColor = hasMatches ? "#00ff78" : "#f1c40f";

            itemsHtml += `
            <div style="padding:10px; border-top:1px solid rgba(255,255,255,0.05); background:rgba(255,255,255,0.02);">
                    <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
                        <span style="color:#00e5ff; font-weight:800; font-size:10px;">[BLOQUE ${res.idx + 1}]</span>
                    </div>
                    <div style="font-size:8px; color:#aaa; margin-bottom:6px; font-family:monospace; background:#111; padding:4px; border-radius:4px;">
                        RAW OCR: ${rawOcrText || "Vacío..."}
                    </div>
                    <div style="display:flex; justify-content:space-between; font-size:9px;">
                        <span style="color:${matchColor}; font-weight:800;">-> MATCH: ${itemNames}</span>
                    </div>
                    <img src="${res.imgUrl}" style="width:100%; border:1px solid rgba(0,229,255,0.3); border-radius:4px; margin-top:6px;" />
            </div>
            `;
        });

        sessionEntry.innerHTML = `
            <div style="background:rgba(0, 229, 255, 0.1); padding:8px 12px; display:flex; justify-content:space-between; align-items:center;">
                <span style="font-weight:900; color:#00e5ff; font-size:10px;">SCAN HORA ${sessionData.time}</span>
            </div>
            ${itemsHtml}
        `;

        this.debugPanel.prepend(sessionEntry);
        if (this.debugPanel.children.length > 15) this.debugPanel.lastChild.remove();
    }

    async switchToScreen() {
        try {
            if (this.stream) {
                this.stream.getTracks().forEach(track => track.stop());
            }
            this.stream = await navigator.mediaDevices.getDisplayMedia({
                video: { cursor: "never" },
                audio: false
            });
            if (this.video) {
                this.video.srcObject = this.stream;
                await this.video.play();
            }
            showToast("Cambiado a CAPTURA DE PANTALLA");
        } catch (e) {
            console.error("SCREEN CAPTURE ERROR:", e);
            showToast("Error al capturar pantalla");
        }
    }

    logToDebug() { /* Redireccionado a logScanSession */ }
}

if (!document.getElementById("debug-scanner-styles")) {
    const style = document.createElement("style");
    style.id = "debug-scanner-styles";
    style.textContent = `@keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } } `;
    document.head.appendChild(style);
}

globalThis.startDebugScanner = async () => {
    if (globalThis.currentScanner) {
        globalThis.currentScanner.close();
    }
    const scanner = new MobileDebugScanner();
    globalThis.currentScanner = scanner;
    await scanner.start();
};
