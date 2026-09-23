import { buildZip } from "../../utils/debug_zip.js";
import { fraccionCambiada, miniaturaLuma } from "../../utils/vision/frame_hash.js";
import { OPFSRepository } from "../../repositories/opfs.repository.js";
import { creaMuestreador } from "../../utils/perf_sampler.js";
import { DEBUG_ACTIVO } from "../../utils/debug_log.js";

/**
 * Grabadora de depuración del escáner: guarda las imágenes que el escáner lee y, junto a cada
 * una, lo que sacó de ellas, para poder revisar fuera del navegador por qué una lectura falló.
 *
 * Existe porque cada fallo en vivo llegaba como un pantallazo del overlay, sin el frame real
 * ni lo que leyó cada celda, y había que reconstruirlo a ciegas. Con el paquete se reproduce
 * offline con las mismas imágenes; y como los frames van en PNG sin pérdida con las lecturas
 * al lado, sirven también de material etiquetado para entrenar un modelo más adelante.
 *
 * Solo graba con el toggle activo: codificar un PNG de 1662×1225 cuesta ~150 ms fuera del
 * hilo principal y ~2 MB, y no se quiere pagar en cada página de una sesión normal.
 *
 * Los blobs no se quedan en memoria: cada página de inventario son ~4 MB de PNG y una hora de
 * sesión pasaba de 2 GB de RAM. Van al disco (OPFS) según llegan y se leen solo al exportar; en
 * memoria queda el índice. Sin OPFS o si una escritura falla, ese blob se queda en memoria.
 */
const aBlob = (canvas, tipo, calidad) => new Promise((resolve) => {
    if (!canvas || typeof canvas.toBlob !== "function") return resolve(null);
    canvas.toBlob((b) => resolve(b), tipo, calidad);
});

// 16:9 a 192 px: el clasificador de pantalla decide por la disposición (paneles, rejilla, título
// centrado), no por leer texto, y a este tamaño una miniatura JPEG son ~5 KB.
const MINI_W = 192, MINI_H = 108;
// Sin tope al depurar (el dueño quiere la sesión entera); desplegada, quien encienda la grabadora
// a mano no debe llenarse el disco sin saberlo: ~4 MB por página, 300 MB son unos 75 minutos.
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
    /** Miniaturas del frame entero con el contexto que decidió el escáner: material del clasificador de pantalla. */
    miniaturas: [],
    /** Una muestra cada 10 s de heap, retraso del bucle y tareas largas (utils/perf_sampler.js). */
    rendimiento: [],
    _muestreador: null,
    _seq: 0,
    _bytes: 0,
    _miniT: 0,
    _miniLuma: null,
    /** Contexto fijo de la sesión (motor, tamaño de frame…), lo pone quien arranca el escáner. */
    sesion: {},
    /** Aviso a la UI (el contador del botón) tras cada grabación o vaciado. */
    onChange: null,
    /** Dónde van los blobs; se sustituye en los tests por uno en memoria. */
    disco: OPFSRepository,
    _discoP: null,

    get size() { return this.entradas.length; },
    /** MB acumulados (en disco si hay OPFS): sin tope, es lo único que avisa de cuánto se está guardando. */
    get mb() { return this._bytes / (1024 * 1024); },
    /** Con el tope alcanzado se deja de grabar (lecturas y miniaturas); el botón lo dice. */
    get llena() { return this.mb >= LIMITE_MB; },

    /**
     * Abre la carpeta una vez por página y la vacía: una sesión anterior cerrada sin exportar
     * dejaría sus PNG en disco para siempre. Resuelve a si hay disco.
     */
    _abreDisco() {
        this._discoP ??= (async () => {
            const ok = await this.disco?.abrir(DIR_DISCO);
            if (ok) await this.disco.vacia();
            return !!ok;
        })();
        return this._discoP;
    },

    /** Lleva `blob` al disco; devuelve el blob si hay que retenerlo en memoria, null si está en disco. */
    async _guarda(nombre, blob) {
        if (!blob || !(await this._abreDisco())) return blob;
        return (await this.disco.escribe(nombre, blob)) ? null : blob;
    },

    async _bytesDe(blob, nombre) {
        if (blob) return new Uint8Array(await blob.arrayBuffer());
        return this.disco.lee(nombre);
    },

    /**
     * @param {object} e
     * @param {string} e.kind      "inventario" | "fin-mision" | "recompensas" | "reliquias" | "cabecera"
     * @param {HTMLCanvasElement} e.image   la imagen tal cual la leyó el escáner (va en PNG)
     * @param {HTMLCanvasElement|string} [e.overlay]  el lienzo de debug con máscaras y rótulos, o su dataURL
     * @param {object} [e.meta]    resultado estructurado (rejilla, lecturas, resumen…)
     * @param {string[]} [e.log]   líneas de log de esa lectura
     */
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

    /**
     * Guarda una miniatura del frame etiquetada con `meta` (contexto, cabecera leída…). Como
     * mucho una por segundo y solo si el frame cambió: una pantalla quieta grabada mil veces no
     * enseña nada y llenaría el paquete. Devuelve si se guardó.
     */
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

    /** Se llama en cada frame; guarda una muestra cada 10 s con el contexto que había. */
    rendimientoTick(meta) {
        if (!this.enabled) return;
        this._muestreador ??= creaMuestreador();
        const m = this._muestreador.tick(meta);
        if (m) this.rendimiento.push(m);
    },

    clear() {
        this.entradas = []; this.miniaturas = []; this.rendimiento = []; this._bytes = 0; this._seq = 0; this._miniT = 0; this._miniLuma = null;
        this.onChange?.();
        // Encadenado en _discoP para que la siguiente escritura espere al vaciado y no se la lleve.
        if (this._discoP) this._discoP = this._discoP.then(async (ok) => { if (ok) await this.disco.vacia(); return ok; });
        return this._discoP;
    },

    /** El paquete: un ZIP con una carpeta por lectura y un índice. */
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
`;

function desdeDataURL(url) {
    const b64 = url.slice(url.indexOf(",") + 1);
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}
