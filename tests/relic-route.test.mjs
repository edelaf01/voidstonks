import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSetRoute, buildFarmRoutes, normalizeTier, bestFissure, missionMinutes, tiersOpenedBy,
  bestRefinementFor,
} from "../deploy/js/utils/inventory/relic_route.js";

const setsDatabase = {
  "Gara Prime": ["Gara Prime Blueprint", "Gara Prime Neuroptics", "Gara Prime Chassis", "Gara Prime Systems"],
  "Nidus Prime": ["Nidus Prime Blueprint", "Nidus Prime Neuroptics"],
};
const itemsDatabase = {
  "Gara Prime Chassis": [
    { relic: "Meso P13 Relic", tier: "Meso", rarity: "Common", chance: 25 },
    { relic: "Neo N20 Relic", tier: "Neo", rarity: "Rare", chance: 2 },
  ],
  "Gara Prime Systems": [{ relic: "Axi G1 Relic", tier: "Axi", rarity: "Rare", chance: 2 }],
  "Nidus Prime Neuroptics": [{ relic: "Lith N4 Relic", tier: "Lith", rarity: "Common", chance: 25 }],
};
const relicSources = {
  "Neo N20": [{ location: "Ío (Júpiter)", mission: "Defense", rotation: "B", chance: 11 }],
  "Axi G1": [{ location: "Hydron (Sedna)", mission: "Defense", rotation: "C", chance: 10 }],
};
const base = {
  setsDatabase, itemsDatabase, relicSources,
  primeInventory: { "Gara Prime Blueprint": 1, "Gara Prime Neuroptics": 1, "Nidus Prime Blueprint": 1 },
  relicCounts: { "Meso P13": 12 },
  fissures: [{ node: "Ío (Júpiter)", type: "Defense", tier: "Meso", eta: "35m" }],
  getRequiredCount: () => 1,
};

test("ruta: un set completo apunta al SIGUIENTE, no dice 'ya está'", () => {
  const full = Object.fromEntries(setsDatabase["Gara Prime"].map((p) => [p, 1]));
  const r = buildSetRoute("Gara Prime", { ...base, primeInventory: full });
  assert.equal(r.built, 1, "ya tienes uno montado");
  assert.equal(r.missingCount, 4, "para el segundo te faltan las cuatro");
});

// El caso que motivó esto: Acceltra completo y encima piezas sueltas de sobra. Antes salía
// "no tienes ningún set a medias" cuando en realidad estás a una pieza del segundo.
test("rutas: con piezas de MÁS, el set sigue siendo recomendable", () => {
  const sobras = {
    "Gara Prime Blueprint": 3, "Gara Prime Neuroptics": 2,
    "Gara Prime Chassis": 2, "Gara Prime Systems": 1,
  };
  const routes = buildFarmRoutes({ ...base, primeInventory: sobras });
  const gara = routes.find((r) => r.setName === "Gara Prime");
  assert.ok(gara, "un set con excedentes tiene que aparecer");
  assert.equal(gara.built, 1);
  assert.deepEqual(gara.missing.map((m) => m.part), ["Gara Prime Systems"],
    "solo falta la pieza de la que no te sobra ninguna");
});

// Tener el set entero no lo saca de la lista: puedes farmear el siguiente. Lo que decide es
// cuántas piezas te faltan, y con uno montado exacto te faltan todas para el segundo — así que
// sale, pero al fondo. Antes se descartaba, y buscarlo devolvía vacío como si no existiera.
test("rutas: un set completo SIN excedentes sigue en la lista, apuntando al siguiente", () => {
  const justo = Object.fromEntries(setsDatabase["Gara Prime"].map((p) => [p, 1]));
  const routes = buildFarmRoutes({ ...base, primeInventory: justo });
  const gara = routes.find((r) => r.setName === "Gara Prime");
  assert.ok(gara, "un set que ya tienes entero se sigue pudiendo farmear");
  assert.equal(gara.built, 1);
  assert.equal(gara.missingCount, 4, "las 4 piezas del SEGUNDO set");
});

test("ruta: set inexistente no revienta", () => {
  assert.equal(buildSetRoute("No Existe Prime", base), null);
});

test("ruta: lista solo lo que falta", () => {
  const r = buildSetRoute("Gara Prime", base);
  assert.equal(r.totalParts, 4);
  assert.equal(r.missingCount, 2);
  assert.deepEqual(r.missing.map((m) => m.part), ["Gara Prime Chassis", "Gara Prime Systems"]);
});

test("ruta: primero la reliquia que TIENES y con fisura abierta", () => {
  const chassis = buildSetRoute("Gara Prime", base).missing[0];
  assert.equal(chassis.relics[0].relic, "Meso P13", "tienes 12 y hay fisura Meso");
  assert.equal(chassis.relics[0].owned, 12);
  assert.equal(chassis.relics[0].fissures.length, 1);
  assert.equal(chassis.ready, true, "se puede ir a por ella ahora mismo");
});

