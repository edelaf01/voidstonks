// votes the active UI theme from sampled frame pixels to feed downstream color masks

const PERCENTIL_TEXTO = 0.90;
const LUMA_SUELO = 24;

const SIGMA_AFINIDAD = 30;
const afinidad = (dist) => 1 / (1 + (dist / SIGMA_AFINIDAD) ** 2);

// brightness penalty keeps pale catalog themes from becoming magnets for grayish art
function distanciaATema(r, g, b, luminancia, tema, lumaTema) {
    const k = luminancia / lumaTema;
    const croma = Math.abs(r - tema.r * k) + Math.abs(g - tema.g * k) + Math.abs(b - tema.b * k);
    return 0.7 * croma + 0.3 * Math.abs(luminancia - lumaTema);
}

const AFINIDAD_MINIMA = 0.55;

const luma = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

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

    const tema = temas[ganador];
    return {
        tema,
        actualR: Math.round(s.rSum / s.count),
        actualG: Math.round(s.gSum / s.count),
        actualB: Math.round(s.bSum / s.count),
        afinidad: media,
    };
}

export function decideTema(estable, voto, votos = [], { ventana = 5, necesarios = 3, inequivoca = 0.9 } = {}) {
    const nombre = voto.tema.name;
    const ventanaNueva = [...votos.slice(-(ventana - 1)), nombre];
    if (estable?.name === nombre) return { releva: true, votos: ventanaNueva, n: necesarios };
    if (!estable || voto.afinidad >= inequivoca) return { releva: true, votos: [], n: necesarios };
    const n = ventanaNueva.filter((t) => t === nombre).length;
    return n >= necesarios ? { releva: true, votos: [], n } : { releva: false, votos: ventanaNueva, n };
}
