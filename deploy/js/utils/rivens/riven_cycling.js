import { RIVEN_BASE_STATS, WEAPON_TYPE_IDX, canBeNegative } from "../../config.js";

// kuva per cycle flat from the tenth; a locked stat (Update 44) doubles it
const COSTE_CICLO = [900, 1000, 1200, 1400, 1700, 2000, 2350, 2750, 3150, 3500];

export function costeCiclo(ciclosHechos, bloqueado = false) {
    const i = Math.min(Math.max(0, Math.floor(Number(ciclosHechos) || 0)), COSTE_CICLO.length - 1);
    return COSTE_CICLO[i] * (bloqueado ? 2 : 1);
}

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

export function ciclosPara(p, prob = 0.9) {
    if (!(p > 0)) return Infinity;
    if (p >= 1) return 1;
    return Math.ceil(Math.log(1 - prob) / Math.log(1 - p));
}

export function tipoDeArma(tipo) {
    return WEAPON_TYPE_IDX[tipo] ?? 0;
}

export function poolDeStats(typeIdx) {
    return Object.keys(RIVEN_BASE_STATS).filter((k) => RIVEN_BASE_STATS[k][typeIdx]);
}

const ALIAS = {
    "crit chance": "Critical Chance", "crit damage": "Critical Damage",
    "base damage / melee damage": "Damage", "base damage": "Damage", "melee damage": "Damage",
    "weapon recoil": "Recoil", "projectile flight speed": "Projectile Speed",
    "critical chance on slide attack": "Slide Attack Critical Chance",
    "chance to gain extra combo count": "Chance not to gain Combo",
    "chance to gain combo count": "Chance not to gain Combo",
    "additional combo count": "Chance not to gain Combo",
    "channeling efficiency": "Heavy Attack Efficiency", "channeling damage": "Initial Combo",
};
const CLAVES = Object.fromEntries(Object.keys(RIVEN_BASE_STATS).map((k) => [k.toLowerCase(), k]));