test("ruta: si no tienes la reliquia, dice dónde farmearla", () => {
  const systems = buildSetRoute("Gara Prime", base).missing[1];
  assert.equal(systems.ready, false, "sin copias no se puede correr ya");
  assert.equal(systems.relics[0].owned, 0);
  assert.deepEqual(systems.relics[0].sources[0].location, "Hydron (Sedna)");
});

test("ruta: teniendo la reliquia no se molesta en decir dónde farmearla", () => {
  const chassis = buildSetRoute("Gara Prime", base).missing[0];
  assert.deepEqual(chassis.relics[0].sources, [], "ya la tienes: la fuente es ruido");
});

test("ruta: sin fisuras activas sigue dando plan, solo que nada está listo", () => {
  const r = buildSetRoute("Gara Prime", { ...base, fissures: [] });
  assert.equal(r.readyCount, 0);
  assert.equal(r.missing[0].relics[0].owned, 12, "las copias se siguen viendo");
});

test("rutas: entran TODOS los sets, tocados o no", () => {
  const routes = buildFarmRoutes(base);
  const names = routes.map((r) => r.setName);
  assert.ok(names.includes("Gara Prime"));
  assert.ok(names.includes("Nidus Prime"));

  // Sin haber tocado nada siguen saliendo: cualquier set se puede farmear. Lo que evita que
  // esto sea "el catálogo del juego" es el orden, no un descarte — ver el test de abajo.
  const sinEmpezar = buildFarmRoutes({ ...base, primeInventory: {} });
  assert.equal(sinEmpezar.length, 2);
  assert.ok(sinEmpezar.every((r) => r.missingCount === r.totalParts));
});

// La red que sustituye al descarte: con el catálogo entero dentro, el set al que te falta UNA
// pieza tiene que seguir arriba y no quedar enterrado bajo sets intactos que pagan más.
test("rutas: lo cerca que estás manda sobre el platino por hora", () => {
  const sets = { Cerca: ["Cerca A", "Cerca B"], Intacto: ["Int A", "Int B", "Int C"] };
  const precios = { "Cerca Set": 25, "Intacto Set": 900 };
  const routes = buildFarmRoutes({
    setsDatabase: sets, itemsDatabase: {},
    primeInventory: { "Cerca A": 1 },   // a Cerca le falta 1; a Intacto, las 3
    relicCounts: {}, relicSources: {}, fissures: [],
    getRequiredCount: () => 1,
    getPrice: (n) => precios[n] || 0,
    expectedRuns: () => 2,
  });
  assert.equal(routes[0].setName, "Cerca", `salió primero ${routes[0].setName}`);
});

// Antes esta regla era "primero al que menos le falta", y a Nidus le falta 1 frente a los 2 de
// Gara. Pero Gara SE PUEDE FARMEAR AHORA (tiene Meso P13 y hay fisura Meso) y Nidus no, así que
// manda eso: una ruta que no se puede tocar no es una recomendación.
test("rutas: primero lo que se puede farmear ahora", () => {
  const routes = buildFarmRoutes(base);
  assert.equal(routes[0].setName, "Gara Prime", "es la accionable, aunque le falte una pieza más");
  assert.equal(routes[0].readyCount > 0, true);
});

test("rutas: a igual accionabilidad, primero al que menos le falta", () => {
  // Sin fisuras no hay nada accionable, así que decide el desempate de siempre.
  const routes = buildFarmRoutes({ ...base, fissures: [] });
  assert.equal(routes[0].setName, "Nidus Prime", "le falta 1; a Gara le faltan 2");
});

test("rutas: aguanta datos a medias sin romperse", () => {
  assert.deepEqual(buildFarmRoutes({}), []);
  const r = buildSetRoute("Gara Prime", { setsDatabase, primeInventory: base.primeInventory });
  assert.equal(r.missingCount, 2);
  assert.deepEqual(r.missing[0].relics, [], "sin itemsDatabase no hay reliquias, pero no explota");
});

test("normalizeTier: el worldstate llama Vanguard a Axi", () => {
  assert.equal(normalizeTier("Vanguard"), "Axi");
  assert.equal(normalizeTier("Meso"), "Meso");
});

// --- Valor y esfuerzo: "más platino, menos esfuerzo" ----------------------------------------
//
// Antes la lista se ordenaba SOLO por cuántas piezas faltan, así que un set de 25 p a una
// pieza salía por delante de uno de 300 p a dos — justo al revés de lo que interesa. Y la
// misión era `fissures[0]`, o sea la primera que devolviera el worldstate: te mandaba a una
// Excavación de 7 min habiendo una Captura de 2 en la misma era.

test("de dos fisuras de la misma era se elige la misión más rápida", () => {
  const lenta = { node: "A", type: "Excavation", tier: "Meso", expiry: 9e12 };
  const rapida = { node: "B", type: "Capture", tier: "Meso", expiry: 9e12 };
  assert.equal(bestFissure([lenta, rapida]).node, "B");
});

