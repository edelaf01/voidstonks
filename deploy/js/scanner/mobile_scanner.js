import { getPriceValue, getSlug } from "../api.js";
import { showToast, escapeHTML } from "../ui.components/ui_components.js";
import { state } from "../state.js";
import { TEXTS } from "../config.js";
import { OCRService } from "../services/ocr.service.js";
import { OCRRepository } from "../repositories/ocr.repository.js";
import { OpenCVEngine } from "../utils/opencv_engine.js";

/**
 * MobileScanner - Modularized and Optimized for Production
 */
export class MobileScanner {
  stream = null;
  video = null;
  worker1 = null;
  worker2 = null;
  worker3 = null;
  rewardCount = 4;
  calibratedColor = null;
  debugMode = false;
  isProcessing = false;
  discoveryActive = false;
  discoveryTimer = null;
  photoEl = null;
  photoUrl = null;
  visionCalib = null; // {satMin,valMin} aprendidos por auto-calibración
  guide = null;

  toggleScannerDebug() {
    this.debugMode = !this.debugMode;

    const guide = document.getElementById("scanner-box-guide");
    const sideGallery = document.getElementById("scanner-side-gallery");
    const debugLog = document.getElementById("scanner-debug-log");
    const dbgBtn = document.getElementById("btn-debug-hud");

    if (this.debugMode) {
      if (guide) {
        guide.style.borderColor = "#00e5ff";
        guide.style.boxShadow = "0 0 20px rgba(0, 229, 255, 0.5)";
        guide.style.borderStyle = "solid";
      }
      if (sideGallery) {
        sideGallery.style.display = "flex";
        sideGallery.style.right = "0px";
      }
      if (debugLog) debugLog.style.display = "block";
      if (dbgBtn) {
        dbgBtn.style.color = "#00e5ff";
        dbgBtn.style.borderColor = "#00e5ff";
        dbgBtn.style.background = "rgba(0, 229, 255, 0.1)";
      }
    } else {
      if (guide) {
        guide.style.borderColor = "rgba(255,255,255,0.7)";
        guide.style.boxShadow = "0 0 0 9999px rgba(0,0,0,0.75)";
        guide.style.borderStyle = "dashed";
      }
      if (sideGallery) {
        sideGallery.style.display = "none";
        sideGallery.style.right = "-200px";
      }
      if (debugLog) debugLog.style.display = "none";
      if (dbgBtn) {
        dbgBtn.style.color = "#506070";
        dbgBtn.style.borderColor = "#2a3040";
        dbgBtn.style.background = "none";
      }
    }
  }

