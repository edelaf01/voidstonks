import { VisionService } from "./vision.service.js";
import { freezeFrame, releaseFrame } from "../../utils/vision/frame_freeze.js";
import { nextLatchedContext, INITIAL_LATCH } from "../../utils/vision/context_latch.js";
import { isImplausibleFallbackGrid } from "../../utils/vision/plausibility.js";
import { localizaBandaRecompensas, candidatosDeRecorte, recorteDelRotulo } from "../../utils/vision/reward_band.js";
import { leeRecompensas } from "./reward_read.service.js";
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
import { detectRewardCells } from "../../utils/vision/mission_complete_grid.js";
import { nextLedger, INITIAL_LEDGER } from "../../utils/inventory/reward_ledger.js";
import { createFrameQueue } from "../../utils/vision/frame_queue.js";
import { videoRegionHash, smallCanvasHash, compareHashes } from "../../utils/vision/frame_hash.js";
import { rivenFingerprint } from "../../utils/rivens/riven_naming.js";
import { labelFullyRead } from "../../utils/vision/name_lines.js";
import { collectWords } from "../../utils/vision/ocr_words.js";
import { hasComponentSiblings } from "../../utils/inventory/component_siblings.js";
import { olvidaColorTexto } from "../../utils/vision/reward_preprocess.js";

