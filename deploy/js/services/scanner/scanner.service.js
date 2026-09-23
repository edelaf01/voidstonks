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
import { INITIAL_LEDGER, nextLedger, esPantallaRecordada, recuerdaPantalla, memoriaPantalla } from "../../utils/inventory/reward_ledger.js";
const memoriaMC = memoriaPantalla(() => localStorage, "vs_mc_ultima_pantalla");
// Despierta la lectura dormida: un desplazamiento de fila mueve todo el panel (paso 180 px de
// ~800); la escena tras el panel translúcido se queda muy por debajo.
const DESPIERTA_MC = 24;
import { createFrameQueue } from "../../utils/vision/frame_queue.js";
import { videoRegionHash, canvasRegionHash, compareHashes, fraccionCambiada, regionLuma } from "../../utils/vision/frame_hash.js";
import { createReadCache } from "../../utils/vision/read_cache.js";
import { DebugRecorder } from "./debug_recorder.service.js";
import { DucatKioskService } from "./ducat_kiosk.service.js";
import { ESTADO_INICIAL as ESTADO_SIN_RESULTADO, saltaPorSinResultado, siguienteEstadoSinResultado } from "../../utils/vision/no_result_skip.js";
import { cronometro } from "../../utils/perf.js";

import { rivenFingerprint } from "../../utils/rivens/riven_naming.js";
import { hudBottom } from "../../utils/vision/hud_cover.js";
import { badgePlausible } from "../../utils/vision/badge_digit_ocr.js";
import { isGarbledCellText } from "../../utils/vision/cell_text_guard.js";
import { olvidaColorTexto } from "../../utils/vision/reward_preprocess.js";
import { cedeHilo } from "../../utils/yield.js";
const RESCATE_CABECERA_MS = 3000;

