import { muestraMaxCanal } from "../../utils/vision/frame_hash.js";
import { FRANJA_TITULO_VIDEO } from "../../utils/vision/context_latch.js";
import { COLS, FILAS, esTitulo, importa, exporta } from "../../utils/vision/title_catalog.js";

// La pausa, el popup de riven y el fin de misión no tienen rótulo en la franja: aprender de ellos
// guardaría nombres de jugadores o escena como si fueran una pantalla.
const CONTEXTOS_CON_ROTULO = new Set(["INVENTORY", "INVENTORY_MODS", "RIVEN_SPLICING", "RELICS", "REWARD", "TRADE"]);

/** Catálogo de rótulos por resolución (utils/vision/title_catalog.js), guardado en localStorage. */
export const FirmasTitulo = {
    _clave: null,
    _catalogo: null,

    catalogo(video) {
        const clave = `vs_titulos_v1_${video.videoWidth}x${video.videoHeight}`;
        if (clave !== this._clave) {
            let datos = null;
            try { datos = JSON.parse(localStorage.getItem(clave)); } catch { /* sin datos: se empieza vacío */ }
            this._clave = clave;
            this._catalogo = importa(datos);
        }
        return this._catalogo;
    },

    muestra(video) {
        return muestraMaxCanal(video, FRANJA_TITULO_VIDEO, COLS, FILAS);
    },

    /** { contexto, texto } si la franja es un rótulo ya aprendido, o null. */
    reconoce(video) {
        if (!video?.videoWidth) return null;
        return this.catalogo(video).reconoce(this.muestra(video));
    },

    aprende(video, texto, contexto) {
        if (!video?.videoWidth || !CONTEXTOS_CON_ROTULO.has(contexto) || !esTitulo(texto)) return;
        const catalogo = this.catalogo(video);
        if (!catalogo.aprende(this.muestra(video), contexto, texto)) return;
        try { localStorage.setItem(this._clave, JSON.stringify(exporta(catalogo))); } catch { /* modo privado */ }
    },
};
