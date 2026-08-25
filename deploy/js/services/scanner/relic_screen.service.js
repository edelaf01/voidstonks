import { state } from "../../state.js";
import { OCRRepository } from "../../repositories/ocr.repository.js";
import { RELIC_GRID_CROP, parseRelicGrid } from "../../utils/vision/relic_grid.js";
import { relicKey } from "../../utils/inventory/relic_counts.js";
import { smallCanvasHash, compareHashes } from "../../utils/vision/frame_hash.js";
import { collectWords } from "../../utils/vision/ocr_words.js";
import { VisionService } from "./vision.service.js";
import { OCRService } from "./ocr.service.js";

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
const VOTES_TO_APPLY = 2;

export const RelicScreenService = {
    onApplied: null,
    lastTrackedRelic: "",
    lastGridHash: null,
    // nombre canónico -> Map<cantidad, votos>
    votes: new Map(),
    applied: new Map(),

    async process(video, dims) {
        await this.trackSelected(video, dims);
        await this.readGrid(video);
    },

    /**
     * La reliquia que el jugador tiene puesta, para el aviso de seguimiento. Es lo que
     * hacía ScannerService.processRelicSelection; vive aquí porque es la misma pantalla.
     */
    async trackSelected(video, dims) {
        const worker = OCRRepository.workers[0];
        if (!worker) return;
        const canvas = VisionService.prepareRelicSelectionCanvas(video, dims.scale);
        const { data } = await OCRRepository.recognize(worker, canvas, {}, { text: true });

        const relicMatch = OCRService.parseRelicSelection(data.text);
        if (relicMatch && relicMatch !== this.lastTrackedRelic) {
            this.lastTrackedRelic = relicMatch;
            if (globalThis.showTrackConfirm) globalThis.showTrackConfirm(relicMatch, data.text);
        }
    },

    /** Lee la rejilla y aplica al inventario lo que ya tenga consenso. */
    async readGrid(video) {
        const worker = OCRRepository.workers[0];
        if (!worker) return;

        const cvs = VisionService.prepareCropForOCR(video, RELIC_GRID_CROP, 1.5, "relicGrid");
        // Sin este corte se repetiría la doble pasada de OCR sobre una pantalla quieta. El
        // hash SÍ cambia al hacer scroll, que es justo cuando hay reliquias nuevas que leer.
        const hash = smallCanvasHash(cvs);
        if (this.lastGridHash && compareHashes(hash, this.lastGridHash, 6)) return;
        this.lastGridHash = hash;

        // Secuenciales a la fuerza: recognizeWithPSM cambia un parámetro DEL WORKER, así que
        // dos pasadas en paralelo sobre el mismo worker se pisarían el modo de segmentación.
        const names = await OCRRepository.recognize(worker, cvs, {}, { blocks: true });
        const counts = await OCRRepository.recognizeWithPSM(worker, cvs, 11, { blocks: true });

        const read = parseRelicGrid(
            { nameWords: collectWords(names.data), countWords: collectWords(counts.data) },
            { matchRelic: (w) => OCRService.getRelicMatch(w) },
        );
        console.log(`[RELICS] ${read.length} reliquias con cantidad en pantalla`);
        if (!read.length) return;

        const changed = [];
        for (const { name, count } of read) {
            let byCount = this.votes.get(name);
            if (!byCount) { byCount = new Map(); this.votes.set(name, byCount); }
            const n = (byCount.get(count) || 0) + 1;
            byCount.set(count, n);
            if (n < VOTES_TO_APPLY || this.applied.get(name) === count) continue;
            this.applied.set(name, count);
            changed.push({ name, count });
        }
        if (!changed.length) return;

        applyCounts(changed);
        console.log("[RELICS] inventario actualizado:", changed.map((c) => `${c.name}=${c.count}`).join(", "));
        this.onApplied?.(changed);
    },

    /** Olvida los votos: lo llama el escáner al arrancar una sesión. */
    reset() {
        this.votes.clear();
        this.applied.clear();
        this.lastGridHash = null;
        this.lastTrackedRelic = "";
    },
};

/**
 * Escribe las cantidades en state.inventory.
 *
 * Se hace entrada a entrada y no con mergeRelicCounts porque aquí solo se han leído las
 * reliquias VISIBLES en la rejilla: reconstruir el array entero desde lo escaneado dejaría
 * fuera todo lo que no cabe en pantalla.
 */
function applyCounts(changed) {
    if (!Array.isArray(state.inventory)) state.inventory = [];
    // El formato viejo (strings repetidos) no se puede actualizar en sitio: se convierte,
    // que es lo mismo que hace state.js en cuanto se pulsa un +/-.
    if (state.inventory.some((i) => typeof i === "string")) {
        const counts = new Map();
        for (const i of state.inventory) {
            const name = typeof i === "string" ? i : i?.name;
            if (!name) continue;
            const prev = counts.get(relicKey(name));
            if (prev) prev.count += typeof i === "string" ? 1 : Number(i.count) || 1;
            else counts.set(relicKey(name), { name, count: typeof i === "string" ? 1 : Number(i.count) || 1 });
        }
        state.inventory = [...counts.values()];
    }

    const byKey = new Map(state.inventory.map((i) => [relicKey(i?.name), i]));
    for (const { name, count } of changed) {
        const existing = byKey.get(relicKey(name));
        if (existing) existing.count = count;
        else if (count > 0) {
            const entry = { name, count };
            state.inventory.push(entry);
            byKey.set(relicKey(name), entry);
        }
    }
    state.inventory = state.inventory.filter((i) => (Number(i?.count) || 0) > 0);
}
