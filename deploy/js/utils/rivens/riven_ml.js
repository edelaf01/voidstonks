import { classifyWeaponMarket } from "./riven_logic.js";
import { state } from "../../state.js";
import { tipoDeArma, esFusionado, pesoFusionado } from "./riven_cycling.js";
import { cargarNivelTirada, cargarDe10, atributosAWfm, residuosTirada, precisionNivel, registroSinWfm, nombreArma, filaDe10, nivelSinWfm, poblacionTirada, percentilTirada, preciosDe10 } from "./riven_nivel.js";

let _ml = null;
let _loading = null;

export async function loadRivenML() {
  if (_ml) return _ml;
  if (_loading) return _loading;
  _loading = (async () => {
    const base = "assets/ml/";
    const [bands, statWeights, cal] = await Promise.all([
      fetch(base + "price_bands.json").then(r => r.json()).catch(() => ({})),     // banda histórica por arma
      fetch(base + "stat_weights.json").then(r => r.json()).catch(() => ({})),    // pesos pos/neg por arma
      fetch(base + "calibracion_por_arma.json").then(r => r.json()).catch(() => ({})), // drift/synlo/nsamp
    ]);

    _ml = {
      bands: bands || {}, statWeights: statWeights || {},
      cal: cal || {}, drift: (cal && cal.drift) || {}, synlo: (cal && cal.synlo) || {}, nsamp: (cal && cal.nsamp) || {},
    };
    // Prior global de stats (31 stats con peso del ML: CD 1.00, Multishot 0.90, CC 0.89, Range 0.89,
    // ... Zoom/Recoil abajo). Se publica en state para que la TASACIÓN pueda interpolar los stats de
    // los que no hay dato del arma. Antes ese hueco lo tapaban dos constantes a dedo (1.0 para los
    // stats de la lista `pos` y 0.85 para `midPos`), que no distinguían un Critical Damage de un
    // Range en un arma de fuego. Va aquí y no vía worker porque el bundle es local: si el endpoint de
    // metastats falla, el prior sigue disponible.
    const _prior = statWeights && statWeights._global && statWeights._global.pos;
    if (_prior && typeof _prior === "object" && !state.rivenStatPrior) {
      state.rivenStatPrior = _prior;
    }
    // La tabla completa por arma, para que la UI pueda ORDENAR dentro de un tier y marcar los TOP.
    // `dynamic_weights` (metastats) satura: en Torid, CD/CC/Multishot valen 1.00 los tres y no hay
    // forma de saber cuál manda. Aquí los tiers traen el peso fino (Multishot 0.998 vs CD 0.756).
    // Es la MISMA referencia ya cargada, no una copia: no cuesta memoria extra.
    if (statWeights && typeof statWeights === "object" && !state.rivenStatWeights) {
      state.rivenStatWeights = statWeights;
      // Repinta la guía: si el panel ya se dibujó sin estos pesos, sus marcas TOP están vacías y no
      // hay otro evento que las traiga. Vía globalThis y no por import para no crear el ciclo
      // ui_rivens -> riven_ml -> ui_rivens (ui.js ejecuta al importarse).
      if (typeof globalThis.refreshCurrentRivenMetaStats === "function") {
        try { globalThis.refreshCurrentRivenMetaStats(); } catch { /* panel no montado aún */ }
      }
    }
    // Reparto meta/magnitud del score, MEDIDO en el entrenamiento (calibracion_por_arma.json).
    // Estaba a mano en riven_logic.js y así nadie sabía si el número seguía vigente; ahora se
    // recalcula en cada reentreno desde el efecto real de la magnitud sobre el precio.
    if (cal && typeof cal.peso_magnitud === "number" && cal.peso_magnitud > 0) {
      state.rivenPesoMagnitud = cal.peso_magnitud;
    }
    return _ml;
  })();
  return _loading;
}

// Busca un valor en una tabla por arma tolerando mayúsculas/espacios.
function _byWeapon(table, weaponName) {
  if (!table || weaponName == null) return undefined;
  if (table[weaponName] != null) return table[weaponName];
  const nl = String(weaponName).toLowerCase();
  const k = Object.keys(table).find(x => x.toLowerCase() === nl);
  return k ? table[k] : undefined;
}

