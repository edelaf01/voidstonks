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
import { collectWords } from "../../utils/vision/ocr_words.js";
import { VisionService } from "./vision.service.js";
import { OCRService } from "./ocr.service.js";

/**
 * Qué lleva la escuadra en el run que está en curso, leído de la pantalla de PAUSA.
 *
 * La pantalla de recompensas llega al final y ya no da margen para decidir nada: las
 * reliquias del squad se ven desde el primer ESC, así que se leen ahí y el panel se
 * mantiene hasta que el run termina.
 *
 * No pinta nada (services/ no toca el DOM): deja el resultado en state.squadRun y avisa
 * por `onUpdate`, que engancha ui.components/ui_squad_run.js.
 */
export const SquadService = {
    // Ritmo del sondeo. El OCR del menú es barato (recorte pequeño y letra enorme) pero se
    // paga en TODOS los frames sin contexto, que es la mayor parte del tiempo de juego.
    PROBE_INTERVAL_MS: 1500,
    PRICE_TIMEOUT_MS: 2500,

    onUpdate: null,
    // Recibe el canvas de la franja para que el panel DIAG enseñe lo que lee el OCR. Sin
    // esto no había forma de distinguir "no detecta la pausa" de "detecta y no lee nada".
    onDebugFrame: null,
    lastProbeTime: 0,
    lastStripHash: null,
    // El veredicto se cachea junto con el ritmo: devolver false mientras se espera al
    // siguiente sondeo dejaba pasar la pantalla de pausa al pipeline normal, y con el
    // contexto en RELICS eso significa que processRelicSelection leía una reliquia del
    // SQUAD y la ofrecía como si el jugador la hubiera elegido.
    lastVerdict: false,

    /**
     * ¿Es esta la pantalla de pausa? Si lo es, lee las reliquias y publica el run.
     * @returns true si la pantalla es de pausa (aunque no hubiera reliquias que leer:
     *          el frame ya está identificado y no hay que seguir probando otras cosas).
     */
    async probe(video) {
        const now = Date.now();
        if (now - this.lastProbeTime < this.PROBE_INTERVAL_MS) return this.lastVerdict;
        this.lastProbeTime = now;

        const worker = OCRRepository.workers[0];
        if (!worker) return false;

        const menuCvs = VisionService.prepareCropForOCR(video, PAUSE_MENU_CROP, 0.5, "pauseMenu");
        const { data: menuData } = await OCRRepository.recognize(worker, menuCvs, {}, { text: true });
        this.lastVerdict = isPauseScreen(menuData.text);
        if (!this.lastVerdict) return false;

        const stripCvs = VisionService.prepareCropForOCR(video, SQUAD_STRIP_CROP, 1.5, "squadStrip");
        this.onDebugFrame?.(stripCvs);
        // La pausa se queda quieta mientras el jugador lee el menú: sin este corte se
        // repetiría el OCR de la franja —y la resolución de precios— cada 1,5 s.
        const hash = smallCanvasHash(stripCvs);
        if (this.lastStripHash && compareHashes(hash, this.lastStripHash, 6)) return true;
        this.lastStripHash = hash;

        const { data } = await OCRRepository.recognize(worker, stripCvs, {}, { blocks: true });
        const relics = parseSquadRelics(collectWords(data), { matchRelic: (w) => OCRService.getRelicMatch(w) });
        console.log(`[SQUAD] ${relics.length} reliquias en el run:`, relics.map((r) => `${r.name} (${r.refinement || "?"})`).join(", "));
        if (!relics.length) return true;

        this.publish(relics, squadRunOutlook(relics, this.deps()));
        // Los precios llegan de IndexedDB/red y el panel no puede esperarlos: se publica
        // primero con lo que haya en memoria y se repinta cuando estén.
        this.withPrices(relics).catch((e) => console.warn("[SQUAD] sin precios:", e));
        return true;
    },

    publish(relics, outlook) {
        state.squadRun = { ...outlook, relics: outlook.relics.length ? outlook.relics : relics, at: Date.now() };
        this.onUpdate?.(state.squadRun);
    },

    /** Vacía el run: lo llama el escáner cuando aparece la pantalla de recompensas. */
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
     * Recalcula el run con los precios ya resueltos.
     *
     * Hacen falta las piezas HERMANAS de cada premio, no solo el premio: la prima de cerrar
     * un set es lo que vale el set menos lo que valen sus piezas sueltas (ver rewardValue),
     * así que sin ellas una pieza que cierra set valdría lo mismo que una cualquiera.
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

        // El jugador puede haber salido de la pausa (o del run) mientras se resolvían.
        if (!state.squadRun) return;
        this.publish(relics, squadRunOutlook(relics, this.deps(prices)));
    },
};
