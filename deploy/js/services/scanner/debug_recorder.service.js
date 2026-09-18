import { buildZip } from "../../utils/debug_zip.js";

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
 */
const aBlob = (canvas, tipo, calidad) => new Promise((resolve) => {
    if (!canvas || typeof canvas.toBlob !== "function") return resolve(null);
    canvas.toBlob((b) => resolve(b), tipo, calidad);
});

export const DebugRecorder = {
    enabled: false,
    entradas: [],
    _seq: 0,
    _bytes: 0,
    /** Contexto fijo de la sesión (motor, tamaño de frame…), lo pone quien arranca el escáner. */
    sesion: {},
    /** Aviso a la UI (el contador del botón) tras cada grabación o vaciado. */
    onChange: null,

    get size() { return this.entradas.length; },
    /** MB acumulados: sin tope, es lo único que avisa de cuánto se está guardando. */
    get mb() { return this._bytes / (1024 * 1024); },

    /**
     * @param {object} e
     * @param {string} e.kind      "inventario" | "fin-mision" | "recompensas" | "reliquias" | "cabecera"
     * @param {HTMLCanvasElement} e.image   la imagen tal cual la leyó el escáner (va en PNG)
     * @param {HTMLCanvasElement|string} [e.overlay]  el lienzo de debug con máscaras y rótulos, o su dataURL
     * @param {object} [e.meta]    resultado estructurado (rejilla, lecturas, resumen…)
     * @param {string[]} [e.log]   líneas de log de esa lectura
     */
    async record({ kind, image, overlay = null, meta = {}, log = [] }) {
        if (!this.enabled || !image) return;
        const png = await aBlob(image, "image/png");
        if (!png) return;
        const overlayBlob = typeof overlay === "string" ? overlay : await aBlob(overlay, "image/jpeg", 0.8);
        const entrada = {
            id: ++this._seq, kind, time: new Date().toISOString(),
            width: image.width, height: image.height,
            png, overlay: overlayBlob, meta, log: [...log],
        };
        this._bytes += png.size + (overlayBlob?.size || 0);
        this.entradas.push(entrada);
        this.onChange?.();
    },

    clear() { this.entradas = []; this._bytes = 0; this._seq = 0; this.onChange?.(); },

    /** El paquete: un ZIP con una carpeta por lectura y un índice. */
    async export() {
        const enc = new TextEncoder();
        const files = [];
        const indice = [];
        for (const e of this.entradas) {
            const dir = `${String(e.id).padStart(3, "0")}-${e.kind}`;
            files.push({ name: `${dir}/frame.png`, data: new Uint8Array(await e.png.arrayBuffer()) });
            if (e.overlay && typeof e.overlay !== "string") {
                files.push({ name: `${dir}/overlay.jpg`, data: new Uint8Array(await e.overlay.arrayBuffer()) });
            } else if (typeof e.overlay === "string" && e.overlay.startsWith("data:")) {
                files.push({ name: `${dir}/overlay.${e.overlay.slice(11, 15).replace(/[^a-z]/g, "")}`, data: desdeDataURL(e.overlay) });
            }
            files.push({ name: `${dir}/meta.json`, data: enc.encode(JSON.stringify({ kind: e.kind, time: e.time, width: e.width, height: e.height, ...e.meta }, null, 2)) });
            if (e.log.length) files.push({ name: `${dir}/log.txt`, data: enc.encode(e.log.join("\n")) });
            indice.push({ dir, kind: e.kind, time: e.time, resumen: e.meta?.resumen ?? null });
        }
        files.unshift({ name: "sesion.json", data: enc.encode(JSON.stringify({ ...this.sesion, exportado: new Date().toISOString(), lecturas: indice }, null, 2)) });
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
`;

function desdeDataURL(url) {
    const b64 = url.slice(url.indexOf(",") + 1);
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}