// Una que caduca en 3 minutos no da para abrir nada.
test("a igual rapidez gana la que más tiempo le queda", () => {
  const pronto = { node: "A", type: "Capture", tier: "Meso", expiry: 1000 };
  const tarde = { node: "B", type: "Capture", tier: "Meso", expiry: 9e12 };
  assert.equal(bestFissure([pronto, tarde]).node, "B");
});

test('"Dark Sector Defense" dura lo que una Defense', () => {
  assert.equal(missionMinutes("Dark Sector Defense"), missionMinutes("Defense"));
});

test("un tipo de misión desconocido no rompe el cálculo", () => {
  assert.ok(Number.isFinite(missionMinutes("Modo Nuevo De DE")));
  assert.ok(Number.isFinite(missionMinutes(undefined)));
});

// La ganancia NO es el precio del set: las piezas que ya tienes se pueden vender sueltas hoy,
// así que el premio de armarlo es la diferencia.
test("la ganancia descuenta lo que ya valen sueltas las piezas que tienes", () => {
  const precios = { "Gara Prime Set": 100, "Gara Prime Blueprint": 10, "Gara Prime Neuroptics": 15 };
  const r = buildSetRoute("Gara Prime", { ...base, getPrice: (n) => precios[n] || 0 });
  assert.equal(r.setValue, 100);
  assert.equal(r.gain, 75, "100 del set menos 10+15 de las dos que ya tienes");
});

test("sin precios la ruta se construye igual, solo que sin valorar", () => {
  const r = buildSetRoute("Gara Prime", base);
  assert.equal(r.gain, null);
  assert.equal(r.platPerHour, null);
  assert.ok(r.missing.length > 0, "la ruta sigue sirviendo");
});

test("el esfuerzo sale de los runs de cada pieza por lo que dura su misión", () => {
  const r = buildSetRoute("Gara Prime", {
    ...base,
    getPrice: () => 0,
    expectedRuns: () => 2,
  });
  // 2 piezas faltan × 2 runs; una tiene fisura de Meso (Defense, 5 min) y la otra ninguna
  // (por defecto 6), así que 2*5 + 2*6 = 22.
  assert.equal(r.minutes, 22);
});

// El orden es lo que de verdad pidió el usuario.
// El p/h decide entre los que están IGUAL de cerca. Este test fijaba lo contrario —p/h por
// delante de las piezas restantes— y era defendible mientras solo entraban sets empezados: el
// abanico de "lo que te falta" era estrecho. Con el catálogo entero dentro deja de serlo.
test("a igualdad de piezas restantes, manda el platino por hora", () => {
  const sets = { Barato: ["Barato A", "Barato B"], Caro: ["Caro A", "Caro B"] };
  const precios = { "Barato Set": 25, "Caro Set": 300 };
  const routes = buildFarmRoutes({
    setsDatabase: sets,
    itemsDatabase: {},
    primeInventory: { "Barato A": 1, "Caro A": 1 },   // a los dos les falta 1
    relicCounts: {}, relicSources: {}, fissures: [],
    getRequiredCount: () => 1,
    getPrice: (n) => precios[n] || 0,
    expectedRuns: () => 2,
  });
  assert.equal(routes[0].setName, "Caro", `salió primero ${routes[0].setName}`);
});

// Que falte un precio no puede esconder un set que tienes a una pieza.
test("las rutas sin valorar van detrás, no desaparecen", () => {
  const sets = { ConPrecio: ["CP A", "CP B"], SinPrecio: ["SP A", "SP B"] };
  const routes = buildFarmRoutes({
    setsDatabase: sets,
    itemsDatabase: {},
    primeInventory: { "CP A": 1, "SP A": 1 },
    relicCounts: {}, relicSources: {}, fissures: [],
    getRequiredCount: () => 1,
    getPrice: (n) => (n === "ConPrecio Set" ? 200 : 0),
    expectedRuns: () => 2,
  });
  assert.equal(routes.length, 2, "las dos siguen en la lista");
  assert.equal(routes[0].setName, "ConPrecio");
});

// Runs infinitos = pieza sin tabla de rareza. Mejor sin estimación que con una inventada.
test("si no se puede estimar el esfuerzo, no se inventa un platino por hora", () => {
  const r = buildSetRoute("Gara Prime", {
    ...base,
    getPrice: (n) => (n === "Gara Prime Set" ? 100 : 0),
    expectedRuns: () => Infinity,
  });
  assert.equal(r.minutes, null);
  assert.equal(r.platPerHour, null);
  assert.equal(r.gain, 100, "la ganancia sí se sabe");
});

test("cada pieza que falta trae ya elegida su fisura", () => {
  const r = buildSetRoute("Gara Prime", base);
  const chassis = r.missing.find((m) => m.part === "Gara Prime Chassis");
  assert.equal(chassis.fissure?.node, "Ío (Júpiter)");
});

