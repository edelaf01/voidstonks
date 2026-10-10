import { claveStat } from "./riven_cycling.js";

let _carga = null;
let _de10 = null;

const PREFIJOS_FAMILIA = ["coda_", "kuva_", "tenet_", "prisma_", "dex_", "carmine_", "telos_", "synoid_", "secura_", "rakta_", "sancti_", "mara_", "vaykor_"];
const SUFIJOS_FAMILIA = ["_prime", "_vandal", "_wraith", "_coda"];
const ALIAS_FAMILIA = { dex_furis: "furis", dex_afuris: "afuris", pangolin: "pangolin_sword", pangolin_prime: "pangolin_sword", pangolin_sword: "pangolin_sword", dual_decurions: "dual_decurion", prisma_dual_decurions: "dual_decurion" };
const POP_FIABLE = 3;
const K_L = 3;
const K_S = 5;
const RHO = 0.7;
const CLASE = { Sniper: "Rifle", Bow: "Rifle", Launcher: "Rifle", "Companion Weapon": "Rifle", "Dual Pistols": "Pistol", Throwing: "Pistol", "Zaw Component": "Melee" };
const NORMAL_A = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
const NORMAL_B = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
const NORMAL_C = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
const NORMAL_D = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
const NORMAL_BAJO = 0.02425;

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

export function cargarDe10() {
    if (_de10 === null) {
        _de10 = fetch("assets/ml/de10.json")
            .then(r => {
                if (!r.ok) throw new Error(String(r.status));
                return r.json();
            })
            .then(d => {
                if (!d || !d.familias || !d.mu || !d.mu.l || !d.mu.s) throw new Error("de10");
                return d;
            })
            .catch(() => {
                _de10 = null;
                return null;
            });
    }
    return _de10;
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

export function registroSinWfm(modelo, nivel, dispo, tipo) {
    const sin = modelo?.sin_wfm;
    if (!sin || !Number.isFinite(nivel) || !(dispo > 0)) return null;
    const escalar = (refs) => Object.fromEntries(Object.entries(refs).map(([s, r]) => [s, r * dispo]));
    return {
        nivel,
        log_n: sin.log_n,
        tipo: tipo ?? null,
        ref_pos: escalar(sin.ref_pos),
        ref_neg: escalar(sin.ref_neg)
    };
}

export function claveFamilia(nombre, tabla) {
    if (!tabla || nombre == null) return null;
    const s = slugArma(nombre);
    const b = baseFamilia(s);
    if (Object.hasOwn(tabla, b)) return b;
    return Object.hasOwn(tabla, s) ? s : null;
}

export function claseArma(tipo) {
    return tipo ? (CLASE[tipo] ?? tipo) : null;
}

const tramoDe10 = (pop10) => pop10 < 1.5 ? "<1.5" : pop10 < 3 ? "1.5-3" : ">=3";

export function filaDe10(de10, nombre, deVivo = null) {
    if (!de10) return null;
    const familia = claveFamilia(nombre, de10.familias);
    if (familia) return de10.familias[familia];
    const med = Number(deVivo?.median);
    if (!(med > 0)) return [de10.mu.l["<1.5"], de10.mu.s["<1.5"], 0, 0, 0];
    const pop = Number(deVivo.pop) || 0;
    const t = tramoDe10(pop / 10);
    const w = Math.max(pop, 0.5);
    const sd = Number(deVivo.stddev) || 0;
    const s = Math.sqrt(Math.log((1 + Math.sqrt(1 + 4 * (sd / med) ** 2)) / 2));
    return [
        (w * Math.log(med) + K_L * (de10.mu.l[t] ?? de10.mu.l["<1.5"])) / (w + K_L),
        (w * s + K_S * (de10.mu.s[t] ?? de10.mu.s["<1.5"])) / (w + K_S),
        Number(deVivo.max_price) || 0,
        pop / 10,
        1
    ];
}

export function nivelSinWfm(modelo, nombre, fila) {
    const familia = claveFamilia(nombre, modelo?.nivel_pool);
    if (familia) return modelo.nivel_pool[familia];
    const sin = modelo?.sin_wfm;
    if (!sin || !fila) return NaN;
    return fila[3] >= POP_FIABLE ? fila[0] : sin.nivel[0] * fila[0] + sin.nivel[1];
}

export function poblacionTirada(modelo, nombre, tipo) {
    if (!modelo) return null;
    for (const tabla of [modelo.pob, modelo.pool]) {
        const familia = claveFamilia(nombre, tabla);
        if (familia) return tabla[familia];
    }
    const clase = claseArma(tipo);
    return clase && modelo.pool_clase && Object.hasOwn(modelo.pool_clase, clase) ? modelo.pool_clase[clase] : null;
}

export function percentilTirada(poblacion, r) {
    if (!Array.isArray(poblacion) || poblacion.length < 3 || !Number.isFinite(r)) return 0.5;
    const n = Math.max(1, poblacion[0]);
    const q = poblacion.slice(1);
    const k = q.length - 1;
    let izq = 0;
    while (izq <= k && q[izq] < r) izq++;
    let der = izq;
    while (der <= k && q[der] === r) der++;
    let u;
    if (der > izq) u = (izq + der - 1) / 2 / k;
    else if (izq === 0) u = 0;
    else if (izq > k) u = 1;
    else u = (izq - 1 + (r - q[izq - 1]) / (q[izq] - q[izq - 1])) / k;
    return Math.min(1 - 0.5 / n, Math.max(0.5 / n, u));
}

const polinomio = (coef, x) => coef.reduce((suma, c) => suma * x + c, 0);

export function cuantilNormal(p) {
    if (!(p > 0)) return -Infinity;
    if (!(p < 1)) return Infinity;
    if (p < NORMAL_BAJO || p > 1 - NORMAL_BAJO) {
        const q = Math.sqrt(-2 * Math.log(Math.min(p, 1 - p)));
        const x = polinomio(NORMAL_C, q) / (polinomio(NORMAL_D, q) * q + 1);
        return p < NORMAL_BAJO ? x : -x;
    }
    const q = p - 0.5;
    const r = q * q;
    return polinomio(NORMAL_A, r) * q / (polinomio(NORMAL_B, r) * r + 1);
}

export function preciosDe10(fila, u, cuantiles, rho = RHO) {
    const [l10, s10, max10] = fila;
    const z = cuantilNormal(u);
    const resto = Math.sqrt(1 - rho * rho);
    const techo = max10 > 0 ? Math.log(max10) : Infinity;
    return cuantiles.map(q => Math.exp(Math.min(l10 + s10 * (rho * z + resto * cuantilNormal(q)), techo)));
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