// Clasifica el MERCADO del arma (meta/burbuja/ilíquido/medio) cruzando los asks vivos (meta.wfm_avg)
// con el precio central robusto servido (band.typical = mediana histórica 1 mes) + liquidez/momentum.
// Resuelve la banda del arma desde price_bands.json y delega en classifyWeaponMarket.
export async function getWeaponMarket(weaponName, meta) {
  const ml = await loadRivenML();
  const bands = ml.bands || {};
  let band = bands[weaponName];
  if (!band) {
    const nl = String(weaponName || "").toLowerCase();
    const k = Object.keys(bands).find(x => x.toLowerCase() === nl);
    band = k ? bands[k] : null;
  }
  return classifyWeaponMarket(meta || (band ? { official_median: band.typical } : null), band);
}

// Califica un riven SEGÚN EL ARMA: cada positivo por lo POPULAR que es en esa arma, y cada negativo
// por cuánto la ARRUINA (una negativa que es un stat top del arma es ruinosa; una irrelevante es
// inofensiva). Usa los pesos data-driven por arma (stat_weights.json, percentiles del histórico),
// con fallback al prior global. Devuelve nota por stat + score 0-100 + grado.
export async function gradeRiven(weaponName, stats) {
  const ml = await loadRivenML();
  const sw = ml.statWeights || {};
  // Arma con lookup tolerante a mayúsculas/espacios; prior global del export es "_global"
  // (el nombre viejo "__baseline" ya no existe en stat_weights.json -> todo caía al 0.30).
  const findWeapon = (name) => {
    if (sw[name]) return sw[name];
    const nl = String(name || "").trim().toLowerCase();
    const k = Object.keys(sw).find(x => x.toLowerCase() === nl);
    return k ? sw[k] : undefined;
  };
  const W = findWeapon(weaponName) || {};
  const base = sw.__baseline || sw._global || {};
  // Soporta los DOS formatos del export: plano {stat: peso} (prior _global) y anidado por
  // tiers {S:{stat:peso}, A:{...}, B:{...}} (entradas por arma de stat_weights.json).
  const lookup = (table, name) => {
    if (!table) return undefined;
    const direct = (t) => {
      if (t[name] != null) return t[name];
      const nl = name.toLowerCase();
      const k = Object.keys(t).find(x => x.toLowerCase() === nl);
      return k ? t[k] : undefined;
    };
    const v = direct(table);
    if (typeof v === "number") return v;
    for (const tier of Object.values(table)) {
      if (tier && typeof tier === "object") {
        const tv = direct(tier);
        if (typeof tv === "number") return tv;
      }
    }
    return undefined;
  };
  const posTier = (w) => w >= 0.75 ? "S" : w >= 0.45 ? "A" : w >= 0.15 ? "B" : "F";
  const isEs = state.currentLang === "es";
  const negLabel = (b) => isEs
    ? (b >= 0.70 ? "RUINOSA" : b >= 0.40 ? "MEDIA" : "INOFENSIVA")
    : (b >= 0.70 ? "RUINOUS" : b >= 0.40 ? "AVERAGE" : "HARMLESS");

  const plano = (t) => t && Object.values(t).some((v) => v && typeof v === "object")
    ? Object.assign({}, ...Object.values(t).filter((v) => v && typeof v === "object"))
    : t;
  const tipo = tipoDeArma(state.weaponMap?.[weaponName]?.t);

  const out = [];
  const posW = [];
  let negFactor = 1;
  for (const s of stats) {
    if (s.isPositive) {
      const w = (esFusionado(s.name, tipo)
        ? pesoFusionado(s.name, plano(W.pos), tipo) ?? pesoFusionado(s.name, plano(base.pos), tipo)
        : lookup(W.pos, s.name) ?? lookup(base.pos, s.name)) ?? 0.30;
      posW.push(w);
      out.push({ name: s.name, isPositive: true, weight: +w.toFixed(2), tier: posTier(w), popular: w >= 0.45 });
    } else {
      // DAÑO de una negativa = lo valiosa que es ESE stat como POSITIVO en esta arma.
      // Perder un stat top (CC/CD/Multishot) arruina; un stat irrelevante (Zoom, Recoil, facción)
      // como negativa es inofensivo. (No usamos el peso "neg" del histórico: está confundido por
      // el precio — las negativas inofensivas salen en godrolls caros y darían daño alto erróneo.)
      // El peso del stat COMO POSITIVO ya mide esto por arma, así que no hace falta una lista de
      // "inofensivas": los datos las separan solas (global: zoom 0.01, recoil 0.09, facción 0.08-0.12
      // frente a CC/CD/Multishot 0.89-1.00). El regex /zoom|recoil|vs |faction/ además MENTÍA en las
      // armas donde ese stat sí vale: forzaba 0.05 a un recoil que llega a 0.65 y a un "vs Corpus"
      // que llega a 0.81 según el arma. Sin lista, cada arma usa su propio peso.
      let b = lookup(W.pos, s.name) ?? lookup(base.pos, s.name) ?? 0.30;
      b = Math.max(0.05, Math.min(1, b));
      negFactor *= (1 - 0.6 * b);
      out.push({ name: s.name, isPositive: false, badness: +b.toFixed(2), label: negLabel(b) });
    }
  }
  // score: media de positivos (ponderada al mejor) × penalización por negativas.
  const posAvg = posW.length ? (posW.reduce((a, b) => a + b, 0) / posW.length) : 0;
  const best = posW.length ? Math.max(...posW) : 0;
  const score = Math.round(Math.max(0, Math.min(100, (0.6 * posAvg + 0.4 * best) * negFactor * 100)));
  const grade = score >= 85 ? "S" : score >= 70 ? "A" : score >= 50 ? "B" : score >= 30 ? "C" : "F";
  return { weapon: weaponName, score, grade, stats: out };
}

