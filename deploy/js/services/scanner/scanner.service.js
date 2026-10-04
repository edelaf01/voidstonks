import { VisionService } from "./vision.service.js";
import { freezeFrame, releaseFrame } from "../../utils/vision/frame_freeze.js";
import { nextLatchedContext, INITIAL_LATCH, enrutaGraciaRiven, intervaloCabecera, INTERVALO_FIN_MISION_MS, CADUCIDAD_CABECERA_MS, FRANJA_TITULO_VIDEO, tituloHaCambiado } from "../../utils/vision/context_latch.js";
import { sensorDelEscaner, CADA_MS } from "../../utils/vision/wake_sensor.js";
import { isImplausibleFallbackGrid } from "../../utils/vision/plausibility.js";
import { corrige56 } from "../../utils/vision/relic_digit_56.js";
import { filasEnFase } from "../../utils/vision/grid_alignment.js";
import { localizaBandaRecompensas, candidatosDeRecorte, recorteDelRotulo } from "../../utils/vision/reward_band.js";
import { leeRecompensas, leeRotulosMissionComplete, leeCasillaMissionComplete } from "./reward_read.service.js";
import { leeCantidadBadge, relojBadges } from "./badge_read.service.js";
import { motorActivo, MOTOR_PRECISO, rejillaConClasico } from "./ocr_engine.service.js";
import { OCRService } from "./ocr.service.js?v=264";
import { SquadService } from "./squad.service.js";
import { RelicScreenService } from "./relic_screen.service.js";
import { OCRRepository } from "../../repositories/ocr.repository.js";
import { PaddleRepository } from "../../repositories/paddle.repository.js";
import { ScannerHUD } from "../../ui.components/ui_scanner_hud.js";
import { ScannerModal } from "../../ui.components/ui_scanner_modal.js";
import { initializeOCRDatabase } from "../../repositories/api.repository.js";
import { escapeHTML } from "../../utils/escape_html.js";
import { electPageNameColor, cellNameMask, hasInk, readCellWithOwnColor, readCellCuttingArt } from "./name_color.service.js";
import { createCellOverlay } from "../../utils/vision/scan_overlay.js";
import { revisaRejillaCacheada } from "../../utils/vision/grid_cache.js";
import { detectRewardCells, esRecursoPorBadge } from "../../utils/vision/mission_complete_grid.js";
import { INITIAL_LEDGER, nextLedger, esPantallaRecordada, recuerdaPantalla, memoriaPantalla, sigueALaVista } from "../../utils/inventory/reward_ledger.js";
const memoriaMC = memoriaPantalla(() => localStorage, "vs_mc_ultima_pantalla");
const DESPIERTA_MC = 24;
const ESPERA_TARJETAS_MS = 1500;
import { createFrameQueue } from "../../utils/vision/frame_queue.js";
import { videoRegionHash, canvasRegionHash, compareHashes, fraccionCambiada, regionLuma, firmaTexto, mismoTexto } from "../../utils/vision/frame_hash.js";
import { createReadCache } from "../../utils/vision/read_cache.js";
import { DebugRecorder } from "./debug_recorder.service.js";
import { FirmasTitulo } from "./title_signatures.service.js";
import { leeCabeceraOCR, RESCATE_CABECERA_MS } from "./header_read.service.js";
import { TradeService } from "./trade.service.js";
import { ANCHO_REJILLA_TRADEO } from "../../utils/vision/trade_post.js";
import { DucatKioskService } from "./ducat_kiosk.service.js";
import { ESTADO_INICIAL as ESTADO_SIN_RESULTADO, saltaPorSinResultado, siguienteEstadoSinResultado } from "../../utils/vision/no_result_skip.js";
import { cronometro } from "../../utils/perf.js";

import { rivenFingerprint } from "../../utils/rivens/riven_naming.js";
import { hudBottom } from "../../utils/vision/hud_cover.js";
import { badgePlausible } from "../../utils/vision/badge_digit_ocr.js";
import { isGarbledCellText } from "../../utils/vision/cell_text_guard.js";
import { olvidaColorTexto } from "../../utils/vision/reward_preprocess.js";
import { cedeHilo } from "../../utils/yield.js";
import { avisa, pistasDelLog } from "../../utils/ganchos.js";

