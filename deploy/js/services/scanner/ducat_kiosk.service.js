import { OCRRepository } from "../../repositories/ocr.repository.js";
import { smallCanvasHash, compareHashes } from "../../utils/vision/frame_hash.js";
import { esKioscoDucados, parseVentaKiosco, esDialogoVenta, parseDucados, KIOSCO_INICIAL, siguienteEstadoKiosco } from "../../utils/inventory/ducat_kiosk.js";
import { VisionService } from "./vision.service.js";
import { OCRService } from "./ocr.service.js";

/**
 * Sigue el panel de venta del kiosko de ducados y avisa por `onSale` cuando una venta se
 * confirma (la lógica está en utils/inventory/ducat_kiosk.js). No pinta nada: services/ no
 * toca el DOM.
 */
export const DucatKioskService = {
    onSale: null,
    onPanel: null, // (items) cada vez que se lee el panel, para enseñar lo que hay a la venta
    esKiosco: esKioscoDucados,
    estado: KIOSCO_INICIAL,
    lastHash: null,
    releer: false,

    reset() { this.estado = KIOSCO_INICIAL; this.lastHash = null; this.releer = false; },

    /** `headerText` es el rótulo ya leído por el escáner: el kiosko es la pantalla de inventario con otro título. */
    async process(video, headerText) {
        if (!esKioscoDucados(headerText)) return;
        const worker = OCRRepository.workers[0];
        if (!worker) return;
        const panel = VisionService.prepareKioskPanelCanvas(video);
        const hash = smallCanvasHash(panel);
        // El panel solo se relee cuando cambia; la excepción es confirmar una lectura vacía, que
        // la máquina de estados exige dos veces y el hash quieto no daría nunca la segunda.
        const forzada = this.releer;
        if (!forzada && compareHashes(hash, this.lastHash)) return;
        this.lastHash = hash;
        this.releer = false;

        // Con el diálogo abierto el panel está atenuado y no se lee: solo se apunta que está.
        const centro = await OCRRepository.recognize(worker, VisionService.prepareCenterDialogCanvas(video), {}, { text: true });
        const dialogo = esDialogoVenta(centro.data.text);
        let items = null, ducados = null;
        if (!dialogo) {
            const { data } = await OCRRepository.recognize(worker, panel, {}, { text: true });
            items = parseVentaKiosco((data.text || "").split("\n"), (palabras) => OCRService.getValidItemMatch(palabras)?.originalName || null);
            this.releer = items.length === 0 && !forzada; // una relectura, no un bucle sobre el panel vacío
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
