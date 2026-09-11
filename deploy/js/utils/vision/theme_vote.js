/**
 * Votación del tema de la interfaz a partir de los píxeles de una zona del frame.
 *
 * Separado de vision.service.js para poder medirlo: el tema es la entrada de todas las máscaras
 * por color que vienen después (nombres, badges), así que equivocarse aquí no rompe una función,
 * rompe el escaneo entero y en un sitio donde nadie mira.
 */

/**
 * Píxeles que cuentan como TEXTO, por percentil de la propia muestra.
 *
 * Con un corte de brillo ABSOLUTO (estaba en 100) el tema Tenno rgb(6,106,74) —luma 72— no
 * dejaba pasar ni un píxel y la detección devolvía null. Medido repintando una captura real
 * con los 18 temas votables: corte fijo 16/18, percentil 90 17/18 (el que falta es Conquera,
 * que se confunde con High Contrast — distan 40 en Manhattan, son el mismo amarillo).
 * El suelo de 24 es solo para que un frame a oscuras no vote sobre ruido.
 */
const PERCENTIL_TEXTO = 0.90;
const LUMA_SUELO = 24;

/**
 * Anchura del núcleo de afinidad, en unidades de distancia Manhattan RGB.
 *
 * Antes el peso era 1/(dist+1)^4, que se comporta como una delta: un píxel a distancia 0 pesa
 * 1 y uno a distancia 39 pesa 4e-7, dos millones y medio de veces menos. Como los colores del
 * catálogo son IDEALES y el texto renderizado nunca los da exactos (bloom, gamma, compresión
 * del stream: los nombres del inventario miden rgb(247,130,3) contra el rgb(227,128,20) del
 * catálogo, distancia 39), cualquier trozo de CROMO de la interfaz que sí diera un color puro
 * ganaba por goleada. Medido en una captura: 37 píxeles del borde rojo del icono de filtro
 * seleccionado pesaban 36,0 y los 9678 píxeles de los nombres reales, 0,0058.
 *
 * Sobre las 37 capturas reales de inventario: con la cuarta potencia solo 9 detectaban bien el
 * tema y 21 decían Zephyr (rojo) en vez de Default (naranja); con este núcleo, 30. A distancia
 * 39 un píxel conserva el 37% del peso, así que el texto gana por acumulación y no hace falta
 * ningún umbral de masa. Sigma 20 es demasiado estrecho (0/37) y una gaussiana de 45 deja pasar
 * grises planos: 30 está en mitad de la meseta que funciona.
 */
const SIGMA_AFINIDAD = 30;
const afinidad = (dist) => 1 / (1 + (dist / SIGMA_AFINIDAD) ** 2);

/**
 * Distancia de un píxel a un tema, con el CATÁLOGO ESCALADO al brillo del píxel.
 *
 * Los colores del catálogo son el acento a plena luz, pero el juego pinta el texto de lista
 * bastante más apagado, y el stream en vivo llega además más oscuro que una captura de
 * escritorio. Medido: el texto rojo de dos capturas del usuario mide rgb(152,30,34) y
 * rgb(102,21,23), que son exactamente Stalker rgb(255,61,51) al 60% y al 40% de brillo — pero
 * en distancia absoluta quedan a 151 y 221, más lejos que temas que no tienen nada que ver.
 * Atenuando la MISMA captura naranja, la distancia absoluta pierde el tema con solo un 20%
 * menos de brillo; así comparado aguanta hasta el 60%.
 *
 * El 0,3 de penalización por brillo no es decorativo: comparar SOLO cromaticidad hunde el
 * acierto de 30/30 a 3/30, porque los temas pálidos del catálogo (Lotus, Baruuk, Vitruvian,
 * Dark Lotus) se vuelven imanes de cualquier arte grisácea. Filtrar por saturación mínima para
 * evitarlo tampoco vale: descarta el texto de esos mismos temas pálidos y los repintados caen
 * de 18/18 a 8/18.
 */
