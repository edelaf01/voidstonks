import { relicSetValue } from "./relic_set_value.js";
import { bestFissure, missionMinutes, tiersOpenedBy } from "./relic_route.js";

export function closenessWeight(setMissing) {
  const quedan = Math.max(1, setMissing || 1);
  return 1 / (quedan * quedan);
}

export function expectedPlatPerCrack(missing, getPrice, squadSize = 4) {
  const n = Math.max(1, squadSize);
  const piezas = missing
    .map((m) => ({ precio: getPrice(m.part) || 0, single: m.single ?? 1 - Math.pow(1 - m.chance, 1 / n) }))
    .filter((x) => x.precio > 0)
    .sort((a, b) => b.precio - a.precio);
  if (piezas.length === 0) return null;
  let esperado = 0, acumulada = 0, pAnterior = 0;
  for (const { precio, single } of piezas) {
    acumulada += single;
    const pAlMenos = 1 - Math.pow(Math.max(0, 1 - acumulada), n);
    esperado += precio * (pAlMenos - pAnterior);
    pAnterior = pAlMenos;
  }
  return Math.round(esperado * 10) / 10;
}

// worldstate calls Axi "Vanguard"
export function tierOfRelic(relicName) {
  const tier = String(relicName || "").trim().split(/\s+/)[0] || "";
  return tier === "Vanguard" ? "Axi" : tier;
}

export function rankRelicPicks(deps, limit = 8) {
  const {
    relicCounts = {}, relicsDatabase = {}, fissures = [], getPrice = null,
    setsDatabase, primeInventory, getSetName, getRequiredCount, dropChances, squadSize = 4,
  } = deps;

  const porEra = new Map();
  for (const f of fissures) {
    for (const t of tiersOpenedBy(f)) {
      if (!porEra.has(t)) porEra.set(t, []);
      porEra.get(t).push(f);
    }
  }

  const picks = [];
  for (const [relic, owned] of Object.entries(relicCounts)) {
    if (!(owned > 0)) continue;
    const drops = relicsDatabase[relic] || relicsDatabase[`${relic} Relic`];
    if (!Array.isArray(drops) || drops.length === 0) continue;

    const v = relicSetValue(drops, {
      setsDatabase, primeInventory, getSetName, getRequiredCount,
      dropChances, squadSize, stock: owned,
    });
    if (v.missing.length === 0) continue;

    const tier = tierOfRelic(relic);
    const suyas = porEra.get(tier) || [];
    const fisura = bestFissure(suyas);

    const valor = getPrice ? expectedPlatPerCrack(v.missing, getPrice, squadSize) : null;

    const cierran = v.missing.filter((m) => m.setMissing === 1);
    const setsCerrados = [...new Set(cierran.map((m) => m.set))];

    picks.push({
      minutes: (Number.isFinite(v.runs) && fisura)
        ? Math.round(v.runs * missionMinutes(fisura.type))
        : null,
      closes: setsCerrados,
      closeOdds: 1 - cierran.reduce((p, m) => p * (1 - m.chance), 1),
      progress: v.missing.reduce((s, m) => s + m.chance * closenessWeight(m.setMissing), 0),
      fissure: fisura,
      value: valor,
      relic,
      tier,
      owned,
      useful: v.missing.length,
      odds: Number.isFinite(v.runs) ? 1 / v.runs : 0,
      runs: v.runs,
      sets: [...new Set(v.missing.map((m) => m.set))],
      parts: v.missing.map((m) => ({
        name: m.part, set: m.set, missing: m.setMissing, total: m.setTotal,
      })),
      ready: suyas.length > 0,
    });
  }

  picks.sort((a, b) =>
    ((b.ready) - (a.ready))
    || (b.progress - a.progress)
    || (b.odds - a.odds)
    || (a.runs - b.runs));
  return picks.slice(0, limit);
}

export const PICK_SORTS = {
  best: (a, b) => (b.progress - a.progress) || (b.odds - a.odds) || (a.runs - b.runs),
  useful: (a, b) => (b.useful - a.useful) || (b.odds - a.odds) || (a.runs - b.runs),
  odds: (a, b) => (b.odds - a.odds) || (b.useful - a.useful),
  value: (a, b) => ((b.value ?? -1) - (a.value ?? -1)) || (b.useful - a.useful),
  minutes: (a, b) => ((a.minutes ?? Infinity) - (b.minutes ?? Infinity)) || (b.useful - a.useful),
};

export function filterRelicPicks(picks, prefs = {}) {
  const { query = "", era = "", readyOnly = false, sortBy = "best" } = prefs;
  const q = String(query).trim().toLowerCase();

  const out = picks.filter((p) => {
    if (era && p.tier !== era) return false;
    if (readyOnly && !p.ready) return false;
    if (!q) return true;
    return p.relic.toLowerCase().includes(q)
      || (p.sets || []).some((s) => String(s).toLowerCase().includes(q))
      || (p.parts || []).some((x) => String(x?.name || x).toLowerCase().includes(q));
  });
  out.sort((a, b) => (b.ready - a.ready) || (PICK_SORTS[sortBy] || PICK_SORTS.best)(a, b));
  return out;
}
