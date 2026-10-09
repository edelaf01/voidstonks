import { claveStat } from "./riven_cycling.js";

let _carga = null;

const PREFIJOS_FAMILIA = ["coda_", "kuva_", "tenet_", "prisma_", "dex_", "carmine_", "telos_", "synoid_", "secura_", "rakta_", "sancti_", "mara_", "vaykor_"];
const SUFIJOS_FAMILIA = ["_prime", "_vandal", "_wraith", "_coda"];
const ALIAS_FAMILIA = { dex_furis: "furis", dex_afuris: "afuris", pangolin: "pangolin_sword", pangolin_prime: "pangolin_sword", pangolin_sword: "pangolin_sword", dual_decurions: "dual_decurion", prisma_dual_decurions: "dual_decurion" };
const POP_FIABLE = 3;
const MIN_INDICE = 20;

export function slugArma(nombre) {
    return String(nombre ?? "").toLowerCase().trim().replace(/&/g, "and").replace(/[\s-]+/g, "_").replace(/[^a-z0-9_]/g, "").replace(/_+/g, "_");
}

export function baseFamilia(slug) {
    if (Object.hasOwn(ALIAS_FAMILIA, slug)) return ALIAS_FAMILIA[slug];
    let base = slug;
    let cambiado;
    do {
        cambiado = false;
        for (const pre of PREFIJOS_FAMILIA) {
            if (base.startsWith(pre)) {
                base = base.slice(pre.length);
                cambiado = true;
            }
        }
        for (const suf of SUFIJOS_FAMILIA) {
            if (base.endsWith(suf)) {
                base = base.slice(0, -suf.length);
                cambiado = true;
            }
        }
    } while (cambiado);
    return base;
}

export function cargarNivelTirada() {
    if (_carga === null) {
        _carga = fetch("assets/ml/nivel_y_tirada.json")
            .then(r => {
                if (!r.ok) throw new Error(String(r.status));
                return r.json();
            })
            .then(prepararNivelTirada)
            .catch(() => {
                _carga = null;
                return null;
            });
    }
    return _carga;
}

export function prepararNivelTirada(datos) {
    if (!datos || !datos.armas || !datos.modelo || !datos.efectos) return null;
    const familias = new Map();
    for (const a of Object.keys(datos.armas)) {
        const s = slugArma(a);
        if (!familias.has(s)) familias.set(s, a);
    }
    for (const a of Object.keys(datos.armas)) {
        const b = baseFamilia(slugArma(a));
        if (!familias.has(b)) familias.set(b, a);
    }
    return {
        ...datos,
        indice: new Map(Object.keys(datos.armas).map(a => [a.toLowerCase(), a])),
        familias
    };
}

export function nombreArma(modelo, arma) {
    if (!modelo || arma == null) return null;
    if (Object.hasOwn(modelo.armas, arma)) return arma;
    const exacto = modelo.indice.get(String(arma).trim().toLowerCase());
    if (exacto !== undefined) return exacto;
    if (modelo.familias) {
        const s = slugArma(arma);
        return modelo.familias.get(s) ?? modelo.familias.get(baseFamilia(s)) ?? null;
    }
    return null;
}

const NOMBRES_WFM = {
    "Damage": "Base Damage / Melee Damage",
    "Fire Rate": "Fire Rate / Attack Speed",
    "Attack Speed": "Fire Rate / Attack Speed",
    "Electric": "Electric Damage",
    "Toxin": "Toxin Damage",
    "Heat": "Heat Damage",
    "Cold": "Cold Damage",
    "Impact": "Impact Damage",
    "Puncture": "Puncture Damage",
    "Slash": "Slash Damage",
    "Slide Attack Critical Chance": "Critical Chance On Slide Attack",
    "Damage to Grineer": "Damage Vs Grineer",
    "Damage to Corpus": "Damage Vs Corpus",
    "Damage to Infested": "Damage Vs Infested",
    "Damage to Orokin": "Damage To Orokin"
};

const MULTIPLICADORES = new Set([
    "Damage Vs Grineer",
    "Damage Vs Corpus",
    "Damage Vs Infested",
    "Damage To Orokin"
]);

export function atributosAWfm(atributos, tipoIdx) {
    const positivos = [];
    let negativo = null;
    for (const a of (atributos || [])) {
        const clave = claveStat(a.name, tipoIdx) || String(a.name || "").trim();
        const nombre = clave === "Chance not to gain Combo"
            ? (a.isPositive ? "Chance To Gain Extra Combo Count" : "Chance To Gain Combo Count")
            : (NOMBRES_WFM[clave] || clave);
        let valor = Math.abs(Number(a.value));
        if (MULTIPLICADORES.has(nombre) && Number.isFinite(valor)) {
            valor = a.isPositive ? 1 + valor / 100 : 1 - valor / 100;
        }
        if (a.isPositive) {
            positivos.push([nombre, valor]);
        } else if (!negativo) {
            negativo = [nombre, valor];
        }
    }
    return { positivos: positivos.slice(0, 3), negativo };
}

