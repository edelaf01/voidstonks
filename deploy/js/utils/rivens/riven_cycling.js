import { RIVEN_BASE_STATS, WEAPON_TYPE_IDX, canBeNegative, RIVEN_SPLICED_BASE_STATS } from "../../config.js";

// Kuva del ciclo según los que lleva hechos el riven: los nueve primeros suman 16.450 y a partir
// del décimo el precio se queda en 3.500. Con un stat bloqueado (Update 44) cada ciclo cuesta el doble.
const COSTE_CICLO = [900, 1000, 1200, 1400, 1700, 2000, 2350, 2750, 3150, 3500];

export function costeCiclo(ciclosHechos, bloqueado = false) {
    const i = Math.min(Math.max(0, Math.floor(Number(ciclosHechos) || 0)), COSTE_CICLO.length - 1);
    return COSTE_CICLO[i] * (bloqueado ? 2 : 1);
}

/** Kuva media hasta acertar: el ciclo n solo se paga si fallaron todos los anteriores. */
export function kuvaEsperada(p, ciclosHechos, bloqueado = false) {
    if (!(p > 0)) return Infinity;
    let n = Math.max(0, Math.floor(Number(ciclosHechos) || 0));
    let total = 0, sigue = 1;
    while (n < COSTE_CICLO.length - 1 && p < 1) {
        total += sigue * costeCiclo(n, bloqueado);
        sigue *= 1 - p;
        n++;
    }
    return Math.round(total + sigue * costeCiclo(n, bloqueado) / p);
}

export function tipoDeArma(tipo) {
    return WEAPON_TYPE_IDX[tipo] ?? 0;
}

export function poolDeStats(typeIdx) {
    return Object.keys(RIVEN_BASE_STATS).filter((k) => RIVEN_BASE_STATS[k][typeIdx] && !(k in RIVEN_SPLICED_BASE_STATS));
}

// El escáner, los metastats y la tabla de valores base llaman distinto al mismo stat.
const ALIAS = {
    "crit chance": "Critical Chance", "crit damage": "Critical Damage",
    "base damage / melee damage": "Damage", "base damage": "Damage", "melee damage": "Damage",
    "weapon recoil": "Recoil", "projectile flight speed": "Projectile Speed",
    "critical chance on slide attack": "Slide Attack Critical Chance",
    "chance to gain extra combo count": "Chance not to gain Combo",
    "chance to gain combo count": "Chance not to gain Combo",
    "additional combo count": "Chance not to gain Combo",
    "channeling efficiency": "Heavy Attack Efficiency", "channeling damage": "Initial Combo",
    "melee damage on heavy attack": "Heavy Attack Damage",
    "magazine reloaded/s when holstered": "Magazine Reload when Holstered",
    "weakpoint damage": "Weak Point Damage",
    "weakpoint critical chance": "Weak Point Critical Chance",
    "magazine reload while holstered": "Magazine Reload when Holstered",
    "heavy attack windup speed": "Heavy Attack Wind Up Speed",
    "slam damage": "Slam Attack Damage",
};
const CLAVES = Object.fromEntries(Object.keys(RIVEN_BASE_STATS).map((k) => [k.toLowerCase(), k]));

export function claveStat(nombre, typeIdx) {
    const l = String(nombre || "").trim().toLowerCase().replace(/\s+/g, " ");
    if (["fire rate / attack speed", "fire rate", "attack speed"].includes(l)) {
        return typeIdx === 3 ? "Attack Speed" : "Fire Rate";
    }
    if (ALIAS[l]) return ALIAS[l];
    const faccion = l.match(/^damage (?:vs\.?|to) (grineer|corpus|infested|orokin|techrot|scaldra)$/);
    if (faccion) return `Damage to ${faccion[1][0].toUpperCase()}${faccion[1].slice(1)}`;
    return CLAVES[l.replace(/ damage$/, "")] || CLAVES[l] || null;
}

