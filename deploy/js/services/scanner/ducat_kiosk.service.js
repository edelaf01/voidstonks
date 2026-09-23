import { OCRRepository } from "../../repositories/ocr.repository.js";
import { smallCanvasHash, compareHashes } from "../../utils/vision/frame_hash.js";
import { esKioscoDucados, parseVentaKiosco, esDialogoVenta, parseDucados, KIOSCO_INICIAL, siguienteEstadoKiosco } from "../../utils/inventory/ducat_kiosk.js";
import { VisionService } from "./vision.service.js";
import { OCRService } from "./ocr.service.js";

/**
 * Follows the ducat kiosk sell panel and fires `onSale` when a sale is confirmed
 * (logic in utils/inventory/ducat_kiosk.js).
 */
export const DucatKioskService = {
    onSale: null,
    onPanel: null, // (items) on every panel read
    esKiosco: esKioscoDucados,
    estado: KIOSCO_INICIAL,
    lastHash: null,
    releer: false,

    reset() { this.estado = KIOSCO_INICIAL; this.lastHash = null; this.releer = false; },

    /**
     * `headerText` is the title the scanner already read: the kiosk is the inventory screen with
     * another title.
     */
    async process(video, headerText) {
        if (!esKioscoDucados(headerText)) return;
        const worker = OCRRepository.workers[0];
        if (!worker) return;
        const panel = VisionService.prepareKioskPanelCanvas(video);
        const hash = smallCanvasHash(panel);
        // the panel is only reread when it changes, except to confirm an empty read, which the state
        // machine needs twice
        const forzada = this.releer;
        if (!forzada && compareHashes(hash, this.lastHash)) return;
        this.lastHash = hash;
        this.releer = false;

        // with the dialog open the panel is dimmed and is not read
        const centro = await OCRRepository.recognize(worker, VisionService.prepareCenterDialogCanvas(video), {}, { text: true });
        const dialogo = esDialogoVenta(centro.data.text);
        let items = null, ducados = null;
        if (!dialogo) {
            const { data } = await OCRRepository.recognize(worker, panel, {}, { text: true });
            items = parseVentaKiosco((data.text || "").split("\n"), (palabras) => OCRService.getValidItemMatch(palabras)?.originalName || null);
            this.releer = items.length === 0 && !forzada; // one reread, not a loop on an empty panel
            const barra = await OCRRepository.recognizeWithPSM(worker, VisionService.prepareCurrencyBarCanvas(video), 7, { text: true });
            ducados = parseDucados(barra.data.text);
            console.log(`[KIOSKO] panel: ${JSON.stringify((data.text || "").trim())} -> ${items.map((i) => `${i.qty}x ${i.name}`).join(", ") || "nada"} · ducados ${ducados ?? "?"}`);
            this.onPanel?.(items);
        }
        const { estado, venta } = siguienteEstadoKiosco(this.estado, { items, dialogo, ducados });
        this.estado = estado;
        if (venta) this.onSale?.(venta);
    },
};
