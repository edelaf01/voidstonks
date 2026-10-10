import { firmaTexto, mismoTexto, fraccionCambiada } from "./frame_hash.js";
import { tirasDeNombreArcano } from "../inventory/arcanos_disolucion.js";

export function firmaDePagina(video, muestra, rejilla, zona, ancho, alto) {
    const tiras = rejilla && zona ? tirasDeNombreArcano(rejilla, zona, ancho, alto) : [];
    return tiras.length ? { rejilla, datos: firmaTexto(video, tiras) } : { rejilla: null, datos: muestra };
}

export function mismaPagina(vista, actual, video, muestra, zona, ancho, alto) {
    if (!vista) return false;
    const comparable = vista.rejilla === actual.rejilla ? actual : firmaDePagina(video, muestra, vista.rejilla, zona, ancho, alto);
    if (comparable.rejilla !== vista.rejilla) return false;
    return vista.rejilla ? mismoTexto(comparable.datos, vista.datos) : fraccionCambiada(comparable.datos, vista.datos) < 0.01;
}