function* combinaciones(lista, n, desde = 0, elegidos = []) {
    if (elegidos.length === n) {
        yield elegidos;
        return;
    }
    for (let i = desde; i <= lista.length - (n - elegidos.length); i++) {
        yield* combinaciones(lista, n, i + 1, [...elegidos, lista[i]]);
    }
}

// Sin bloqueo el riven sale con 2 o 3 positivos y con o sin negativo, cada combinación al 25 %.
const CONFIGS = [[2, false], [2, true], [3, false], [3, true]];

/**
 * Probabilidad de que un ciclo deje al menos `k` de `buscados` en positivo y, si sale negativo, uno
 * de `negOk`. Positivos al azar sin repetir; el negativo, de lo que queda y pueda salir en negativo.
 * Se recorren todas las combinaciones (~2.300 como mucho).
 * @param bloqueado { stat, negativo } | null: con bloqueo el número de stats no cambia (`config`).
 */
export function probPorCiclo({ pool, buscados, k, negOk, typeIdx, config = null, bloqueado = null, fusionado = null }) {
    const busc = new Set(buscados), ok = new Set(negOk);
    if (bloqueado?.negativo && !config?.neg) return 0;
    const configs = bloqueado ? [[config.pos, config.neg]] : CONFIGS;
    const fijos = [fusionado, bloqueado && !bloqueado.negativo ? bloqueado.stat : null].filter(Boolean);
    const libres = pool.filter((s) => s !== bloqueado?.stat);
    let total = 0;
    for (const [nPos, conNeg] of configs) {
        let suma = 0, casos = 0;
        for (const c of combinaciones(libres, nPos - fijos.length)) {
            casos++;
            const pos = [...fijos, ...c];
            if (pos.filter((s) => busc.has(s)).length < k) continue;
            if (!conNeg) suma += 1;
            else if (bloqueado?.negativo) suma += ok.has(bloqueado.stat) ? 1 : 0;
            else {
                const cand = pool.filter((s) => !pos.includes(s) && canBeNegative(s, typeIdx));
                suma += cand.filter((s) => ok.has(s)).length / cand.length;
            }
        }
        total += casos ? suma / casos : 0;
    }
    return total / configs.length;
}

/**
 * @param stats [{ name, isPositive, calidad? }]: `calidad` desempata entre dos positivos buscados,
 *   porque el bloqueado conserva su valor.
 * @returns null si algún stat no se reconoce o la carta no tiene 2-3 positivos y 0-1 negativo.
 */
