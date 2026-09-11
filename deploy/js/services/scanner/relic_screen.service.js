import { state } from "../../state.js";
import { OCRRepository } from "../../repositories/ocr.repository.js";
import { PaddleRepository } from "../../repositories/paddle.repository.js";
import { RELIC_GRID_CROP, parseRelicGrid } from "../../utils/vision/relic_grid.js";
import { voteReadings, applyRelicCounts } from "../../utils/inventory/relic_votes.js";
import { smallCanvasHash, compareHashes } from "../../utils/vision/frame_hash.js";
import { collectWords } from "../../utils/vision/ocr_words.js";
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

    async process(video, dims) {
        await this.trackSelected(video, dims);
        await this.readGrid(video);
    },

    async trackSelected(video, dims) {
        const worker = OCRRepository.workers[0];
        if (!worker) return;
        const canvas = VisionService.prepareRelicSelectionCanvas(video, dims.scale);
        const hash = smallCanvasHash(canvas);
        if (this.lastSelHash && compareHashes(hash, this.lastSelHash, TOLERANCIA_BASE)) return;
        this.lastSelHash = hash;
        const { data } = await OCRRepository.recognize(worker, canvas, {}, { text: true });

        const relicMatch = OCRService.parseRelicSelection(data.text);
        if (relicMatch) this.reliquiaElegida = relicMatch;
        if (relicMatch && relicMatch !== this.lastTrackedRelic) {
            this.lastTrackedRelic = relicMatch;
            if (globalThis.showTrackConfirm) globalThis.showTrackConfirm(relicMatch, data.text);
        }
    },

    reliquiaElegida: null,
    tomaReliquiaElegida() {
        const elegida = this.reliquiaElegida;
        this.reliquiaElegida = null;
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
        const read = parseRelicGrid(await this.leePalabras(worker, video, cvs),
            { matchRelic: (w) => OCRService.getRelicMatch(w), trace: traza });
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
    },
};