  async start() {
    globalThis.currentScanner = this;
    OCRService.initMatcherData();
    this.createOverlay();

    try {
      const success = await OpenCVEngine.waitReady(30000);
      if (!success) this.setVisionStatus("ERROR AL CARGAR MOTOR", "#ff4b2b");

      OCRRepository.warmUp().then(() => {
        this.setVisionStatus("MOTOR OCR LISTO", "#2ecc71");
      });

      if (!navigator.mediaDevices?.getUserMedia) throw new Error("HTTPS Required");
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: false, video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } }
      });
      this.video.srcObject = this.stream;
      await this.video.play();

      this.startDiscoveryLoop();
      this.updateGuideDividers();
    } catch (err) { showToast("Error: " + err.message); this.close(); }
  }

  setVisionStatus(text, color) {
    const el = document.getElementById("scanner-vision-status");
    if (el) { el.innerText = text; el.style.color = color; }
  }

  createOverlay() {
    const overlay = document.createElement("div"); overlay.id = "mobile-scan-overlay";
    overlay.style.cssText = "position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(8,12,18,0.5); z-index:1000000; overflow:hidden; pointer-events:none;";
    this.video = document.createElement("video"); this.video.style.cssText = "width:100%; height:100%; object-fit:cover; pointer-events:none; z-index:100001;";
    overlay.appendChild(this.video);

    const backdrop = document.createElement("div"); backdrop.id = "scanner-backdrop";
    backdrop.style.cssText = "position:absolute; top:0; left:0; width:100%; height:100%; z-index:-1; pointer-events:none;";
    overlay.appendChild(backdrop);

    const headerBar = document.createElement("div"); headerBar.id = "scanner-header-bar";
    headerBar.style.cssText = "position:absolute; top:0; left:0; width:100%; height:120px; pointer-events:none; z-index:100010;";
    overlay.appendChild(headerBar);

    const titleDiv = document.createElement("div");
    titleDiv.style.cssText = "position:absolute; top:20px; left:15px; display:flex; align-items:center; gap:10px; z-index:100006; pointer-events:auto;";
    titleDiv.innerHTML = `
      <div style="background:#00e5ff; width:6px; height:6px; border-radius:50%; box-shadow:0 0 10px #00e5ff;"></div>
      <div style="color:#00e5ff; font-weight:900; font-size:11px; letter-spacing:2px; text-shadow:0 0 10px rgba(0,229,255,0.5);">LIVE RELIC SCANNER</div>
    `;
    headerBar.appendChild(titleDiv);

    const status = document.createElement("div"); status.id = "scanner-vision-status";
    status.style.cssText = "position:absolute; top:45px; left:31px; font-family:monospace; font-size:8px; font-weight:900; z-index:100004; letter-spacing:1px; color:#506070;";
    headerBar.appendChild(status);

    const dbgToggle = document.createElement("button");
    dbgToggle.innerText = "DEBUG"; dbgToggle.id = "btn-debug-hud";
    dbgToggle.style.cssText = "position:absolute; top:20px; right:75px; width:65px; height:40px; border-radius:20px; background:rgba(0,0,0,0.5); border:1px solid #00e5ff; color:#00e5ff; font-weight:900; font-size:10px; cursor:pointer; z-index:100005; pointer-events:auto;";
    dbgToggle.onclick = () => this.toggleScannerDebug();
    headerBar.appendChild(dbgToggle);

    const hideHeaderBtn = document.createElement("button");
    hideHeaderBtn.innerText = "HIDE UI"; hideHeaderBtn.style.cssText = "position:absolute; top:70px; left:15px; width:55px; height:24px; border-radius:12px; background:rgba(0,0,0,0.5); border:1px solid #444; color:#888; font-weight:900; font-size:8px; cursor:pointer; z-index:100006; pointer-events:auto;";
    hideHeaderBtn.onclick = () => {
      const bar = document.getElementById("scanner-header-bar");
      const isHidden = bar.style.opacity === "0";
      bar.style.opacity = isHidden ? "1" : "0";
      bar.style.pointerEvents = isHidden ? "auto" : "none";
      hideHeaderBtn.innerText = isHidden ? "HIDE UI" : "SHOW UI";
      hideHeaderBtn.style.borderColor = isHidden ? "#444" : "#00ff78";
      hideHeaderBtn.style.color = isHidden ? "#888" : "#00ff78";
    };
    overlay.appendChild(hideHeaderBtn);

    this.guide = document.createElement("div"); this.guide.id = "scanner-box-guide";
    this.guide.style.cssText = "position:absolute; top:50%; left:50%; transform:translate(-50%, -50%); width:90%; height:180px; border:2px dashed rgba(255,255,255,0.7); z-index:100010; pointer-events:auto; background:transparent;";
    overlay.appendChild(this.guide);

    const shutterBtn = document.createElement("button"); shutterBtn.style.cssText = "position:absolute; bottom:30px; left:50%; transform:translateX(-50%); width:80px; height:80px; border-radius:50%; border:5px solid #fff; background:rgba(255,255,255,0.2); z-index:100020; cursor:pointer; pointer-events:auto;";
    shutterBtn.innerHTML = "<div style='width:58px; height:58px; background:#fff; border-radius:50%; margin:4.5px;'></div>";
    shutterBtn.onclick = () => this.captureAndProcess();
    overlay.appendChild(shutterBtn);

    // Subir foto del galería/disco y procesarla con el mismo pipeline que la cámara.
    const fileInput = document.createElement("input");
    fileInput.type = "file"; fileInput.accept = "image/*"; fileInput.style.display = "none";
    fileInput.onchange = () => { const f = fileInput.files[0]; fileInput.value = ""; if (f) this.processUploadedPhoto(f); };
    overlay.appendChild(fileInput);

    const uploadBtn = document.createElement("button");
    uploadBtn.innerHTML = "📁"; uploadBtn.title = "Subir foto";
    uploadBtn.style.cssText = "position:absolute; bottom:48px; left:calc(50% + 75px); width:52px; height:52px; border-radius:50%; border:1px solid #00ff78; background:rgba(0,255,120,0.15); color:#00ff78; font-size:22px; z-index:100020; cursor:pointer; pointer-events:auto;";
    uploadBtn.onclick = () => fileInput.click();
    overlay.appendChild(uploadBtn);

    const countSelector = document.createElement("div"); countSelector.style.cssText = "position:absolute; bottom:130px; left:50%; transform:translateX(-50%); display:flex; gap:10px; z-index:100025; pointer-events:auto;";
    for (let i = 1; i <= 4; i++) {
      const btn = document.createElement("button"); btn.innerText = i; btn.id = `btn-count-${i}`;
      btn.style.cssText = `width:40px; height:40px; border-radius:8px; border:1px solid ${i === this.rewardCount ? "#00e5ff" : "rgba(255,255,255,0.2)"}; background:${i === this.rewardCount ? "rgba(0,229,255,0.2)" : "rgba(0,0,0,0.5)"}; color:${i === this.rewardCount ? "#00e5ff" : "#fff"}; font-weight:900; font-size:16px; cursor:pointer;`;
      btn.onclick = () => this.setRewardCount(i);
      countSelector.appendChild(btn);
    }
    overlay.appendChild(countSelector);

    const closeBtn = document.createElement("button"); closeBtn.innerHTML = "✕"; closeBtn.style.cssText = "position:absolute; top:20px; right:20px; background:rgba(0,0,0,0.5); color:#fff; width:40px; height:40px; border-radius:50%; border:1px solid #444; z-index:100030; pointer-events:auto;";
    closeBtn.onclick = () => this.close();
    overlay.appendChild(closeBtn);

    const debugLog = document.createElement("div"); debugLog.id = "scanner-debug-log";
    debugLog.style.cssText = "position:absolute; bottom:120px; left:10px; right:190px; height:150px; background:rgba(10,12,16,0.9); border:1px solid #00e5ff; z-index:100040; overflow-y:auto; padding:8px; display:none; color:white; font-family:monospace; font-size:9px; border-radius:8px; word-break:break-all; white-space:pre-wrap; pointer-events:auto;";
    overlay.appendChild(debugLog);

    const labelsLayer = document.createElement("div"); labelsLayer.id = "scanner-labels-layer";
    labelsLayer.style.cssText = "position:absolute; top:0; left:0; width:100%; height:100%; pointer-events:none; z-index:100005;";
    this.guide.appendChild(labelsLayer);

    const sideGallery = document.createElement("div"); sideGallery.id = "scanner-side-gallery";
    sideGallery.style.cssText = `
        position:absolute; top:80px; right:-200px; width:180px; bottom:120px; 
        background: rgba(10, 15, 20, 0.95); backdrop-filter: blur(15px); -webkit-backdrop-filter: blur(15px);
        border-left: 1px solid #00e5ff; border-radius: 12px 0 0 12px;
        z-index: 100030; overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 10px;
        transition: right 0.4s cubic-bezier(0.16, 1, 0.3, 1);
        box-shadow: -10px 0 30px rgba(0,0,0,0.5); pointer-events: auto;
    `;
    overlay.appendChild(sideGallery);

    if (!document.getElementById("premium-mobile-badges-style")) {
      const style = document.createElement("style");
      style.id = "premium-mobile-badges-style";
      style.textContent = `
        .premium-mobile-badge {
          position: absolute; background: rgba(10, 15, 20, 0.9); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
          border: 1px solid rgba(0, 229, 255, 0.2); border-left: 4px solid #00e5ff; border-radius: 6px; padding: 4px 10px;
          color: #fff; font-family: system-ui, sans-serif; display: flex; flex-direction: column; gap: 1px;
          transform: translate(-50%, -120%); pointer-events: none; box-shadow: 0 4px 15px rgba(0,0,0,0.6);
          animation: badgePop 0.2s cubic-bezier(0.18, 0.89, 0.32, 1.28); z-index: 10001; white-space: nowrap;
        }
        @keyframes badgePop {
          from { opacity: 0; transform: translate(-50%, -100%) scale(0.8); }
          to { opacity: 1; transform: translate(-50%, -120%) scale(1); }
        }
        .pmb-name { font-size: 8.5px; font-weight: 800; text-transform: uppercase; color: #00e5ff; letter-spacing: 0.5px; }
        .pmb-data { display: flex; gap: 8px; align-items: center; }
        .pmb-price { color: #f1c40f; font-weight: 900; font-size: 11px; display: flex; align-items: center; gap: 2px; }
        .pmb-owned { color: #888; font-size: 9px; font-weight: 700; border-left: 1px solid rgba(255,255,255,0.1); padding-left: 8px; }
      `;
      document.head.appendChild(style);
    }

    document.body.appendChild(overlay);
  }

  setRewardCount(n) {
    this.rewardCount = n;
    for (let i = 1; i <= 4; i++) {
      const btn = document.getElementById(`btn-count-${i}`);
      if (btn) {
        btn.style.borderColor = (i === n) ? "#00e5ff" : "rgba(255,255,255,0.2)";
        btn.style.background = (i === n) ? "rgba(0,229,255,0.2)" : "rgba(0,0,0,0.5)";
        btn.style.color = (i === n) ? "#00e5ff" : "#fff";
      }
    }
    this.updateGuideDividers();
    showToast(`Escaneando ${n} recompensas`);
  }

  updateGuideDividers() {
    const guide = document.getElementById("scanner-box-guide");
    if (!guide) return;
    guide.querySelectorAll(".guide-divider").forEach(el => el.remove());

    if (this.rewardCount > 1) {
      for (let i = 1; i < this.rewardCount; i++) {
        const line = document.createElement("div");
        line.className = "guide-divider";
        line.style.cssText = `position:absolute; top:0; bottom:0; left:${(100 / this.rewardCount) * i}%; width:1px; background:rgba(0,229,255,0.3); z-index:50;`;
        guide.appendChild(line);
      }
    }
  }

  close() {
    if (this.photoUrl) { URL.revokeObjectURL(this.photoUrl); this.photoUrl = null; }
    this.photoEl = null;
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
    }
    const overlay = document.getElementById("mobile-scan-overlay");
    if (overlay) overlay.remove();
    this.discoveryActive = false;
    if (this.discoveryTimer) clearTimeout(this.discoveryTimer);
    globalThis.mobileScanner = null;
    globalThis.currentScanner = null;
  }

  // Bucle de detección EN TIEMPO REAL: se auto-reprograma tan rápido como permite el OCR.
  // Gate de nitidez (salta frames borrosos/movidos), aviso de reflejo y auto-calibrado de color.
  async startDiscoveryLoop() {
    if (this.discoveryActive) return;
    this.discoveryActive = true;

    const tick = async () => {
      if (!this.discoveryActive) return;
      let delay = 90;
      try {
        const worker3 = OCRRepository.workers ? OCRRepository.workers[2] : null;
        const video = this.video;
        // Con foto activa, sin worker o cámara no lista: no escaneamos la cámara.
        if (!worker3 || this.isProcessing || this.photoEl || !video || video.videoWidth < 50) {
          this.discoveryTimer = setTimeout(tick, 250);
          return;
        }

        const vw = video.videoWidth, vh = video.videoHeight;
        const guide = document.getElementById("scanner-box-guide");
        const vRect = video.getBoundingClientRect();
        const gRect = guide ? guide.getBoundingClientRect() : { top: vRect.top + (vRect.height - 180) / 2, height: 180, left: vRect.left, width: vRect.width };

        const videoAspect = vw / vh, screenAspect = vRect.width / vRect.height;
        let scale, offsetX = 0, offsetY = 0;
        if (videoAspect > screenAspect) { scale = vRect.height / vh; offsetX = (vh * videoAspect * scale - vRect.width) / 2; }
        else { scale = vRect.width / vw; offsetY = (vw / videoAspect * scale - vRect.height) / 2; }

        const cX = Math.max(0, Math.floor(((gRect.left - vRect.left) + offsetX) / scale));
        const cY = Math.max(0, Math.floor(((gRect.top - vRect.top) + offsetY) / scale));
        const cW = Math.min(vw - cX, Math.floor(gRect.width / scale));
        const cH = Math.min(vh - cY, Math.floor(gRect.height / scale));

        // Escala a una anchura objetivo (~1100px) para que el texto quede a tamaño legible para
        // el OCR sea cual sea el tamaño de la guía -> no hay que "encajar" los nombres justos.
        const canvasScale = Math.max(0.3, Math.min(2.2, 1100 / cW));
        const cvs = document.createElement("canvas");
        cvs.width = Math.floor(cW * canvasScale); cvs.height = Math.floor(cH * canvasScale);
        if (cvs.width <= 0 || cvs.height <= 0) { this.discoveryTimer = setTimeout(tick, 250); return; }
        cvs.getContext("2d").drawImage(video, cX, cY, cW, cH, 0, 0, cvs.width, cvs.height);

        const s = state.visionSettings || {};

        // 1) GATE DE NITIDEZ (desenfoque / movimiento brusco): solo leemos frames nítidos.
        const sharp = OpenCVEngine.isReady ? OpenCVEngine.sharpness(cvs) : 999;
        if (sharp < (s.sharpnessMin ?? 45)) {
          this.setVisionStatus("📷 ENFOCA / MANTÉN FIRME", "#f1c40f");
          if (guide) { guide.style.borderColor = "rgba(241,196,15,0.7)"; guide.style.boxShadow = "none"; }
          this.discoveryTimer = setTimeout(tick, 80);
          return;
        }

        // 2) REFLEJO DE PANTALLA (glare): avisamos para que cambien el ángulo.
        const glare = OpenCVEngine.isReady ? OpenCVEngine.glareLevel(cvs) : 0;
        const glareHigh = glare > (s.glareMax ?? 0.12);
        this.setVisionStatus(glareHigh ? "⚠️ REFLEJO — CAMBIA EL ÁNGULO" : `● BUSCANDO (foco ${Math.round(sharp)})`, glareHigh ? "#e67e22" : "#00e5ff");

        // Binariza por color: usa el calibrado si existe; si no, detecta el color al vuelo.
        const liveColor = this.visionCalib?.color || OpenCVEngine.detectAccentColor(cvs);
        if (liveColor) {
          OpenCVEngine.binarizeNearColor(cvs, liveColor, this.visionCalib?.tolSq || 2500);
        } else if (OpenCVEngine.isReady) {
          OpenCVEngine.isolateAccentText(cvs, state.visionSettings);
        }

        const { data } = await OCRRepository.recognize(worker3, cvs);
        // Filtro estricto (anti-basura tipo "xata ris") + consenso temporal: solo se confirma
        // un ítem cuando aparece en varios frames; los falsos transitorios se descartan.
        const strong = OCRService.parseRewards(data).filter(r => (r.ratio ?? 1) >= 0.8);
        const confirmed = this._voteRewards(strong);

        if (guide) {
          if (confirmed.length > 0) { guide.style.borderColor = "#00e5ff"; guide.style.boxShadow = "0 0 20px rgba(0,229,255,0.5)"; }
          else if (!glareHigh) { guide.style.borderColor = "rgba(255,255,255,0.4)"; guide.style.boxShadow = "none"; }
        }
        this.updateDiscoveryLabels(confirmed, cW, cH, 0, canvasScale);
        if (typeof this.onDiscoveryFrame === "function") this.onDiscoveryFrame(confirmed, cW, cH, 0, cvs);

        delay = confirmed.length > 0 ? 160 : 50;
      } catch (e) { console.warn("Discovery err", e); }
      this.discoveryTimer = setTimeout(tick, delay);
    };

    tick();
  }

  // Consenso temporal con histéresis: un ítem se CONFIRMA tras verse en varios frames (+2 al
  // verlo, -1 al fallar). Mata los falsos transitorios ("xata ris") y estabiliza la lista, así
  // updateDiscoveryLabels recibe un conjunto estable (no recrea nada).
  _voteRewards(items) {
    this._liveVotes ||= new Map();
    const now = Date.now();
    const NEED = 3, MAXV = 6, WINDOW = 3000;
    const seen = new Set();
    for (const it of items) {
      const n = it.name.toUpperCase();
      seen.add(n);
      const v = this._liveVotes.get(n) || { hits: 0, shown: false };
      v.hits = Math.min(MAXV, v.hits + 2);
      v.lastSeen = now; v.item = it;
      if (v.hits >= NEED) v.shown = true;
      this._liveVotes.set(n, v);
    }
    const out = [];
    for (const [n, v] of this._liveVotes) {
      if (!seen.has(n)) v.hits -= 1;
      if (v.hits <= 0 || now - v.lastSeen > WINDOW) { this._liveVotes.delete(n); continue; }
      if (v.shown) out.push(v.item);
    }
    return out;
  }

  // Etiquetas en vivo PERSISTENTES: cada ítem detectado mantiene su badge entre frames (no se
  // borra/recrea -> sin parpadeo). Se refresca al re-detectar y se desvanece si no se ve ~1.6s.
  updateDiscoveryLabels(items, vidW, vidH, cropY, scale) {
    const layer = document.getElementById("scanner-labels-layer"); if (!layer) return;
    const now = Date.now();
    const TTL = 1600;
    this._liveLabels ||= new Map();

    items.forEach(it => {
      const nameU = it.name.toUpperCase();
      const targetX = Math.max(0.06, Math.min(0.94, (it.xPos || (vidW * scale) / 2) / (vidW * scale)));

      let e = this._liveLabels.get(nameU);
      if (!e) {
        const label = document.createElement("div");
        label.className = "premium-mobile-badge";
        const price = getPriceValue(nameU, getSlug(nameU));
        const owned = (state.primeInventory && state.primeInventory[nameU]) || 0;
        const priceText = typeof price === "number" ? price : "—";
        label.innerHTML = `
          <div class="pmb-name">${nameU}</div>
          <div class="pmb-data">
            <div class="pmb-price"><span style="width:8px;height:8px;background:#f1c40f;border-radius:50%;display:inline-block;"></span> ${priceText}</div>
            <div class="pmb-owned">INV: ${owned}</div>
          </div>`;
        label.style.top = "50%";
        layer.appendChild(label);
        e = { el: label, x: targetX };
        this._liveLabels.set(nameU, e);
      }
      e.lastSeen = now;
      e.x = e.x * 0.6 + targetX * 0.4;   // suavizado de posición (anti-jitter)
      e.el.style.left = `${e.x * 100}%`;
      e.el.style.opacity = "1";
    });

    // Desvanece y elimina las que no se han visto en TTL.
    for (const [name, e] of this._liveLabels) {
      if (now - e.lastSeen > TTL) {
        e.el.style.opacity = "0";
        setTimeout(() => { if (e.el && e.el.parentNode) e.el.remove(); }, 350);
        this._liveLabels.delete(name);
      }
    }
  }

  async captureAndProcess() {
    if (this.isProcessing) return;
    this.isProcessing = true;
    this.setVisionStatus("CAPTURANDO...", "#00e5ff");

    const workers = OCRRepository.workers;
    if (!workers || workers.length === 0) {
      showToast("Esperando motor OCR...", "warning");
      this.isProcessing = false;
      this.setVisionStatus("READY", "#506070");
      return;
    }

    try {
      // Fuente: foto subida (si está activa) o la cámara.
      const srcEl = this.photoEl || this.video;
      const vw = srcEl.naturalWidth || srcEl.videoWidth || 0;
      const vh = srcEl.naturalHeight || srcEl.videoHeight || 0;
      if (vw < 50 || vh < 50) {
        showToast("Fuente no lista...", "warning");
        this.isProcessing = false;
        this.setVisionStatus("READY", "#506070");
        return;
      }
      const guide = document.getElementById("scanner-box-guide");
      const vRect = srcEl.getBoundingClientRect();
      const gRect = guide.getBoundingClientRect();

      // El recorte debe respetar el object-fit del elemento: la foto se muestra con
      // 'contain' (imagen entera, alineas libre); la cámara con 'cover' (llena la pantalla).
      const fit = this.photoEl ? "contain" : "cover";
      const s = fit === "contain"
        ? Math.min(vRect.width / vw, vRect.height / vh)
        : Math.max(vRect.width / vw, vRect.height / vh);
      const dispW = vw * s, dispH = vh * s;
      const dx = (vRect.width - dispW) / 2;   // desplazamiento del contenido dentro del elemento
      const dy = (vRect.height - dispH) / 2;

      const gx = gRect.left - vRect.left, gy = gRect.top - vRect.top;
      let cX = Math.round((gx - dx) / s);
      let cY = Math.round((gy - dy) / s);
      let cW = Math.round(gRect.width / s);
      let cH = Math.round(gRect.height / s);
      // Clamp a los límites de la fuente (la guía puede salirse de la imagen en 'contain').
      cX = Math.max(0, Math.min(vw - 1, cX));
      cY = Math.max(0, Math.min(vh - 1, cY));
      cW = Math.max(1, Math.min(vw - cX, cW));
      cH = Math.max(1, Math.min(vh - cY, cH));

      const mainCvs = document.createElement("canvas");
      mainCvs.width = cW; mainCvs.height = cH;
      mainCvs.getContext("2d").drawImage(srcEl, cX, cY, cW, cH, 0, 0, cW, cH);

      // Auto-calibra la binarización contra ESTA imagen (barre umbrales hasta leer texto
      // legible de Warframe) y luego escanea con los parámetros ganadores.
      this.setVisionStatus("CALIBRANDO...", "#f1c40f");
      await this.autoCalibrateVision(mainCvs);
      await this.processStrips(mainCvs);
    } catch (err) {
      console.error(err);
      showToast("Error en captura");
    } finally {
      this.isProcessing = false;
      this.setVisionStatus("READY", "#506070");
    }
  }

  /**
   * AUTO-CALIBRACIÓN: prueba varias combinaciones de umbral de saturación/brillo, OCR-ea, y
   * puntúa por nº de recompensas RECONOCIDAS (texto legible de Warframe). Se queda con la
   * mejor y la guarda en this.visionCalib para la captura y el live. Robusto a fotos de
   * pantalla (saturación lavada, reflejos, desenfoque): el barrido encuentra el punto bueno.
   */
  async autoCalibrateVision(mainCvs) {
    const workers = OCRRepository.workers;
    if (!workers || !workers.length) return null;

    // Banda reducida para calibrar rápido.
    const calScale = Math.min(1, 900 / Math.max(1, mainCvs.width));
    const calW = Math.max(10, Math.floor(mainCvs.width * calScale));
    const calH = Math.max(10, Math.floor(mainCvs.height * calScale));

    // 1) COLOR REAL del texto (paleta WF, color más cercano + promedio) sobre ESTA foto.
    const base = document.createElement("canvas");
    base.width = calW; base.height = calH;
    base.getContext("2d").drawImage(mainCvs, 0, 0, calW, calH);
    const color = OpenCVEngine.detectAccentColor(base);

    const sideGallery = document.getElementById("scanner-side-gallery");
    if (sideGallery && this.debugMode) {
      sideGallery.innerHTML = `<div style='color:#f1c40f; font-size:10px; font-weight:900;'>CALIB · color ${color ? `rgb(${color.join(",")})` : "?"}</div>`;
    }
    if (!color) { this.visionCalib = null; return null; }

    // 2) Barre la TOLERANCIA (dist² RGB) hasta leer texto legible de Warframe (pocas pasadas = rápido).
    const tolCandidates = [1600, 3600, 7000];
    let best = { score: -1, params: null, matches: 0 };
    for (const tolSq of tolCandidates) {
      const c = document.createElement("canvas");
      c.width = calW; c.height = calH;
      c.getContext("2d").drawImage(mainCvs, 0, 0, calW, calH);
      OpenCVEngine.binarizeNearColor(c, color, tolSq);

      const timeout = new Promise(r => setTimeout(() => r({ data: { text: "", confidence: 0 } }), 8000));
      const { data } = await Promise.race([OCRRepository.recognize(workers[0], c), timeout]);
      data.imageW = 1000;
      const items = OCRService.parseRewards(data);
      const score = items.length * 1000 + (data.confidence || 0);

      if (sideGallery && this.debugMode) {
        const div = document.createElement("div");
        div.style.cssText = "background:rgba(255,255,255,0.05); border-radius:6px; padding:6px; font-size:8px; margin-bottom:6px;";
        div.innerHTML = `<div style="color:#f1c40f; font-weight:900;">tol ${tolSq} · match:${items.length} conf:${Math.round(data.confidence || 0)}</div>
          <img src="${c.toDataURL("image/webp", 0.5)}" style="width:100%; border:1px solid #444; margin-top:3px;" />`;
        sideGallery.appendChild(div);
      }

      if (score > best.score) best = { score, params: { color, tolSq }, matches: items.length };
    }

    this.visionCalib = best.params;
    if (best.params) console.log(`[CALIB] color rgb(${color.join(",")}) tol ${best.params.tolSq} matches ${best.matches}`);
    return best;
  }

  /**
   * Procesa una imagen-fuente (canvas) partiéndola en tiras verticales -> OpenCV -> OCR -> resultados.
   * Reutilizado por la captura de cámara y por la subida de fotos del debug scanner.
   */
  async processStrips(mainCvs) {
    // El pool arranca con 1 worker (menos RAM en el escaneo en vivo); para procesar una FOTO
    // sí interesa el 2º worker (las tiras se OCRean en paralelo) — se crea aquí bajo demanda.
    await OCRRepository.ensureSecondWorker().catch(() => {});
    const workers = OCRRepository.workers;
    if (!workers || workers.length === 0) {
      showToast("Esperando motor OCR...", "warning");
      return;
    }
    const cW = mainCvs.width, cH = mainCvs.height;

    // 1) LOCALIZAR las recompensas: ROIs de texto auto-detectados (clustering OpenCV).
    //    Si no detecta nada, se procesa la región ENTERA como una sola (sin trocear en casillas;
    //    parseRewards extrae todos los nombres del texto).
    let regions = [];
    if (OpenCVEngine.isReady) {
      try {
        regions = (OpenCVEngine.findTextROIs(mainCvs) || [])
          .filter(r => r.w > cW * 0.03 && r.h > cH * 0.08 && r.h < cH * 0.99);
      } catch (_) { regions = []; }
    }
    const auto = regions.length > 0;
    if (!auto) regions.push({ x: 0, y: 0, w: cW, h: cH });

    const debugLog = document.getElementById("scanner-debug-log");
    const sideGallery = document.getElementById("scanner-side-gallery");
    if (debugLog && this.debugMode) debugLog.innerHTML = `<b>DEBUGLOG</b> (${auto ? "auto-ROI" : "completa"} ×${regions.length}):<br>`;
    if (sideGallery && this.debugMode) sideGallery.innerHTML = "<div style='color:#00e5ff; font-size:10px; font-weight:900; border-bottom:1px solid #333;'> FEED</div>";

    const results = [];
    const ocrPromises = regions.map(async (r, idx) => {
      let blockScale = 120 / r.h;
      blockScale = Math.min(5, Math.max(2.5, blockScale));
      const bw = Math.floor(r.w * blockScale), bh = Math.floor(r.h * blockScale);
      if (bw < 10 || bh < 10) return;

      const blockCvs = document.createElement("canvas");
      blockCvs.width = bw; blockCvs.height = bh;
      blockCvs.getContext("2d").drawImage(mainCvs, r.x, r.y, r.w, r.h, 0, 0, bw, bh);

      const originalUrl = this.debugMode ? blockCvs.toDataURL("image/webp", 0.6) : "";

      // 2) BINARIZAR por CERCANÍA al color real del texto (calibrado). Fallback: aislar acento.
      if (this.visionCalib?.color) {
        OpenCVEngine.binarizeNearColor(blockCvs, this.visionCalib.color, this.visionCalib.tolSq);
      } else if (OpenCVEngine.isReady) {
        OpenCVEngine.isolateAccentText(blockCvs, state.visionSettings);
      }

      const labeledUrl = this.debugMode ? blockCvs.toDataURL("image/webp", 0.6) : "";
      const worker = workers[idx % workers.length];

      const timeoutPromise = new Promise(resolve => setTimeout(() => resolve({ data: { text: "", confidence: 0 } }), 10000));
      const { data } = await Promise.race([
        OCRRepository.recognize(worker, blockCvs),
        timeoutPromise
      ]);

      if (debugLog && this.debugMode) {
        const div = document.createElement("div");
        div.innerHTML = `<span style="color:#00e5ff">ROI ${idx}:</span> ${escapeHTML((data.text || "").replaceAll("\n", " "))}`;
        debugLog.appendChild(div);
      }
      if (sideGallery && this.debugMode) {
        const block = document.createElement("div");
        block.style.cssText = "background:rgba(255,255,255,0.05); border-radius:6px; padding:6px; font-size:8px;";
        const cleanText = (data.text || "").trim();
        block.innerHTML = `
            <div style="margin-bottom:4px; font-weight:900; color:#00e5ff;">ROI ${idx}</div>
            <img src="${originalUrl}" style="width:100%; border:1px solid #444;" />
            <img src="${labeledUrl}" style="width:100%; border:1px solid #00e5ff; margin-top:4px;" title="${cleanText}" />
         `;
        sideGallery.appendChild(block);
      }

      data.imageW = 1000;
      const detectedItems = OCRService.parseRewards(data);
      detectedItems.forEach(it => results.push({ ...it, xPos: r.x + (r.w / 2) }));
    });

    await Promise.all(ocrPromises);

    if (results.length > 0) this.showResults(results);
    else showToast("No se detectaron recompensas");
  }

  /**
   * Carga una foto del disco/galería y la pasa por el MISMO pipeline de tiras que la cámara.
   * Disponible en el escáner móvil normal y en el debug (que hereda).
   */
  // Sube una foto y la procesa ENTERA de forma AUTOMÁTICA (sin alinear): detecta el color del
  // texto, auto-calibra la binarización y localiza/lee las recompensas. parseRewards descarta
  // todo lo que no sea un ítem (título, "Owned", nombres de jugador…).
  async processUploadedPhoto(file) {
    if (!file) return;
    if (this.isProcessing) { showToast("Procesando, espera..."); return; }
    this.isProcessing = true;
    this.setVisionStatus("ESCANEANDO FOTO...", "#f1c40f");
    let url = null;
    try {
      url = URL.createObjectURL(file);
      const img = new Image();
      img.src = url;
      await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error("img")); });
      const w = img.naturalWidth, h = img.naturalHeight;
      if (w < 10 || h < 10) { showToast("Imagen inválida"); return; }

      // Reescala para rendimiento (foto entera, sin recorte manual).
      const sc = Math.min(1, 1600 / w);
      const mainCvs = document.createElement("canvas");
      mainCvs.width = Math.floor(w * sc); mainCvs.height = Math.floor(h * sc);
      mainCvs.getContext("2d").drawImage(img, 0, 0, mainCvs.width, mainCvs.height);

      if (this.livePreview) {
        this.livePreview.width = mainCvs.width; this.livePreview.height = mainCvs.height;
        this.livePreview.getContext("2d").drawImage(mainCvs, 0, 0);
      }

      await this.autoCalibrateVision(mainCvs);
      await this.processStrips(mainCvs);
    } catch (e) {
      console.error("[Scanner] processUploadedPhoto:", e);
      showToast("Error procesando la foto");
    } finally {
      if (url) URL.revokeObjectURL(url);
      this.isProcessing = false;
      this.setVisionStatus("READY", "#506070");
    }
  }

  removePhoto() {
    if (this.photoEl) { this.photoEl.remove(); this.photoEl = null; }
    if (this.photoUrl) { URL.revokeObjectURL(this.photoUrl); this.photoUrl = null; }
    const cb = document.getElementById("scanner-clear-photo");
    if (cb) cb.style.display = "none";
    this.setVisionStatus("READY", "#506070");
  }

  showResults(items) {
    let rc = document.getElementById("scan-results-sheet"); if (rc) rc.remove();
    rc = document.createElement("div"); rc.id = "scan-results-sheet"; document.body.appendChild(rc);

    const t = TEXTS[state.currentLang].rewardScanner;

    rc.style.cssText = `
        position:fixed; bottom:0; left:0; right:0; 
        background: linear-gradient(180deg, rgba(8, 12, 18, 0.98) 0%, rgba(10, 16, 26, 1) 100%);
        backdrop-filter: blur(30px); -webkit-backdrop-filter: blur(30px);
        border-top: 2px solid rgba(0, 229, 255, 0.35); padding: 18px 15px 25px; 
        z-index: 3000000; border-radius: 24px 24px 0 0; 
        box-shadow: 0 -15px 45px rgba(0,0,0,0.9);
        animation: slideUpMobile 0.45s cubic-bezier(0.16, 1, 0.3, 1);
        font-family: "Outfit", sans-serif;
    `;

    if (!document.getElementById("mobile-results-anim")) {
      const style = document.createElement("style");
      style.id = "mobile-results-anim";
      style.textContent = `
        @keyframes slideUpMobile { from { transform: translateY(100%); } to { transform: translateY(0); } }
        .mobile-card-grid { display:flex; gap:14px; overflow-x:auto; padding:15px 5px; scrollbar-width:none; }
        .premium-mobile-card {
           background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.1); 
           border-radius: 18px; padding: 14px; min-width: 170px; flex: 0 0 170px;
           display: flex; flex-direction: column; gap: 8px; position: relative;
        }
        .premium-mobile-card.best { border: 1.5px solid #d4af37; background: rgba(212, 175, 55, 0.05); }
        .mobile-card-header { font-size: 10px; font-weight: 800; color: #fff; text-transform: uppercase; }
        .mobile-currency-row { display: flex; align-items: center; justify-content: space-between; }
        .mobile-price { color: #f1c40f; font-weight: 900; font-size: 19px; display: flex; align-items: center; gap: 5px; }
        .mobile-ducats { color: #00e5ff; font-size: 11px; font-weight: 800; }
        .mobile-inv-badge { background: rgba(0, 255, 120, 0.12); border: 1px solid rgba(0, 255, 120, 0.25); border-radius: 6px; padding: 4px 10px; color: #00ff78; }
        .mobile-action-btn { flex: 1; background: rgba(0,229,255,0.12); border: 1px solid rgba(0,229,255,0.25); color: #00e5ff; font-size: 9px; padding: 7px; border-radius: 8px; font-weight: 900; cursor: pointer; }
      `;
      document.head.appendChild(style);
    }

    rc.innerHTML = `
      <div style="width: 40px; height: 4px; background: rgba(255,255,255,0.2); border-radius: 2px; margin: 0 auto 15px;"></div>
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <div style="color:#00e5ff; font-weight:900; font-size:12px; letter-spacing:2px;">${t.title || "RECOMPENSAS"}</div>
        <button onclick="this.closest('#scan-results-sheet').remove()" style="background:none; border:none; color:#fff; font-size:20px;">✕</button>
      </div>
    `;

    const grid = document.createElement("div");
    grid.className = "mobile-card-grid";

    Promise.all(items.map(it => getPriceValue(it.name, getSlug(it.name)))).then(prices => {
      const maxPl = Math.max(...prices);
      items.forEach((it, idx) => {
        const price = prices[idx];
        const owned = (state.primeInventory && state.primeInventory[it.name]) || 0;
        const isBest = (price === maxPl && price > 0);

        const card = document.createElement("div");
        card.className = `premium-mobile-card ${isBest ? "best" : ""}`;
        card.innerHTML = `
          <div class="mobile-card-header">${it.name}</div>
          <div class="mobile-currency-row">
            <div class="mobile-price">${typeof price === 'number' ? price : "—"} PL</div>
            ${it.ducats ? `<div class="mobile-ducats">${it.ducats} D</div>` : ""}
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <div style="font-size:8px; color:#888;">INV</div>
            <div class="mobile-inv-badge">${owned}</div>
          </div>
          <div class="mobile-card-actions">
            <button class="mobile-action-btn" onclick="globalThis.selectRewardToInventory('${it.name.replaceAll("'", "\\'")}'); this.closest('#scan-results-sheet').remove();">AÑADIR</button>
            <button class="mobile-action-btn" style="flex:0 0 35px;" onclick="globalThis.currentScanner.showPartPicker('${it.name.replaceAll("'", "\\'")}'), ${idx}">✎</button>
          </div>
        `;
        grid.appendChild(card);
      });
    });

    rc.appendChild(grid);
    document.body.appendChild(rc);
  }

  showPartPicker(itemName, resultIdx) {
    let picker = document.getElementById("mobile-part-picker");
    if (picker) picker.remove();

    picker = document.createElement("div");
    picker.id = "mobile-part-picker";
    picker.style.cssText = "position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.9); backdrop-filter:blur(10px); z-index:1000000; display:flex; flex-direction:column; padding:20px;";
    picker.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
           <span style="color:#00e5ff; font-weight:900;">CORREGIR RESULTADO</span>
           <button onclick="this.closest('#mobile-part-picker').remove()" style="background:none; border:none; color:#fff; font-size:24px;">✕</button>
        </div>
        <input type="text" id="picker-search" placeholder="Buscar parte..." style="width:100%; background:rgba(255,255,255,0.1); border:1px solid #333; border-radius:10px; padding:12px; color:#fff; font-size:16px;">
        <div id="picker-results" style="flex:1; overflow-y:auto; margin-top:15px; display:flex; flex-direction:column; gap:10px;"></div>
    `;
    document.body.appendChild(picker);

    const input = document.getElementById("picker-search");
    const resultsDiv = document.getElementById("picker-results");
    const dbItems = Object.keys(state.itemsDatabase || {});

    const updateResults = (q) => {
      resultsDiv.innerHTML = "";
      if (!q || q.length < 2) return;
      const query = q.toUpperCase();
      dbItems.filter(n => n.toUpperCase().includes(query)).slice(0, 20).forEach(name => {
        const btn = document.createElement("div");
        btn.style.cssText = "background:rgba(255,255,255,0.05); padding:12px; border-radius:8px; color:#ccc;";
        btn.innerText = name;
        btn.onclick = () => {
          globalThis.selectRewardToInventory(name);
          picker.remove();
          const sheet = document.getElementById("scan-results-sheet");
          if (sheet) sheet.remove();
        };
        resultsDiv.appendChild(btn);
      });
    };
    input.oninput = (e) => updateResults(e.target.value);
    input.focus();
    updateResults(itemName.split(" ")[0]);
  }
}