export function consejoDeCiclo({ stats, typeIdx, buscados, negOk, k = 2, ciclosHechos = 0, pesos = null }) {
    const pool = poolDeStats(typeIdx);
    const leidos = (stats || []).map((s) => ({ ...s, clave: claveStat(s.name, typeIdx) }));
    const fusion = leidos.filter((s) => s.clave in RIVEN_SPLICED_BASE_STATS);
    if (fusion.length > 1 || fusion.some((s) => !s.isPositive)) return null;
    const fusionado = fusion[0]?.clave ?? null;
    if (leidos.some((s) => !s.clave || (s.clave !== fusionado && !pool.includes(s.clave)))) return null;
    const positivos = leidos.filter((s) => s.isPositive);
    const negativos = leidos.filter((s) => !s.isPositive);
    if (positivos.length < 2 || positivos.length > 3 || negativos.length > 1) return null;

    const busc = [...new Set((buscados || []).map((b) => claveStat(b, typeIdx)))].filter((b) => b && pool.includes(b));
    if (busc.length === 0) return null;
    const ok = [...new Set((negOk || []).map((b) => claveStat(b, typeIdx)))]
        .filter((b) => b && pool.includes(b) && !busc.includes(b));
    const buscFus = fusionado && fusionDeseada(fusionado, tablaDePesos(pesos, typeIdx), busc, typeIdx) ? [...busc, fusionado] : busc;
    const objetivo = { buscados: buscFus, negOk: ok, k: Math.min(k, buscFus.length) };
    const base = { pool, buscados: buscFus, negOk: ok, k: objetivo.k, typeIdx, fusionado };
    const config = { pos: positivos.length, neg: negativos.length === 1 };

    const aciertos = positivos.filter((s) => buscFus.includes(s.clave)).length;
    const cumple = aciertos >= objetivo.k && (!config.neg || ok.includes(negativos[0].clave));

    const pSin = probPorCiclo(base);
    const sinBloqueo = { p: pSin, kuva: kuvaEsperada(pSin, ciclosHechos) };

    const candidatos = [];
    const mejorPositivo = positivos.filter((s) => s.clave !== fusionado && busc.includes(s.clave))
        .sort((a, b) => (b.calidad ?? 0) - (a.calidad ?? 0))[0];
    if (mejorPositivo) candidatos.push({ stat: mejorPositivo.clave, nombre: mejorPositivo.name, negativo: false });
    if (config.neg && ok.includes(negativos[0].clave)) {
        candidatos.push({ stat: negativos[0].clave, nombre: negativos[0].name, negativo: true });
    }
    let bloqueo = null;
    for (const c of candidatos) {
        const p = probPorCiclo({ ...base, config, bloqueado: c });
        const opcion = { ...c, p, kuva: kuvaEsperada(p, ciclosHechos, true) };
        if (!bloqueo || opcion.kuva < bloqueo.kuva) bloqueo = opcion;
    }
    const conviene = !!bloqueo && bloqueo.kuva < sinBloqueo.kuva;
    return { cumple, config, objetivo, sinBloqueo, bloqueo, conviene, fusionado };
}

export const RECETAS_COMBINAR = [
    { a: "Toxin", b: "Heat", resultado: "Gas" },
    { a: "Toxin", b: "Electric", resultado: "Corrosive" },
    { a: "Toxin", b: "Cold", resultado: "Viral" },
    { a: "Heat", b: "Electric", resultado: "Radiation" },
    { a: "Heat", b: "Cold", resultado: "Blast" },
    { a: "Electric", b: "Cold", resultado: "Magnetic" },
    { a: "Damage to Corpus", b: "Damage to Grineer", resultado: "Damage to Orokin" },
    { a: "Damage to Corpus", b: "Damage to Infested", resultado: "Damage to Techrot" },
    { a: "Damage to Infested", b: "Damage to Grineer", resultado: "Damage to Scaldra" },
    { a: "Damage", b: "Zoom", resultado: "Weak Point Damage" },
    { a: "Damage", b: "Multishot", resultado: "Weak Point Damage" },
    { a: "Critical Chance", b: "Zoom", resultado: "Weak Point Critical Chance" },
    { a: "Critical Chance", b: "Multishot", resultado: "Weak Point Critical Chance" },
    { a: "Magazine Capacity", b: "Reload Speed", resultado: "Ammo Efficiency" },
    { a: "Recoil", b: "Ammo Maximum", resultado: "Ammo Efficiency" },
    { a: "Ammo Maximum", b: "Reload Speed", resultado: "Magazine Reload when Holstered" },
    { a: "Ammo Maximum", b: "Magazine Capacity", resultado: "Magazine Reload when Holstered" },
    { a: "Damage", b: "Status Chance", resultado: "Status Damage" },
    { a: "Heavy Attack Efficiency", b: "Chance not to gain Combo", resultado: "Heavy Attack Damage" },
    { a: "Heavy Attack Efficiency", b: "Combo Duration", resultado: "Heavy Attack Wind Up Speed" },
    { a: "Attack Speed", b: "Range", resultado: "Parry Angle" },
    { a: "Damage", b: "Attack Speed", resultado: "Slam Attack Damage" },
];