// Este caso existe porque el error ya se cometió: se le pasó `getPriceValue` tal cual, que
// pide (nombre, slug) y devuelve una PROMISE. Con un argumento devolvía Promise.resolve(0),
// `setValue > 0` comparaba una Promise con 0 (NaN > 0 = false) y la ganancia salía null
// SIEMPRE. No rompía nada: la función simplemente no hacía nada, y en pantalla no había
// forma de distinguirlo de "aún no hay precios".
test("un getPrice que devuelva promesas no cuela un valor falso", () => {
  const r = buildSetRoute("Gara Prime", {
    ...base,
    getPrice: () => Promise.resolve(100),
    expectedRuns: () => 2,
  });
  assert.equal(r.gain, null, "una promesa no es un precio: mejor sin valorar que con NaN");
  assert.equal(r.platPerHour, null);
});

test("un precio no numérico tampoco se cuela", () => {
  for (const malo of [() => "100", () => null, () => undefined, () => NaN]) {
    const r = buildSetRoute("Gara Prime", { ...base, getPrice: malo, expectedRuns: () => 2 });
    assert.ok(r.gain === null || Number.isFinite(r.gain), `getPrice ${malo()} dio ${r.gain}`);
  }
});

// --- "Lo que puedo hacer AHORA" manda sobre el valor ------------------------------------------

const dosEras = {
  setsDatabase: { "Hydroid Prime": ["Hydroid Blueprint", "Hydroid Systems"] },
  itemsDatabase: {
    // La MISMA pieza cae de dos reliquias de eras distintas: es el caso que hay que resolver
    // bien, porque "no hay fisura" solo es cierto si NINGUNA de las suyas sirve.
    "Hydroid Systems": [
      { relic: "Neo Z3 Relic", tier: "Neo", rarity: "Rare", chance: 2 },
      { relic: "Meso Z2 Relic", tier: "Meso", rarity: "Common", chance: 25 },
    ],
  },
  relicSources: {},
  primeInventory: { "Hydroid Blueprint": 1 },
  getRequiredCount: () => 1,
};

test("si una de las eras tiene fisura, la pieza cuenta como farmeable ahora", () => {
  const r = buildSetRoute("Hydroid Prime", {
    ...dosEras,
    relicCounts: { "Neo Z3": 27, "Meso Z2": 14 },
    // Solo hay fisura de Meso: la Neo, que es la que más tienes, no sirve.
    fissures: [{ node: "Ío", type: "Capture", tier: "Meso", expiry: 9e12 }],
  });
  assert.equal(r.readyCount, 1);
  assert.equal(r.missing[0].relics[0].relic, "Meso Z2", "tiene que proponer la que SÍ se puede abrir");
});

test("sin fisura de ninguna de sus eras, la pieza no está lista", () => {
  const r = buildSetRoute("Hydroid Prime", {
    ...dosEras,
    relicCounts: { "Neo Z3": 27, "Meso Z2": 14 },
    fissures: [{ node: "Ío", type: "Capture", tier: "Axi", expiry: 9e12 }],
  });
  assert.equal(r.readyCount, 0);
});

// Lo que el usuario pidió: una ruta de 353 p/h que no se puede tocar no es una recomendación.
test("una ruta accionable ahora va por delante de otra que rinde más pero no se puede hacer", () => {
  const comun = {
    itemsDatabase: {
      "Rica A": [{ relic: "Neo R1 Relic", tier: "Neo", rarity: "Rare", chance: 2 }],
      "Pobre A": [{ relic: "Meso P1 Relic", tier: "Meso", rarity: "Common", chance: 25 }],
    },
    relicSources: {},
    relicCounts: { "Neo R1": 5, "Meso P1": 5 },
    // Solo hay fisura de Meso: la ruta cara (Neo) no se puede hacer ahora.
    fissures: [{ node: "Ío", type: "Capture", tier: "Meso", expiry: 9e12 }],
    getRequiredCount: () => 1,
    getPrice: (n) => ({ "Rica Set": 400, "Pobre Set": 40 }[n] || 0),
    expectedRuns: () => 2,
  };
  const routes = buildFarmRoutes({
    ...comun,
    setsDatabase: { Rica: ["Rica A", "Rica B"], Pobre: ["Pobre A", "Pobre B"] },
    primeInventory: { "Rica B": 1, "Pobre B": 1 },
  });

  assert.equal(routes[0].setName, "Pobre", `salió primero ${routes[0].setName}`);
  assert.ok(routes[0].readyCount > 0);
  assert.equal(routes[1].readyCount, 0, "la cara sigue en la lista, solo que detrás");
});