export function caracteristicas(modelo, arma, positivos, negativo, registro = null) {
    const items = positivos.filter(p => p[0] !== "").map(([stat, mag]) => {
        let efecto = 0;
        if (Object.hasOwn(modelo.efectos.pos_local, arma) && Object.hasOwn(modelo.efectos.pos_local[arma], stat)) {
            efecto = modelo.efectos.pos_local[arma][stat];
        } else if (Object.hasOwn(modelo.efectos.pos_global, stat)) {
            efecto = modelo.efectos.pos_global[stat];
        }
        return { efecto, stat, mag };
    });

    items.sort((a, b) => b.efecto - a.efecto);

    const mags = [];
    let suma = 0;
    for (const item of items) {
        const ref = (registro ? registro.ref_pos : modelo.ref_pos[arma])?.[item.stat];
        if (!Number.isFinite(item.mag) || !Number.isFinite(ref) || ref === 0) {
            mags.push(NaN);
            suma += item.efecto * modelo.mag_por_defecto;
        } else {
            const m = Math.min(1, Math.max(0, Math.abs(item.mag) / ref));
            mags.push(m);
            suma += item.efecto * m;
        }
    }

    const statNeg = negativo ? negativo[0] : "";
    const magNeg = negativo ? negativo[1] : NaN;
    let efectoNeg = 0;
    if (Object.hasOwn(modelo.efectos.neg_local, arma) && Object.hasOwn(modelo.efectos.neg_local[arma], statNeg)) {
        efectoNeg = modelo.efectos.neg_local[arma][statNeg];
    } else if (Object.hasOwn(modelo.efectos.neg_global, statNeg)) {
        efectoNeg = modelo.efectos.neg_global[statNeg];
    }

    const refNeg = (registro ? registro.ref_neg : modelo.ref_neg[arma])?.[statNeg];
    const magNegNorm = !Number.isFinite(magNeg) || !Number.isFinite(refNeg) || refNeg === 0
        ? NaN
        : Math.min(1, Math.max(0, Math.abs(magNeg) / refNeg));

    const e1 = items[0]?.efecto ?? NaN;
    const e2 = items[1]?.efecto ?? NaN;
    const e3 = items[2]?.efecto ?? NaN;
    const m1 = mags[0] ?? NaN;
    const m2 = mags[1] ?? NaN;
    const m3 = mags[2] ?? NaN;

    const aDatos = registro ?? modelo.armas[arma];

    return [
        items.length,
        negativo ? 1 : 0,
        e1,
        e2,
        e3,
        m1,
        m2,
        m3,
        suma,
        efectoNeg,
        magNegNorm,
        aDatos.nivel,
        aDatos.log_n,
        ...modelo.stats_pos.map(s => items.some(it => it.stat === s) ? 1 : 0),
        ...modelo.stats_neg.map(s => s === statNeg ? 1 : 0),
        ...modelo.tipos.map(t => aDatos.tipo === t ? 1 : 0)
    ];
}

export function recorrerArboles(base, arboles, x) {
    let suma = Math.fround(base);
    for (const t of arboles) {
        let n = 0;
        while (t.L[n] !== -1) {
            const v = x[t.si[n]];
            n = Number.isNaN(v) ? (t.dl[n] ? t.L[n] : t.R[n]) : (Math.fround(v) < Math.fround(t.sc[n]) ? t.L[n] : t.R[n]);
        }
        suma = Math.fround(suma + Math.fround(t.sc[n]));
    }
    return suma;
}

export function registroSinWfm(modelo, deMed, dispo, tipo, pop = 0) {
    const sin = modelo?.sin_wfm;
    if (!sin || !(deMed > 0) || !(dispo > 0)) return null;
    const escalar = (refs) => Object.fromEntries(Object.entries(refs).map(([s, r]) => [s, r * dispo]));
    return {
        nivel: pop >= POP_FIABLE ? Math.log(deMed) : sin.nivel[0] * Math.log(deMed) + sin.nivel[1],
        cola: pop >= POP_FIABLE ? (sin.cola_de ?? 1) : 1,
        log_n: sin.log_n,
        tipo: tipo ?? null,
        ref_pos: escalar(sin.ref_pos),
        ref_neg: escalar(sin.ref_neg)
    };
}

export function indiceDE(modelo, metas) {
    const ref = modelo?.sin_wfm?.de_ref;
    if (!ref || !metas) return 0;
    const ratios = [];
    for (const [arma, r] of Object.entries(ref)) {
        const re = metas[arma]?.de_rerolled;
        if (r > 0 && re && (re.pop || 0) >= POP_FIABLE && re.median > 0) {
            ratios.push(Math.log(re.median / r));
        }
    }
    if (ratios.length < MIN_INDICE) return 0;
    ratios.sort((a, b) => a - b);
    const mid = Math.floor(ratios.length / 2);
    return ratios.length % 2 !== 0 ? ratios[mid] : (ratios[mid - 1] + ratios[mid]) / 2;
}

export function residuosTirada(modelo, arma, positivos, negativo, registro = null) {
    if (!modelo) return null;
    const nombre = nombreArma(modelo, arma);
    if (!nombre && !registro) return null;
    const x = nombre ? caracteristicas(modelo, nombre, positivos, negativo) : caracteristicas(modelo, null, positivos, negativo, registro);
    return modelo.modelo.arboles.map((arboles, q) => recorrerArboles(modelo.modelo.base[q], arboles, x)).sort((a, b) => a - b);
}

export function precisionNivel(modelo, arma) {
    const nombre = nombreArma(modelo, arma);
    const rec = nombre && modelo.precision && Object.hasOwn(modelo.precision, nombre) ? modelo.precision[nombre] : null;
    return rec ? { mape: rec.mape, n: rec.n } : null;
}