export function recetasDelTipo(typeIdx) {
    const pool = poolDeStats(typeIdx);
    return RECETAS_COMBINAR.filter((r) => pool.includes(r.a) && pool.includes(r.b)
        && RIVEN_SPLICED_BASE_STATS[r.resultado][typeIdx] > 0);
}

export function combinacionesDe(stats, typeIdx) {
    const claves = new Set((stats || []).map((s) => claveStat(s.name, typeIdx)));
    if ([...claves].some((c) => c in RIVEN_SPLICED_BASE_STATS)) return [];
    return recetasDelTipo(typeIdx).filter((r) => claves.has(r.a) && claves.has(r.b));
}

export function esFusionado(nombre, typeIdx) {
    const c = claveStat(nombre, typeIdx);
    return !!c && c in RIVEN_SPLICED_BASE_STATS;
}

export function pesoFusionado(nombre, tabla, typeIdx = 0) {
    const clave = claveStat(nombre, typeIdx);
    if (!clave || !(clave in RIVEN_SPLICED_BASE_STATS) || !tabla || typeof tabla !== "object") return null;
    const pesos = {};
    for (const [k, v] of Object.entries(tabla)) {
        const c = claveStat(String(k).replace(/_/g, " "), typeIdx);
        const p = parseFloat(v);
        if (c && !(c in pesos) && Number.isFinite(p)) pesos[c] = p;
    }
    const medias = recetasDelTipo(typeIdx)
        .filter((r) => r.resultado === clave && r.a in pesos && r.b in pesos)
        .map((r) => (pesos[r.a] + pesos[r.b]) / 2);
    if (medias.length) return Math.max(...medias);
    return clave in pesos ? pesos[clave] : null;
}

export const UMBRAL_COMBINAR = 0.15;

function tablaDePesos(pesos, typeIdx) {
    const tabla = {};
    if (!pesos || typeof pesos !== "object") return tabla;
    for (const [k, v] of Object.entries(pesos)) {
        const c = claveStat(String(k).replace(/_/g, " "), typeIdx);
        const p = parseFloat(v);
        if (c && !(c in tabla) && Number.isFinite(p)) tabla[c] = p;
    }
    return tabla;
}

function fusionDeseada(resultado, tabla, busc, typeIdx) {
    const conPeso = busc.map((c) => tabla[c]).filter(Number.isFinite);
    if (!conPeso.length) {
        return recetasDelTipo(typeIdx).some((r) => r.resultado === resultado && busc.includes(r.a) && busc.includes(r.b));
    }
    const peso = pesoFusionado(resultado, tabla, typeIdx) ?? 0;
    return peso > 0 && peso >= Math.min(...conPeso);
}

function probFuente({ pool, typeIdx, config, bloqueado, falta }) {
    const fijos = bloqueado.negativo ? [] : [bloqueado.stat];
    const libres = pool.filter((s) => s !== bloqueado.stat);
    let suma = 0, casos = 0;
    for (const c of combinaciones(libres, config.pos - fijos.length)) {
        casos++;
        if (c.includes(falta)) suma += 1;
        else if (config.neg && !bloqueado.negativo && canBeNegative(falta, typeIdx)) {
            const cand = libres.filter((s) => !c.includes(s) && canBeNegative(s, typeIdx));
            suma += 1 / cand.length;
        }
    }
    return casos ? suma / casos : 0;
}

function probAmbos({ pool, typeIdx, a, b }) {
    let total = 0;
    for (const [nPos, conNeg] of CONFIGS) {
        let suma = 0, casos = 0;
        for (const c of combinaciones(pool, nPos)) {
            casos++;
            const ta = c.includes(a), tb = c.includes(b);
            if (ta && tb) suma += 1;
            else if (conNeg && (ta || tb) && canBeNegative(ta ? b : a, typeIdx)) {
                suma += 1 / pool.filter((s) => !c.includes(s) && canBeNegative(s, typeIdx)).length;
            }
        }
        total += casos ? suma / casos : 0;
    }
    return total / CONFIGS.length;
}

