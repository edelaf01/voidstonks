import { state } from "../../state.js";
import { OCRRepository } from "../../repositories/ocr.repository.js";
import { RELIC_GRID_CROP, parseRelicGrid } from "../../utils/vision/relic_grid.js";
import { relicKey } from "../../utils/inventory/relic_counts.js";
import { smallCanvasHash, compareHashes } from "../../utils/vision/frame_hash.js";
import { collectWords } from "../../utils/vision/ocr_words.js";
import { VisionService } from "./vision.service.js";
import { OCRService } from "./ocr.service.js";

/**
 * The VOID RELICS/REFINEMENT screen: which relic goes into the mission and how many of each you
 * own ("x108"). No DOM: reports through `onApplied`.
 */

// Equal votes needed to write a count: a misread overwrites the old one with no trace.
const VOTES_TO_APPLY = 2;

export const RelicScreenService = {
    onApplied: null,
    lastTrackedRelic: "",
    lastGridHash: null,
    // canonical name -> Map<count, votes>
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
        const { data } = await OCRRepository.recognize(worker, canvas, {}, { text: true });

        const relicMatch = OCRService.parseRelicSelection(data.text);
        if (relicMatch && relicMatch !== this.lastTrackedRelic) {
            this.lastTrackedRelic = relicMatch;
            if (globalThis.showTrackConfirm) globalThis.showTrackConfirm(relicMatch, data.text);
        }
    },

    async readGrid(video) {
        const worker = OCRRepository.workers[0];
        if (!worker) return;

        const cvs = VisionService.prepareCropForOCR(video, RELIC_GRID_CROP, 1.5, "relicGrid");
        const hash = smallCanvasHash(cvs);
        if (this.lastGridHash && compareHashes(hash, this.lastGridHash, 6)) return;
        this.lastGridHash = hash;

        // sequential: recognizeWithPSM sets a worker parameter, so parallel passes would clash
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

    reset() {
        this.votes.clear();
        this.applied.clear();
        this.lastGridHash = null;
        this.lastTrackedRelic = "";
    },
};

function applyCounts(changed) {
    if (!Array.isArray(state.inventory)) state.inventory = [];
    // the old format (repeated strings) cannot be updated in place: convert it, like state.js on +/-
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