// Entre dos que SÍ se pueden hacer, vuelve a mandar el platino por hora.
test("entre dos accionables gana la que más rinde", () => {
  const routes = buildFarmRoutes({
    setsDatabase: { Rica: ["Rica A", "Rica B"], Pobre: ["Pobre A", "Pobre B"] },
    itemsDatabase: {
      "Rica A": [{ relic: "Meso R1 Relic", tier: "Meso", rarity: "Rare", chance: 2 }],
      "Pobre A": [{ relic: "Meso P1 Relic", tier: "Meso", rarity: "Common", chance: 25 }],
    },
    relicSources: {},
    primeInventory: { "Rica B": 1, "Pobre B": 1 },
    relicCounts: { "Meso R1": 5, "Meso P1": 5 },
    fissures: [{ node: "Ío", type: "Capture", tier: "Meso", expiry: 9e12 }],
    getRequiredCount: () => 1,
    getPrice: (n) => ({ "Rica Set": 400, "Pobre Set": 40 }[n] || 0),
    expectedRuns: () => 2,
  });
  assert.equal(routes[0].setName, "Rica");
});

// El worldstate manda el expiry como ISO, no como número de milisegundos: con Number() salía
// NaN y el desempate por tiempo restante no se aplicaba con datos reales (solo en los tests,
// que usaban números — el motivo por el que no se vio antes).
test("el desempate por tiempo restante entiende el expiry ISO del worldstate", () => {
  const pronto = { node: "A", type: "Capture", tier: "Meso", expiry: "2026-08-15T13:10:30.694Z" };
  const tarde = { node: "B", type: "Capture", tier: "Meso", expiry: "2026-08-15T18:00:00.000Z" };
  assert.equal(bestFissure([pronto, tarde]).node, "B");
});

test("una fisura sin expiry no rompe la elección", () => {
  const sin = { node: "A", type: "Capture", tier: "Meso" };
  const con = { node: "B", type: "Capture", tier: "Meso", expiry: "2026-08-15T18:00:00.000Z" };
  assert.equal(bestFissure([sin, con]).node, "B");
  assert.ok(bestFissure([sin]));
});

// --- Omnia: comodín de las eras clásicas -----------------------------------------------------
//
// Regla del juego, no del código: una fisura Omnia (Lua / Zariman / Deimos) admite cualquier
// reliquia clásica. Agrupando por era estricta, una Omnia no casaba con nada — y con tres Omnia
// vivas el panel decía "esperando fisura" sobre reliquias que se podían abrir en ese momento.

test("una Omnia cuenta como fisura de las cuatro eras clásicas", () => {
  assert.deepEqual(tiersOpenedBy({ tier: "Omnia" }).sort(), ["Axi", "Lith", "Meso", "Neo"]);
});

test("una fisura normal solo abre su propia era", () => {
  assert.deepEqual(tiersOpenedBy({ tier: "Meso" }), ["Meso"]);
  assert.deepEqual(tiersOpenedBy({ tier: "Vanguard" }), ["Axi"], "Vanguard es Axi");
});

// Requiem es otro sistema: una Omnia no abre reliquias Requiem.
test("Omnia no cubre Requiem", () => {
  assert.ok(!tiersOpenedBy({ tier: "Omnia" }).includes("Requiem"));
});

test("con una Omnia viva, una reliquia clásica que tienes SÍ se puede abrir", () => {
  const r = buildSetRoute("Hydroid Prime", {
    ...dosEras,
    relicCounts: { "Neo Z3": 27, "Meso Z2": 14 },
    // Ni Neo ni Meso: solo una Omnia. Antes esto daba readyCount 0.
    fissures: [{ node: "Cambion Drift (Deimos)", type: "Alchemy", tier: "Omnia", expiry: "2026-08-15T18:00:00.000Z" }],
  });
  assert.equal(r.readyCount, 1, "la Omnia abre tanto la Neo como la Meso");
  assert.equal(r.missing[0].relics[0].fissures.length, 1);
});

test("una Omnia no rescata una reliquia Requiem", () => {
  const r = buildSetRoute("Requiem Set", {
    setsDatabase: { "Requiem Set": ["Pieza A", "Pieza B"] },
    itemsDatabase: { "Pieza A": [{ relic: "Requiem I Relic", tier: "Requiem", rarity: "Rare", chance: 2 }] },
    relicSources: {},
    primeInventory: { "Pieza B": 1 },
    relicCounts: { "Requiem I": 5 },
    fissures: [{ node: "Cambion Drift (Deimos)", type: "Alchemy", tier: "Omnia", expiry: "2026-08-15T18:00:00.000Z" }],
    getRequiredCount: () => 1,
  });
  assert.equal(r.readyCount, 0);
});

/* --- Qué reliquia se recomienda -----------------------------------------------
 *
 * Una pieza suele caer de varias reliquias y solo se enseña una. Elegirla por la probabilidad
 * de la tabla de drops estaba mal de dos formas a la vez: esa probabilidad es la INTACTA
 * mientras el panel cronometra en radiante, y el número de copias pesaba por delante de ella.
 */