export function posiblesFusiones(stats, typeIdx) {
    const leidos = (stats || []).map((s) => claveStat(s.name, typeIdx));
    if (leidos.some((c) => c in RIVEN_SPLICED_BASE_STATS)) return [];
    return recetasDelTipo(typeIdx)
        .map((r) => ({ receta: r, indice: RECETAS_COMBINAR.indexOf(r), faltan: [r.a, r.b].filter((c) => !leidos.includes(c)) }))
        .filter((x) => x.faltan.length < 2)
        .sort((x, y) => x.faltan.length - y.faltan.length);
}

export function planDeReceta({ stats, typeIdx, receta, ciclosHechos = 0 }) {
    const pool = poolDeStats(typeIdx);
    const leidos = (stats || []).map((s) => ({ clave: claveStat(s.name, typeIdx), negativo: !s.isPositive }));
    const fusion = leidos.find((s) => s.clave in RIVEN_SPLICED_BASE_STATS);
    if (fusion) return { estado: "fusionado", fusionado: fusion.clave };
    const fa = leidos.find((s) => s.clave === receta.a), fb = leidos.find((s) => s.clave === receta.b);
    if (fa && fb) return { estado: "lista" };
    const pSin = probAmbos({ pool, typeIdx, a: receta.a, b: receta.b });
    const sinBloqueo = { estado: "faltan", p: pSin, kuva: kuvaEsperada(pSin, ciclosHechos), bloquea: null };
    const tiene = fa || fb;
    const config = { pos: leidos.filter((s) => !s.negativo).length, neg: leidos.some((s) => s.negativo) };
    if (!tiene || leidos.some((s) => !s.clave || !pool.includes(s.clave)) || config.pos < 2 || config.pos > 3) return sinBloqueo;
    const falta = fa ? receta.b : receta.a;
    const p = probFuente({ pool, typeIdx, config, bloqueado: { stat: tiene.clave, negativo: tiene.negativo }, falta });
    const kuva = kuvaEsperada(p, ciclosHechos, true);
    return kuva < sinBloqueo.kuva ? { estado: "falta", p, kuva, bloquea: tiene.clave, negativo: tiene.negativo, falta } : sinBloqueo;
}

export function planesDeFusion({ stats, typeIdx, pesos, buscados, negOk, k = 2, ciclosHechos = 0 }) {
    const actual = consejoDeCiclo({ stats, typeIdx, buscados, negOk, k, ciclosHechos, pesos });
    if (!actual || actual.fusionado || actual.cumple) return [];
    const pool = poolDeStats(typeIdx);
    const tabla = tablaDePesos(pesos, typeIdx);
    const leidos = stats.map((s) => ({ clave: claveStat(s.name, typeIdx), negativo: !s.isPositive }));
    const { buscados: busc, negOk: ok } = actual.objetivo;
    const config = actual.config;
    const sinCombinar = Math.min(actual.sinBloqueo.kuva, actual.bloqueo?.kuva ?? Infinity);
    const planes = [];
    for (const r of recetasDelTipo(typeIdx)) {
        const fa = leidos.find((s) => s.clave === r.a), fb = leidos.find((s) => s.clave === r.b);
        if ((!fa && !fb) || !fusionDeseada(r.resultado, tabla, busc, typeIdx)) continue;
        let fuentes = null, ciclos = ciclosHechos;
        if (!fa || !fb) {
            const tiene = fa || fb;
            const falta = fa ? r.b : r.a;
            const p = probFuente({ pool, typeIdx, config, bloqueado: { stat: tiene.clave, negativo: tiene.negativo }, falta });
            if (!(p > 0)) continue;
            fuentes = { bloquea: tiene.clave, negativo: tiene.negativo, falta, p, kuva: kuvaEsperada(p, ciclosHechos, true) };
            ciclos += Math.round(1 / p);
        }
        const buscFus = [...busc, r.resultado];
        const base = { pool, buscados: buscFus, negOk: ok, k: Math.min(k, buscFus.length), typeIdx, fusionado: r.resultado };
        const pSin = probPorCiclo(base);
        let despues = { p: pSin, kuva: kuvaEsperada(pSin, ciclos), bloquea: null, negativo: false };
        let cumple = false;
        if (!fuentes) {
            const quedan = leidos.filter((s) => s.clave !== r.a && s.clave !== r.b);
            const buenos = quedan.filter((s) => !s.negativo && busc.includes(s.clave));
            const neg = quedan.find((s) => s.negativo);
            cumple = 1 + buenos.length >= base.k && (!config.neg || (!!neg && ok.includes(neg.clave)));
            const candidatos = [];
            if (buenos[0]) candidatos.push({ stat: buenos[0].clave, negativo: false });
            if (neg && ok.includes(neg.clave)) candidatos.push({ stat: neg.clave, negativo: true });
            for (const c of candidatos) {
                const p = probPorCiclo({ ...base, config, bloqueado: c });
                const kuva = kuvaEsperada(p, ciclos, true);
                if (kuva < despues.kuva) despues = { p, kuva, bloquea: c.stat, negativo: c.negativo };
            }
        }
        if (cumple) despues = { p: 1, kuva: 0, bloquea: null, negativo: false };
        const total = (fuentes?.kuva ?? 0) + despues.kuva;
        planes.push({ receta: r, fuentes, cumple, despues, total, sinCombinar, compensa: total < sinCombinar });
    }
    return planes.sort((a, b) => a.total - b.total);
}