// Precisión del modelo POR ARMA (horneada en el entrenamiento: MAPE del p50 en test held-out).
// Devuelve {mape, grade, n} o null si no hay dato. grade: alta <40% · media 40-80% · baja >80%/sin datos.
export async function weaponPrecision(weaponName) {
  const rec = precisionNivel(await cargarNivelTirada(), weaponName);
  if (!rec) return null;
  const mape = Math.round(rec.mape);
  const grade = mape < 40 ? (state.currentLang === "es" ? "alta" : "high")
    : mape < 80 ? (state.currentLang === "es" ? "media" : "medium")
      : (state.currentLang === "es" ? "baja" : "low");
  return { mape, grade, n: rec.n || null };
}

// DOS SCORES independientes para un riven:
//   stat  = CALIDAD POR STATS (meta): qué stats tiene y cómo de buscados son en ESTA arma (gradeRiven).
//           No mira magnitud. Un CC/CD es alto aunque haya rolleado bajo.
//   roll  = CALIDAD DEL ROLL (magnitud): cuánto rolaron los valores dentro de su rango posible.
//           No mira meta. Un roll perfecto de stats malos tiene roll alto pero stat bajo.
// itemAttributes: [{name, value, isPositive, minIdeal, maxIdeal}, ...]
export async function rivenScores(weaponName, itemAttributes) {
  const g = await gradeRiven(weaponName, itemAttributes);   // meta (stats)
  const _grade = (s) => s >= 85 ? "S" : s >= 70 ? "A" : s >= 50 ? "B" : s >= 30 ? "C" : "F";
  // ROLL (magnitud): posición del valor en su rango posible [minIdeal, maxIdeal].
  const rollPerStat = [];
  const posPcts = [];
  for (const a of itemAttributes) {
    const v = Math.abs(a.value || 0), lo = Math.abs(a.minIdeal || 0), hi = Math.abs(a.maxIdeal || 0);
    let pct = hi > lo ? (v - lo) / (hi - lo) : (v > 0 ? 1 : 0);
    pct = Math.max(0, Math.min(1, pct));
    rollPerStat.push({ name: a.name, isPositive: !!a.isPositive, pct: Math.round(pct * 100) });
    if (a.isPositive) posPcts.push(pct);
  }
  const rollScore = posPcts.length ? Math.round(posPcts.reduce((x, y) => x + y, 0) / posPcts.length * 100) : 0;
  return {
    weapon: weaponName,
    stat: { score: g.score, grade: g.grade, perStat: g.stats },       // meta por stats
    roll: { score: rollScore, grade: _grade(rollScore), perStat: rollPerStat }, // magnitud del roll
  };
}

