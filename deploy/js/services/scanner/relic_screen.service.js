import { state } from "../../state.js";
import { OCRRepository } from "../../repositories/ocr.repository.js";
import { PaddleRepository } from "../../repositories/paddle.repository.js";
import { RELIC_GRID_CROP, parseRelicGrid } from "../../utils/vision/relic_grid.js";
import { voteReadings, applyRelicCounts } from "../../utils/inventory/relic_votes.js";
import { smallCanvasHash, compareHashes } from "../../utils/vision/frame_hash.js";
import { collectWords } from "../../utils/vision/ocr_words.js";
import { corrige56 } from "../../utils/vision/relic_digit_56.js";
import { VisionService } from "./vision.service.js";
import { OCRService } from "./ocr.service.js";
import { motorActivo, MOTOR_PRECISO } from "./ocr_engine.service.js";

/**
 * La pantalla VOID RELICS/REFINEMENT: qué reliquia se lleva a la misión y cuántas tienes
 * de cada una.
 *
 * El contador va ahí escrito ("x108") y hasta ahora se tiraba: el inventario de reliquias
 * se llevaba a mano o escaneando el inventario normal casilla a casilla, cuando esta
 * pantalla lo da todo junto y ordenado.
 *
 * No pinta nada (services/ no toca el DOM): avisa por `onApplied`.
 */

// Votos iguales que hacen falta para escribir una cantidad en el inventario. Dos y no uno
// porque una cantidad mal leída PISA la que había y no queda rastro de cuál era; dos y no
// tres porque la pantalla es estática y el tercer frame no aporta información nueva.

/**
 * Cuánto tiene que cambiar el recorte para releer, y cuántas lecturas sin novedad seguidas
 * multiplican esa exigencia. El tope se queda corto a propósito: con tolerancia muy alta un
 * scroll lento dejaría de detectarse y las reliquias nuevas no se leerían nunca.
 */
const TOLERANCIA_BASE = 6;
const TOPE_SIN_NOVEDAD = 3;