export function evaluarCombinaciones({ stats, typeIdx, pesos, buscados = [], negOk = [] }) {
    const tabla = tablaDePesos(pesos, typeIdx);
    if (Object.keys(tabla).length === 0) return [];
    const recetas = combinacionesDe(stats, typeIdx);
    if (!recetas.length) return [];
    const leidos = (stats || []).map((s) => ({ clave: claveStat(s.name, typeIdx), negativo: !s.isPositive }));
    const enRiven = new Set(leidos.map((s) => s.clave));
    const peso = (c) => tabla[c] ?? 0;
    const buscSet = new Set((buscados || []).map((x) => claveStat(x, typeIdx)).filter(Boolean));
    const okSet = new Set((negOk || []).map((x) => claveStat(x, typeIdx)).filter(Boolean));
    const dano = (c) => (okSet.has(c) ? 0 : peso(c));
    const media = (xs) => xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
    const libres = poolDeStats(typeIdx).filter((c) => !enRiven.has(c));
    const resultados = [];
    for (const r of recetas) {
        const sa = leidos.find((s) => s.clave === r.a);
        const sb = leidos.find((s) => s.clave === r.b);
        const antes = (sa.negativo ? -dano(sa.clave) : peso(sa.clave)) + (sb.negativo ? -dano(sb.clave) : peso(sb.clave));
        const combinado = pesoFusionado(r.resultado, tabla, typeIdx) ?? 0;
        let quitaNegativo = null, probPeor = 0, probBuscado = 0, despues = 0;
        if (sa.negativo || sb.negativo) {
            const neg = sa.negativo ? sa : sb;
            const cand = libres.filter((c) => canBeNegative(c, typeIdx));
            despues = combinado - media(cand.map(dano));
            probPeor = cand.length ? cand.filter((c) => dano(c) > dano(neg.clave)).length / cand.length : 0;
            quitaNegativo = neg.clave;
        } else {
            despues = combinado + media(libres.map(peso));
            probBuscado = libres.length ? libres.filter((c) => buscSet.has(c)).length / libres.length : 0;
        }
        resultados.push({ receta: r, quitaNegativo, antes, despues, delta: despues - antes, probPeor, probBuscado });
    }
    return resultados.sort((a, b) => b.delta - a.delta);
}
