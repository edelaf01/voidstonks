import { rankRelicPicks, mejorRefinamiento, progresoDe, closenessWeight, tierOfRelic, REFINOS_POR_COSTE } from "./relic_picks.js";
import { relicSetValue, partDropChance } from "./relic_set_value.js";
import { relicOpenEV, REFINEMENT_KEYS } from "./relic_drop_odds.utils.js";

export const OBJETIVOS = ["sets", "plat", "ducados"];

const dropsDe = (db, relic) => db?.[relic] || db?.[`${relic} Relic`] || [];

export function fuentesDePiezas(relicCounts = {}, relicsDatabase = {}) {
  const fuentes = new Map();
  for (const [relic, n] of Object.entries(relicCounts)) {
    if (!(n > 0)) continue;
    for (const d of dropsDe(relicsDatabase, relic)) {
      if (!fuentes.has(d.name)) fuentes.set(d.name, []);
      fuentes.get(d.name).push({ relic, chance: d.chance, n });
    }
  }
  return fuentes;
}

export function escasez(pieza, relic, chance, fuentes) {
  const otras = (fuentes.get(pieza) || [])
    .filter((f) => f.relic !== relic && f.chance >= chance)
    .reduce((s, f) => s + f.n, 0);
  return 1 / (1 + otras);
}

function pesosPorRefino(drops, deps, escasa) {
  return Object.fromEntries(REFINOS_POR_COSTE.map((r) => [
    r, progresoDe(relicSetValue(drops, { ...deps, dropChances: deps.tablas[r] }).missing, (m) => escasa(m.part)),
  ]));
}

function piezaClave(parts, escasa) {
  const peso = (pz) => pz.chance * closenessWeight(pz.missing) * escasa(pz.name);
  return [...parts].sort((a, b) => ((b.missing === 1) - (a.missing === 1)) || (peso(b) - peso(a)))[0] || null;
}

function ganaRefinando(drops, deps, de, a, escasa) {
  const porPieza = (ref) => new Map(relicSetValue(drops, { ...deps, dropChances: deps.tablas[ref] }).missing.map((m) => [m.part, m]));
  const antes = porPieza(de);
  let mejor = null;
  for (const [pieza, m] of porPieza(a)) {
    const gana = (m.chance - (antes.get(pieza)?.chance || 0)) * closenessWeight(m.setMissing) * escasa(pieza);
    if (gana > 0 && (!mejor || gana > mejor.gana)) mejor = { refino: a, pieza, set: m.set, chance: m.chance, gana };
  }
  return mejor && { refino: mejor.refino, pieza: mejor.pieza, set: mejor.set, chance: mejor.chance };
}

const encaja = (p) => (p.refino === p.mejorRefino ? 1 : 0);

function paraSets(deps, refino) {
  const fuentes = fuentesDePiezas(deps.relicCounts, deps.relicsDatabase);
  const ranking = (r) => new Map(rankRelicPicks({ ...deps, dropChances: deps.tablas[r] }, Infinity).map((p) => [p.relic, p]));
  const porRefino = Object.fromEntries((refino ? [refino] : REFINOS_POR_COSTE).map((r) => [r, ranking(r)]));
  return [...Object.values(porRefino)[0].keys()].map((relic) => {
    const drops = dropsDe(deps.relicsDatabase, relic);
    const base = new Map(drops.map((d) => [d.name, d.chance]));
    const escasa = (pieza) => escasez(pieza, relic, base.get(pieza), fuentes);
    const pesos = pesosPorRefino(drops, deps, escasa);
    const mejorRefino = mejorRefinamiento(pesos) || "Intact";
    const r = refino || mejorRefino;
    const p = porRefino[r].get(relic);
    const ganancia = r === mejorRefino ? null : ganaRefinando(drops, deps, r, mejorRefino, escasa);
    return { ...p, refino: r, mejorRefino, ganancia, clave: piezaClave(p.parts, escasa), puntos: p.progress - (Math.max(...Object.values(pesos)) - pesos[r]) };
  }).sort((a, b) => (encaja(b) - encaja(a)) || (b.puntos - a.puntos) || (b.odds - a.odds));
}

export const VESTIGIOS = { Intact: 0, Exceptional: 25, Flawless: 50, Rad: 100 };

export function porVestigio(evs) {
  const por = {};
  for (const r of REFINOS_POR_COSTE) if (VESTIGIOS[r]) por[r] = ((evs[r] || 0) - (evs.Intact || 0)) / VESTIGIOS[r];
  return { valor: Math.max(0, ...Object.values(por)), por };
}

export function refinoQueCompensa(evs, vestigio, corte) {
  const candidatos = REFINOS_POR_COSTE.filter((r) => VESTIGIOS[r] && vestigio.por[r] > 0 && vestigio.por[r] >= corte);
  return candidatos.length ? candidatos.reduce((a, b) => (evs[b] > evs[a] ? b : a)) : "Intact";
}

const mediana = (xs) => {
  const v = xs.filter((x) => x > 0).sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : Infinity;
};

function paraValor(deps, refino, valorDe) {
  const filas = [];
  for (const [relic, owned] of Object.entries(deps.relicCounts || {})) {
    const drops = dropsDe(deps.relicsDatabase, relic);
    if (!(owned > 0) || !drops.length) continue;
    const evs = Object.fromEntries(REFINOS_POR_COSTE.map((r) => [
      r, relicOpenEV(drops, { refinement: REFINEMENT_KEYS[r], squadSize: deps.squadSize, valueOf: valorDe }),
    ]));
    if (!(Math.max(...Object.values(evs)) > 0)) continue;
    filas.push({ relic, owned, drops, evs, vestigio: porVestigio(evs) });
  }
  const corte = mediana(filas.map((f) => f.vestigio.valor));
  const out = [];
  for (const { relic, owned, drops, evs, vestigio } of filas) {
    const mejorRefino = refinoQueCompensa(evs, vestigio, corte);
    const r = refino || mejorRefino;
    if (!(evs[r] > 0)) continue;
    const top = drops.reduce((a, d) => (valorDe(d) > valorDe(a) ? d : a));
    const chanceEn = (ref) => 1 - Math.pow(1 - partDropChance(top.chance, deps.tablas[ref]), Math.max(1, deps.squadSize || 1));
    const ganancia = mejorRefino !== r ? { refino: mejorRefino, pieza: top.name, chance: chanceEn(mejorRefino) } : null;
    out.push({
      relic, tier: tierOfRelic(relic), owned, refino: r, mejorRefino, ganancia, ev: evs[r], porVestigio: vestigio.valor,
      mejor: { name: top.name, valor: valorDe(top), chance: chanceEn(r) },
    });
  }
  return out.sort((a, b) => (encaja(b) - encaja(a)) || (b.ev - a.ev));
}

export function eligeReliquias(deps, { objetivo = "sets", refino = null, era = null } = {}) {
  const lista = objetivo === "plat" ? paraValor(deps, refino, (d) => deps.getPrice?.(d.name) || 0)
    : objetivo === "ducados" ? paraValor(deps, refino, (d) => deps.getDucats?.(d.name) || 0)
      : paraSets(deps, refino);
  return era ? lista.filter((p) => p.tier === era) : lista;
}
