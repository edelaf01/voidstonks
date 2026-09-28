import { state } from "../../state.js";
import { OCRRepository } from "../../repositories/ocr.repository.js";
import { PaddleRepository } from "../../repositories/paddle.repository.js";
import { RELIC_GRID_CROP, RELIC_TITLE_CROP, parseRelicGrid, reliquiaDelTitulo } from "../../utils/vision/relic_grid.js";
import { voteReadings, applyRelicCounts } from "../../utils/inventory/relic_votes.js";
import { smallCanvasHash, compareHashes } from "../../utils/vision/frame_hash.js";
import { collectWords, filaPropiaDelEscuadron } from "../../utils/vision/ocr_words.js";
import { corrige56 } from "../../utils/vision/relic_digit_56.js";
import { VisionService } from "./vision.service.js";
import { OCRService } from "./ocr.service.js";
import { motorActivo, MOTOR_PRECISO } from "./ocr_engine.service.js";

const TOLERANCIA_BASE = 6;
const TOPE_SIN_NOVEDAD = 3;

export const RelicScreenService = {
    onApplied: null,
    lastTrackedRelic: "",
    lastGridHash: null,
    lecturasSinNovedad: 0,
    lastSelHash: null,
    votes: new Map(),
    applied: new Map(),

    _leyendoRejilla: null,

    async process(video, dims, opciones = {}) {
        const cambio = await this.trackSelected(video, dims, opciones);
        if (cambio || this._leyendoRejilla) return;
        this._leyendoRejilla = this.readGrid(video)
            .catch((e) => console.warn("[RELICS] lectura de rejilla:", e))
            .finally(() => { this._leyendoRejilla = null; });
    },

    async trackSelected(video, dims, { menu = false } = {}) {
        const worker = OCRRepository.workers[0];
        if (!worker) return false;
        if (!menu && video?.videoWidth && Date.now() - this._tituloT >= 1500) {
            this._tituloT = Date.now();
            const { data } = await OCRRepository.recognize(worker, VisionService.prepareCropForOCR(video, RELIC_TITLE_CROP, 1, "relicTitle"), {}, { text: true });
            const titulo = reliquiaDelTitulo(data.text, (w) => OCRService.getRelicMatch(w));
            if (titulo) return this._apunta(titulo.toUpperCase().replace(/\s+RELIC$/, ""), true, data.text);
        }
        const canvas = VisionService.prepareRelicSelectionCanvas(video, dims.scale);
        const hash = smallCanvasHash(canvas);
        if (this.lastSelHash && compareHashes(hash, this.lastSelHash, TOLERANCIA_BASE)) return false;
        this.lastSelHash = hash;
        const { data } = await OCRRepository.recognize(worker, canvas, {}, { text: true, blocks: true });

        const palabras = collectWords(data);
        const escuadra = filaPropiaDelEscuadron(palabras);
        if (!menu && escuadra === null) { this.lastSelHash = null; return false; }
        const relicMatch = OCRService.parseRelicSelection(data.text, palabras);
        if (relicMatch === "") this.reliquiaElegida = null;
        return relicMatch ? this._apunta(relicMatch, escuadra !== null, data.text) : false;
    },

    _tituloT: 0,

    _apunta(relic, elegida, texto) {
        if (elegida) { this.reliquiaElegida = relic; this.huboRecompensaPrime = false; }
        if (relic === this.lastTrackedRelic) return false;
        this.lastTrackedRelic = relic;
        if (globalThis.showTrackConfirm) globalThis.showTrackConfirm(relic, texto);
        return true;
    },

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
        if (elegida) { this.lastSelHash = null; this.lastTrackedRelic = ""; }
        return elegida;
    },

    async readGrid(video) {
        const worker = await OCRRepository.workerDeFondo();
        if (!worker) return;

        // scale 1.25: more blurs the stroke, less invents counts
        const cvs = VisionService.prepareCropForOCR(video, RELIC_GRID_CROP, 1.25, "relicGrid");
        const hash = smallCanvasHash(cvs);
        const tolerancia = TOLERANCIA_BASE * (1 + this.lecturasSinNovedad);
        if (this.lastGridHash && compareHashes(hash, this.lastGridHash, tolerancia) && !this._porConfirmar) return;
        this.lastGridHash = hash;

        const traza = {};
        const palabras = await this.leePalabras(worker, video, cvs);
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
        const novedad = read.some(({ name, count }) => this.applied.get(name) !== count);
        this.lecturasSinNovedad = novedad ? 0 : Math.min(this.lecturasSinNovedad + 1, TOPE_SIN_NOVEDAD);

        const changed = voteReadings(this, read);
        this._porConfirmar = novedad && !changed.length && !this._porConfirmar;
        if (!changed.length) return;

        state.inventory = applyRelicCounts(state.inventory, changed);
        console.log("[RELICS] inventario actualizado:", changed.map((c) => `${c.name}=${c.count}`).join(", "));
        this.onApplied?.(changed);
    },

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
        const names = await OCRRepository.recognize(worker, cvs, {}, { blocks: true });
        const counts = await OCRRepository.recognizeWithPSM(worker, cvs, 11, { blocks: true });
        return { nameWords: collectWords(names.data), countWords: collectWords(counts.data) };
    },

    reset() {
        this.votes.clear();
        this.applied.clear();
        this.lastGridHash = null;
        this._porConfirmar = false;
        this.lecturasSinNovedad = 0;
        this.lastSelHash = null;
        this._tituloT = 0;
        this.lastTrackedRelic = "";
        this.reliquiaElegida = null;
        this.huboRecompensaPrime = false;
    },
};


