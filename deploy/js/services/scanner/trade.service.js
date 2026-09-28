import { OCRRepository } from "../../repositories/ocr.repository.js";
import { MEMORY_CACHE } from "../../repositories/storage.repository.js";
import { casillaTradeo, leeCasillaTradeo, leeDialogoTradeo, dialogoTradeo, esTradeoHecho, TEXTURA_OCUPADA, BRILLO_CON_DIALOGO } from "../../utils/vision/trade_post.js";
import { FRANJA_TITULO_VIDEO } from "../../utils/vision/context_latch.js";
import { muestraMaxCanal, smallCanvasHash, compareHashes } from "../../utils/vision/frame_hash.js";
import { textura } from "../../utils/vision/title_catalog.js";
import { getSlug } from "../../utils/slugs.utils.js";
import { loadVosforData } from "../vosfor.service.js";
import { VisionService } from "./vision.service.js";
import { OCRService } from "./ocr.service.js";

const conPrecio = (item) => ({ ...item, plat: item.tipo === "prime" ? Number(MEMORY_CACHE.get(getSlug(item.name))) || null : null });
const rotuloApagado = (video) => Math.max(...muestraMaxCanal(video, FRANJA_TITULO_VIDEO, 128, 8)) < BRILLO_CON_DIALOGO;
const ESPERA_DIALOGO_MS = 120000;

export const TradeService = {
    onUpdate: null,
    onTrade: null,
    ultimo: null,
    _mesaT: 0,
    _confirmada: null,
    _casillas: new Map(),
    _clave: "",
    _dialogoHash: null,

    async process(video) {
        const worker = OCRRepository.workers[0];
        if (!worker || !video?.videoWidth) return;
        const tradables = (await loadVosforData().catch(() => null))?.tradables || {};
        const opciones = { tradables, matchPrime: (t) => OCRService.getValidItemMatch(t) };
        const W = video.videoWidth, H = video.videoHeight;
        if (rotuloApagado(video)) return this._leeDialogo(video, worker, opciones);
        this._mesaT = Date.now();

        const mesa = { doy: [], recibo: [] };
        for (const lado of ["doy", "recibo"]) {
            for (let i = 0; i < 6; i++) {
                const { icono, rotulo: nombre, cantidad } = casillaTradeo(lado, i, W, H);
                const clave = `${lado}${i}`;
                if (textura(muestraMaxCanal(video, icono, 16, 12)) < TEXTURA_OCUPADA) { this._casillas.delete(clave); continue; }
                // binarized by text color, not brightness: the part art covers the label ("Khora Brebrassis")
                const cvs = VisionService.cropThemeBinarized(video, Math.floor(W * nombre.x), Math.floor(H * nombre.y), Math.floor(W * nombre.w), Math.floor(H * nombre.h), null, null);
                const hash = smallCanvasHash(cvs), ahora = Date.now();
                let c = this._casillas.get(clave) || { hash, t: 0, leido: undefined, item: null, firme: false };
                if (!compareHashes(hash, c.hash, 6)) c = { ...c, hash, leido: undefined, firme: false };
                if (!c.firme && (c.leido !== null || ahora - c.t > 1500)) {
                    const { data } = await OCRRepository.recognize(worker, cvs, {}, { text: true });
                    let leido = leeCasillaTradeo(data.text, opciones);
                    if (leido?.tipo === "platino" && !leido.qty) {
                        const { data: n } = await OCRRepository.recognizeWithChars(worker, VisionService.prepareCropForOCR(video, cantidad, 2, "tradeoCantidad"), "0123456789,.");
                        leido = { ...leido, qty: Number((n.text || "").replaceAll(/\D/g, "")) || 0 };
                    }
                    if (leido && c.leido && leido.name === c.leido.name && leido.qty === c.leido.qty) c = { ...c, item: leido, firme: true };
                    c = { ...c, leido, t: ahora };
                }
                this._casillas.set(clave, c);
                if (c.item) mesa[lado].push(conPrecio(c.item));
            }
        }
        this._publica(mesa);
    },

    async _leeDialogo(video, worker, opciones) {
        const cvs = VisionService.prepareCropForOCR(video, dialogoTradeo(video.videoWidth, video.videoHeight), 1, "tradeoDialogo");
        const hash = smallCanvasHash(cvs);
        if (compareHashes(hash, this._dialogoHash, 6)) return;
        this._dialogoHash = hash;
        const { data } = await OCRRepository.recognize(worker, cvs, {}, { text: true });
        const lista = leeDialogoTradeo(data.text, opciones);
        if (lista) {
            this._confirmada = { doy: lista.doy.map(conPrecio), recibo: lista.recibo.map(conPrecio), confirmada: true };
            this._publica(this._confirmada);
        } else if (this._confirmada && esTradeoHecho(data.text)) {
            this.onTrade?.(this._confirmada);
            this._confirmada = null;
        }
    },

    conDialogo(video) {
        return Date.now() - this._mesaT < ESPERA_DIALOGO_MS && !!video?.videoWidth && rotuloApagado(video);
    },

    _publica(mesa) {
        const clave = JSON.stringify(mesa);
        if (clave === this._clave) return;
        this._clave = clave;
        this.ultimo = mesa;
        this.onUpdate?.(mesa);
    },

    reset() {
        this._casillas.clear();
        this._dialogoHash = null;
        this._confirmada = null;
        this._clave = "";
        this.ultimo = null;
        this.onUpdate?.(null);
    },
};