function distanciaATema(r, g, b, luminancia, tema, lumaTema) {
    const k = luminancia / lumaTema;
    const croma = Math.abs(r - tema.r * k) + Math.abs(g - tema.g * k) + Math.abs(b - tema.b * k);
    return 0.7 * croma + 0.3 * Math.abs(luminancia - lumaTema);
}

/**
 * Afinidad MEDIA por píxel que debe alcanzar el ganador para considerarse fiable.
 *
 * Sustituye a un listón sobre la suma de pesos, que escalaba con el tamaño de la zona y por
 * tanto no significaba nada. Medido sobre 37 capturas reales: las 30 que aciertan caen
 * en 0,606 o más, y los falsos positivos por arte grisáceo se quedan en 0,427 (Baruuk) y por
 * debajo. El listón en 0,50 deja un 21% de margen por arriba y un 17% por abajo. No se baja a
 * 0,45 aunque aguantaría más atenuación: el margen contra el falso positivo se quedaría en 5%,
 * y equivocarse de tema es peor que no dar ninguno. Devolver null es lo correcto aquí: la app
 * mantiene el último tema estable, que es mejor que un tema equivocado.
 */
const AFINIDAD_MINIMA = 0.55;

const luma = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

/**
 * @param px    RGBA de la zona muestreada (se recorre 1 de cada 4 píxeles).
 * @param temas catálogo votable (WF_THEMES_VOTABLES).
 * @returns { tema, actualR, actualG, actualB, afinidad } o null si ningún tema es fiable.
 */
export function eligeTema(px, temas) {
    const lumaTemas = temas.map((t) => luma(t.r, t.g, t.b));
    const histo = new Uint32Array(256);
    let muestras = 0;
    for (let i = 0; i < px.length; i += 16) {
        histo[Math.min(255, Math.round(luma(px[i], px[i + 1], px[i + 2])))]++;
        muestras++;
    }
    let acumulado = 0, corte = 255;
    for (let v = 0; v < 256; v++) {
        acumulado += histo[v];
        if (acumulado >= muestras * PERCENTIL_TEXTO) { corte = v; break; }
    }
    const lumaMinima = Math.max(LUMA_SUELO, corte);

    const stats = temas.map(() => ({ rSum: 0, gSum: 0, bSum: 0, count: 0, weight: 0 }));
    for (let i = 0; i < px.length; i += 16) {
        const r = px[i], g = px[i + 1], b = px[i + 2];
        // Redondeado igual que al construir el histograma: si no, el píxel que define el corte
        // queda fuera de su propio corte.
        if (Math.round(luma(r, g, b)) < lumaMinima) continue;

        const L = luma(r, g, b);
        let mejor = 0, mejorDist = Infinity;
        for (let t = 0; t < temas.length; t++) {
            const dist = distanciaATema(r, g, b, L, temas[t], lumaTemas[t]);
            if (dist < mejorDist) { mejorDist = dist; mejor = t; }
        }
        stats[mejor].weight += afinidad(mejorDist);
        stats[mejor].rSum += r; stats[mejor].gSum += g; stats[mejor].bSum += b;
        stats[mejor].count += 1;
    }

    let peso = -1, ganador = -1;
    for (let t = 0; t < temas.length; t++) {
        if (stats[t].weight > peso) { peso = stats[t].weight; ganador = t; }
    }
    if (ganador < 0) return null;

    const s = stats[ganador];
    const media = s.count > 0 ? s.weight / s.count : 0;
    if (media < AFINIDAD_MINIMA) return null;

    // El color MEDIDO, no el del catálogo: recoge el bloom, el glow y la compresión de la
    // captura, que es lo que de verdad hay que aislar aguas abajo.
    const tema = temas[ganador];
    return {
        tema,
        actualR: Math.round(s.rSum / s.count),
        actualG: Math.round(s.gSum / s.count),
        actualB: Math.round(s.bSum / s.count),
        afinidad: media,
    };
}
