import { VisionService } from "./vision.service.js";
import { freezeFrame, releaseFrame } from "../../utils/vision/frame_freeze.js";
import { nextLatchedContext, INITIAL_LATCH, enrutaGraciaRiven, toleranciaCabecera, intervaloCabecera } from "../../utils/vision/context_latch.js";
import { isImplausibleFallbackGrid } from "../../utils/vision/plausibility.js";
import { localizaBandaRecompensas, candidatosDeRecorte, recorteDelRotulo } from "../../utils/vision/reward_band.js";
import { leeRecompensas, leeRotulosMissionComplete } from "./reward_read.service.js";
import { leeCantidadBadge, relojBadges } from "./badge_read.service.js";
import { motorActivo, MOTOR_PRECISO } from "./ocr_engine.service.js";
import { OCRService } from "./ocr.service.js?v=264";
import { SquadService } from "./squad.service.js";
import { RelicScreenService } from "./relic_screen.service.js";
import { OCRRepository } from "../../repositories/ocr.repository.js";
import { PaddleRepository } from "../../repositories/paddle.repository.js";
import { OpenCVRepository } from "../../repositories/opencv.repository.js";
import { ScannerHUD } from "../../ui.components/ui_scanner_hud.js";
import { ScannerModal } from "../../ui.components/ui_scanner_modal.js";
import { initializeOCRDatabase } from "../../repositories/api.repository.js";
import { escapeHTML } from "../../utils/escape_html.js";
import { electPageNameColor, cellNameMask, hasInk, readCellWithOwnColor } from "./name_color.service.js";
import { createCellOverlay } from "../../utils/vision/scan_overlay.js";
import { revisaRejillaCacheada } from "../../utils/vision/grid_cache.js";
import { detectRewardCells } from "../../utils/vision/mission_complete_grid.js";
import { nextLedger, INITIAL_LEDGER } from "../../utils/inventory/reward_ledger.js";
import { createFrameQueue } from "../../utils/vision/frame_queue.js";
import { videoRegionHash, smallCanvasHash, compareHashes } from "../../utils/vision/frame_hash.js";
import { ESTADO_INICIAL as ESTADO_SIN_RESULTADO, saltaPorSinResultado, siguienteEstadoSinResultado } from "../../utils/vision/no_result_skip.js";
import { cronometro } from "../../utils/perf.js";

import { rivenFingerprint } from "../../utils/rivens/riven_naming.js";
import { labelFullyRead } from "../../utils/vision/name_lines.js";
import { collectWords } from "../../utils/vision/ocr_words.js";
import { hasComponentSiblings } from "../../utils/inventory/component_siblings.js";
import { olvidaColorTexto } from "../../utils/vision/reward_preprocess.js";

