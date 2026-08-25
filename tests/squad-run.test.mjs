import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { squadRunOutlook } from "../deploy/js/utils/inventory/squad_run.js";
import { relicOpenEV } from "../deploy/js/utils/inventory/relic_drop_odds.utils.js";
import { rewardValue } from "../deploy/js/utils/inventory/reward_value.js";

// ===========================================================================
// Valor de un run de fisura leyendo las reliquias de TODA la escuadra.
//
// El invariante que sujeta todo lo demás: con cuatro reliquias iguales y el mismo
// refinamiento, esto tiene que dar exactamente lo que ya daba relicOpenEV con
// squadSize=4. Si diverge, o el máximo está mal calculado o las probabilidades no
// son las mismas — y las dos cifras se enseñan en la misma app.
// ===========================================================================

// Tasas reales: común 25,33 % · poco común 11 % · rara 2 % (intacta).
const drop = (name, chance, ducats = 15) => ({ name, chance, ducats });

const RELIC_A = [
  drop("Forma Blueprint", 25.33, 0),
  drop("Braton Prime Stock", 25.33),
  drop("Braton Prime Receiver", 25.33),
  drop("Ash Prime Systems", 11, 45),
  drop("Ash Prime Chassis", 11, 45),
  drop("Nautilus Prime Carapace", 2, 100),
];
const RELIC_B = [
  drop("Forma Blueprint", 25.33, 0),
  drop("Sybaris Prime Blade", 25.33),
  drop("Sybaris Prime Stock", 25.33),
  drop("Ash Prime Systems", 11, 45),
  drop("Sybaris Prime Barrel", 11, 45),
  drop("Sybaris Prime Blueprint", 2, 100),
];

const PRICES = {
  "Braton Prime Stock": 4, "Braton Prime Receiver": 6,
  "Ash Prime Systems": 14, "Ash Prime Chassis": 9,
  "Nautilus Prime Carapace": 38,
  "Sybaris Prime Blade": 5, "Sybaris Prime Stock": 5,
  "Sybaris Prime Barrel": 7, "Sybaris Prime Blueprint": 21,
  "Ash Prime Set": 60, "Sybaris Prime Set": 45, "Nautilus Prime Set": 90,
};

const SETS = {
  "Ash Prime": ["Ash Prime Systems", "Ash Prime Chassis", "Ash Prime Neuroptics", "Ash Prime Blueprint"],
  "Sybaris Prime": ["Sybaris Prime Blade", "Sybaris Prime Stock", "Sybaris Prime Barrel", "Sybaris Prime Blueprint"],
  "Nautilus Prime": ["Nautilus Prime Carapace", "Nautilus Prime Cerebrum", "Nautilus Prime Blueprint"],
};

function makeDeps(primeInventory = {}) {
  return {
    relicsDatabase: { "Neo A1": RELIC_A, "Neo B1": RELIC_B },
    getPrice: (name) => PRICES[name] || 0,
    setsDatabase: SETS,
    primeInventory,
    getSetName: (part) => Object.keys(SETS).find((s) => SETS[s].includes(part)) || "Otros",
    getRequiredCount: () => 1,
  };
}

const valueOfWith = (deps) => (d) =>
  rewardValue({ name: d.name, price: deps.getPrice(d.name), ducats: d.ducats, qty: 1 }, deps).plat;

describe("equivalencia con relicOpenEV", () => {
  for (const refinement of ["intact", "exceptional", "flawless", "radiant"]) {
    for (const n of [1, 2, 3, 4]) {
      test(`${n} × la misma reliquia (${refinement}) = relicOpenEV squadSize=${n}`, () => {
        const deps = makeDeps();
        const relics = Array.from({ length: n }, () => ({ name: "Neo A1", refinement }));
        const mine = squadRunOutlook(relics, deps).runEV;
        const suyo = relicOpenEV(RELIC_A, { refinement, squadSize: n, valueOf: valueOfWith(deps) });
        assert.ok(Math.abs(mine - suyo) < 1e-9, `${mine} vs ${suyo}`);
      });
    }
  }
});

