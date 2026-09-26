import { state } from "../../state.js";
import { OCRRepository } from "../../repositories/ocr.repository.js";
import { PaddleRepository } from "../../repositories/paddle.repository.js";
import { RELIC_GRID_CROP, parseRelicGrid } from "../../utils/vision/relic_grid.js";
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

    async process(video, dims) {
        const cambio = await this.trackSelected(video, dims);
        if (cambio || this._leyendoRejilla) return;
        this._leyendoRejilla = this.readGrid(video)
            .catch((e) => console.warn("[RELICS] lectura de rejilla:", e))
            .finally(() => { this._leyendoRejilla = null; });
    },

    async trackSelected(video, dims) {
        const worker = OCRRepository.workers[0];
        if (!worker) return false;
        const canvas = VisionService.prepareRelicSelectionCanvas(video, dims.scale);
        const hash = smallCanvasHash(canvas);
        if (this.lastSelHash && compareHashes(hash, this.lastSelHash, TOLERANCIA_BASE)) return false;
        this.lastSelHash = hash;
        const { data } = await OCRRepository.recognize(worker, canvas, {}, { text: true, blocks: true });

        const palabras = collectWords(data);
        const relicMatch = OCRService.parseRelicSelection(data.text, palabras);
        if (relicMatch && filaPropiaDelEscuadron(palabras) !== null) { this.reliquiaElegida = relicMatch; this.huboRecompensaPrime = false; }
        else if (relicMatch === "") this.reliquiaElegida = null;
        if (relicMatch && relicMatch !== this.lastTrackedRelic) {
            this.lastTrackedRelic = relicMatch;
            if (globalThis.showTrackConfirm) globalThis.showTrackConfirm(relicMatch, data.text);
            return true;
        }
        return false;
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
        if (elegida) this.lastSelHash = null;
        return elegida;
    },

    async readGrid(video) {
        const worker = OCRRepository.workers[0];
        if (!worker) return;

        // scale 1.25: more blurs the stroke, less invents counts
        const cvs = VisionService.prepareCropForOCR(video, RELIC_GRID_CROP, 1.25, "relicGrid");
        const hash = smallCanvasHash(cvs);
        const tolerancia = TOLERANCIA_BASE * (1 + this.lecturasSinNovedad);
        if (this.lastGridHash && compareHashes(hash, this.lastGridHash, tolerancia)) return;
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
        if (!read.length) return;

        const changed = voteReadings(this, read);
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
        this.lecturasSinNovedad = 0;
        this.lastSelHash = null;
        this.lastTrackedRelic = "";
        this.reliquiaElegida = null;
        this.huboRecompensaPrime = false;
    },
};


