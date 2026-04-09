import { getPriceValue, getSlug } from "./api.js";
import { showToast } from "./ui.components/ui_components.js";
import { initScannerMatcherData, parseTextForRewards, initOcrWorkers, findBestItemMatch, isPerfectDbWord } from "./scanner_ocr.js";
import { OpenCVEngine } from "./opencv_engine.js";

/**
 * MobileScanner V22 - Premium Targeting Guide
 * Uses 500px crop height and X-position accumulation for robust detection.
 */
export class MobileScanner {
  stream = null;
  video = null;
  worker1 = null;
  worker2 = null;
  worker3 = null;
  rewardCount = 4; // V147 Manual Control
  calibratedColor = null; // V177 Semantic Color Profile

  toggleScannerDebug() {
    this.debugMode = !this.debugMode;

    const guide = document.getElementById("scanner-box-guide");
    const sideGallery = document.getElementById("scanner-side-gallery");
    const debugLog = document.getElementById("scanner-debug-log");
    const dbgBtn = document.getElementById("btn-debug-toggle");

    if (this.debugMode) {
      if (guide) {
        guide.style.borderColor = "#00e5ff";
        guide.style.boxShadow = "0 0 20px #00e5ff";
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

  calibratedCropY = -1;
  calibratedCropH = 180;
  calibratedCropX = -1;
  calibratedCropW = -1;

  async start() {
    globalThis.currentScanner = this;
    initScannerMatcherData();
    this.createOverlay();

    try {
      const success = await OpenCVEngine.waitReady(30000);
      if (!success) this.setVisionStatus("ERROR AL CARGAR MOTOR", "#ff4b2b");

      initOcrWorkers().then(workers => {
        this.worker1 = workers[0]; this.worker2 = workers[1]; this.worker3 = workers[2];
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
      showToast("Escáner Premium de Alta Precisión");
    } catch (err) { showToast("Error: " + err.message); this.close(); }
  }

  setVisionStatus(text, color) {
    const el = document.getElementById("scanner-vision-status");
    if (el) { el.innerText = text; el.style.color = color; }
  }

  createOverlay() {
    const overlay = document.createElement("div"); overlay.id = "mobile-scan-overlay";
    overlay.style.cssText = "position:fixed; top:0; left:0; width:100%; height:100%; background:transparent; z-index:100000; overflow:hidden; pointer-events:none;";
    this.video = document.createElement("video"); this.video.style.cssText = "width:100%; height:100%; object-fit:cover; pointer-events:none; z-index:100001;";
    overlay.appendChild(this.video);

    const backdrop = document.createElement("div"); backdrop.id = "scanner-backdrop";
    backdrop.style.cssText = "position:absolute; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); z-index:100005; pointer-events:none;";
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

    const guide = document.createElement("div"); guide.id = "scanner-box-guide";
    guide.style.cssText = "position:absolute; top:50%; left:50%; transform:translate(-50%, -50%); width:90%; height:180px; border:2px dashed rgba(255,255,255,0.7); z-index:100010; pointer-events:auto; background:transparent;";
    overlay.appendChild(guide);

    const shutterBtn = document.createElement("button"); shutterBtn.style.cssText = "position:absolute; bottom:30px; left:50%; transform:translateX(-50%); width:80px; height:80px; border-radius:50%; border:5px solid #fff; background:rgba(255,255,255,0.2); z-index:100020; cursor:pointer; pointer-events:auto;";
    shutterBtn.innerHTML = "<div style='width:58px; height:58px; background:#fff; border-radius:50%; margin:4.5px;'></div>";
    shutterBtn.onclick = () => this.captureAndProcess();
    overlay.appendChild(shutterBtn);

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

    const debugPanel = document.createElement("div"); debugPanel.id = "scanner-debug-log";
    debugPanel.style.cssText = "position:absolute; top:70px; left:5%; width:90%; background:rgba(10,12,16,0.98); border:1px solid #00e5ff; z-index:100020; max-height:250px; overflow-y:auto; padding:8px; display:none; color:white; font-family:monospace; font-size:9px; border-radius:8px; word-break:break-all; white-space:pre-wrap;";

    const labelsLayer = document.createElement("div"); labelsLayer.id = "scanner-labels-layer";
    labelsLayer.style.cssText = "position:absolute; top:0; left:0; width:100%; height:100%; pointer-events:none; z-index:100005;";
    guide.appendChild(labelsLayer);

    const sideGallery = document.createElement("div"); sideGallery.id = "scanner-side-gallery";
    sideGallery.style.cssText = `
        position:absolute; top:80px; right:-200px; width:180px; bottom:120px; 
        background: rgba(10, 15, 20, 0.95); backdrop-filter: blur(15px); -webkit-backdrop-filter: blur(15px);
        border-left: 1px solid #00e5ff; border-radius: 12px 0 0 12px;
        z-index: 100030; overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 10px;
        transition: right 0.4s cubic-bezier(0.16, 1, 0.3, 1);
        box-shadow: -10px 0 30px rgba(0,0,0,0.5); pointer-events: none;
    `;

    const toggleGallery = document.createElement("button");
    toggleGallery.id = "toggle-side-gallery";
    toggleGallery.style.cssText = "position:absolute; top:80px; right:0; width:25px; height:60px; background:#00e5ff; color:#000; border:none; border-radius:10px 0 0 10px; z-index:100031; cursor:pointer; font-size:14px; font-weight:bold;";
    toggleGallery.innerText = "‹";
    toggleGallery.onclick = () => {
      const open = sideGallery.style.right === "0px";
      sideGallery.style.right = open ? "-200px" : "0px";
      toggleGallery.innerText = open ? "‹" : "›";
      toggleGallery.style.right = open ? "0" : "180px";
    };

    overlay.appendChild(this.video); overlay.appendChild(headerBar); overlay.appendChild(guide);
    overlay.appendChild(shutterBtn); overlay.appendChild(countSelector); overlay.appendChild(closeBtn);
    overlay.appendChild(sideGallery); overlay.appendChild(toggleGallery);

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
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
    }
    const overlay = document.getElementById("mobile-scan-overlay");
    if (overlay) overlay.remove();
    if (this.discoveryInterval) clearInterval(this.discoveryInterval);
    globalThis.mobileScanner = null;
    globalThis.currentScanner = null;
  }

  async startDiscoveryLoop() {
    if (this.discoveryInterval) return;
    this.discoveryInterval = setInterval(async () => {
      if (this.isProcessing || !this.worker3) return;
      try {
        const video = this.video;
        const vw = video.videoWidth, vh = video.videoHeight;
        if (vw < 10) return;

        const guide = document.getElementById("scanner-box-guide");
        const vRect = video.getBoundingClientRect();
        const gRect = guide ? guide.getBoundingClientRect() : { top: vRect.top + (vRect.height - 180) / 2, height: 180, left: vRect.left, width: vRect.width };

        const videoAspect = vw / vh, screenAspect = vRect.width / vRect.height;
        let scale, offsetX = 0, offsetY = 0;
        if (videoAspect > screenAspect) {
          scale = vRect.height / vh;
          offsetX = (vh * videoAspect * scale - vRect.width) / 2;
        } else {
          scale = vRect.width / vw;
          offsetY = (vw / videoAspect * scale - vRect.height) / 2;
        }

        const cX = Math.max(0, Math.floor(((gRect.left - vRect.left) + offsetX) / scale));
        const cY = Math.max(0, Math.floor(((gRect.top - vRect.top) + offsetY) / scale));
        const cW = Math.min(vw - cX, Math.floor(gRect.width / scale));
        const cH = Math.min(vh - cY, Math.floor(gRect.height / scale));

        const canvasScale = 0.4;
        const cvs = document.createElement("canvas");
        cvs.width = Math.floor(cW * canvasScale); cvs.height = Math.floor(cH * canvasScale);
        const ctx = cvs.getContext("2d");
        if (cvs.width <= 0 || cvs.height <= 0) return;
        ctx.drawImage(video, cX, cY, cW, cH, 0, 0, cvs.width, cvs.height);

        if (OpenCVEngine.isReady) {
          OpenCVEngine.processForOCR(cvs, "discovery", this.calibratedColor, state.visionSettings);
        }
        if (!this.worker3) return;

        const { data } = await this.worker3.recognize(cvs);
        const rewards = parseTextForRewards(data);
        const matches = rewards.map(r => ({ text: r.name, confidence: 99 }));

        const guideEl = document.getElementById("scanner-box-guide");
        if (guideEl) {
          if (matches.length > 0) { guideEl.style.borderColor = "#00e5ff"; guideEl.style.boxShadow = "0 0 20px #00e5ff"; }
          else { guideEl.style.borderColor = "rgba(255,255,255,0.4)"; guideEl.style.boxShadow = "0 0 0 9999px rgba(0,0,0,0.6)"; }
        }
        this.updateDiscoveryLabels(matches, cW, cH, 0, canvasScale);

        if (typeof this.onDiscoveryFrame === "function") {
          this.onDiscoveryFrame(matches, cW, cH, cY);
        }
      } catch (e) { console.warn("Discovery err", e); }
    }, 1500);
  }

  updateDiscoveryLabels(words, vidW, vidH, cropY, scale) {
    const layer = document.getElementById("scanner-labels-layer"); if (!layer) return;

    const currentMatches = words.map(w => w.text.toUpperCase());
    if (layer.dataset.lastKeys === currentMatches.join("|")) return;
    layer.dataset.lastKeys = currentMatches.join("|");
    layer.innerHTML = "";

    words.forEach(w => {
      const label = document.createElement("div");
      label.className = "premium-mobile-badge";

      const xNorm = ((w.bbox.x0 + w.bbox.x1) / 2) / (vidW * scale);
      const yNorm = ((w.bbox.y0 + w.bbox.y1) / 2) / (vidH * scale);

      label.style.left = `${xNorm * 100}%`;
      label.style.top = `${yNorm * 100}%`;

      const match = findBestItemMatch(w.text);
      const itemNameBase = match ? match.name : w.text.toUpperCase();
      const price = getPriceValue(itemNameBase, getSlug(itemNameBase));
      const owned = state.primeInventory ? (state.primeInventory[itemNameBase] || 0) : 0;

      label.innerHTML = `
        <div class="pmb-name">${itemNameBase}</div>
        <div class="pmb-data">
          <div class="pmb-price">
            <span style="width:8px;height:8px;background:#f1c40f;border-radius:50%;display:inline-block;"></span>
            ${price > 0 ? price : "—"}
          </div>
          <div class="pmb-owned">INV: ${owned}</div>
        </div>
      `;
      layer.appendChild(label);
      setTimeout(() => label.style.opacity = "0", 1800);
      setTimeout(() => label.remove(), 2500);
    });
  }

  async captureAndProcess() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    const loader = document.getElementById("ocr-loading");
    const loaderText = loader?.querySelector("p");
    if (loader) {
      loader.classList.remove("hidden");
      if (loaderText) loaderText.innerText = "INICIANDO VISIÓN ARTIFICIAL...";
    }

    const sideGallery = document.getElementById("scanner-side-gallery");
    if (sideGallery) sideGallery.innerHTML = "<div style='color:#00e5ff; font-size:10px; font-weight:900; letter-spacing:1px; border-bottom:1px solid #333; padding-bottom:5px;'>V91 VISION FEED</div>";

    try {
      const video = this.video;
      const vw = video.videoWidth, vh = video.videoHeight;
      if (vw < 10) return;

      const guide = document.getElementById("scanner-box-guide");
      const vRect = video.getBoundingClientRect();
      const gRect = guide ? guide.getBoundingClientRect() : { top: vRect.top + (vRect.height - 180) / 2, height: 180, left: vRect.left, width: vRect.width };

      const videoAspect = vw / vh;
      const screenAspect = vRect.width / vRect.height;

      let scale, offsetX = 0, offsetY = 0;
      if (videoAspect > screenAspect) {
        scale = vRect.height / vh;
        offsetX = (vh * videoAspect * scale - vRect.width) / 2;
      } else {
        scale = vRect.width / vw;
        offsetY = (vw / videoAspect * scale - vRect.height) / 2;
      }

      const cX = Math.max(0, Math.floor(((gRect.left - vRect.left) + offsetX) / scale));
      const cY = Math.max(0, Math.floor(((gRect.top - vRect.top) + offsetY) / scale));
      const cW = Math.min(vw - cX, Math.floor(gRect.width / scale));
      const cH = Math.min(vh - cY, Math.floor(gRect.height / scale));

      const mainCvs = document.createElement("canvas");
      mainCvs.width = cW;
      mainCvs.height = cH;
      const mCtx = mainCvs.getContext("2d");
      mCtx.drawImage(video, cX, cY, cW, cH, 0, 0, cW, cH);

      const results = [];
      const sessionResults = [];

      const strips = [];
      const stripH = Math.floor(cH / this.rewardCount);
      const padV = Math.floor(stripH * 0.12);
      const padH = Math.floor(cW * 0.08);

      for (let i = 0; i < this.rewardCount; i++) {
        const sY = Math.max(0, (i * stripH) - padV);
        const sH = Math.min(cH - sY, stripH + (padV * 2));
        const sX = Math.max(0, -padH);
        const sW = Math.min(cW, cW + (padH * 2));
        strips.push({ x: cX + sX, y: cY + sY, w: sW, h: sH });
      }

      const debugLog = document.getElementById("scanner-debug-log");
      if (debugLog && this.debugMode) {
        debugLog.innerHTML = `<div style="color:#00e5ff; font-weight:900;">[V178] MODO ${this.rewardCount} RECOMPENSAS</div>
                              <div style="color:#506070; font-size:10px; margin-bottom:5px;">${this.calibratedColor ? "PROFILING COLOR ACTIVO" : "SCANNER STANDBY"}</div>`;
        debugLog.style.display = "block";
      }
      if (mainCvs.width <= 0 || mainCvs.height <= 0) return;
      console.log(`CAPTURA : ${mainCvs.width}x${mainCvs.height}`);

      const ocrPromises = strips.map(async (strip, idx) => {
        const statusMsg = `PROCESANDO: ${idx + 1}/${strips.length} BLOQUES...`;
        if (loaderText) loaderText.innerText = statusMsg;

        const statusEl = document.getElementById("scanner-vision-status");
        if (statusEl) {
          statusEl.innerText = statusMsg;
          statusEl.style.color = "#00e5ff";
        }

        if (strip.w <= 0 || strip.h <= 0) return;

        let scale = 120 / strip.h;
        scale = Math.min(5, Math.max(2.5, scale));

        const blockCvs = document.createElement("canvas");
        blockCvs.width = Math.floor(strip.w * scale);
        blockCvs.height = Math.floor(strip.h * scale);

        const bCtx = blockCvs.getContext("2d", { willReadFrequently: true });
        bCtx.imageSmoothingEnabled = true;
        bCtx.imageSmoothingQuality = 'high';

        bCtx.drawImage(mainCvs, strip.x, strip.y, strip.w, strip.h, 0, 0, blockCvs.width, blockCvs.height);

        // 2. PRE-PROCESADO: Binarización dinámica 
        if (OpenCVEngine.isReady) {
          OpenCVEngine.processForOCR(blockCvs, "hard", null, state.visionSettings);
        }
        const originalUrl = blockCvs.toDataURL();

        if (blockCvs.width <= 0 || blockCvs.height <= 0) return;

        // paralelización
        let worker = this.worker1;
        const mod = idx % 3;
        if (mod === 1) worker = this.worker2;
        else if (mod === 2) worker = this.worker3 || this.worker1;

        if (!worker) return;
        const { data } = await worker.recognize(blockCvs);

        const labeledCvs = document.createElement("canvas");
        labeledCvs.width = blockCvs.width; labeledCvs.height = blockCvs.height;
        const lCtx = labeledCvs.getContext("2d");
        lCtx.drawImage(blockCvs, 0, 0);
        lCtx.fillStyle = "rgba(0,0,0,0.7)";
        lCtx.fillRect(0, 0, labeledCvs.width, 24);
        lCtx.fillStyle = "#00e5ff";
        lCtx.font = "bold 15px monospace";
        lCtx.fillText(data.text.trim().substring(0, 30).toUpperCase(), 5, 18);
        const labeledUrl = labeledCvs.toDataURL();

        // Buffer de diagnóstico para la sesión
        const roiDiag = {
          idx, originalUrl, processedUrl: labeledUrl,
          fullText: data.text, matches: []
        };

        // 4. MATCHING
        const detectedItems = parseTextForRewards(data);
        roiDiag.matches = detectedItems;
        sessionResults.push(roiDiag);

        if (debugLog) {
          const div = document.createElement("div");
          div.style.cssText = "border-bottom:1px solid #222; padding:4px 0; font-size:8.5px; opacity:0.8; word-wrap:break-word;";
          div.innerHTML = `<span style="color:#00ff78;">[B-${idx}]</span> ${data.text.trim()}`;
          debugLog.appendChild(div);
        }

        if (sideGallery) {
          const block = document.createElement("div");
          block.style.cssText = "background:rgba(255,255,255,0.05); border-radius:6px; padding:6px; font-size:8px; color:#ccc;";
          block.innerHTML = `
              <div style="margin-bottom:4px; font-weight:900; color:#00e5ff;">BLOQUE ${idx}</div>
              <div style="display:flex; flex-direction:column; gap:4px;">
                <img src="${originalUrl}" style="width:100%; border:1px solid #444; border-radius:4px;" />
                <img src="${labeledUrl}" style="width:100%; border:1px solid #00e5ff; border-radius:4px;" title="${data.text.trim()}" />
              </div>
           `;
          if (sideGallery.children.length > 20) {
            // El primer elemento es la cabecera, borramos el segundo
            if (sideGallery.children[1]) sideGallery.children[1].remove();
          }
          sideGallery.appendChild(block);
          block.scrollIntoView({ behavior: 'smooth' });
        }

        detectedItems.forEach(it => {
          // Calculamos la posición X real en la pantalla 
          const globalX = strip.x + (strip.w / 2);

          results.push({
            ...it,
            xPos: globalX,
            confidence: it.confidence || data.confidence
          });
        });
      });

      await Promise.all(ocrPromises);

      const statusEl = document.getElementById("scanner-vision-status");
      if (statusEl) {
        statusEl.innerText = `ESCANEADO FINALIZADO: ${results.length} ITEMS`;
        //TODO: Fix this
        setTimeout(() => { if (statusEl) statusEl.innerText = "READY (HIGH-SPEED V86)"; }, 3000);
      }

      // Enviamos el bloque completo de la sesión al Debugger si existe
      if (this.debugMode || this.isDebugScanner) {
        sessionResults.sort((a, b) => a.idx - b.idx);
        this.logScanSession({
          time: new Date().toLocaleTimeString(),
          results: sessionResults
        });
      }

      // Finalmente, mostramos los resultados si hemos encontrado algo
      if (results.length > 0) {
        results.sort((a, b) => a.xPos - b.xPos);
        this.showResults(results);
      } else {
        showToast("No se detectaron recompensas claras.");
      }

    } catch (e) {
      console.error(e);
    } finally {
      this.isProcessing = false;
      const activeLoader = document.getElementById("ocr-loading");
      if (activeLoader) activeLoader.classList.add("hidden");
    }
  }

  showResults(items) {
    let rc = document.getElementById("scan-results-sheet"); if (rc) rc.remove();
    rc = document.createElement("div"); rc.id = "scan-results-sheet"; document.body.appendChild(rc);

    rc.style.cssText = `
        position:fixed; bottom:0; left:0; right:0; 
        background: rgba(10, 15, 20, 0.96); backdrop-filter: blur(25px); -webkit-backdrop-filter: blur(25px);
        border-top: 1px solid rgba(0, 229, 255, 0.3); padding: 15px; 
        z-index: 999999; border-radius: 20px 20px 0 0; 
        box-shadow: 0 -10px 40px rgba(0,0,0,0.8);
        animation: slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1);
    `;

    if (!document.getElementById("btn-slide-anim")) {
      const style = document.createElement("style");
      style.id = "btn-slide-anim";
      style.textContent = `@keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }`;
      document.head.appendChild(style);
    }

    rc.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px; padding: 0 5px;">
        <div style="display:flex; align-items:center; gap:8px;">
          <div style="width:8px; height:8px; border-radius:50%; background:#00e5ff; box-shadow:0 0 10px #00e5ff;"></div>
          <div style="color:#00e5ff; font-weight:900; font-size:11px; letter-spacing:2px;">RECOMPENSAS DETECTADAS</div>
        </div>
        <button onclick="this.parentElement.parentElement.remove()" style="background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); color:#fff; width:28px; height:28px; border-radius:50%; cursor:pointer; font-weight:bold;">✕</button>
      </div>
    `;

    const cc = document.createElement("div");
    cc.style.cssText = "display:flex; gap:12px; overflow-x:auto; padding:10px 5px 20px 5px; scrollbar-width:none; -ms-overflow-style:none;";

    Promise.all(items.map(it => getPriceValue(it.name, getSlug(it.name)))).then(prices => {
      const maxPl = Math.max(...prices);

      items.forEach((it, idx) => {
        const price = prices[idx];
        const appOwned = state.primeInventory ? (state.primeInventory[it.name] || 0) : 0;
        const isBest = (price === maxPl && price > 0);
        const ducats = it.ducats || 0;

        const card = document.createElement("div");
        card.style.cssText = `
            background: rgba(255, 255, 255, 0.03); 
            border: 1px solid ${isBest ? "rgba(212, 175, 55, 0.5)" : "rgba(255,255,255,0.15)"}; 
            border-radius: 12px; padding: 12px; min-width: 155px; 
            display: flex; flex-direction: column; gap: 8px;
            position: relative; overflow: hidden;
            box-shadow: ${isBest ? "0 0 20px rgba(212, 175, 55, 0.15)" : "0 4px 10px rgba(0,0,0,0.3)"};
        `;

        if (isBest) {
          const goldTag = document.createElement("div");
          goldTag.style.cssText = "position:absolute; top:0; left:0; width:100%; background:#d4af37; color:#000; font-size:8px; font-weight:900; text-align:center; padding:2px 0; letter-spacing:1px;";
          goldTag.innerText = "MEJOR VALOR";
          card.appendChild(goldTag);
          card.style.paddingTop = "18px";
        }

        card.innerHTML += `
          <div style="font-size:10px; font-weight:800; color:#fff; text-transform:uppercase; line-height:1.2; height:2.4em; overflow:hidden;">${it.name}</div>
          
          <div style="display:flex; justify-content:space-between; align-items:flex-end; margin-top:5px;">
            <div style="display:flex; flex-direction:column; gap:6px;">
                <div style="color:var(--wf-gold-text); font-weight:900; font-size:18px; display:flex; align-items:center; gap:6px;">
                  <img src="assets/relic_contents/platinum.webp" style="width:16px; height:16px; filter: drop-shadow(0 0 5px rgba(212,175,55,0.4));" />
                  ${price > 0 ? price : "—"}
                </div>
                ${ducats > 0 ? `
                  <div style="color:#00e5ff; font-size:11px; font-weight:800; display:flex; align-items:center; gap:5px; background:rgba(0,229,255,0.05); padding:2px 6px; border-radius:4px; width:fit-content;">
                    <img src="assets/Ducats.webp" style="width:12px; height:12px;" />
                    ${ducats}
                  </div>
                ` : ""}
            </div>
            
            <div style="text-align:right;">
                <div style="font-size:8px; color:#aaa; font-weight:800; margin-bottom:2px; letter-spacing:0.5px;">INV</div>
                <div style="background:rgba(0, 255, 120, 0.1); border:1px solid rgba(0, 255, 120, 0.2); border-radius:4px; padding:2px 8px; color:#00ff78; font-size:13px; font-weight:900; box-shadow: 0 0 10px rgba(0,255,120,0.05);">
                  ${appOwned}
                </div>
            </div>
          </div>

          <div style="margin-top:12px; padding-top:10px; border-top:1px solid rgba(255,255,255,0.06); display:flex; justify-content:space-between; align-items:center;">
             <button onclick="globalThis.currentScanner.showPartPicker('${it.name.replace(/'/g, "\\'")}', ${idx})" 
                     style="background:rgba(0,229,255,0.15); border:1px solid rgba(0,229,255,0.3); color:#00e5ff; font-size:9px; padding:6px 12px; border-radius:6px; cursor:pointer; font-weight:900;">
               ✎ ${state.currentLang === 'es' ? 'CORREGIR' : 'EDIT'}
             </button>
             <div style="width:14px; height:14px; border-radius:50%; border:1px solid #00ff78; display:flex; align-items:center; justify-content:center; color:#00ff78; font-size:9px;">✓</div>
          </div>
        `;
        cc.appendChild(card);
      });
    });

    rc.appendChild(cc);

    // Botón de confirmación opcional o footer
    const footer = document.createElement("div");
    footer.style.cssText = "margin-top: 5px; text-align: center; font-size: 9px; color: #555; font-weight: 700; letter-spacing: 0.5px;";
    footer.innerText = "ITEMS AÑADIDOS AUTOMÁTICAMENTE AL REGISTRO";
    rc.appendChild(footer);
  }
}
// FINAL V200