export function claveStat(nombre, typeIdx) {
    const l = String(nombre || "").trim().toLowerCase().replace(/\s+/g, " ");
    if (["fire rate / attack speed", "fire rate", "attack speed"].includes(l)) {
        return typeIdx === 3 ? "Attack Speed" : "Fire Rate";
    }
    if (ALIAS[l]) return ALIAS[l];
    const faccion = l.match(/^damage (?:vs\.?|to) (grineer|corpus|infested)$/);
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

// unlocked: 2 or 3 positives, with or without negative, 25% each
const CONFIGS = [[2, false], [2, true], [3, false], [3, true]];

export function probPorCiclo({ pool, buscados, k, negOk, typeIdx, config = null, bloqueado = null }) {
    const busc = new Set(buscados), ok = new Set(negOk);
    if (bloqueado?.negativo && !config?.neg) return 0;
    const configs = bloqueado ? [[config.pos, config.neg]] : CONFIGS;
    const fijos = bloqueado && !bloqueado.negativo ? [bloqueado.stat] : [];
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

export function consejoDeCiclo({ stats, typeIdx, buscados, negOk, k = 2, ciclosHechos = 0 }) {
    const pool = poolDeStats(typeIdx);
    const leidos = (stats || []).map((s) => ({ ...s, clave: claveStat(s.name, typeIdx) }));
    if (leidos.some((s) => !s.clave || !pool.includes(s.clave))) return null;
    const positivos = leidos.filter((s) => s.isPositive);
    const negativos = leidos.filter((s) => !s.isPositive);
    if (positivos.length < 2 || positivos.length > 3 || negativos.length > 1) return null;

    const busc = [...new Set((buscados || []).map((b) => claveStat(b, typeIdx)))].filter((b) => b && pool.includes(b));
    if (busc.length === 0) return null;
    const ok = [...new Set((negOk || []).map((b) => claveStat(b, typeIdx)))]
        .filter((b) => b && pool.includes(b) && !busc.includes(b));
    const objetivo = { buscados: busc, negOk: ok, k: Math.min(k, busc.length) };
    const base = { pool, buscados: busc, negOk: ok, k: objetivo.k, typeIdx };
    const config = { pos: positivos.length, neg: negativos.length === 1 };

    const aciertos = positivos.filter((s) => busc.includes(s.clave)).length;
    const cumple = aciertos >= objetivo.k && (!config.neg || ok.includes(negativos[0].clave));

    const pSin = probPorCiclo(base);
    const sinBloqueo = { p: pSin, kuva: kuvaEsperada(pSin, ciclosHechos) };

    const candidatos = [];
    const mejorPositivo = positivos.filter((s) => busc.includes(s.clave))
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
    return { cumple, config, objetivo, sinBloqueo, bloqueo, conviene };
}

export const RECETAS_COMBINAR = [
    ["melee", "Heavy Attack Efficiency", "Chance not to gain Combo", ["Daño de ataque pesado", "Heavy Attack Damage"]],
    ["melee", "Heavy Attack Efficiency", "Combo Duration", ["Vel. de carga del ataque pesado", "Heavy Attack Wind Up Speed"]],
    ["melee", "Attack Speed", "Range", ["Ángulo de bloqueo", "Parry Angle"]],
    ["fuego", "Damage", "Zoom", ["Daño a punto débil", "Weak Point Damage"]],
    ["fuego", "Damage", "Multishot", ["Daño a punto débil", "Weak Point Damage"]],
    ["fuego", "Critical Chance", "Zoom", ["Prob. crítica en punto débil", "Weak Point Critical Chance"]],
    ["fuego", "Critical Chance", "Multishot", ["Prob. crítica en punto débil", "Weak Point Critical Chance"]],
    ["fuego", "Magazine Capacity", "Reload Speed", ["Eficiencia de munición", "Ammo Efficiency"]],
    ["fuego", "Recoil", "Ammo Maximum", ["Eficiencia de munición", "Ammo Efficiency"]],
    ["fuego", "Ammo Maximum", "Reload Speed", ["Recarga enfundada", "Holster Reload"]],
    ["fuego", "Ammo Maximum", "Magazine Capacity", ["Recarga enfundada", "Holster Reload"]],
    ["fuego", "Damage", "Status Chance", ["Daño de estado", "Status Damage"]],
    ["todas", "Toxin", "Heat", ["Gas", "Gas"]],
    ["todas", "Toxin", "Electric", ["Corrosivo", "Corrosive"]],
    ["todas", "Toxin", "Cold", ["Viral", "Viral"]],
    ["todas", "Heat", "Electric", ["Radiación", "Radiation"]],
    ["todas", "Heat", "Cold", ["Explosión", "Blast"]],
    ["todas", "Electric", "Cold", ["Magnético", "Magnetic"]],
    ["todas", "Damage to Corpus", "Damage to Grineer", ["Daño a Orokin", "Damage to Orokin"]],
    ["todas", "Damage to Corpus", "Damage to Infested", ["Daño a Techrot", "Damage to Techrot"]],
    ["todas", "Damage to Infested", "Damage to Grineer", ["Daño a Scaldra", "Damage to Scaldra"]],
].map(([ambito, a, b, resultado]) => ({ ambito, a, b, resultado }));

export function recetasDelTipo(typeIdx) {
    const pool = poolDeStats(typeIdx);
    const ambito = typeIdx === 3 ? "melee" : "fuego";
    return RECETAS_COMBINAR.filter((r) => (r.ambito === "todas" || r.ambito === ambito)
        && pool.includes(r.a) && pool.includes(r.b));
}

export function combinacionesDe(stats, typeIdx) {
    const claves = new Set((stats || []).map((s) => claveStat(s.name, typeIdx)));
    return recetasDelTipo(typeIdx).filter((r) => claves.has(r.a) && claves.has(r.b));
}
