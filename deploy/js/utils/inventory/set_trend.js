// one integer per set and day, 0 = no data: { d: first slot day, p: { "Saryn Prime": [60, 62, 0, 65] } }

export const DIAS_GUARDADOS = 15;

export function diaDe(ms) {
    return Math.floor(ms / 86400000);
}

// sets missing from `precios` drop: the ones you no longer own take no space
export function apuntaPrecios(historial, precios, hoy) {
    const valido = historial && Number.isInteger(historial.d) && historial.d <= hoy;
    const desde = valido ? Math.max(historial.d, hoy - DIAS_GUARDADOS + 1) : hoy;
    const largo = hoy - desde + 1;
    const corte = valido ? desde - historial.d : 0;
    const p = {};
    for (const [clave, precio] of Object.entries(precios || {})) {
        const serie = (valido ? historial.p?.[clave] || [] : []).slice(corte, corte + largo);
        while (serie.length < largo) serie.push(0);
        if (precio > 0) serie[largo - 1] = Math.round(precio);
        p[clave] = serie;
    }
    return { d: desde, p };
}

// a day without opening the app leaves a 0: the last earlier price holds
function precioEn(historial, serie, dia) {
    for (let i = Math.min(dia - historial.d, serie.length - 1); i >= 0; i--) if (serie[i] > 0) return serie[i];
    return 0;
}

export function tendencias(historial, hoy, dias) {
    if (!historial?.p) return [];
    const filas = [];
    for (const [clave, serie] of Object.entries(historial.p)) {
        const actual = precioEn(historial, serie, hoy);
        const antes = hoy - dias >= historial.d ? precioEn(historial, serie, hoy - dias) : 0;
        if (!actual || !antes) continue;
        filas.push({ clave, actual, antes, cambio: actual - antes, pct: Math.round(((actual - antes) / antes) * 100) });
    }
    return filas.sort((a, b) => b.pct - a.pct || b.cambio - a.cambio);
}
