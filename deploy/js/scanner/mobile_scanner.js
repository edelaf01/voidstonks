import { getPriceValue } from "../repositories/storage.repository.js";
import { getSlug } from "../utils/slugs.utils.js";
import { showToast, escapeHTML } from "../ui.components/ui_components.js";
import { state } from "../state.js";
import { TEXTS } from "../config.js";
import { OCRService } from "../services/scanner/ocr.service.js?v=264";
import { OCRRepository } from "../repositories/ocr.repository.js";
import { OpenCVEngine } from "../services/scanner/opencv_engine.service.js";
import { PaddleRepository } from "../repositories/paddle.repository.js";
import { getItemIcon } from "../utils/ui_utils.js";
import { applyBestCameraConstraints } from "../services/scanner/vision.service.js";
import { scanRewardPhoto, scanRewardBurst } from "../utils/vision/reward_photo_ocr.js";

/**
 * MobileScanner - Modularized and Optimized for Production
 */
export class MobileScanner {
  stream = null;
  video = null;
  worker1 = null;
  worker2 = null;
  worker3 = null;
  calibratedColor = null;
  debugMode = (() => { try { return localStorage.getItem("vs_scanner_debug") === "1"; } catch { return false; } })();
  isProcessing = false;
  discoveryActive = false;
  discoveryTimer = null;
  photoEl = null;
  photoUrl = null;
  visionCalib = null; // {satMin,valMin} aprendidos por auto-calibración
  guide = null;
  _wakeLock = null;