// Runs con las tasas reales del juego, para no acoplar el test a la tabla de otro módulo.
// Clasifica por PROBABILIDAD, igual que el código: la etiqueta del origen no vale (ver abajo).
const RATES = {
  rare: { intact: 0.02, radiant: 0.10 },
  uncommon: { intact: 0.11, radiant: 0.20 },
  common: { intact: 0.2533, radiant: 0.1667 },
};
const runsCon = (refinamiento) => (drop) => {
  const c = drop.chance;
  const p = RATES[c > 17 ? "common" : c > 5 ? "uncommon" : "rare"][refinamiento];
  return 1 / (1 - (1 - p) ** 4);
};

// Las etiquetas son las que manda warframe-drop-data de verdad: TODO lo que no es raro viene
// como "Uncommon", incluido el 25,33 % que es común. Los tests las usan tal cual para que no
// se pueda "arreglar" el código volviendo a creérselas.
const dosReliquias = {
  setsDatabase: { "X Prime": ["X Prime Blueprint", "X Prime Barrel"] },
  itemsDatabase: {
    "X Prime Barrel": [
      { relic: "Lith C1 Relic", tier: "Lith", rarity: "Uncommon", chance: 25.33 },
      { relic: "Meso U1 Relic", tier: "Meso", rarity: "Uncommon", chance: 11 },
    ],
  },
  primeInventory: { "X Prime Blueprint": 1 },
  relicCounts: { "Lith C1": 1, "Meso U1": 1 },
  relicSources: {},
  fissures: [],
  getRequiredCount: () => 1,
};

const elegida = (route) => route.missing[0].relics[0].relic;

test("con radiante gana la poco común, aunque la común tenga más probabilidad intacta", () => {
  const r = buildSetRoute("X Prime", { ...dosReliquias, relicRuns: runsCon("radiant") });
  assert.equal(elegida(r), "Meso U1", "20 % radiante bate al 16,67 % de la común");
});

test("con intactas gana la común: la recomendación sigue al refinamiento del jugador", () => {
  const r = buildSetRoute("X Prime", { ...dosReliquias, relicRuns: runsCon("intact") });
  assert.equal(elegida(r), "Lith C1");
});

// Cinco copias de una rara son el doble de runs que una copia de una común, y antes salían
// recomendadas por tener más copias.
test("tener más copias ya no manda sobre las runs", () => {
  const deps = {
    ...dosReliquias,
    itemsDatabase: {
      "X Prime Barrel": [
        { relic: "Lith C1 Relic", tier: "Lith", rarity: "Uncommon", chance: 25.33 },
        { relic: "Meso R1 Relic", tier: "Meso", rarity: "Rare", chance: 2 },
      ],
    },
    relicCounts: { "Lith C1": 1, "Meso R1": 5 },
    relicRuns: runsCon("radiant"),
  };
  assert.equal(elegida(buildSetRoute("X Prime", deps)), "Lith C1");
});

// Las copias siguen desempatando cuando las runs son iguales: con la misma probabilidad,
// tener cinco reliquias es tener cinco intentos.
test("a igualdad de runs, gana la que más copias tienes", () => {
  const deps = {
    ...dosReliquias,
    itemsDatabase: {
      "X Prime Barrel": [
        { relic: "Lith C1 Relic", tier: "Lith", rarity: "Uncommon", chance: 25.33 },
        { relic: "Meso C2 Relic", tier: "Meso", rarity: "Uncommon", chance: 25.33 },
      ],
    },
    relicCounts: { "Lith C1": 1, "Meso C2": 5 },
    relicRuns: runsCon("radiant"),
  };
  assert.equal(elegida(buildSetRoute("X Prime", deps)), "Meso C2");
});

// Poder abrirla AHORA sigue por delante de todo: una reliquia mejor de una era sin fisura no
// es una recomendación, es un recordatorio.
test("lo que se puede abrir ya gana a lo que pide menos runs", () => {
  const deps = {
    ...dosReliquias,
    fissures: [{ node: "Ío", type: "Capture", tier: "Lith", eta: "35m" }],
    relicRuns: runsCon("radiant"),
  };
  const r = buildSetRoute("X Prime", deps);
  assert.equal(elegida(r), "Lith C1", "la Meso pide menos runs pero no hay fisura Meso");
  assert.equal(r.readyCount, 1);
});

test("sin relicRuns el orden es el de antes: por probabilidad intacta", () => {
  assert.equal(elegida(buildSetRoute("X Prime", dosReliquias)), "Lith C1");
});

test("cada reliquia lleva sus runs para que la UI las pueda pintar", () => {
  const r = buildSetRoute("X Prime", { ...dosReliquias, relicRuns: runsCon("radiant") });
  const [primera] = r.missing[0].relics;
  assert.ok(Number.isFinite(primera.runs));
  // 1 / (1 - 0.8^4) con la poco común radiante.
  assert.ok(Math.abs(primera.runs - 1 / (1 - 0.8 ** 4)) < 1e-9);
});

