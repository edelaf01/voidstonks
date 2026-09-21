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
 * The VOID RELICS/REFINEMENT screen: which relic goes into the mission and how many of each you
 * own ("x108"). No DOM: reports through `onApplied`.
 */

// Equal votes needed to write a count: a misread overwrites the old one with no trace.

/**
 * Hash change needed to reread, raised by each read with nothing new: the background is animated
 * and the hash never repeats. Capped so a slow scroll is still seen.
 */
const TOLERANCIA_BASE = 6;
const TOPE_SIN_NOVEDAD = 3;

export const RelicScreenService = {
    onApplied: null,
    lastTrackedRelic: "",
    lastGridHash: null,
    lecturasSinNovedad: 0,
    lastSelHash: null,
    // canonical name -> Map<count, votes>
    votes: new Map(),
    applied: new Map(),

    _leyendoRejilla: null,

    async process(video, dims) {
        const cambio = await this.trackSelected(video, dims);
        // the grid read runs behind, at most one in flight, so it does not block the loop
        if (cambio || this._leyendoRejilla) return;
        this._leyendoRejilla = this.readGrid(video)
            .catch((e) => console.warn("[RELICS] lectura de rejilla:", e))
            .finally(() => { this._leyendoRejilla = null; });
    },

    /** The relic the player has selected. Returns true when it just changed. */
    async trackSelected(video, dims) {
        const worker = OCRRepository.workers[0];
        if (!worker) return false;
        const canvas = VisionService.prepareRelicSelectionCanvas(video, dims.scale);
        const hash = smallCanvasHash(canvas);
        if (this.lastSelHash && compareHashes(hash, this.lastSelHash, TOLERANCIA_BASE)) return false;
        this.lastSelHash = hash;
        const { data } = await OCRRepository.recognize(worker, canvas, {}, { text: true });

        const relicMatch = OCRService.parseRelicSelection(data.text);
        if (relicMatch) this.reliquiaElegida = relicMatch;
        if (relicMatch && relicMatch !== this.lastTrackedRelic) {
            this.lastTrackedRelic = relicMatch;
            if (globalThis.showTrackConfirm) globalThis.showTrackConfirm(relicMatch, data.text);
            return true;
        }
        return false;
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

        // 1.25: more blurs the stroke, less invents counts (scripts-actu/banco)
        const cvs = VisionService.prepareCropForOCR(video, RELIC_GRID_CROP, 1.25, "relicGrid");
        const hash = smallCanvasHash(cvs);
        const tolerancia = TOLERANCIA_BASE * (1 + this.lecturasSinNovedad);
        if (this.lastGridHash && compareHashes(hash, this.lastGridHash, tolerancia)) return;
        this.lastGridHash = hash;

        const traza = {};
        const palabras = await this.leePalabras(worker, video, cvs);
        // 5/6 in the code: the glyph tells them apart on the color crop (utils/vision/relic_digit_56.js)
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
        // before voting: voteReadings writes into `applied`
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
     * Names and counts of the grid. Two PSM passes: psm 6 skips the loose "x108" and psm 11 breaks
     * the names. The precise engine reads the names from a separate color crop; counts stay on
     * Tesseract, which parseRelicGrid needs for the geometry.
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
        // sequential: recognizeWithPSM sets a worker parameter, so parallel passes would clash
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


