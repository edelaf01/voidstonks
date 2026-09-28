import { state } from "../../state.js";
import { OCRRepository } from "../../repositories/ocr.repository.js";
import { getPriceValue } from "../../repositories/storage.repository.js";
import { getSlug } from "../../utils/slugs.utils.js";
import { getSetName, getRequiredCount } from "../../utils/ui_utils.js";
import { squadRunOutlook } from "../../utils/inventory/squad_run.js";
import {
    SQUAD_STRIP_CROP, PAUSE_MENU_CROP, isPauseScreen, parseSquadRelics,
} from "../../utils/vision/squad_panel.js";
import { smallCanvasHash, compareHashes } from "../../utils/vision/frame_hash.js";
import { hayPistaMenuPausa } from "../../utils/vision/pause_menu_hint.js";
import { collectWords } from "../../utils/vision/ocr_words.js";
import { VisionService } from "./vision.service.js";
import { OCRService } from "./ocr.service.js";
import { RelicScreenService } from "./relic_screen.service.js";

/**
 * What the squad carries in the current run, read from the PAUSE screen, so it shows from the first
 * ESC. No DOM: writes state.squadRun and notifies `onUpdate` (ui.components/ui_squad_run.js).
 */
export const SquadService = {
    PROBE_INTERVAL_MS: 1500,
    // without a menu hint the OCR still runs, at this slower rate
    PROBE_SIN_PISTA_MS: 10000,
    PRICE_TIMEOUT_MS: 2500,

    onUpdate: null,
    // receives the strip canvas so the DIAG panel shows what the OCR reads
    onDebugFrame: null,
    lastProbeTime: 0,
    lastProbeOcrTime: 0,
    _pistaPrevia: null,
    lastStripHash: null,
    // the verdict is cached with the rate: false between probes let the pause screen reach the relic
    // selection pipeline
    lastVerdict: false,

    /**
     * Whether this is the pause screen; if so, reads the relics and publishes the run.
     * True even with no relics: the frame is identified.
     */
    async probe(video, { aCiegas = true } = {}) {
        const now = Date.now();
        if (now - this.lastProbeTime < this.PROBE_INTERVAL_MS) return this.lastVerdict;
        this.lastProbeTime = now;

        const worker = OCRRepository.workers[0];
        if (!worker) return false;

        // pixel test before OCR (utils/vision/pause_menu_hint.js): the hint only decides whether to pay for it
        const pista = hayPistaMenuPausa(video);
        if (pista.ok !== this._pistaPrevia) {
            this._pistaPrevia = pista.ok;
            console.log(`[SQUAD] pista de menú de pausa: ${pista.ok ? "sí" : "no"} (bandas=${pista.bandas} alturas=[${pista.alturas}] pasos=[${pista.pasos}] umbral=${pista.umbral})`);
        }
        if (!pista.ok && (!aCiegas || now - this.lastProbeOcrTime < this.PROBE_SIN_PISTA_MS)) return (this.lastVerdict = false);
        this.lastProbeOcrTime = now;

        const menuCvs = VisionService.prepareCropForOCR(video, PAUSE_MENU_CROP, 0.5, "pauseMenu");
        const { data: menuData } = await OCRRepository.recognize(worker, menuCvs, {}, { text: true });
        const yaEnPausa = this.lastVerdict;
        this.lastVerdict = isPauseScreen(menuData.text);
        if (!this.lastVerdict) return false;
        // one relic can change between pauses without moving the strip hash
        if (!yaEnPausa) this.lastStripHash = null;

        const stripCvs = VisionService.prepareCropForOCR(video, SQUAD_STRIP_CROP, 1.5, "squadStrip");
        this.onDebugFrame?.(stripCvs);
        const hash = smallCanvasHash(stripCvs);
        if (this.lastStripHash && compareHashes(hash, this.lastStripHash, 6)) return true;
        this.lastStripHash = hash;

        const { data } = await OCRRepository.recognize(worker, stripCvs, {}, { blocks: true });
        const relics = parseSquadRelics(collectWords(data), { matchRelic: (w) => OCRService.getRelicMatch(w) });
        console.log(`[SQUAD] ${relics.length} reliquias en el run:`, relics.map((r) => `${r.name} (${r.refinement || "?"})`).join(", "));
        if (!relics.length) return true;
        // the pause shows your relic as is: fixes a misread SELECT RELIC
        const propia = relics.find((r) => r.propia);
        if (propia) RelicScreenService.reliquiaElegida = propia.name.toUpperCase().replace(/\s+RELIC$/, "");

        this.publish(relics, squadRunOutlook(relics, this.deps()));
        // publish first with the prices in memory, repaint when the rest resolve
        this.withPrices(relics).catch((e) => console.warn("[SQUAD] sin precios:", e));
        return true;
    },

    publish(relics, outlook) {
        state.squadRun = { ...outlook, relics: outlook.relics.length ? outlook.relics : relics, at: Date.now() };
        this.onUpdate?.(state.squadRun);
    },

    clear() {
        if (!state.squadRun) return;
        state.squadRun = null;
        this.lastStripHash = null;
        this.onUpdate?.(null);
    },

    deps(prices = new Map()) {
        return {
            relicsDatabase: state.relicsDatabase || {},
            setsDatabase: state.setsDatabase || {},
            primeInventory: state.primeInventory || {},
            getSetName,
            getRequiredCount,
            getPrice: (name) => prices.get(name) || 0,
        };
    },

    /**
     * Recomputes the run with resolved prices. Needs the sibling parts: a part that closes a set is
     * worth the set minus its loose parts (rewardValue).
     */
    async withPrices(relics) {
        const names = new Set();
        for (const relic of relics) {
            for (const drop of state.relicsDatabase?.[relic.name] || []) {
                names.add(drop.name);
                const setName = getSetName(drop.name);
                if (!setName || setName === "Otros" || setName === "Others") continue;
                names.add(`${setName} Set`);
                for (const part of state.setsDatabase?.[setName] || []) names.add(part);
            }
        }

        const prices = new Map();
        const lookups = [...names].map(async (name) => {
            try { prices.set(name, (await getPriceValue(name, getSlug(name))) || 0); }
            catch (e) { console.warn("[SQUAD] sin precio para", name, e); }
        });
        await Promise.race([
            Promise.all(lookups),
            new Promise((resolve) => setTimeout(resolve, this.PRICE_TIMEOUT_MS)),
        ]);

        // the player may have left the pause while prices resolved
        if (!state.squadRun) return;
        this.publish(relics, squadRunOutlook(relics, this.deps(prices)));
    },
};
