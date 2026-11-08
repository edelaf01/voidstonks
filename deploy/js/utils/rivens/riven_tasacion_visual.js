import { claveStat, esFusionado } from "./riven_cycling.js";
import { STAT_TIER_TOP, STAT_TIER_MID } from "./riven_logic.js";

export function posicionTirada({ valor, min, max, isNeg, fusionado, escala = 1 }) {
  if (!Number.isFinite(valor) || !Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return null;
  }
  const u = Math.min(1, Math.max(0, (valor - min) / (max - min)));
  const bondad = isNeg ? 1 - u : u;
  const cortes = fusionado && !isNeg ? [0.693, 0.874] : [1 / 3, 2 / 3];
  const nivel = bondad < cortes[0] ? "baja" : bondad >= cortes[1] ? "alta" : "media";
  const tolerancia = Math.max(0.06 * escala, 0.01 * max);
  const fuera = valor < min - tolerancia ? "bajo" : valor > max + tolerancia ? "alto" : null;
  return { u, bondad, nivel, fuera, cortes };
}

export function calidadStatEnArma({ nombre, isPositive, typeIdx, niveles, pesos, sinDato, generico }) {
  const clave = (s) => claveStat(String(s).replace(/_/g, " "), typeIdx) || String(s).toLowerCase();
  const objetivo = clave(nombre);
  const esta = (lista) => (lista || []).some((s) => clave(s) === objetivo);
  const entrada = Object.entries(pesos || {}).find(([k]) => clave(k) === objetivo);
  const peso = entrada ? entrada[1] : null;
  const marcadoSinDato = Boolean(
    sinDato?.has(String(nombre).toLowerCase()) || sinDato?.has(String(objetivo).toLowerCase())
  );
  const estimada = !!generico || esFusionado(nombre, typeIdx);
  if (niveles === null || niveles === undefined) {
    return { nivel: "sindato", estimada };
  }
  let nivel;
  if (isPositive) {
    if (esta(niveles.best)) nivel = "top";
    else if (esta(niveles.mid)) nivel = "medio";
    else if (esta(niveles.meh)) nivel = "flojo";
    else if (marcadoSinDato) nivel = "sindato";
    else if (peso !== null && peso < STAT_TIER_MID) nivel = "flojo";
    else nivel = "sindato";
  } else {
    if (esta(niveles.bestNeg)) nivel = "inofensiva";
    else if (esta(niveles.worstNeg)) nivel = "ruinosa";
    else if (esta(niveles.midNeg)) nivel = "media";
    else if (marcadoSinDato) nivel = "sindato";
    else if (peso !== null && peso >= STAT_TIER_TOP) nivel = "ruinosa";
    else if (peso !== null && peso >= STAT_TIER_MID) nivel = "media";
    else if (peso !== null) nivel = "inofensiva";
    else nivel = "sindato";
  }
  return { nivel, estimada };
}

export function posicionEnBanda({ low, fair, high }) {
  if (!Number.isFinite(low) || !Number.isFinite(fair) || !Number.isFinite(high)) return null;
  if (low <= 0 || fair <= 0 || high <= 0 || low >= high) return null;
  return Math.min(1, Math.max(0, Math.log(fair / low) / Math.log(high / low)));
}

export function nivelConfianza({ mape, confianza }) {
  if (!Number.isFinite(mape)) return confianza === "baja" ? "baja" : null;
  if (mape < 35) return "alta";
  if (mape < 70) return "media";
  return "baja";
}

export function tierDeScore(score) {
  if (score >= 98) return { tier: "SSS", tierColor: "grade-s" };
  if (score >= 90) return { tier: "S+", tierColor: "grade-s" };
  if (score >= 80) return { tier: "S", tierColor: "grade-s" };
  if (score >= 60) return { tier: "A", tierColor: "grade-a" };
  if (score >= 40) return { tier: "B", tierColor: "grade-b" };
  if (score > 0) return { tier: "C", tierColor: "grade-c" };
  return { tier: "F", tierColor: "grade-f" };
}

export function calculationBase(meta) {
  if (!meta) return null;
  const mediana = meta.de_unrolled?.median > 0
    ? meta.de_unrolled.median
    : (meta.official_median > 0 ? meta.official_median : null);
  if (!mediana) return null;
  const volumen = (meta.de_unrolled?.pop || 0) + (meta.de_rerolled?.pop || 0);
  const pocoComerciada = (meta.popularity_pct || 0) < 8 || volumen < 3;
  const amortiguada = pocoComerciada && mediana > 150 ? 150 + (mediana - 150) * 0.15 : mediana;
  return Math.round(amortiguada);
}

export function precioBaseDeArma(meta) {
  const crudo = meta?.official_median > 0
    ? meta.official_median
    : (meta?.official_avg_price || calculationBase(meta));
  const precioTipico = crudo > 0 ? Number(crudo) : null;
  const basePrice = Math.max(50, crudo > 0 ? crudo : 50);
  return { basePrice, precioTipico };
}

export function demandaDeArma(meta) {
  const v = Number(meta?.popularity_pct);
  return v > 0 ? Math.min(100, Math.round(v)) : null;
}

export function precioJusto({ heuristico, ml, mape, confianza, puntuacion, tipico }) {
  let pesoMl = Number.isFinite(mape)
    ? (mape < 30 ? 0.75 : mape < 60 ? 0.60 : mape < 100 ? 0.42 : 0.28)
    : 0.35;
  if (confianza === "baja") pesoMl = Math.min(pesoMl, 0.30);
  let justo = (heuristico > 0 && ml > 0)
    ? Math.round(Math.exp(pesoMl * Math.log(ml) + (1 - pesoMl) * Math.log(heuristico)))
    : Math.round(ml || heuristico);
  const base = tipico || ml || justo;
  if (base > 0 && puntuacion < 85) {
    const tope = puntuacion >= 70 ? 2.2 : puntuacion >= 55 ? 1.6 : puntuacion >= 40 ? 1.3 : 1.15;
    justo = Math.min(justo, Math.round(base * tope));
  }
  return { justo, pesoMl };
}
