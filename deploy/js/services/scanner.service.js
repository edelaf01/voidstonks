import { VisionService, WF_THEMES } from "./vision.service.js";
import { OCRService } from "./ocr.service.js";
import { OCRRepository } from "../repositories/ocr.repository.js";
import { OpenCVRepository } from "../repositories/opencv.repository.js";
import { ScannerHUD } from "../ui.components/ui_scanner_hud.js";
import { ScannerModal } from "../ui.components/ui_scanner_modal.js";
import { initializeOCRDatabase } from "../repositories/api.repository.js";

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
    lastHashL: null,
    lastHashR: null,
    rivenConsensusBuffer: [],

    async start() {
        if (this.isScanning) return;
        this.isScanning = true;
        this.latchedContext = "UNKNOWN";
        this.unknownFrameCount = 0;
        this.detectionLocked = false;
        this.lastHashL = null;
        this.lastHashR = null;
        this.rivenConsensusBuffer = [];
        globalThis.ScannerService = this;
        if (!this.virtualCanvas) {
            this.virtualCanvas = document.createElement("canvas");
            this.virtualCanvas.id = "scanner-virtual-canvas";
        }

        // On-demand fetch of the fresh prime items reference list from worker/backend cache
        initializeOCRDatabase().catch(err => console.warn("Error fetching OCR reference database from backend:", err));

        // Pre-fetch Riven weapons list on start to ensure Riven OCR is ready immediately
        import("./rivens.service.js").then(m => m.fetchRivenWeapons()).catch(err => console.warn("Error fetching Riven weapons:", err));

        await OCRRepository.warmUp();
        OpenCVRepository.waitReady().catch(() => { });
        OCRService.initMatcherData();
        this.loop();
    },

    stop() {
        this.isScanning = false;
        if (this.scanInterval) clearTimeout(this.scanInterval);
        this.scanInterval = null;
        OCRRepository.terminateAll();
    },

    async loop() {
        if (!this.isScanning) return;

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
            if (this.isScanning) {
                this.scanInterval = setTimeout(() => this.loop(), this.currentRate);
            }
        }
    },

    latchedContext: "UNKNOWN",
    unknownFrameCount: 0,
    lastRivenContextTime: 0,

    async processFrame(video, virtualCanvas) {
        if (this.detectionLocked) return;
        this.scanCounter++;

        const dims = VisionService.prepareVirtualCanvas(video, virtualCanvas);

        const worker1 = OCRRepository.workers[0];
        const { data: headerData } = await OCRRepository.recognize(worker1, virtualCanvas, {}, { text: true });

        const rawContext = VisionService.determineContext(headerData.text);
        const now = Date.now();

        // Check if header contains Riven/Mods anchors (English and Spanish equivalents)
        const textUpper = (headerData.text || "").toUpperCase();
        const containsAnchor = textUpper.includes("INVENTORY") || textUpper.includes("INVENTARIO") ||
                               textUpper.includes("MODS") || textUpper.includes("MODIFICADORES") ||
                               textUpper.includes("CYCLE") || textUpper.includes("CICLO") || textUpper.includes("CICLAR") ||
                               textUpper.includes("KUVA") || textUpper.includes("KUYVA") ||
                               textUpper.includes("ATRIBUTOS") || textUpper.includes("ELEGIR") || textUpper.includes("CONFIRMAR") ||
                               textUpper.includes("AGRIETADO");
        
        if (rawContext === "INVENTORY_MODS" || rawContext === "ITEM_DETAILS" || containsAnchor) {
            this.lastRivenContextTime = now;
        }

        let routedContext = rawContext;

        // Apply 8-second grace period for Riven/Mods context
        if (this.lastRivenContextTime && (now - this.lastRivenContextTime < 8000)) {
            if (rawContext === "UNKNOWN" || rawContext === "INVENTORY") {
                routedContext = "INVENTORY_MODS";
            } else if (rawContext === "RELICS" || rawContext === "REWARD") {
                // Navigated away: immediately cancel grace period
                this.lastRivenContextTime = 0;
            }
        }

        // Hysteresis/Debounce logic for OCR context noise
        if (routedContext === "UNKNOWN") {
            this.unknownFrameCount++;
            if (this.unknownFrameCount >= 3) {
                this.latchedContext = "UNKNOWN";
            }
        } else {
            this.unknownFrameCount = 0;
            this.latchedContext = routedContext;
        }

        console.log(`[SCAN] Context Raw: ${rawContext} | Latched: ${this.latchedContext} | Header: "${(headerData.text || "").trim().slice(0, 60)}"`);
        await this.routeFrameAction(this.latchedContext, video, dims);

        ScannerHUD.updateFrameCounter(this.scanCounter);
    },

    autoScrollHash: null,
    autoScrollStableTimer: null,
    lastFrameHash: null,
    scrollDirectionAccumulator: 0,
    lastRowLums: null,

    async routeFrameAction(contextType, video, dims) {
        ScannerHUD.updateContext(contextType);

        if (contextType === "INVENTORY") {
            if (!globalThis.state.autoScanEnabled) {
                this.currentRate = 3000; // 3 seconds idle check when autoScan is disabled
                this.autoScrollHash = null;
                this.lastFrameHash = null;
                if (this.autoScrollStableTimer) {
                    clearTimeout(this.autoScrollStableTimer);
                    this.autoScrollStableTimer = null;
                }
                return;
            }

            this.currentRate = 300; // Check faster (every 300ms) for extremely responsive scroll detection!

            const sampleCvs = document.createElement("canvas");
            sampleCvs.width = 48; sampleCvs.height = 27;
            const sCtx = sampleCvs.getContext("2d", { willReadFrequently: true });
            sCtx.drawImage(video, 0, Math.floor(video.videoHeight * 0.25), video.videoWidth, Math.floor(video.videoHeight * 0.5), 0, 0, 48, 27);
            const currentHash = VisionService.getFrameHash(sCtx, 48, 27);

            if (this.lastFrameHash === null || this.lastFrameHash === undefined) {
                this.lastFrameHash = currentHash;
                return;
            }

            // Compute average row luminance of the center strip
            const rowLums = [];
            const imgData = sCtx.getImageData(0, 0, 48, 27);
            const px = imgData.data;
            for (let r = 0; r < 27; r++) {
                let sum = 0;
                const rowStart = r * 48 * 4;
                for (let c = 0; c < 48; c++) {
                    const idx = rowStart + c * 4;
                    sum += px[idx] * 0.299 + px[idx+1] * 0.587 + px[idx+2] * 0.114;
                }
                rowLums.push(sum / 48);
            }

            let bestDy = 0;
            let mseZero = 0;
            if (this.lastRowLums) {
                let minError = Infinity;
                for (let dy = -6; dy <= 6; dy++) {
                    let errorSum = 0;
                    let count = 0;
                    for (let r = 0; r < 27; r++) {
                        const prevR = r + dy;
                        if (prevR >= 0 && prevR < 27) {
                            const diff = rowLums[r] - this.lastRowLums[prevR];
                            errorSum += diff * diff;
                            count++;
                        }
                    }
                    const mse = count > 0 ? (errorSum / count) : Infinity;
                    if (dy === 0) mseZero = mse;
                    if (mse < minError) {
                        minError = mse;
                        bestDy = dy;
                    }
                }
            }
            this.lastRowLums = rowLums;

            // Screen is scrolling if there is a clear vertical shift OR a massive whole-frame change (MSE > 80)
            const isScrolling = (bestDy !== 0 && minError < mseZero - 5) || mseZero > 80;

            if (isScrolling) {
                // Screen is currently in motion (user is scrolling)
                this.scrollDirectionAccumulator += bestDy;
                if (this.autoScrollStableTimer) {
                    clearTimeout(this.autoScrollStableTimer);
                    this.autoScrollStableTimer = null;
                }
                ScannerHUD.updateScrollStatus("detected");
                return;
            }

            // Screen is stable (still). If we haven't scanned this stable page yet (threshold lowered to 120 for sensitivity):
            const hasPageChanged = !this.autoScrollHash || Math.abs(currentHash - this.autoScrollHash) >= 120;
            const isScrollDown = this.scrollDirectionAccumulator > 1;
            const isFirstScan = !this.autoScrollHash;

            if (hasPageChanged && !this.autoScrollStableTimer && !this.detectionLocked) {
                // Only ignore auto-scan when we have confirmed an upward scroll (negative accumulator)
                if (!isFirstScan && this.scrollDirectionAccumulator < 0) {
                    // It was an upward scroll. Ignore auto-scan.
                    this.scrollDirectionAccumulator = 0;
                    this.autoScrollHash = currentHash; // Mark as done to prevent repeat triggers
                    ScannerHUD.updateScrollStatus("done", this.sessionInventory.size);
                    return;
                }

                ScannerHUD.updateScrollStatus("detected"); // Show stabilizing message

                // Wait 800ms of continuous stability before capturing & scanning for premium, instant responsiveness!
                this.autoScrollStableTimer = setTimeout(async () => {
                    this.scrollDirectionAccumulator = 0;
                    if (!globalThis.state.autoScanEnabled || this.detectionLocked) {
                        this.autoScrollStableTimer = null;
                        return;
                    }

                    const v = document.getElementById("live-video");
                    const snapshot = document.createElement("canvas");
                    snapshot.width = v.videoWidth; snapshot.height = v.videoHeight;
                    snapshot.getContext("2d").drawImage(v, 0, 0);

                    await this.processInventoryGrid(snapshot, dims.width, dims.height, dims.scale);
                    this.autoScrollHash = currentHash;
                    this.autoScrollStableTimer = null;

                }, 800);
            } else if (!this.autoScrollStableTimer) {
                // Screen is stable, and we've already scanned this page (or there is no active timer).
                // Safely clear accumulator and immediately restore visual "done" status to prevent HUD from sticking!
                this.scrollDirectionAccumulator = 0;
                ScannerHUD.updateScrollStatus("done", this.sessionInventory.size);
            }

        } else if (contextType === "INVENTORY_MODS" || contextType === "ITEM_DETAILS" || (globalThis.state.scannerModsMode && contextType === "INVENTORY")) {
            this.currentRate = 1200;
            if (this.detectionLocked) return;
            await this.processRivenCard(video, dims, contextType);
        } else if (contextType === "RELICS") {
            if (globalThis.RivenScannerHUD) globalThis.RivenScannerHUD.dismiss();
            this.currentRate = 600;
            await this.processRelicSelection(video, dims);
        } else if (contextType === "REWARD") {
            if (globalThis.RivenScannerHUD) globalThis.RivenScannerHUD.dismiss();
            if (this.detectionLocked) return;
            this.currentRate = 1200;
            await this.processRewards(video, dims);
        } else {
            if (globalThis.RivenScannerHUD) globalThis.RivenScannerHUD.dismiss();
            this.currentRate = globalThis.state.autoScanEnabled ? 1000 : 3000;
        }
    },

    lastParsedL: null,
    lastParsedR: null,

    _isSameRiven(a, b) {
        if (!a && !b) return true;
        if (!a || !b) return false;
        if (a.weaponName !== b.weaponName) return false;
        if (a.rolls !== b.rolls) return false;
        if (a.stats.length !== b.stats.length) return false;
        for (let i = 0; i < a.stats.length; i++) {
            if (a.stats[i].name !== b.stats[i].name) return false;
            if (a.stats[i].isPositive !== b.stats[i].isPositive) return false;
            // Ignore minor value differences to prevent HUD jitter
        }
        return true;
    },

    /**
     * Checks if the new read is of better or equal quality than the old one,
     * to prevent lower-quality frames (missing stats/names) from overriding a good active read.
     */
    _isBetterOrEqualRead(newRiven, oldRiven) {
        if (!oldRiven) return true;
        if (!newRiven) return false;

        // If the old read has a valid weapon name, and the new read doesn't, keep the old one
        if (oldRiven.weaponName && !newRiven.weaponName) return false;

        // If the old read has a valid rolls count, and the new read doesn't, keep the old one
        if (oldRiven.rolls !== null && newRiven.rolls === null) return false;

        // If weaponName or rolls is different (and not null), they are different cards or rolls
        if (newRiven.weaponName !== oldRiven.weaponName || newRiven.rolls !== oldRiven.rolls) {
            return true;
        }

        // Same card and same roll count:
        const newMatchedCount = newRiven.stats.filter(s => s.matched).length;
        const oldMatchedCount = oldRiven.stats.filter(s => s.matched).length;

        // Prefer the read with strictly more matched stats
        if (newMatchedCount > oldMatchedCount) return true;
        if (newMatchedCount < oldMatchedCount) return false;

        // Tie-break on validation confidence (fewer stats flagged as illegal/implausible)
        const newConf = newRiven.validation?.confidence ?? 0;
        const oldConf = oldRiven.validation?.confidence ?? 0;
        if (newConf > oldConf) return true;

        return false;
    },

    _getCanvasHash(canvas) {
        if (!canvas) return "";
        const tiny = document.createElement("canvas");
        tiny.width = 8;
        tiny.height = 8;
        const ctx = tiny.getContext("2d");
        const startY = Math.floor(canvas.height * 0.45);
        const sourceH = canvas.height - startY;
        ctx.drawImage(canvas, 0, startY, canvas.width, sourceH, 0, 0, 8, 8);
        const imgData = ctx.getImageData(0, 0, 8, 8).data;
        let hash = "";
        for (let i = 0; i < imgData.length; i += 4) {
            const avg = Math.floor((imgData[i] + imgData[i+1] + imgData[i+2]) / 3);
            hash += avg.toString(16).padStart(2, "0");
        }
        return hash;
    },

    _compareHashes(hash1, hash2) {
        if (!hash1 || !hash2) return false;
        if (hash1.length !== hash2.length) return false;
        let diff = 0;
        for (let i = 0; i < hash1.length; i += 2) {
            const val1 = parseInt(hash1.substring(i, i + 2), 16);
            const val2 = parseInt(hash2.substring(i, i + 2), 16);
            diff += Math.abs(val1 - val2);
        }
        const avgDiff = diff / (hash1.length / 2);
        return avgDiff < 18;
    },

    /**
     * Generates a fingerprint string from a parsed riven for consensus comparison.
     */
    _rivenFingerprint(parsed) {
        if (!parsed) return "null";
        const w = parsed.weaponName || "?";
        const s = parsed.stats.map(st => `${st.isPositive ? "+" : "-"}${st.name}`).sort().join(",");
        return `${w}|${s}`;
    },

    // Separa las palabras del OCR en cartas por su posición X (hueco grande = frontera entre cartas).
    // Filtra por confianza para tirar el "garbage" que genera el arte de fondo. Reconstruye el texto
    // de cada carta agrupando por líneas (Y) y ordenando por X. Devuelve null si solo hay una carta.
    _wordsToCards(data, canvasWidth) {
        let words = [];
        const pushAll = (arr) => { if (Array.isArray(arr)) for (const w of arr) words.push(w); };
        if (Array.isArray(data?.words)) pushAll(data.words);
        if (!words.length && Array.isArray(data?.lines)) data.lines.forEach(l => pushAll(l.words));
        if (!words.length && Array.isArray(data?.paragraphs)) data.paragraphs.forEach(p => (p.lines || []).forEach(l => pushAll(l.words)));
        if (!words.length && Array.isArray(data?.blocks)) data.blocks.forEach(b => (b.paragraphs || []).forEach(p => (p.lines || []).forEach(l => pushAll(l.words))));

        // Volcado de palabras para depurar inclusión/agrupado en vivo: globalThis._rivenWordDump = true
        if (globalThis._rivenWordDump) {
            const dump = words.filter(w => w && w.text && w.bbox)
                .map(w => `${w.text.trim()}@${Math.round(w.confidence ?? 0)}(${Math.round((w.bbox.x0 + w.bbox.x1) / 2)},${Math.round((w.bbox.y0 + w.bbox.y1) / 2)})`)
                .join("  ");
            console.log(`[RIVEN WORDS] ${dump}`);
        }

        // Palabra "de contenido" (>=3 alfanuméricos o con dígito): tira el ruido suelto del arte.
        const isContent = (t) => (t || "").replace(/[^a-z0-9]/gi, "").length >= 3 || /\d/.test(t || "");

        // Reconstruye el texto de una carta: agrupa por línea (centro-Y, tolerancia = mediana de
        // altura) para que el valor ("+92.4%") y su nombre ("Status Chance") queden en la MISMA línea,
        // y ordena cada línea por X.
        const toText = (ws) => {
            const heights = ws.map(w => w.bbox.y1 - w.bbox.y0).sort((a, b) => a - b);
            const medH = heights[Math.floor(heights.length / 2)] || 20;
            const lines = [];
            for (const w of ws.slice().sort((a, b) => a.bbox.y0 - b.bbox.y0)) {
                const cy = (w.bbox.y0 + w.bbox.y1) / 2;
                let line = lines.find(L => Math.abs(L.cy - cy) < medH * 0.6);
                if (!line) { line = { cy, ws: [] }; lines.push(line); }
                line.ws.push(w);
                line.cy = (line.cy * (line.ws.length - 1) + cy) / line.ws.length;
            }
            lines.sort((a, b) => a.cy - b.cy);
            return lines.map(L => L.ws.sort((a, b) => a.bbox.x0 - b.bbox.x0).map(w => w.text).join(" ")).join("\n");
        };

        const gapThresh = Math.max(canvasWidth * 0.07, 80); // hueco entre cartas ≫ espaciado intra-carta
        const clusterByX = (ws) => {
            const items = ws.map(w => ({ w, cx: (w.bbox.x0 + w.bbox.x1) / 2 })).sort((a, b) => a.cx - b.cx);
            const groups = [[]];
            let prev = null;
            for (const it of items) {
                if (prev !== null && it.cx - prev > gapThresh) groups.push([]);
                groups[groups.length - 1].push(it.w);
                prev = it.cx;
            }
            return groups;
        };

        // --- Paso PRINCIPAL: anclas espaciales (robusto al ruido del arte) ---
        // El arte de la carta hace que Tesseract escupa ~100 tokens basura de confianza baja,
        // dispersos en X, que corrompen un corte por confianza plana. El texto real de los stats es
        // de confianza ALTA (≳84) y va MUY agrupado por carta; la basura es ≤~67 y dispersa. Así que:
        // anclamos en los tokens de confianza alta para ubicar la CAJA de cada carta, y dentro de esa
        // caja metemos tokens de confianza más baja (≥28) — recupera el negativo/curse tenue (~35 de
        // confianza) y descarta la basura dispersa. Validado offline contra el motor real (tesseract.js).
        const ANCHOR_CONF = 70; // entre la basura (≤~67) y el texto real (≳84)
        const INSIDE_CONF = 28; // tokens tenues pero reales dentro de la caja (p.ej. la línea del curse)
        const anchors = words.filter(w => w && w.text && w.bbox && isContent(w.text) && (w.confidence ?? 0) >= ANCHOR_CONF);
        console.log(`[OCR DIAG] dataKeys=[${Object.keys(data || {}).join(",")}] rawWords=${words.length} anchors=${anchors.length}`, words[0]);
        if (anchors.length >= 3) {
            const anchorGroups = clusterByX(anchors).filter(g => g.length >= 3);
            if (anchorGroups.length >= 2) {
                const inside = words.filter(w => w && w.text && w.bbox && isContent(w.text) && (w.confidence ?? 0) >= INSIDE_CONF);
                const cards = anchorGroups.map(g => {
                    // Las cartas se separan por X (van lado a lado); incluimos los tokens cuyo CENTRO-X
                    // cae en la columna de la carta, sin filtrar por Y, para captar el nombre del arma
                    // (arriba) y la línea del curse (abajo). El parser ignora el ruido que no es stat.
                    const x0 = Math.min(...g.map(t => t.bbox.x0)), x1 = Math.max(...g.map(t => t.bbox.x1));
                    const mx = (x1 - x0) * 0.06;
                    const ws = inside.filter(w => {
                        const cx = (w.bbox.x0 + w.bbox.x1) / 2;
                        return cx >= x0 - mx && cx <= x1 + mx;
                    });
                    return toText(ws);
                });
                console.log(`[OCR DIAG] spatial cards=${cards.length} (anchorGroups=${anchorGroups.length})`);
                return cards;
            }
        }

        // --- FALLBACK: corte por confianza plana (>=50) + hueco en X (comportamiento original) ---
        const usable = words.filter(w => w && w.text && isContent(w.text) && (w.confidence ?? 0) >= 50 && w.bbox);
        console.log(`[OCR DIAG] usable=${usable.length} (fallback)`);
        if (usable.length < 3) return null;
        const realGroups = clusterByX(usable).filter(g => g.length >= 3);
        console.log(`[OCR DIAG] gapThresh=${Math.round(gapThresh)} realGroups=${realGroups.length}`);
        if (realGroups.length < 2) return null; // una sola carta -> deja el flujo normal
        return realGroups.map(toText);
    },

    async processRivenCard(video, dims, contextType = null) {
        const { scale } = dims;

        // El popup "Item Details" (riven linkeado) tiene la carta centrada y más arriba que el reroll,
        // así que usa su propio recorte; el resto usa el de la pantalla de reroll.
        const cardCrop = contextType === "ITEM_DETAILS" ? VisionService.RIVEN_ITEM_DETAILS_CROP : VisionService.RIVEN_CARD_CROP;

        // The reroll screen shows ONE centered card or TWO side-by-side (old vs new roll).
        // prepareRivenCardCanvases auto-detects and returns one tightly-cropped canvas per card.
        const canvases = VisionService.prepareRivenCardCanvases(video, scale, cardCrop);
        const hash = canvases.map(c => this._getCanvasHash(c)).join("|");

        // Debug: set `globalThis.dumpRivenCrops = true` in the console to print each binarized crop
        // as a data URL (paste into a browser address bar to view it). Runs before the hash-skip so
        // it fires even on a static, already-parsed screen.
        if (globalThis.dumpRivenCrops) {
            canvases.forEach((c, i) => console.log(`[RIVEN CROP ${canvases.length > 1 ? `C${i + 1}` : "C"}] ${c.toDataURL("image/png")}`));
            globalThis.dumpRivenCrops = false;
        }

        // Skip OCR if we already have a result and the crops haven't changed
        if ((this.lastParsedL || this.lastParsedR) && this._sameCombinedHash(hash, this.lastHashL)) {
            this.lastRivenContextTime = Date.now();
            return;
        }

        const worker = OCRRepository.workers[1] || OCRRepository.workers[0];
        const { RivenOCRService } = await import("./riven_ocr.service.js?v=2");

        const reads = await Promise.all(canvases.map(c => OCRRepository.recognize(worker, c, {}, { blocks: true })));
        // El layout side-by-side hace que el OCR lea AMBAS cartas en una sola pasada (el arte de fondo
        // funde el recorte de imagen). Separamos por posición X de las palabras —filtrando el garbage
        // del arte por confianza— en vez de fiarnos del recorte. Así C1/C2 salen limpios y sin mezclar.
        const entries = [];
        reads.forEach((res, ci) => {
            const cardTexts = this._wordsToCards(res.data, canvases[ci].width) || [res.data.text || ""];
            cardTexts.forEach((text) => {
                const parsed = RivenOCRService.parseRivenCard(text);
                const label = `C${entries.length + 1}`;
                this._logRivenRead(label, text, parsed, canvases[ci]);
                entries.push({ res, text, parsed, canvas: canvases[ci] });
            });
        });

        // Extend grace period while the screen still looks riven-related
        const anyText = entries.map(e => e.text.toUpperCase()).join(" ");
        const hasCardAnchor = /CYCLE|KUVA|KUYVA|CONFIRM|\bMR\s*\d/.test(anyText);

        // Keep only confident reads (drops mod-grid / background noise), left-to-right
        const MIN_CONF = 0.5;
        const valids = entries.filter(e => e.parsed && (e.parsed.validation?.confidence ?? 0) >= MIN_CONF);

        if (valids.length || hasCardAnchor) this.lastRivenContextTime = Date.now();

        // --- TEMPORAL CONSENSUS: require 2/3 matching fingerprints (of the whole card set) ---
        const currentFP = valids.map(e => this._rivenFingerprint(e.parsed)).join("||") || "none";
        this.rivenConsensusBuffer.push(currentFP);
        if (this.rivenConsensusBuffer.length > 3) this.rivenConsensusBuffer.shift();
        const matchCount = this.rivenConsensusBuffer.filter(fp => fp === currentFP).length;
        const hasConsensus = matchCount >= 2;

        const parsedL = valids[0]?.parsed || null;
        const parsedR = valids[1]?.parsed || null;

        // A frame that reveals MORE cards than we're currently showing is strictly more complete:
        // the reroll comparison has two cards, but a wide/noisy frame often parses only one, shows
        // a single riven, and then the consensus gate blocks the good two-card frame from ever
        // updating it (its fingerprint differs, so 2/3 never forms). Let "more cards" through
        // immediately so the second riven appears. Downgrades (fewer cards) still need consensus,
        // so a single bad frame can't drop a card that is genuinely there.
        const shownCount = (this.lastParsedL ? 1 : 0) + (this.lastParsedR ? 1 : 0);
        const revealsMore = valids.length > shownCount;

        // Switching to a different weapon/riven should update immediately instead of waiting for the
        // 2/3 consensus (which exists to stabilize a noisy read of the SAME card, not to delay a
        // genuinely new one). Key off the set of weapon names: if it differs from what's shown, it's
        // a new card → show it on the first valid read. Same-weapon rerolls keep the consensus
        // stabilization (so jittery stat values don't flicker the display).
        const newWeapons = valids.map(e => e.parsed.weaponName).filter(Boolean).sort().join("|");
        const shownWeapons = [this.lastParsedL, this.lastParsedR].filter(Boolean)
            .map(p => p.weaponName).filter(Boolean).sort().join("|");
        const weaponChanged = newWeapons !== "" && newWeapons !== shownWeapons;

        if (!hasConsensus && !revealsMore && !weaponChanged && (this.lastParsedL || this.lastParsedR)) {
            console.log(`[RIVEN OCR] Consensus: ${matchCount}/3 — waiting for confirmation`);
            if (globalThis._scannerDebug) this._renderRivenDebug(entries, false);
            return;
        }

        // Update only when the detected set is new (different from what's already shown)
        const lastFP = [this.lastParsedL, this.lastParsedR].filter(Boolean)
            .map(p => this._rivenFingerprint(p)).join("||") || "none";
        const shouldUpdate = currentFP !== "none" && currentFP !== lastFP;

        if (globalThis._scannerDebug) this._renderRivenDebug(entries, shouldUpdate);

        if (!shouldUpdate) return;

        this.lastParsedL = parsedL;
        this.lastParsedR = parsedR;
        this.lastHashL = hash;
        this.lastHashR = null;

        // Capture a clean color crop of the whole card region as a downloadable screenshot
        let screenshotDataURL = null;
        try {
            const C = cardCrop;
            const colorCvs = document.createElement("canvas");
            const cropX = Math.floor(video.videoWidth * C.x);
            const cropW = Math.floor(video.videoWidth * C.w);
            const cropY = Math.floor(video.videoHeight * C.y);
            const cropH = Math.floor(video.videoHeight * C.h);
            colorCvs.width = cropW;
            colorCvs.height = cropH;
            colorCvs.getContext("2d").drawImage(video, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
            screenshotDataURL = colorCvs.toDataURL("image/png");
        } catch (e) {
            console.warn("Screenshot capture failed:", e);
        }

        if (globalThis.showRivenAppraisal) {
            globalThis.showRivenAppraisal(parsedL, parsedR, screenshotDataURL);
        }
    },

    // Compares two "hashA|hashB" combined canvas hashes segment-by-segment.
    _sameCombinedHash(a, b) {
        if (!a || !b) return false;
        const pa = a.split("|"), pb = b.split("|");
        if (pa.length !== pb.length) return false;
        return pa.every((h, i) => this._compareHashes(h, pb[i]));
    },

    /**
     * Structured per-card log: raw OCR, the cropped canvas size, the parsed result,
     * and the known-riven validation (confidence + issues). Collapsed console group.
     */
    _logRivenRead(side, rawText, parsed, canvas) {
        const raw = (rawText || "").trim().replace(/\n/g, " | ");
        const v = parsed?.validation;
        const tag = parsed
            ? `${parsed.weaponName || "?"} | ${parsed.stats.length} stats | conf ${v ? v.confidence : "?"}${v && !v.valid ? " ⚠" : " ✓"}`
            : "no parse";
        // Raw OCR text on the TOP-LEVEL line so it is visible without expanding a group —
        // this is the single most useful signal for diagnosing crop/binarization issues.
        console.log(`[RIVEN OCR ${side}] ${tag} | crop ${canvas?.width}x${canvas?.height} | raw: "${raw}"`);
        if (parsed) {
            const stats = parsed.stats.map(s => `${s.isPositive ? "+" : "-"}${s.value}% ${s.name}${s.suspicious ? "⚠" : ""}`).join("  ");
            console.log(`  → riven: ${parsed.rivenName || "—"} | rolls ${parsed.rolls ?? "—"} | mr ${parsed.mr ?? "—"} | ${stats}`);
            if (v?.issues?.length) console.log(`  → issues: ${v.issues.join("; ")}`);
        }
    },

    /**
     * Renders the riven debug panel: each detected card's binarized OCR input side by side,
     * with its OCR line boxes and parsed weapon/confidence. `entries` is the array from
     * processRivenCard ({ res, parsed, canvas } per card).
     */
    _renderRivenDebug(entries, accepted) {
        if (!entries || entries.length === 0) return;

        const gap = 12;
        const panelH = Math.max(...entries.map(e => e.canvas.height));
        const totalW = entries.reduce((w, e) => w + e.canvas.width, 0) + gap * (entries.length - 1);

        const debugCvs = document.createElement("canvas");
        debugCvs.width = Math.max(totalW, 200);
        debugCvs.height = panelH + 22;
        const dCtx = debugCvs.getContext("2d");
        dCtx.fillStyle = "#000";
        dCtx.fillRect(0, 0, debugCvs.width, debugCvs.height);

        let xOff = 0;
        entries.forEach((e, idx) => {
            dCtx.drawImage(e.canvas, xOff, 18);

            // OCR line boxes (coords are in this card's canvas space)
            if (e.res?.data?.lines) {
                e.res.data.lines.forEach(line => {
                    const t = line.text ? line.text.trim() : "";
                    if (!t || !line.bbox) return;
                    const b = line.bbox;
                    const isStat = t.includes("%") || t.includes("+") || t.includes("-");
                    dCtx.strokeStyle = "rgba(0, 229, 255, 0.6)";
                    dCtx.lineWidth = 1;
                    dCtx.strokeRect(xOff + b.x0, 18 + b.y0, b.x1 - b.x0, b.y1 - b.y0);
                    dCtx.fillStyle = isStat ? "#00ff78" : "#aaa";
                    dCtx.font = "9px monospace";
                    dCtx.fillText(t, xOff + b.x0, 18 + b.y0 - 1);
                });
            }

            const conf = e.parsed?.validation ? ` c${e.parsed.validation.confidence}` : "";
            dCtx.fillStyle = "rgba(172, 131, 213, 0.95)";
            dCtx.font = "bold 10px monospace";
            dCtx.fillText(`#${idx + 1} ${e.parsed ? (e.parsed.weaponName || "?") : "—"}${conf}`, xOff + 2, 12);

            xOff += e.canvas.width + gap;
        });

        const consensusCount = this.rivenConsensusBuffer.filter(fp => fp === this.rivenConsensusBuffer[this.rivenConsensusBuffer.length - 1]).length;
        dCtx.fillStyle = accepted ? "#00ff78" : "#ff6644";
        dCtx.font = "bold 10px monospace";
        dCtx.fillText(`${accepted ? "✓" : "⏳"} ${consensusCount}/3`, debugCvs.width - 48, 12);

        ScannerHUD.updateDebugSnapshot(debugCvs.toDataURL("image/webp"));
    },

    async processRelicSelection(video, dims) {
        const { scale } = dims;
        const canvas = VisionService.prepareRelicSelectionCanvas(video, scale);
        const worker1 = OCRRepository.workers[0];
        const { data } = await OCRRepository.recognize(worker1, canvas, {}, { text: true });

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
        console.log(`[REWARD] Canvas: ${ocrCanvas.width}x${ocrCanvas.height}`);

        if (globalThis.OpenCVEngine?.isReady) {
            globalThis.OpenCVEngine.processForOCR(ocrCanvas, "hard");
            console.log("[REWARD] Binarization: OpenCV");
        } else {
            // Canvas is already grayscale from CSS filter.
            // Invert: bright=text → black(0), dark=background → white(255)
            const ctx = ocrCanvas.getContext("2d", { willReadFrequently: true });
            const imgData = ctx.getImageData(0, 0, ocrCanvas.width, ocrCanvas.height);
            const px = imgData.data;
            let textPixels = 0;
            for (let i = 0; i < px.length; i += 4) {
                const v = px[i] > 128 ? 0 : 255;
                if (v === 0) textPixels++;
                px[i] = px[i + 1] = px[i + 2] = v;
            }
            ctx.putImageData(imgData, 0, 0);
            const totalPx = px.length / 4;
            console.log(`[REWARD] Binarization: ${textPixels} text pixels / ${totalPx} total (${(100 * textPixels / totalPx).toFixed(2)}%)`);
        }

        const dbgPanel = document.getElementById("live-debug-snapshot");
        if (dbgPanel?.style.display === "block") {
            const debugImg = document.getElementById("live-debug-snapshot-img");
            if (debugImg) debugImg.src = ocrCanvas.toDataURL("image/jpeg", 0.85);
        }

        // 2ª pasada: NOMBRES por máscara de color del tema. El grayscale funde el color del nombre
        // con el fondo/ilustración dorada y Tesseract lee basura; el filtro por color del tema lo aísla.
        // Mismo recorte/escala que ocrCanvas -> las cajas de palabra comparten coordenadas, así que
        // parseRewards (que separa columnas por X) fusiona nombres (color) + Owned/Crafted (grayscale).
        // Las DOS pasadas corren EN PARALELO (workers distintos) -> no suman latencia frente a una sola.
        const namesCanvas = VisionService.prepareRewardNamesCanvas(video, width, height, scale);
        const w0 = OCRRepository.workers[0];
        const w1 = OCRRepository.workers[1] || w0;
        const [metaRes, namesRes] = await Promise.all([
            OCRRepository.recognize(w0, ocrCanvas, {}, { blocks: true }),
            OCRRepository.recognize(w1, namesCanvas, {}, { blocks: true }),
        ]);
        const data = metaRes.data;
        const rawOcr = data.text || "";
        console.log(`[REWARD] OCR raw (grayscale/badges): "${rawOcr.replaceAll(/\n+/g, " ").trim().slice(0, 120)}"`);
        const namesRaw = namesRes.data?.text || "";
        console.log(`[REWARD] OCR raw (color/nombres): "${namesRaw.replaceAll(/\n+/g, " ").trim().slice(0, 120)}"`);

        const mergedWords = [...(namesRes.data?.words || []), ...(data.words || [])];
        const foundItems = OCRService.parseRewards({ words: mergedWords, imageW: ocrCanvas.width });
        console.log(`[REWARD] Items found: ${foundItems.length}`, foundItems.map(i => i.name));

        clearRewardDebugLogs();
        const cleanOcrText = rawOcr.replaceAll(/\n+/g, ' ').trim();
        addRewardDebugLog("OCR", `Read: ${cleanOcrText}`, "info");
        addRewardDebugLog("SCAN", `Items found: ${foundItems.length}`, foundItems.length > 0 ? "match" : "warn");

        // Guard de contexto: la pantalla de FIN DE MISIÓN muestra partes prime en su grid
        // de botín dentro de la misma banda de recorte y dispara falsos positivos. Su UI
        // fija ("MISSION COMPLETE", dropdown IMPORTANCE, caja SEARCH) no existe en la
        // pantalla de selección de recompensa de reliquia, así que sirve de descarte.
        const contextText = `${rawOcr} ${namesRaw}`.toUpperCase();
        const NON_REWARD_TOKENS = [
            "MISSION COMPLETE", "MISION COMPLETADA", "MISIÓN COMPLETADA",
            "IMPORTANCE", "IMPORTANCIA", "SEARCH", "BUSCAR",
        ];
        const badToken = NON_REWARD_TOKENS.find(t => contextText.includes(t));
        if (badToken && foundItems.length > 0) {
            console.log(`[REWARD] Ignorado: pantalla fuera de contexto (token "${badToken}")`);
            addRewardDebugLog("CTX", `Skipped: end-of-mission screen detected ("${badToken}")`, "warn");
            return;
        }

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

        try {
            // 1. Ensure calibration exists (single-zone format)
            if (globalThis.LiveCalibration && !globalThis.LiveCalibration.hasCalibration()) {
                console.log("[INV] No calibration found. Starting zone calibration...");
                const calibCvs = document.createElement("canvas");
                calibCvs.width = width;
                calibCvs.height = height;
                const calibCtx = calibCvs.getContext("2d", { willReadFrequently: true });
                calibCtx.drawImage(snapshot, 0, 0);
                await globalThis.LiveCalibration.runCalibrationFlow(
                    calibCtx.getImageData(0, 0, width, height)
                );
                return;
            }

            const calibData = globalThis.LiveCalibration?.getGrid();
            if (!calibData?.gridZone) {
                console.warn("[INV] No grid zone calibration available.");
                return;
            }

            const { gridZone } = calibData;

            // 2. Detect UI theme from within the calibrated zone
            const theme = VisionService.detectThemeFromSnapshot(
                snapshot,
                gridZone.x, gridZone.y, gridZone.w, gridZone.h
            );
            console.log(`[INV] Theme detected: ${theme.name} (r:${theme.r} g:${theme.g} b:${theme.b})`);

            // 3. Auto-detect grid cell positions from theme pixel density
            const autoGrid = VisionService.buildAutoGrid(snapshot, gridZone, theme, calibData);
            if (!autoGrid || autoGrid.cellRects.length === 0) {
                console.warn("[INV] Auto-grid detection failed — inventory may not be visible or zone needs recalibration.");
                ScannerHUD.updateScrollStatus("done", 0);
                return;
            }

            const { cellRects, cellW, cellH } = autoGrid;
            console.log(`[INV] Auto-grid: ${autoGrid.rows}r × ${autoGrid.cols}c, ${cellRects.length} cells`);

            ScannerHUD.updateScrollStatus("scanning");

            // Debug overlay canvas (cropped to the calibrated section for a clear, high-res zoom in UI)
            const debugCanvas = document.createElement("canvas");
            debugCanvas.width = gridZone.w;
            debugCanvas.height = gridZone.h;
            const dCtx = debugCanvas.getContext("2d");
            dCtx.drawImage(snapshot, gridZone.x, gridZone.y, gridZone.w, gridZone.h, 0, 0, gridZone.w, gridZone.h);

            // Draw detected cell grid borders (cyan) relative to the calibrated section
            dCtx.strokeStyle = "rgba(0,229,255,0.4)";
            dCtx.lineWidth = 1;
            cellRects.forEach(cell => dCtx.strokeRect(cell.sx - gridZone.x, cell.sy - gridZone.y, cellW, cellH));

            // Draw horizontal dashed amber guidelines representing the quantity baselines for the 3 rows
            const gridLeft = Math.min(...cellRects.map(c => c.sx)) - gridZone.x;
            const gridRight = Math.max(...cellRects.map(c => c.sx + cellW)) - gridZone.x;
            dCtx.strokeStyle = "rgba(255, 193, 7, 0.5)"; // elegant amber
            dCtx.lineWidth = 1.5;
            dCtx.setLineDash([6, 4]);
            for (let ri = 0; ri < autoGrid.rows; ri++) {
                const rowCell = cellRects.find(c => c.r === ri);
                if (rowCell) {
                    dCtx.beginPath();
                    dCtx.moveTo(gridLeft, rowCell.sy - gridZone.y);
                    dCtx.lineTo(gridRight, rowCell.sy - gridZone.y);
                    dCtx.stroke();
                }
            }
            dCtx.setLineDash([]); // Reset line dash

            // 4. Extract active non-empty cells
            const activeCells = [];
            for (const cell of cellRects) {
                // Crop precisely the bottom portion of the card (starting at 58% height) 
                // where the 1-line or 2-line item names are printed, completely avoiding 
                // the weapon/warframe illustration in the middle of the card.
                const textSrcY = Math.round(cellH * 0.58);
                const textSrcH = cellH - textSrcY;
                const textCvs = VisionService.cropThemeBinarized(snapshot, cell.sx, cell.sy + textSrcY, cellW, textSrcH, theme);

                const tCtx = textCvs.getContext("2d");
                const imgData = tCtx.getImageData(0, 0, textCvs.width, textCvs.height);
                const pixels = imgData.data;
                let whitePixelCount = 0;
                for (let p = 0; p < pixels.length; p += 4) {
                    if (pixels[p] > 200) whitePixelCount++;
                }

                if (whitePixelCount < 40) {
                    this.lastRawOcrLog.push(`[r${cell.r}c${cell.c}] SKIPPED (empty)`);
                    const relX = cell.sx - gridZone.x;
                    const relY = cell.sy - gridZone.y;
                    dCtx.strokeStyle = "rgba(255, 255, 255, 0.04)";
                    dCtx.lineWidth = 1;
                    dCtx.strokeRect(relX + 2, relY + 2, cellW - 4, cellH - 4);
                } else {
                    activeCells.push({ cell, textCvs });
                }
            }

            const workers = OCRRepository.workers;
            const bWorkers = OCRRepository.badgeWorkers;
            this.lastRawOcrLog = [];

            let cellIndex = 0;
            const runWorker = async (worker, bWorker) => {
                while (cellIndex < activeCells.length) {
                    const task = activeCells[cellIndex++];
                    if (!task) break;

                    const { cell, textCvs } = task;
                    const combinedText = await OCRService.extractCellText(worker, textCvs);

                    if (!combinedText) {
                        this.lastRawOcrLog.push(`[r${cell.r}c${cell.c}] NONE`);
                        continue;
                    }

                    let logStr = `[r${cell.r}c${cell.c}] OCR: ${combinedText.join(" ")}`;
                    let bestItem = OCRService.getValidItemMatch(combinedText);
                    
                    // Fallback: if no match, try full cell OCR (captures text at top/left like Octavia Prime Blueprint)
                    if (!bestItem) {
                        const fullCellCvs = VisionService.cropThemeBinarized(snapshot, cell.sx, Math.max(0, cell.sy - 16), cellW, cellH + 16, theme);
                        const fallbackText = await OCRService.extractCellText(worker, fullCellCvs);
                        if (fallbackText && fallbackText.length) {
                            logStr = `[r${cell.r}c${cell.c}] OCR (fallback): ${fallbackText.join(" ")}`;
                            bestItem = OCRService.getValidItemMatch(fallbackText);
                        }
                    }

                    // Debug log disabled for production performance boost (reduces console render lag)
                    /*
                    console.log(`%c[INV CELL r${cell.r}c${cell.c}]%c OCR: %c"${combinedText.join(" ")}"%c -> Match: %c${bestItem ? bestItem.originalName : "NONE"}`, 
                        "color: #00e5ff; font-weight: bold;", 
                        "color: #ffffff;", 
                        "color: #ffc107; font-style: italic; font-weight: bold;", 
                        "color: #ffffff;", 
                        bestItem ? "color: #00ff78; font-weight: bold;" : "color: #ff3d00; font-weight: bold;"
                    );
                    */

                    if (bestItem) {
                        // 4b. Extract badge (quantity) using improved color-based crop
                        const badgeCanvas = VisionService.extractBadgeByColor(snapshot, cell, cellW, cellH, theme);
                        const qtyResult = await OCRService.extractCellQuantity(bWorker, badgeCanvas);

                        logStr += ` || BDG: ${qtyResult.raw}`;
                        this.lastRawOcrLog.push(logStr);

                        this.sessionInventory.set(bestItem.originalName, qtyResult.qty);

                        const relX = cell.sx - gridZone.x;
                        const relY = cell.sy - gridZone.y;

                        // Draw a single elegant opaque label block at the bottom of the card to fully cover underlying text
                        dCtx.fillStyle = "rgba(10, 15, 28, 0.98)";
                        dCtx.fillRect(relX, relY + cellH - 50, cellW, 50);
                        
                        // Thin cyan line top separator for premium feel
                        dCtx.fillStyle = "rgba(0, 229, 255, 0.7)";
                        dCtx.fillRect(relX, relY + cellH - 50, cellW, 1.5);

                        // 1. Raw Tesseract OCR Text (Amber, italic, 9px)
                        dCtx.fillStyle = "#ffb300";
                        dCtx.font = "italic 9px system-ui, -apple-system, sans-serif";
                        const rawText = combinedText.join(" ");
                        const badgeRawText = qtyResult.raw ? qtyResult.raw.trim().replaceAll(/\s+/g, " ") : "Ø";
                        const maxCharsItem = Math.floor(cellW / 5.5);
                        const truncatedItem = rawText.length > maxCharsItem ? rawText.slice(0, maxCharsItem - 3) + "..." : rawText;
                        dCtx.fillText(truncatedItem, relX + 6, relY + cellH - 37);

                        // Line 2: Raw Badge Text
                        dCtx.fillText(`BDG: "${badgeRawText}"`, relX + 6, relY + cellH - 25);

                        // 2. Clean Matched Catalog Name (Green, bold, 12px)
                        dCtx.fillStyle = "#00ff78";
                        dCtx.font = "bold 12px system-ui, -apple-system, sans-serif";
                        const shortName = bestItem.originalName.replace(/Prime/gi, "").trim();
                        dCtx.fillText(shortName, relX + 6, relY + cellH - 8);

                        // Draw a premium, beautiful pill badge at the TOP-LEFT exactly over the physical badge
                        const shiftLeft = (cell.c === 0) ? 14 : 2;
                        dCtx.fillStyle = "rgba(0, 0, 0, 0.85)";
                        dCtx.fillRect(relX - shiftLeft, relY + 4, 44 + (shiftLeft - 2), 18);
                        dCtx.fillStyle = "#ffc107"; // elegant amber/gold
                        dCtx.font = "bold 11px monospace";
                        dCtx.fillText(`x${qtyResult.qty}`, relX - shiftLeft + 8, relY + 17);

                        // Highlight the exact auto-calibrated cropping region of the badge in golden outline
                        if (badgeCanvas) {
                            const bX = (badgeCanvas.cropX !== undefined ? badgeCanvas.cropX : cell.sx) - gridZone.x;
                            const bY = badgeCanvas.bestY - gridZone.y;
                            const bW = badgeCanvas.cropW !== undefined ? badgeCanvas.cropW : Math.round(cellW * 0.28);
                            const bH = badgeCanvas.cropH !== undefined ? badgeCanvas.cropH : Math.round(cellH * 0.12);
                            dCtx.strokeStyle = "rgba(255, 193, 7, 0.85)";
                            dCtx.lineWidth = 1.5;
                            dCtx.strokeRect(bX, bY, bW, bH);
                        }
                    } else {
                        this.lastRawOcrLog.push(logStr);
                        // Clean, premium thin red border for unmatched cells instead of heavy solid blocks
                        const relX = cell.sx - gridZone.x;
                        const relY = cell.sy - gridZone.y;
                        dCtx.strokeStyle = "rgba(255, 30, 80, 0.6)";
                        dCtx.lineWidth = 2;
                        dCtx.strokeRect(relX + 2, relY + 2, cellW - 4, cellH - 4);

                        // Draw a single elegant red-tinted opaque label block at the bottom
                        dCtx.fillStyle = "rgba(25, 10, 15, 0.98)";
                        dCtx.fillRect(relX, relY + cellH - 50, cellW, 50);
                        
                        // Thin red line top separator
                        dCtx.fillStyle = "rgba(255, 30, 80, 0.7)";
                        dCtx.fillRect(relX, relY + cellH - 50, cellW, 1.5);

                        // 1. Raw Tesseract OCR Text (Red-orange, italic, 9px)
                        dCtx.fillStyle = "#ff5252";
                        dCtx.font = "italic 9px system-ui, -apple-system, sans-serif";
                        const rawText = combinedText ? combinedText.join(" ") : "EMPTY";
                        const maxCharsItem = Math.floor(cellW / 5.5);
                        const truncatedItem = rawText.length > maxCharsItem ? rawText.slice(0, maxCharsItem - 3) + "..." : rawText;
                        dCtx.fillText(truncatedItem, relX + 6, relY + cellH - 37);

                        // Line 2: Raw Badge Text
                        dCtx.fillText(`BDG: "Ø"`, relX + 6, relY + cellH - 25);

                        // 2. Unmatched Status Label (Gray, bold, 12px)
                        dCtx.fillStyle = "#8c9eff";
                        dCtx.font = "bold 12px system-ui, -apple-system, sans-serif";
                        dCtx.fillText("UNMATCHED CELL", relX + 6, relY + cellH - 8);
                    }
                }
            };

            try {
                // Dynamically load-balance Tesseract workers to maximize parallel scan throughput
                const workerPromises = [];
                const activeWorkerCount = Math.min(workers.length, activeCells.length);
                for (let w = 0; w < activeWorkerCount; w++) {
                    workerPromises.push(runWorker(workers[w], bWorkers[w]));
                }
                await Promise.all(workerPromises);

                // Console logs disabled for production performance boost (reduces console render lag)
                /*
                console.log(`%c[INV] Scan complete. ${this.sessionInventory.size} unique items.`, "color: #00ff78; font-weight: bold; font-size: 13px;");
                console.log("%c=== RAW OCR LOG SUMMARY ===", "color: #ffc107; font-weight: bold;");
                this.lastRawOcrLog.forEach(log => console.log(`%c${log}`, "color: #e0e0e0; font-family: monospace;"));
                console.log("%c===========================", "color: #ffc107; font-weight: bold;");
                */
                ScannerHUD.updateScrollStatus("done", this.sessionInventory.size);
                ScannerHUD.updateDetectedItems(this.sessionInventory);

                if (ScannerHUD.updateDebugSnapshot) {
                    ScannerHUD.updateDebugSnapshot(debugCanvas.toDataURL("image/jpeg", 0.7));
                    this.lastDebugUpdate = Date.now() + 5000;
                }
            } catch (e) {
                console.error("[INV] Grid processing failed:", e);
            } finally {
                this.detectionLocked = false;
            }

        } finally {
            this.detectionLocked = false;
        }
    },

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