  toggleScannerDebug() {
    this.debugMode = !this.debugMode;
    // Se recuerda entre sesiones: quien lo usa para diagnosticar no quiere reactivarlo cada
    // vez que abre el escáner, y quien no lo usa no vuelve a verlo.
    try { localStorage.setItem("vs_scanner_debug", this.debugMode ? "1" : "0"); } catch { /* modo privado */ }

    const sideGallery = document.getElementById("scanner-side-gallery");
    const debugLog = document.getElementById("scanner-debug-log");
    const dbgBtn = document.getElementById("btn-debug-hud");

    if (this.debugMode) {
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
      if (!success) this.setVisionStatus("ERROR", "#ff4b2b");

      OCRRepository.warmUp().then(() => {
        this.setVisionStatus(this.t.camReady, "#2ecc71");
      });
      // Paddle es la vía rápida del escaneo; se descarga (4,8 MB) mientras el usuario
      // encuadra, para que el primer disparo no espere. Si falla, queda Tesseract.
      PaddleRepository.warmUp().catch((e) => console.warn("[Paddle] no disponible:", e));

      if (!navigator.mediaDevices?.getUserMedia) throw new Error("HTTPS Required");
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: false, video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } }
      });
      this.video.srcObject = this.stream;
      await this.video.play();
      applyBestCameraConstraints(this.stream).catch(() => { });

      this.startDiscoveryLoop();
      this.acquireWakeLock();

      let seen = false;
      try { seen = localStorage.getItem("vs_scanner_howto_seen") === "1"; } catch { seen = false; }
      if (!seen) this.showHowTo();
    } catch (err) { showToast("Error: " + err.message); this.close(); }
  }

  /**
   * Mantiene la pantalla encendida mientras el escáner está abierto.
   *
   * Sin esto el móvil se bloquea solo a los ~30 s: lo dejas apoyado apuntando a la pantalla
   * del PC y hay que desbloquearlo en cada misión. Se libera al cerrar para no gastar
   * batería, y se re-adquiere al volver a la pestaña (el sistema lo suelta al minimizar).
   */
  async acquireWakeLock() {
    if (!("wakeLock" in navigator)) return;
    try {
      this._wakeLock = await navigator.wakeLock.request("screen");
      if (!this._onVisibility) {
        this._onVisibility = () => {
          if (document.visibilityState === "visible" && this.video) this.acquireWakeLock();
        };
        document.addEventListener("visibilitychange", this._onVisibility);
      }
    } catch { /* el navegador puede negarlo (batería baja, sin permiso) */ }
  }

  releaseWakeLock() {
    if (this._onVisibility) {
      document.removeEventListener("visibilitychange", this._onVisibility);
      this._onVisibility = null;
    }
    this._wakeLock?.release?.().catch(() => {});
    this._wakeLock = null;
  }

  /**
   * Aviso háptico: estás mirando el juego, no el móvil, así que el resultado del disparo
   * tiene que notarse sin mirar. Patrón corto para éxito, doble para fallo.
   */
  buzz(ok) {
    try { navigator.vibrate?.(ok ? 40 : [30, 60, 30]); } catch { /* no soportado */ }
  }

  /** Textos de la UI en el idioma activo. */
  get t() {
    return TEXTS[state.currentLang]?.rewardScanner || TEXTS.es.rewardScanner;
  }

  setVisionStatus(text, color) {
    const el = document.getElementById("scanner-vision-status");
    if (el) { el.innerText = text; el.style.color = color; }
  }

  /**
   * Cómo apuntar. Se abre solo la primera vez (queda recordado) y desde el botón "?": lo que
   * el usuario necesita saber es qué tiene que quedar dentro del encuadre — el nombre de
   * cada recompensa y su etiqueta Owned/Crafted encima — porque de ahí sale todo lo demás.
   */
  showHowTo() {
    document.getElementById("scanner-howto")?.remove();
    const t = this.t;
    const panel = document.createElement("div");
    panel.id = "scanner-howto";
    panel.style.cssText = "position:fixed; inset:0; background:rgba(6,10,15,0.92); backdrop-filter:blur(8px); z-index:3000020; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:18px; padding:28px; text-align:center; font-family:'Outfit',sans-serif;";
    const steps = (t.camHowSteps || []).map((step, i) => `
      <div style="display:flex; gap:12px; align-items:flex-start; text-align:left; max-width:340px;">
        <div style="flex:0 0 22px; height:22px; border-radius:50%; background:rgba(0,229,255,0.15); border:1px solid rgba(0,229,255,0.5); color:#00e5ff; font-size:11px; font-weight:900; display:flex; align-items:center; justify-content:center;">${i + 1}</div>
        <div style="color:#dde; font-size:13px; line-height:1.5;">${step}</div>
      </div>`).join("");
    panel.innerHTML = `
      <div style="color:#00e5ff; font-weight:900; font-size:13px; letter-spacing:2px;">${escapeHTML(t.camHowTitle)}</div>
      <div style="display:flex; flex-direction:column; gap:14px;">${steps}</div>
      <button id="scanner-howto-ok" style="margin-top:6px; background:rgba(0,229,255,0.14); border:1px solid rgba(0,229,255,0.4); color:#00e5ff; font-size:12px; font-weight:900; padding:11px 34px; border-radius:12px; cursor:pointer;">${escapeHTML(t.camHowGot)}</button>
    `;
    panel.querySelector("#scanner-howto-ok").onclick = () => {
      panel.remove();
      try { localStorage.setItem("vs_scanner_howto_seen", "1"); } catch { /* modo privado */ }
    };
    document.body.appendChild(panel);
  }

  /** La pista de encuadre sobra mientras se procesa: estorba sobre el panel de progreso. */
  showHint(visible) {
    const hint = document.getElementById("scanner-hint");
    if (!hint) return;
    hint.style.setProperty("opacity", visible ? "1" : "0", "important");
  }

  // Flash blanco de "foto tomada" — dispara el mismo instante en que se pulsa el botón,
  // antes de que cualquier procesado (que puede tardar segundos) empiece.
  flashCapture() {
    const flash = document.getElementById("scanner-flash");
    if (!flash) return;
    flash.style.transition = "none";
    flash.style.opacity = "0.85";
    requestAnimationFrame(() => {
      flash.style.transition = "opacity 0.5s ease-out";
      flash.style.opacity = "0";
    });
  }

  // Panel de progreso central: pct=null oculta el panel (proceso terminado/cancelado).
  showScanProgress(label, pct) {
    const panel = document.getElementById("scanner-progress-panel");
    const bar = document.getElementById("scanner-progress-bar");
    const labelEl = document.getElementById("scanner-progress-label");
    if (!panel) return;
    if (pct === null) { panel.style.display = "none"; return; }
    panel.style.display = "flex";
    if (labelEl) labelEl.innerText = label;
    if (bar) bar.style.width = `${Math.max(5, Math.min(100, pct))}%`;
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

    const t = TEXTS[state.currentLang]?.rewardScanner || TEXTS.es.rewardScanner;

    const titleDiv = document.createElement("div");
    titleDiv.style.cssText = "position:absolute; top:20px; left:15px; display:flex; align-items:center; gap:10px; z-index:100006; pointer-events:auto;";
    titleDiv.innerHTML = `
      <div style="background:#00e5ff; width:6px; height:6px; border-radius:50%; box-shadow:0 0 10px #00e5ff;"></div>
      <div style="color:#00e5ff; font-weight:900; font-size:11px; letter-spacing:2px; text-shadow:0 0 10px rgba(0,229,255,0.5);">${escapeHTML(t.camTitle)}</div>
    `;
    headerBar.appendChild(titleDiv);

    // Estado legible: antes eran 8 px en una esquina, ilegibles con el móvil en la mano.
    const status = document.createElement("div"); status.id = "scanner-vision-status";
    status.style.cssText = "position:absolute; top:44px; left:31px; font-family:monospace; font-size:11px; font-weight:900; z-index:100004; letter-spacing:1px; color:#506070;";
    headerBar.appendChild(status);

    const dbgToggle = document.createElement("button");
    dbgToggle.innerText = "DEBUG"; dbgToggle.id = "btn-debug-hud";
    // Discreto: es una herramienta de diagnóstico, no una acción del usuario.
    dbgToggle.style.cssText = "position:absolute; top:26px; right:72px; width:52px; height:28px; border-radius:14px; background:none; border:1px solid #2a3040; color:#506070; font-weight:900; font-size:9px; cursor:pointer; z-index:100005; pointer-events:auto;";
    dbgToggle.onclick = () => this.toggleScannerDebug();
    // Oculto salvo que el modo ya esté activo: es una herramienta de diagnóstico y en la UI
    // normal solo hacía ruido. Se revela con una pulsación larga sobre el título.
    dbgToggle.style.display = this.debugMode ? "block" : "none";
    headerBar.appendChild(dbgToggle);

    let holdTimer = null;
    const startHold = () => {
      holdTimer = setTimeout(() => {
        dbgToggle.style.display = "block";
        showToast("DEBUG");
      }, 900);
    };
    const cancelHold = () => { if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; } };
    titleDiv.addEventListener("pointerdown", startHold);
    titleDiv.addEventListener("pointerup", cancelHold);
    titleDiv.addEventListener("pointerleave", cancelHold);

    // La guía punteada se quitó: dejó de recortar la imagen (ahora se analiza el encuadre
    // completo y el algoritmo localiza la fila solo), así que solo confundía — invitaba a
    // alinearla como si importara. En su lugar, una pista de texto que sí dice qué hacer.
    const hint = document.createElement("div"); hint.id = "scanner-hint";
    hint.style.cssText = "position:absolute; bottom:135px; left:50%; transform:translateX(-50%); max-width:80%; text-align:center; color:rgba(255,255,255,0.85); font-size:12px; font-weight:700; letter-spacing:0.5px; text-shadow:0 2px 8px rgba(0,0,0,0.9); z-index:100015; pointer-events:none; transition:opacity 0.3s;";
    hint.innerText = t.camHint;
    overlay.appendChild(hint);

    const howBtn = document.createElement("button"); howBtn.id = "scanner-how-btn";
    howBtn.innerText = `? ${t.camHowBtn}`;
    howBtn.style.cssText = "position:absolute; bottom:112px; left:50%; transform:translateX(-50%); background:rgba(0,0,0,0.45); border:1px solid rgba(0,229,255,0.35); color:#00e5ff; font-size:10px; font-weight:900; padding:5px 12px; border-radius:12px; z-index:100016; cursor:pointer; pointer-events:auto;";
    howBtn.onclick = () => this.showHowTo();
    overlay.appendChild(howBtn);

    const shutterBtn = document.createElement("button"); shutterBtn.id = "scanner-shutter-btn";
    shutterBtn.style.cssText = "position:absolute; bottom:30px; left:50%; transform:translateX(-50%); width:80px; height:80px; border-radius:50%; border:5px solid #fff; background:rgba(255,255,255,0.2); z-index:100020; cursor:pointer; pointer-events:auto; transition:opacity 0.2s, transform 0.15s;";
    shutterBtn.innerHTML = "<div style='width:58px; height:58px; background:#fff; border-radius:50%; margin:4.5px;'></div>";
    shutterBtn.onclick = () => this.captureAndProcess();
    overlay.appendChild(shutterBtn);

    // Flash blanco al disparar: feedback inmediato e inequívoco de "foto tomada", el mismo
    // patrón de cualquier app de cámara. Sin esto, el único indicio de que el botón hizo
    // algo era un texto de 8px en una esquina — fácil de no ver mientras miras el encuadre.
    const flash = document.createElement("div"); flash.id = "scanner-flash";
    flash.style.cssText = "position:absolute; top:0; left:0; width:100%; height:100%; background:#fff; opacity:0; pointer-events:none; z-index:100025; transition:opacity 0.5s ease-out;";
    overlay.appendChild(flash);

    // Panel de progreso CENTRAL y grande: el texto de estado (scanner-vision-status) es
    // diminuto y vive en una esquina — durante captura/calibración/lectura el usuario
    // necesita ver DE UN VISTAZO que algo está pasando, con una barra de avance real.
    const progressPanel = document.createElement("div"); progressPanel.id = "scanner-progress-panel";
    progressPanel.style.cssText = "position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); width:220px; padding:20px; background:rgba(8,12,18,0.92); backdrop-filter:blur(12px); border:1px solid rgba(0,229,255,0.4); border-radius:16px; z-index:100022; display:none; flex-direction:column; align-items:center; gap:12px; pointer-events:none; box-shadow:0 10px 40px rgba(0,0,0,0.6);";
    progressPanel.innerHTML = `
      <div id="scanner-progress-label" style="color:#00e5ff; font-weight:900; font-size:13px; letter-spacing:1px; text-align:center;">CAPTURANDO...</div>
      <div style="width:100%; height:6px; background:rgba(255,255,255,0.12); border-radius:3px; overflow:hidden;">
        <div id="scanner-progress-bar" style="width:10%; height:100%; background:#00e5ff; border-radius:3px; transition:width 0.3s ease-out;"></div>
      </div>
    `;
    overlay.appendChild(progressPanel);

    // Subir foto del galería/disco y procesarla con el mismo pipeline que la cámara.
    const fileInput = document.createElement("input");
    fileInput.type = "file"; fileInput.accept = "image/*"; fileInput.style.display = "none";
    fileInput.onchange = () => { const f = fileInput.files[0]; fileInput.value = ""; if (f) this.processUploadedPhoto(f); };
    overlay.appendChild(fileInput);

    const uploadBtn = document.createElement("button");
    uploadBtn.innerHTML = "📁"; uploadBtn.title = t.camUpload;
    uploadBtn.style.cssText = "position:absolute; bottom:48px; left:calc(50% + 75px); width:52px; height:52px; border-radius:50%; border:1px solid #00ff78; background:rgba(0,255,120,0.15); color:#00ff78; font-size:22px; z-index:100020; cursor:pointer; pointer-events:auto;";
    uploadBtn.onclick = () => fileInput.click();
    overlay.appendChild(uploadBtn);

    const closeBtn = document.createElement("button"); closeBtn.innerHTML = "✕"; closeBtn.title = t.camClose; closeBtn.style.cssText = "position:absolute; top:20px; right:20px; background:rgba(0,0,0,0.5); color:#fff; width:40px; height:40px; border-radius:50%; border:1px solid #444; z-index:100030; pointer-events:auto;";
    closeBtn.onclick = () => this.close();
    overlay.appendChild(closeBtn);

    // z-index por encima de la hoja de resultados (scan-results-sheet, 3000000): esa hoja
    // se desliza desde abajo cubriendo TODO el ancho al terminar el escaneo, y con el
    // z-index viejo (100040) tapaba el debug log justo cuando más útil era leerlo — daba
    // la sensación de que "se iba muy rápido" cuando en realidad quedaba oculto detrás.
    const debugLog = document.createElement("div"); debugLog.id = "scanner-debug-log";
    debugLog.style.cssText = "position:absolute; top:130px; left:10px; right:190px; height:150px; background:rgba(10,12,16,0.9); border:1px solid #00e5ff; z-index:3000010; overflow-y:auto; padding:8px; display:none; color:white; font-family:monospace; font-size:9px; border-radius:8px; word-break:break-all; white-space:pre-wrap; pointer-events:auto;";
    overlay.appendChild(debugLog);

    const labelsLayer = document.createElement("div"); labelsLayer.id = "scanner-labels-layer";
    labelsLayer.style.cssText = "position:absolute; top:0; left:0; width:100%; height:100%; pointer-events:none; z-index:100005;";
    overlay.appendChild(labelsLayer);

    const sideGallery = document.createElement("div"); sideGallery.id = "scanner-side-gallery";
    sideGallery.style.cssText = `
        position:absolute; top:80px; right:-200px; width:180px; bottom:130px;
        background: rgba(10, 15, 20, 0.95); backdrop-filter: blur(15px); -webkit-backdrop-filter: blur(15px);
        border-left: 1px solid #00e5ff; border-radius: 12px 0 0 12px;
        z-index: 3000010; overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 10px;
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

  close() {
    if (this.photoUrl) { URL.revokeObjectURL(this.photoUrl); this.photoUrl = null; }
    this.photoEl = null;
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
    }
    const overlay = document.getElementById("mobile-scan-overlay");
    if (overlay) overlay.remove();
    this.discoveryActive = false;
    this.releaseWakeLock();
    if (this.discoveryTimer) clearTimeout(this.discoveryTimer);
    // Los workers de Tesseract son instancias WASM (~40-60MB cada una) y este close()
    // sólo paraba la cámara: al cerrar el escáner en móvil la RAM se quedaba retenida
    // hasta recargar la página. El siguiente escaneo los recrea con warmUp().
    OCRRepository.terminateAll();
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
          <div class="pmb-name">${escapeHTML(nameU)}</div>
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
    this.flashCapture();
    this.setVisionStatus(this.t.camReading, "#00e5ff");
    this.showScanProgress(this.t.camReading, 15);
    this.showHint(false);

    const workers = OCRRepository.workers;
    if (!workers || workers.length === 0) {
      showToast(this.t.toastEngineWait, "warning");
      this.isProcessing = false;
      this.setVisionStatus(this.t.camReady, "#506070");
      this.showHint(true);
      this.showScanProgress(null, null);
      return;
    }

    try {
      // Fuente: foto subida (si está activa) o la cámara.
      const srcEl = this.photoEl || this.video;
      const vw = srcEl.naturalWidth || srcEl.videoWidth || 0;
      const vh = srcEl.naturalHeight || srcEl.videoHeight || 0;
      if (vw < 50 || vh < 50) {
        showToast(this.t.toastSourceNotReady, "warning");
        this.isProcessing = false;
        this.setVisionStatus(this.t.camReady, "#506070");
        this.showHint(true);
        this.showScanProgress(null, null);
        return;
      }
      // La guía punteada (scanner-box-guide) queda SOLO como ayuda visual para encuadrar a
      // ojo — ya no recorta la imagen. Recortar por la guía obligaba a alinearla a mano
      // sobre las cards reales; con una webcam apuntando a un monitor externo (el juego
      // ocupa solo parte del encuadre, no la pantalla completa) esa alineación casi nunca
      // coincide y el pipeline entero terminaba analizando fondo/pared en vez de las
      // recompensas. Se procesa siempre la imagen COMPLETA: scanRewardPhoto localiza la
      // fila de recompensas esté donde esté.
      const grab = () => {
        const cvs = document.createElement("canvas");
        cvs.width = vw; cvs.height = vh;
        cvs.getContext("2d").drawImage(srcEl, 0, 0, vw, vh);
        this._lastCaptureCvs = cvs; // referencia para el panel de "sin resultados"
        return cvs;
      };

      // Con la CÁMARA se dispara una ráfaga: cada pulsación captura varios fotogramas y se
      // consolidan por consenso, para que un frame movido o con un reflejo no arruine la
      // lectura. Una foto ya subida es una imagen fija: repetirla no aportaría nada nuevo.
      await this.processStrips(grab, { burst: !this.photoEl });
    } catch (err) {
      console.error(err);
      showToast(this.t.toastCaptureError);
      this.showScanProgress(null, null);
    } finally {
      this.isProcessing = false;
      this.setVisionStatus(this.t.camReady, "#506070");
      this.showHint(true);
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
  /**
   * @param {HTMLCanvasElement | (() => HTMLCanvasElement)} input - imagen fija, o una
   *        función que captura un fotograma nuevo (necesaria para el modo ráfaga).
   * @param {{burst?: boolean}} [opts]
   */
  async processStrips(input, opts = {}) {
    // El pool arranca con 1 worker (menos RAM en el escaneo en vivo); la foto usa varios
    // preprocesados en paralelo, así que aquí sí interesa el 2º worker.
    await OCRRepository.ensureSecondWorker().catch(() => {});
    if (!OCRRepository.workers || OCRRepository.workers.length === 0) {
      showToast(this.t.toastEngineWait, "warning");
      this.showScanProgress(null, null);
      return;
    }
    const grabFrame = typeof input === "function" ? input : () => input;

    const debugLog = document.getElementById("scanner-debug-log");
    const sideGallery = document.getElementById("scanner-side-gallery");
    if (debugLog && this.debugMode) debugLog.innerHTML = "<b>DEBUGLOG</b><br>";
    if (sideGallery && this.debugMode) sideGallery.innerHTML = "<div style='color:#00e5ff; font-size:10px; font-weight:900; border-bottom:1px solid #333;'> FEED</div>";

    // Todo el trabajo real vive en reward_photo_ocr.js: scout con ancla "PRIME" -> recorte
    // automático a la zona de interés (varios márgenes, gana el que más lee) -> preprocesados
    // complementarios en paralelo -> unión -> filtro por rejilla de columnas. En modo ráfaga,
    // además, varios fotogramas consolidados por consenso. Ver ese módulo para cada fase.
    const deps = { ocrRepository: OCRRepository, ocrService: OCRService, opencvEngine: OpenCVEngine, paddleRepository: PaddleRepository };
    // El módulo de OCR informa del avance sin texto (no sabe de idiomas): la etiqueta la
    // pone aquí, traducida. Antes el módulo mandaba "LEYENDO..." en español y pisaba la
    // traducción, así que la app en inglés mostraba texto en español.
    const onProgress = (label, pct) => {
      const shown = label || this.t.camReading;
      this.setVisionStatus(shown, "#00e5ff");
      this.showScanProgress(shown, pct);
    };

    const { items, roi, ms, trace, skew } = opts.burst
      ? await scanRewardBurst(grabFrame, deps, { onProgress })
      : await scanRewardPhoto(grabFrame(), deps, onProgress);

    console.log(`[SCAN] ${ms}ms · ${trace.join(" · ")}`);
    if (debugLog && this.debugMode) {
      for (const line of trace) {
        const div = document.createElement("div");
        div.innerText = line;
        debugLog.appendChild(div);
      }
      const res = document.createElement("div");
      res.style.cssText = "color:#00e5ff; font-weight:900; margin-top:6px;";
      res.innerText = `${items.length} recompensas · ${ms}ms`;
      debugLog.appendChild(res);
    }

    this.setVisionStatus(this.t.camReady, "#506070");
    this.showHint(true);
    this.showScanProgress(null, null);

    this.buzz(items.length > 0);
    if (items.length > 0) this.showResults(items);
    else this.showNoResultsPanel(this._lastCaptureCvs || grabFrame(), roi, trace, skew);
  }

  // Antes: un toast genérico ("No se detectaron recompensas") que desaparece solo en unos
  // segundos, sin decir NADA de qué vio la cámara ni por qué falló. Con esto el usuario ve
  // la foto que realmente se capturó (¿estaba la pantalla encuadrada? ¿enfocada?) y el texto
  // crudo que el OCR sí llegó a leer (si hay texto pero no matcheó ningún ítem conocido, es
  // un problema de encuadre/foco, no del reconocimiento — pistas muy distintas para el usuario).
  showNoResultsPanel(mainCvs, roi, trace, skew) {
    const old = document.getElementById("scanner-no-results-panel");
    if (old) old.remove();

    // El motivo se deduce de la fase que falló, que es lo que de verdad orienta al usuario:
    // sin ancla "PRIME" el problema es de encuadre/nitidez (la pantalla no se ve bien);
    // con ancla pero sin ítems, la pantalla se localizó pero los nombres no se leyeron.
    const t = this.t;
    // Si la foto salió claramente torcida, ese es el consejo más accionable: el OCR pierde
    // recompensas con la inclinación y el usuario no siempre se da cuenta de que disparó
    // ladeado. Por encima de 4° ya es visible a ojo.
    const reason = (typeof skew === "number" && Math.abs(skew) >= 4)
      ? t.camTipTilted
      : (roi?.auto ? t.camTipQuality : t.camTipFraming);

    const panel = document.createElement("div");
    panel.id = "scanner-no-results-panel";
    panel.style.cssText = "position:fixed; bottom:0; left:0; right:0; background:linear-gradient(180deg, rgba(8,12,18,0.98) 0%, rgba(10,16,26,1) 100%); backdrop-filter:blur(30px); border-top:2px solid rgba(255,140,0,0.4); padding:18px 15px 25px; z-index:3000000; border-radius:24px 24px 0 0; box-shadow:0 -15px 45px rgba(0,0,0,0.9); font-family:'Outfit', sans-serif; max-height:70vh; overflow-y:auto;";
    panel.innerHTML = `
      <div style="width:40px; height:4px; background:rgba(255,255,255,0.2); border-radius:2px; margin:0 auto 15px;"></div>
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
        <div style="color:#ff8c00; font-weight:900; font-size:12px; letter-spacing:2px;">⚠ ${escapeHTML(t.camNoResults)}</div>
        <button onclick="this.closest('#scanner-no-results-panel').remove()" style="background:none; border:none; color:#fff; font-size:20px; cursor:pointer;">✕</button>
      </div>
      <div style="color:#ccc; font-size:12px; margin-bottom:12px; line-height:1.4;">${escapeHTML(reason)}</div>
      <img src="${mainCvs.toDataURL("image/jpeg", 0.7)}" style="width:100%; border-radius:10px; border:1px solid #333; margin-bottom:12px;" />
      ${this.debugMode ? `<div style="color:#666; font-size:10px; font-family:monospace; background:rgba(255,255,255,0.05); border-radius:8px; padding:8px; white-space:pre-wrap; word-break:break-word;">${escapeHTML((trace || []).join("\n"))}</div>` : ""}
      <button onclick="this.closest('#scanner-no-results-panel').remove()" style="width:100%; margin-top:14px; background:rgba(0,229,255,0.12); border:1px solid rgba(0,229,255,0.25); color:#00e5ff; font-size:12px; padding:10px; border-radius:10px; font-weight:900; cursor:pointer;">${escapeHTML(t.camRetry)}</button>
    `;
    document.body.appendChild(panel);
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
    if (this.isProcessing) { showToast(this.t.toastProcessing); return; }
    this.isProcessing = true;
    this.setVisionStatus(this.t.camReading, "#f1c40f");
    this.showHint(false);
    let url = null;
    try {
      url = URL.createObjectURL(file);
      const img = new Image();
      img.src = url;
      await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error("img")); });
      const w = img.naturalWidth, h = img.naturalHeight;
      if (w < 10 || h < 10) { showToast(this.t.toastInvalidImage); return; }

      // Se pasa la foto a resolución COMPLETA: scanRewardPhoto normaliza el tamaño en cada
      // fase (scout barato, luego OCR sobre la ROI ya recortada), y reducirla antes le
      // quitaría resolución justo a la banda de nombres, que es donde hace falta.
      const mainCvs = document.createElement("canvas");
      mainCvs.width = w; mainCvs.height = h;
      mainCvs.getContext("2d").drawImage(img, 0, 0);

      if (this.livePreview) {
        this.livePreview.width = mainCvs.width; this.livePreview.height = mainCvs.height;
        this.livePreview.getContext("2d").drawImage(mainCvs, 0, 0);
      }

      // Sin ráfaga: una foto ya subida es una imagen fija, releerla daría lo mismo.
      await this.processStrips(mainCvs, { burst: false });
    } catch (e) {
      console.error("[Scanner] processUploadedPhoto:", e);
      showToast(this.t.toastPhotoError);
    } finally {
      if (url) URL.revokeObjectURL(url);
      this.isProcessing = false;
      this.setVisionStatus(this.t.camReady, "#506070");
      this.showHint(true);
    }
  }

  removePhoto() {
    if (this.photoEl) { this.photoEl.remove(); this.photoEl = null; }
    if (this.photoUrl) { URL.revokeObjectURL(this.photoUrl); this.photoUrl = null; }
    const cb = document.getElementById("scanner-clear-photo");
    if (cb) cb.style.display = "none";
    this.setVisionStatus(this.t.camReady, "#506070");
    this.showHint(true);
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
        max-height: 85vh; overflow-y: auto;
    `;

    if (!document.getElementById("mobile-results-anim")) {
      const style = document.createElement("style");
      style.id = "mobile-results-anim";
      style.textContent = `
        @keyframes slideUpMobile { from { transform: translateY(100%); } to { transform: translateY(0); } }
        /* Rejilla que reparte el ancho disponible en vez de una fila con scroll lateral:
           en vertical entraban 2 tarjetas y las demás quedaban escondidas tras un scroll
           horizontal que no se veía. Con auto-fit todas caben — 2 columnas en vertical,
           3-4 en horizontal — sin que el usuario tenga que descubrir que hay más. */
        .mobile-card-grid {
           display:grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
           gap:12px; padding:15px 5px; align-items:stretch;
        }
        .premium-mobile-card {
           background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.1);
           border-radius: 18px; padding: 14px; min-width: 0;
           display: flex; flex-direction: column; gap: 8px; position: relative;
        }
        .mobile-card-header { overflow-wrap:anywhere; }
        .mobile-card-top { display:flex; align-items:center; gap:8px; }
        .mobile-card-icon { width:34px; height:34px; object-fit:contain; flex:0 0 34px; filter:drop-shadow(0 2px 4px rgba(0,0,0,0.6)); }
        /* En apaisado la hoja es muy baja: se le deja más alto útil y scroll propio. */
        @media (orientation: landscape) {
           #scan-results-sheet { max-height: 92vh; overflow-y: auto; }
           .mobile-card-grid { grid-template-columns: repeat(auto-fit, minmax(135px, 1fr)); gap:10px; }
           .premium-mobile-card { padding: 10px; border-radius: 14px; }
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

    // Sincronizar TODO de una vez: el escaneo ya sabe cuántos tiene el jugador de cada
    // recompensa (badge "N Owned"), así que no tiene sentido obligar a pulsar una por una
    // para corregir el inventario. Solo aparece si alguna trae cantidad legible.
    const syncable = items.filter((it) => (it.owned || 0) > 0);
    if (syncable.length) {
      const syncAll = document.createElement("button");
      syncAll.innerText = `⟳ ${t.syncAllBtn}`;
      syncAll.style.cssText = "width:100%; margin-bottom:10px; background:rgba(0,255,120,0.12); border:1px solid rgba(0,255,120,0.3); color:#00ff78; font-size:11px; font-weight:900; padding:10px; border-radius:10px; cursor:pointer;";
      syncAll.onclick = () => {
        const n = syncable.filter((it) => globalThis.syncRewardFromGame?.(it.name, it.owned)).length;
        showToast(n
          ? (t.syncAllDone || "{n}").replace("{n}", n)
          : (t.syncAllNone || ""));
        syncAll.disabled = true;
        syncAll.style.opacity = "0.5";
        try { navigator.vibrate?.(30); } catch { /* no soportado */ }
      };
      rc.appendChild(syncAll);
    }

    const grid = document.createElement("div");
    grid.className = "mobile-card-grid";

    // Los precios pueden tardar o no llegar (sin red, worker caído). Las tarjetas se pintan
    // igualmente con los datos que ya tenemos del escaneo — nombre, cantidad en juego,
    // inventario — y el precio se rellena cuando llegue. Antes todo el render colgaba de
    // esta promesa: si fallaba, el usuario no veía NADA pese a haberse leído las recompensas.
    const prices = new Array(items.length).fill(null);
    const renderCards = (maxPl) => {
      grid.innerHTML = "";
      items.forEach((it, idx) => {
        const price = prices[idx];
        const owned = (state.primeInventory && state.primeInventory[it.name]) || 0;
        const isBest = (price === maxPl && price > 0);

        // Lo que decía la PANTALLA DEL JUEGO (badge "N Owned" / "Crafted"), que es distinto
        // del inventario guardado en la app: uno dice lo que tienes según el juego y el otro
        // lo que la app tiene registrado. Verlos juntos es lo que permite detectar desfases.
        const gameLabel = it.crafted
          ? `<span style="color:#f1c40f;">${escapeHTML(t.lblCrafted)}</span>`
          : (it.owned ? `<span style="color:#00ff78;">${it.owned}</span>`
                      : `<span style="color:#555;">${escapeHTML(t.lblNoBadge)}</span>`);

        // Miniatura del ítem: se reutiliza el mismo resolutor que el resto de la app
        // (getItemIcon), que ya contempla los casos especiales (Forma, Silva & Aegis…).
        const icon = getItemIcon(it.name);

        const card = document.createElement("div");
        card.className = `premium-mobile-card ${isBest ? "best" : ""}`;
        card.innerHTML = `
          <div class="mobile-card-top">
            ${icon ? `<img class="mobile-card-icon" src="${icon}" alt="" loading="lazy" onerror="this.style.display='none'">` : ""}
            <div class="mobile-card-header">${escapeHTML(it.name)}</div>
          </div>
          <div class="mobile-currency-row">
            <div class="mobile-price">${typeof price === 'number' ? price : "—"}<img src="assets/relic_contents/platinum.webp" alt="PL" title="Platinum" style="width:14px; height:14px; vertical-align:-2px; margin-left:3px;"></div>
            ${it.ducats ? `<div class="mobile-ducats">${it.ducats} D</div>` : ""}
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <div style="font-size:8px; color:#888;">${escapeHTML(t.lblGameOwned)}</div>
            <div style="font-size:12px; font-weight:900;">${gameLabel}</div>
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <div style="font-size:8px; color:#888;">INV</div>
            <div class="mobile-inv-badge">${owned}</div>
          </div>
          <div class="mobile-card-actions">
            <button class="mobile-action-btn" data-add="${escapeHTML(it.name)}" data-owned="${it.owned || 0}">${escapeHTML(t.cardAdd)}</button>
            <button class="mobile-action-btn" style="flex:0 0 35px;" onclick="globalThis.currentScanner.showPartPicker('${it.name.replaceAll("'", "\\'")}'), ${idx}">✎</button>
          </div>
        `;
        grid.appendChild(card);
      });
    };

    // Añadir NO cierra la hoja: con 4 recompensas, cerrar tras la primera obligaba a volver
    // a disparar para registrar la segunda. La tarjeta se marca como añadida y el resto
    // siguen disponibles; se cierra cuando el usuario quiere.
    grid.addEventListener("click", (ev) => {
      const btn = ev.target.closest("button[data-add]");
      if (!btn || btn.disabled) return;
      const name = btn.getAttribute("data-add");
      const gameOwned = parseInt(btn.getAttribute("data-owned"), 10) || 0;

      // Si el juego mostró la cantidad ("N Owned"), esa es la verdad: se ASIGNA en vez de
      // sumar +1, que arrastraría cualquier desfase previo entre app y juego. Sin badge
      // legible se cae al +1 de siempre.
      const synced = gameOwned > 0 && globalThis.syncRewardFromGame?.(name, gameOwned);
      if (synced) {
        showToast((t.syncedFromGame || "{item}: {n}").replace("{item}", name).replace("{n}", gameOwned));
      } else {
        globalThis.selectRewardToInventory?.(name);
      }
      btn.disabled = true;
      btn.innerText = `✓ ${t.cardAdded}`;
      btn.style.background = "rgba(0,255,120,0.15)";
      btn.style.borderColor = "rgba(0,255,120,0.4)";
      btn.style.color = "#00ff78";
      btn.closest(".premium-mobile-card")?.style.setProperty("opacity", "0.65");
      try { navigator.vibrate?.(25); } catch { /* no soportado */ }
    });

    renderCards(0);
    Promise.all(items.map(it => getPriceValue(it.name, getSlug(it.name))))
      .then(resolved => {
        resolved.forEach((p, i) => { prices[i] = p; });
        renderCards(Math.max(...resolved.filter(p => typeof p === "number"), 0));
      })
      .catch(() => { /* sin precios: las tarjetas ya están en pantalla */ });

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
           <span style="color:#00e5ff; font-weight:900;">${escapeHTML(this.t.pickerTitle)}</span>
           <button onclick="this.closest('#mobile-part-picker').remove()" style="background:none; border:none; color:#fff; font-size:24px;">✕</button>
        </div>
        <input type="text" id="picker-search" placeholder="${escapeHTML(this.t.pickerSearch)}" style="width:100%; background:rgba(255,255,255,0.1); border:1px solid #333; border-radius:10px; padding:12px; color:#fff; font-size:16px;">
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