export const ScannerService = {
    isScanning: false,
    scanInterval: null,
    currentRate: 1200,
    RIVEN_RATE_ACTIVE: 400, // no result shown yet, or the hash changed
    RIVEN_RATE_IDLE: 1000, // result shown and the screen is still
    sessionInventory: new Map(),
    sessionRelics: new Map(), // relicName -> consensus qty (relic fallback on the inventory grid)
    _autoCalibCache: null, // { key: "WxH", calib }: detecting costs a full frame
    _temaCache: null,      // { key: "WxH", theme }
    _nameColorCache: null, // { key: "WxH", color }
    _frameZoneCache: null, // { key: "WxH", zone } in frame coordinates, to crop on enqueue
    _invQueue: null,       // pages waiting for OCR (utils/frame_queue.js)
    detectionLocked: false,
    scanCounter: 0,
    inventoryHasScanned: false,
    qtyVotes: new Map(), // itemName -> Map<qty, count> (qty consensus across frames)
    relicQtyVotes: new Map(), // relicName -> Map<qty, count>
    lastStableHash: null,
    virtualCanvas: null,
    lastHashL: null,
    lastHashR: null,
    lastNoResult: ESTADO_SIN_RESULTADO, // last riven card hash with no valid parse (utils/vision/no_result_skip.js)
    lastRewardNoResult: ESTADO_SIN_RESULTADO, // same for the reward band
    lastHeaderHash: null,
    lastHeaderText: null,
    lastHeaderOcrTime: 0, // the skip expires after 2.5 s, bounding blindness from hash collisions
    lastRivenContextType: null, // "INVENTORY_MODS" | "ITEM_DETAILS" of the last riven hit: the grace period reroutes to the same one
    lastTwoCardHash: null, // card hash when 2 rivens were last confirmed (2->1 hysteresis)
    oneCardStreak: 0, // reads with fewer than 2 cards after a real hash change (2->1 hysteresis)
    newCardStreak: 0,
    weaponSwitchCandidate: null, // weapon set pending confirmation as a riven switch
    weaponSwitchStreak: 0, // reads with that same new set (matcher anti-flip)
    rivenConsensusBuffer: [],

    async start() {
        if (this.isScanning) return;
        this.isScanning = true;
        this.latchedContext = "UNKNOWN";
        this.ctxLatch = INITIAL_LATCH;
        this.detectionLocked = false;
        this.lastHashL = null;
        this.lastHashR = null;
        this.lastNoResult = ESTADO_SIN_RESULTADO;
        this.lastRewardNoResult = ESTADO_SIN_RESULTADO;
        this.lastHeaderHash = null;
        this.lastHeaderText = null;
        this.lastHeaderOcrTime = 0;
        this.lastRivenContextType = null;
        this.lastTwoCardHash = null;
        this.oneCardStreak = 0;
        this.newCardStreak = 0;
        this.weaponSwitchCandidate = null;
        this.weaponSwitchStreak = 0;
        this.rivenConsensusBuffer = [];
        this.qtyVotes = new Map();
        this.sessionRelics = new Map();
        this.relicQtyVotes = new Map();
        globalThis.ScannerService = this;
        if (!this.virtualCanvas) {
            this.virtualCanvas = document.createElement("canvas");
            this.virtualCanvas.id = "scanner-virtual-canvas";
        }
        initializeOCRDatabase().catch(err => console.warn("Error fetching OCR reference database from backend:", err));
        import("../rivens/rivens.service.js").then(m => m.fetchRivenWeapons()).catch(err => console.warn("Error fetching Riven weapons:", err));

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
    // hysteresis state, made and consumed by context_latch.js
    ctxLatch: INITIAL_LATCH,
    lastRivenContextTime: 0,

    async processFrame(video, virtualCanvas) {
        if (this.detectionLocked) return;
        if (!this.isScanning) return;
        this.scanCounter++;
        const reloj = cronometro("frame", 120);

        const dims = VisionService.prepareVirtualCanvas(video, virtualCanvas);

        const worker1 = OCRRepository.workers[0];
        if (!worker1) return;

        const headerHash = smallCanvasHash(virtualCanvas);
        const headerCacheFresh = this.lastHeaderOcrTime && (Date.now() - this.lastHeaderOcrTime < 2500);
        const tolHeader = toleranciaCabecera(this._headerEstable);
        const enPausa = Date.now() - (this.lastHeaderOcrTime || 0) < intervaloCabecera(this._headerEstable);
        let headerText;
        if (this.lastHeaderText !== null && headerCacheFresh
            && (enPausa || compareHashes(headerHash, this.lastHeaderHash, tolHeader))) {
            headerText = this.lastHeaderText;
        } else {
            const headerTheme = VisionService.finalizeVirtualCanvas(virtualCanvas);
            const { data: headerData } = await OCRRepository.recognize(worker1, virtualCanvas, {}, { text: true });
            headerText = headerData.text || "";

            if (headerTheme && VisionService.determineContext(headerText) === "UNKNOWN") {
                if (!this._altHeaderCvs) this._altHeaderCvs = document.createElement("canvas");
                VisionService.prepareVirtualCanvas(video, this._altHeaderCvs);
                const altCtx = this._altHeaderCvs.getContext("2d", { willReadFrequently: true });
                VisionService.applyThemeDistanceThreshold(altCtx, this._altHeaderCvs.width, this._altHeaderCvs.height, headerTheme);
                const { data: altData } = await OCRRepository.recognize(worker1, this._altHeaderCvs, {}, { text: true });
                const altText = altData.text || "";
                if (VisionService.determineContext(altText) !== "UNKNOWN") {
                    console.log(`[SCAN] Header rescatado por binarización de tema: "${altText.trim().slice(0, 60)}"`);
                    headerText = altText;
                }
            }

            if (VisionService.determineContext(headerText) === "UNKNOWN") {
                if (!this._centerHeaderCvs) this._centerHeaderCvs = document.createElement("canvas");
                VisionService.prepareCenterHeaderCanvas(video, this._centerHeaderCvs);
                const cCtx = this._centerHeaderCvs.getContext("2d", { willReadFrequently: true });
                const cTheme = VisionService.detectThemeFromSnapshot(this._centerHeaderCvs, 0, 0, this._centerHeaderCvs.width, this._centerHeaderCvs.height);
                VisionService.applyThemeDistanceThreshold(cCtx, this._centerHeaderCvs.width, this._centerHeaderCvs.height, cTheme);
                const { data: cData } = await OCRRepository.recognize(worker1, this._centerHeaderCvs, {}, { text: true });
                const cText = cData.text || "";
                if (VisionService.determineContext(cText) !== "UNKNOWN") {
                    console.log(`[SCAN] Contexto por título centrado: "${cText.trim().slice(0, 60)}"`);
                    headerText = cText;
                }
            }
            this.lastHeaderText = headerText;
            this.lastHeaderHash = headerHash;
            this.lastHeaderOcrTime = Date.now();
        }

        reloj.fase("cabecera");
        const rawContext = VisionService.determineContext(headerText);
        // the streak counts the context, not the text: the header returns slightly different garbage each time
        this._headerEstable = rawContext === this._headerCtxPrevio ? (this._headerEstable || 0) + 1 : 0;
        this._headerCtxPrevio = rawContext;
        const now = Date.now();

        const textUpper = headerText.toUpperCase();
        const containsAnchor = textUpper.includes("MODS") || textUpper.includes("MODIFICADORES") ||
                               textUpper.includes("CYCLE") || textUpper.includes("CICLO") || textUpper.includes("CICLAR") ||
                               textUpper.includes("KUVA") || textUpper.includes("KUYVA") ||
                               textUpper.includes("ATRIBUTOS") || textUpper.includes("ELEGIR") || textUpper.includes("CONFIRMAR") ||
                               textUpper.includes("AGRIETADO");
        
        if (rawContext === "INVENTORY_MODS" || rawContext === "ITEM_DETAILS" || containsAnchor) {
            this.lastRivenContextTime = now;
            this.lastRivenContextType = rawContext === "ITEM_DETAILS" ? "ITEM_DETAILS" : "INVENTORY_MODS";
        }

        // 8 s grace for rivens/mods, rerouted to the type of the last hit: Item Details uses another crop
        // than the reroll
        const gracia = this.lastRivenContextTime && (now - this.lastRivenContextTime < 8000);
        const { contexto: routedContext, cancelar } = enrutaGraciaRiven(
            rawContext, gracia, this.lastRivenContextType);
        if (cancelar) this.lastRivenContextTime = 0;

        this.ctxLatch = nextLatchedContext(this.ctxLatch, routedContext);
        // the text color only changes with the screen: recomputed on context change
        if (this.ctxLatch.latched !== this.latchedContext) olvidaColorTexto();
        this.latchedContext = this.ctxLatch.latched;
        // the frozen frame (~15 MB at 1440p) is released outside rewards
        if (this.latchedContext !== "REWARD") {
            this._rewardFrameCvs = releaseFrame(this._rewardFrameCvs);
            this._rewardDetectCvs = releaseFrame(this._rewardDetectCvs);
            VisionService.releaseRewardCanvases?.();
        }
        console.log(`[SCAN] Context Raw: ${rawContext} | Latched: ${this.latchedContext} | Header: "${headerText.trim().slice(0, 60)}"`);
        await this.routeFrameAction(this.latchedContext, video, dims);
        reloj.fin(this.latchedContext);

        ScannerHUD.updateFrameCounter(this.scanCounter);
    },

    get _canCapturePage() { return this._invQueue ? !this._invQueue.isFull : !this.detectionLocked; },

    /**
     * Crops the grid zone and queues it for OCR (~6 MB instead of a ~15 MB frame at 1440p). The
     * detector finds the grid again inside the crop, so the consumer is still processInventoryGrid.
     * False when the queue is full.
     */
    enqueueInventoryPage(snapshot, dims) {
        const key = `${dims.width}x${dims.height}`;
        if (this._frameZoneCache?.key !== key) {
            const calib = VisionService.detectGridAutoCalib(snapshot, dims.width, dims.height);
            let zone = calib?.gridZone || null;
            if (zone) {
                const m = Math.round((calib.cellH || 0) * 0.25);
                const y = Math.max(0, zone.y - m);
                zone = { ...zone, y, h: Math.min(dims.height - y, zone.h + m + (zone.y - y)) };
            }
            this._frameZoneCache = { key, zone };
        }
        // without a zone there is nothing to crop: processed live, which also opens manual calibration
        const zone = this._frameZoneCache.zone;
        if (!zone) {
            if (this.detectionLocked) return false;
            this.processInventoryGrid(snapshot, dims.width, dims.height, dims.scale)
                .catch(e => console.error("[INV] fallo procesando la página en directo:", e));
            return true;
        }
        if (!this._invQueue) {
            this._invQueue = createFrameQueue({
                max: 3,
                process: (job) => this.processInventoryGrid(job.cvs, job.cvs.width, job.cvs.height, job.meta),
            });
        }
        return this._invQueue.enqueue(snapshot, zone.x, zone.y, zone.w, zone.h, dims.scale);
    },

    recordQtyVote(itemName, qtyResult, votesMap = this.qtyVotes, targetMap = this.sessionInventory) {
        let votes = votesMap.get(itemName);
        if (!votes) { votes = new Map(); votesMap.set(itemName, votes); }

        const readOk = /\d/.test(qtyResult.raw || "");
        if (readOk) {
            votes.set(qtyResult.qty, (votes.get(qtyResult.qty) || 0) + 1);
        }

        const consensus = this.modeQty(votes);
        targetMap.set(itemName, consensus !== null ? consensus : qtyResult.qty);
    },

    // Most voted qty (ties: the larger). null without votes.
    modeQty(votes) {
        let bestQty = null, bestCount = -1;
        for (const [qty, count] of votes) {
            if (count > bestCount || (count === bestCount && qty > bestQty)) {
                bestCount = count; bestQty = qty;
            }
        }
        return bestQty;
    },

    autoScrollHash: null,
    autoScrollStableTimer: null,
    lastFrameHash: null,
    scrollDirectionAccumulator: 0,
    lastRowLums: null,
    // movement seen since the last scan: forces a rescan once still, since the page hash collides
    // between similar pages
    sawScrollSinceScan: false,
    // debug panel history: [{ time, img, log, summary, warning }], newest first, cap 10
    debugHistory: [],

    async routeFrameAction(rawContextType, video, dims) {
        // the PRIME/RIVENS switch reroutes the context before announcing it, so the HUD shows what is read
        const contextType = (globalThis.state.scannerModsMode && rawContextType === "INVENTORY")
            ? "INVENTORY_MODS"
            : rawContextType;
        ScannerHUD.updateContext(contextType);

        if ((contextType === "UNKNOWN" || contextType === "RELICS") && await SquadService.probe(video)) return;

        if (contextType === "INVENTORY") {
            if (!globalThis.state.autoScanEnabled) {
                this.currentRate = 3000;
                this.autoScrollHash = null;
                this.lastFrameHash = null;
                this.sawScrollSinceScan = false;
                if (this.autoScrollStableTimer) {
                    clearTimeout(this.autoScrollStableTimer);
                    this.autoScrollStableTimer = null;
                }
                return;
            }

            this.currentRate = 300;

            const sampleCvs = document.createElement("canvas");
            sampleCvs.width = 48; sampleCvs.height = 27;
            const sCtx = sampleCvs.getContext("2d", { willReadFrequently: true });
            sCtx.drawImage(video, 0, Math.floor(video.videoHeight * 0.25), video.videoWidth, Math.floor(video.videoHeight * 0.5), 0, 0, 48, 27);
            const currentHash = VisionService.getFrameHash(sCtx, 48, 27);

            if (this.lastFrameHash === null || this.lastFrameHash === undefined) {
                this.lastFrameHash = currentHash;
                return;
            }

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
            let minError = Infinity;
            if (this.lastRowLums) {
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

            const isScrolling = (bestDy !== 0 && minError < mseZero - 5) || mseZero > 80;

            if (isScrolling) {
                this.scrollDirectionAccumulator += bestDy;
                this.sawScrollSinceScan = true;
                if (this.autoScrollStableTimer) {
                    clearTimeout(this.autoScrollStableTimer);
                    this.autoScrollStableTimer = null;
                }
                ScannerHUD.updateScrollStatus("detected");
                return;
            }

            // still: rescan after a scroll or a page hash change
            const hasPageChanged = !this.autoScrollHash || this.sawScrollSinceScan || Math.abs(currentHash - this.autoScrollHash) >= 120;
            const isFirstScan = !this.autoScrollHash;

            if (hasPageChanged && !this.autoScrollStableTimer && this._canCapturePage) {
                if (!isFirstScan && this.scrollDirectionAccumulator <= -3) {
                    this.scrollDirectionAccumulator = 0;
                    this.sawScrollSinceScan = false;
                    this.autoScrollHash = currentHash;
                    ScannerHUD.updateScrollStatus("done", this.sessionInventory.size + this.sessionRelics.size);
                    return;
                }

                ScannerHUD.updateScrollStatus("detected");

                this.autoScrollStableTimer = setTimeout(async () => {
                    this.scrollDirectionAccumulator = 0;
                    // cleared here, not after the OCR: scrolling during the scan sets it again
                    this.sawScrollSinceScan = false;
                    if (!globalThis.state.autoScanEnabled || !this._canCapturePage) {
                        this.autoScrollStableTimer = null;
                        return;
                    }

                    const v = document.getElementById("live-video");
                    if (!v?.videoWidth || !v.videoHeight) return;
                    if (!this._invSnapshot) this._invSnapshot = document.createElement("canvas");
                    const snapshot = this._invSnapshot;
                    if (snapshot.width !== v.videoWidth || snapshot.height !== v.videoHeight) {
                        snapshot.width = v.videoWidth; snapshot.height = v.videoHeight;
                    }
                    snapshot.getContext("2d", { willReadFrequently: true }).drawImage(v, 0, 0);

                    // queue full: the hash is not marked, so the page is retried instead of lost
                    if (this.enqueueInventoryPage(snapshot, dims)) this.autoScrollHash = currentHash;
                    this.autoScrollStableTimer = null;

                }, 800);
            } else if (!this.autoScrollStableTimer) {
                this.scrollDirectionAccumulator = 0;
                ScannerHUD.updateScrollStatus("done", this.sessionInventory.size + this.sessionRelics.size);
            }

        } else if (contextType === "INVENTORY_MODS" || contextType === "ITEM_DETAILS") {
            // fast poll by default; processRivenCard relaxes it (RIVEN_RATE_IDLE) on a still parsed screen
            this.currentRate = this.RIVEN_RATE_ACTIVE;
            if (this.detectionLocked) return;
            await this.processRivenCard(video, dims, contextType);
        } else if (contextType === "RELICS") {
            if (globalThis.RivenScannerHUD) globalThis.RivenScannerHUD.dismiss();
            this.currentRate = 600;
            await RelicScreenService.process(video, dims);
        } else if (contextType === "MISSION_COMPLETE") {
            if (globalThis.RivenScannerHUD) globalThis.RivenScannerHUD.dismiss();
            // the run is over
            if (globalThis.state?.squadRun) SquadService.clear();
            this.currentRate = 800;
            await this.processMissionComplete(video, dims);
        } else if (contextType === "REWARD") {
            if (globalThis.RivenScannerHUD) globalThis.RivenScannerHUD.dismiss();
            if (this.detectionLocked) return;
            // same as the active riven rate: detectionLocked stops the loop on a match, so faster costs nothing
            this.currentRate = this.RIVEN_RATE_ACTIVE;
            await this.processRewards(video, dims);
        } else {
            if (contextType === "UNKNOWN" && VisionService.hasRivenTextHint(video)) {
                this.currentRate = this.RIVEN_RATE_ACTIVE;
                if (this.detectionLocked) return;
                await this.processRivenCard(video, dims, "ITEM_DETAILS");
                return;
            }
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

    // loose riven identity: same weapon and rolls without the exact stat set, so a read that lost or
    // got back the faint curse merges into the shown card
    _isSameRivenIdentity(a, b) {
        if (!a && !b) return true;
        if (!a || !b) return false;
        if (a.weaponName !== b.weaponName) return false;
        // rolls only count when both reads have them: the MR line is often lost
        if (a.rolls !== null && b.rolls !== null && a.rolls !== b.rolls) return false;
        const namesA = new Set(a.stats.map(s => s.name));
        const namesB = new Set(b.stats.map(s => s.name));
        let overlap = 0;
        for (const n of namesA) if (namesB.has(n)) overlap++;
        const minLen = Math.min(namesA.size, namesB.size);
        return overlap >= Math.max(1, minLen - 1);
    },

    /**
     * Whether the new read is at least as good as the old one, so a worse frame does not replace it.
     */
    _isBetterOrEqualRead(newRiven, oldRiven) {
        if (!oldRiven) return true;
        if (!newRiven) return false;

        if (oldRiven.weaponName && !newRiven.weaponName) return false;

        if (oldRiven.rolls !== null && newRiven.rolls === null) return false;

        if (newRiven.weaponName !== oldRiven.weaponName || newRiven.rolls !== oldRiven.rolls) {
            return true;
        }

        const newMatchedCount = newRiven.stats.filter(s => s.matched).length;
        const oldMatchedCount = oldRiven.stats.filter(s => s.matched).length;

        if (newMatchedCount > oldMatchedCount) return true;
        if (newMatchedCount < oldMatchedCount) return false;

        const newConf = newRiven.validation?.confidence ?? 0;
        const oldConf = oldRiven.validation?.confidence ?? 0;
        if (newConf > oldConf) return true;

        return false;
    },

    // splits the OCR words into cards by X (a big gap is a card boundary), drops low confidence background art
    // garbage and rebuilds each card's text by lines (Y) sorted by X. Returns null with a single card
    _wordsToCards(data, canvasWidth) {
        let words = [];
        const pushAll = (arr) => { if (Array.isArray(arr)) for (const w of arr) words.push(w); };
        if (Array.isArray(data?.words)) pushAll(data.words);
        if (!words.length && Array.isArray(data?.lines)) data.lines.forEach(l => pushAll(l.words));
        if (!words.length && Array.isArray(data?.paragraphs)) data.paragraphs.forEach(p => (p.lines || []).forEach(l => pushAll(l.words)));
        if (!words.length && Array.isArray(data?.blocks)) data.blocks.forEach(b => (b.paragraphs || []).forEach(p => (p.lines || []).forEach(l => pushAll(l.words))));

        // word dump to debug live inclusion/grouping: globalThis._rivenWordDump = true
        if (globalThis._rivenWordDump) {
            const dump = words.filter(w => w && w.text && w.bbox)
                .map(w => `${w.text.trim()}@${Math.round(w.confidence ?? 0)}(${Math.round((w.bbox.x0 + w.bbox.x1) / 2)},${Math.round((w.bbox.y0 + w.bbox.y1) / 2)})`)
                .join("  ");
            console.log(`[RIVEN WORDS] ${dump}`);
        }

        // "content" word (>=3 alphanumerics or a digit): drops loose art noise
        const isContent = (t) => (t || "").replace(/[^a-z0-9]/gi, "").length >= 3 || /\d/.test(t || "");

        // rebuilds a card's text: groups by line (Y center, tolerance = median height) so the value ("+92.4%") and
        // its name ("Status Chance") share a line, and sorts each line by X
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

        const gapThresh = Math.max(canvasWidth * 0.03, 40);
        const clusterByX = (ws) => {
            const items = ws.slice().sort((a, b) => a.bbox.x0 - b.bbox.x0);
            const groups = [[]];
            let maxX1 = null;
            for (const w of items) {
                if (maxX1 !== null && w.bbox.x0 - maxX1 > gapThresh) groups.push([]);
                groups[groups.length - 1].push(w);
                maxX1 = maxX1 === null ? w.bbox.x1 : Math.max(maxX1, w.bbox.x1);
            }
            return groups;
        };

        const ANCHOR_CONF = 70; // between garbage (≤~67) and real text (≳84)
        const INSIDE_CONF = 28; // faint but real tokens inside the box (e.g. the curse line)
        const anchors = words.filter(w => w && w.text && w.bbox && isContent(w.text) && (w.confidence ?? 0) >= ANCHOR_CONF);
        console.log(`[OCR DIAG] dataKeys=[${Object.keys(data || {}).join(",")}] rawWords=${words.length} anchors=${anchors.length}`, words[0]);
        if (anchors.length >= 3) {
            const anchorGroups = clusterByX(anchors).filter(g => g.length >= 3);
            if (anchorGroups.length >= 2) {
                const inside = words.filter(w => w && w.text && w.bbox && isContent(w.text) && (w.confidence ?? 0) >= INSIDE_CONF);
                const cards = anchorGroups.map(g => {
                    // cards are side by side, so tokens whose X CENTER falls in the card column get in with no Y filter, to
                    // catch the weapon name (top) and the curse line (bottom). The parser ignores non stat noise
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

        // fallback: flat confidence cut (>=50) + X gap
        const usable = words.filter(w => w && w.text && isContent(w.text) && (w.confidence ?? 0) >= 50 && w.bbox);
        console.log(`[OCR DIAG] usable=${usable.length} (fallback)`);
        if (usable.length < 3) return null;
        const realGroups = clusterByX(usable).filter(g => g.length >= 3);
        console.log(`[OCR DIAG] gapThresh=${Math.round(gapThresh)} realGroups=${realGroups.length}`);
        if (realGroups.length < 2) return null; // single card: back to the normal flow
        return realGroups.map(toText);
    },

    async processRivenCard(video, dims, contextType = null) {
        const { scale } = dims;

        // the "Item Details" popup has the card centered and higher, so it has its own crop
        const cardCrop = contextType === "ITEM_DETAILS" ? VisionService.RIVEN_ITEM_DETAILS_CROP : VisionService.RIVEN_CARD_CROP;

        // hash over the fixed video region, before preparing the canvases: tight crops jitter on a still
        // screen
        const hash = videoRegionHash(video, cardCrop);

        // already parsed and unchanged: skip OCR and relax the poll
        if ((this.lastParsedL || this.lastParsedR) && compareHashes(hash, this.lastHashL)) {
            this.lastRivenContextTime = Date.now();
            this.lastRivenContextType = contextType === "ITEM_DETAILS" ? "ITEM_DETAILS" : "INVENTORY_MODS";
            this.currentRate = this.RIVEN_RATE_IDLE;
            return;
        }

        // skip a region that recently OCR'd to no valid parse (no_result_skip.js)
        if (saltaPorSinResultado(hash, this.lastNoResult, Date.now(), 3000)) return;

        // the reroll screen shows one centered card or two side by side; one canvas per card
        const canvases = VisionService.prepareRivenCardCanvases(video, scale, cardCrop);

        // debug: `globalThis.dumpRivenCrops = true` prints each binarized crop as a data URL
        if (globalThis.dumpRivenCrops) {
            canvases.forEach((c, i) => console.log(`[RIVEN CROP ${canvases.length > 1 ? `C${i + 1}` : "C"}] ${c.toDataURL("image/png")}`));
            globalThis.dumpRivenCrops = false;
        }

        const { RivenOCRService } = await import("../rivens/riven_ocr.service.js?v=3");

        // two cards: two workers in parallel. The 2nd is created lazily, so only the reroll pays its RAM.
        if (canvases.length > 1) await OCRRepository.ensureSecondWorker().catch(() => {});
        const pool = OCRRepository.workers.filter(Boolean);
        const reads = await Promise.all(canvases.map((c, i) =>
            OCRRepository.recognize(pool[i % pool.length] || pool[0], c, {}, { blocks: true })));
        // side by side, the OCR reads both cards in one pass: words are split by X, dropping art garbage
        // by confidence
        const entries = [];
        reads.forEach((res, ci) => {
            const cardTexts = this._wordsToCards(res.data, canvases[ci].width) || [res.data.text || ""];
            let cardEntries = cardTexts.map(text => ({
                res, text, parsed: RivenOCRService.parseRivenCard(text), canvas: canvases[ci],
            }));

            if (cardEntries.length >= 2) {
                const validCount = cardEntries.filter(e => e.parsed && e.parsed.weaponName).length;
                if (validCount < 2) {
                    const fullText = res.data.text || "";
                    const fullParsed = RivenOCRService.parseRivenCard(fullText);
                    const wName = cardEntries.find(e => e.parsed?.weaponName)?.parsed.weaponName || fullParsed?.weaponName || "";
                    const wKey = (wName.split(" ")[0] || "").toUpperCase();
                    const colsWithWeapon = wKey.length >= 4
                        ? cardEntries.filter(e => e.text.toUpperCase().includes(wKey)).length
                        : cardEntries.length; // without a reliable weapon, 2 cards cannot be dropped
                    if (fullParsed && fullParsed.weaponName && colsWithWeapon <= 1) {
                        console.log(`[OCR DIAG] split fantasma revertido: ${cardEntries.length} columnas -> 1 carta (texto completo)`);
                        cardEntries = [{ res, text: fullText, parsed: fullParsed, canvas: canvases[ci] }];
                    }
                }
            }

            cardEntries.forEach((e) => {
                this._logRivenRead(`C${entries.length + 1}`, e.text, e.parsed, e.canvas);
                entries.push(e);
            });
        });

        const anyText = entries.map(e => e.text.toUpperCase()).join(" ");
        const hasCardAnchor = /CYCLE|KUVA|KUYVA|CONFIRM|\bMR\s*\d/.test(anyText);

        const MIN_CONF = 0.5;
        const valids = entries.filter(e => e.parsed && (e.parsed.validation?.confidence ?? 0) >= MIN_CONF);

        if (valids.length || hasCardAnchor) {
            this.lastRivenContextTime = Date.now();
            // remembers which crop made the hit: the grace period reroutes to the same type
            this.lastRivenContextType = contextType === "ITEM_DETAILS" ? "ITEM_DETAILS" : "INVENTORY_MODS";
        }

        // logged: otherwise a bad crop fails once and the skip above silences every retry
        if (!valids.length) {
            console.log(`[RIVEN OCR] sin parse válido en este frame (${contextType || "reroll"}) — se cachea el hash y no se reintenta hasta que la pantalla cambie`);
        }
        this.lastNoResult = siguienteEstadoSinResultado(valids.length > 0, hash, Date.now());

        const currentFP = valids.map(e => rivenFingerprint(e.parsed)).join("||") || "none";
        this.rivenConsensusBuffer.push(currentFP);
        if (this.rivenConsensusBuffer.length > 3) this.rivenConsensusBuffer.shift();
        const matchCount = this.rivenConsensusBuffer.filter(fp => fp === currentFP).length;
        const hasConsensus = matchCount >= 2;

        let rawL = valids[0]?.parsed || null;
        let rawR = valids[1]?.parsed || null;
        const shownCards = [this.lastParsedL, this.lastParsedR].filter(Boolean);
        const shownCount = shownCards.length;

        // a single read realigns with its shown slot: with 2 cards shown and only the right one parsed,
        // valids[0] would overwrite the left slot
        if (shownCount === 2 && rawL && !rawR) {
            const matchesL = this._isSameRivenIdentity(rawL, this.lastParsedL);
            const matchesR = this._isSameRivenIdentity(rawL, this.lastParsedR);
            if (matchesR && !matchesL) { rawR = rawL; rawL = null; }
        }

        let revealsMore = valids.length > shownCount;

        if (revealsMore && shownCount >= 1) {
            const otherShown = shownCards[0];
            const newCard = [rawL, rawR].find(p => p && !shownCards.some(s => this._isSameRivenIdentity(p, s)));
            const sameWeaponAsShown = !newCard || newCard.weaponName === otherShown.weaponName;
            if (!sameWeaponAsShown) {
                this.newCardStreak = (this.newCardStreak || 0) + 1;
                if (this.newCardStreak < 2) revealsMore = false;
            } else {
                this.newCardStreak = 0;
            }
        } else {
            this.newCardStreak = 0;
        }

        const newWeapons = [...new Set(valids.map(e => e.parsed.weaponName).filter(Boolean))].sort().join("|");
        const shownWeapons = [...new Set(shownCards.map(p => p.weaponName).filter(Boolean))].sort().join("|");
        let weaponChanged = newWeapons !== "" && newWeapons !== shownWeapons;

        let weaponSwitchPending = false;
        if (weaponChanged && shownCards.length) {
            if (this.weaponSwitchCandidate === newWeapons) {
                this.weaponSwitchStreak++;
            } else {
                this.weaponSwitchCandidate = newWeapons;
                this.weaponSwitchStreak = 1;
            }
            if (this.weaponSwitchStreak < 2) {
                weaponChanged = false;
                weaponSwitchPending = true;
            }
        } else {
            this.weaponSwitchCandidate = null;
            this.weaponSwitchStreak = 0;
        }

        // 2->1 hysteresis: with 2 cards shown, fewer in one frame may be a partial read. Several reads in
        // a row (or a weapon change) before dropping the card that no longer arrives.
        let dropExtra = false;
        if (valids.length < shownCount) {
            this.oneCardStreak++;
            const DOWNGRADE_STREAK = 4;
            if (this.oneCardStreak >= DOWNGRADE_STREAK || weaponChanged) {
                dropExtra = true;
                this.oneCardStreak = 0;
            }
        } else {
            this.oneCardStreak = 0;
        }

        const mergeSlot = (raw, shown) => {
            if (!raw) return shown;
            if (shown && this._isSameRivenIdentity(raw, shown)) {
                return this._isBetterOrEqualRead(raw, shown) ? raw : shown;
            }
            // weapon change not confirmed yet: keep what is shown, or an A, B, A, B matcher forms a 2 of 3
            // consensus for both weapons
            if (shown && weaponSwitchPending && raw.weaponName !== shown.weaponName) return shown;
            return raw; // another riven, or nothing shown here yet
        };

        let finalL = mergeSlot(rawL, this.lastParsedL);
        let finalR = mergeSlot(rawR, this.lastParsedR);
        if (dropExtra) {
            // confirmed: the card whose slot got no new read is dropped
            if (!rawL) finalL = null;
            if (!rawR) finalR = null;
        }

        const anyUpgrade = (finalL && finalL !== this.lastParsedL && this._isSameRivenIdentity(finalL, this.lastParsedL)) ||
                            (finalR && finalR !== this.lastParsedR && this._isSameRivenIdentity(finalR, this.lastParsedR));

        if ((this.lastParsedL || this.lastParsedR) && !hasConsensus && !revealsMore && !weaponChanged && !anyUpgrade) {
            console.log(`[RIVEN OCR] Consensus: ${matchCount}/3 — waiting for confirmation`);
            if (globalThis._scannerDebug) this._renderRivenDebug(entries, false);
            return;
        }

        // no re-render when the result is the same as what is shown
        const changed = !this._isSameRiven(finalL, this.lastParsedL) || !this._isSameRiven(finalR, this.lastParsedR);

        if (globalThis._scannerDebug) this._renderRivenDebug(entries, changed);

        if (!weaponSwitchPending) {
            this.lastHashL = hash;
            this.lastHashR = null;
        }

        if (!changed) return;

        this.lastParsedL = finalL;
        this.lastParsedR = finalR;

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

        // only notifies the UI with something to show: (null, null) crashed _renderSingle
        if (globalThis.showRivenAppraisal && (this.lastParsedL || this.lastParsedR)) {
            globalThis.showRivenAppraisal(this.lastParsedL, this.lastParsedR, screenshotDataURL);
        }
    },

    _sameCombinedHash(a, b) {
        if (!a || !b) return false;
        const pa = a.split("|"), pb = b.split("|");
        if (pa.length !== pb.length) return false;
        return pa.every((h, i) => compareHashes(h, pb[i]));
    },

    /**
     * Per-card log: raw OCR, crop size, parsed result and validation, in a collapsed group.
     */
    _logRivenRead(side, rawText, parsed, canvas) {
        const raw = (rawText || "").trim().replace(/\n/g, " | ");
        const v = parsed?.validation;
        const tag = parsed
            ? `${parsed.weaponName || "?"} | ${parsed.stats.length} stats | conf ${v ? v.confidence : "?"}${v && !v.valid ? " ⚠" : " ✓"}`
            : "no parse";
        // raw OCR on the top-level line, visible without expanding the group
        console.log(`[RIVEN OCR ${side}] ${tag} | crop ${canvas?.width}x${canvas?.height} | raw: "${raw}"`);
        if (parsed) {
            const stats = parsed.stats.map(s => `${s.isPositive ? "+" : "-"}${s.value}% ${s.name}${s.suspicious ? "⚠" : ""}`).join("  ");
            console.log(`  → riven: ${parsed.rivenName || "—"} | rolls ${parsed.rolls ?? "—"} | mr ${parsed.mr ?? "—"} | ${stats}`);
            if (v?.issues?.length) console.log(`  → issues: ${v.issues.join("; ")}`);
        }
    },

    /**
     * Riven debug panel: each card's binarized OCR input with its line boxes and parsed weapon.
     * `entries` comes from processRivenCard ({ res, parsed, canvas } per card).
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

            // line boxes in this card's canvas space
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

    /** Consensus and dedup of MISSION COMPLETE additions (utils/inventory/reward_ledger.js). */
    mcLedger: INITIAL_LEDGER,
    _mcFrameCvs: null,
    _mcCellCvs: null,
    _mcStableHash: null,

    async processMissionComplete(video, dims) {
        const { width, height } = dims;
        const frame = this._mcFrameCvs = freezeFrame(video, width, height, this._mcFrameCvs);

        const hash = smallCanvasHash(frame);
        if (!compareHashes(hash, this._mcStableHash, 6)) {
            this._mcStableHash = hash;
            return;
        }

        const fCtx = frame.getContext("2d", { willReadFrequently: true });
        const trace = {};
        const grid = detectRewardCells(fCtx.getImageData(0, 0, width, height), { trace });
        if (!grid) {
            console.log(`[MC] Sin rejilla: ${trace.fail}`);
            return;
        }
        console.log(`[MC] ${trace.cells} casillas · ${trace.cols}×${trace.rows} · paso ${trace.pitch}${grid.occluded ? " · TAPADA" : ""}`);

        if (grid.occluded) return;

        const worker = OCRRepository.workers[0];
        if (!worker) return;

        if (!this._mcCellCvs) this._mcCellCvs = document.createElement("canvas");
        // with the precise engine every label comes from one pass: Tesseract loses the first line of a
        // label drawn over the art
        const rotulos = await leeRotulosMissionComplete(frame, grid.cells.filter((c) => c.named));

        const items = [];
        for (const cell of grid.cells) {
            if (!cell.named) continue;
            const preciso = rotulos?.get(`r${cell.row}c${cell.col}`);
            let data = null, raw = preciso || "";
            if (!preciso) {
                VisionService.prepareMissionCompleteCellCanvas(frame, cell, grid.accent, this._mcCellCvs);
                ({ data } = await OCRRepository.recognize(worker, this._mcCellCvs, {}, { text: true, blocks: true }));
                raw = (data.text || "").toUpperCase();
            }
            const relic = OCRService.getRelicMatch(raw);
            if (relic) { items.push({ name: relic, qty: cell.qty, cell, reliquia: true }); continue; }
            const match = OCRService.getValidItemMatch(raw);
            if (!match?.isPrime) continue;
            if (!preciso && hasComponentSiblings(OCRService.cachedDbItems, match.originalName)) {
                const { completo, cobertura } = labelFullyRead(this._mcCellCvs, collectWords(data));
                if (!completo) {
                    console.log(`[MC] r${cell.row}c${cell.col}: descarto "${match.originalName}" — lo leído explica el ${Math.round(cobertura * 100)}% de la tinta del rótulo`);
                    continue;
                }
            }
            items.push({ name: match.originalName, qty: cell.qty, cell });
            console.log(`[MC] r${cell.row}c${cell.col}: ${match.originalName} ×${cell.qty}`);
        }

        const { ledger, commit } = nextLedger(this.mcLedger, items);
        this.mcLedger = ledger;
        const gastada = RelicScreenService.tomaReliquiaElegida();
        if ((commit?.length || gastada) && typeof globalThis.commitMissionCompleteRewards === "function") {
            globalThis.commitMissionCompleteRewards(commit || [], gastada);
        }
    },

    async processRewards(video, dims) {
        const { width, height, scale } = dims;

        // hash over the fixed band before freezeFrame, so a still screen with no rewards pays neither
        const bandHash = videoRegionHash(video, { x: 0, y: 0.185, w: 1, h: 0.255 });
        if (saltaPorSinResultado(bandHash, this.lastRewardNoResult, Date.now(), 3000)) return;

        // one frame for the whole flow: band, OCR presets and modal photo (freezeFrame)
        const frame = this._rewardFrameCvs = freezeFrame(video, width, height, this._rewardFrameCvs);

        // where the cards are, instead of assuming 18.5-44 % of the frame: a webcam on an external monitor
        // breaks that (utils/vision/reward_band.js)
        const { cropRect, columnas, cardCount, bandSource, cvs } = localizaBandaRecompensas(frame, width, height, this._rewardDetectCvs);
        this._rewardDetectCvs = cvs;
        console.log(cropRect
            ? `[REWARD] Banda detectada (${bandSource}): ${cardCount} cards en x=${Math.round(cropRect.x)} y=${Math.round(cropRect.y)} ${Math.round(cropRect.w)}x${Math.round(cropRect.h)}`
            : "[REWARD] Banda no detectada, usando recorte fijo de respaldo");

        // crop ladder on the same frame (candidatosDeRecorte): the read with most rewards wins, stopping at
        // the first complete one
        const candidatos = candidatosDeRecorte({ cropRect, columnas, cardCount },
            recorteDelRotulo(frame, width, height, null));
        let result = null, usado = null;

        for (const cand of candidatos) {
            const r = await leeRecompensas(frame, width, height, scale, "STANDARD", cand.cropRect, cand.columnas, "preciso");
            if (!result || r.foundItems.length > result.foundItems.length) { result = r; usado = { ...cand, preset: "STANDARD" }; }
            if (result.foundItems.length >= cand.minimo) break;
        }

        if (!result?.foundItems.length) for (const cand of candidatos) {
            const r = await leeRecompensas(frame, width, height, scale, "STANDARD", cand.cropRect, cand.columnas, "clasico");
            if (!result || r.foundItems.length > result.foundItems.length) { result = r; usado = { ...cand, preset: "STANDARD" }; }
            if (result.foundItems.length >= cand.minimo) break;
        }
        if (usado && (usado.preset !== "STANDARD" || usado.nombre !== candidatos[0].nombre)) {
            console.log(`[REWARD] Leído con recorte "${usado.nombre}" y preset ${usado.preset}`);
        }
        const { rawOcr, namesRaw, foundItems, ocrCanvas, namesCanvas } = result;

        // caches the hash when this frame brought no reward, so the skip above works on a still screen
        this.lastRewardNoResult = siguienteEstadoSinResultado(foundItems.length > 0, bandHash, Date.now());

        // the debug snapshot is drawn here: services/ do not touch the DOM, and it shows the winning canvas
        const dbgPanel = document.getElementById("live-debug-snapshot");
        if (dbgPanel?.style.display === "block" && ocrCanvas) {
            const debugImg = document.getElementById("live-debug-snapshot-img");
            if (debugImg) debugImg.src = ocrCanvas.toDataURL("image/jpeg", 0.85);
        }
        const cropUsado = usado?.cropRect || null;

        // xPos is in crop coordinates and renderBadges reads frame ones: reprojected with the same origin
        // and margin as prepareRewardOCRCanvas
        const rMarginX = cropUsado ? Math.floor(cropUsado.w * 0.06) : Math.floor(width * 0.08);
        const rCropXBase = cropUsado ? Math.floor(cropUsado.x) : 0;
        const rCropW = (cropUsado ? cropUsado.w : width) - rMarginX * 2;
        const rOcrW = ocrCanvas?.width || 1;
        foundItems.forEach(item => {
            if (typeof item.xPos === "number") {
                item.xPos = (rCropXBase + rMarginX + (item.xPos / rOcrW) * rCropW) * scale;
            }
        });

        clearRewardDebugLogs();
        const cleanOcrText = rawOcr.replaceAll(/\n+/g, ' ').trim();
        addRewardDebugLog("OCR", `Read: ${cleanOcrText}`, "info");
        // the names pass rescues what grayscale garbles: shown to tell which pass failed
        addRewardDebugLog("OCR2", namesCanvas ? `Names: ${namesRaw.replaceAll(/\n+/g, " ").trim()}` : "Names: (skipped - noisy mask)", "info");
        addRewardDebugLog("SCAN", `Items found: ${foundItems.length}`, foundItems.length > 0 ? "match" : "warn");

        // context guard: other screens show prime parts shaped like a reward band. Checks the crop and the
        // header, since the centered title never falls inside the band.
        const contextText = `${rawOcr} ${namesRaw} ${this.lastHeaderText || ""}`.toUpperCase();
        const NON_REWARD_TOKENS = [
            "MISSION COMPLETE", "MISION COMPLETADA", "MISIÓN COMPLETADA",
            "IMPORTANCE", "IMPORTANCIA", "SEARCH", "BUSCAR",
        ];
        const ctxCabecera = VisionService.determineContext((this.lastHeaderText || "").toUpperCase());
        const badToken = NON_REWARD_TOKENS.find(t => contextText.includes(t))
            || (ctxCabecera === "RELICS" || ctxCabecera === "MISSION_COMPLETE" ? `cabecera ${ctxCabecera}` : null);
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
            // the same frame that was read, so photo and badges match
            ScannerModal.open(frame.toDataURL("image/jpeg", 0.85), foundItems, width, height, scale, rawOcr);
        }
    },

    async processInventoryGrid(snapshot, width, height, scale) {
        const reloj = cronometro("inventario");
        relojBadges.ms = 0; relojBadges.n = 0;
        if (this.detectionLocked) return;
        this.detectionLocked = true;

        try {
            const calibKey = `${width}x${height}`;
            let calibData = null;
            if (this._autoCalibCache?.key === calibKey) {
                calibData = this._autoCalibCache.calib;
            } else {
                calibData = VisionService.detectGridAutoCalib(snapshot, width, height);
                if (calibData) {
                    this._autoCalibCache = { key: calibKey, calib: calibData };
                }
            }

            if (!calibData) {
                const saved = globalThis.LiveCalibration?.getGrid() || null;
                // manual calibration guesses columns by aspect ratio; a bad box gives a garbage grid: better not to
                // scan than to crop wrong
                if (saved && isImplausibleFallbackGrid(saved, width, height)) {
                    console.warn(`[INV] Calibración manual guardada implausible (zona ${saved.gridZone?.w}x${saved.gridZone?.h}, celda ${saved.cellW}x${saved.cellH} sobre frame ${width}x${height}) — descartada; se reintentará auto-grid.`);
                } else if (saved) {
                    calibData = saved;
                    console.log("[INV] Auto-grid sin señal este frame — usando calibración manual guardada.");
                }
            }

            if (!calibData?.gridZone) {
                if (/KUBROW|KUBR|CHESA|HURAS|SAHASA|RAKSA|SUNIKA|HELMINTH|KAVAT/i.test(this.lastHeaderText || "")) {
                    console.log("[INV] Omitiendo modal de calibración porque la pantalla es de kubrow.");
                    this.detectionLocked = false;
                    return;
                }
                if (globalThis.LiveCalibration && !globalThis.LiveCalibration.hasCalibration()) {
                    console.log("[INV] Sin auto-grid ni calibración. Abriendo calibración manual...");
                    const calibCvs = document.createElement("canvas");
                    calibCvs.width = width;
                    calibCvs.height = height;
                    const calibCtx = calibCvs.getContext("2d", { willReadFrequently: true });
                    calibCtx.drawImage(snapshot, 0, 0);
                    await globalThis.LiveCalibration.runCalibrationFlow(
                        calibCtx.getImageData(0, 0, width, height)
                    );
                    this.detectionLocked = false;
                    return;
                }
                console.warn("[INV] No grid zone calibration available.");
                this.detectionLocked = false;
                return;
            }

            const { gridZone } = calibData;

            let theme = this._temaCache?.key === calibKey ? this._temaCache.theme : null;
            if (!theme) {
                theme = VisionService.detectThemeFromSnapshot(
                    snapshot,
                    gridZone.x, gridZone.y, gridZone.w, gridZone.h
                );
                // only a real detection: the neutral pseudo-theme below would leak into other pages
                if (theme) this._temaCache = { key: calibKey, theme };
            }
            if (!theme) {
                // relic tab (or strong mission tint): the grid zone has almost no theme accent. Names and counts do
                // not depend on the theme, so a bright neutral pseudo-theme only affects the color badge fallback.
                theme = { name: "Neutral", r: 240, g: 240, b: 240, actualR: 240, actualG: 240, actualB: 240 };
                console.warn("[INV] Theme inconclusive — using neutral pseudo-theme (relics tab / tinted UI).");
            }
            console.log(`[INV] Theme detected: ${theme.name} (r:${theme.r} g:${theme.g} b:${theme.b})`);

            reloj.fase("rejilla+tema");
            const autoGrid = VisionService.buildAutoGrid(snapshot, gridZone, theme, calibData);
            if (!autoGrid || autoGrid.cellRects.length === 0) {
                console.warn("[INV] Auto-grid detection failed — inventory may not be visible or zone needs recalibration.");
                ScannerHUD.updateScrollStatus("done", 0);
                this.detectionLocked = false;
                return;
            }

            const { cellRects, cellW, cellH } = autoGrid;
            console.log(`[INV] Auto-grid: ${autoGrid.rows}r × ${autoGrid.cols}c, ${cellRects.length} cells`);

            ScannerHUD.updateScrollStatus("scanning");

            const debugCanvas = this._debugCvs ||= document.createElement("canvas");
            if (debugCanvas.width !== gridZone.w) debugCanvas.width = gridZone.w;
            if (debugCanvas.height !== gridZone.h) debugCanvas.height = gridZone.h;
            const dCtx = debugCanvas.getContext("2d");
            dCtx.drawImage(snapshot, gridZone.x, gridZone.y, gridZone.w, gridZone.h, 0, 0, gridZone.w, gridZone.h);

            dCtx.strokeStyle = "rgba(0,229,255,0.4)";
            dCtx.lineWidth = 1;
            cellRects.forEach(cell => dCtx.strokeRect(cell.sx - gridZone.x, cell.sy - gridZone.y, cellW, cellH));

            const gridLeft = Math.min(...cellRects.map(c => c.sx)) - gridZone.x;
            const gridRight = Math.max(...cellRects.map(c => c.sx + cellW)) - gridZone.x;
            dCtx.strokeStyle = "rgba(255, 193, 7, 0.5)";
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
            dCtx.setLineDash([]);

            const agInfo = `AG ${calibData.auto ? "auto" : "manual"} ${autoGrid.rows}r×${autoGrid.cols}c cell ${cellW}×${cellH} zone ${gridZone.x},${gridZone.y} dy ${autoGrid.phaseShift || 0}${calibData.traceSummary?.halfPitchFixed ? " HPfix" : ""}`;

            this.lastRawOcrLog = [];
            this.lastRawOcrLog.push(`[AUTO-GRID] ${agInfo} · rowBands ${JSON.stringify(calibData.traceSummary?.rowBands || [])} · chain ${JSON.stringify(calibData.traceSummary?.chain || null)}`);
            const scanStats = { cells: cellRects.length, matched: 0, relics: 0, empty: 0, unmatched: 0, none: 0, ownColor: 0 };
            const textSrcY = Math.round(cellH * 0.50);
            const textSrcH = Math.round(cellH * 0.48);

            const activeCells = cellRects.map(cell => ({ cell }));

            console.log(`[INV] Preparadas ${activeCells.length} celdas activas; arrancando worker OCR...`);
            if (motorActivo() !== MOTOR_PRECISO || !PaddleRepository.listo()) await OCRRepository.ensureWorkers(activeCells.length);
            const workers = OCRRepository.workers.filter(Boolean);
            console.log(`[INV] Workers OCR listos: ${workers.length}`);

            if (!this._nameColorCache || this._nameColorCache.key !== calibKey) {
                // the read wins over the auto-grid color, which comes from counting pixels
                const color = await electPageNameColor(workers[0], snapshot, activeCells, cellW, textSrcY, textSrcH, theme)
                    || calibData?.nameColor;
                if (color) this._nameColorCache = { key: calibKey, color };
            }
            const pageNameColor = this._nameColorCache?.color || null;
            this.lastRawOcrLog.push(`[NAME-COLOR] ${pageNameColor ? `rgb(${pageNameColor.join(",")})` : "ninguno — cada celda mide el suyo"}`);

            const hdr = `${agInfo} · name ${pageNameColor ? `rgb(${pageNameColor.join(",")})` : "por celda"}`;
            dCtx.fillStyle = "rgba(0,0,0,0.72)";
            dCtx.fillRect(0, 0, dCtx.measureText(hdr).width + 160, 20);
            dCtx.fillStyle = pageNameColor ? `rgb(${pageNameColor.join(",")})` : "#ff5252";
            dCtx.font = "bold 13px monospace";
            dCtx.fillText(hdr, 6, 14);

            const pendingItems = [];

            const { drawResolved: drawResolvedCell, drawFailed: drawFailedCell } =
                createCellOverlay(dCtx, gridZone, cellW, cellH);

            // precise engine: every name band of the page in one pass (PaddleRepository.recognizeStripWords).
            // On failure, cell by cell.
            const bandaY = Math.round(cellH * 0.50), bandaH = Math.round(cellH * 0.48);
            const clave = (cell) => `r${cell.r}c${cell.c}`;
            let lotePreciso = null;
            if (motorActivo() === MOTOR_PRECISO) {
                const tiras = activeCells.map(({ cell }) =>
                    ({ clave: clave(cell), sx: cell.sx, sy: cell.sy + bandaY, sw: cellW, sh: bandaH }));
                lotePreciso = await PaddleRepository.recognizeStripWords(snapshot, tiras)
                    .catch((e) => { console.warn("[Paddle] lote falló, voy celda a celda:", e); return null; });
            }

            let cellIndex = 0;
            const runWorker = async (worker) => {
                while (cellIndex < activeCells.length) {
                    const task = activeCells[cellIndex++];
                    if (!task) break;
                    await new Promise((r) => setTimeout(r, 0));

                    console.log(`[INV] celda ${cellIndex}/${activeCells.length} (r${task.cell.r}c${task.cell.c})...`);

                    const { cell } = task;
                    // the binarized name mask is lazy: about half the page scan and the precise engine does not use it
                    let textCvs = null, ownColorUsed = false;
                    let ink = null;
                    const mascaraNombre = () => {
                        if (textCvs) return textCvs;
                        const m = cellNameMask(snapshot, cell, cellW, textSrcY, textSrcH, theme, pageNameColor);
                        textCvs = m.cvs; ink = m.ink; ownColorUsed = m.ownColor;
                        if (ownColorUsed) scanStats.ownColor++;
                        return textCvs;
                    };
                    const textoDelLote = lotePreciso?.get(clave(cell));
                    if (!textoDelLote) {
                        mascaraNombre();
                        if (!hasInk(ink)) {
                            scanStats.empty++;
                            this.lastRawOcrLog.push(`[r${cell.r}c${cell.c}] SKIPPED (empty)`);
                            dCtx.strokeStyle = "rgba(255, 255, 255, 0.04)";
                            dCtx.lineWidth = 1;
                            dCtx.strokeRect(cell.sx - gridZone.x + 2, cell.sy - gridZone.y + 2, cellW - 4, cellH - 4);
                            continue;
                        }
                    }
                    let combinedText;
                    if (motorActivo() === MOTOR_PRECISO) {
                        if (textoDelLote) {
                            combinedText = textoDelLote;
                        } else {
                            const colorCvs = VisionService.cropColor(snapshot, cell.sx, cell.sy + bandaY, cellW, bandaH, 2);
                            try {
                                combinedText = await PaddleRepository.recognizeWords(colorCvs);
                            } catch (e) {
                                console.warn("[Paddle] fallo, cae a Tesseract:", e);
                                combinedText = await OCRService.extractCellText(worker, mascaraNombre());
                            }
                        }
                    } else {
                        combinedText = await OCRService.extractCellText(worker, mascaraNombre());
                    }

                    if (!combinedText) {
                        scanStats.none++;
                        this.lastRawOcrLog.push(`[r${cell.r}c${cell.c}] NONE`);
                        continue;
                    }

                    let logStr = `[r${cell.r}c${cell.c}] OCR: ${combinedText.join(" ")}`;

                    // riven guard before matching: a riven name can fuzzy-match a prime part
                    if (this._isRivenCellText(combinedText)) {
                        this.lastRawOcrLog.push(logStr + " || RIVEN (ignored in inventory grid)");
                        continue;
                    }

                    let relicText = combinedText;
                    let itemText = combinedText;
                    const readable = !this._isGarbledCellText(combinedText);
                    let relicMatch = readable ? OCRService.getRelicMatch(combinedText) : null;
                    let bestItem = (readable && !relicMatch) ? OCRService.getValidItemMatch(combinedText) : null;
                    let fallbackText = null;

                    if (!bestItem && !relicMatch) {
                        const fallbackY = Math.floor(cellH * 0.73);
                        const fallbackH = Math.floor(cellH * 0.26);
                        const fullCellCvs = VisionService.cropThemeBinarized(snapshot, cell.sx, cell.sy + fallbackY, cellW, fallbackH, theme, pageNameColor);
                        fallbackText = await OCRService.extractCellText(worker, fullCellCvs);
                        if (fallbackText && fallbackText.length) {
                            logStr = `[r${cell.r}c${cell.c}] OCR (fallback): ${fallbackText.join(" ")}`;
                            if (this._isGarbledCellText(fallbackText)) fallbackText = null;
                        }
                        if (fallbackText && fallbackText.length) {
                            relicMatch = OCRService.getRelicMatch(fallbackText);
                            if (relicMatch) {
                                relicText = fallbackText;
                            } else {
                                bestItem = OCRService.getValidItemMatch(fallbackText);
                                if (bestItem) itemText = fallbackText;
                            }
                        }
                    }

                    if (!bestItem && !relicMatch && pageNameColor && !ownColorUsed) {
                        const ownText = await readCellWithOwnColor(worker, snapshot, cell, cellW, textSrcY, textSrcH, theme);
                        if (ownText?.length && !this._isGarbledCellText(ownText)) {
                            relicMatch = OCRService.getRelicMatch(ownText);
                            if (relicMatch) {
                                relicText = ownText;
                            } else {
                                bestItem = OCRService.getValidItemMatch(ownText);
                                if (bestItem) itemText = ownText;
                            }
                            if (relicMatch || bestItem) {
                                scanStats.ownColor++;
                                logStr = `[r${cell.r}c${cell.c}] OCR (color propio): ${ownText.join(" ")}`;
                            }
                        }
                    }

                    // PaddleOCR fallback (opt-in: globalThis.OCR_PADDLE_FALLBACK)
                    if (!bestItem && !relicMatch && motorActivo() !== MOTOR_PRECISO && globalThis.OCR_PADDLE_FALLBACK) {
                        const ty = Math.round(cellH * 0.50), th = Math.round(cellH * 0.48);
                        const colorCvs = VisionService.cropColor(snapshot, cell.sx, cell.sy + ty, cellW, th, 2);
                        try {
                            const pWords = await PaddleRepository.recognizeWords(colorCvs);
                            if (pWords) {
                                relicMatch = OCRService.getRelicMatch(pWords);
                                if (relicMatch) {
                                    relicText = pWords;
                                } else {
                                    const pMatch = OCRService.getValidItemMatch(pWords);
                                    if (pMatch) { bestItem = pMatch; combinedText = pWords; itemText = pWords; logStr += " [paddle]"; }
                                }
                            }
                        } catch (e) { console.warn("[Paddle fallback] error:", e); }
                    }


                    if (bestItem) {
                        const qtyResult = await leeCantidadBadge(snapshot, cell, cellW, cellH, theme);

                        logStr += ` || BDG: ${qtyResult.raw}`;
                        // not recorded yet: a prime part only counts if the page is not a relic page (see after Promise.all)
                        pendingItems.push({ cell, bestItem, qtyResult, itemText, logStr });
                    } else if (relicMatch) {
                        scanStats.relics++;
                        // same read as prime items, voting into the relic maps
                        const qtyResult = await leeCantidadBadge(snapshot, cell, cellW, cellH, theme);

                        const relicSrc = relicText === combinedText ? "1st-pass" : "fallback";
                        logStr += ` || RELIC (${relicSrc}): ${relicMatch} || BDG: ${qtyResult.raw}`;
                        this.lastRawOcrLog.push(logStr);

                        this.recordQtyVote(relicMatch, qtyResult, this.relicQtyVotes, this.sessionRelics);

                        // cyan accent tells a relic from a prime part at a glance
                        drawResolvedCell({
                            cell, name: relicMatch, qtyResult, text: relicText, accent: "#00e5ff",
                            qty: this.sessionRelics.get(relicMatch) ?? qtyResult.qty,
                        });
                    } else {
                        // second riven guard: only the full cell OCR (fallbackText) may show "RIVEN"
                        if (this._isRivenCellText(fallbackText)) {
                            this.lastRawOcrLog.push(logStr + " || RIVEN (ignored in inventory grid)");
                        } else {
                            scanStats.unmatched++;
                            this.lastRawOcrLog.push(logStr);
                            const relX = cell.sx - gridZone.x;
                            const relY = cell.sy - gridZone.y;
                            drawFailedCell({
                                cell, line2: `BDG: "Ø"`,
                                text: combinedText ? combinedText.join(" ") : "EMPTY",
                                status: readable ? "UNMATCHED CELL" : "GARBLED (UNREADABLE)",
                            });

                            // the overlay draws the binarized crop given to the OCR, its real input
                            const bandH = Math.round((cellH - 54) * 0.6);
                            dCtx.fillStyle = "#fff";
                            dCtx.fillRect(relX + 4, relY + 4, cellW - 8, bandH);
                            dCtx.drawImage(mascaraNombre(), relX + 4, relY + 4, cellW - 8, bandH);
                        }
                    }
                }
            };

            try {
                const workerPromises = [];
                const maxWorkers = lotePreciso ? 1 : workers.length;
                const activeWorkerCount = Math.min(maxWorkers, activeCells.length);
                for (let w = 0; w < activeWorkerCount; w++) {
                    workerPromises.push(runWorker(workers[w]));
                }
                await Promise.all(workerPromises);
                reloj.fase("celdas");
                const motorReal = lotePreciso ? "paddle" : `tesseract x${workers.length}`;
                reloj.fin(`${motorReal} · ${relojBadges.n} badges ${relojBadges.ms.toFixed(0)} ms`);

                // commit pending prime parts with the whole page seen: if most cells matched a relic it is the relic
                // tab and loose parts are misreads. Min 3, and twice the items, so a normal parts page passes.
                const relicPage = scanStats.relics >= 3 && scanStats.relics >= 2 * pendingItems.length;
                for (const pending of pendingItems) {
                    if (relicPage) {
                        scanStats.unmatched++;
                        this.lastRawOcrLog.push(`${pending.logStr} || DESCARTADO (página de reliquias): ${pending.bestItem.originalName}`);
                        drawFailedCell({
                            cell: pending.cell, text: pending.itemText.join(" "),
                            line2: `≠ ${pending.bestItem.originalName}`, status: "DISCARDED (RELIC PAGE)",
                        });
                        continue;
                    }
                    scanStats.matched++;
                    this.lastRawOcrLog.push(pending.logStr);
                    // time consensus: one frame's digit is fragile, the item name is not. The mode of the votes wins.
                    this.recordQtyVote(pending.bestItem.originalName, pending.qtyResult);
                    drawResolvedCell({
                        cell: pending.cell, qtyResult: pending.qtyResult, text: pending.itemText,
                        accent: "#00ff78",
                        name: pending.bestItem.originalName.replace(/Prime/gi, "").trim(),
                        // consensus qty, not this frame's
                        qty: this.sessionInventory.get(pending.bestItem.originalName) ?? pending.qtyResult.qty,
                    });
                }

                ScannerHUD.updateScrollStatus("done", this.sessionInventory.size + this.sessionRelics.size);
                ScannerHUD.updateDetectedItems(this.sessionInventory, this.sessionRelics);

                // a full page gives rows x cols cells; missing cells mark the entry as WARNING
                const expected = autoGrid.rows * autoGrid.cols;
                const fails = scanStats.unmatched + scanStats.none;
                const hasWarning = fails > 0 || scanStats.cells < expected;
                const summary = `cells ${scanStats.cells}/${expected} · match ${scanStats.matched}`
                    + ` · relic ${scanStats.relics} · empty ${scanStats.empty} · fail ${fails}`
                    + (scanStats.ownColor ? ` · own-color ${scanStats.ownColor}` : "")
                    + (autoGrid.phaseShift ? ` · dy ${autoGrid.phaseShift > 0 ? "+" : ""}${autoGrid.phaseShift}px` : "");
                this.lastRawOcrLog.push(`[SUMMARY] ${summary}`);

                // the page color is cached for the session: if half the page rebinarized with its own color, it is
                // dropped and the next page picks again
                if (pageNameColor && scanStats.ownColor * 2 > scanStats.cells) {
                    console.warn(`[INV] El color de página rgb(${pageNameColor.join(",")}) falló en ${scanStats.ownColor}/${scanStats.cells} celdas — se descarta y se reelige.`);
                    this._nameColorCache = null;
                }

                const aciertos = scanStats.matched + scanStats.relics;
                const revision = revisaRejillaCacheada(aciertos, activeCells.length, this._gridReintentado);
                this._gridReintentado = revision.yaReintentado;
                if (this._autoCalibCache && revision.reDetectar) {
                    console.warn(`[INV] Solo ${aciertos}/${activeCells.length} celdas casaron con lo cacheado — invalidando auto-grid, color de nombre y tema.`);
                    this._autoCalibCache = null;
                    this._nameColorCache = null;
                    // the theme too: it feeds every color mask
                    this._temaCache = null;
                }

                // image only with the panel open: hidden <img> entries cost ~1.9 GB
                this.debugHistory.unshift({
                    time: new Date().toLocaleTimeString([], { hour12: false }),
                    img: ScannerHUD.isDebugOpen() ? debugCanvas.toDataURL("image/jpeg", 0.6) : null,
                    log: [...this.lastRawOcrLog],
                    summary,
                    warning: hasWarning
                });
                if (this.debugHistory.length > 10) this.debugHistory.length = 10;
                if (ScannerHUD.isDebugOpen() && ScannerHUD.updateDebugHistory) {
                    ScannerHUD.updateDebugHistory(this.debugHistory);
                    this.lastDebugUpdate = Date.now() + 5000;
                }
            } catch (e) {
                console.error("[INV] Grid processing failed:", e);
                // the "done" at the end of the try is never reached when the scan throws
                ScannerHUD.updateScrollStatus("done", this.sessionInventory.size + this.sessionRelics.size);
            } finally {
                this.detectionLocked = false;
            }

        } finally {
            this.detectionLocked = false;
        }
    },

    _isGarbledCellText(words) {
        if (!words || !words.length) return false;
        const tokens = words.join(" ").toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
        if (tokens.length > 8) return true;
        return tokens.filter(t => t.length === 1).length >= 2;
    },

    _isRivenCellText(words) {
        if (!words || !words.length) return false;
        const t = words.join(" ").toUpperCase();
        if (t.includes("RIVEN")) return true;
        return t.includes("MOD") && /RIFLE|PISTOL|SHOTGUN|SNIPER|MELEE|ARCHGUN|KITGUN/.test(t);
    },

};
function clearRewardDebugLogs() {
    const container = document.getElementById("rewards-raw-ocr-content");
    if (container) container.innerHTML = "";
}

function addRewardDebugLog(tag, msg, type = "info") {
    // skipped with the panel closed: each entry forced a page reflow
    const parent = document.getElementById("rewards-dbg-text");
    const container = document.getElementById("rewards-raw-ocr-content");
    if (!parent || !container || parent.classList.contains("hidden")) return;

    const entry = document.createElement("div");
    const colors = { info: "#ff9800", match: "#00ff78", warn: "#f1c40f" };

    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour12: false });

    entry.innerHTML = `
        <span style="color:#555;">[${timeStr}]</span>
        <span style="color:${colors[type]}; font-weight:bold;">${escapeHTML(tag).toUpperCase()}</span>
        <span style="color:#eee;">${escapeHTML(msg)}</span>
    `;

    container.appendChild(entry);
    parent.scrollTop = parent.scrollHeight;
}