export const ScannerService = {
    isScanning: false,
    scanInterval: null,
    currentRate: 1200,
    RIVEN_RATE_ACTIVE: 400, // sin resultado mostrado aún, o el hash cambió: escanea rápido
    RIVEN_RATE_IDLE: 1000, // ya hay resultado y la pantalla está estática (hash-skip disparando): relaja el poll
    sessionInventory: new Map(),
    sessionRelics: new Map(), // relicName -> qty de consenso (fallback de reliquias en el grid de inventario)
    _autoCalibCache: null, // rejilla autodetectada cacheada { key: "WxH", calib } — detectar cuesta un frame completo
    _temaCache: null,      // tema detectado { key: "WxH", theme } — no cambia en toda la sesión
    _nameColorCache: null, // color del texto de los nombres { key: "WxH", color } — el tema no cambia a mitad de sesión
    _frameZoneCache: null, // zona de la rejilla EN COORDENADAS DEL FRAME { key: "WxH", zone } — para recortar al encolar
    _invQueue: null,       // cola de páginas pendientes de OCR (utils/frame_queue.js)
    _sampleRect: null,     // región del vídeo que vigila el auto-scan ("x,y,w,h"); al cambiar se tiran las muestras
    onPaginaKiosco: null,  // kiosko de ducados: cada página leída se vuelca al inventario sin pasar por Guardar
    detectionLocked: false,
    scanCounter: 0,
    inventoryHasScanned: false,
    qtyVotes: new Map(), // itemName -> Map<qty, count> (consenso de cantidad entre frames)
    relicQtyVotes: new Map(), // relicName -> Map<qty, count> (mismo consenso, pero para reliquias)
    lastStableHash: null,
    virtualCanvas: null,
    lastHashL: null,
    lastHashR: null,
    lastNoResult: ESTADO_SIN_RESULTADO, // último hash de cartas riven que NO produjo parse válido (ver utils/vision/no_result_skip.js)
    lastRewardNoResult: ESTADO_SIN_RESULTADO, // mismo patrón, para la banda de recompensas: sin él se repetía la escalera de recortes+OCR entera cada 400ms sobre una pantalla quieta
    lastHeaderHash: null, // luma de la franja del rótulo EN EL ÚLTIMO OCR real (baseline fijo: no se actualiza en frames saltados, para que el drift acumulado dispare re-OCR)
    lastHeaderText: null, // texto de la última lectura real del header (se reutiliza cuando el hash coincide)
    lastHeaderOcrTime: 0, // cuándo fue el último OCR real del header — el skip caduca a los 2.5s (acota la ceguera por colisión de hash)
    lastRivenContextType: null, // "INVENTORY_MODS" | "ITEM_DETAILS": qué recorte produjo el último hit riven (el grace period debe re-enrutar al MISMO)
    lastTwoCardHash: null, // hash de cartas la última vez que se mostraron 2 rivens de forma confirmada (histéresis 2→1)
    oneCardStreak: 0, // lecturas consecutivas de <2 cartas tras un cambio de hash real (histéresis 2→1)
    newCardStreak: 0, // lecturas consecutivas de una 2ª carta con arma distinta a la ya mostrada (evita falsos positivos del arte de fondo)
    weaponSwitchCandidate: null, // set de armas candidato a "cambio de riven" pendiente de confirmar
    weaponSwitchStreak: 0, // lecturas consecutivas con ese MISMO set de armas nuevo (anti-flip del matcher)
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
        OCRService.initMatcherData();
        // El pool no se precalienta aquí: cada worker es una instancia WASM (~40-60 MB) que una
        // sesión de solo rivens no usa nunca. Se crea al entrar en INVENTORY (routeFrameAction).
        this.loop();
    },

    stop() {
        this.isScanning = false;
        if (this.scanInterval) clearTimeout(this.scanInterval);
        this.scanInterval = null;
        this._sensor?.para();
        OCRRepository.terminateAll();
        PaddleRepository.apaga();
        // Parado no hay quien lea lo pendiente (los workers ya no están): se descarta.
        this._invQueue?.clear();
        this.releaseFrames();
    },

    /** Suelta las fotos retenidas (pool de páginas, instantánea del inventario, frame de fin de misión). */
    releaseFrames() {
        this._invQueue?.release();
        this._invSnapshot = releaseFrame(this._invSnapshot);
        this._mcFrameCvs = releaseFrame(this._mcFrameCvs);
        this._mcCellCvs = releaseFrame(this._mcCellCvs);
        this._mcGrid = null;
    },

    async loop() {
        this._sensor?.para();
        this._cartaVigilada = null;
        if (!this.isScanning) return;
        const video = document.getElementById("live-video");
        if (!video || video.paused || video.ended) { this.scanInterval = setTimeout(() => this.loop(), 1000); return; }
        try {
            await this.processFrame(video, this.virtualCanvas);
        } catch (e) {
            console.warn("Scanner loop error:", e);
        } finally {
            if (this.isScanning) {
                this.scanInterval = setTimeout(() => this.loop(), this.currentRate);
                // En UNKNOWN no: jugando, la franja se para y arranca a cada rato y cada despertar sería un OCR de cabecera más.
                if (this.latchedContext !== "UNKNOWN" && this.currentRate > 2 * CADA_MS) (this._sensor ||= sensorDelEscaner(this, video)).arma();
            }
        }
    },

    latchedContext: "UNKNOWN",
    // Estado de la histéresis, entero: lo produce y consume context_latch.js.
    ctxLatch: INITIAL_LATCH,
    lastRivenContextTime: 0,

    async processFrame(video, virtualCanvas) {
        // En inventario manda la cola: con el candado cortando aquí el bucle no miraba la pantalla
        // durante el OCR y la cola nunca pasaba de una página. Sin zona no hay cola y sigue mandando.
        if (this.detectionLocked && !(this.latchedContext === "INVENTORY" && this._frameZoneCache?.zone)) return;
        // Tras stop() los workers están muertos: recognize revienta con "reading 'postMessage'".
        if (!this.isScanning) return;
        this.scanCounter++;
        // Umbral alto a propósito: el bucle corre cada 300-800 ms y los frames que no hacen nada
        // no interesan. Lo que hay que ver es el frame CARO y en qué fase se fue.
        const reloj = cronometro("frame", 120);

        const dims = { width: video.videoWidth, height: video.videoHeight, scale: 1080 / video.videoHeight };
        const worker1 = OCRRepository.workers[0];
        if (!worker1) return;

        // Franja del rótulo, no la cabecera entera (el hash 16×9 no veía SELL -> MODS). Baseline = último frame OCREADO, o un fade gradual no dispararía nunca.
        const headerHash = regionLuma(video, FRANJA_TITULO_VIDEO);
        // Un UNKNOWN cacheado vale menos: puede ser un fin de misión al que se le negó el rescate.
        const caducidad = this.latchedContext === "UNKNOWN" ? RESCATE_CABECERA_MS : CADUCIDAD_CABECERA_MS;
        const headerCacheFresh = this.lastHeaderOcrTime && (Date.now() - this.lastHeaderOcrTime < caducidad);
        // Franja quieta entre dos ticks = pantalla parada, que es donde viven los títulos.
        const franjaQuieta = !!this._franjaTickAnterior && !tituloHaCambiado(headerHash, this._franjaTickAnterior);
        this._franjaTickAnterior = headerHash;
        // Con el contexto quieto manda también el reloj: en recompensas los iconos de la escuadra caen en la franja y se mueven.
        const intervalo = intervaloCabecera(this._headerEstable, this.latchedContext);
        const enPausa = Date.now() - (this.lastHeaderOcrTime || 0) < intervalo;
        let headerText, pasadas = 0;
        const cambiado = tituloHaCambiado(headerHash, this.lastHeaderHash);
        // Franja parada y distinta de la última leída = pantalla nueva: se lee sin esperar al reloj.
        // En fin de misión no: la escena tras el título "para" a ratos y disparaba lecturas.
        const pantallaNueva = franjaQuieta && cambiado && intervalo < INTERVALO_FIN_MISION_MS;
        // El texto cacheado describe ESTE frame salvo cuando el rótulo cambió y el reloj aún no
        // deja releer: ahí es de la pantalla anterior, y quien decida por la cabecera debe esperar.
        this._cabeceraVigente = !(enPausa && cambiado);
        if (this.lastHeaderText !== null && headerCacheFresh && !pantallaNueva && (enPausa || !cambiado)) {
            headerText = this.lastHeaderText;
        } else {
            this._cabeceraVigente = true;
            // Solo cuando el header cambió: dibujo, detección de tema + umbralizado (finalize) y OCR.
            VisionService.prepareVirtualCanvas(video, virtualCanvas);
            const headerTheme = VisionService.finalizeVirtualCanvas(virtualCanvas);
            const { data: headerData } = await OCRRepository.recognize(worker1, virtualCanvas, {}, { text: true });
            headerText = headerData.text || "";
            pasadas = 1;

            // Las dos pasadas de rescate solo aciertan en pantallas quietas (recompensas, fin de
            // misión). En el juego, donde nada las va a dar, corrían las dos en cada lectura: 3
            // OCR por frame para nada. Así que en movimiento se gastan como mucho cada 3 s, y con
            // la pantalla parada siempre: limitarlas ahí retrasaba el fin de misión hasta 10 s.
            const sinContexto = () => VisionService.determineContext(headerText) === "UNKNOWN";
            // En fin de misión el recorte izquierdo lee "BB MIS" y la escena mueve la franja: sin
            // rescate el latch caía cada pocos segundos y el ledger nunca llegaba a confirmar.
            const enFinDeMision = this.latchedContext === "MISSION_COMPLETE";
            const rescate = sinContexto() && (franjaQuieta || enFinDeMision || Date.now() - (this._ultimoRescate || 0) >= RESCATE_CABECERA_MS);
            if (rescate) this._ultimoRescate = Date.now();

            // Segundo intento: re-binariza el header por distancia estricta al color del tema.
            // Cubre "header del tema sobre fondo claro" (recompensas con cielo rojo/rosa), donde
            // la K-means invierte la clasificación. En fin de misión solo lee la pasada centrada.
            if (rescate && headerTheme && !enFinDeMision) {
                pasadas++;
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

            // Tercer intento: el título CENTRADO. MISSION COMPLETE no cae en el recorte izquierdo
            // (de ahí "WARFRAME MIS"): sin esta pasada esa pantalla es invisible. Va la última.
            if (rescate && sinContexto()) {
                pasadas++;
                if (!this._centerHeaderCvs) this._centerHeaderCvs = document.createElement("canvas");
                VisionService.prepareCenterHeaderCanvas(video, this._centerHeaderCvs);
                const cCtx = this._centerHeaderCvs.getContext("2d", { willReadFrequently: true });
                const cTheme = VisionService.detectThemeFromSnapshot(this._centerHeaderCvs, 0, 0, this._centerHeaderCvs.width, this._centerHeaderCvs.height, { sinRecuerdo: true });
                VisionService.applyThemeDistanceThreshold(cCtx, this._centerHeaderCvs.width, this._centerHeaderCvs.height, cTheme);
                const { data: cData } = await OCRRepository.recognize(worker1, this._centerHeaderCvs, {}, { text: true });
                const cText = cData.text || "";
                if (VisionService.determineContext(cText) !== "UNKNOWN") {
                    console.log(`[SCAN] Contexto por título centrado: "${cText.trim().slice(0, 60)}"`);
                    headerText = cText;
                }
            }
            this.lastHeaderText = headerText;
            this.lastHeaderHash = headerHash; // baseline = frame OCReado (evita drift)
            this.lastHeaderOcrTime = Date.now();
        }

        reloj.fase("cabecera");
        const rawContext = VisionService.determineContext(headerText);
        // La racha va sobre el CONTEXTO y no sobre el texto: la cabecera devuelve basura algo
        // distinta cada vez ("BI INVENTORYSELL", "B1 INVENTORY/SELL") sin moverse la pantalla.
        this._headerEstable = rawContext === this._headerCtxPrevio ? (this._headerEstable || 0) + 1 : 0;
        this._headerCtxPrevio = rawContext;
        const now = Date.now();

        // Anclas de riven/mods (EN y ES). "INVENTORY" no lo es: la venta de partes lleva
        // "INVENTORY/SELL" y meterla forzaba la gracia de rivens sobre el inventario normal.
        const textUpper = headerText.toUpperCase();
        const containsAnchor = ["MODS", "MODIFICADORES", "CYCLE", "CICLO", "CICLAR", "KUVA", "KUYVA",
            "ATRIBUTOS", "ELEGIR", "CONFIRMAR", "AGRIETADO"].some((a) => textUpper.includes(a));

        if (rawContext === "INVENTORY_MODS" || rawContext === "ITEM_DETAILS" || containsAnchor) {
            this.lastRivenContextTime = now;
            this.lastRivenContextType = rawContext === "ITEM_DETAILS" ? "ITEM_DETAILS" : "INVENTORY_MODS";
        }

        // Gracia de 8 s para rivens/mods. Re-enruta al MISMO tipo que produjo el último hit: el
        // popup Item Details usa OTRO recorte que el reroll, y remapear siempre a INVENTORY_MODS
        // haría OCR sobre la zona equivocada durante la gracia.
        const gracia = this.lastRivenContextTime && (now - this.lastRivenContextTime < 8000);
        const { contexto: routedContext, cancelar } = enrutaGraciaRiven(
            rawContext, gracia, this.lastRivenContextType);
        if (cancelar) this.lastRivenContextTime = 0;

        // La histéresis vive en utils/vision/context_latch.js (pura y con test).
        this.ctxLatch = nextLatchedContext(this.ctxLatch, routedContext);
        // El color del texto solo puede cambiar con la pantalla: se recalcula al cambiar de
        // contexto, no en cada frame.
        if (this.ctxLatch.latched !== this.latchedContext) olvidaColorTexto();
        // Fin de misión atrás: la siguiente puede repetir pieza y tiene que volver a contar.
        if (this.latchedContext === "MISSION_COMPLETE" && this.ctxLatch.latched !== "MISSION_COMPLETE") { this.mcLedger = INITIAL_LEDGER; this._mcCache.clear(); this._mcDormido = null; }
        // Las fotos solo sirven en su pantalla: al cambiar de contexto se sueltan (~40 MB a 1440p).
        if (this.ctxLatch.latched !== this.latchedContext) this.releaseFrames();
        this.latchedContext = this.ctxLatch.latched;
        // El frame congelado son ~15 MB a 1440p: fuera de recompensas se suelta.
        if (this.latchedContext !== "REWARD") {
            // El frame son ~15 MB a 1440p, y los de la cadena de recompensas otros ~7 entre el
            // recorte, la máscara de nombres, el downscale de detección y el de la franja.
            this._rewardFrameCvs = releaseFrame(this._rewardFrameCvs);
            this._rewardDetectCvs = releaseFrame(this._rewardDetectCvs);
            VisionService.releaseRewardCanvases?.();
        }
        console.log(`[SCAN] Context Raw: ${rawContext} | Latched: ${this.latchedContext} | Header: "${headerText.trim().slice(0, 60)}"`);
        if (this.latchedContext !== this._ctxGrabado) { this._ctxGrabado = this.latchedContext; DebugRecorder.record({ kind: "cabecera", image: virtualCanvas, meta: { resumen: `${rawContext} → ${this.latchedContext}`, texto: headerText.trim() } }); }
        DebugRecorder.miniatura(video, { contexto: rawContext, fijado: this.latchedContext, cabecera: headerText.trim().slice(0, 80), pasadas });
        DebugRecorder.rendimientoTick({ contexto: this.latchedContext, enOCR: this.detectionLocked, cola: this._invQueue?.size ?? 0 });
        await this.routeFrameAction(this.latchedContext, video, dims);
        if (this.ctxLatch.pending) this.currentRate = Math.min(this.currentRate, 300); // confirmar va de caché: rápido
        reloj.fin(this.latchedContext);

        ScannerHUD.updateFrameCounter(this.scanCounter);
    },

    // Voto de cantidad por ítem; sessionInventory recibe la MODA. Solo lecturas PLAUSIBLES (1-3
    // cifras): una fallida devuelve qty=1 con raw vacío ("Ø") o basura ("85603" bajo el HUD) y
    // metía falsos "1". votesMap/targetMap reutilizan el consenso con las reliquias.
    // Con cola, capturar ya no depende de que el OCR de la página anterior haya
    // terminado: solo de que quede sitio. Sin cola (aún sin calibración) manda el lock.
    get _canCapturePage() { return this._invQueue ? !this._invQueue.isFull : !this.detectionLocked; },

    /**
     * Recorta la zona de la rejilla y la encola para OCR. Se recorta en vez de guardar el
     * frame entero porque a 1440p son ~15 MB contra ~6 de la zona: con la cola acotada a 3
     * la memoria se queda en el orden del único snapshot de antes. El detector vuelve a
     * encontrar la rejilla dentro del recorte, así que el consumidor es el mismo
     * processInventoryGrid. Devuelve false si la cola está llena.
     */
    enqueueInventoryPage(snapshot, dims) {
        const key = `${dims.width}x${dims.height}`;
        if (this._frameZoneCache?.key !== key) {
            const calib = VisionService.detectGridAutoCalib(snapshot, dims.width, dims.height);
            let zone = calib?.gridZone || null;
            if (zone) {
                // El recorte arranca donde acaba la cabecera (medido: 0,158 del alto en el kiosko, 0,169 en el
                // inventario): por encima solo hay HUD y, como mucho, una fila medio escondida cuyo badge tapan los iconos.
                const cellH = Math.round(calib.cellH || 0);
                const y = Math.floor(dims.height * 0.17);
                // El HUD se mide en el cuarto de celda pegado a la fila: más arriba entra el nombre de la
                // fila cortada, que alterna igual que los iconos.
                const hudY = Math.max(y, zone.y - Math.round(cellH * 0.25));
                const ctx = snapshot.getContext("2d", { willReadFrequently: true });
                const borde = zone.y > hudY ? hudBottom(ctx.getImageData(zone.x, hudY, zone.w, zone.y - hudY)) : null;
                zone = { ...zone, y, h: dims.height - y, hud: borde == null ? null : borde + (hudY - y) };
            }
            this._frameZoneCache = { key, zone };
        }
        // Sin zona no hay qué recortar: se procesa en directo, que además es lo que abre
        // la calibración manual si tampoco hay auto-grid.
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

        if (badgePlausible(qtyResult.raw)) {
            votes.set(qtyResult.qty, (votes.get(qtyResult.qty) || 0) + 1);
        }

        // Cantidad de consenso = la más votada. Sin ningún voto válido la cantidad queda
        // DESCONOCIDA (null): antes se apuntaba la lectura fallida, que es un 1, y al guardar
        // pisaba el número real. Visto en vivo con una página de 18 reliquias con todos los
        // badges sin leer: 28 copias pasaban a 1.
        targetMap.set(itemName, this.modeQty(votes));
    },

    // Devuelve la cantidad más votada (desempate: la mayor). null si no hay votos.
    modeQty(votes) {
        let bestQty = null, bestCount = -1;
        for (const [qty, count] of votes) {
            if (count > bestCount || (count === bestCount && qty > bestQty)) {
                bestCount = count; bestQty = qty;
            }
        }
        return bestQty;
    },

    autoScrollMuestra: null, // luma de la muestra en el último escaneo (48xFILAS), para saber si la página es otra
    autoScrollStableTimer: null,
    lastRowLums: null,
    // true si se detectó movimiento desde el último escaneo: fuerza el rescan al
    // estabilizarse aunque el hash de página no cambie (el hash — suma de 64 píxeles,
    // umbral 120/16k — colisiona entre páginas parecidas y se comía escaneos).
    sawScrollSinceScan: false,
    // Historial de escaneos para el panel de debug: [{ time, img (dataURL jpeg del
    // canvas anotado), log, summary, warning }], más reciente primero, cap 10.
    debugHistory: [],

    async routeFrameAction(rawContextType, video, dims) {
        // El interruptor manual PRIME/RIVENS reencamina el contexto ANTES de anunciarlo. Antes
        // el desvío vivía dentro del else-if de rivens, así que con "RIVENS" puesto sobre el
        // inventario prime el HUD seguía diciendo INVENTORY mientras el pipeline leía cartas
        // de riven: la única pista de que el modo estaba activo era el propio cajón.
        const contextType = (globalThis.state.scannerModsMode && rawContextType === "INVENTORY")
            ? "INVENTORY_MODS"
            : rawContextType;
        ScannerHUD.updateContext(contextType === "INVENTORY" && DucatKioskService.esKiosco(this.lastHeaderText) ? "DUCAT_KIOSK" : contextType);

        // La pausa en misión no tiene cabecera propia: cae en UNKNOWN, o en RELICS cuando la fila de reliquias del squad entra en el recorte del header.
        if ((contextType === "UNKNOWN" || contextType === "RELICS") && await SquadService.probe(video)) return;

        if (contextType === "INVENTORY") {
            // Con una página en OCR no se lee el kiosko: cambia el psm del worker 0 y las celdas en vuelo saldrían con psm 7.
            if (!this.detectionLocked) await DucatKioskService.process(video, this.lastHeaderText);
            if (!globalThis.state.autoScanEnabled && !DucatKioskService.esKiosco(this.lastHeaderText)) {
                this.currentRate = 3000; // 3 seconds idle check when autoScan is disabled
                this.autoScrollMuestra = null;
                this.sawScrollSinceScan = false;
                if (this.autoScrollStableTimer) {
                    clearTimeout(this.autoScrollStableTimer);
                    this.autoScrollStableTimer = null;
                }
                return;
            }

            this.currentRate = 300; // Check faster (every 300ms) for extremely responsive scroll detection!
            // El pool se crea mientras el usuario aún hace scroll: al repartir la 1ª página se esperaba con ella ya quieta.
            if (rejillaConClasico()) OCRRepository.ensureWorkers(OCRRepository.MAX_WORKERS).catch(() => {});

            // 108 filas de muestra (≈7 px por fila a 1440p) y no 27 (≈27 px): la cola del
            // scroll suave del juego avanza unos píxeles por frame y con 27 filas era
            // invisible, así que la página se daba por quieta y se capturaba aún en movimiento.
            const FILAS = 108;
            const sampleCvs = this._sampleCvs ||= document.createElement("canvas");
            sampleCvs.width = 48; sampleCvs.height = FILAS;
            const sCtx = sampleCvs.getContext("2d", { willReadFrequently: true });
            // Se muestrea la ZONA DE LA REJILLA, no media pantalla: el panel de venta, el platino y el fondo animado cambian solos.
            const zona = this._frameZoneCache?.key === `${dims.width}x${dims.height}` && this._frameZoneCache.zone;
            const r = zona || { x: 0, y: Math.floor(dims.height * 0.25), w: dims.width, h: Math.floor(dims.height * 0.5) };
            const rectKey = `${r.x},${r.y},${r.w},${r.h}`;
            // Al cambiar de región, las muestras anteriores no comparan: verlas juntas es un scroll fantasma.
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
            // Primer frame de la región: solo deja la referencia, sin decidir nada.
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

            // Screen is stable (still). Rescan si hubo scroll desde el último escaneo O si el
            // hash de página cambió (el hash solo ya no basta: colisiona entre páginas parecidas).
            const hasPageChanged = !this.autoScrollMuestra || this.sawScrollSinceScan
                || fraccionCambiada(muestra, this.autoScrollMuestra) >= 0.01;

            // Una página quieta que cambió se escanea venga de donde venga. Antes se saltaba el
            // "scroll hacia arriba" (acumulador de bestDy <= -3), pero la rejilla es periódica y
            // un scroll rápido hacia ABAJO se alias a dy negativo: la página nueva se daba por
            // vista sin leerla y el HUD se quedaba en "estabilizando". Releer una ya vista solo
            // cuesta un voto más.
            if (hasPageChanged && !this.autoScrollStableTimer && this._canCapturePage) {
                ScannerHUD.updateScrollStatus("detected"); // Show stabilizing message

                this.autoScrollStableTimer = setTimeout(async () => {
                    // Se limpia AQUÍ (no tras el OCR): si el usuario vuelve a hacer scroll
                    // durante el escaneo, el flag se re-activa y la página nueva se escanea.
                    this.sawScrollSinceScan = false;
                    if ((!globalThis.state.autoScanEnabled && !DucatKioskService.esKiosco(this.lastHeaderText)) || !this._canCapturePage) {
                        this.autoScrollStableTimer = null;
                        return;
                    }

                    const v = document.getElementById("live-video");
                    // El stream puede haberse cerrado durante los 800 ms de espera. Sin esto,
                    // videoWidth es 0, el canvas se queda a 0×0 y el getImageData de la
                    // autocalibración revienta con IndexSizeError.
                    if (!v?.videoWidth || !v.videoHeight) { this.autoScrollStableTimer = null; return; }
                    // Canvas REUTILIZADO: uno nuevo por escaneo (14 MB a 1440p) se acumulaba más
                    // rápido de lo que el GC los soltaba y la pestaña caía por memoria.
                    if (!this._invSnapshot) this._invSnapshot = document.createElement("canvas");
                    const snapshot = this._invSnapshot;
                    if (snapshot.width !== v.videoWidth || snapshot.height !== v.videoHeight) {
                        snapshot.width = v.videoWidth; snapshot.height = v.videoHeight;
                    }
                    snapshot.getContext("2d", { willReadFrequently: true }).drawImage(v, 0, 0);

                    // La foto se ENCOLA y el OCR va por detrás. Cola llena ⇒ no se marca el
                    // hash: la página sigue como no vista y se reintenta, en vez de perderse.
                    if (this.enqueueInventoryPage(snapshot, dims)) this.autoScrollMuestra = muestra;
                    this.autoScrollStableTimer = null;

                }, 800);
            } else if (!this.autoScrollStableTimer) {
                // Con una página en OCR (la de antes o esta, ya encolada) lo que hay es un escaneo en
                // marcha, no una espera: "done" pisaría el "scanning" y "detected" lo dejaba colgado.
                if (this.detectionLocked) ScannerHUD.updateScrollStatus("scanning");
                else ScannerHUD.updateScrollStatus("done", this.sessionInventory.size + this.sessionRelics.size);
            }

        } else if (contextType === "INVENTORY_MODS" || contextType === "ITEM_DETAILS") {
            // Poll rápido por defecto para reaccionar casi al instante cuando el usuario reroll-ea o
            // cambia de riven / aún no hay nada mostrado. processRivenCard relaja este rate (ver
            // RIVEN_RATE_IDLE) cuando ya hay un resultado en pantalla y el hash-skip está disparando
            // (pantalla estática ya parseada) — así no se quema CPU/OCR sobre una carta sin cambios.
            this.currentRate = this.RIVEN_RATE_ACTIVE;
            if (this.detectionLocked) return;
            await this.processRivenCard(video, dims, contextType);
        } else if (contextType === "RELICS") {
            if (globalThis.RivenScannerHUD) globalThis.RivenScannerHUD.dismiss();
            // Al salir del inventario con una página aún en OCR: readGrid pone psm 11 en el worker 0 y las celdas en vuelo lo heredarían.
            if (this.detectionLocked) return;
            this.currentRate = 600;
            await RelicScreenService.process(video, dims);
        } else if (contextType === "MISSION_COMPLETE") {
            if (globalThis.RivenScannerHUD) globalThis.RivenScannerHUD.dismiss();
            // El run se acabó: el panel seguía prometiendo reliquias de una misión terminada.
            if (globalThis.state?.squadRun) SquadService.clear();
            // Dos frames quietos y dos lecturas iguales antes de apuntar: a 400 ms son ~1,5 s, a 800 el doble.
            this.currentRate = 400;
            await this.processMissionComplete(video, dims);
        } else if (contextType === "REWARD") {
            if (globalThis.RivenScannerHUD) globalThis.RivenScannerHUD.dismiss();
            if (this.detectionLocked) return;
            // Igualado al ritmo activo de rivens (400ms): detectionLocked corta el loop en
            // cuanto hay match, así que un poll más rápido no añade coste, solo reduce la
            // latencia hasta detectar la pantalla de recompensa desde que aparece en cámara.
            this.currentRate = this.RIVEN_RATE_ACTIVE;
            await this.processRewards(video, dims);
        } else {
            // UNKNOWN: el popup "Item Details" de un riven (chat/mercado) no tiene cabecera. Test de
            // píxel (texto lavanda en el rect del popup) antes del OCR; el parser descarta los falsos.
            if (contextType === "UNKNOWN" && VisionService.hasRivenTextHint(video)) {
                this.currentRate = this.RIVEN_RATE_ACTIVE;
                if (this.detectionLocked) return;
                await this.processRivenCard(video, dims, "ITEM_DETAILS");
                return;
            }
            if (globalThis.RivenScannerHUD) globalThis.RivenScannerHUD.dismiss();
            this.currentRate = 1000; // sin mirar el auto-scan: a 3 s el fin de misión tardaba hasta 6 s
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

    // Identidad "laxa" de un riven: mismo arma + mismos rolls, SIN exigir que el set de stats
    // coincida exactamente (a diferencia de _isSameRiven). Esto es lo que nos deja reconocer que
    // dos lecturas son "la misma carta" aunque una haya perdido/recuperado el curse tenue — y así
    // hacer un MERGE/UPGRADE de stats en vez de tratarlas como cartas distintas.
    _isSameRivenIdentity(a, b) {
        if (!a && !b) return true;
        if (!a || !b) return false;
        if (a.weaponName !== b.weaponName) return false;
        // rolls solo discrimina si AMBAS lecturas lo traen: la fila "MR/↻" se pierde a menudo en
        // el OCR de un frame concreto, y un null no debe romper la identidad (bloquearía el merge).
        if (a.rolls !== null && b.rolls !== null && a.rolls !== b.rolls) return false;
        // Mismo arma+rolls NO basta: en la pantalla de reroll la carta NUEVA comparte ambos con
        // la vieja (el contador aún no avanzó al no haber confirmado), pero es OTRO roll y debe
        // reemplazar a la mostrada, no "mergearse" con ella. Exigimos solapamiento de nombres de
        // stats: el set menor casi contenido en el mayor (se tolera 1 nombre de diferencia, que
        // es justo el caso del curse perdido/misleído que motivó esta identidad laxa).
        const namesA = new Set(a.stats.map(s => s.name));
        const namesB = new Set(b.stats.map(s => s.name));
        let overlap = 0;
        for (const n of namesA) if (namesB.has(n)) overlap++;
        const minLen = Math.min(namesA.size, namesB.size);
        return overlap >= Math.max(1, minLen - 1);
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

        // Umbral para huecos entre BORDES (no centros): el hueco de borde real entre dos cartas
        // lado a lado es ~4-6% del ancho del recorte (con el 7% de antes, calibrado para centros
        // de palabra, nunca se separaban) y las continuaciones de línea de una misma carta dejan
        // ~1%, así que 3% da margen por ambos lados; si se partiera mal, el texto completo en
        // processRivenCard lo rescata.
        const gapThresh = Math.max(canvasWidth * 0.03, 40);
        // Por hueco entre BORDES (x0 del siguiente menos el x1 máximo), no entre centros: el texto
        // envuelto de UNA carta ("Croni-", "(x2 for", "Cold") queda pegado al borde derecho del
        // bloque pero sus centros caen lejos, y por centros formaba anclas fantasma que partían
        // una carta en dos "columnas" que no parseaban.
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

        // --- Paso PRINCIPAL: anclas espaciales. El arte hace que Tesseract escupa ~100 tokens basura
        // de confianza baja dispersos en X; el texto real es de confianza ALTA (≳84) y va agrupado por
        // carta. Se ancla en los de confianza alta para ubicar la CAJA de cada carta y dentro se admiten
        // los de ≥28: recupera el curse tenue (~35) y descarta la basura dispersa. Validado offline.
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

        // Hash sobre la REGIÓN FIJA del vídeo, ANTES de preparar los canvases: el hash sobre los
        // tight-crops jitteraba con la pantalla quieta (el ancho del recorte baila 749–1538px) y el
        // skip nunca enganchaba. Con el rect fijo, un frame estático coincide y ni siquiera pagamos
        // el coste de prepareRivenCardCanvases.
        const hash = videoRegionHash(video, cardCrop);

        // Skip OCR if we already have a result and the region hasn't changed. Pantalla estática ya
        // parseada -> relaja el rate de poll (menos CPU); en cuanto el hash cambie, el siguiente
        // frame ya vuelve a RIVEN_RATE_ACTIVE (fijado por defecto en routeFrameAction) para reaccionar rápido.
        if ((this.lastParsedL || this.lastParsedR) && compareHashes(hash, this.lastHashL)) {
            this.lastRivenContextTime = Date.now();
            this.lastRivenContextType = contextType === "ITEM_DETAILS" ? "ITEM_DETAILS" : "INVENTORY_MODS";
            this.currentRate = this.RIVEN_RATE_IDLE;
            this._cartaVigilada = cardCrop;
            return;
        }

        // Skip si esta región YA OCReó a "sin parse válido" hace poco (ver no_result_skip.js):
        // sin esto, bajar el poll a 400ms convertía una pantalla estática sin parse en OCR constante.
        if (saltaPorSinResultado(hash, this.lastNoResult, Date.now(), 3000)) return;

        // The reroll screen shows ONE centered card or TWO side-by-side (old vs new roll).
        // prepareRivenCardCanvases auto-detects and returns one tightly-cropped canvas per card.
        const canvases = VisionService.prepareRivenCardCanvases(video, scale, cardCrop);

        // Debug: set `globalThis.dumpRivenCrops = true` in the console to print each binarized crop
        // as a data URL (paste into a browser address bar to view it). Solo se ve cuando el frame
        // NO fue saltado por hash (una pantalla estática ya parseada no vuelve a preparar crops).
        if (globalThis.dumpRivenCrops) {
            canvases.forEach((c, i) => console.log(`[RIVEN CROP ${canvases.length > 1 ? `C${i + 1}` : "C"}] ${c.toDataURL("image/png")}`));
            globalThis.dumpRivenCrops = false;
        }

        const { RivenOCRService } = await import("../rivens/riven_ocr.service.js?v=3");

        // Con DOS cartas, dos workers en paralelo ≈ mitad de latencia (en serie, la segunda carta
        // esperaba en la cola del mismo worker). El 2º worker se crea perezoso solo la primera vez
        // que aparece una pantalla de 2 cartas — el coste de RAM solo se paga si se usa el reroll.
        if (canvases.length > 1) await OCRRepository.ensureSecondWorker().catch(() => {});
        const pool = OCRRepository.workers.filter(Boolean);
        const reads = await Promise.all(canvases.map((c, i) =>
            OCRRepository.recognize(pool[i % pool.length] || pool[0], c, {}, { blocks: true })));
        // El layout side-by-side hace que el OCR lea AMBAS cartas en una sola pasada (el arte de fondo
        // funde el recorte de imagen). Separamos por posición X de las palabras —filtrando el garbage
        // del arte por confianza— en vez de fiarnos del recorte. Así C1/C2 salen limpios y sin mezclar.
        const entries = [];
        reads.forEach((res, ci) => {
            const cardTexts = this._wordsToCards(res.data, canvases[ci].width) || [res.data.text || ""];
            let cardEntries = cardTexts.map(text => ({
                res, text, parsed: RivenOCRService.parseRivenCard(text), canvas: canvases[ci],
            }));

            // Anti split fantasma: >=2 "cartas" pero menos de 2 parsean con arma = las continuaciones
            // de línea de UNA carta formaron grupo propio; se prueba el texto entero sin partir.
            // Solo si como mucho UNA columna menciona el arma: con el arma en 2+ columnas hay DOS
            // cartas y colapsarlas da una QUIMERA (el Recoil de la derecha en la carta izquierda).
            // El nombre puede llegar troceado ("Gotva Pri"): basta con su primera palabra.
            if (cardEntries.length >= 2) {
                const validCount = cardEntries.filter(e => e.parsed && e.parsed.weaponName).length;
                if (validCount < 2) {
                    const fullText = res.data.text || "";
                    const fullParsed = RivenOCRService.parseRivenCard(fullText);
                    const wName = cardEntries.find(e => e.parsed?.weaponName)?.parsed.weaponName || fullParsed?.weaponName || "";
                    const wKey = (wName.split(" ")[0] || "").toUpperCase();
                    const colsWithWeapon = wKey.length >= 4
                        ? cardEntries.filter(e => e.text.toUpperCase().includes(wKey)).length
                        : cardEntries.length; // sin arma fiable no podemos descartar 2 cartas: no colapsar
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

        // Extend grace period while the screen still looks riven-related
        const anyText = entries.map(e => e.text.toUpperCase()).join(" ");
        const hasCardAnchor = /CYCLE|KUVA|KUYVA|CONFIRM|\bMR\s*\d/.test(anyText);

        // Keep only confident reads (drops mod-grid / background noise), left-to-right
        const MIN_CONF = 0.5;
        const valids = entries.filter(e => e.parsed && (e.parsed.validation?.confidence ?? 0) >= MIN_CONF);

        if (valids.length || hasCardAnchor) {
            this.lastRivenContextTime = Date.now();
            // Recuerda QUÉ recorte produjo el hit: el grace period re-enruta a este mismo tipo
            // (el popup Item Details y el reroll usan zonas de pantalla distintas).
            this.lastRivenContextType = contextType === "ITEM_DETAILS" ? "ITEM_DETAILS" : "INVENTORY_MODS";
        }

        // El log es importante: sin él, un recorte mal calibrado falla UNA vez y el skip de
        // arriba silencia todos los reintentos sin dejar rastro de por qué.
        if (!valids.length) {
            console.log(`[RIVEN OCR] sin parse válido en este frame (${contextType || "reroll"}) — se cachea el hash y no se reintenta hasta que la pantalla cambie`);
        }
        this.lastNoResult = siguienteEstadoSinResultado(valids.length > 0, hash, Date.now());

        // --- TEMPORAL CONSENSUS: require 2/3 matching fingerprints (of the whole card set) ---
        const currentFP = valids.map(e => rivenFingerprint(e.parsed)).join("||") || "none";
        this.rivenConsensusBuffer.push(currentFP);
        if (this.rivenConsensusBuffer.length > 3) this.rivenConsensusBuffer.shift();
        const matchCount = this.rivenConsensusBuffer.filter(fp => fp === currentFP).length;
        const hasConsensus = matchCount >= 2;

        let rawL = valids[0]?.parsed || null;
        let rawR = valids[1]?.parsed || null;
        const shownCards = [this.lastParsedL, this.lastParsedR].filter(Boolean);
        const shownCount = shownCards.length;

        // Realinea una lectura ÚNICA con el slot mostrado que le corresponde: si mostramos 2 cartas
        // y este frame solo parseó la DERECHA, valids[0] caería en el slot izquierdo y lo pisaría
        // con la carta derecha duplicada. Si la lectura coincide por identidad solo con la carta R
        // mostrada, muévela a su slot (en un reroll ambas cartas son de la misma arma, así que la
        // desambiguación real la dan los rolls; si coincide con ambas, se queda en L como hasta ahora).
        if (shownCount === 2 && rawL && !rawR) {
            const matchesL = this._isSameRivenIdentity(rawL, this.lastParsedL);
            const matchesR = this._isSameRivenIdentity(rawL, this.lastParsedR);
            if (matchesR && !matchesL) { rawR = rawL; rawL = null; }
        }

        // A frame that reveals MORE cards than we're currently showing is strictly more complete:
        // the reroll comparison has two cards, but a wide/noisy frame often parses only one, shows
        // a single riven, and then the consensus gate blocks the good two-card frame from ever
        // updating it (its fingerprint differs, so 2/3 never forms). Let "more cards" through
        // immediately so the second riven appears. Downgrades (fewer cards) still need consensus,
        // so a single bad frame can't drop a card that is genuinely there.
        let revealsMore = valids.length > shownCount;

        // Pero si la carta "nueva" trae un ARMA DISTINTA a la ya mostrada, podría ser ruido (una
        // segunda carta fantasma sacada del arte de fondo) en vez de un reroll legítimo (que
        // siempre muestra la MISMA arma en ambas cartas). Exige 2 lecturas seguidas antes de
        // aceptar esa segunda carta con arma distinta; una carta nueva del MISMO arma (el caso
        // normal de reroll) se sigue aceptando de inmediato.
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

        // Cambiar de arma se muestra al instante; el consenso 2/3 existe para estabilizar la
        // MISMA carta, no para retrasar una nueva. Compara el set de armas ÚNICAS, no la lista:
        // con dos cartas del mismo arma ("Karak|Karak"), un frame parcial de una ("Karak") daba
        // true con duplicados y disparaba dropExtra, anulando la histéresis 2→1.
        const newWeapons = [...new Set(valids.map(e => e.parsed.weaponName).filter(Boolean))].sort().join("|");
        const shownWeapons = [...new Set(shownCards.map(p => p.weaponName).filter(Boolean))].sort().join("|");
        let weaponChanged = newWeapons !== "" && newWeapons !== shownWeapons;

        // Anti-flip del matcher de armas: con un riven "Croniignido" el matcher alterna entre el arma
        // real ("Gotva Prime") y una enganchada en el nombre ("Ignis") en frames alternos, y el
        // fast-path weaponChanged lo hacía visible. Se exigen 2 lecturas CONSECUTIVAS con el MISMO
        // set nuevo (un cambio real da 2 frames en <1 s). Solo si ya hay algo mostrado: el primer
        // resultado de la sesión sale al primer frame válido.
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

        // --- Histéresis 2→1: si ya mostramos 2 cartas y este frame trae MENOS, no lo tomes como
        // downgrade inmediato (podría ser una lectura parcial/ruidosa) — exige varias lecturas
        // consecutivas con menos cartas (o un cambio real de arma) antes de soltar la carta que
        // ya no se leyó en este frame. dropExtra solo afecta a la carta que YA NO llega en este
        // frame; si sigue llegando (aunque sea con menos stats) se gestiona vía merge más abajo.
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

        // --- MERGE/UPGRADE por identidad (arma+rolls): si la lectura nueva es del MISMO riven que el
        // mostrado, se queda la MEJOR de las dos (_isBetterOrEqualRead: más stats o más confianza):
        // la que recupera el curse tenue actualiza; una peor (curse perdido) no pisa la buena. Sin
        // lectura nueva (rawX null) se conserva lo mostrado, que es lo que preserva la carta
        // "hermana" durante la histéresis 2→1 de arriba.
        const mergeSlot = (raw, shown) => {
            if (!raw) return shown;
            if (shown && this._isSameRivenIdentity(raw, shown)) {
                return this._isBetterOrEqualRead(raw, shown) ? raw : shown;
            }
            // Cambio de arma aún SIN confirmar (streak < 2): conserva lo mostrado. Sin este guard,
            // una alternancia A,B,A,B del matcher forma consenso 2/3 para AMBAS armas (cada una se
            // repite 2 veces en el buffer de 3) y el flip se colaba por la puerta del consenso
            // aunque el fast-path weaponChanged estuviera suprimido.
            if (shown && weaponSwitchPending && raw.weaponName !== shown.weaponName) return shown;
            return raw; // riven distinto (o nada mostrado antes en esta posición): adopta la lectura nueva
        };

        let finalL = mergeSlot(rawL, this.lastParsedL);
        let finalR = mergeSlot(rawR, this.lastParsedR);
        if (dropExtra) {
            // Confirmado tras varias lecturas seguidas (o cambio de arma): la carta cuya posición
            // no trajo lectura nueva en este frame se suelta de verdad (deja de mostrarse).
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

        // No re-renderices si el resultado final es exactamente el mismo (mismo arma+rolls+stats)
        // que lo ya mostrado — evita quemar CPU/re-pintar el HUD ante lecturas idénticas.
        const changed = !this._isSameRiven(finalL, this.lastParsedL) || !this._isSameRiven(finalR, this.lastParsedR);

        if (globalThis._scannerDebug) this._renderRivenDebug(entries, changed);

        // Cachea el hash aunque el contenido no haya cambiado, para que el hash-skip enganche y el
        // rate se relaje en pantalla estática ya resuelta. EXCEPTO si hay un cambio de arma pendiente
        // de confirmar: con el hash de región fija, cachearlo aquí haría que el frame siguiente de la
        // pantalla NUEVA (estática) se saltara por hash y el cambio real nunca llegara a streak 2.
        if (!weaponSwitchPending) {
            this.lastHashL = hash;
            this.lastHashR = null;
        }

        if (!changed) return;

        this.lastParsedL = finalL;
        this.lastParsedR = finalR;

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

        // Solo se notifica a la UI si queda ALGO que mostrar: cuando el OCR falla en las dos
        // posiciones (finalL y finalR a null en las sueltas de arriba) llamar al HUD con
        // (null, null) hacía que _renderSingle petara con TypeError sobre riven.weaponName,
        // abortando el render y dejando la vista anterior a medias. Sin lectura válida es
        // mejor conservar lo ya mostrado y esperar al frame siguiente.
        if (globalThis.showRivenAppraisal && (this.lastParsedL || this.lastParsedR)) {
            globalThis.showRivenAppraisal(this.lastParsedL, this.lastParsedR, screenshotDataURL);
        }
    },

    // Compares two "hashA|hashB" combined canvas hashes segment-by-segment.
    _sameCombinedHash(a, b) {
        if (!a || !b) return false;
        const pa = a.split("|"), pb = b.split("|");
        if (pa.length !== pb.length) return false;
        return pa.every((h, i) => compareHashes(h, pb[i]));
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

    /** Consenso/dedup de altas automáticas desde MISSION COMPLETE (utils/inventory/reward_ledger.js). */
    mcLedger: INITIAL_LEDGER,
    _mcFrameCvs: null,
    _mcCellCvs: null,
    _mcStableHash: null,
    // Rejilla y lecturas por casilla, válidas mientras su recorte no cambie (utils/vision/read_cache.js).
    _mcGrid: null,
    _mcCache: createReadCache(),

    /**
     * Lee la pantalla de fin de misión y da de alta las piezas prime que aparezcan.
     *
     * Es la pantalla que dice lo que de VERDAD recibiste: en la de selección de reliquia el
     * usuario tiene que decirle a la app cuál eligió, y aquí ya está decidido.
     *
     * Cuatro puertas antes de escribir, todas baratas:
     *   1. rejilla de ✓ — si no hay retícula, no es esta pantalla o está a medio abrir
     *   2. contigüidad — un hueco en medio del panel es algo tapándolo (ver hasGap)
     *   3. catálogo real de reliquias + isPrime — "Ayatan Amber Star" casa consigo mismo y
     *      se queda fuera; lo que no sale de una reliquia no existe para el matcher
     *   4. consenso — dos lecturas idénticas, y el libro de la pantalla impide repetir el alta
     */
    async processMissionComplete(video, dims) {
        const { width, height } = dims;
        const frame = this._mcFrameCvs = freezeFrame(video, width, height, this._mcFrameCvs);

        // La pantalla entra con una animación de barrido. Leer a media animación cuesta un
        // OCR entero para tirarlo, así que primero se comprueba que ya está quieta. Se mira solo
        // el PANEL de recompensas: el fondo es la escena 3D (se mueve sola, y en Steel Path hay
        // enemigos animados encima) y con el frame entero no se daba por quieta nunca.
        const hash = canvasRegionHash(frame, { x: Math.floor(width * 0.45), y: Math.floor(height * 0.18), w: Math.floor(width * 0.53), h: Math.floor(height * 0.74) });
        // Pantalla ya leída y confirmada: se duerme hasta OTRO fin de misión (la salida de contexto
        // despierta). Solo un cambio grande del panel (desplazamiento con más de 4 filas) la relee.
        if (this._mcDormido) {
            if (compareHashes(hash, this._mcDormido, DESPIERTA_MC)) return;
            console.log("[MC] el panel cambió de verdad: se relee"); this._mcDormido = null;
        }
        if (!compareHashes(hash, this._mcStableHash, 6)) {
            this._mcStableHash = hash;
            return;
        }

        // La rejilla vale mientras el frame sea el mismo: detectarla es un getImageData del
        // frame entero más componentes, y la pantalla no se mueve hasta que el jugador pulsa.
        if (!this._mcGrid || !compareHashes(hash, this._mcGrid.hash, 6)) {
            const trace = {};
            const grid = detectRewardCells(frame.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, width, height), { trace });
            this._mcGrid = { hash, grid };
            if (!grid) { console.log(`[MC] Sin rejilla: ${trace.fail}`); return; }
            console.log(`[MC] ${trace.cells} casillas · ${trace.cols}×${trace.rows} · paso ${trace.pitch}${grid.occluded ? " · TAPADA" : ""}${grid.cut ? " · DESPLAZADA" : ""}`);
            console.log(`[MC] sin rótulo (mods): ${grid.cells.filter((c) => !c.named).map((c) => `r${c.row}c${c.col}`).join(" ") || "ninguna"} · recursos por cantidad: ${grid.cells.filter((c) => esRecursoPorBadge(c.badge)).map((c) => `r${c.row}c${c.col}(${c.badge})`).join(" ") || "ninguno"}`);
        }
        const { grid } = this._mcGrid;
        // El tooltip de "N OWNED" tapa hasta dos casillas: se espera a que el ratón se mueva.
        if (!grid || grid.occluded) return;

        const worker = OCRRepository.workers[0];
        if (!worker) return;

        if (!this._mcCellCvs) this._mcCellCvs = document.createElement("canvas");
        // Solo las casillas con rótulo (las otras son mods) cuyo recorte no se haya leído ya:
        // la segunda vuelta, la que confirma el consenso, sale de la caché y cuesta nada.
        const pendientes = [];
        const items = [];
        for (const cell of grid.cells) {
            if (!cell.named || esRecursoPorBadge(cell.badge)) continue;
            const clave = `r${cell.row}c${cell.col}`, sello = canvasRegionHash(frame, cell);
            const previa = this._mcCache.get(clave, sello);
            if (previa) { if (previa.name) items.push({ name: previa.name, qty: cell.qty, cell, reliquia: previa.reliquia }); continue; }
            pendientes.push({ cell, clave, sello });
        }
        // Con el motor preciso, los rótulos de TODA la pantalla salen de una sola pasada. No es
        // solo velocidad: aquí el rótulo se dibuja ENCIMA del arte y, cuando ocupa tres líneas,
        // Tesseract pierde la primera entera —medido, "Yareli Prime / Neuroptics / Blueprint"
        // se leía "CE NEUROPTICS BLUEPRINT"— y sin el nombre no hay match posible.
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
        // Segunda pasada sin nada que leer = el consenso ya tiene sus dos lecturas: a dormir.
        if (!pendientes.length) { this._mcDormido = hash; console.log("[MC] pantalla leída; en espera de otro fin de misión"); }
        if (commit?.length) memoriaMC.guarda(recuerdaPantalla(items, ledger));
        const gastada = RelicScreenService.tomaReliquiaElegida();
        if ((commit?.length || gastada) && typeof globalThis.commitMissionCompleteRewards === "function") {
            globalThis.commitMissionCompleteRewards(commit || [], gastada);
        }
    },

    async processRewards(video, dims) {
        const { width, height, scale } = dims;

        // Hash sobre la banda fija (18,5-44% del alto, ver reward_band.js) ANTES de freezeFrame,
        // para que una pantalla quieta sin recompensas no pague ni el freeze ni la OCR de abajo.
        const bandHash = videoRegionHash(video, { x: 0, y: 0.185, w: 1, h: 0.255 });
        if (saltaPorSinResultado(bandHash, this.lastRewardNoResult, Date.now(), 3000)) return;

        // UN frame para todo el flujo: banda, presets de OCR y foto del modal (ver freezeFrame).
        const frame = this._rewardFrameCvs = freezeFrame(video, width, height, this._rewardFrameCvs);

        // Dónde están las cards, en vez de asumir el 18,5-44 % del encuadre: esa asunción se
        // rompe con una webcam apuntando a un monitor externo, donde el juego solo llena una
        // fracción del frame y el % fijo cae sobre la pared (ver utils/vision/reward_band.js).
        const { cropRect, columnas, cardCount, bandSource, cvs } = localizaBandaRecompensas(frame, width, height, this._rewardDetectCvs);
        this._rewardDetectCvs = cvs;
        console.log(cropRect
            ? `[REWARD] Banda detectada (${bandSource}): ${cardCount} cards en x=${Math.round(cropRect.x)} y=${Math.round(cropRect.y)} ${Math.round(cropRect.w)}x${Math.round(cropRect.h)}`
            : "[REWARD] Banda no detectada, usando recorte fijo de respaldo");

        // Escalera de RECORTES sobre el mismo frame: la banda detectada y el recorte calibrado
        // fallan en capturas distintas (ver candidatosDeRecorte). Se queda con la lectura de MÁS
        // recompensas, no con la primera que devuelva algo.
        //
        // El coste se acota al cortar: con la lectura completa se para en el primer intento.
        const candidatos = candidatosDeRecorte({ cropRect, columnas, cardCount },
            recorteDelRotulo(frame, width, height, null));
        let result = null, usado = null;

        // PRIMERO el motor barato sobre TODOS los recortes: con los dos motores en la misma
        // llamada, un recorte malo pagaba una pasada de Tesseract (~1500 ms) antes de probar el
        // siguiente (log real: recorte 1 Paddle 0, Tesseract 0; recorte 2 Paddle 4 ítems).
        // Barrer los 2-3 recortes con Paddle son ~450 ms. Sin presets: Paddle no binariza.
        for (const cand of candidatos) {
            const r = await leeRecompensas(frame, width, height, scale, "STANDARD", cand.cropRect, cand.columnas, "preciso");
            if (!result || r.foundItems.length > result.foundItems.length) { result = r; usado = { ...cand, preset: "STANDARD" }; }
            if (result.foundItems.length >= cand.minimo) break;
        }

        // Solo los RECORTES se agotan; los PRESETS de exposición no se prueban: son para la foto
        // de cámara y sobre captura directa no cambian nada (medido con el banco: STANDARD,
        // LOW_LIGHT y HIGH_GLARE leen lo mismo en las ocho capturas). Costaban 9 pasadas de
        // Tesseract donde bastan 3, justo cuando nada lee: el "a veces tarda muchísimo".
        if (!result?.foundItems.length) for (const cand of candidatos) {
            const r = await leeRecompensas(frame, width, height, scale, "STANDARD", cand.cropRect, cand.columnas, "clasico");
            if (!result || r.foundItems.length > result.foundItems.length) { result = r; usado = { ...cand, preset: "STANDARD" }; }
            if (result.foundItems.length >= cand.minimo) break;
        }
        if (usado && (usado.preset !== "STANDARD" || usado.nombre !== candidatos[0].nombre)) {
            console.log(`[REWARD] Leído con recorte "${usado.nombre}" y preset ${usado.preset}`);
        }
        const { rawOcr, namesRaw, foundItems, ocrCanvas, namesCanvas } = result;
        DebugRecorder.record({ kind: "recompensas", image: frame, overlay: ocrCanvas, meta: { resumen: `${foundItems.length} ítems`, recorte: usado, rawOcr, namesRaw, items: foundItems.map((i) => ({ name: i.name, owned: i.owned, crafted: i.crafted })) } });

        // Cachea el hash cuando este frame NO trajo ninguna recompensa: es lo que hace
        // funcionar el skip de arriba sobre una pantalla quieta que no lee nada.
        this.lastRewardNoResult = siguienteEstadoSinResultado(foundItems.length > 0, bandHash, Date.now());

        // La instantánea del panel de depuración se pinta AQUÍ y no en la lectura: services/ no
        // toca el DOM, y además así se ve el lienzo que ganó, no el último que se probó.
        const dbgPanel = document.getElementById("live-debug-snapshot");
        // Sin lienzo si el barrido barato no binarizó nada: el 1er candidato fija `result`
        // aunque lea 0 y ningún 0 posterior lo sustituye (la comparación es `>` estricta).
        if (dbgPanel?.style.display === "block" && ocrCanvas) {
            const debugImg = document.getElementById("live-debug-snapshot-img");
            if (debugImg) debugImg.src = ocrCanvas.toDataURL("image/jpeg", 0.85);
        }
        const cropUsado = usado?.cropRect || null;

        // xPos viene en coordenadas del RECORTE y renderBadges lo lee en las del FRAME entero,
        // así que hay que reproyectarlo con el MISMO origen y margen que usó
        // prepareRewardOCRCanvas: con cropRect variable, el width*0.08 fijo ya no es el offset.
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
        // La pasada de NOMBRES rescata los que el grayscale garblea; sin verla en el panel
        // no se puede diagnosticar cuál de las dos falló.
        addRewardDebugLog("OCR2", namesCanvas ? `Names: ${namesRaw.replaceAll(/\n+/g, " ").trim()}` : "Names: (skipped - noisy mask)", "info");
        addRewardDebugLog("SCAN", `Items found: ${foundItems.length}`, foundItems.length > 0 ? "match" : "warn");

        // Guard de contexto. Otras pantallas enseñan partes prime con la forma de una banda de
        // recompensas y disparan falsos positivos, y ahí la lógica es OTRA (en fin de misión las
        // piezas se suman, no se eligen). Se mira el recorte Y la cabecera: el título centrado
        // nunca cae dentro de la banda, y buscarlo en el recorte solo funcionaba de rebote
        // —pillaba el IMPORTANCE o el SEARCH— hasta que el recorte se ciñó al rótulo.
        const contextText = `${rawOcr} ${namesRaw} ${this.lastHeaderText || ""}`.toUpperCase();
        const NON_REWARD_TOKENS = [
            "MISSION COMPLETE", "MISION COMPLETADA", "MISIÓN COMPLETADA",
            "IMPORTANCE", "IMPORTANCIA", "SEARCH", "BUSCAR",
        ];
        // La cabecera descarta también: el panel "<Reliquia> - Possible Rewards" tiene la misma
        // forma que una banda, ningún token de arriba cae en su recorte y el latch tarda frames
        // en soltar REWARD, así que se ofrecían las recompensas POSIBLES de una reliquia.
        const ctxCabecera = VisionService.determineContext((this.lastHeaderText || "").toUpperCase());
        const badToken = NON_REWARD_TOKENS.find(t => contextText.includes(t))
            || (ctxCabecera === "RELICS" || ctxCabecera === "MISSION_COMPLETE" ? `cabecera ${ctxCabecera}` : null);
        if (badToken && foundItems.length > 0) {
            console.log(`[REWARD] Ignorado: pantalla fuera de contexto (token "${badToken}")`);
            addRewardDebugLog("CTX", `Skipped: end-of-mission screen detected ("${badToken}")`, "warn");
            return;
        }
        // Visto en vivo: al pasar de recompensas a FIN DE MISIÓN, la cabecera cacheada aún decía
        // "VOID FISSURE/REWARDS" y el panel de fin de misión (Akbolto Prime Receiver) abrió el modal
        // de elegir recompensa. Si el rótulo cambió y no se ha releído, se espera al siguiente tick.
        if (foundItems.length > 0 && this._cabeceraVigente === false) {
            console.log("[REWARD] Espera: el rótulo cambió y la cabecera aún no se ha releído");
            return;
        }

        if (foundItems.length > 0 && !this.detectionLocked) {
            foundItems.forEach(item => {
                const status = item.crafted ? "CRAFTED" : `${item.owned} OWNED`;
                addRewardDebugLog("ITEM", `${item.name} -> ${status}`, "match");
            });

            this.detectionLocked = true;
            // El MISMO frame que se leyó: así la foto y los badges se corresponden.
            ScannerModal.open(frame.toDataURL("image/jpeg", 0.85), foundItems, width, height, scale, rawOcr);
        }
    },

    async processInventoryGrid(snapshot, width, height, scale) {
        const reloj = cronometro("inventario");
        relojBadges.ms = 0; relojBadges.n = 0;
        if (this.detectionLocked) return;
        // Se suelta en TODAS las salidas menos la del modal (ese lo suelta al cerrarse): si se fuga,
        // el `return` de arriba tira cada página encolada y fuera del inventario processFrame() ni arranca.
        this.detectionLocked = true;

        try {
            // Rejilla POR PÁGINA (~60 ms): cacheada por resolución se quedaba anclada donde paró la
            // primera y el scroll no para en múltiplos de celda (filas de 15 y 100 px en vivo).
            // La caché queda de respaldo para una página sin señal.
            const calibKey = `${width}x${height}`;
            let calibData = VisionService.detectGridAutoCalib(snapshot, width, height);
            const reciennacida = !!calibData; // detectada en ESTE frame, no heredada de otra página
            if (calibData) {
                this._autoCalibCache = { key: calibKey, calib: calibData };
            } else if (this._autoCalibCache?.key === calibKey) {
                calibData = this._autoCalibCache.calib;
                console.log("[INV] Auto-grid sin señal en esta página — uso la rejilla de la anterior.");
            }

            if (!calibData) {
                const saved = globalThis.LiveCalibration?.getGrid() || null;
                // La calibración manual adivina columnas por ratio de aspecto; una caja
                // mal dibujada da una rejilla basura (celdas enormes, zona sobre el panel
                // de venta) que parte ítems y badges. Preferimos no escanear a recortar mal.
                if (saved && isImplausibleFallbackGrid(saved, width, height)) {
                    console.warn(`[INV] Calibración manual guardada implausible (zona ${saved.gridZone?.w}x${saved.gridZone?.h}, celda ${saved.cellW}x${saved.cellH} sobre frame ${width}x${height}) — descartada; se reintentará auto-grid.`);
                } else if (saved) {
                    calibData = saved;
                    console.log("[INV] Auto-grid sin señal este frame — usando calibración manual guardada.");
                }
            }

            // Solo se comprueba la rejilla HEREDADA: la de este frame ya se corrobora sola, y si la ancló el color sus bandas no son las de bordes (rechazaba páginas buenas).
            const rejilla = calibData?.gridZone && { gridY: calibData.gridY ?? calibData.gridZone.y, cellH: calibData.cellH, rows: calibData.rows };
            if (!rejilla || (!reciennacida && !filasEnFase(VisionService.ultimasBandas, rejilla))) {
                console.warn(`[INV] Página saltada: ${rejilla ? "la rejilla no cae sobre los nombres" : "sin rejilla"} — se re-detecta.`);
                this._autoCalibCache = this._frameZoneCache = null;
                this.detectionLocked = false;
                return;
            }

            const { gridZone } = calibData;

            // Tema UNA vez por resolución: votarlo cuesta 64 ms por página y no cambia a mitad de sesión.
            let theme = this._temaCache?.key === calibKey ? this._temaCache.theme : null;
            if (!theme) {
                theme = VisionService.detectThemeFromSnapshot(
                    snapshot,
                    gridZone.x, gridZone.y, gridZone.w, gridZone.h
                );
                // Solo una detección REAL: el pseudo-tema neutro de abajo es un apaño para la
                // pestaña de reliquias y guardarlo lo arrastraría a las demás páginas.
                if (theme) this._temaCache = { key: calibKey, theme };
            }
            if (!theme) {
                // Pestaña de RELIQUIAS (o tinte de misión fuerte): en la zona del grid apenas hay
                // píxeles del acento del tema (todo es arte dorado + nombres blancos) y el peso
                // cae a ~0 → antes se saltaban TODOS los frames y el escáner "no funcionaba".
                // La binarización de nombres ya es independiente del tema (cropThemeBinarized
                // automide fondo/texto) y la cantidad se lee por brillo, así que un pseudo-tema
                // neutro brillante solo afecta al fallback de badge por color.
                theme = { name: "Neutral", r: 240, g: 240, b: 240, actualR: 240, actualG: 240, actualB: 240 };
                console.warn("[INV] Theme inconclusive — using neutral pseudo-theme (relics tab / tinted UI).");
            }
            console.log(`[INV] Theme detected: ${theme.name} (r:${theme.r} g:${theme.g} b:${theme.b})`);

            // 3. Auto-detect grid cell positions from theme pixel density
            await cedeHilo(); reloj.fase("rejilla+tema"); // detectar rejilla y votar tema, en tareas distintas
            // Las marcas ✓ fijan la fase mejor que los bordes (ver check_anchor.js): si discrepan, mandan.
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

            const debugCanvas = this._debugCvs ||= document.createElement("canvas"); // ~6 MB: se reutiliza
            if (debugCanvas.width !== gridZone.w) debugCanvas.width = gridZone.w;
            if (debugCanvas.height !== gridZone.h) debugCanvas.height = gridZone.h;
            const dCtx = debugCanvas.getContext("2d");
            dCtx.drawImage(snapshot, gridZone.x, gridZone.y, gridZone.w, gridZone.h, 0, 0, gridZone.w, gridZone.h);

            dCtx.strokeStyle = "rgba(0,229,255,0.4)";
            dCtx.lineWidth = 1;
            cellRects.forEach(cell => dCtx.strokeRect(cell.sx - gridZone.x, cell.sy - gridZone.y, cellW, cellH));

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

            const agInfo = `AG ${calibData.auto ? "auto" : "manual"} ${autoGrid.rows}r×${autoGrid.cols}c cell ${cellW}×${cellH} zone ${gridZone.x},${gridZone.y} dy ${autoGrid.phaseShift || 0}${calibData.traceSummary?.halfPitchFixed ? " HPfix" : ""}`;
            // El reset del log va ANTES del bucle de celdas: después perdía los "SKIPPED (empty)".
            this.lastRawOcrLog = [];
            this.lastRawOcrLog.push(`[AUTO-GRID] ${agInfo} · rowBands ${JSON.stringify(calibData.traceSummary?.rowBands || [])} · chain ${JSON.stringify(calibData.traceSummary?.chain || null)}`);
            // Al final de la lista la 1ª fila queda bajo la cabecera: se ve el nombre pero no el badge
            // (leía basura, "Trumna BDG 86"). A media fila pasa lo contrario: badges arriba y nombres
            // cortados abajo. Se salta la fila 0 solo si NINGUNA celda tiene badge y, además, o el HUD
            // medido para la sesión la tapa o la fila 1 sí tiene badges (en esa página se leen).
            const hud = this._frameZoneCache?.zone?.hud ?? -1;
            // Cada badge se lee UNA vez por página: la sonda y el bucle leían los mismos (~190 ms). Y solo
            // cuentan los PLAUSIBLES (1-3 cifras): bajo la barra de iconos salía "85603" y colaba.
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
            // Banda de NOMBRE: cubre 1, 2 y 3 líneas. Un recorte estrecho (0.76–0.97) clipaba la 1ª
            // línea de los de 3 y quedaba "Neuroptics Blueprint" (ambiguo). El arte que entre por
            // arriba lo rechaza el aislado por COLOR DE TEXTO, no la geometría.
            const textSrcY = Math.round(cellH * 0.50);
            const textSrcH = Math.round(cellH * 0.48);

            // Las celdas se recortan justo antes de leer (ring en vision.service): guardar las 18
            // máscaras (~1,4 MB cada una a 3x) hasta el OCR se iba a cientos de MB página tras página.

            // Trazas de progreso: un cuelgue entre "scanning" y "done" dejaba el HUD sin pista de dónde.
            console.log(`[INV] Preparadas ${activeCells.length} celdas activas; arrancando worker OCR...`);
            if (rejillaConClasico()) await OCRRepository.ensureWorkers(activeCells.length);
            const workers = OCRRepository.workers.filter(Boolean);
            console.log(`[INV] Workers OCR listos: ${workers.length}`);

            // UN color de texto para toda la SESIÓN (caché por resolución): medirlo por celda es un
            // empate a suerte entre el nombre y el arte (ver utils/name_color.js).
            let pageNameColor = this._nameColorCache?.key === calibKey ? this._nameColorCache.color : null;
            if (pageNameColor) this.lastRawOcrLog.push(`[NAME-COLOR] rgb(${pageNameColor.join(",")})`);

            // Partes prime PENDIENTES de confirmar: una página es de un solo tipo, y en una de
            // reliquias una "parte" suelta es una celda ilegible rellenada por el matcher difuso
            // (así entraron "Jahu" y "Forma Blueprint" desde celdas de reliquia).
            const pendingItems = [];

            const { drawResolved: drawResolvedCell, drawFailed: drawFailedCell } =
                createCellOverlay(dCtx, gridZone, cellW, cellH);

            // MOTOR PRECISO: las bandas de nombre de TODA la página se leen de una sola pasada
            // (ver PaddleRepository.recognizeStripWords). Antes iba celda a celda y cada llamada
            // pagaba entera la red de detección: 889 ms frente a 209. Si falla, se va celda a celda.
            const bandaY = Math.round(cellH * 0.50), bandaH = Math.round(cellH * 0.48);
            const clave = (cell) => `r${cell.r}c${cell.c}`;
            let lotePreciso = null;
            if (motorActivo() === MOTOR_PRECISO) {
                const tiras = activeCells.map(({ cell }) =>
                    ({ clave: clave(cell), sx: cell.sx, sy: cell.sy + bandaY, sw: cellW, sh: bandaH }));
                await cedeHilo(); // el montaje de las 18 tiras se dibuja de una vez
                lotePreciso = await PaddleRepository.recognizeStripWords(snapshot, tiras)
                    .catch((e) => { console.warn("[Paddle] lote falló, voy celda a celda:", e); return null; });
            }

            // Elegirlo cuesta hasta 6 lecturas de Tesseract (~1-2 s en la 1ª página, la que el usuario
            // espera). Con el lote del preciso solo lo usan los respaldos (6 celdas en 30 páginas,
            // medido), así que se elige en el primero que lo pida; sin lote lo necesita la máscara de
            // cada celda y va antes del bucle.
            let eleccion = pageNameColor && Promise.resolve();
            const colorDeNombre = () => eleccion ||= (async () => {
                await cedeHilo(); // la rejilla y el voto de color son los dos bloques largos de la 1ª página
                // La lectura manda sobre el color del auto-grid: ese sale de contar píxeles.
                pageNameColor = await electPageNameColor(workers[0], snapshot, activeCells, cellW, textSrcY, textSrcH, theme)
                    || calibData?.nameColor || null;
                if (pageNameColor) this._nameColorCache = { key: calibKey, color: pageNameColor };
                this.lastRawOcrLog.push(`[NAME-COLOR] ${pageNameColor ? `rgb(${pageNameColor.join(",")})` : "ninguno — cada celda mide el suyo"}`);
            })();
            if (!lotePreciso) await colorDeNombre();

            // Cabecera: un pantallazo del debug se autoexplica (rejilla, zona y color). Va ANTES de las
            // celdas porque la píldora x{n} de la fila 0 cae encima; lleva el color con el que ARRANCA la
            // página: el elegido a mitad (modo preciso) queda en el log [NAME-COLOR] y en colorNombre.
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
                    await cedeHilo(); // la máscara de cada celda es síncrona (~70 ms) y encadenadas congelaban la página

                    console.log(`[INV] celda ${cellIndex}/${activeCells.length} (r${task.cell.r}c${task.cell.c})...`);

                    const { cell } = task;
                    // La máscara binarizada del nombre es PEREZOSA: cuesta el 49% del escaneo de
                    // una página (medido, 1207 ms de 2471 para 18 celdas) y el motor preciso no
                    // la usa —lee el color directo—, así que solo se calcula si hace falta: por
                    // la vía clásica, o cuando el lote no trajo esa celda, o al caer al respaldo.
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

                    // Guardia de riven ANTES de matchear: el nombre de un riven ("VULKAR CRITACAN",
                    // "RIFLE RIVEN MOD") puede matchear difusamente contra un prime part y colarse
                    // en el inventario como falso positivo. Los rivens tienen su propio pipeline.
                    if (this._isRivenCellText(combinedText)) {
                        this.lastRawOcrLog.push(logStr + " || RIVEN (ignored in inventory grid)");
                        continue;
                    }

                    // itemText/relicText = la lectura que REALMENTE produjo el match: el overlay de
                    // debug pintaba siempre la 1ª pasada y con el match del fallback no casaba con la card.
                    let relicText = combinedText, itemText = combinedText;
                    const readable = !this._isGarbledCellText(combinedText);
                    let relicMatch = readable ? OCRService.getRelicMatch(combinedText) : null;
                    if (relicMatch && textoDelLote) { // 5/6 del código por el glifo (utils/vision/relic_digit_56.js)
                        const r = corrige56(relicMatch, PaddleRepository.palabrasDelLote(clave(cell)), PaddleRepository.recorteDelLote(clave(cell)), (n) => !!globalThis.state?.allRelicNames?.includes(n));
                        if (r.cambiado) { logStr += ` || 5/6 por glifo: ${r.nombre}`; relicMatch = r.nombre; }
                    }
                    let bestItem = (readable && !relicMatch) ? OCRService.getValidItemMatch(combinedText) : null;
                    let fallbackText = null;

                    // Sin match en la banda normal se prueba la ventana 73%-99%.
                    if (!bestItem && !relicMatch) {
                        await colorDeNombre(); // los tres respaldos de este bloque lo usan
                        const fallbackY = Math.floor(cellH * 0.73);
                        const fallbackH = Math.floor(cellH * 0.26);
                        const fullCellCvs = VisionService.cropThemeBinarized(snapshot, cell.sx, cell.sy + fallbackY, cellW, fallbackH, theme, pageNameColor);
                        fallbackText = await OCRService.extractCellText(worker, fullCellCvs);
                        if (fallbackText && fallbackText.length) {
                            logStr = `[r${cell.r}c${cell.c}] OCR (fallback): ${fallbackText.join(" ")}`;
                            // Esta ventana mide su color sobre otra franja y puede binarizar el arte: mismo filtro de ilegible.
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

                    // Con SU color antes de rendirse: el de la página lo vota el conjunto y puede no aislar esta card.
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

                    // Tres líneas con el arte encima del mismo color: se relee cortando por arriba.
                    if (!bestItem && !relicMatch) {
                        const r = await readCellCuttingArt(worker, snapshot, cell, cellW, textSrcY, textSrcH, theme, pageNameColor, (ws) => !this._isGarbledCellText(ws));
                        if (r) { relicMatch = r.relicMatch; bestItem = r.bestItem; if (relicMatch) relicText = r.words; else itemText = r.words; logStr = `[r${cell.r}c${cell.c}] OCR (sin arte, corte ${r.corte}): ${r.words.join(" ")}`; }
                    }

                    // Fallback con PaddleOCR (opt-in: globalThis.OCR_PADDLE_FALLBACK)
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
                        // NO se apunta todavía: una parte prime solo cuenta si la PÁGINA no
                        // resulta ser de reliquias (ver el commit tras el Promise.all).
                        pendingItems.push({ cell, bestItem, qtyResult, itemText, logStr });
                    } else if (relicMatch) {
                        scanStats.relics++;
                        // Misma lectura que los prime items, pero votando en los maps de
                        // reliquias (no se mezcla con sessionInventory).
                        const qtyResult = await badgeDe(cell);

                        // Indica qué lectura matcheó la reliquia (la original o la del fallback).
                        const relicSrc = relicText === combinedText ? "1st-pass" : "fallback";
                        logStr += ` || RELIC (${relicSrc}): ${relicMatch} || BDG: ${qtyResult.raw}`;
                        this.lastRawOcrLog.push(logStr);

                        this.recordQtyVote(relicMatch, qtyResult, this.relicQtyVotes, this.sessionRelics);

                        // Acento CIAN para distinguir de un vistazo una reliquia de una parte prime.
                        drawResolvedCell({
                            cell, name: relicMatch, qtyResult, text: relicText, accent: "#00e5ff",
                            qty: this.sessionRelics.get(relicMatch) ?? "?",
                        });
                    } else {
                        // Segunda oportunidad de la guardia de riven: la primera lectura pudo salir
                        // ruidosa y solo el OCR de celda completa (fallbackText) revela "RIVEN".
                        if (this._isRivenCellText(fallbackText)) {
                            // Riven detectado: solo loguear, no registrar como UNMATCHED ni agregarlo al inventario
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

                            // Sobre el arte se pinta EL RECORTE BINARIZADO que se le pasó al OCR:
                            // el fallo solo existe en el frame en vivo (la captura de escritorio
                            // del mismo inventario binariza limpia), así que el overlay tiene que
                            // enseñar la ENTRADA real del OCR y no la pantalla del juego.
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
                // Con Paddle se serializa a 1: el servicio ONNX es único y no es seguro llamarlo
                // en paralelo. La señal es si SU LOTE salió, no la preferencia de motor: elegido
                // pero CAÍDO significa leer con Tesseract, y ahí hay que repartir. Mirando
                // la preferencia se quedaba en un worker y las 18 celdas costaban 3793 ms.
                const maxWorkers = lotePreciso ? 1 : workers.length;
                const activeWorkerCount = Math.min(maxWorkers, activeCells.length);
                for (let w = 0; w < activeWorkerCount; w++) {
                    workerPromises.push(runWorker(workers[w]));
                }
                await Promise.all(workerPromises);
                reloj.fase("celdas");
                // Qué motor leyó DE VERDAD: con el preciso caído lee el clásico.
                const motorReal = lotePreciso ? "paddle" : `tesseract x${workers.length}`;
                reloj.fin(`${motorReal} · ${relojBadges.n} badges ${relojBadges.ms.toFixed(0)} ms`);

                // Commit de las partes prime pendientes, ya con la página entera vista.
                // Si la mayoría de celdas casaron RELIQUIA, la página es la pestaña de
                // reliquias y las partes prime sueltas son celdas mal leídas: se descartan
                // en vez de apuntarse. El mínimo de 3 evita decidir con ruido, y exigir el
                // DOBLE que ítems deja pasar una página normal de partes prime (0 reliquias).
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
                    // Consenso temporal: la lectura de un frame es frágil (dígito ~15px), pero
                    // el nombre del ítem es fiable. Acumulamos votos de cantidad por ítem a lo
                    // largo de los frames y guardamos la MODA. Así los errores aleatorios de un
                    // frame se diluyen y la cantidad final es robusta.
                    this.recordQtyVote(pending.bestItem.originalName, pending.qtyResult);
                    drawResolvedCell({
                        cell: pending.cell, qtyResult: pending.qtyResult, text: pending.itemText,
                        accent: "#00ff78",
                        name: pending.bestItem.originalName.replace(/Prime/gi, "").trim(),
                        // Cantidad de CONSENSO (moda entre frames), no la del frame único.
                        qty: this.sessionInventory.get(pending.bestItem.originalName) ?? "?",
                    });
                }

                ScannerHUD.updateScrollStatus("done", this.sessionInventory.size + this.sessionRelics.size);
                ScannerHUD.updateDetectedItems(this.sessionInventory, this.sessionRelics);
                if (DucatKioskService.esKiosco(this.lastHeaderText)) this.onPaginaKiosco?.();

                // Summary del escaneo: en teoría cada página completa rinde rows×cols celdas
                // (18 en 6×3). Si hay celdas sin match/sin OCR o el realineo de fase descartó
                // filas parciales, la entrada se marca como WARNING (borde rojo en el historial).
                const expected = autoGrid.rows * autoGrid.cols;
                const fails = scanStats.unmatched + scanStats.none;
                const hasWarning = fails > 0 || scanStats.cells < expected;
                const summary = `cells ${scanStats.cells}/${expected} · match ${scanStats.matched}`
                    + ` · relic ${scanStats.relics} · empty ${scanStats.empty} · fail ${fails}`
                    + (scanStats.ownColor ? ` · own-color ${scanStats.ownColor}` : "")
                    + (autoGrid.phaseShift ? ` · dy ${autoGrid.phaseShift > 0 ? "+" : ""}${autoGrid.phaseShift}px` : "");
                this.lastRawOcrLog.push(`[SUMMARY] ${summary}`);
                DebugRecorder.record({ kind: "inventario", image: snapshot, overlay: debugCanvas, log: this.lastRawOcrLog, meta: { resumen: summary, rejilla: { rows: autoGrid.rows, cols: autoGrid.cols, cellW, cellH, zone: gridZone, dy: autoGrid.phaseShift || 0, auto: !!calibData.auto }, tema: theme?.name ?? theme ?? null, colorNombre: pageNameColor, hud, filaTapada, celdas: cellRects.map((c) => ({ r: c.r, c: c.c, sx: c.sx, sy: c.sy })) } });

                // El color de página se cachea para toda la SESIÓN, así que una elección mala se
                // arrastraba página tras página. Si media página ha tenido que rebinarizar con su
                // propio color, ese color no vale: se tira y la siguiente página vuelve a elegir.
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
                    // La ZONA también: con el recorte mal cacheado, re-detectar dentro de él repite el fallo.
                    this._frameZoneCache = null;
                    // El tema también: alimenta todas las máscaras por color, así que uno
                    // equivocado da exactamente este síntoma y se quedaría para toda la sesión.
                    this._temaCache = null;
                }

                // La imagen SOLO con el panel abierto: costaba ~1,9 GB (toDataURL de la rejilla
                // entera por página + 10 <img> que el navegador decodifica aunque estén ocultas).
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
                // Sin esto el HUD se queda en "scanning" para siempre cuando el escaneo
                // revienta a mitad: el "done" vive al final del try y nunca se alcanza,
                // así que el usuario ve un cuelgue en vez del error.
                ScannerHUD.updateScrollStatus("done", this.sessionInventory.size + this.sessionRelics.size);
            } finally {
                this.detectionLocked = false;
            }

        } finally {
            this.detectionLocked = false;
        }
    },

    // Heurística de riven sobre las palabras OCR de una celda del grid de inventario:
    // "RIVEN" explícito o "MOD" + clase de arma ("RIFLE RIVEN MOD" velado, aunque el OCR
    // pierda la palabra RIVEN). Los rivens revelados sin "RIVEN" legible ("VULKAR CRITACAN")
    // no se pueden distinguir por keyword; el sufijo inventado rara vez matchea un ítem real.
    // ¿La lectura de una celda es TEXTO o ruido binarizado? El nombre más largo del juego son 4
    // palabras y una reliquia 3, así que 9 tokens es basura. Vistos en vivo: "HEJO . YE : L 5, -
    // AL 5 ER . OT NE WL" se apuntó como "Neo W1", y "OO BN TO TI A I - -AF A IP FR LE BOO SE PE
    // EARN" como "Forma Blueprint". Se marca ilegible y el frame siguiente lo reintenta.
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
    // Con el panel cerrado no se veía y corría igual: 4-8 entradas cada 400 ms, y cada una con un
    // `scrollTop = scrollHeight` que fuerza el reflow de la página entera.
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