// El tiempo estimado tiene que salir de la reliquia que se recomienda. expectedRuns() usa la
// rareza de la reliquia donde MEJOR cae la pieza —la tengas o no—, así que a quien solo tiene
// la mala le prometía un farmeo más corto del que le espera.
test("los minutos salen de la reliquia elegida, no del mejor caso de la pieza", () => {
  const soloLaMala = {
    ...dosReliquias,
    itemsDatabase: {
      "X Prime Barrel": [{ relic: "Meso R1 Relic", tier: "Meso", rarity: "Rare", chance: 2 }],
    },
    relicCounts: { "Meso R1": 1 },
    // Lo que devolvería expectedRuns(): getPartRarity se queda con la rareza de la reliquia
    // donde mejor cae la pieza, así que estima como si tuvieras la común.
    expectedRuns: () => runsCon("radiant")({ chance: 25.33 }),
    relicRuns: runsCon("radiant"),
  };
  const conElegida = buildSetRoute("X Prime", soloLaMala);
  const sinElegida = buildSetRoute("X Prime", { ...soloLaMala, relicRuns: null });
  assert.ok(conElegida.minutes > sinElegida.minutes,
    `la rara debería costar más que las 6 runs del mejor caso (${conElegida.minutes} vs ${sinElegida.minutes})`);
});


// ── Excedente: cuántas copias hace falta farmear ──────────────────────────────
//
// Con 4 de cada pieza de Hydroid menos el plano, apuntar al "siguiente set" manda a por UN
// plano y esconde que con tres más salen cuatro sets. El excedente ya está farmeado; lo que
// falta es convertirlo. El síntoma de romper esto es mudo: la ruta sigue saliendo, solo que
// pidiendo una copia y prometiendo un set.
const HP = ["HP Blueprint", "HP Neuroptics", "HP Chassis", "HP Systems"];
const hydroid = {
  setsDatabase: { "Hydroid Prime": HP },
  itemsDatabase: Object.fromEntries(HP.map((p) => [p, [{ relic: "Lith A1", tier: "Lith", chance: 25 }]])),
  relicSources: {}, relicCounts: {}, fissures: [], getRequiredCount: () => 1,
};

test("excedente: 4 de cada pieza menos una pide 4 copias y monta 4 sets", () => {
  const inv = { "HP Neuroptics": 4, "HP Chassis": 4, "HP Systems": 4 };
  const r = buildSetRoute("Hydroid Prime", { ...hydroid, primeInventory: inv });
  assert.equal(r.missingCount, 1);
  assert.equal(r.missing[0].part, "HP Blueprint");
  assert.equal(r.missing[0].needed, 4, "cuatro planos, no uno");
  assert.equal(r.setsUnlocked, 4);
});

test("excedente: sin hueco entre piezas se apunta al set siguiente, como siempre", () => {
  const inv = { "HP Blueprint": 3, "HP Neuroptics": 4, "HP Chassis": 5, "HP Systems": 6 };
  const r = buildSetRoute("Hydroid Prime", { ...hydroid, primeInventory: inv });
  assert.equal(r.missing[0].needed, 1);
  assert.equal(r.setsUnlocked, 1, "aquí el segundo cuello de botella YA es built + 1");
});

test("excedente: todas al mismo nivel piden una copia de cada", () => {
  const inv = Object.fromEntries(HP.map((p) => [p, 4]));
  const r = buildSetRoute("Hydroid Prime", { ...hydroid, primeInventory: inv });
  assert.equal(r.missingCount, 4);
  assert.ok(r.missing.every((m) => m.needed === 1));
  assert.equal(r.setsUnlocked, 1);
});

// El premio y el esfuerzo tienen que escalar con las copias, o el panel promete cuatro sets al
// precio y al tiempo de uno.
test("excedente: la ganancia y los minutos escalan con lo que falta", () => {
  const inv = { "HP Neuroptics": 4, "HP Chassis": 4, "HP Systems": 4 };
  const deps = { ...hydroid, primeInventory: inv, getPrice: (n) => (n.endsWith(" Set") ? 200 : 20), relicRuns: () => 3 };
  const r = buildSetRoute("Hydroid Prime", deps);
  assert.equal(r.gain, 560, "4 sets a 200 menos las 12 piezas sueltas que ya tenías");

  const uno = buildSetRoute("Hydroid Prime", {
    ...deps, primeInventory: { "HP Neuroptics": 1, "HP Chassis": 1, "HP Systems": 1 },
  });
  assert.ok(r.minutes > uno.minutes, `4 copias deben costar más que 1: ${r.minutes} vs ${uno.minutes}`);
});