export const ScannerService = {
    isScanning: false,
    scanInterval: null,
    currentRate: 1200,
    RIVEN_RATE_ACTIVE: 400,
    RIVEN_RATE_IDLE: 1000,
    RIVEN_RATE_CONFIRM: 150,
    sessionInventory: new Map(),
    sessionRelics: new Map(),
    _autoCalibCache: null,
    _temaCache: null,
    _nameColorCache: null,
    _frameZoneCache: null,
    _invQueue: null,
    _sampleRect: null,
    onPaginaKiosco: null,
    detectionLocked: false,
    pausado: false,
    _recompensaLeida: false,
    _recompensasEnMision: false,
    scanCounter: 0,
    inventoryHasScanned: false,
    qtyVotes: new Map(),
    relicQtyVotes: new Map(),
    lastStableHash: null,
    virtualCanvas: null,
    lastHashL: null,
    lastNoResult: ESTADO_SIN_RESULTADO,
    lastRewardNoResult: ESTADO_SIN_RESULTADO,
    lastHeaderHash: null,
    lastHeaderText: null,
    lastHeaderOcrTime: 0,
    lastRivenContextType: null,
    lastTwoCardHash: null,
    oneCardStreak: 0,
    weaponSwitchCandidate: null,
    weaponSwitchStreak: 0,
    rivenConsensusBuffer: [],

    async start() {
        if (this.isScanning) return;
        this.isScanning = true;
        this.latchedContext = "UNKNOWN";
        this.ctxLatch = INITIAL_LATCH;
        this.detectionLocked = false;
        this._recompensaLeida = false;
        this._recompensasEnMision = false;
        this.mcLedger = INITIAL_LEDGER;
        this._mcCache.clear();
        this._mcDormido = null;
        this.lastHashL = null;
        this._zonasCartas = null;
        this.lastNoResult = ESTADO_SIN_RESULTADO;
        this.lastRewardNoResult = ESTADO_SIN_RESULTADO;
        this.lastHeaderHash = null;
        this.lastHeaderText = null;
        this.lastHeaderOcrTime = 0;
        this.lastRivenContextType = null;
        this.lastTwoCardHash = null;
        this.oneCardStreak = 0;
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
        OCRService.initMatcherData();
        this.loop();
    },

    stop() {
        this.isScanning = false;
        if (this.scanInterval) clearTimeout(this.scanInterval);
        this.scanInterval = null;
        this._sensor?.para();
        OCRRepository.terminateAll();
        PaddleRepository.apaga();
        this._invQueue?.clear();
        this.releaseFrames();
    },

    releaseFrames() {
        this._invQueue?.release();
        this._invSnapshot = releaseFrame(this._invSnapshot);
        this._mcFrameCvs = releaseFrame(this._mcFrameCvs);
        this._mcCellCvs = releaseFrame(this._mcCellCvs);
        this._mcGrid = null;
        this._recompensaParcial = null;
        TradeService.reset();
    },

    async loop() {
        this._sensor?.para();
        this._cartaVigilada = null;
        if (!this.isScanning) return;
        if (pistasDelLog.duerme(this)) return ScannerHUD.updateContext("LOG_WAIT");
        const video = document.getElementById("live-video");
        if (!video || video.paused || video.ended || !video.videoWidth || !video.videoHeight) { this.scanInterval = setTimeout(() => this.loop(), 1000); return; }
        try {
            await this.processFrame(video, this.virtualCanvas);
        } catch (e) {
            console.warn("Scanner loop error:", e);
        } finally {
            if (this.isScanning) {
                this.scanInterval = setTimeout(() => this.loop(), this.currentRate);
                if (this.currentRate > 2 * CADA_MS) (this._sensor ||= sensorDelEscaner(this, video, { acepta: () => this.latchedContext !== "UNKNOWN" || !!FirmasTitulo.reconoce(video) })).arma();
            }
        }
    },

    latchedContext: "UNKNOWN",
    ctxLatch: INITIAL_LATCH,
    lastRivenContextTime: 0,

    async processFrame(video, virtualCanvas) {
        if (this.pausado) return;
        if (this.detectionLocked && !this._recompensaLeida && !this._invQueue?.isBusy) return;
        if (!this.isScanning) return;
        this.scanCounter++;
        const reloj = cronometro("frame", 120);

        const dims = { width: video.videoWidth, height: video.videoHeight, scale: 1080 / video.videoHeight };
        const worker1 = OCRRepository.workers[0];
        if (!worker1) return;

        const headerHash = regionLuma(video, FRANJA_TITULO_VIDEO);
        const caducidad = this.latchedContext === "UNKNOWN" ? RESCATE_CABECERA_MS : CADUCIDAD_CABECERA_MS;
        const headerCacheFresh = this.lastHeaderOcrTime && (Date.now() - this.lastHeaderOcrTime < caducidad);
        const franjaQuieta = !!this._franjaTickAnterior && !tituloHaCambiado(headerHash, this._franjaTickAnterior);
        this._franjaTickAnterior = headerHash;
        const intervalo = intervaloCabecera(this._headerEstable, this.latchedContext);
        const enPausa = Date.now() - (this.lastHeaderOcrTime || 0) < intervalo;
        let headerText, pasadas = 0, firma = null;
        const cambiado = tituloHaCambiado(headerHash, this.lastHeaderHash);
        const pantallaNueva = franjaQuieta && cambiado && intervalo < INTERVALO_FIN_MISION_MS;
        this._cabeceraVigente = !(enPausa && cambiado);
        if ((firma = pistasDelLog.firma())) {
            headerText = firma.texto;
            Object.assign(this, { _cabeceraVigente: true, lastHeaderText: headerText, lastHeaderHash: headerHash, lastHeaderOcrTime: Date.now() });
        } else if (this.latchedContext === "TRADE" && TradeService.conDialogo(video)) {
            headerText = this.lastHeaderText || "TRADING POST";
        } else if (this.lastHeaderText !== null && headerCacheFresh && !pantallaNueva && (enPausa || !cambiado)) {
            headerText = this.lastHeaderText;
        } else if ((firma = FirmasTitulo.reconoce(video))) {
            headerText = firma.texto;
            Object.assign(this, { _cabeceraVigente: true, lastHeaderText: headerText, lastHeaderHash: headerHash, lastHeaderOcrTime: Date.now() });
        } else {
            this._cabeceraVigente = true;
            ({ headerText, pasadas } = await leeCabeceraOCR(this, video, virtualCanvas, worker1, franjaQuieta));
            this.lastHeaderText = headerText;
            this.lastHeaderHash = headerHash;
            this.lastHeaderOcrTime = Date.now();
        }

        reloj.fase("cabecera");
        const rawContext = VisionService.determineContext(headerText);
        this._headerEstable = rawContext === this._headerCtxPrevio ? (this._headerEstable || 0) + 1 : 0;
        this._headerCtxPrevio = rawContext;
        const now = Date.now();

        const textUpper = headerText.toUpperCase();
        const containsAnchor = ["MODS", "MODIFICADORES", "CYCLE", "CICLO", "CICLAR", "KUVA", "KUYVA",
            "ATRIBUTOS", "ELEGIR", "CONFIRMAR", "AGRIETADO"].some((a) => textUpper.includes(a));

        if (rawContext === "INVENTORY_MODS" || rawContext === "ITEM_DETAILS" || containsAnchor) {
            this.lastRivenContextTime = now;
            this.lastRivenContextType = rawContext === "ITEM_DETAILS" ? "ITEM_DETAILS" : "INVENTORY_MODS";
        }

        const gracia = this.lastRivenContextTime && (now - this.lastRivenContextTime < 8000);
        const { contexto: routedContext, cancelar } = enrutaGraciaRiven(
            rawContext, gracia, this.lastRivenContextType);
        if (cancelar) this.lastRivenContextTime = 0;

        this.ctxLatch = firma ? { ...INITIAL_LATCH, latched: routedContext } : nextLatchedContext(this.ctxLatch, routedContext);
        if (this.ctxLatch.latched !== this.latchedContext) olvidaColorTexto();
        if (this.latchedContext === "MISSION_COMPLETE" && this.ctxLatch.latched !== "MISSION_COMPLETE") { this.mcLedger = INITIAL_LEDGER; this._mcCache.clear(); this._mcDormido = null; this._recompensasEnMision = false; }
        if (this.latchedContext === "REWARD" && this.ctxLatch.latched !== "REWARD") this.rescataRecompensaParcial();
        if (this.ctxLatch.latched !== this.latchedContext) { this.releaseFrames(); avisa("contexto", this.ctxLatch.latched); }
        this.latchedContext = this.ctxLatch.latched;
        if (this.latchedContext !== "REWARD") {
            this._rewardFrameCvs = releaseFrame(this._rewardFrameCvs);
            this._rewardDetectCvs = releaseFrame(this._rewardDetectCvs);
            VisionService.releaseRewardCanvases?.();
        }
        console.log(`[SCAN] Context Raw: ${rawContext} | Latched: ${this.latchedContext} | Header: "${headerText.trim().slice(0, 60)}"`);
        if (this.latchedContext !== this._ctxGrabado) { this._ctxGrabado = this.latchedContext; DebugRecorder.record({ kind: "cabecera", image: virtualCanvas, meta: { resumen: `${rawContext} → ${this.latchedContext}`, texto: headerText.trim() } }); }
        DebugRecorder.miniatura(video, { contexto: rawContext, fijado: this.latchedContext, cabecera: headerText.trim().slice(0, 80), pasadas });
        DebugRecorder.rendimientoTick({ contexto: this.latchedContext, enOCR: this.detectionLocked, cola: this._invQueue?.size ?? 0 });
        DebugRecorder.latenciaContexto({ fijado: this.latchedContext, cambiado, pendiente: !!this.ctxLatch.pending, via: firma ? "firma" : "ocr" });
        if (this._recompensaLeida) {
            if (this.latchedContext === "REWARD") return;
            this._recompensaLeida = false;
            this.detectionLocked = false;
        }
        await this.routeFrameAction(this.latchedContext, video, dims);
        if (pasadas && franjaQuieta && rawContext === this.latchedContext && !SquadService.lastVerdict) FirmasTitulo.aprende(video, headerText, rawContext);
        if (this.ctxLatch.pending) this.currentRate = Math.min(this.currentRate, 300);
        reloj.fin(this.latchedContext);

        ScannerHUD.updateFrameCounter(this.scanCounter);
    },

    get _canCapturePage() { return this._invQueue ? !this._invQueue.isFull : !this.detectionLocked; },

    enqueueInventoryPage(snapshot, dims) {
        const key = `${dims.width}x${dims.height}`;
        if (this._frameZoneCache?.key !== key) {
            const calib = VisionService.detectGridAutoCalib(snapshot, dims.width, dims.height, this.anchoRejilla(dims.width));
            let zone = calib?.gridZone || null;
            if (zone) {
                const cellH = Math.round(calib.cellH || 0);
                const y = Math.floor(dims.height * 0.17);
                const hudY = Math.max(y, zone.y - Math.round(cellH * 0.25));
                const ctx = snapshot.getContext("2d", { willReadFrequently: true });
                const borde = zone.y > hudY ? hudBottom(ctx.getImageData(zone.x, hudY, zone.w, zone.y - hudY)) : null;
                zone = { ...zone, y, h: dims.height - y, hud: borde == null ? null : borde + (hudY - y) };
            }
            this._frameZoneCache = { key, zone };
        }
        const zone = this._frameZoneCache.zone;
        if (!zone) {
            if (this.detectionLocked) return false;
            this.processInventoryGrid(snapshot, dims.width, dims.height, dims.scale, this.anchoRejilla(dims.width))
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

        if (badgePlausible(qtyResult.raw)) {
            votes.set(qtyResult.qty, (votes.get(qtyResult.qty) || 0) + 1);
        }

        targetMap.set(itemName, this.modeQty(votes));
    },

    modeQty(votes) {
        let bestQty = null, bestCount = -1;
        for (const [qty, count] of votes) {
            if (count > bestCount || (count === bestCount && qty > bestQty)) {
                bestCount = count; bestQty = qty;
            }
        }
        return bestQty;
    },

    autoScrollMuestra: null,
    autoScrollStableTimer: null,
    lastRowLums: null,
    sawScrollSinceScan: false,
    debugHistory: [],

    async routeFrameAction(rawContextType, video, dims) {
        const contextType = (globalThis.state.scannerModsMode && rawContextType === "INVENTORY")
            ? "INVENTORY_MODS"
            : rawContextType;
        ScannerHUD.updateContext(contextType === "INVENTORY" && DucatKioskService.esKiosco(this.lastHeaderText) ? "DUCAT_KIOSK" : contextType);

        if (await SquadService.probe(video, { aCiegas: contextType === "UNKNOWN" || contextType === "RELICS" })) {
            this.lastRivenContextTime = 0;
            return;
        }

        if (contextType === "INVENTORY") {
            if (!this.detectionLocked) await DucatKioskService.process(video, this.lastHeaderText);
            if (!globalThis.state.autoScanEnabled && !DucatKioskService.esKiosco(this.lastHeaderText)) {
                this.currentRate = 3000;
                this.autoScrollMuestra = null;
                this.sawScrollSinceScan = false;
                if (this.autoScrollStableTimer) {
                    clearTimeout(this.autoScrollStableTimer);
                    this.autoScrollStableTimer = null;
                }
                return;
            }

            this.currentRate = 300;
            if (rejillaConClasico()) OCRRepository.ensureWorkers(OCRRepository.MAX_WORKERS).catch(() => {});

            // 108 sample rows, not 27: the tail of the game's smooth scroll moves a few px per frame
            const FILAS = 108;
            const sampleCvs = this._sampleCvs ||= document.createElement("canvas");
            sampleCvs.width = 48; sampleCvs.height = FILAS;
            const sCtx = sampleCvs.getContext("2d", { willReadFrequently: true });
            const zona = this._frameZoneCache?.key === `${dims.width}x${dims.height}` && this._frameZoneCache.zone;
            const r = zona || { x: 0, y: Math.floor(dims.height * 0.25), w: dims.width, h: Math.floor(dims.height * 0.5) };
            const rectKey = `${r.x},${r.y},${r.w},${r.h}`;
            if (this._sampleRect !== rectKey) { this._sampleRect = rectKey; this.lastRowLums = null; this.autoScrollMuestra = null; }
            sCtx.drawImage(video, r.x, r.y, r.w, r.h, 0, 0, 48, FILAS);

            const rowLums = [];
            const px = sCtx.getImageData(0, 0, 48, FILAS).data;
            const muestra = new Uint8Array(48 * FILAS);
            for (let r = 0; r < FILAS; r++) {
                let sum = 0;
                const rowStart = r * 48 * 4;
                for (let c = 0; c < 48; c++) {
                    const idx = rowStart + c * 4;
                    muestra[r * 48 + c] = px[idx] * 0.299 + px[idx+1] * 0.587 + px[idx+2] * 0.114;
                    sum += muestra[r * 48 + c];
                }
                rowLums.push(sum / 48);
            }
            if (!this.lastRowLums) { this.lastRowLums = rowLums; return; }

            let bestDy = 0;
            let mseZero = 0;
            let minError = Infinity;
            if (this.lastRowLums) {
                for (let dy = -24; dy <= 24; dy++) {
                    let errorSum = 0;
                    let count = 0;
                    for (let r = 0; r < FILAS; r++) {
                        const prevR = r + dy;
                        if (prevR >= 0 && prevR < FILAS) {
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
                this.sawScrollSinceScan = true;
                if (this.autoScrollStableTimer) {
                    clearTimeout(this.autoScrollStableTimer);
                    this.autoScrollStableTimer = null;
                }
                ScannerHUD.updateScrollStatus("detected");
                return;
            }

            const hasPageChanged = !this.autoScrollMuestra || this.sawScrollSinceScan
                || fraccionCambiada(muestra, this.autoScrollMuestra) >= 0.01;

            // the grid is periodic and a fast scroll down aliases to a negative dy
            if (hasPageChanged && !this.autoScrollStableTimer && this._canCapturePage) {
                ScannerHUD.updateScrollStatus("detected");

                this.autoScrollStableTimer = setTimeout(async () => {
                    this.sawScrollSinceScan = false;
                    if ((!globalThis.state.autoScanEnabled && !DucatKioskService.esKiosco(this.lastHeaderText)) || !this._canCapturePage) {
                        this.autoScrollStableTimer = null;
                        return;
                    }

                    const v = document.getElementById("live-video");
                    if (!v?.videoWidth || !v.videoHeight) { this.autoScrollStableTimer = null; return; }
                    // reused canvas: one per scan (14 MB at 1440p) piled up faster than GC
                    if (!this._invSnapshot) this._invSnapshot = document.createElement("canvas");
                    const snapshot = this._invSnapshot;
                    if (snapshot.width !== v.videoWidth || snapshot.height !== v.videoHeight) {
                        snapshot.width = v.videoWidth; snapshot.height = v.videoHeight;
                    }
                    snapshot.getContext("2d", { willReadFrequently: true }).drawImage(v, 0, 0);

                    if (this.enqueueInventoryPage(snapshot, dims)) this.autoScrollMuestra = muestra;
                    this.autoScrollStableTimer = null;

                }, 800);
            } else if (!this.autoScrollStableTimer) {
                if (this.detectionLocked) ScannerHUD.updateScrollStatus("scanning");
                else ScannerHUD.updateScrollStatus("done", this.sessionInventory.size + this.sessionRelics.size);
            }

        } else if (contextType === "INVENTORY_MODS" || contextType === "ITEM_DETAILS") {
            this.currentRate = this.RIVEN_RATE_ACTIVE;
            if (this.detectionLocked) return;
            await this.processRivenCard(video, dims, contextType);
        } else if (contextType === "RELICS") {
            if (globalThis.RivenScannerHUD) globalThis.RivenScannerHUD.dismiss();
            if (this.detectionLocked) return;
            this.currentRate = 600;
            await RelicScreenService.process(video, dims, { menu: /REFI|NEME/.test((this.lastHeaderText || "").toUpperCase()) });
        } else if (contextType === "MISSION_COMPLETE") {
            if (globalThis.RivenScannerHUD) globalThis.RivenScannerHUD.dismiss();
            if (globalThis.state?.squadRun) SquadService.clear();
            this.currentRate = 400;
            await this.processMissionComplete(video, dims);
        } else if (contextType === "TRADE") {
            this.currentRate = 600;
            await TradeService.process(video);
        } else if (contextType === "REWARD") {
            if (globalThis.RivenScannerHUD) globalThis.RivenScannerHUD.dismiss();
            if (this.detectionLocked) return;
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
            this.currentRate = 1000;
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
        }
        return true;
    },

    _isSameRivenIdentity(a, b) {
        if (!a && !b) return true;
        if (!a || !b) return false;
        if (a.weaponName !== b.weaponName) return false;
        if (a.rolls !== null && b.rolls !== null && a.rolls !== b.rolls) return false;
        const igual = (x, y) => x.name === y.name
            && Math.abs(Math.abs(x.value) - Math.abs(y.value)) <= Math.max(0.6, 0.01 * Math.abs(x.value));
        const overlap = a.stats.filter((x) => b.stats.some((y) => igual(x, y))).length;
        return overlap >= Math.max(1, Math.min(a.stats.length, b.stats.length) - 1);
    },

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

    // splits OCR words into riven cards by X gaps, filters art noise and rebuilds text lines
    _wordsToCards(data, canvasWidth) {
        let words = [];
        const pushAll = (arr) => { if (Array.isArray(arr)) for (const w of arr) words.push(w); };
        if (Array.isArray(data?.words)) pushAll(data.words);
        if (!words.length && Array.isArray(data?.lines)) data.lines.forEach(l => pushAll(l.words));
        if (!words.length && Array.isArray(data?.paragraphs)) data.paragraphs.forEach(p => (p.lines || []).forEach(l => pushAll(l.words)));
        if (!words.length && Array.isArray(data?.blocks)) data.blocks.forEach(b => (b.paragraphs || []).forEach(p => (p.lines || []).forEach(l => pushAll(l.words))));

        if (globalThis._rivenWordDump) {
            const dump = words.filter(w => w && w.text && w.bbox)
                .map(w => `${w.text.trim()}@${Math.round(w.confidence ?? 0)}(${Math.round((w.bbox.x0 + w.bbox.x1) / 2)},${Math.round((w.bbox.y0 + w.bbox.y1) / 2)})`)
                .join("  ");
            console.log(`[RIVEN WORDS] ${dump}`);
        }

        const isContent = (t) => (t || "").replace(/[^a-z0-9]/gi, "").length >= 3 || /\d/.test(t || "");

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
        // splits by edge gaps not centers because wrapped line centers would split a card in two
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

        const ANCHOR_CONF = 70;
        const INSIDE_CONF = 28;
        const anchors = words.filter(w => w && w.text && w.bbox && isContent(w.text) && (w.confidence ?? 0) >= ANCHOR_CONF);
        console.log(`[OCR DIAG] dataKeys=[${Object.keys(data || {}).join(",")}] rawWords=${words.length} anchors=${anchors.length}`, words[0]);
        if (anchors.length >= 3) {
            const anchorGroups = clusterByX(anchors).filter(g => g.length >= 3);
            if (anchorGroups.length >= 2) {
                const inside = words.filter(w => w && w.text && w.bbox && isContent(w.text) && (w.confidence ?? 0) >= INSIDE_CONF);
                const cards = anchorGroups.map(g => {
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

        const usable = words.filter(w => w && w.text && isContent(w.text) && (w.confidence ?? 0) >= 50 && w.bbox);
        console.log(`[OCR DIAG] usable=${usable.length} (fallback)`);
        if (usable.length < 3) return null;
        const realGroups = clusterByX(usable).filter(g => g.length >= 3);
        console.log(`[OCR DIAG] gapThresh=${Math.round(gapThresh)} realGroups=${realGroups.length}`);
        if (realGroups.length < 2) return null;
        return realGroups.map(toText);
    },

    async processRivenCard(video, dims, contextType = null) {
        const { scale } = dims;

        const cardCrop = contextType === "ITEM_DETAILS" ? VisionService.RIVEN_ITEM_DETAILS_CROP : VisionService.RIVEN_CARD_CROP;

        const zonas = this._zonasCartas?.length ? this._zonasCartas : [cardCrop];
        const hash = firmaTexto(video, zonas);

        if ((this.lastParsedL || this.lastParsedR) && mismoTexto(hash, this.lastHashL)) {
            this.lastRivenContextTime = Date.now();
            this.lastRivenContextType = contextType === "ITEM_DETAILS" ? "ITEM_DETAILS" : "INVENTORY_MODS";
            this.currentRate = this.RIVEN_RATE_IDLE;
            this._cartaVigilada = zonas;
            return;
        }

        if (saltaPorSinResultado(hash, this.lastNoResult, Date.now(), 3000, mismoTexto)) return;

        const canvases = VisionService.prepareRivenCardCanvases(video, scale, cardCrop);

        if (globalThis.dumpRivenCrops) {
            canvases.forEach((c, i) => console.log(`[RIVEN CROP ${canvases.length > 1 ? `C${i + 1}` : "C"}] ${c.toDataURL("image/png")}`));
            globalThis.dumpRivenCrops = false;
        }

        const { RivenOCRService } = await import("../rivens/riven_ocr.service.js?v=3");

        if (canvases.length > 1) await OCRRepository.ensureSecondWorker().catch(() => {});
        const pool = OCRRepository.workers.filter(Boolean);
        const reads = await Promise.all(canvases.map((c, i) =>
            OCRRepository.recognizeWithChars(pool[i % pool.length] || pool[0], c, OCRRepository.RIVEN_CHARS, { blocks: true })));
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
                        : cardEntries.length;
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
        const armaLog = pistasDelLog.armaRiven();
        if (armaLog) for (const e of entries) if (e.parsed && e.parsed.weaponName !== armaLog) Object.assign(e.parsed, { weaponName: armaLog, validation: RivenOCRService.validateRiven({ ...e.parsed, weaponName: armaLog }) });

        const anyText = entries.map(e => e.text.toUpperCase()).join(" ");
        const hasCardAnchor = /CYCLE|KUVA|KUYVA|CONFIRM|\bMR\s*\d/.test(anyText);

        const MIN_CONF = 0.5;
        const valids = entries.filter(e => e.parsed && (e.parsed.validation?.confidence ?? 0) >= MIN_CONF);

        if (valids.length || hasCardAnchor) {
            this.lastRivenContextTime = Date.now();
            this.lastRivenContextType = contextType === "ITEM_DETAILS" ? "ITEM_DETAILS" : "INVENTORY_MODS";
        }

        if (!valids.length) {
            console.log(`[RIVEN OCR] sin parse válido en este frame (${contextType || "reroll"}) — se cachea el hash y no se reintenta hasta que la pantalla cambie`);
        }
        this.lastNoResult = siguienteEstadoSinResultado(valids.length > 0, hash, Date.now());

        const currentFP = valids.map(e => rivenFingerprint(e.parsed)).join("||") || "none";
        this.rivenConsensusBuffer.push(currentFP);
        if (this.rivenConsensusBuffer.length > 2) this.rivenConsensusBuffer.shift();
        const hasConsensus = this.rivenConsensusBuffer.length === 2 && this.rivenConsensusBuffer[0] === currentFP;

        let rawL = valids[0]?.parsed || null;
        let rawR = valids[1]?.parsed || null;
        const shownCards = [this.lastParsedL, this.lastParsedR].filter(Boolean);
        const shownCount = shownCards.length;

        if (shownCount === 2 && rawL && !rawR) {
            const matchesL = this._isSameRivenIdentity(rawL, this.lastParsedL);
            const matchesR = this._isSameRivenIdentity(rawL, this.lastParsedR);
            if (matchesR && !matchesL) { rawR = rawL; rawL = null; }
        }

        const newWeapons = [...new Set(valids.map(e => e.parsed.weaponName).filter(Boolean))].sort().join("|");
        const shownWeapons = [...new Set(shownCards.map(p => p.weaponName).filter(Boolean))].sort().join("|");
        let weaponChanged = newWeapons !== "" && newWeapons !== shownWeapons;

        // matcher anti-flip: a riven like "Croniignido" alternates between "Gotva Prime" and "Ignis"
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

        let dropExtra = false;
        const distinta = valids.length < shownCount && !!this.lastTwoCardHash && !mismoTexto(hash, this.lastTwoCardHash);
        const trasElegir = distinta && !!this._hashUnaCarta && mismoTexto(hash, this._hashUnaCarta);
        this._hashUnaCarta = distinta ? hash : null;
        if (valids.length < shownCount) {
            this.oneCardStreak++;
            const DOWNGRADE_STREAK = trasElegir ? 2 : 4;
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
            if (shown && weaponSwitchPending && raw.weaponName !== shown.weaponName) return shown;
            return raw;
        };

        let finalL = mergeSlot(rawL, this.lastParsedL);
        let finalR = mergeSlot(rawR, this.lastParsedR);
        if (dropExtra) {
            if (!rawL) finalL = null;
            if (!rawR) finalR = null;
        }

        if (!hasConsensus) {
            console.log("[RIVEN OCR] esperando a que la siguiente lectura confirme esta");
            if (globalThis._scannerDebug) this._renderRivenDebug(entries, false);
            this.currentRate = this.RIVEN_RATE_CONFIRM;
            return;
        }

        const changed = !this._isSameRiven(finalL, this.lastParsedL) || !this._isSameRiven(finalR, this.lastParsedR);

        if (globalThis._scannerDebug) this._renderRivenDebug(entries, changed);

        if (!weaponSwitchPending && !(trasElegir && !dropExtra)) {
            this._zonasCartas = canvases.map((c) => c.zonaVideo).filter(Boolean);
            this.lastHashL = firmaTexto(video, this._zonasCartas.length ? this._zonasCartas : [cardCrop]);
            this.lastTwoCardHash = finalL && finalR ? this.lastHashL : null;
        } else this.currentRate = this.RIVEN_RATE_CONFIRM;

        if (!changed) return;

        this.lastParsedL = finalL;
        this.lastParsedR = finalR;

        let captura = null;
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
            captura = colorCvs;
        } catch (e) {
            console.warn("Screenshot capture failed:", e);
        }

        if (globalThis.showRivenAppraisal && (this.lastParsedL || this.lastParsedR)) {
            globalThis.showRivenAppraisal(this.lastParsedL, this.lastParsedR, captura);
        }
    },

    _logRivenRead(side, rawText, parsed, canvas) {
        const raw = (rawText || "").trim().replace(/\n/g, " | ");
        const v = parsed?.validation;
        const tag = parsed
            ? `${parsed.weaponName || "?"} | ${parsed.stats.length} stats | conf ${v ? v.confidence : "?"}${v && !v.valid ? " ⚠" : " ✓"}`
            : "no parse";
        console.log(`[RIVEN OCR ${side}] ${tag} | crop ${canvas?.width}x${canvas?.height} | raw: "${raw}"`);
        if (parsed) {
            const stats = parsed.stats.map(s => `${s.isPositive ? "+" : "-"}${s.value}% ${s.name}${s.suspicious ? "⚠" : ""}`).join("  ");
            console.log(`  → riven: ${parsed.rivenName || "—"} | rolls ${parsed.rolls ?? "—"} | mr ${parsed.mr ?? "—"} | ${stats}`);
            if (v?.issues?.length) console.log(`  → issues: ${v.issues.join("; ")}`);
        }
    },

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

    mcLedger: INITIAL_LEDGER,
    _mcFrameCvs: null,
    _mcCellCvs: null,
    _mcStableHash: null,
    _mcGrid: null,
    _mcCache: createReadCache(),

    async processMissionComplete(video, dims) {
        const { width, height } = dims;
        const vista = this.mcLedger.committed && sigueALaVista(memoriaMC.lee());
        if (vista) memoriaMC.guarda(vista);
        const frame = this._mcFrameCvs = freezeFrame(video, width, height, this._mcFrameCvs);

        const hash = canvasRegionHash(frame, { x: Math.floor(width * 0.45), y: Math.floor(height * 0.18), w: Math.floor(width * 0.53), h: Math.floor(height * 0.74) });
        if (this._mcDormido) {
            if (compareHashes(hash, this._mcDormido, DESPIERTA_MC)) return;
            console.log("[MC] el panel cambió de verdad: se relee"); this._mcDormido = null;
        }
        if (!compareHashes(hash, this._mcStableHash, 6)) {
            this._mcStableHash = hash;
            return;
        }

        if (!this._mcGrid || !compareHashes(hash, this._mcGrid.hash, 6)) {
            const trace = {};
            const grid = detectRewardCells(frame.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, width, height), { trace });
            this._mcGrid = { hash, grid };
            if (!grid) { console.log(`[MC] Sin rejilla: ${trace.fail}`); return; }
            console.log(`[MC] ${trace.cells} casillas · ${trace.cols}×${trace.rows} · paso ${trace.pitch}${grid.occluded ? " · TAPADA" : ""}${grid.cut ? " · DESPLAZADA" : ""}`);
            console.log(`[MC] sin rótulo (mods): ${grid.cells.filter((c) => !c.named).map((c) => `r${c.row}c${c.col}`).join(" ") || "ninguna"} · recursos por cantidad: ${grid.cells.filter((c) => esRecursoPorBadge(c.badge)).map((c) => `r${c.row}c${c.col}(${c.badge})`).join(" ") || "ninguno"}`);
        }
        const { grid } = this._mcGrid;
        // the "N OWNED" tooltip covers up to two cells: wait for the mouse to move
        if (!grid || grid.occluded) return;

        const worker = OCRRepository.workers[0];
        if (!worker) return;

        if (!this._mcCellCvs) this._mcCellCvs = document.createElement("canvas");
        const pendientes = [];
        const items = [];
        for (const cell of grid.cells) {
            if (!cell.named || esRecursoPorBadge(cell.badge)) continue;
            const clave = `r${cell.row}c${cell.col}`, sello = canvasRegionHash(frame, cell);
            const previa = this._mcCache.get(clave, sello);
            if (previa) { if (previa.name) items.push({ name: previa.name, qty: cell.qty, cell, reliquia: previa.reliquia }); continue; }
            pendientes.push({ cell, clave, sello });
        }
        const rotulos = pendientes.length ? await leeRotulosMissionComplete(frame, pendientes.map((p) => p.cell)) : null;
        const lecturas = [];
        for (const { cell, clave, sello } of pendientes) {
            const lectura = await leeCasillaMissionComplete(worker, frame, cell, grid.accent, this._mcCellCvs, rotulos?.get(clave));
            this._mcCache.set(clave, sello, lectura);
            lecturas.push({ celda: clave, x: cell.x, y: cell.y, w: cell.w, h: cell.h, qty: cell.qty, ...lectura });
            if (lectura.name) items.push({ name: lectura.name, qty: cell.qty, cell, reliquia: lectura.reliquia });
        }
        if (pendientes.length) DebugRecorder.record({ kind: "fin-mision", image: frame, meta: { resumen: `${lecturas.length} casillas leídas · ${items.length} con nombre`, rejilla: { casillas: grid.cells.length, paso: grid.pitch, accent: grid.accent, cut: grid.cut, sinRotulo: grid.cells.filter((c) => !c.named).map((c) => `r${c.row}c${c.col}`) }, lecturas } });

        if (!this.mcLedger.committed && esPantallaRecordada(items, memoriaMC.lee())) this.mcLedger = { ...this.mcLedger, committed: memoriaMC.lee().committed };
        const { ledger, commit } = nextLedger(this.mcLedger, items);
        this.mcLedger = ledger;
        if (!pendientes.length) { this._mcDormido = hash; console.log("[MC] pantalla leída; en espera de otro fin de misión"); }
        if (commit?.length) memoriaMC.guarda(recuerdaPantalla(items, ledger));
        const gastada = RelicScreenService.tomaReliquiaElegida(!this._recompensasEnMision && (commit || []).some((i) => !i.reliquia));
        if ((commit?.length || gastada) && typeof globalThis.commitMissionCompleteRewards === "function") {
            globalThis.commitMissionCompleteRewards(commit || [], gastada);
        }
    },

    async processRewards(video, dims) {
        const { width, height, scale } = dims;

        const bandHash = videoRegionHash(video, { x: 0, y: 0.185, w: 1, h: 0.255 });
        if (saltaPorSinResultado(bandHash, this.lastRewardNoResult, Date.now(), 3000)) return;
        if (VisionService.determineContext(this.lastHeaderText || "") !== "REWARD") return;
        if (this._cabeceraVigente === false) return;

        const frame = this._rewardFrameCvs = freezeFrame(video, width, height, this._rewardFrameCvs);

        const { cropRect, columnas, cardCount: enImagen, bandSource, cvs } = localizaBandaRecompensas(frame, width, height, this._rewardDetectCvs);
        const cardCount = pistasDelLog.tarjetas() || enImagen;
        this._rewardDetectCvs = cvs;
        console.log(cropRect
            ? `[REWARD] Banda detectada (${bandSource}): ${cardCount} cards en x=${Math.round(cropRect.x)} y=${Math.round(cropRect.y)} ${Math.round(cropRect.w)}x${Math.round(cropRect.h)}`
            : "[REWARD] Banda no detectada, usando recorte fijo de respaldo");

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
        const parcial = this._recompensaParcial;
        if (parcial && parcial.result.foundItems.length > result.foundItems.length) ({ result, usado } = parcial);
        const desde = parcial?.desde ?? Date.now();
        if (result.foundItems.length && result.foundItems.length < (cardCount || 0) && Date.now() - desde < ESPERA_TARJETAS_MS) {
            console.log(`[REWARD] ${result.foundItems.length} de ${cardCount} tarjetas: se relee`);
            this._recompensaParcial = { result, usado, desde, dims, bandHash, primerRecorte: candidatos[0].nombre, cabecera: this.lastHeaderText };
            return;
        }
        this._recompensaParcial = null;
        this.abreRecompensas(frame, dims, { result, usado, bandHash, primerRecorte: candidatos[0].nombre, cabecera: this.lastHeaderText });
    },

    abreRecompensas(frame, dims, lectura) {
        const { width, height, scale } = dims;
        const { result, usado } = lectura;
        if (usado && (usado.preset !== "STANDARD" || usado.nombre !== lectura.primerRecorte)) {
            console.log(`[REWARD] Leído con recorte "${usado.nombre}" y preset ${usado.preset}`);
        }
        const { rawOcr, namesRaw, foundItems, ocrCanvas, namesCanvas } = result;
        DebugRecorder.record({ kind: "recompensas", image: frame, overlay: ocrCanvas, meta: { resumen: `${foundItems.length} ítems`, recorte: usado, rawOcr, namesRaw, items: foundItems.map((i) => ({ name: i.name, owned: i.owned, crafted: i.crafted })) } });

        this.lastRewardNoResult = siguienteEstadoSinResultado(foundItems.length > 0, lectura.bandHash, Date.now());
        if (foundItems.length) RelicScreenService.marcaRecompensaPrime();

        const dbgPanel = document.getElementById("live-debug-snapshot");
        if (dbgPanel?.style.display === "block" && ocrCanvas) {
            const debugImg = document.getElementById("live-debug-snapshot-img");
            if (debugImg) debugImg.src = ocrCanvas.toDataURL("image/jpeg", 0.85);
        }
        const cropUsado = usado?.cropRect || null;

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
        addRewardDebugLog("OCR2", namesCanvas ? `Names: ${namesRaw.replaceAll(/\n+/g, " ").trim()}` : "Names: (skipped - noisy mask)", "info");
        addRewardDebugLog("SCAN", `Items found: ${foundItems.length}`, foundItems.length > 0 ? "match" : "warn");

        const contextText = `${rawOcr} ${namesRaw} ${lectura.cabecera || ""}`.toUpperCase();
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
            this._recompensaLeida = true;
            this._recompensasEnMision = true;
            const gastada = RelicScreenService.tomaReliquiaElegida(true);
            if (gastada) globalThis.gastaReliquiaAbierta?.(gastada);
            ScannerModal.open(frame.toDataURL("image/jpeg", 0.85), foundItems, width, height, scale, rawOcr);
        }
    },

    rescataRecompensaParcial() {
        if (!this._recompensaParcial || !this._rewardFrameCvs) return;
        const p = this._recompensaParcial;
        this._recompensaParcial = null;
        this.abreRecompensas(this._rewardFrameCvs, p.dims, p);
    },

    anchoRejilla(width) {
        return /TRADE/.test(this.lastHeaderText || "") ? Math.round(width * ANCHO_REJILLA_TRADEO) : width;
    },

    async processInventoryGrid(snapshot, width, height, scale, anchoMax = width) {
        const reloj = cronometro("inventario");
        relojBadges.ms = 0; relojBadges.n = 0;
        if (this.detectionLocked) return;
        this.detectionLocked = true;

        try {
            const calibKey = `${width}x${height}`;
            let calibData = VisionService.detectGridAutoCalib(snapshot, width, height, anchoMax);
            const reciennacida = !!calibData;
            if (calibData) {
                this._autoCalibCache = { key: calibKey, calib: calibData };
            } else if (this._autoCalibCache?.key === calibKey) {
                calibData = this._autoCalibCache.calib;
                console.log("[INV] Auto-grid sin señal en esta página — uso la rejilla de la anterior.");
            }

            if (!calibData) {
                const saved = globalThis.LiveCalibration?.getGrid() || null;
                if (saved && isImplausibleFallbackGrid(saved, width, height)) {
                    console.warn(`[INV] Calibración manual guardada implausible (zona ${saved.gridZone?.w}x${saved.gridZone?.h}, celda ${saved.cellW}x${saved.cellH} sobre frame ${width}x${height}) — descartada; se reintentará auto-grid.`);
                } else if (saved) {
                    calibData = saved;
                    console.log("[INV] Auto-grid sin señal este frame — usando calibración manual guardada.");
                }
            }

            const rejilla = calibData?.gridZone && { gridY: calibData.gridY ?? calibData.gridZone.y, cellH: calibData.cellH, rows: calibData.rows };
            if (!rejilla || (!reciennacida && !filasEnFase(VisionService.ultimasBandas, rejilla))) {
                console.warn(`[INV] Página saltada: ${rejilla ? "la rejilla no cae sobre los nombres" : "sin rejilla"} — se re-detecta.`);
                this._autoCalibCache = this._frameZoneCache = null;
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
                if (theme) this._temaCache = { key: calibKey, theme };
            }
            if (!theme) {
                theme = { name: "Neutral", r: 240, g: 240, b: 240, actualR: 240, actualG: 240, actualB: 240 };
                console.warn("[INV] Theme inconclusive — using neutral pseudo-theme (relics tab / tinted UI).");
            }
            console.log(`[INV] Theme detected: ${theme.name} (r:${theme.r} g:${theme.g} b:${theme.b})`);

            await cedeHilo(); reloj.fase("rejilla+tema");
            const ancla = VisionService.anclaPorChecks(snapshot, gridZone, { ...calibData, heredada: !reciennacida });
            const dx = ancla ? ancla.gridX - (calibData.gridX ?? gridZone.x) : 0, dy = ancla ? ancla.gridY - (calibData.gridY ?? gridZone.y) : 0;
            if (ancla && (Math.abs(dx) > calibData.cellW * 0.04 || Math.abs(dy) > calibData.cellH * 0.04)) {
                console.log(`[INV] fase por ✓ (${ancla.n} marcas): dx ${Math.round(dx)} dy ${Math.round(dy)}`);
                calibData = { ...calibData, gridX: ancla.gridX, gridY: ancla.gridY };
            }
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
            const hud = this._frameZoneCache?.zone?.hud ?? -1;
            const badgesPagina = new Map();
            const badgeDe = (c, k = `r${c.r}c${c.c}`) =>
                badgesPagina.get(k) || badgesPagina.set(k, leeCantidadBadge(snapshot, c, cellW, cellH, theme)).get(k);
            const badges = async (r) => {
                let n = 0;
                for (const c of cellRects.filter((x) => x.r === r)) { await cedeHilo(); if (badgePlausible((await badgeDe(c)).raw)) n++; }
                return n;
            };
            const filaTapada = cellRects.some((c) => c.r === 1) && (await badges(0)) === 0
                && (cellRects[0].sy + cellH * 0.04 < hud || (await badges(1)) >= Math.ceil(autoGrid.cols / 2));
            const activeCells = cellRects.filter((cell) => !(filaTapada && cell.r === 0)).map(cell => ({ cell }));
            if (filaTapada) this.lastRawOcrLog.push(`[r0] SKIPPED (sin badges bajo el HUD, ${cellRects.length - activeCells.length} celdas)`);
            const scanStats = { cells: activeCells.length, matched: 0, relics: 0, empty: 0, unmatched: 0, none: 0, ownColor: 0 };
            const textSrcY = Math.round(cellH * 0.50);
            const textSrcH = Math.round(cellH * 0.48);

            console.log(`[INV] Preparadas ${activeCells.length} celdas activas; arrancando worker OCR...`);
            if (rejillaConClasico()) await OCRRepository.ensureWorkers(activeCells.length);
            const workers = OCRRepository.workers.filter(Boolean);
            console.log(`[INV] Workers OCR listos: ${workers.length}`);

            let pageNameColor = this._nameColorCache?.key === calibKey ? this._nameColorCache.color : null;
            if (pageNameColor) this.lastRawOcrLog.push(`[NAME-COLOR] rgb(${pageNameColor.join(",")})`);

            const pendingItems = [];

            const { drawResolved: drawResolvedCell, drawFailed: drawFailedCell } =
                createCellOverlay(dCtx, gridZone, cellW, cellH);

            const bandaY = Math.round(cellH * 0.50), bandaH = Math.round(cellH * 0.48);
            const clave = (cell) => `r${cell.r}c${cell.c}`;
            let lotePreciso = null;
            if (motorActivo() === MOTOR_PRECISO) {
                const tiras = activeCells.map(({ cell }) =>
                    ({ clave: clave(cell), sx: cell.sx, sy: cell.sy + bandaY, sw: cellW, sh: bandaH }));
                await cedeHilo();
                lotePreciso = await PaddleRepository.recognizeStripWords(snapshot, tiras)
                    .catch((e) => { console.warn("[Paddle] lote falló, voy celda a celda:", e); return null; });
            }

            let eleccion = pageNameColor && Promise.resolve();
            const colorDeNombre = () => eleccion ||= (async () => {
                await cedeHilo();
                pageNameColor = await electPageNameColor(workers[0], snapshot, activeCells, cellW, textSrcY, textSrcH, theme)
                    || calibData?.nameColor || null;
                if (pageNameColor) this._nameColorCache = { key: calibKey, color: pageNameColor };
                this.lastRawOcrLog.push(`[NAME-COLOR] ${pageNameColor ? `rgb(${pageNameColor.join(",")})` : "ninguno — cada celda mide el suyo"}`);
            })();
            if (!lotePreciso) await colorDeNombre();

            const hdr = `${agInfo} · name ${pageNameColor ? `rgb(${pageNameColor.join(",")})` : "por celda"}`;
            dCtx.fillStyle = "rgba(0,0,0,0.72)";
            dCtx.fillRect(0, 0, dCtx.measureText(hdr).width + 160, 20);
            dCtx.fillStyle = pageNameColor ? `rgb(${pageNameColor.join(",")})` : "#ff5252";
            dCtx.font = "bold 13px monospace";
            dCtx.fillText(hdr, 6, 14);

            let cellIndex = 0;
            const runWorker = async (worker) => {
                while (cellIndex < activeCells.length) {
                    const task = activeCells[cellIndex++];
                    if (!task) break;
                    await cedeHilo();

                    console.log(`[INV] celda ${cellIndex}/${activeCells.length} (r${task.cell.r}c${task.cell.c})...`);

                    const { cell } = task;
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

                    if (this._isRivenCellText(combinedText)) {
                        this.lastRawOcrLog.push(logStr + " || RIVEN (ignored in inventory grid)");
                        continue;
                    }

                    let relicText = combinedText, itemText = combinedText;
                    const readable = !this._isGarbledCellText(combinedText);
                    let relicMatch = readable ? OCRService.getRelicMatch(combinedText) : null;
                    if (relicMatch && textoDelLote) {
                        const r = corrige56(relicMatch, PaddleRepository.palabrasDelLote(clave(cell)), PaddleRepository.recorteDelLote(clave(cell)), (n) => !!globalThis.state?.allRelicNames?.includes(n));
                        if (r.cambiado) { logStr += ` || 5/6 por glifo: ${r.nombre}`; relicMatch = r.nombre; }
                    }
                    let bestItem = (readable && !relicMatch) ? OCRService.getValidItemMatch(combinedText) : null;
                    let fallbackText = null;

                    if (!bestItem && !relicMatch) {
                        await colorDeNombre();
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

                    if (!bestItem && !relicMatch) {
                        const r = await readCellCuttingArt(worker, snapshot, cell, cellW, textSrcY, textSrcH, theme, pageNameColor, (ws) => !this._isGarbledCellText(ws));
                        if (r) { relicMatch = r.relicMatch; bestItem = r.bestItem; if (relicMatch) relicText = r.words; else itemText = r.words; logStr = `[r${cell.r}c${cell.c}] OCR (sin arte, corte ${r.corte}): ${r.words.join(" ")}`; }
                    }

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
                        const qtyResult = await badgeDe(cell);

                        logStr += ` || BDG: ${qtyResult.raw}`;
                        pendingItems.push({ cell, bestItem, qtyResult, itemText, logStr });
                    } else if (relicMatch) {
                        scanStats.relics++;
                        const qtyResult = await badgeDe(cell);

                        const relicSrc = relicText === combinedText ? "1st-pass" : "fallback";
                        logStr += ` || RELIC (${relicSrc}): ${relicMatch} || BDG: ${qtyResult.raw}`;
                        this.lastRawOcrLog.push(logStr);

                        this.recordQtyVote(relicMatch, qtyResult, this.relicQtyVotes, this.sessionRelics);

                        drawResolvedCell({
                            cell, name: relicMatch, qtyResult, text: relicText, accent: "#00e5ff",
                            qty: this.sessionRelics.get(relicMatch) ?? "?",
                        });
                    } else {
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
                    this.recordQtyVote(pending.bestItem.originalName, pending.qtyResult);
                    drawResolvedCell({
                        cell: pending.cell, qtyResult: pending.qtyResult, text: pending.itemText,
                        accent: "#00ff78",
                        name: pending.bestItem.originalName.replace(/Prime/gi, "").trim(),
                        qty: this.sessionInventory.get(pending.bestItem.originalName) ?? "?",
                    });
                }

                ScannerHUD.updateScrollStatus("done", this.sessionInventory.size + this.sessionRelics.size);
                ScannerHUD.updateDetectedItems(this.sessionInventory, this.sessionRelics);
                if (DucatKioskService.esKiosco(this.lastHeaderText)) this.onPaginaKiosco?.();

                const expected = autoGrid.rows * autoGrid.cols;
                const fails = scanStats.unmatched + scanStats.none;
                const hasWarning = fails > 0 || scanStats.cells < expected;
                const summary = `cells ${scanStats.cells}/${expected} · match ${scanStats.matched}`
                    + ` · relic ${scanStats.relics} · empty ${scanStats.empty} · fail ${fails}`
                    + (scanStats.ownColor ? ` · own-color ${scanStats.ownColor}` : "")
                    + (autoGrid.phaseShift ? ` · dy ${autoGrid.phaseShift > 0 ? "+" : ""}${autoGrid.phaseShift}px` : "");
                this.lastRawOcrLog.push(`[SUMMARY] ${summary}`);
                DebugRecorder.record({ kind: "inventario", image: snapshot, overlay: debugCanvas, log: this.lastRawOcrLog, meta: { resumen: summary, rejilla: { rows: autoGrid.rows, cols: autoGrid.cols, cellW, cellH, zone: gridZone, dy: autoGrid.phaseShift || 0, auto: !!calibData.auto }, tema: theme?.name ?? theme ?? null, colorNombre: pageNameColor, hud, filaTapada, celdas: cellRects.map((c) => ({ r: c.r, c: c.c, sx: c.sx, sy: c.sy })) } });

                if (pageNameColor && scanStats.ownColor * 2 > scanStats.cells) {
                    console.warn(`[INV] El color de página rgb(${pageNameColor.join(",")}) falló en ${scanStats.ownColor}/${scanStats.cells} celdas — se descarta y se reelige.`);
                    this._nameColorCache = null;
                }

                const aciertos = scanStats.matched + scanStats.relics;
                const revision = revisaRejillaCacheada(aciertos, activeCells.length, this._gridReintentado);
                this._gridReintentado = revision.yaReintentado;
                if (revision.reDetectar) {
                    console.warn(`[INV] Solo ${aciertos}/${activeCells.length} celdas casaron — invalidando auto-grid, zona de recorte, color de nombre y tema.`);
                    this._autoCalibCache = null;
                    this._nameColorCache = null;
                    this._frameZoneCache = null;
                    this._temaCache = null;
                }

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
                ScannerHUD.updateScrollStatus("done", this.sessionInventory.size + this.sessionRelics.size);
            } finally {
                this.detectionLocked = false;
            }

        } finally {
            this.detectionLocked = false;
        }
    },

    _isGarbledCellText(words) { return isGarbledCellText(words); },

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