// Tasación anclada a VENTAS REALES de DE (no a los asks). El precio sale de posicionar la CALIDAD del
// roll (score, que lee magnitud) sobre la DISTRIBUCIÓN REAL de DE (de_rerolled: median/max/floor):
//   - score<=0.5: floor (trash) -> mediana real.
//   - score>0.5 : mediana -> máx real con curva CONVEXA (frac²) que capta el sesgo propio del arma
//     (max/median): mid rolls cerca de la mediana, godrolls escalan hacia el máximo realmente vendido.
// El `list` (precio de LISTAR) se calcula de los deciles de ASKS (price_bands.json) solo para el tooltip,
// porque los asks superan a las ventas reales ~8-11× (Acceltra med 84 vs asks 844). Ver informe.
export async function mlBandEstimate(weaponName, itemAttributes, scoreOverride = null, de = null) {
  const ml = await loadRivenML();
  const bands = ml.bands || {};
  let b = bands[weaponName];
  if (!b) {
    const nl = String(weaponName || "").toLowerCase();
    const k = Object.keys(bands).find(x => x.toLowerCase() === nl);
    b = k ? bands[k] : null;
  }
  // score 0-100: usa el override (la nota mostrada, que SÍ lee magnitud) si viene; si no, gradeRiven.
  const g = await gradeRiven(weaponName, itemAttributes);
  const score = (scoreOverride != null && Number.isFinite(scoreOverride)) ? scoreOverride : g.score;
  const s = Math.max(0, Math.min(1, (score || 0) / 100));

  // VENTA real desde la distribución de DE
  const med = (de && de.median > 0) ? de.median : (b ? b.typical : 50);
  let mx = (de && de.max > med) ? de.max : med * 10;
  if (b && b.ceiling > med) {
    mx = Math.min(mx, b.ceiling);
  } else {
    mx = Math.min(mx, med * 8); // cap raw outlier DE max at 8x median
  }
  // El floor NUNCA puede superar la mediana: en armas de poco volumen el unrolled real puede salir
  // por encima del rerolled (Amphis: unrolled 135 vs rerolled 90) y entonces el Math.max(floor,...)
  // de abajo aplastaba TODA la banda a un punto — godroll y trash daban los dos 135pl.
  const floor = Math.min((de && de.floor > 0) ? de.floor : Math.round(med * 0.5), Math.round(med * 0.5));
  let sale;
  if (s <= 0.5) {
    sale = Math.round(floor + (med - floor) * (s / 0.5));
  } else {
    const frac = (s - 0.5) / 0.5;
    const skew = Math.max(1.2, mx / med);            // cuán amplio es el rango real del arma
    sale = Math.round(med * Math.pow(skew, Math.pow(frac, 1.5)));
  }
  sale = Math.max(floor, sale);

  // LIST (ask): posición del score en los deciles de asks, solo informativo
  let list = sale;
  const q = b && Array.isArray(b.q) && b.q.length === 9 ? b.q : null;
  if (q) {
    const hi = Math.max(b.ceiling, q[8]);
    if (s <= 0.1) list = Math.round(b.floor + (q[0] - b.floor) * (s / 0.1));
    else if (s >= 0.9) list = Math.round(q[8] + (hi - q[8]) * ((s - 0.9) / 0.1));
    else { const pos = (s - 0.1) / 0.1, i = Math.floor(pos), f = pos - i; list = Math.round(q[i] + (q[Math.min(8, i + 1)] - q[i]) * f); }
  }
  return { price: sale, list, floor, median: med, max: mx, score: Math.round(score), grade: g.grade };
}