describe("escuadra mixta", () => {
  const deps = makeDeps();
  const MIXTA = [
    { name: "Neo A1", refinement: "radiant" },
    { name: "Neo B1", refinement: "intact" },
    { name: "Neo A1", refinement: "intact" },
  ];

  test("el run vale más que la mejor reliquia suelta: son tres tiradas y te quedas una", () => {
    const out = squadRunOutlook(MIXTA, deps);
    const mejorSuelta = Math.max(...out.relics.map((r) => r.ev));
    assert.ok(out.runEV > mejorSuelta, `${out.runEV} <= ${mejorSuelta}`);
  });

  test("y menos que la suma: solo cae UNA tarjeta por reliquia", () => {
    const out = squadRunOutlook(MIXTA, deps);
    const suma = out.relics.reduce((s, r) => s + r.ev, 0);
    assert.ok(out.runEV < suma, `${out.runEV} >= ${suma}`);
  });

  test("refinar sube el EV de esa reliquia y el del run", () => {
    const flojo = squadRunOutlook([{ name: "Neo A1", refinement: "intact" }], deps);
    const bueno = squadRunOutlook([{ name: "Neo A1", refinement: "radiant" }], deps);
    // La rara de la reliquia (Nautilus Carapace, 38p) pasa del 2 % al 10 %.
    assert.ok(bueno.runEV > flojo.runEV);
    assert.ok(bueno.relics[0].ev > flojo.relics[0].ev);
  });

  test("una pieza en dos reliquias no se cuenta dos veces", () => {
    const out = squadRunOutlook(MIXTA, deps);
    const ash = out.drops.find((d) => d.name === "Ash Prime Systems");
    // 11 % en la intacta, 20 % en la radiante: 1 - 0.8 × 0.89 × 0.89 = 0.3663
    assert.ok(Math.abs(ash.chance - (1 - 0.80 * 0.89 * 0.89)) < 1e-9, String(ash.chance));
    assert.ok(ash.chance < 1);
  });

  test("las piezas de una sola reliquia llevan su probabilidad tal cual", () => {
    const out = squadRunOutlook([{ name: "Neo B1", refinement: "radiant" }], deps);
    const bp = out.drops.find((d) => d.name === "Sybaris Prime Blueprint");
    assert.ok(Math.abs(bp.chance - 0.10) < 1e-9, String(bp.chance));
  });

  test("la unión de tablas no repite piezas", () => {
    const nombres = squadRunOutlook(MIXTA, deps).drops.map((d) => d.name);
    assert.equal(new Set(nombres).size, nombres.length);
  });

  test("la lista sale ordenada por lo que te llevas", () => {
    const drops = squadRunOutlook(MIXTA, deps).drops;
    for (let i = 1; i < drops.length; i++) assert.ok(drops[i - 1].plat >= drops[i].plat);
    assert.equal(drops[0].name, "Nautilus Prime Carapace");
  });
});

describe("lo que te falta", () => {
  test("marca las piezas que acercan un set y deja fuera las que ya tienes", () => {
    const deps = makeDeps({ "Ash Prime Systems": 1, "Ash Prime Chassis": 1 });
    const out = squadRunOutlook([{ name: "Neo A1", refinement: "radiant" }], deps);
    const byName = Object.fromEntries(out.drops.map((d) => [d.name, d]));
    assert.equal(byName["Ash Prime Systems"].help, null, "ya la tienes: no ayuda");
    assert.equal(byName["Nautilus Prime Carapace"].help.set, "Nautilus Prime");
    assert.equal(byName["Nautilus Prime Carapace"].help.left, 2);
  });

  test("la pieza que CIERRA el set queda con left 0", () => {
    const deps = makeDeps({ "Nautilus Prime Cerebrum": 1, "Nautilus Prime Blueprint": 1 });
    const out = squadRunOutlook([{ name: "Neo A1", refinement: "intact" }], deps);
    const carapace = out.drops.find((d) => d.name === "Nautilus Prime Carapace");
    assert.equal(carapace.help.left, 0);
  });
});

describe("entradas degeneradas", () => {
  const deps = makeDeps();

  test("sin reliquias no hay run", () => {
    assert.deepEqual(squadRunOutlook([], deps), { relics: [], drops: [], runEV: 0 });
    assert.deepEqual(squadRunOutlook(null, deps), { relics: [], drops: [], runEV: 0 });
  });

  test("una reliquia que no está en la base de datos se ignora, no rompe el run", () => {
    const out = squadRunOutlook(
      [{ name: "Neo ZZ9", refinement: "radiant" }, { name: "Neo A1", refinement: "intact" }], deps);
    assert.deepEqual(out.relics.map((r) => r.name), ["Neo A1"]);
    assert.ok(out.runEV > 0);
  });

  test("sin refinamiento leído se asume intacta y se marca como asumido", () => {
    const out = squadRunOutlook([{ name: "Neo A1", refinement: null }], deps);
    assert.equal(out.relics[0].refinement, "intact");
    assert.equal(out.relics[0].assumedRefinement, true);
  });

  test("sin precios el run no vale nada, pero sigue listando lo que puede caer", () => {
    const sinPrecios = { ...deps, getPrice: () => 0 };
    const out = squadRunOutlook([{ name: "Neo A1", refinement: "radiant" }], sinPrecios);
    assert.equal(out.drops.length, 6);
    // Los ducados siguen valiendo: una rara de 100 ducados son 10 platino equivalentes.
    assert.ok(out.runEV > 0);
  });
});
