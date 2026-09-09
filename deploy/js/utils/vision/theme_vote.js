/**
 * UI theme voting from the pixels of a frame zone. Apart from vision.service.js so it can be measured: the
 * theme feeds every color mask that follows (names, badges), so a wrong vote breaks the whole scan where
 * nobody looks.
 */

/**
 * Pixels that count as TEXT, by percentile of the sample itself: an ABSOLUTE brightness cut let no pixel of
 * the Tenno theme rgb(6,106,74) (luma 72) through. The floor of 24 only keeps a dark frame from voting on
 * noise.
 */
const PERCENTIL_TEXTO = 0.90;
const LUMA_SUELO = 24;

/**
 * Affinity kernel width, in Manhattan RGB distance units. Catalog colors are IDEAL and rendered text never
 * hits them exactly (bloom, gamma, stream compression), so a kernel close to a delta let any bit of pure color
 * UI CHROME win. At distance 39 a pixel keeps 37% of its weight, so text wins by accumulation with no mass
 * threshold. 20 is too narrow and a 45 gaussian lets flat grays through.
 */
const SIGMA_AFINIDAD = 30;
const afinidad = (dist) => 1 / (1 + (dist / SIGMA_AFINIDAD) ** 2);

/**
 * Distance from a pixel to a theme, with the CATALOG SCALED to the pixel brightness. Catalog colors are the
 * accent at full light, but the game paints list text much dimmer and the live stream comes darker still: red
 * text at 60% or 40% of Stalker is farther from it in absolute distance than unrelated themes.
 *
 * The 0.3 brightness penalty is not decorative: comparing ONLY chromaticity turns the pale catalog themes
 * (Lotus, Baruuk, Vitruvian, Dark Lotus) into magnets for any grayish art. A minimum saturation filter does
 * not work either: it drops the text of those same pale themes.
 */
function distanciaATema(r, g, b, luminancia, tema, lumaTema) {
    const k = luminancia / lumaTema;
    const croma = Math.abs(r - tema.r * k) + Math.abs(g - tema.g * k) + Math.abs(b - tema.b * k);
    return 0.7 * croma + 0.3 * Math.abs(luminancia - lumaTema);
}

/**
 * Mean affinity per pixel the winner must reach to be trusted; a threshold on the weight sum scaled with the
 * zone size and meant nothing. A wrong theme is worse than none: null keeps the last stable theme.
 */
const AFINIDAD_MINIMA = 0.55;

const luma = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

/**
 * @param px    RGBA of the sampled zone (1 of every 4 pixels is visited).
 * @param temas votable catalog (WF_THEMES_VOTABLES).
 * @returns { tema, actualR, actualG, actualB, afinidad } or null when no theme is reliable.
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
        // rounded like when building the histogram, otherwise the pixel that defines the cut falls outside it
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

    // the MEASURED color, not the catalog one: it carries the capture's bloom, glow and compression, which is
    // what has to be isolated downstream
    const tema = temas[ganador];
    return {
        tema,
        actualR: Math.round(s.rSum / s.count),
        actualG: Math.round(s.gSum / s.count),
        actualB: Math.round(s.bSum / s.count),
        afinidad: media,
    };
}