// Banda de precio ROBUSTA anclada a datos reales (DE) + histórico, inmune a outliers de un día.
// floor   = mediana histórica de official_median (DE unrolled real)  -> suelo estable
// typical = rerolled median de DE (si es sano y con volumen) o floor × premium histórico
// ceiling = typical × factor generoso pero ACOTADO (godrolls suben, pero sin récords troll)
// Si falta histórico/volumen, cae a los datos de hoy y, en última instancia, a múltiplos del floor.
export function robustPriceBand(weapon, history) {
  // FLOOR y TYPICAL salen del DATO REAL EN VIVO del endpoint (/api/rivens) por arma — siempre fresco,
  // automático. El CEILING (godroll) usa el histórico acumulado (price_bands.json), que necesita todo
  // el dataset. NO se usa el p15 de los listados WFM como suelo (en armas meta está inflado).
  const served = (_ml && _ml.bands && weapon) ? _ml.bands[weapon.name] : null;
  const days = Array.isArray(history?.data) ? history.data
    : (Array.isArray(history) ? history : []);
  const median = (arr) => {
    const v = arr.filter(x => typeof x === "number" && x > 0).sort((a, b) => a - b);
    return v.length ? v[Math.floor((v.length - 1) / 2)] : 0;
  };
  const deUn = weapon?.de_unrolled || {};
  const deRe = weapon?.de_rerolled || {};

  // FLOOR = precio REAL de DE en vivo (official_median); respaldos: histórico /api/history, unrolled, served.
  let floor = (weapon && weapon.official_median > 0 ? weapon.official_median : 0)
    || median(days.map(d => d.official_median)) || deUn.median || (served && served.floor) || 15;

  // TYPICAL = rerolled real de DE en vivo (si sano y con volumen); si no, premium histórico o served.
  let typical;
  if (deRe.median > 0 && deRe.median >= floor && (deRe.pop || 0) >= 1) {
    typical = deRe.median;
  } else {
    const histPrem = median(days.map(d => d.rerolled_premium_ratio).filter(x => x > 1.05));
    typical = histPrem > 1 ? Math.round(floor * histPrem)
      : (served && served.typical > floor ? served.typical : Math.round(floor * 1.7));
  }
  if (typical < floor) typical = Math.round(floor * 1.5);

  // CEILING (godroll) = histórico acumulado (served = p88 WFM winsorizado); si no, múltiplo acotado.
  let ceiling = (served && served.ceiling > typical) ? served.ceiling : 0;
  if (!ceiling) {
    ceiling = typical * 5;
    const obsMax = Math.max(deUn.max_price || 0, deRe.max_price || 0, median(days.map(d => d.web_max)) || 0);
    if (obsMax > typical) ceiling = Math.max(ceiling, typical + (obsMax - typical) * 0.35);
    ceiling = Math.min(ceiling, typical * 8);
  }
  ceiling = Math.max(ceiling, typical * 3);

  return { floor: Math.round(floor), typical: Math.round(typical), ceiling: Math.round(ceiling) };
}

const MODEL_STAT_MAP = {
  "Damage": "Base Damage / Melee Damage",
  "Melee Damage": "Base Damage / Melee Damage",
  "Base Damage": "Base Damage / Melee Damage",
  "Fire Rate": "Fire Rate / Attack Speed",
  "Attack Speed": "Fire Rate / Attack Speed",
  "Fire Rate / Attack Speed": "Fire Rate / Attack Speed",
  "Toxin": "Toxin Damage",
  "Heat": "Heat Damage",
  "Electric": "Electric Damage",
  "Cold": "Cold Damage",
  "Impact": "Impact Damage",
  "Puncture": "Puncture Damage",
  "Slash": "Slash Damage",
  "Damage to Grineer": "Damage Vs Grineer",
  "Damage to Corpus": "Damage Vs Corpus",
  "Damage to Infested": "Damage Vs Infested",
  "Slide Attack Critical Chance": "Critical Chance On Slide Attack",
  "Slide Crit Chance": "Critical Chance On Slide Attack",
};

