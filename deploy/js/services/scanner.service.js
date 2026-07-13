import { VisionService, WF_THEMES } from "./vision.service.js";
import { OCRService } from "./ocr.service.js";
import { OCRRepository } from "../repositories/ocr.repository.js";
import { OpenCVRepository } from "../repositories/opencv.repository.js";
import { ScannerHUD } from "../ui.components/ui_scanner_hud.js";
import { ScannerModal } from "../ui.components/ui_scanner_modal.js";
import { initializeOCRDatabase } from "../repositories/api.repository.js";
import { escapeHTML } from "../ui.components/ui_components.js";

/**
 */
export const ScannerService = {
    isScanning: false,
    scanInterval: null,
    currentRate: 1200,
    RIVEN_RATE_ACTIVE: 400, // sin resultado mostrado aún, o el hash cambió: escanea rápido
    RIVEN_RATE_IDLE: 1000, // ya hay resultado y la pantalla está estática (hash-skip disparando): relaja el poll
    lastTrackedRelic: "",
    sessionInventory: new Map(),
    sessionRelics: new Map(), // relicName -> qty de consenso (fallback de reliquias en el grid de inventario)
    _autoCalibCache: null, // rejilla autodetectada cacheada { key: "WxH", calib } — detectar cuesta un frame completo
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
        this.unknownFrameCount = 0;
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
        // Si la sesión se detuvo (p.ej. el stream terminó y stop() ya llamó a
        // terminateAll), no toques los workers: evita recognize sobre un worker
        // muerto → "Cannot read properties of null (reading 'postMessage')".
        if (!this.isScanning) return;
        this.scanCounter++;

        const dims = VisionService.prepareVirtualCanvas(video, virtualCanvas);

        const worker1 = OCRRepository.workers[0];
        if (!worker1) return;

        // Skip del OCR de cabecera por hash: la franja del header no cambia entre frames de una
        // pantalla quieta, y OCRearla cada tick (400ms en modo riven) era el mayor consumo fijo
        // de CPU del scanner. Si el hash coincide, reutilizamos el texto de la última lectura —
        // todo el flujo de contexto (anclas, grace, histéresis) se comporta exactamente igual.
        // Tres protecciones contra la "ceguera de contexto" (recompensas que no saltaban):
        //  - tolerancia ESTRICTA (6, no 18): el título del header es texto fino que apenas
        //    mueve la media de un downsample 16×9; con 18 el cambio gameplay→recompensas
        //    podía quedar por debajo y se reutilizaba el texto basura cacheado del gameplay.
        //  - baseline anclado al último frame OCREADO (no al frame anterior): actualizarlo
        //    cada frame dejaba pasar cambios graduales (fade de transición) sin re-OCR jamás.
        //  - TTL: pase lo que pase, re-OCR cada 2.5s — acota cualquier colisión de hash a
        //    2.5s de ceguera máxima (la pantalla de recompensas dura ~10s).
        const headerHash = this._smallCanvasHash(virtualCanvas);
        const headerCacheFresh = this.lastHeaderOcrTime && (Date.now() - this.lastHeaderOcrTime < 2500);
        let headerText;
        if (this.lastHeaderText !== null && headerCacheFresh && this._compareHashes(headerHash, this.lastHeaderHash, 6)) {
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

        console.log(`[SCAN] Context Raw: ${rawContext} | Latched: ${this.latchedContext} | Header: "${headerText.trim().slice(0, 60)}"`);
        await this.routeFrameAction(this.latchedContext, video, dims);

        ScannerHUD.updateFrameCounter(this.scanCounter);
    },

    // Registra un voto de cantidad para un ítem y actualiza sessionInventory con la MODA.
    // Solo cuentan lecturas EXITOSAS (raw con dígito): una lectura fallida devuelve qty=1
    // con raw vacío ("Ø"), y contarla contaminaría el consenso con falsos "1".
    // votesMap/targetMap son opcionales para reutilizar el mismo consenso con las reliquias
    // (relicQtyVotes/sessionRelics) sin duplicar la lógica.
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

    async routeFrameAction(contextType, video, dims) {
        ScannerHUD.updateContext(contextType);

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

            if (hasPageChanged && !this.autoScrollStableTimer && !this.detectionLocked) {
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
                ScannerHUD.updateScrollStatus("done", this.sessionInventory.size + this.sessionRelics.size);
            }

        } else if (contextType === "INVENTORY_MODS" || contextType === "ITEM_DETAILS" || (globalThis.state.scannerModsMode && contextType === "INVENTORY")) {
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
            await this.processRelicSelection(video, dims);
        } else if (contextType === "REWARD") {
            if (globalThis.RivenScannerHUD) globalThis.RivenScannerHUD.dismiss();
            if (this.detectionLocked) return;
            this.currentRate = 1200;
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

    // Hash de la REGIÓN FIJA del vídeo (el rect de cardCrop sobre videoWidth/Height). Los canvases
    // tight-cropped de prepareRivenCardCanvases jitteran de ancho entre frames (749–1538px con la
    // pantalla QUIETA), así que un hash calculado sobre ellos nunca coincidía → el hash-skip y el
    // rate IDLE no enganchaban jamás y se re-OCReaba cada frame. Hasheando el rect fijo del vídeo,
    // una pantalla estática produce un hash estable aunque el tight-crop baile. Mismo formato hex
    // que _getCanvasHash para poder reutilizar _compareHashes.
    // Canvas 16x9 reutilizado por todos los hashes: crear uno nuevo por llamada (cada 400ms)
    // generaba churn de GC innecesario.
    _tinyCvs: null,
    _tinyCtx() {
        if (!this._tinyCvs) {
            this._tinyCvs = document.createElement("canvas");
            this._tinyCvs.width = 16;
            this._tinyCvs.height = 9;
        }
        return this._tinyCvs.getContext("2d", { willReadFrequently: true });
    },

    _hashFromTiny(ctx) {
        const d = ctx.getImageData(0, 0, 16, 9).data;
        let hash = "";
        for (let i = 0; i < d.length; i += 4) {
            const avg = Math.floor((d[i] + d[i + 1] + d[i + 2]) / 3);
            hash += avg.toString(16).padStart(2, "0");
        }
        return hash;
    },

    _getVideoRegionHash(video, crop) {
        const ctx = this._tinyCtx();
        ctx.drawImage(video,
            Math.floor(video.videoWidth * crop.x), Math.floor(video.videoHeight * crop.y),
            Math.floor(video.videoWidth * crop.w), Math.floor(video.videoHeight * crop.h),
            0, 0, 16, 9);
        return this._hashFromTiny(ctx);
    },

    // Hash barato de un canvas ya preparado (franja del header) para el skip del OCR de contexto.
    _smallCanvasHash(canvas) {
        const ctx = this._tinyCtx();
        ctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, 16, 9);
        return this._hashFromTiny(ctx);
    },

    // tolerance: 18 (por defecto) para pantallas riven/inventario completas; el skip del
    // HEADER usa 6 — el título es texto fino y con 18 los cambios de pantalla se colaban.
    _compareHashes(hash1, hash2, tolerance = 18) {
        if (!hash1 || !hash2) return false;
        if (hash1.length !== hash2.length) return false;
        let diff = 0;
        for (let i = 0; i < hash1.length; i += 2) {
            const val1 = parseInt(hash1.substring(i, i + 2), 16);
            const val2 = parseInt(hash2.substring(i, i + 2), 16);
            diff += Math.abs(val1 - val2);
        }
        const avgDiff = diff / (hash1.length / 2);
        return avgDiff < tolerance;
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
        const hash = this._getVideoRegionHash(video, cardCrop);

        // Skip OCR if we already have a result and the region hasn't changed. Pantalla estática ya
        // parseada -> relaja el rate de poll (menos CPU); en cuanto el hash cambie, el siguiente
        // frame ya vuelve a RIVEN_RATE_ACTIVE (fijado por defecto en routeFrameAction) para reaccionar rápido.
        if ((this.lastParsedL || this.lastParsedR) && this._compareHashes(hash, this.lastHashL)) {
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
        if (this._compareHashes(hash, this.lastNoResultHash) && (Date.now() - this.lastNoResultTime < 3000)) {
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

        const { RivenOCRService } = await import("./riven_ocr.service.js?v=3");

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
        const currentFP = valids.map(e => this._rivenFingerprint(e.parsed)).join("||") || "none";
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

        if (globalThis.showRivenAppraisal) {
            globalThis.showRivenAppraisal(this.lastParsedL, this.lastParsedR, screenshotDataURL);
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
        await OCRRepository.ensureSecondWorker(); // el 2º worker se crea perezoso (RAM)
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
                calibData = globalThis.LiveCalibration?.getGrid() || null;
                if (calibData) {
                    console.log("[INV] Auto-grid sin señal este frame — usando calibración manual guardada.");
                }
            }

            // Último recurso: sin autodetección ni calibración guardada, abre el modal
            if (!calibData?.gridZone) {
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
                    return;
                }
                console.warn("[INV] No grid zone calibration available.");
                return;
            }

            const { gridZone } = calibData;

            // 2. Detect UI theme from within the calibrated zone.
            // detectThemeFromSnapshot devuelve null si no hay señal suficiente
            // (weight < 0.001 y sin tema estable previo): saltamos este frame en vez de crashear.
            const theme = VisionService.detectThemeFromSnapshot(
                snapshot,
                gridZone.x, gridZone.y, gridZone.w, gridZone.h
            );
            if (!theme) {
                console.warn("[INV] Theme detection inconclusive this frame — skipping.");
                ScannerHUD.updateScrollStatus("done", 0);
                return;
            }
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

            // La geometría detectada, impresa EN el overlay: cualquier pantallazo
            // del debug se autoexplica (versión, rejilla, zona, traza del auto-grid).
            const agInfo = `AG ${calibData.auto ? "auto" : "manual"} ${autoGrid.rows}r×${autoGrid.cols}c cell ${cellW}×${cellH} zone ${gridZone.x},${gridZone.y} dy ${autoGrid.phaseShift || 0}${calibData.traceSummary?.halfPitchFixed ? " HPfix" : ""}`;
            dCtx.fillStyle = "rgba(0,0,0,0.72)";
            dCtx.fillRect(0, 0, dCtx.measureText(agInfo).width + 160, 20);
            dCtx.fillStyle = "#00e5ff";
            dCtx.font = "bold 13px monospace";
            dCtx.fillText(agInfo, 6, 14);

            // 4. Extract active non-empty cells
            // El reset del log va ANTES de este loop: reseteándolo después (como antes) se
            // perdían las entradas "SKIPPED (empty)" que este loop ya había registrado.
            this.lastRawOcrLog = [];
            // Traza del auto-grid también en el log exportable de debug
            this.lastRawOcrLog.push(`[AUTO-GRID] ${agInfo} · rowBands ${JSON.stringify(calibData.traceSummary?.rowBands || [])} · chain ${JSON.stringify(calibData.traceSummary?.chain || null)}`);
            // Contadores del escaneo para el summary/aviso del debug: en teoría cada página
            // debe rendir rows×cols celdas; si fallan matches o faltan celdas, se marca.
            const scanStats = { cells: cellRects.length, matched: 0, relics: 0, empty: 0, unmatched: 0, none: 0 };
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
                    scanStats.empty++;
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

            // Los workers extra (2º estándar + badges de cantidades) se crean aquí la primera
            // vez: solo el escaneo del grid los usa, y tenerlos vivos desde el arranque costaba
            // ~3 instancias WASM de RAM también en modo riven.
            await Promise.all([OCRRepository.ensureSecondWorker(), OCRRepository.ensureBadgeWorkers()]);
            const workers = OCRRepository.workers;
            const bWorkers = OCRRepository.badgeWorkers;

            let cellIndex = 0;
            const runWorker = async (worker, bWorker) => {
                while (cellIndex < activeCells.length) {
                    const task = activeCells[cellIndex++];
                    if (!task) break;

                    const { cell, textCvs } = task;
                    const combinedText = await OCRService.extractCellText(worker, textCvs);

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

                    let bestItem = OCRService.getValidItemMatch(combinedText);
                    let fallbackText = null;

                    // Fallback: if no match, try full cell OCR (captures text at top/left like Octavia Prime Blueprint)
                    if (!bestItem) {
                        const fullCellCvs = VisionService.cropThemeBinarized(snapshot, cell.sx, Math.max(0, cell.sy - 16), cellW, cellH + 16, theme);
                        fallbackText = await OCRService.extractCellText(worker, fullCellCvs);
                        if (fallbackText && fallbackText.length) {
                            logStr = `[r${cell.r}c${cell.c}] OCR (fallback): ${fallbackText.join(" ")}`;
                            bestItem = OCRService.getValidItemMatch(fallbackText);
                        }
                    }

                    // Segundo fallback: la pestaña RELIQUIAS del inventario usa el MISMO grid/badges
                    // que las prime parts ("LITH C1 RELIC", etc.) — si no matcheó como prime item,
                    // probamos el matcher de reliquias. PRIMERO sobre la lectura original (la banda
                    // de nombre es más limpia: el OCR de celda completa arrastra ruido del arte de
                    // la reliquia y puede corromper una primera pasada buena), y si falla, sobre la
                    // del fallback. relicText = la lectura que realmente matcheó (para el debug).
                    let relicMatch = null;
                    let relicText = combinedText;
                    if (!bestItem) {
                        relicMatch = OCRService.getRelicMatch(combinedText);
                        if (!relicMatch && fallbackText && fallbackText.length) {
                            relicMatch = OCRService.getRelicMatch(fallbackText);
                            if (relicMatch) relicText = fallbackText;
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
                        scanStats.matched++;
                        // 4b. Extract badge (quantity) using improved color-based crop
                        const badgeCanvas = VisionService.extractBadgeByColor(snapshot, cell, cellW, cellH, theme);
                        const qtyResult = await OCRService.extractCellQuantity(bWorker, badgeCanvas);

                        logStr += ` || BDG: ${qtyResult.raw}`;
                        this.lastRawOcrLog.push(logStr);

                        // Consenso temporal: la lectura de un frame es frágil (dígito ~15px), pero
                        // el nombre del ítem es fiable. Acumulamos votos de cantidad por ítem a lo
                        // largo de los frames y guardamos la MODA. Así los errores aleatorios de un
                        // frame se diluyen y la cantidad final es robusta.
                        this.recordQtyVote(bestItem.originalName, qtyResult);

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
                        // Muestra la cantidad de CONSENSO (moda entre frames), no la del frame único.
                        const consensusQty = this.sessionInventory.get(bestItem.originalName) ?? qtyResult.qty;
                        dCtx.fillText(`x${consensusQty}`, relX - shiftLeft + 8, relY + 17);

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
                    } else if (relicMatch) {
                        scanStats.relics++;
                        // 4c. Misma lectura de badge que los prime items, pero votando en los maps
                        // de reliquias: no se mezcla con sessionInventory (se persisten por separado).
                        const badgeCanvas = VisionService.extractBadgeByColor(snapshot, cell, cellW, cellH, theme);
                        const qtyResult = await OCRService.extractCellQuantity(bWorker, badgeCanvas);

                        // Indica qué lectura matcheó la reliquia (la original o la del fallback).
                        const relicSrc = relicText === combinedText ? "1st-pass" : "fallback";
                        logStr += ` || RELIC (${relicSrc}): ${relicMatch} || BDG: ${qtyResult.raw}`;
                        this.lastRawOcrLog.push(logStr);

                        this.recordQtyVote(relicMatch, qtyResult, this.relicQtyVotes, this.sessionRelics);

                        const relX = cell.sx - gridZone.x;
                        const relY = cell.sy - gridZone.y;

                        // Mismo bloque de etiqueta que los prime items, pero con acento CIAN para
                        // distinguir a simple vista una reliquia de una parte prime (verde).
                        dCtx.fillStyle = "rgba(10, 15, 28, 0.98)";
                        dCtx.fillRect(relX, relY + cellH - 50, cellW, 50);

                        dCtx.fillStyle = "rgba(0, 229, 255, 0.9)";
                        dCtx.fillRect(relX, relY + cellH - 50, cellW, 1.5);

                        dCtx.fillStyle = "#ffb300";
                        dCtx.font = "italic 9px system-ui, -apple-system, sans-serif";
                        const rawText = relicText.join(" ");
                        const badgeRawText = qtyResult.raw ? qtyResult.raw.trim().replaceAll(/\s+/g, " ") : "Ø";
                        const maxCharsItem = Math.floor(cellW / 5.5);
                        const truncatedItem = rawText.length > maxCharsItem ? rawText.slice(0, maxCharsItem - 3) + "..." : rawText;
                        dCtx.fillText(truncatedItem, relX + 6, relY + cellH - 37);
                        dCtx.fillText(`BDG: "${badgeRawText}"`, relX + 6, relY + cellH - 25);

                        dCtx.fillStyle = "#00e5ff";
                        dCtx.font = "bold 12px system-ui, -apple-system, sans-serif";
                        dCtx.fillText(relicMatch, relX + 6, relY + cellH - 8);

                        const shiftLeft = (cell.c === 0) ? 14 : 2;
                        dCtx.fillStyle = "rgba(0, 0, 0, 0.85)";
                        dCtx.fillRect(relX - shiftLeft, relY + 4, 44 + (shiftLeft - 2), 18);
                        dCtx.fillStyle = "#00e5ff";
                        dCtx.font = "bold 11px monospace";
                        const consensusQty = this.sessionRelics.get(relicMatch) ?? qtyResult.qty;
                        dCtx.fillText(`x${consensusQty}`, relX - shiftLeft + 8, relY + 17);

                        if (badgeCanvas) {
                            const bX = (badgeCanvas.cropX !== undefined ? badgeCanvas.cropX : cell.sx) - gridZone.x;
                            const bY = badgeCanvas.bestY - gridZone.y;
                            const bW = badgeCanvas.cropW !== undefined ? badgeCanvas.cropW : Math.round(cellW * 0.28);
                            const bH = badgeCanvas.cropH !== undefined ? badgeCanvas.cropH : Math.round(cellH * 0.12);
                            dCtx.strokeStyle = "rgba(0, 229, 255, 0.85)";
                            dCtx.lineWidth = 1.5;
                            dCtx.strokeRect(bX, bY, bW, bH);
                        }
                    } else {
                        // Segunda oportunidad de la guardia de riven: la primera lectura pudo salir
                        // ruidosa y solo el OCR de celda completa (fallbackText) revela "RIVEN".
                        if (this._isRivenCellText(fallbackText)) {
                            // Riven detectado: solo loguear, no registrar como UNMATCHED ni agregarlo al inventario
                            this.lastRawOcrLog.push(logStr + " || RIVEN (ignored in inventory grid)");
                        } else {
                            scanStats.unmatched++;
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
                    + (autoGrid.phaseShift ? ` · dy ${autoGrid.phaseShift > 0 ? "+" : ""}${autoGrid.phaseShift}px` : "");
                this.lastRawOcrLog.push(`[SUMMARY] ${summary}`);

                // Página con celdas activas y CERO matches ⇒ la rejilla cacheada ya no
                // vale (cambio de resolución/pantalla): re-detectar en el próximo frame.
                if (this._autoCalibCache && activeCells.length > 0 &&
                    scanStats.matched === 0 && scanStats.relics === 0) {
                    console.warn("[INV] Página sin ningún match con la rejilla cacheada — invalidando caché del auto-grid.");
                    this._autoCalibCache = null;
                }

                // Historial de debug: imagen anotada + log + summary por escaneo (máx 10
                // entradas para no crecer en RAM). El HUD lo pinta como miniaturas clicables.
                this.debugHistory.unshift({
                    time: new Date().toLocaleTimeString([], { hour12: false }),
                    img: debugCanvas.toDataURL("image/jpeg", 0.6),
                    log: [...this.lastRawOcrLog],
                    summary,
                    warning: hasWarning
                });
                if (this.debugHistory.length > 10) this.debugHistory.length = 10;
                if (ScannerHUD.updateDebugHistory) {
                    ScannerHUD.updateDebugHistory(this.debugHistory);
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

    // Heurística de riven sobre las palabras OCR de una celda del grid de inventario:
    // "RIVEN" explícito o "MOD" + clase de arma ("RIFLE RIVEN MOD" velado, aunque el OCR
    // pierda la palabra RIVEN). Los rivens revelados sin "RIVEN" legible ("VULKAR CRITACAN")
    // no se pueden distinguir por keyword; el sufijo inventado rara vez matchea un ítem real.
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