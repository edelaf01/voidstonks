import { OCRRepository } from "../../repositories/ocr.repository.js";
import { firmaTexto, mismoTexto } from "../../utils/vision/frame_hash.js";
import { esKioscoDucados, parseVentaKiosco, esDialogoVenta, parseDucados, KIOSCO_INICIAL, siguienteEstadoKiosco } from "../../utils/inventory/ducat_kiosk.js";
import { ducadosDePieza } from "../../utils/inventory/catalog_parts.js";
import { pistasDelLog } from "../../utils/ganchos.js";
import { VisionService } from "./vision.service.js";
import { OCRService } from "./ocr.service.js";

const LOG_TARDE_MS = 30_000;
const mismaLista = (a, b) => a.length === b.length && a.every((x, i) => x.name === b[i].name && x.qty === b[i].qty);

export const DucatKioskService = {
    onSale: null,
    onPanel: null,
    onSalida: null,
    esKiosco: esKioscoDucados,
    estado: KIOSCO_INICIAL,
    lastHash: null,
    releer: false,
    enKiosco: false,
    conDialogo: false,
    fuera: 0,
    vendiendo: null,
    enMesa: new Set(),

    reset() { Object.assign(this, { estado: KIOSCO_INICIAL, lastHash: null, releer: false, enKiosco: false, conDialogo: false, fuera: 0 }); },

    enContexto(kiosco) {
        if (kiosco) Object.assign(this, { enKiosco: true, fuera: 0 });
        else if ((this.enKiosco || this.enMesa.size) && ++this.fuera >= 2) {
            this.onSalida?.([...this.enMesa]);
            this.enMesa.clear();
            this.reset();
        }
        return kiosco;
    },

    confirmaPorLog(venta) {
        const foto = this.vendiendo;
        this.vendiendo = null;
        if (!foto || Date.now() - foto.t >= LOG_TARDE_MS) return console.log(this.enKiosco ? `[KIOSKO] el log vende ${venta.piezas} piezas sin una lista vista en el diálogo de venta: no se descuenta` : `[KIOSKO] el log vende ${venta.piezas} piezas fuera del kiosko o con el escáner parado: no se descuenta`);
        if (foto.descontada) return console.log(`[KIOSKO] el log confirma una venta que el panel ya descontó`);
        const piezas = foto.lista.reduce((t, i) => t + i.qty, 0);
        const ducados = foto.lista.reduce((t, i) => t + (ducadosDePieza(i.name) * i.qty || i.ducats || NaN), 0);
        if (piezas !== venta.piezas || ducados !== venta.ducados) return console.log(`[KIOSKO] el log vende ${venta.piezas} piezas por ${venta.ducados} y la lista del diálogo suma ${piezas} por ${ducados}: no se descuenta`);
        if (this.estado.lista === foto.lista) this.estado = KIOSCO_INICIAL;
        this.onSale?.(foto.lista);
    },

    noVota(name) { const v = this.vendiendo; return this.enMesa.has(name) || (!!v && !v.descontada && Date.now() - v.t < LOG_TARDE_MS && v.lista.some((i) => i.name === name)); },

    async process(video, headerText, enKiosco = esKioscoDucados(headerText)) {
        if (!enKiosco) return;
        const worker = OCRRepository.workers[0];
        if (!worker) return;
        const antes = this.estado;
        const enPanel = esKioscoDucados(headerText);
        const panel = VisionService.prepareKioskPanelCanvas(video);
        const hash = firmaTexto(panel, { x: 0, y: 0, w: 1, h: 1 });
        const forzada = this.releer;
        if (enPanel && !forzada && mismoTexto(hash, this.lastHash)) return;
        this.lastHash = enPanel ? hash : null;
        this.releer = false;

        // with the dialog open the panel is dimmed and is not read
        const centro = await OCRRepository.recognize(worker, VisionService.prepareCenterDialogCanvas(video), {}, { text: true });
        const dialogo = this.conDialogo = esDialogoVenta(centro.data.text);
        if (!dialogo && !enPanel) {
            this.estado = { ...this.estado, enDialogo: false };
            return;
        }
        let items = null, ducados = null;
        if (!dialogo) {
            const { data } = await OCRRepository.recognize(worker, panel, {}, { text: true });
            items = parseVentaKiosco((data.text || "").split("\n"), (palabras) => OCRService.getValidItemMatch(palabras)?.originalName || null);
            for (const { name } of items) this.enMesa.add(name);
            this.releer = items.length === 0 && !forzada;
            const barra = await OCRRepository.recognizeWithPSM(worker, VisionService.prepareCurrencyBarCanvas(video), 7, { text: true });
            ducados = parseDucados(barra.data.text);
            console.log(`[KIOSKO] panel: ${JSON.stringify((data.text || "").trim())} -> ${items.map((i) => `${i.qty}x ${i.name}`).join(", ") || "nada"} · ducados ${ducados ?? "?"}`);
            this.onPanel?.(items);
        }
        if (this.estado !== antes) return;
        const guardada = this.vendiendo?.vista && Date.now() - this.vendiendo.t < LOG_TARDE_MS;
        if (dialogo && this.estado.lista.length && !guardada) this.vendiendo = { lista: this.estado.lista, t: Date.now() };
        if (!dialogo && this.vendiendo && !this.vendiendo.vista) {
            const veces = items.length && mismaLista(items, this.vendiendo.lista) ? (this.vendiendo.veces || 0) + 1 : 0;
            this.vendiendo = veces >= 2 || (items.length && !veces) ? null : { ...this.vendiendo, veces };
        }
        const { estado, venta } = siguienteEstadoKiosco(this.estado, { items, dialogo, ducados });
        this.estado = estado;
        if (!venta) return;
        if (pistasDelLog.logLeyendo()) {
            this.vendiendo &&= { ...this.vendiendo, vista: true };
            return;
        }
        this.vendiendo &&= { ...this.vendiendo, descontada: true };
        this.onSale?.(venta);
    },
};
