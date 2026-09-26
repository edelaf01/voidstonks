// Un entero por set y día, 0 sin dato: { d: día del primer hueco, p: { "Saryn Prime": [60, 62, 0, 65] } }.
// Con 100 sets y 15 días son unos 6 KB.

export const DIAS_GUARDADOS = 15;

export function diaDe(ms) {
    return Math.floor(ms / 86400000);
}

// Los sets que no vienen en `precios` salen: los que ya no tienes no ocupan sitio.
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

// Un día sin abrir la app deja un 0: vale el último precio anterior.
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