export const ScannerService = {
    isScanning: false,
    scanInterval: null,
    currentRate: 1200,
    RIVEN_RATE_ACTIVE: 400, // sin resultado mostrado aún, o el hash cambió: escanea rápido
    RIVEN_RATE_IDLE: 1000, // ya hay resultado y la pantalla está estática (hash-skip disparando): relaja el poll
    sessionInventory: new Map(),
    sessionRelics: new Map(), // relicName -> qty de consenso (fallback de reliquias en el grid de inventario)
    _autoCalibCache: null, // rejilla autodetectada cacheada { key: "WxH", calib } — detectar cuesta un frame completo
    _nameColorCache: null, // color del texto de los nombres { key: "WxH", color } — el tema no cambia a mitad de sesión
    _frameZoneCache: null, // zona de la rejilla EN COORDENADAS DEL FRAME { key: "WxH", zone } — para recortar al encolar
    _invQueue: null,       // cola de páginas pendientes de OCR (utils/frame_queue.js)
    detectionLocked: false,
    scanCounter: 0,
    inventoryHasScanned: false,
    qtyVotes: new Map(), // itemName -> Map<qty, count> (consenso de cantidad entre frames)
    relicQtyVotes: new Map(), // relicName -> Map<qty, count> (mismo consenso, pero para reliquias)
    lastStableHash: null,
    virtualCanvas: null,
    lastHashL: null,
    lastHashR: null,
    lastNoResultHash: null, // último hash de cartas que NO produjo ningún parse válido (evita re-OCRear en bucle una pantalla estática que no parsea)
    lastNoResultTime: 0, // cuándo se cacheó — el skip caduca a los 3s (auto-recuperación tras fades)
    lastHeaderHash: null, // hash de la franja del header EN EL ÚLTIMO OCR real (baseline fijo: no se actualiza en frames skipeados, para que el drift acumulado dispare re-OCR)
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
        this.lastNoResultHash = null;
        this.lastNoResultTime = 0;
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
        // El 2º worker Tesseract NO se precalienta aquí: es una instancia WASM completa
        // (~40-60MB) y arrancar el escáner no implica que vaya a hacer falta — sólo lo usan
        // las pantallas de recompensas, el grid de inventario y el reroll de 2 cartas.
        // Cada uno de esos puntos llama a ensureSecondWorker() justo antes de necesitarlo y
        // cae a workers[0] si aún no está listo, así que crearlo aquí sólo adelantaba RAM
        // que en una sesión de sólo-rivens no se llega a usar nunca.
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
    // Estado de la histéresis, entero: lo produce y consume context_latch.js.
    ctxLatch: INITIAL_LATCH,
    lastRivenContextTime: 0,

    async processFrame(video, virtualCanvas) {
        if (this.detectionLocked) return;
        // Si la sesión se detuvo (p.ej. el stream terminó y stop() ya llamó a
        // terminateAll), no toques los workers: evita recognize sobre un worker
        // muerto → "Cannot read properties of null (reading 'postMessage')".
        if (!this.isScanning) return;
        this.scanCounter++;

        const dims = VisionService.prepareVirtualCanvas(video, virtualCanvas);

        const worker1 = OCRRepository.workers[0];
        if (!worker1) return;

        // Skip del OCR de cabecera por hash: OCRear el header cada tick era el mayor consumo
        // fijo de CPU. Tres protecciones contra la "ceguera de contexto":
        //  - tolerancia ESTRICTA (6, no 18): el título es texto fino y con 18 el cambio
        //    gameplay->recompensas quedaba por debajo, reutilizando texto basura.
        //  - baseline anclado al último frame OCREADO: si no, un fade gradual nunca re-OCR.
        //  - TTL de 2.5s: acota cualquier colisión de hash (la pantalla dura ~10s).
        const headerHash = smallCanvasHash(virtualCanvas);
        const headerCacheFresh = this.lastHeaderOcrTime && (Date.now() - this.lastHeaderOcrTime < 2500);
        let headerText;
        if (this.lastHeaderText !== null && headerCacheFresh && compareHashes(headerHash, this.lastHeaderHash, 6)) {
            headerText = this.lastHeaderText;
        } else {
            // Solo cuando el header cambió: detección de tema + umbralizado (finalize) y OCR.
            const headerTheme = VisionService.finalizeVirtualCanvas(virtualCanvas);
            const { data: headerData } = await OCRRepository.recognize(worker1, virtualCanvas, {}, { text: true });
            headerText = headerData.text || "";

            // Segundo intento si el primero no dio contexto: re-binariza el header por
            // distancia estricta al color del tema. Cubre el caso "header del tema sobre
            // fondo claro" (recompensas con cielo rojo/rosa) donde la K-means invierte la
            // clasificación y el OCR sale basura. Coste acotado: solo en frames cuyo header
            // cambió Y no matchearon contexto, sobre el mismo canvas pequeño del header.
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

            // Tercer intento: el título CENTRADO. MISSION COMPLETE no cae en el recorte
            // izquierdo (de ahí sale "WARFRAME MIS"), así que sin esta pasada esa pantalla
            // es invisible para el escáner. Va la última porque solo la necesita ella.
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
            this.lastHeaderHash = headerHash; // baseline = frame OCReado (evita drift)
            this.lastHeaderOcrTime = Date.now();
        }

        const rawContext = VisionService.determineContext(headerText);
        const now = Date.now();

        // Check if header contains Riven/Mods anchors (English and Spanish equivalents).
        // OJO: "INVENTORY"/"INVENTARIO" NO son anclas de rivens — la pantalla de venta de
        // prime parts tiene el header "INVENTORY/SELL", y meterlas aquí forzaba el grace
        // period de rivens (INVENTORY → INVENTORY_MODS), enrutando el inventario normal al
        // OCR de rivens y provocando el flip-flop que cerraba/reabría el escáner.
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

        let routedContext = rawContext;

        // Apply 8-second grace period for Riven/Mods context. Re-enruta al MISMO tipo de contexto
        // riven que produjo el último hit: el popup Item Details usa OTRO recorte que el reroll, y
        // remapear siempre a INVENTORY_MODS haría OCR sobre la zona equivocada durante la gracia.
        if (this.lastRivenContextTime && (now - this.lastRivenContextTime < 8000)) {
            if (rawContext === "UNKNOWN" || rawContext === "INVENTORY") {
                routedContext = this.lastRivenContextType || "INVENTORY_MODS";
            } else if (rawContext === "RELICS" || rawContext === "REWARD") {
                // Navigated away: immediately cancel grace period
                this.lastRivenContextTime = 0;
            }
        }

        // La histéresis vive en utils/vision/context_latch.js (pura y con test).
        this.ctxLatch = nextLatchedContext(this.ctxLatch, routedContext);
        // El color del texto solo puede cambiar con la pantalla: se recalcula al cambiar de
        // contexto, no en cada frame.
        if (this.ctxLatch.latched !== this.latchedContext) olvidaColorTexto();
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
        await this.routeFrameAction(this.latchedContext, video, dims);

        ScannerHUD.updateFrameCounter(this.scanCounter);
    },

    // Registra un voto de cantidad para un ítem y actualiza sessionInventory con la MODA.
    // Solo cuentan lecturas EXITOSAS (raw con dígito): una lectura fallida devuelve qty=1
    // con raw vacío ("Ø"), y contarla contaminaría el consenso con falsos "1".
    // votesMap/targetMap son opcionales para reutilizar el mismo consenso con las reliquias
    // (relicQtyVotes/sessionRelics) sin duplicar la lógica.
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
                // Margen vertical: el realineo de fase por scroll (_applyRowPhase) mira
                // píxeles justo por encima y por debajo de la zona. Recortar al ras se los
                // lleva y una fila a medias se pierde sin avisar. Un cuarto de celda basta
                // y son ~1 MB más.
                const m = Math.round((calib.cellH || 0) * 0.25);
                const y = Math.max(0, zone.y - m);
                zone = { ...zone, y, h: Math.min(dims.height - y, zone.h + m + (zone.y - y)) };
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

        const readOk = /\d/.test(qtyResult.raw || "");
        if (readOk) {
            votes.set(qtyResult.qty, (votes.get(qtyResult.qty) || 0) + 1);
        }

        // Cantidad de consenso = la más votada. Si aún no hay ningún voto válido,
        // dejamos la lectura actual (mejor que nada) hasta que llegue un frame bueno.
        const consensus = this.modeQty(votes);
        targetMap.set(itemName, consensus !== null ? consensus : qtyResult.qty);
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

    autoScrollHash: null,
    autoScrollStableTimer: null,
    lastFrameHash: null,
    scrollDirectionAccumulator: 0,
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
        ScannerHUD.updateContext(contextType);

        // La pausa en misión no tiene cabecera propia: cae en UNKNOWN, o en RELICS cuando la fila de reliquias del squad entra en el recorte del header.
        if ((contextType === "UNKNOWN" || contextType === "RELICS") && await SquadService.probe(video)) return;

        if (contextType === "INVENTORY") {
            if (!globalThis.state.autoScanEnabled) {
                this.currentRate = 3000; // 3 seconds idle check when autoScan is disabled
                this.autoScrollHash = null;
                this.lastFrameHash = null;
                this.sawScrollSinceScan = false;
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
            // minError se usa también FUERA del if (en el cálculo de isScrolling): declararla
            // dentro del bloque la dejaba fuera de scope y rompía el loop con ReferenceError.
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

            // Screen is scrolling if there is a clear vertical shift OR a massive whole-frame change (MSE > 80)
            const isScrolling = (bestDy !== 0 && minError < mseZero - 5) || mseZero > 80;

            if (isScrolling) {
                // Screen is currently in motion (user is scrolling)
                this.scrollDirectionAccumulator += bestDy;
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
            const hasPageChanged = !this.autoScrollHash || this.sawScrollSinceScan || Math.abs(currentHash - this.autoScrollHash) >= 120;
            const isFirstScan = !this.autoScrollHash;

            if (hasPageChanged && !this.autoScrollStableTimer && this._canCapturePage) {
                // Ignorar el auto-scan solo con scroll hacia ARRIBA claro (acumulador <= -3):
                // bestDy es ruidoso en scrolls rápidos (grid periódico vertical) y con el umbral
                // anterior (< 0) un -1 espurio tras bajar de página se comía el escaneo.
                if (!isFirstScan && this.scrollDirectionAccumulator <= -3) {
                    // It was an upward scroll. Ignore auto-scan.
                    this.scrollDirectionAccumulator = 0;
                    this.sawScrollSinceScan = false;
                    this.autoScrollHash = currentHash; // Mark as done to prevent repeat triggers
                    ScannerHUD.updateScrollStatus("done", this.sessionInventory.size + this.sessionRelics.size);
                    return;
                }

                ScannerHUD.updateScrollStatus("detected"); // Show stabilizing message

                // Wait 800ms of continuous stability before capturing & scanning for premium, instant responsiveness!
                this.autoScrollStableTimer = setTimeout(async () => {
                    this.scrollDirectionAccumulator = 0;
                    // Se limpia AQUÍ (no tras el OCR): si el usuario vuelve a hacer scroll
                    // durante el escaneo, el flag se re-activa y la página nueva se escanea.
                    this.sawScrollSinceScan = false;
                    if (!globalThis.state.autoScanEnabled || !this._canCapturePage) {
                        this.autoScrollStableTimer = null;
                        return;
                    }

                    const v = document.getElementById("live-video");
                    // Canvas REUTILIZADO entre escaneos: crear uno nuevo por escaneo dejaba a
                    // merced del GC un buffer del tamaño COMPLETO del stream (14 MB a 1440p,
                    // 32 MB a 4K), y el auto-scroll escanea una página tras otra, así que se
                    // acumulaban más rápido de lo que el recolector los liberaba → la pestaña
                    // acababa cayendo por memoria. Reasignar el mismo canvas reusa el buffer.
                    if (!this._invSnapshot) this._invSnapshot = document.createElement("canvas");
                    const snapshot = this._invSnapshot;
                    if (snapshot.width !== v.videoWidth || snapshot.height !== v.videoHeight) {
                        snapshot.width = v.videoWidth; snapshot.height = v.videoHeight;
                    }
                    snapshot.getContext("2d", { willReadFrequently: true }).drawImage(v, 0, 0);

                    // La foto se ENCOLA y el OCR va por detrás. Cola llena ⇒ no se marca el
                    // hash: la página sigue como no vista y se reintenta, en vez de perderse.
                    if (this.enqueueInventoryPage(snapshot, dims)) this.autoScrollHash = currentHash;
                    this.autoScrollStableTimer = null;

                }, 800);
            } else if (!this.autoScrollStableTimer) {
                // Screen is stable, and we've already scanned this page (or there is no active timer).
                // Safely clear accumulator and immediately restore visual "done" status to prevent HUD from sticking!
                this.scrollDirectionAccumulator = 0;
                ScannerHUD.updateScrollStatus("done", this.sessionInventory.size + this.sessionRelics.size);
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
            this.currentRate = 600;
            await RelicScreenService.process(video, dims);
        } else if (contextType === "MISSION_COMPLETE") {
            if (globalThis.RivenScannerHUD) globalThis.RivenScannerHUD.dismiss();
            // El run se acabó: el panel seguía prometiendo reliquias de una misión terminada.
            if (globalThis.state?.squadRun) SquadService.clear();
            // La pantalla se queda hasta que el usuario pulse continuar, así que no hace falta
            // correr: el ritmo lo marca el consenso de 2 lecturas iguales, no la prisa.
            this.currentRate = 800;
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
            // UNKNOWN: el popup "Item Details" de un riven linkeado (desde el chat/mercado) no
            // tiene header arriba-izquierda, así que el contexto cae aquí. Test de PÍXEL barato
            // (proporción de texto lavanda en el rect del popup) antes de gastar un OCR: si pasa,
            // se intenta el escaneo de riven con el recorte del popup; el parser valida (arma +
            // stats + confianza) y descarta cualquier falso positivo del arte.
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

        // Umbral para huecos entre BORDES (no centros): mucho menor que el 7% original, que estaba
        // calibrado para distancias entre centros de palabra. El hueco de borde real entre dos
        // cartas lado a lado es ~4-6% del ancho del recorte, y con 7% no se separaban nunca
        // (realGroups=1 → texto de ambas cartas entrelazado → no parse). Las continuaciones de
        // línea de una carta única (el split fantasma) tienen huecos de borde casi nulos (~1%),
        // así que 3% mantiene margen por ambos lados; y si aun así se partiera mal, la red de
        // seguridad del texto completo en processRivenCard lo rescata.
        const gapThresh = Math.max(canvasWidth * 0.03, 40);
        // Cluster por hueco entre BORDES (x0 del siguiente menos el x1 máximo visto), NO entre
        // centros: las palabras de continuación de línea de la MISMA carta (texto envuelto:
        // "Croni-", "(x2 for", "Cold") quedan pegadas al borde derecho del bloque —hueco de borde
        // pequeño— pero sus CENTROS caen lejos de los centros del resto y con el corte por centros
        // formaban un grupo de anclas fantasma que partía una carta única en 2 "columnas" (ninguna
        // parseaba). Dos cartas reales lado a lado sí dejan un hueco de borde >= gapThresh.
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
            return;
        }

        // Skip OCR if this EXACT region already OCR'd to "no usable parse" last time. Sin esto, bajar
        // el poll a 400ms convierte una pantalla estática que no parsea (menú intermedio, transición,
        // etc.) en un bucle de OCR constante y redundante — cacheamos el hash "sin resultado" y lo
        // saltamos hasta que la imagen realmente cambie. CADUCA a los 3s: el primer OCR puede caer
        // en el fade-in de un popup (Item Details) y fallar, y el hash del fade casi completo queda
        // dentro del umbral del de la pantalla final — sin caducidad, ese fallo silenciaba la
        // pantalla buena para siempre. Reintentar cada 3s una pantalla estática cuesta casi nada.
        if (compareHashes(hash, this.lastNoResultHash) && (Date.now() - this.lastNoResultTime < 3000)) {
            return;
        }

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

            // Red de seguridad anti split fantasma: si el corte espacial devolvió >=2 "cartas" pero
            // MENOS de 2 parsean con arma (síntoma de que las continuaciones de línea de UNA carta
            // formaron su propio grupo y ninguna mitad es parseable), probamos el texto completo sin
            // split; si ESE sí parsea con arma, era una carta única mal partida y usamos ese parse.
            // GUARD: solo si como mucho UNA columna menciona el arma. Si el arma aparece en 2+
            // columnas es que el recorte contiene DOS cartas reales (una no parseó por ruido), y
            // colapsarlas al texto completo produce una QUIMERA que mezcla stats de ambas cartas
            // (p.ej. el Recoil de la derecha injertado en la carta izquierda). El nombre puede
            // llegar troceado ("Gotva Pri"), así que basta con la primera palabra del arma.
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

        // Cachea el hash de un frame que NO produjo parse válido (y descáchalo en cuanto haya uno):
        // es lo que hace funcionar el skip de arriba y evita OCRear en bucle a 400ms una pantalla
        // estática que no parsea (menú intermedio, transición, etc.). El log es importante: sin él,
        // un recorte mal calibrado falla UNA vez y el skip silencia todos los reintentos.
        if (!valids.length) {
            console.log(`[RIVEN OCR] sin parse válido en este frame (${contextType || "reroll"}) — se cachea el hash y no se reintenta hasta que la pantalla cambie`);
        }
        this.lastNoResultHash = valids.length ? null : hash;
        if (!valids.length) this.lastNoResultTime = Date.now();

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

        // Switching to a different weapon/riven should update immediately instead of waiting for the
        // 2/3 consensus (which exists to stabilize a noisy read of the SAME card, not to delay a
        // genuinely new one). Key off the set of weapon names: if it differs from what's shown, it's
        // a new card → show it on the first valid read. Same-weapon rerolls keep the consensus
        // stabilization (so jittery stat values don't flicker the display).
        // OJO: compara el set de armas ÚNICAS, no la lista con duplicados: con 2 cartas de la misma
        // arma mostradas ("Karak|Karak"), un frame parcial de 1 carta ("Karak") NO es un cambio de
        // arma — con join de duplicados daba true y disparaba dropExtra al instante, anulando toda
        // la histéresis 2→1 (el flicker 2↔1 que se quería arreglar).
        const newWeapons = [...new Set(valids.map(e => e.parsed.weaponName).filter(Boolean))].sort().join("|");
        const shownWeapons = [...new Set(shownCards.map(p => p.weaponName).filter(Boolean))].sort().join("|");
        let weaponChanged = newWeapons !== "" && newWeapons !== shownWeapons;

        // Anti-flip del matcher de armas: con un nombre de riven como "Croniignido" el matcher
        // alterna entre el arma real ("Gotva Prime") y una enganchada dentro del nombre ("Ignis")
        // en frames alternos, y el fast-path weaponChanged convertía ese ruido en un flip visible
        // por frame. Exigimos 2 lecturas CONSECUTIVAS con el MISMO set de armas nuevo antes de
        // aceptar el cambio; un cambio real de riven da 2 frames consistentes en <1s con el rate
        // ACTIVE, así que la percepción sigue siendo inmediata. Solo aplica si ya hay algo mostrado
        // (el primer resultado de la sesión debe salir al primer frame válido).
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

        // --- MERGE/UPGRADE por identidad (arma+rolls): si la lectura nueva es del MISMO riven que
        // el ya mostrado en esa posición, no la sobreescribimos sin más — nos quedamos con la MEJOR
        // lectura entre la mostrada y la nueva (_isBetterOrEqualRead: más stats matcheados o mayor
        // confianza). Así una lectura que recupera el curse tenue actualiza la carta, pero una
        // lectura peor (p.ej. curse perdido de nuevo) no pisa la buena ya mostrada. Si en esta
        // posición no llegó lectura nueva (rawX null), se conserva lo mostrado — esto es también
        // lo que preserva la carta "hermana" durante la histéresis 2→1 de arriba.
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
     *   4. consenso — dos lecturas idénticas, y la firma impide repetir el alta por frame
     */
    async processMissionComplete(video, dims) {
        const { width, height } = dims;
        const frame = this._mcFrameCvs = freezeFrame(video, width, height, this._mcFrameCvs);

        // La pantalla entra con una animación de barrido. Leer a media animación cuesta un
        // OCR entero para tirarlo, así que primero se comprueba que ya está quieta.
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

        // El tooltip de "N OWNED" tapa hasta dos casillas y leer así perdería en silencio la
        // pieza de debajo. Se espera: desaparece solo en cuanto el ratón se mueve.
        if (grid.occluded) return;

        const worker = OCRRepository.workers[0];
        if (!worker) return;

        if (!this._mcCellCvs) this._mcCellCvs = document.createElement("canvas");
        const items = [];
        for (const cell of grid.cells) {
            // Sin rótulo es una carta de mod: ahorra un OCR y quita falsos del catálogo.
            if (!cell.named) continue;
            VisionService.prepareMissionCompleteCellCanvas(frame, cell, grid.accent, this._mcCellCvs);
            const { data } = await OCRRepository.recognize(worker, this._mcCellCvs, {}, { text: true, blocks: true });
            const raw = (data.text || "").toUpperCase();
            // Celda a celda y no de una pasada al panel entero: así las palabras de una
            // recompensa no pueden mezclarse con las de la vecina y fabricar un nombre que
            // no está en pantalla.
            const match = OCRService.getValidItemMatch(raw);
            if (!match?.isPrime) continue;
            // Un plano de warframe con hermanos de componente ("Xaku Prime Blueprint" frente a
            // "Xaku Prime Neuroptics") puede ser el rótulo de al lado al que se le ha perdido la
            // línea del medio: son piezas distintas y por texto no hay forma de separarlas. La
            // tinta sí lo dice, así que se exige que lo leído explique el ancho de cada línea.
            // Solo se paga en esos nombres —168 del catálogo—; el resto no pasa por aquí.
            if (hasComponentSiblings(OCRService.cachedDbItems, match.originalName)) {
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
        if (commit?.length && typeof globalThis.commitMissionCompleteRewards === "function") {
            globalThis.commitMissionCompleteRewards(commit);
        }
    },

    async processRewards(video, dims) {
        const { width, height, scale } = dims;

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

        // Dos escaleras sobre el MISMO frame, de dentro a fuera: por recorte (la banda detectada
        // y el recorte calibrado fallan en capturas distintas, ver candidatosDeRecorte) y por
        // preset de binarización (exposición/reflejo). Se queda con la lectura de MÁS
        // recompensas, no con la primera que devuelva algo: una lectura de 1 no vale más que
        // otra de 4 por llegar antes.
        //
        // El coste está acotado por dónde se corta: con la lectura completa (tantos nombres como
        // cards contó la detección) se para en el primer intento, que es el caso normal; solo
        // cuando NADA lee se recorre la escalera entera.
        const PRESET_ORDER = ["STANDARD", "LOW_LIGHT", "HIGH_GLARE"];
        const candidatos = candidatosDeRecorte({ cropRect, columnas, cardCount },
            recorteDelRotulo(frame, width, height, null));
        let result = null, usado = null;
        for (const preset of PRESET_ORDER) {
            for (const cand of candidatos) {
                const r = await leeRecompensas(frame, width, height, scale, preset, cand.cropRect, cand.columnas);
                if (!result || r.foundItems.length > result.foundItems.length) { result = r; usado = { ...cand, preset }; }
                if (result.foundItems.length >= cand.minimo) break;
            }
            // Los RECORTES sí se agotan aunque la lectura vaya incompleta (el bucle de dentro):
            // ahí está la ganancia. Los PRESETS no: son para la exposición de una foto de
            // cámara y sobre captura directa no aportan nada — medido, mismo 133/135 y seis
            // pasadas de OCR menos. Se escalan solo cuando no se leyó NADA, que es su caso.
            if (result.foundItems.length > 0) break;
        }
        if (usado && (usado.preset !== "STANDARD" || usado.nombre !== candidatos[0].nombre)) {
            console.log(`[REWARD] Leído con recorte "${usado.nombre}" y preset ${usado.preset}`);
        }
        const { rawOcr, namesRaw, foundItems, ocrCanvas, namesCanvas } = result;

        // La instantánea del panel de depuración se pinta AQUÍ y no en la lectura: services/ no
        // toca el DOM, y además así se ve el lienzo que ganó, no el último que se probó.
        const dbgPanel = document.getElementById("live-debug-snapshot");
        if (dbgPanel?.style.display === "block") {
            const debugImg = document.getElementById("live-debug-snapshot-img");
            if (debugImg) debugImg.src = ocrCanvas.toDataURL("image/jpeg", 0.85);
        }
        const cropUsado = usado?.cropRect || null;

        // xPos llega en coordenadas del RECORTE de OCR (prepareRewardOCRCanvas: recorta un
        // marginX por lado y escala ×scale). El modal (renderBadges) lo interpreta en el
        // espacio del FRAME COMPLETO ×scale, así que sin remapear los badges caían desplazados
        // por el offset del margen. Reproyectamos a frame-completo×scale — usando el MISMO
        // origen (cropRect.x, o 0 si no hubo detección) y margen que usó prepareRewardOCRCanvas,
        // no el % fijo de antes: con cropRect variable, width*0.08 ya no es el offset real.
        const rMarginX = cropUsado ? Math.floor(cropUsado.w * 0.06) : Math.floor(width * 0.08);
        const rCropXBase = cropUsado ? Math.floor(cropUsado.x) : 0;
        const rCropW = (cropUsado ? cropUsado.w : width) - rMarginX * 2;
        const rOcrW = ocrCanvas.width || 1;
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

        // Guard de contexto: la pantalla de FIN DE MISIÓN muestra partes prime en su grid
        // de botín dentro de la misma banda de recorte y dispara falsos positivos. Su UI
        // fija ("MISSION COMPLETE", dropdown IMPORTANCE, caja SEARCH) no existe en la
        // pantalla de selección de recompensa de reliquia, así que sirve de descarte.
        // La CABECERA entra en el guard, no solo el recorte. El título "MISSION COMPLETE" está
        // centrado y nunca cae dentro de la banda de recompensas: buscarlo en el texto del
        // recorte solo funcionaba de rebote, porque el recorte ancho pillaba el "IMPORTANCE" o
        // el "SEARCH" de esa pantalla — y dejó de pillarlos al ceñir el recorte al rótulo.
        // Visto en vivo: el modal de recompensa se abría sobre la pantalla de fin de misión,
        // que es otra lógica (ahí las piezas se SUMAN al inventario, no se eligen).
        const contextText = `${rawOcr} ${namesRaw} ${this.lastHeaderText || ""}`.toUpperCase();
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
            // El MISMO frame que se leyó: así la foto y los badges se corresponden.
            ScannerModal.open(frame.toDataURL("image/jpeg", 0.85), foundItems, width, height, scale, rawOcr);
        }
    },

    async processInventoryGrid(snapshot, width, height, scale) {
        if (this.detectionLocked) return;
        // Se suelta en TODAS las salidas menos la del modal (ese lo suelta al cerrarse):
        // processFrame() sale en su 1ª línea si sigue puesto, así que una fuga mata el escáner.
        this.detectionLocked = true;

        try {
            // 1. AUTODETECCIÓN con caché: detectar la rejilla cuesta un getImageData
            // de frame completo + perfiles, así que se hace UNA vez y se reutiliza
            // mientras el tamaño de frame no cambie (la rejilla del juego es fija; el
            // desfase por scroll lo corrige _applyRowPhase por frame, que es barato).
            // Si una página entera sale sin ningún match, la caché se invalida y el
            // siguiente frame re-detecta.
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

            // Último recurso: sin autodetección ni calibración guardada, abre el modal
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

            // 2. Detect UI theme from within the calibrated zone.
            // detectThemeFromSnapshot devuelve null si no hay señal suficiente
            // (weight < 0.001 y sin tema estable previo): saltamos este frame en vez de crashear.
            let theme = VisionService.detectThemeFromSnapshot(
                snapshot,
                gridZone.x, gridZone.y, gridZone.w, gridZone.h
            );
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

            // Debug overlay canvas (cropped to the calibrated section for a clear, high-res zoom in UI)
            // Reutilizado entre escaneos: son ~6 MB por canvas y el historial guarda el
            // toDataURL (una cadena), no el canvas, así que pisarlo es seguro.
            const debugCanvas = this._debugCvs ||= document.createElement("canvas");
            if (debugCanvas.width !== gridZone.w) debugCanvas.width = gridZone.w;
            if (debugCanvas.height !== gridZone.h) debugCanvas.height = gridZone.h;
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

            const agInfo = `AG ${calibData.auto ? "auto" : "manual"} ${autoGrid.rows}r×${autoGrid.cols}c cell ${cellW}×${cellH} zone ${gridZone.x},${gridZone.y} dy ${autoGrid.phaseShift || 0}${calibData.traceSummary?.halfPitchFixed ? " HPfix" : ""}`;

            // 4. Extract active non-empty cells
            // El reset del log va ANTES de este loop: reseteándolo después (como antes) se
            // perdían las entradas "SKIPPED (empty)" que este loop ya había registrado.
            this.lastRawOcrLog = [];
            // Traza del auto-grid también en el log exportable de debug
            this.lastRawOcrLog.push(`[AUTO-GRID] ${agInfo} · rowBands ${JSON.stringify(calibData.traceSummary?.rowBands || [])} · chain ${JSON.stringify(calibData.traceSummary?.chain || null)}`);
            // Contadores del escaneo para el summary/aviso del debug: en teoría cada página
            // debe rendir rows×cols celdas; si fallan matches o faltan celdas, se marca.
            const scanStats = { cells: cellRects.length, matched: 0, relics: 0, empty: 0, unmatched: 0, none: 0, ownColor: 0 };
            // Recorte de la banda de NOMBRE. Debe cubrir nombres de 1, 2 Y 3
            // líneas (los warframes largos como "Atlas Prime / Neuroptics /
            // Blueprint" ocupan 3 líneas). Un recorte estrecho abajo (0.76–0.97)
            // clipaba la 1ª línea de los de 3 → se perdía el nombre del frame y
            // quedaba "Neuroptics Blueprint" (ambiguo → UNMATCHED). Ampliamos a
            // 0.56–0.98: el arte que entre por arriba lo rechaza el aislado por
            // COLOR DE TEXTO (no dependemos de evitar el arte con la geometría).
            const textSrcY = Math.round(cellH * 0.50);
            const textSrcH = Math.round(cellH * 0.48);

            // Las celdas ya NO se recortan aquí. Antes esta pasada binarizaba las 18 y se
            // quedaba con los canvas hasta el OCR: son ~1,4 MB cada uno (3x sobre la banda)
            // y el navegador libera los backing store de canvas mucho más despacio que el
            // heap normal, así que página tras página el escáner se iba a cientos de MB.
            // Ahora recorta el worker, justo antes de leer, y el canvas se recicla (ring en
            // vision.service) en cuanto pasa a la siguiente celda. De paso se ahorra la
            // pasada duplicada: antes se binarizaba una vez para ver si estaba vacía y otra
            // para el OCR.
            const activeCells = cellRects.map(cell => ({ cell }));

            // Solo se crea el 2º worker estándar (nombres): las CANTIDADES ya no usan Tesseract
            // sino template-matching de dígitos (utils/badge_digit_ocr.js), así que los 2 workers
            // de badges se eliminaron — 2 instancias WASM menos de RAM.
            // Trazas de PROGRESO del tramo mudo: entre updateScrollStatus("scanning") y el
            // "done" final no se emitía nada, así que un cuelgue aquí (worker que no arranca,
            // celda que no resuelve) dejaba el HUD en "scanning" sin ninguna pista de dónde.
            console.log(`[INV] Preparadas ${activeCells.length} celdas activas; arrancando worker OCR...`);
            await OCRRepository.ensureSecondWorker();
            const workers = OCRRepository.workers.filter(Boolean);
            console.log(`[INV] Workers OCR listos: ${workers.length}`);

            // UN color de texto para toda la SESIÓN: medirlo por celda es un empate a
            // suerte entre el nombre y el arte (ver utils/name_color.js), y el tema no
            // cambia a mitad de escaneo, así que reelegirlo por página solo añade
            // ocasiones de elegirlo distinto.
            if (!this._nameColorCache || this._nameColorCache.key !== calibKey) {
                // La lectura manda sobre el color del auto-grid: ese sale de contar píxeles.
                const color = await electPageNameColor(workers[0], snapshot, activeCells, cellW, textSrcY, textSrcH, theme)
                    || calibData?.nameColor;
                if (color) this._nameColorCache = { key: calibKey, color };
            }
            const pageNameColor = this._nameColorCache?.color || null;
            this.lastRawOcrLog.push(`[NAME-COLOR] ${pageNameColor ? `rgb(${pageNameColor.join(",")})` : "ninguno — cada celda mide el suyo"}`);

            // Cabecera: un pantallazo del debug se autoexplica (rejilla, zona y el color con
            // el que se binarizó). Va aquí para incluirlo, y así no la tapa la fila 0.
            const hdr = `${agInfo} · name ${pageNameColor ? `rgb(${pageNameColor.join(",")})` : "por celda"}`;
            dCtx.fillStyle = "rgba(0,0,0,0.72)";
            dCtx.fillRect(0, 0, dCtx.measureText(hdr).width + 160, 20);
            dCtx.fillStyle = pageNameColor ? `rgb(${pageNameColor.join(",")})` : "#ff5252";
            dCtx.font = "bold 13px monospace";
            dCtx.fillText(hdr, 6, 14);

            // Partes prime encontradas en esta página, PENDIENTES de confirmar. Una página del
            // inventario es de un solo tipo (la pestaña RELIQUIAS solo enseña reliquias), así
            // que si la página resulta ser de reliquias, una "parte prime" suelta no es una
            // parte: es una celda con el nombre ilegible que el matcher difuso ha rellenado.
            // Así entraron "Jahu" y "Forma Blueprint" en el inventario desde celdas de reliquia.
            const pendingItems = [];

            const { drawResolved: drawResolvedCell, drawFailed: drawFailedCell } =
                createCellOverlay(dCtx, gridZone, cellW, cellH);

            let cellIndex = 0;
            const runWorker = async (worker) => {
                while (cellIndex < activeCells.length) {
                    const task = activeCells[cellIndex++];
                    if (!task) break;

                    console.log(`[INV] celda ${cellIndex}/${activeCells.length} (r${task.cell.r}c${task.cell.c})...`);

                    const { cell } = task;
                    const { cvs: textCvs, ink, ownColor: ownColorUsed } =
                        cellNameMask(snapshot, cell, cellW, textSrcY, textSrcH, theme, pageNameColor);
                    if (ownColorUsed) scanStats.ownColor++;
                    if (!hasInk(ink)) {
                        scanStats.empty++;
                        this.lastRawOcrLog.push(`[r${cell.r}c${cell.c}] SKIPPED (empty)`);
                        dCtx.strokeStyle = "rgba(255, 255, 255, 0.04)";
                        dCtx.lineWidth = 1;
                        dCtx.strokeRect(cell.sx - gridZone.x + 2, cell.sy - gridZone.y + 2, cellW - 4, cellH - 4);
                        continue;
                    }
                    // MOTOR OCR seleccionable (paralelo). El preciso (ocr_engine.service.js)
                    // lee la banda de nombre a COLOR directamente (sin binarizar) con PaddleOCR;
                    // por defecto usa Tesseract sobre el recorte binarizado como hasta ahora.
                    let combinedText;
                    if (motorActivo() === MOTOR_PRECISO) {
                        const ty = Math.round(cellH * 0.50), th = Math.round(cellH * 0.48);
                        const colorCvs = VisionService.cropColor(snapshot, cell.sx, cell.sy + ty, cellW, th, 2);
                        try {
                            combinedText = await PaddleRepository.recognizeWords(colorCvs);
                        } catch (e) {
                            console.warn("[Paddle] fallo, cae a Tesseract:", e);
                            combinedText = await OCRService.extractCellText(worker, textCvs);
                        }
                    } else {
                        combinedText = await OCRService.extractCellText(worker, textCvs);
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

                    // itemText/relicText = la lectura que REALMENTE produjo el match. El overlay
                    // de debug pintaba siempre combinedText (1ª pasada), así que cuando el match
                    // salía del fallback la etiqueta mostraba un texto que no casaba con el
                    // nombre de debajo — justo el caso que hay que poder leer en una captura.
                    let relicText = combinedText;
                    let itemText = combinedText;
                    const readable = !this._isGarbledCellText(combinedText);
                    let relicMatch = readable ? OCRService.getRelicMatch(combinedText) : null;
                    let bestItem = (readable && !relicMatch) ? OCRService.getValidItemMatch(combinedText) : null;
                    let fallbackText = null;

                    // Fallback: si no hay match en la banda normal (76%-97%), probamos ventana más amplia (73%-99%)
                    if (!bestItem && !relicMatch) {
                        const fallbackY = Math.floor(cellH * 0.73);
                        const fallbackH = Math.floor(cellH * 0.26);
                        const fullCellCvs = VisionService.cropThemeBinarized(snapshot, cell.sx, cell.sy + fallbackY, cellW, fallbackH, theme, pageNameColor);
                        fallbackText = await OCRService.extractCellText(worker, fullCellCvs);
                        if (fallbackText && fallbackText.length) {
                            logStr = `[r${cell.r}c${cell.c}] OCR (fallback): ${fallbackText.join(" ")}`;
                            // La ventana del fallback mide su propio color de texto sobre una
                            // franja distinta, así que puede binarizar el arte en vez del nombre:
                            // mismo filtro de ilegible que en la pasada normal.
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

                    // Antes de rendirse, la celda se relee con SU color: el de la página lo
                    // vota el conjunto y puede no aislar el nombre en una card concreta.
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
                        // 4b. Badge (cantidad) por BRILLO — robusto, no depende del color de tema
                        // (que a veces se detecta mal y binariza el número a medias → "4"→"1").
                        // Si no saca dígito, respaldo por color de tema.
                        let qtyResult = await OCRService.extractCellQuantity(null,
                            VisionService.extractBadgeBright(snapshot, cell, cellW, cellH));
                        if (!/\d/.test(qtyResult.raw || "")) {
                            const altR = await OCRService.extractCellQuantity(null,
                                VisionService.extractBadgeByColor(snapshot, cell, cellW, cellH, theme));
                            if (/\d/.test(altR.raw || "")) qtyResult = altR;
                        }

                        logStr += ` || BDG: ${qtyResult.raw}`;
                        // NO se apunta todavía: una parte prime solo cuenta si la PÁGINA no
                        // resulta ser de reliquias (ver el commit tras el Promise.all).
                        pendingItems.push({ cell, bestItem, qtyResult, itemText, logStr });
                    } else if (relicMatch) {
                        scanStats.relics++;
                        // 4c. Misma lectura de badge que los prime items (brillo + respaldo color),
                        // pero votando en los maps de reliquias (no se mezcla con sessionInventory).
                        let qtyResult = await OCRService.extractCellQuantity(null,
                            VisionService.extractBadgeBright(snapshot, cell, cellW, cellH));
                        if (!/\d/.test(qtyResult.raw || "")) {
                            const altR = await OCRService.extractCellQuantity(null,
                                VisionService.extractBadgeByColor(snapshot, cell, cellW, cellH, theme));
                            if (/\d/.test(altR.raw || "")) qtyResult = altR;
                        }

                        // Indica qué lectura matcheó la reliquia (la original o la del fallback).
                        const relicSrc = relicText === combinedText ? "1st-pass" : "fallback";
                        logStr += ` || RELIC (${relicSrc}): ${relicMatch} || BDG: ${qtyResult.raw}`;
                        this.lastRawOcrLog.push(logStr);

                        this.recordQtyVote(relicMatch, qtyResult, this.relicQtyVotes, this.sessionRelics);

                        // Acento CIAN para distinguir de un vistazo una reliquia de una parte prime.
                        drawResolvedCell({
                            cell, name: relicMatch, qtyResult, text: relicText, accent: "#00e5ff",
                            qty: this.sessionRelics.get(relicMatch) ?? qtyResult.qty,
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

                            // Y sobre el arte —que no aporta nada— se pinta EL RECORTE BINARIZADO
                            // que se le pasó a Tesseract. Es la única forma de diagnosticar esto:
                            // el fallo solo existe en el frame en vivo (sobre la captura de
                            // escritorio del mismo inventario, las 18 celdas binarizan limpias),
                            // así que una captura del overlay tiene que enseñar la ENTRADA real
                            // del OCR, no la pantalla del juego.
                            const bandH = Math.round((cellH - 54) * 0.6);
                            dCtx.fillStyle = "#fff";
                            dCtx.fillRect(relX + 4, relY + 4, cellW - 8, bandH);
                            dCtx.drawImage(textCvs, relX + 4, relY + 4, cellW - 8, bandH);
                        }
                    }
                }
            };

            try {
                // Dynamically load-balance Tesseract workers to maximize parallel scan throughput
                const workerPromises = [];
                // Con PaddleOCR se serializa a 1 "worker": el servicio ONNX es único y no
                // es seguro llamarlo en paralelo. Con Tesseract se balancea entre los workers.
                const maxWorkers = motorActivo() === MOTOR_PRECISO ? 1 : workers.length;
                const activeWorkerCount = Math.min(maxWorkers, activeCells.length);
                for (let w = 0; w < activeWorkerCount; w++) {
                    workerPromises.push(runWorker(workers[w]));
                }
                await Promise.all(workerPromises);

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
                        qty: this.sessionInventory.get(pending.bestItem.originalName) ?? pending.qtyResult.qty,
                    });
                }

                ScannerHUD.updateScrollStatus("done", this.sessionInventory.size + this.sessionRelics.size);
                ScannerHUD.updateDetectedItems(this.sessionInventory, this.sessionRelics);

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

                // El color de página se cachea para toda la SESIÓN, así que una elección
                // mala se arrastraba página tras página. Si media página ha tenido que
                // rebinarizar con su propio color, ese color no vale: se tira y la
                // siguiente página vuelve a elegir.
                if (pageNameColor && scanStats.ownColor * 2 > scanStats.cells) {
                    console.warn(`[INV] El color de página rgb(${pageNameColor.join(",")}) falló en ${scanStats.ownColor}/${scanStats.cells} celdas — se descarta y se reelige.`);
                    this._nameColorCache = null;
                }

                // Página con celdas activas y CERO matches ⇒ la rejilla cacheada ya no
                // vale (cambio de resolución/pantalla): re-detectar en el próximo frame.
                if (this._autoCalibCache && activeCells.length > 0 &&
                    scanStats.matched === 0 && scanStats.relics === 0) {
                    console.warn("[INV] Página sin ningún match con la rejilla cacheada — invalidando caché del auto-grid y del color de nombre.");
                    this._autoCalibCache = null;
                    this._nameColorCache = null;
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
    // ¿La lectura de una celda es TEXTO o es ruido binarizado? El nombre más largo del
    // juego ("Atlas Prime Neuroptics Blueprint") son 4 palabras, y una reliquia 3
    // ("Axi H7 Relic"); aunque el OCR parta alguna, no se llega a 9 tokens. Cuando la
    // binarización falla y marca como tinta el arte o la onda roja del fondo, Tesseract
    // devuelve una ristra de fragmentos sueltos — vistos en vivo: "HEJO . YE : L 5, - AL
    // 5 ER . OT NE WL" (que se apuntó como "Neo W1") o "OO BN TO TI A I - -AF A IP FR LE
    // BOO SE PE EARN" ("Forma Blueprint"). Ningún matcher debería opinar sobre eso: la
    // celda se marca ilegible y el frame siguiente lo reintenta.
    _isGarbledCellText(words) {
        if (!words || !words.length) return false;
        const tokens = words.join(" ").toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
        if (tokens.length > 8) return true;
        // Fragmentos de UN glifo: un nombre real trae como mucho uno (un código partido
        // por el OCR, "AL" + "4"). Dos o más es ruido.
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
        <span style="color:${colors[type]}; font-weight:bold;">${escapeHTML(tag).toUpperCase()}</span>
        <span style="color:#eee;">${escapeHTML(msg)}</span>
    `;

    container.appendChild(entry);

    const parent = document.getElementById("rewards-dbg-text");
    if (parent) parent.scrollTop = parent.scrollHeight;
}