// ── Con qué refinamiento sale más barato cerrar la ruta ───────────────────────
//
// No es siempre radiante: refinar sube la tasa de raras y poco comunes pero BAJA la de comunes
// (25,3 % intacta → 16,7 % radiante). A un set al que solo le faltan comunes, gastarle 100
// vestigios lo hace MÁS lento. El síntoma de equivocarse aquí es que el panel recomienda gastar
// vestigios para ir peor, y nada lo delata.
const TASAS = {
  rare: { intact: 0.02, exceptional: 0.04, flawless: 0.06, radiant: 0.10 },
  uncommon: { intact: 0.11, exceptional: 0.13, flawless: 0.17, radiant: 0.20 },
  common: { intact: 0.2533, exceptional: 0.2333, flawless: 0.20, radiant: 0.1667 },
};
// runs = 1/p con escuadra de 1, que basta para comparar refinamientos entre sí.
const runsDe = (rareza) => (drop, ref) => 1 / TASAS[rareza][ref];

test("refinamiento: a un set de piezas COMUNES le sale mejor intacta", () => {
  const missing = [{ needed: 1, relics: [{ relic: "Lith A1" }] }];
  const r = bestRefinementFor(missing, runsDe("common"));
  assert.equal(r.best, "intact", "radiante baja la tasa de comunes: refinar va peor");
  assert.ok(r.runsBy.intact < r.runsBy.radiant);
});

test("refinamiento: a uno de piezas RARAS le sale mejor radiante", () => {
  const missing = [{ needed: 1, relics: [{ relic: "Axi G1" }] }];
  assert.equal(bestRefinementFor(missing, runsDe("rare")).best, "radiant");
});

test("refinamiento: las copias que faltan pesan en el total", () => {
  const una = bestRefinementFor([{ needed: 1, relics: [{}] }], runsDe("rare"));
  const cuatro = bestRefinementFor([{ needed: 4, relics: [{}] }], runsDe("rare"));
  assert.equal(cuatro.runsBy.radiant, una.runsBy.radiant * 4);
});

// Empate = el más barato en vestigios. Al revés, el panel mandaría refinar para nada.
test("refinamiento: a igualdad de runs gana el más barato", () => {
  const plano = () => 5;
  assert.equal(bestRefinementFor([{ needed: 1, relics: [{}] }], plano).best, "intact");
});

test("refinamiento: sin forma de estimar runs devuelve null, no un valor inventado", () => {
  assert.equal(bestRefinementFor([{ needed: 1, relics: [{}] }], null), null);
  assert.equal(bestRefinementFor([{ needed: 1, relics: [{}] }], () => null), null);
  assert.equal(bestRefinementFor([], runsDe("rare")), null);
});

// El filtro de era "no hacía nada": SÍ filtraba —dejaba las rutas que una reliquia de esa era
// avanza, que es lo correcto porque una pieza cae de varias eras— pero la fila seguía enseñando
// la reliquia más rápida, que era de otra era. Con "Neo" puesto salían Axi S16 y Lith B4.
test("la era elegida decide qué reliquia se recomienda", () => {
    const deps = {
        setsDatabase: { "P Prime": ["P Barrel", "P Blueprint"] },
        itemsDatabase: {
            "P Barrel": [
                { relic: "Meso E3", tier: "Meso", chance: 25.33 },
                { relic: "Neo V10", tier: "Neo", chance: 11 },
                { relic: "Axi E1", tier: "Axi", chance: 2 },
            ],
        },
        primeInventory: { "P Blueprint": 1 },
        getRequiredCount: () => 1,
    };
    const relicDe = (d) => buildSetRoute("P Prime", d).missing[0].relics[0].relic;

    assert.equal(relicDe(deps), "Meso E3", "sin era manda la rapidez");
    assert.equal(relicDe({ ...deps, preferTier: "Neo" }), "Neo V10");
    assert.equal(relicDe({ ...deps, preferTier: "Axi" }), "Axi E1");
    // Una era que esta pieza no tiene no puede dejar la fila sin reliquia.
    assert.equal(relicDe({ ...deps, preferTier: "Lith" }), "Meso E3");
});

test("el veredicto de refinamiento se inyecta, no se calcula dentro", () => {
    const deps = {
        setsDatabase: { "P Prime": ["P Barrel", "P Blueprint"] },
        itemsDatabase: { "P Barrel": [{ relic: "Meso E3", tier: "Meso", chance: 25.33 }] },
        primeInventory: { "P Blueprint": 1 },
        getRequiredCount: () => 1,
    };
    assert.equal(buildSetRoute("P Prime", deps).missing[0].refValue, null,
        "sin la dependencia no hay veredicto, y no se rompe");

    const visto = [];
    const conVeredicto = buildSetRoute("P Prime", {
        ...deps,
        refinementValueOf: (relic) => { visto.push(relic); return { best: "radiant", worth: true }; },
    });
    assert.deepEqual(visto, ["Meso E3"], "se pregunta por la reliquia que se recomienda, no por todas");
    assert.equal(conVeredicto.missing[0].refValue.worth, true);
});