function _synergy(weapon, itemAttributes, weaponData) {
  const dw = weapon.dynamic_weights || (weaponData && weaponData.dynamic_weights) || {};
  const dwKey = (name) => {
    const nl = name.toLowerCase();
    return Object.keys(dw).find(k => k.toLowerCase() === nl);
  };
  const tipo = tipoDeArma((weaponData && weaponData.t) || weapon.t);
  let synergy = 0;
  for (const a of itemAttributes) {
    if (!a.isPositive) continue;
    if (esFusionado(a.name, tipo)) {
      synergy += pesoFusionado(a.name, dw, tipo) ?? 0.05;
    } else {
      const k = dwKey(a.name);
      synergy += k ? (parseFloat(dw[k]) || 0.05) : 0.05;
    }
  }
  return synergy;
}

// Tasación por BANDA de cuantiles: devuelve {p25,p50,p80,p90,p95} en pl, anclada al mercado de cada
// arma (drift del history) y con flag de CONFIANZA. El p50 es el "precio justo"; p25 venta rápida;
// p80/p90/p95 techo godroll (precio REAL de mercado, no asks especulativos).
export async function predictRivenMLBand(weapon, itemAttributes, weaponData = null, rerolls = 0, scoreOverride = null) {
  const [ml, nt, de10] = await Promise.all([loadRivenML(), cargarNivelTirada(), cargarDe10()]);
  const synergy = _synergy(weapon, itemAttributes, weaponData);
  const wname = weapon.name || weapon.weaponName;
  const qs = [0.25, 0.5, 0.8, 0.9, 0.95];
  const drift = _byWeapon(ml.drift, wname) || 1.0;

  // CALIDAD del roll 0..1: el score mostrado (adjustedScore, lee magnitud y sabe que CC/CD es top)
  // si viene; si no, gradeRiven (pesos por arma). NO se usa el ranking en asks del modelo: los asks
  // están comprimidos/inflados y distorsionan (un CC/CD salía "trash"). El score es la señal fiable.
  let scoreVal = scoreOverride;
  if (!Number.isFinite(scoreVal)) { const g = await gradeRiven(wname, itemAttributes); scoreVal = g.score; }
  const s = Math.max(0, Math.min(1, (scoreVal || 0) / 100));

  // === NIVEL anclado a VENTAS REALES de DE (no asks). El modelo/entrenamiento van sobre ASKS de WFM,
  // inflados ~3-20× en armas meta -> subvaloran/ sobrevaloran. Mapeamos la CALIDAD (score) sobre la
  // distribución REAL de DE: mediana = venta típica, max = techo godroll real. Convexo arriba.
  const b = _byWeapon(ml.bands, wname);
  const deRe = weapon.de_rerolled || (weaponData && weaponData.de_rerolled) || {};
  const deUn = weapon.de_unrolled || (weaponData && weaponData.de_unrolled) || {};
  const usaDE = (deRe.median > 0 || deUn.median > 0);
  // deMed es EL ancla de toda la banda, así que un rerolled anecdótico la desplaza entera. La
  // "mediana" de rerolled con 1-2 ventas no es un precio típico: Attica trae median=1150 con pop=1
  // sobre un unrolled de 14pl (82×), Akvasto 700 con pop=2 (70×). Con poco volumen la acotamos a
  // un múltiplo del unrolled (que sí tiene ventas): el premium por rolar es ~2-4×, no 80×.
  let deMedRaw = usaDE ? (deRe.median > 0 ? deRe.median : deUn.median) : (b ? b.typical : 50);
  if (deRe.median > 0 && (deRe.pop || 0) < 3 && deUn.median > 0 && deMedRaw > deUn.median * 4) {
    deMedRaw = deUn.median * 4;
  }
  const deMed = deMedRaw;
  let deMax = (deRe.max_price || deRe.max || 0);
  // Techo godroll ACOTADO: un godroll real vale ~3-8× la mediana, NO 25×. El 25× (asks outlier de
  // un día) arrastraba los rolls medios hacia arriba por la curva convexa -> sobreprecio (un 66%
  // salía a ~3× el típico). Cap a 8× (con datos) / 5× (sin datos de max) = techo de mercado creíble.
  //
  // max_price es UNA venta (el récord del arma), así que en la mitad del catálogo se iba por encima
  // del cap y TODAS esas armas acababan con el mismo skew=8 -> la curva convexa daba el mismo
  // multiplicador al arma con dispersión real 2× que a la de 50×. Medido: skew mediano 9.1×, y 178
  // de 346 armas tocaban el cap. Preferimos un techo ROBUSTO (mediana + 2σ de las ventas rerolled),
  // que sí distingue un arma de precio estable de una dispersa; max_price solo lo acota por arriba.
  // σ solo es evidencia con VOLUMEN: con una sola venta (pop=1) sale σ=0, que no significa "precio
  // sin dispersión" sino "no sabemos". Sin ese guard el techo colapsaba a la mediana y la banda
  // entera se aplanaba a un punto (Amphis: godroll y trash daban los dos 135pl). Suelo de 3× para
  // que el godroll siempre tenga recorrido sobre el típico.
  // MEDIDO Y SIN RESOLVER (2026-08-07): este cap de 8x recorta al 91% de las armas. El techo real
  // sobre 136 armas con ventas fiables es p25=17x, mediana=33x, p75=61x la mediana — y NO es ruido
  // de outlier: las armas con pop>=20 dan 45x, o sea que con más datos sube. Tampoco se puede
  // estimar con sigma (sd/med=2.7, cola derecha 34x la izquierda: med+2σ da 6.4x y comprime igual).
  // Contexto: la mediana de DE cae en el percentil 3 del recorrido [min,max] porque casi todo lo que
  // se vende es trash, así que NO es "el precio típico" sino casi el suelo.
  // Se probó a subir el cap y no movió la tasación heurística (godroll 332p -> 332p en 136 armas):
  // ahí manda calculateAdvancedPredictivePrice, no esta banda. Antes de tocarlo hay que poder medir
  // esta ruta de forma aislada; subirlo a ciegas cambia precios de producción sin evidencia.
  const deSd = (deRe.stddev > 0 && (deRe.pop || 0) >= 3) ? deRe.stddev : 0;
  const robustMax = deSd > 0 ? Math.max(deMed + 2 * deSd, deMed * 3) : 0;
  if (robustMax > deMed) deMax = deMax > deMed ? Math.min(deMax, robustMax) : robustMax;
  deMax = deMax > deMed ? Math.min(deMax, deMed * 8) : deMed * 5;
  const deFloor = Math.max(1, Math.round(Math.min(deMed, deUn.median || deMed) * 0.45));
  const levelMap = (f) => {   // f(0..1) calidad -> precio de venta real
    if (f <= 0.5) return deFloor + (deMed - deFloor) * (f / 0.5);
    // s>0.5: mediana -> máx real. Exponente 1.5 (antes 1.05): los rolls MEDIOS (0.5-0.75) se quedan
    // cerca del típico y solo los rolls altos (0.85+) se acercan de verdad al techo godroll. Antes
    // el 1.05 subía casi lineal y sobre-tasaba un roll normal como si fuera godroll.
    const fr = (f - 0.5) / 0.5, skew = Math.max(1.3, deMax / deMed);
    return deMed * Math.pow(skew, Math.pow(fr, 1.5));
  };

  // OJO: la negativa mala YA la penaliza el SCORE (un -Multishot en Torid
  // tira el score a ~9%), así que NO se vuelve a multiplicar por BRICK aquí (era doble castigo y
  // aplanaba la banda al floor). Solo se marca esBrick para el label.
  const neg = itemAttributes.find(a => !a.isPositive);
  const dw = weapon.dynamic_weights || (weaponData && weaponData.dynamic_weights) || {};
  // BRICK = perder un stat que en ESTA arma es top. La lista fija (CC/CD/BaseDamage/Multishot/
  // FireRate) era redundante con el umbral de peso —esos stats puntúan 0.70-1.00 en el prior global,
  // muy por encima del 0.6— y además fallaba en los dos sentidos: no marcaba un -Range en un melee
  // que lo tiene a 1.00, y marcaba un -Fire Rate en armas donde no importa. Ahora sale solo del peso,
  // con el prior global de stat_weights como respaldo cuando el arma no trae dynamic_weights.
  let esBrick = false;
  if (neg) {
    const nm = MODEL_STAT_MAP[neg.name] || neg.name;
    const dwKeyNeg = Object.keys(dw).find(k => k.toLowerCase() === nm.toLowerCase());
    let wneg = dwKeyNeg ? parseFloat(dw[dwKeyNeg]) : NaN;
    if (!Number.isFinite(wneg)) {
      const gpos = (ml.statWeights && ml.statWeights._global && ml.statWeights._global.pos) || {};
      const gk = Object.keys(gpos).find(k => k.toLowerCase() === nm.toLowerCase());
      wneg = gk ? parseFloat(gpos[gk]) : 0;
    }
    esBrick = Number.isFinite(wneg) && wneg >= 0.6;
  }

  // La banda p25..p95 = el score posicionado ± dispersión (rango de precio del propio roll).
  const OFF = { 0.25: -0.12, 0.50: 0.0, 0.80: 0.10, 0.90: 0.15, 0.95: 0.20 };
  const floor = deFloor;
  const out = {};

  const { positivos, negativo } = atributosAWfm(itemAttributes, tipoDeArma((weaponData && weaponData.t) || weapon.t));
  const dispoArma = Number((weaponData && weaponData.d) || state.weaponMap?.[wname]?.d);
  const tipoCrudo = state.weaponDetailsDB?.find?.(w => w.name === wname)?.type ?? null;
  const conocida = nombreArma(nt, wname);
  const fila = filaDe10(de10, wname, deRe);
  const registro = fila && !conocida ? registroSinWfm(nt, nivelSinWfm(nt, wname, fila), dispoArma, tipoCrudo) : null;
  const residuos = fila ? residuosTirada(nt, wname, positivos, negativo, registro) : null;
  if (residuos) {
    const poblacion = poblacionTirada(nt, wname, tipoCrudo ?? nt.armas[conocida]?.tipo ?? ((weaponData && weaponData.t) || weapon.t));
    const suelo = usaDE ? floor : 1;
    preciosDe10(fila, percentilTirada(poblacion, residuos[1]), qs, nt.rho).forEach((v, i) => { out[qs[i]] = Math.max(suelo, Math.round(v)); });
  } else {
    for (const a of qs) {
      const f = Math.max(0, Math.min(1, s + (OFF[a] != null ? OFF[a] : 0)));
      out[a] = Math.max(floor, Math.round(levelMap(f)));
    }
  }
  // orden no decreciente por si el redondeo/clamp cruza
  let prev = 0;
  for (const a of qs) { out[a] = Math.max(out[a], prev); prev = out[a]; }

  // CONFIANZA: baja si el roll es de gama baja (score <= p30 del arma) o el arma tiene pocos datos.
  const synlo = _byWeapon(ml.synlo, wname);
  const nsamp = _byWeapon(ml.nsamp, wname) || 0;
  const esTrash = (synlo != null) && (synergy <= synlo);
  const lowConf = esTrash || nsamp < 40;
  const p = (a) => out[a] != null ? out[a] : out[0.5];
  return {
    p25: p(0.25), p50: p(0.5), p80: p(0.8), p90: p(0.9), p95: p(0.95),
    price: p(0.5), floor, drift: +drift.toFixed(3),
    fuente: residuos ? "de10" : "curva",
    confianza: lowConf ? "baja" : "alta",
    aviso: lowConf ? (esTrash ? "trash" : "pocosDatos") : null,
    regla: esBrick ? "BRICK" : (rerolls === 0 ? "0roll" : "q"),
  };
}

// Compat: precio único = p50 de la banda de cuantiles.
export async function predictRivenMLPrice(weapon, itemAttributes, weaponData = null, rerolls = 0) {
  const band = await predictRivenMLBand(weapon, itemAttributes, weaponData, rerolls);
  return band.p50;
}
