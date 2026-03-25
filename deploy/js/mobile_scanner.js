import { state } from "./state.js";
import { getPriceValue, getSlug } from "./api.js";
import { showToast } from "./ui.components/ui_components.js";

globalThis.onerror = function (msg, url, lineNo, columnNo, error) {
  return false;
};

export class MobileScanner {
  stream = null;
  video = null;
  canvas = null;
  ctx = null;
  worker = null;
  isProcessing = false;
  debugMode = false;
  cachedDb = [];
  tempCanvas = document.createElement("canvas");
  tempCtx = this.tempCanvas.getContext("2d", {
    willReadFrequently: true,
  });

  async start() {
    this.createOverlay();
    showToast("Iniciando...");

    if (!this.worker && globalThis.Tesseract) {
      try {
        this.worker = await Tesseract.createWorker("eng");
        await this.worker.setParameters({
          tessedit_pageseg_mode: "6",
          tessedit_char_whitelist:
            "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuwxyz ",
        });
      } catch (e) {
        alert("Error Tesseract: " + e.message);
      }
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: "environment",
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          advanced: [{ focusMode: "continuous" }],
        },
      });

      this.video.srcObject = this.stream;
      this.video.onloadedmetadata = async () => {
        await this.video.play();
      };
    } catch (err) {
      alert("Error cámara: " + err.message);
      this.close();
    }
  }

  createOverlay() {
    const overlay = document.createElement("div");
    overlay.id = "mobile-scan-overlay";
    overlay.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: #000; z-index: 100000; display: flex; flex-direction: column;
        `;

    this.video = document.createElement("video");
    this.video.style.cssText = "width: 100%; height: 100%; object-fit: cover;";
    this.video.autoplay = true;
    this.video.playsInline = true;

    const instructionBox = document.createElement("div");
    instructionBox.id = "scanner-instructions";
    const updateStyles = () => {
      const isLandscape = window.innerWidth > window.innerHeight;
      instructionBox.style.cssText = `
        position: absolute; z-index: 100002; background: rgba(15, 17, 21, 0.85);
        border-left: 4px solid #00e5ff; padding: 10px 12px; border-radius: 4px;
        color: #eee; font-size: 12px; line-height: 1.4; pointer-events: none;
        backdrop-filter: blur(4px); transition: all 0.3s ease;
        ${
          isLandscape
            ? "top: 15px; left: 15px; width: 220px; text-align: left;"
            : "top: 18%; left: 50%; transform: translateX(-50%); width: 85%; text-align: center;"
        }
      `;
    };
    updateStyles();
    window.addEventListener("resize", updateStyles);

    instructionBox.innerHTML = `
        <strong style="color:#00e5ff; display:block; margin-bottom:4px; font-size:11px;">HOW TO SCAN:</strong>
        Point at rewards. Position <strong>item names</strong> inside the rectangle. Closer/clearer text improves detection.
    `;

    const guideBox = document.createElement("div");
    guideBox.style.cssText = `
            position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
            width: 90%; height: 20%;
            border: 2px dashed rgba(0, 229, 255, 0.7); border-radius: 8px;
            box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.5);
            pointer-events: none; z-index: 100001;
        `;

    const shutterBtn = document.createElement("button");
    shutterBtn.style.cssText = `
            position: absolute; bottom: 30px; left: 50%; transform: translateX(-50%);
            width: 70px; height: 70px; border-radius: 50%; 
            background: rgba(255, 255, 255, 0.2); border: 4px solid #fff; 
            z-index: 100002; cursor: pointer; display: flex; align-items: center; justify-content: center;
        `;
    const innerBtn = document.createElement("div");
    innerBtn.style.cssText =
      "width: 55px; height: 55px; background: #fff; border-radius: 50%;";
    shutterBtn.appendChild(innerBtn);
    shutterBtn.onclick = (e) => {
      e.stopPropagation();
      this.captureAndProcess();
    };

    const closeBtn = document.createElement("button");
    closeBtn.innerHTML = "✕";
    closeBtn.style.cssText = `
            position: absolute; top: 15px; right: 15px; 
            background: rgba(0,0,0,0.4); color: #fff; border: 1px solid rgba(255,255,255,0.5);
            width: 35px; height: 35px; border-radius: 50%; font-size: 16px; z-index: 100003;
            backdrop-filter: blur(4px); cursor: pointer;
        `;
    closeBtn.onclick = () => {
      window.removeEventListener("resize", updateStyles);
      this.close();
    };

    overlay.appendChild(this.video);
    overlay.appendChild(guideBox);
    overlay.appendChild(instructionBox);
    overlay.appendChild(shutterBtn);
    overlay.appendChild(closeBtn);
    document.body.appendChild(overlay);
  }

  async captureAndProcess() {
    if (this.isProcessing) return;
    this.isProcessing = true;
    showToast("Procesando...");

    const debugBox = this.debugMode
      ? document.getElementById("ocr-raw-debug")
      : null;
    if (debugBox) debugBox.innerText = "Analizando...";

    try {
      if (!this.worker) throw new Error("Tesseract no cargado");
      if (!this.canvas) {
        this.canvas = document.createElement("canvas");
        this.ctx = this.canvas.getContext("2d", { willReadFrequently: true });
      }

      const vidW = this.video.videoWidth;
      const vidH = this.video.videoHeight;
      const cropH = Math.floor(vidH * 0.25);
      const cropW = vidW;
      const cropX = 0;
      const cropY = Math.floor((vidH - cropH) / 2);

      const SCALE = 0.6;
      const finalW = Math.floor(cropW * SCALE);
      const finalH = Math.floor(cropH * SCALE);

      this.canvas.width = finalW;
      this.canvas.height = finalH;

      this.ctx.drawImage(
        this.video,
        cropX,
        cropY,
        cropW,
        cropH,
        0,
        0,
        finalW,
        finalH,
      );
      this.video.pause();

      const rawImageData = this.ctx.getImageData(0, 0, finalW, finalH);
      const processedData = this.processImageVariant(rawImageData);

      if (this.debugMode) {
        this.showDebugImage(processedData, finalW, finalH);
      }

      this.tempCanvas.width = finalW;
      this.tempCanvas.height = finalH;
      this.tempCtx.putImageData(processedData, 0, 0);

      const res = await this.worker.recognize(this.tempCanvas);
      const text = res.data.text.trim();

      if (debugBox) {
        debugBox.innerHTML = `<span style='color:#f1c40f'>RAW:</span> "${text}"`;
      }

      if (this.isGarbageText(text)) {
        if (debugBox)
          debugBox.innerHTML += `<br><span style='color:#e74c3c'>Ruido</span>`;
        showToast("Texto ilegible.");
      } else {
        const items = this.parseItemsFromOCR_Spatial(res.data, 0);

        if (items.length > 0) {
          this.showResults(items);
        } else {
          const singleMatch = this.findBestMatchInDatabase(text);
          if (singleMatch) {
            if (debugBox)
              debugBox.innerHTML += `<br><span style='color:#3498db'>Bruto:</span> ${singleMatch.name}`;
            this.showResults([{ ...singleMatch, xPos: 0 }]);
          } else {
            if (debugBox)
              debugBox.innerHTML += `<br><span style='color:#e74c3c'>Sin coincidencia</span>`;
            showToast("Sin coincidencias.");
          }
        }
      }
    } catch (e) {
      showToast("Error: " + e.message);
    } finally {
      this.video.play();
      this.isProcessing = false;
    }
  }

  processImageVariant(original) {
    const w = original.width;
    const h = original.height;
    const newImg = new ImageData(new Uint8ClampedArray(original.data), w, h);
    const d = newImg.data;
    const THRESHOLD = 155;

    for (let i = 0; i < d.length; i += 4) {
      const r = d[i];
      const g = d[i + 1];
      const b = d[i + 2];
      const luma = 0.299 * r + 0.587 * g + 0.114 * b;
      const val = luma > THRESHOLD ? 0 : 255;
      d[i] = d[i + 1] = d[i + 2] = val;
      d[i + 3] = 255;
    }
    return newImg;
  }

  showDebugImage(imageData, w, h) {
    let debugCvs = document.getElementById("debug-view-cvs");
    if (!debugCvs) {
      debugCvs = document.createElement("canvas");
      debugCvs.id = "debug-view-cvs";
      debugCvs.style.cssText =
        "position:fixed; top:120px; left:10px; width:120px; z-index:100005; border:2px solid #e74c3c; border-radius:4px; background:#fff;";
      document.body.appendChild(debugCvs);
    }
    debugCvs.width = w;
    debugCvs.height = h;
    debugCvs.getContext("2d").putImageData(imageData, 0, 0);
  }

  isGarbageText(text) {
    if (!text) return true;
    const clean = text.replaceAll(/[^A-Z0-9]/g, "");
    return clean.length < 3;
  }

  parseItemsFromOCR_Spatial(ocrData, paddingX = 0) {
    if (!ocrData?.words || !state.itemsDatabase) return [];
    this.initScannerData();

    let validWords = ocrData.words
      .map((w) => {
        const cleanText = w.text
          .trim()
          .toUpperCase()
          .replaceAll(/[^A-Z0-9]/g, "");
        return { ...w, text: cleanText };
      })
      .filter((w) => w.text.length >= 2 && w.confidence > 40);

    if (validWords.length === 0) return [];

    const itemsGroups = [];

    validWords.forEach((word) => {
      const wordMidX = (word.bbox.x0 + word.bbox.x1) / 2;
      const COLUMN_TOLERANCE = this.canvas.width * 0.12;

      const existingGroup = itemsGroups.find((group) => {
        const groupMidX =
          group.reduce((sum, w) => sum + (w.bbox.x0 + w.bbox.x1) / 2, 0) /
          group.length;
        return Math.abs(wordMidX - groupMidX) < COLUMN_TOLERANCE;
      });

      if (existingGroup) {
        existingGroup.push(word);
      } else {
        itemsGroups.push([word]);
      }
    });

    const rawResults = [];

    itemsGroups.forEach((group) => {
      group.sort((a, b) => {
        if (Math.abs(a.bbox.y0 - b.bbox.y0) < 20) {
          return a.bbox.x0 - b.bbox.x0;
        }
        return a.bbox.y0 - b.bbox.y0;
      });

      const rawString = group.map((w) => w.text).join(" ");
      const match = this.findBestMatchInDatabase(rawString);

      if (match) {
        const avgX =
          group.reduce((s, w) => s + (w.bbox.x0 - paddingX), 0) / group.length;
        rawResults.push({ ...match, xPos: avgX });
      }
    });

    return this.consolidateItems(rawResults);
  }

  consolidateItems(items) {
    if (!items || items.length === 0) return [];
    const uniqueByName = new Map();
    items.forEach((item) => {
      if (
        !uniqueByName.has(item.name) ||
        item.confidence > uniqueByName.get(item.name).confidence
      ) {
        uniqueByName.set(item.name, item);
      }
    });
    let candidates = Array.from(uniqueByName.values());
    candidates.sort((a, b) => a.xPos - b.xPos);
    if (candidates.length > 4) candidates = candidates.slice(0, 4);
    return candidates;
  }

  initScannerData() {
    if (!state.itemsDatabase || this.cachedDb.length > 0) return;
    const processedItems = [];
    Object.keys(state.itemsDatabase).forEach((itemName) => {
      const cleanName = itemName
        .toUpperCase()
        .replaceAll("&", "AND")
        .replaceAll(/[^A-Z0-9 ]/g, "");
      const allWords = cleanName.split(" ").filter((w) => w.length > 1);
      processedItems.push({
        originalName: itemName,
        keywords: allWords,
      });
    });
    this.cachedDb = processedItems;
  }

  findBestMatchInDatabase(scannedString) {
    if (!scannedString || scannedString.length < 3) return null;

    const GENERIC_WORDS = new Set([
      "PRIME",
      "BLUEPRINT",
      "BARREL",
      "RECEIVER",
      "STOCK",
      "BLADE",
      "CHASSIS",
      "SYSTEMS",
      "NEUROPTICS",
      "CARAPACE",
      "CEREBRUM",
      "HANDLE",
      "ORNAMENT",
      "WINGS",
      "HARNESS",
      "MAIN",
      "SET",
    ]);
    const inputTokens = scannedString
      .toUpperCase()
      .split(" ")
      .filter((t) => t.length > 2);

    if (inputTokens.length === 0) return null;

    let bestMatch = null;
    let highestScore = 0;
    const MIN_SCORE = 0.35;

    for (const item of this.cachedDb) {
      let matchedCount = 0;
      let uniqueWordMatched = false;

      for (const keyWord of item.keywords) {
        const isGeneric = GENERIC_WORDS.has(keyWord);
        for (const inputWord of inputTokens) {
          if (this.getSimilarity(keyWord, inputWord) > 0.75) {
            matchedCount++;
            if (!isGeneric) uniqueWordMatched = true;
            break;
          }
        }
      }

      if (matchedCount === 0) continue;

      let confidence = matchedCount / item.keywords.length;
      if (uniqueWordMatched) confidence += 0.2;
      if (!uniqueWordMatched) confidence -= 0.15;

      const diff = Math.abs(item.keywords.length - inputTokens.length);
      confidence -= diff * 0.05;

      if (confidence > highestScore) {
        highestScore = confidence;
        bestMatch = { name: item.originalName, confidence };
      }
    }

    const debugBox = this.debugMode
      ? document.getElementById("ocr-raw-debug")
      : null;
    if (
      debugBox &&
      highestScore > MIN_SCORE &&
      !debugBox.innerHTML.includes(bestMatch.name)
    ) {
      debugBox.innerHTML += `<br><span style="color:#3498db">Best: ${
        bestMatch.name
      } (${highestScore.toFixed(2)})</span>`;
    }

    return highestScore >= MIN_SCORE ? bestMatch : null;
  }

  getSimilarity(s1, s2) {
    if (!s1 || !s2) return 0;
    let longer = s1,
      shorter = s2;
    if (s1.length < s2.length) {
      longer = s2;
      shorter = s1;
    }
    if (longer.length === 0) return 1;
    return (
      (longer.length - this.editDistance(longer, shorter)) /
      Number.parseFloat(longer.length)
    );
  }

  editDistance(s1, s2) {
    s1 = s1.toLowerCase();
    s2 = s2.toLowerCase();
    const costs = new Array();
    for (let i = 0; i <= s1.length; i++) {
      let lastValue = i;
      for (let j = 0; j <= s2.length; j++) {
        if (i == 0) costs[j] = j;
        else if (j > 0) {
          let newValue = costs[j - 1];
          if (s1.charAt(i - 1) != s2.charAt(j - 1))
            newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
          costs[j - 1] = lastValue;
          lastValue = newValue;
        }
      }
      if (i > 0) costs[s2.length] = lastValue;
    }
    return costs[s2.length];
  }

  async showResults(items) {
    if (!items || items.length === 0) return;

    let resultsContainer = document.getElementById("scan-results-sheet");
    if (resultsContainer) resultsContainer.remove();

    resultsContainer = document.createElement("div");
    resultsContainer.id = "scan-results-sheet";
    document.body.appendChild(resultsContainer);

    const isPortrait = globalThis.innerHeight > globalThis.innerWidth;

    if (isPortrait) {
      resultsContainer.style.cssText = `
            position: fixed; top: 0; right: 0; bottom: 0; width: 150px;
            background: rgba(10, 10, 15, 0.95); border-left: 3px solid #D4AF37;
            padding: 50px 10px 10px 10px; z-index: 9999999;
            display: flex; flex-direction: column; gap: 15px;
            overflow-y: auto; box-shadow: -5px 0 20px rgba(0,0,0,0.8);
        `;
    } else {
      resultsContainer.style.cssText = `
            position: fixed; bottom: 0; left: 0; right: 0;
            background: rgba(10, 10, 15, 0.95); border-top: 3px solid #D4AF37;
            padding: 15px 10px; z-index: 9999999;
            display: flex; flex-direction: column; gap: 10px;
            box-shadow: 0 -5px 20px rgba(0,0,0,0.8); max-height: 45vh;
        `;
    }

    const header = document.createElement("div");
    header.style.cssText = isPortrait
      ? "width:100%; display:flex; justify-content:center; margin-bottom:10px;"
      : "width:100%; display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;";

    header.innerHTML = `<span style="color:#D4AF37; font-weight:bold; font-size:12px;">${items.length} ITEMS</span>`;

    const closeBtn = document.createElement("button");
    closeBtn.innerText = "X";
    closeBtn.style.cssText =
      "background:#c0392b; border:none; color:white; width:25px; height:25px; border-radius:4px; font-weight:bold;";
    closeBtn.onclick = () => {
      resultsContainer.remove();
      this.close();
    };

    if (isPortrait) {
      resultsContainer.appendChild(closeBtn);
    } else {
      header.appendChild(closeBtn);
    }
    resultsContainer.prepend(header);

    const cardsContainer = document.createElement("div");
    cardsContainer.style.cssText = isPortrait
      ? "display: flex; flex-direction: column; gap: 10px; width: 100%;"
      : "display: flex; gap: 15px; overflow-x: auto; padding-bottom: 5px; width: 100%;";
    resultsContainer.appendChild(cardsContainer);

    const itemsWithDucats = items.map((item) => {
      let ducats = 0;
      if (state.ducatsDatabase) {
        const itemData = Object.values(state.ducatsDatabase).find(
          (d) => d.name.toUpperCase() === item.name.toUpperCase(),
        );
        if (itemData) ducats = itemData.ducats;
      }
      return { ...item, ducats };
    });

    const maxDucats = Math.max(...itemsWithDucats.map((i) => i.ducats));
    const maxPl = Math.max(...itemsWithDucats.map((i) => i.price || 0));

    itemsWithDucats.forEach((item, index) => {
      const card = document.createElement("div");
      const isBestDuc = item.ducats > 0 && item.ducats === maxDucats;
      const isBestPl = (item.price || 0) > 0 && item.price === maxPl;

      card.style.cssText = `
            background: #252525; border: 1px solid ${isBestDuc || isBestPl ? "#D4AF37" : "#555"}; border-radius: 6px;
            padding: 0; text-align: center; color: white;
            min-width: ${isPortrait ? "calc(100% - 16px)" : "140px"};
            box-shadow: 0 2px 5px rgba(0,0,0,0.5);
            display: flex; flex-direction: column; overflow: hidden;
            margin: ${isPortrait ? "0 8px" : "0"};
        `;

      let headerLabel = "";
      if (isBestPl) headerLabel = "MOST VALUABLE";
      else if (isBestDuc) headerLabel = "BEST DUCATS";

      if (headerLabel) {
        const h = document.createElement("div");
        h.innerText = headerLabel;
        h.style.cssText =
          "background:#D4AF37; color:#000; font-size:9px; font-weight:900; padding:2px 0; letter-spacing:0.5px;";
        card.appendChild(h);
      }

      const priceId = `price-tag-${index}`;
      const displayName = item.name.replaceAll("BLUEPRINT", "BP");

      const body = document.createElement("div");
      body.style.cssText = "padding: 10px 8px;";
      body.innerHTML = `
            <div style="font-size:10px; color:#aaa; font-weight:bold; margin-bottom:8px; line-height:1.2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                ${displayName}
            </div>
            <div style="display:flex; justify-content:center; align-items:center; gap:12px; font-weight:bold;">
                <div style="font-size:14px; color:#f1c40f; display:flex; align-items:center; gap:2px;" id="${priceId}">
                    ... <img src="assets/relic_contents/platinum.webp" class="plat-icon" style="height:1em; width:auto; vertical-align:middle;">
                </div>
                <div style="font-size:13px; color:#D4AF37; display:flex; align-items:center; gap:3px;">
                    <img src="assets/Ducats.webp" class="ducat-icon" style="width:16px; height:16px;">
                    ${item.ducats}
                </div>
            </div>
      `;
      card.appendChild(body);
      cardsContainer.appendChild(card);

      getPriceValue(item.name, getSlug(item.name))
        .then((price) => {
          const priceEl = document.getElementById(priceId);
          if (priceEl) {
            priceEl.innerHTML = `${price} <img src="assets/relic_contents/platinum.webp" class="plat-icon" style="height:1em; width:auto; vertical-align:middle;">`;
            priceEl.style.color = "#2ecc71";
          }
        })
        .catch(() => {
          const priceEl = document.getElementById(priceId);
          if (priceEl) priceEl.innerText = "N/A";
        });
    });
  }

  close() {
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    const overlay = document.getElementById("mobile-scan-overlay");
    if (overlay) overlay.remove();
    const sheet = document.getElementById("scan-results-sheet");
    if (sheet) sheet.remove();
    const debug = document.getElementById("debug-view-cvs");
    if (debug) debug.remove();
    this.isProcessing = false;
  }
}
