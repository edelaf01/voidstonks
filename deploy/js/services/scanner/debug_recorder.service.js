import { buildZip } from "../../utils/debug_zip.js";
import { fraccionCambiada, miniaturaLuma } from "../../utils/vision/frame_hash.js";
import { OPFSRepository } from "../../repositories/opfs.repository.js";
import { creaMuestreador } from "../../utils/perf_sampler.js";
import { DEBUG_ACTIVO } from "../../utils/debug_log.js";

const aBlob = (canvas, tipo, calidad) => new Promise((resolve) => {
    if (!canvas || typeof canvas.toBlob !== "function") return resolve(null);
    canvas.toBlob((b) => resolve(b), tipo, calidad);
});

// scaled to 16:9 at 192 px: the screen classifier decides by layout, not by text
const MINI_W = 192, MINI_H = 108;
export const LIMITE_MB = DEBUG_ACTIVO ? Infinity : 300;
const MINI_CADA_MS = 1000;
const MINI_CAMBIO = 0.02;

const DIR_DISCO = "vs-debug";
const fFrame = (id) => `${id}-frame.png`;
const fOverlay = (id) => `${id}-overlay.jpg`;
const fMini = (id) => `m${id}.jpg`;

export const DebugRecorder = {
    enabled: false,
    entradas: [],
    miniaturas: [],
    rendimiento: [],
    latencias: [],
    _cambioDesde: 0,
    _fijado: undefined,
    _muestreador: null,
    _seq: 0,
    _bytes: 0,
    _miniT: 0,
    _miniLuma: null,
    sesion: {},
    onChange: null,
    disco: OPFSRepository,
    _discoP: null,

    get size() { return this.entradas.length; },
    get mb() { return this._bytes / (1024 * 1024); },
    get llena() { return this.mb >= LIMITE_MB; },

    _abreDisco() {
        this._discoP ??= (async () => {
            const ok = await this.disco?.abrir(DIR_DISCO);
            if (ok) await this.disco.vacia();
            return !!ok;
        })();
        return this._discoP;
    },

    async _guarda(nombre, blob) {
        if (!blob || !(await this._abreDisco())) return blob;
        return (await this.disco.escribe(nombre, blob)) ? null : blob;
    },

    async _bytesDe(blob, nombre) {
        if (blob) return new Uint8Array(await blob.arrayBuffer());
        return this.disco.lee(nombre);
    },

    async record({ kind, image, overlay = null, meta = {}, log = [] }) {
        if (!this.enabled || !image || this.llena) return;
        const png = await aBlob(image, "image/png");
        if (!png) return;
        const overlayBlob = typeof overlay === "string" ? overlay : await aBlob(overlay, "image/jpeg", 0.8);
        const id = ++this._seq;
        const entrada = {
            id, kind, time: new Date().toISOString(),
            width: image.width, height: image.height,
            png: await this._guarda(fFrame(id), png),
            overlay: typeof overlayBlob === "string" ? overlayBlob : await this._guarda(fOverlay(id), overlayBlob),
            conOverlay: !!overlayBlob,
            meta, log: [...log],
        };
        this._bytes += png.size + (overlayBlob?.size || 0);
        this.entradas.push(entrada);
        this.onChange?.();
    },

    miniatura(video, meta, ahora = Date.now()) {
        if (!this.enabled || !video?.videoWidth || this.llena || ahora - this._miniT < MINI_CADA_MS) return false;
        const { cvs, luma } = miniaturaLuma(video, MINI_W, MINI_H);
        if (this._miniLuma && fraccionCambiada(luma, this._miniLuma) < MINI_CAMBIO) return false;
        this._miniLuma = luma; this._miniT = ahora;
        const entrada = { id: this.miniaturas.length + 1, time: new Date(ahora).toISOString(), jpg: null, lista: false, meta };
        this.miniaturas.push(entrada);
        aBlob(cvs, "image/jpeg", 0.75).then(async (jpg) => {
            this._bytes += jpg?.size || 0;
            entrada.jpg = await this._guarda(fMini(entrada.id), jpg);
            entrada.lista = !!jpg;
            this.onChange?.();
        });
        return true;
    },

    rendimientoTick(meta) {
        if (!this.enabled) return;
        this._muestreador ??= creaMuestreador();
        const m = this._muestreador.tick(meta);
        if (m) this.rendimiento.push(m);
    },

    latenciaContexto({ fijado, cambiado, pendiente, via }, ahora = Date.now()) {
        if (!this.enabled) return;
        if (cambiado && !this._cambioDesde) this._cambioDesde = ahora;
        if (this._fijado !== undefined && fijado !== this._fijado) {
            this.latencias.push({ time: new Date(ahora).toISOString(), de: this._fijado, a: fijado, ms: this._cambioDesde ? ahora - this._cambioDesde : null, via });
            this._cambioDesde = 0;
        } else if (!cambiado && !pendiente) this._cambioDesde = 0;
        this._fijado = fijado;
    },

    clear() {
        this.latencias = []; this._cambioDesde = 0; this._fijado = undefined;
        this.entradas = []; this.miniaturas = []; this.rendimiento = []; this._bytes = 0; this._seq = 0; this._miniT = 0; this._miniLuma = null;
        this.onChange?.();
        if (this._discoP) this._discoP = this._discoP.then(async (ok) => { if (ok) await this.disco.vacia(); return ok; });
        return this._discoP;
    },

    async export() {
        const enc = new TextEncoder();
        const files = [];
        const indice = [];
        for (const e of this.entradas) {
            const dir = `${String(e.id).padStart(3, "0")}-${e.kind}`;
            const frame = await this._bytesDe(e.png, fFrame(e.id));
            if (frame) files.push({ name: `${dir}/frame.png`, data: frame });
            if (e.conOverlay && typeof e.overlay !== "string") {
                const ov = await this._bytesDe(e.overlay, fOverlay(e.id));
                if (ov) files.push({ name: `${dir}/overlay.jpg`, data: ov });
            } else if (typeof e.overlay === "string" && e.overlay.startsWith("data:")) {
                files.push({ name: `${dir}/overlay.${e.overlay.slice(11, 15).replace(/[^a-z]/g, "")}`, data: desdeDataURL(e.overlay) });
            }
            files.push({ name: `${dir}/meta.json`, data: enc.encode(JSON.stringify({ kind: e.kind, time: e.time, width: e.width, height: e.height, ...e.meta }, null, 2)) });
            if (e.log.length) files.push({ name: `${dir}/log.txt`, data: enc.encode(e.log.join("\n")) });
            indice.push({ dir, kind: e.kind, time: e.time, resumen: e.meta?.resumen ?? null });
        }
        const etiquetas = [];
        for (const m of this.miniaturas) {
            if (!m.lista) continue;
            const jpg = await this._bytesDe(m.jpg, fMini(m.id));
            if (!jpg) continue;
            const name = `miniaturas/${String(m.id).padStart(5, "0")}.jpg`;
            files.push({ name, data: jpg });
            etiquetas.push(JSON.stringify({ file: name, time: m.time, ...m.meta }));
        }
        if (etiquetas.length) files.push({ name: "miniaturas.jsonl", data: enc.encode(etiquetas.join("\n") + "\n") });
        if (this.rendimiento.length) files.push({ name: "rendimiento.jsonl", data: enc.encode(this.rendimiento.map((m) => JSON.stringify(m)).join("\n") + "\n") });
        if (this.latencias.length) files.push({ name: "latencias.jsonl", data: enc.encode(this.latencias.map((m) => JSON.stringify(m)).join("\n") + "\n") });
        files.unshift({ name: "sesion.json", data: enc.encode(JSON.stringify({ ...this.sesion, exportado: new Date().toISOString(), lecturas: indice, miniaturas: etiquetas.length }, null, 2)) });
        files.unshift({ name: "README.txt", data: enc.encode(README) });
        return buildZip(files);
    },
};

const README = `Paquete de depuración del escáner de VoidStonks.

Una carpeta por lectura, en orden: NNN-<pantalla>/
  frame.png    la imagen exacta que leyó el escáner (recorte de la rejilla, frame congelado…)
  overlay.jpg  el lienzo de debug: máscaras binarizadas y rótulos por celda (si lo había)
  meta.json    rejilla, tema, color de nombre, lecturas por celda y resumen
  log.txt      las líneas de log de esa lectura
sesion.json    motor, tamaño de frame e índice de lecturas
miniaturas/    una miniatura del frame por segundo (si cambió), con su etiqueta en miniaturas.jsonl:
               contexto que dio la cabecera, contexto fijado, texto leído y cuántas pasadas costó
rendimiento.jsonl  cada 10 s: heap JS (MB), retraso máximo del bucle de eventos (ms de hilo ocupado)
               y tareas largas del intervalo; la memoria de los workers y la GPU no se ven desde JS
latencias.jsonl  cada cambio de contexto: de, a, ms desde el primer tick que vio cambiar el rótulo
               (null si cambió sin verse) y si lo decidió la firma del rótulo o el OCR
`;

function desdeDataURL(url) {
    const b64 = url.slice(url.indexOf(",") + 1);
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}