export const RelicScreenService = {
    onApplied: null,
    lastTrackedRelic: "",
    lastGridHash: null,
    lecturasSinNovedad: 0,
    lastSelHash: null,
    // nombre canónico -> Map<cantidad, votos>
    votes: new Map(),
    applied: new Map(),

    _leyendoRejilla: null,

    async process(video, dims) {
        const cambio = await this.trackSelected(video, dims);
        // La rejilla (dos pasadas de Tesseract, 2,5-3,5 s) NO bloquea el bucle: elegir una
        // reliquia y luego otra tardaba en verse lo que durase la lectura. Va detrás, una en
        // vuelo como mucho, y el tick en que cambia la selección se salta: solo se movió el marco.
        if (cambio || this._leyendoRejilla) return;
        this._leyendoRejilla = this.readGrid(video)
            .catch((e) => console.warn("[RELICS] lectura de rejilla:", e))
            .finally(() => { this._leyendoRejilla = null; });
    },

    /**
     * La reliquia que el jugador tiene puesta, para el aviso de seguimiento. Es lo que
     * hacía ScannerService.processRelicSelection; vive aquí porque es la misma pantalla.
     */
    /** @returns true si la reliquia elegida acaba de cambiar */
    async trackSelected(video, dims) {
        const worker = OCRRepository.workers[0];
        if (!worker) return false;
        const canvas = VisionService.prepareRelicSelectionCanvas(video, dims.scale);
        // Esta pasada corría en CADA frame sin corte ninguno, y es un Tesseract entero: en la
        // pantalla de reliquias era el grueso del gasto, releyendo el mismo rótulo para siempre.
        const hash = smallCanvasHash(canvas);
        if (this.lastSelHash && compareHashes(hash, this.lastSelHash, TOLERANCIA_BASE)) return false;
        this.lastSelHash = hash;
        const { data } = await OCRRepository.recognize(worker, canvas, {}, { text: true });

        const relicMatch = OCRService.parseRelicSelection(data.text);
        // Se apunta SIEMPRE que se lea, no solo cuando cambia: repetir la misma reliquia dos
        // runs seguidos también la gasta las dos veces.
        if (relicMatch) { this.reliquiaElegida = relicMatch; this.huboRecompensaPrime = false; }
        if (relicMatch && relicMatch !== this.lastTrackedRelic) {
            this.lastTrackedRelic = relicMatch;
            if (globalThis.showTrackConfirm) globalThis.showTrackConfirm(relicMatch, data.text);
            return true;
        }
        return false;
    },

    /**
     * Se descuenta solo si la misión dio recompensas prime: mirar las reliquias y jugar luego una
     * misión normal la gastaba. Se devuelve y se olvida: fin de misión se relee muchos frames.
     * @param piezasPrime el fin de misión trae alguna (la otra prueba es marcaRecompensaPrime)
     */
    reliquiaElegida: null,
    huboRecompensaPrime: false,
    marcaRecompensaPrime() {
        this.huboRecompensaPrime = true;
    },
    tomaReliquiaElegida(piezasPrime = false) {
        if (!this.huboRecompensaPrime && !piezasPrime) return null;
        const elegida = this.reliquiaElegida;
        this.reliquiaElegida = null;
        this.huboRecompensaPrime = false;
        return elegida;
    },

    /** Lee la rejilla y aplica al inventario lo que ya tenga consenso. */
    async readGrid(video) {
        const worker = OCRRepository.workers[0];
        if (!worker) return;

        // 1.25 y no 1.5: agrandar de más emborrona el trazo y Tesseract se atraganta con una
        // imagen enorme. Barrido sobre las cuatro capturas de rejilla (76 reliquias) con el banco
        // de scripts-actu/banco: 1.5 -> 48 aciertos en 5.8 s; 1.25 -> 68 en 4.5 s; 1.0 -> 58 y una
        // cantidad INVENTADA; 0.6 -> siete inventadas. O sea que el valor de antes era peor en
        // precisión Y en tiempo, y por abajo el suelo lo marca el error, no el acierto.
        const cvs = VisionService.prepareCropForOCR(video, RELIC_GRID_CROP, 1.25, "relicGrid");
        // Sin este corte se repetiría la doble pasada de OCR sobre una pantalla quieta. El
        // hash SÍ cambia al hacer scroll, que es justo cuando hay reliquias nuevas que leer.
        const hash = smallCanvasHash(cvs);
        // El fondo de esta pantalla está ANIMADO: el hash no se repite nunca, así que el corte
        // fijo dejaba pasar la doble pasada de OCR en CADA frame sobre la misma rejilla. Cuando
        // una lectura no trae nada que no esté ya aplicado, la pantalla está absorbida y se pide
        // un cambio mayor para volver a leer. Un scroll —que es cuando hay reliquias nuevas—
        // mueve todo el texto y lo supera de sobra, y al traer novedad reinicia la exigencia.
        const tolerancia = TOLERANCIA_BASE * (1 + this.lecturasSinNovedad);
        if (this.lastGridHash && compareHashes(hash, this.lastGridHash, tolerancia)) return;
        this.lastGridHash = hash;

        // La traza dice POR QUÉ se cae una casilla, que es lo único que permite diagnosticar esta
        // pantalla: con ella se vio que los nombres se leen casi todos (18 de 19) y lo que falta
        // son los contadores. Sin ella solo se sabe cuántas salieron.
        const traza = {};
        const palabras = await this.leePalabras(worker, video, cvs);
        // 5/6 en el código: el texto no lo delata (las dos reliquias existen); el glifo sí, sobre
        // el recorte a COLOR con la misma geometría que las cajas (utils/vision/relic_digit_56.js).
        let color = null;
        const recorta = ({ x0, y0, x1, y1 }) => {
            color ??= VisionService.prepareCropColorForOCR(video, RELIC_GRID_CROP, 1.25, "relicGridColor");
            const pad = 3, sx = Math.max(0, Math.floor(x0) - pad), sy = Math.max(0, Math.floor(y0) - pad);
            const sw = Math.min(color.width - sx, Math.ceil(x1 - x0) + pad * 2), sh = Math.min(color.height - sy, Math.ceil(y1 - y0) + pad * 2);
            return sw > 2 && sh > 2 ? color.getContext("2d", { willReadFrequently: true }).getImageData(sx, sy, sw, sh) : null;
        };
        const existe = (n) => (state.allRelicNames || []).includes(n);
        const matchRelic = (w) => {
            const r = corrige56(OCRService.getRelicMatch(w), w, recorta, existe);
            if (r.cambiado) console.log(`[RELICS] 5/6 por glifo: ${r.nombre} (margen ${r.margen.toFixed(2)})`);
            return r.nombre;
        };
        const read = parseRelicGrid(palabras, { matchRelic, trace: traza });
        console.log(`[RELICS] ${read.length} de ${traza.nombres} nombres · contadores ${traza.contadoresConCasilla}/${traza.candidatosContador}`,
            traza.perdidas);
        // Antes de votar: `voteReadings` escribe en `applied` y ya no se sabría qué era nuevo.
        const novedad = read.some(({ name, count }) => this.applied.get(name) !== count);
        this.lecturasSinNovedad = novedad ? 0 : Math.min(this.lecturasSinNovedad + 1, TOPE_SIN_NOVEDAD);
        if (!read.length) return;

        const changed = voteReadings(this, read);
        if (!changed.length) return;

        state.inventory = applyRelicCounts(state.inventory, changed);
        console.log("[RELICS] inventario actualizado:", changed.map((c) => `${c.name}=${c.count}`).join(", "));
        this.onApplied?.(changed);
    },

    /**
     * Nombres y contadores de la rejilla. Las dos pasadas PSM existen porque psm 6 se salta los
     * "x108" sueltos y psm 11 despedaza los nombres.
     *
     * El motor preciso lee los NOMBRES cuando está elegido: antes se probó con las dos listas y
     * leía 0 reliquias, pero era porque recibía el recorte YA invertido para Tesseract en vez de
     * a color; sobre un recorte a color aparte lee bien (medido: 70/76 contra 68/76 de Tesseract
     * solo, en las 4 capturas de tema del corpus). Los CONTADORES se quedan en Tesseract: su caja
     * por línea no basta para el emparejamiento por geometría que exige parseRelicGrid ahí.
     */
    async leePalabras(worker, video, cvs) {
        if (motorActivo() === MOTOR_PRECISO && PaddleRepository.listo()) {
            const colorCvs = VisionService.prepareCropColorForOCR(video, RELIC_GRID_CROP, 1.25, "relicGridColor");
            const [counts, palabras] = await Promise.all([
                OCRRepository.recognizeWithPSM(worker, cvs, 11, { blocks: true }),
                PaddleRepository.recognizeWordsWithBoxes(colorCvs)
                    .catch((e) => { console.warn("[RELICS] Paddle falló, leo nombres con Tesseract:", e); return null; }),
            ]);
            if (palabras?.length) {
                return { nameWords: collectWords({ words: palabras }), countWords: collectWords(counts.data) };
            }
            const names = await OCRRepository.recognize(worker, cvs, {}, { blocks: true });
            return { nameWords: collectWords(names.data), countWords: collectWords(counts.data) };
        }
        // Secuenciales a la fuerza: recognizeWithPSM cambia un parámetro DEL WORKER, así que
        // dos pasadas en paralelo sobre el mismo worker se pisarían el modo de segmentación.
        const names = await OCRRepository.recognize(worker, cvs, {}, { blocks: true });
        const counts = await OCRRepository.recognizeWithPSM(worker, cvs, 11, { blocks: true });
        return { nameWords: collectWords(names.data), countWords: collectWords(counts.data) };
    },

    /** Olvida los votos: lo llama el escáner al arrancar una sesión. */
    reset() {
        this.votes.clear();
        this.applied.clear();
        this.lastGridHash = null;
        this.lecturasSinNovedad = 0;
        this.lastSelHash = null;
        this.lastTrackedRelic = "";
        this.reliquiaElegida = null;
        this.huboRecompensaPrime = false;
    },
};


