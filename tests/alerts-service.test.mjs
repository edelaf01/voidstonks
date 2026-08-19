import { test } from "node:test";
import assert from "node:assert/strict";

let almacen = {};
globalThis.localStorage = {
  getItem: (k) => (k in almacen ? almacen[k] : null),
  setItem: (k, v) => { almacen[k] = String(v); },
  removeItem: (k) => { delete almacen[k]; },
};

const A = await import("../deploy/js/services/farms/alerts.service.js");

const enUnaHora = () => new Date(Date.now() + 3600_000).toISOString();

function limpio() {
  almacen = {};
  A.saveAlarmPrefs({ enabled: true, sound: false, rules: [] });
}

test("los tiers con nombre valen más que cualquier número", () => {
  assert.equal(A.tierValue(3), 3);
  assert.equal(A.tierValue("4"), 4);
  assert.equal(A.tierValue("NARMER"), A.SPECIAL_TIER_VALUE);
  assert.equal(A.tierValue("CODA"), A.SPECIAL_TIER_VALUE);
  assert.ok(A.tierValue("NARMER") > A.tierValue("5"), "deben quedar por encima del tier 5");
});

test("una preferencia corrupta no deja al usuario sin alarmas ni revienta", () => {
  almacen.vs_farm_alarms_v1 = "{no es json";
  const p = A.getAlarmPrefs();
  assert.deepEqual(p.rules, []);
  assert.equal(p.enabled, false);
  assert.equal(p.sound, true, "el sonido va activado salvo que se apague expresamente");

  almacen.vs_farm_alarms_v1 = JSON.stringify({ enabled: true, rules: "no es lista" });
  assert.deepEqual(A.getAlarmPrefs().rules, []);
});

test("una regla idéntica no se añade dos veces", () => {
  limpio();
  const r = { kind: "fissure", tier: "Axi", type: "Capture", planet: "any", source: "any", sp: "any" };
  assert.ok(A.addAlarmRule(r), "la primera entra");
  assert.equal(A.addAlarmRule(r), null, "la segunda no");
  assert.equal(A.getAlarmPrefs().rules.length, 1);

  assert.ok(A.addAlarmRule({ ...r, planet: "Venus" }));
  assert.equal(A.getAlarmPrefs().rules.length, 2);
});

test("el porcentaje de valencia se acota al rango que el juego puede dar", () => {
  limpio();
  const bajo = A.addAlarmRule({ kind: "weapon", weapon: "Coda Hema", minPercent: 5 });
  assert.equal(bajo.minPercent, A.VALENCE_MIN, "por debajo del mínimo no tiene sentido");

  const alto = A.addAlarmRule({ kind: "weapon", weapon: "Coda Pox", minPercent: 999 });
  assert.equal(alto.minPercent, A.VALENCE_MAX, "una alarma imposible no sonaría nunca");

  const vacio = A.addAlarmRule({ kind: "weapon", weapon: "Coda Mire" });
  assert.equal(vacio.minPercent, A.VALENCE_MIN);
});

test("el planeta se saca del paréntesis del nodo", () => {
  assert.equal(A.planetOfNode("Kiliken (Venus)"), "Venus");
  assert.equal(A.planetOfNode("Sambir Cloud (Veil)"), "Veil");
  assert.equal(A.planetOfNode("Nodo sin planeta"), "");
  assert.equal(A.planetOfNode(""), "");
  assert.equal(A.planetOfNode(null), "");
});

test("una alarma de fisura filtra por tier, tipo, planeta y origen a la vez", () => {
  limpio();
  A.addAlarmRule({ kind: "fissure", tier: "Axi", type: "Capture", planet: "Void" });
  const base = { node: "Hepit (Void)", type: "Capture", tier: "Axi", expiry: enUnaHora() };

  assert.equal(A.evaluateAlarms("fissure", [base]).length, 1);
  assert.equal(A.evaluateAlarms("fissure", [{ ...base, tier: "Neo" }]).length, 0, "otro tier");
  assert.equal(A.evaluateAlarms("fissure", [{ ...base, type: "Survival" }]).length, 0, "otro tipo");
  assert.equal(A.evaluateAlarms("fissure", [{ ...base, node: "Marte (Mars)" }]).length, 0, "otro planeta");
});

test("una fisura Vanguard dispara una alarma de Axi", () => {
  limpio();
  A.addAlarmRule({ kind: "fissure", tier: "Axi" });
  const hits = A.evaluateAlarms("fissure", [
    { node: "Hepit (Void)", type: "Capture", tier: "Vanguard", expiry: enUnaHora() },
  ]);
  assert.equal(hits.length, 1);
});

test("el origen separa Railjack de las misiones normales", () => {
  limpio();
  A.addAlarmRule({ kind: "fissure", source: "railjack" });
  const normal = { node: "Hepit (Void)", type: "Capture", tier: "Lith", expiry: enUnaHora() };
  const tormenta = { ...normal, node: "Ur (Veil)", isStorm: true };

  assert.equal(A.evaluateAlarms("fissure", [normal]).length, 0);
  assert.equal(A.evaluateAlarms("fissure", [tormenta]).length, 1);
});

test("el filtro de Steel Path va en los dos sentidos", () => {
  limpio();
  A.addAlarmRule({ kind: "fissure", sp: "sp" });
  const normal = { node: "Hepit (Void)", type: "Capture", tier: "Lith", expiry: enUnaHora() };

  assert.equal(A.evaluateAlarms("fissure", [normal]).length, 0);
  assert.equal(A.evaluateAlarms("fissure", [{ ...normal, isSP: true }]).length, 1);
});

test("un arma sin bonus todavía no dispara, pero no queda descartada", () => {
  limpio();
  A.addAlarmRule({ kind: "weapon", weapon: "Coda Hema", minPercent: 30 });
  const sinBonus = { name: "Coda Hema", vendorKey: "eleanor", expiry: enUnaHora() };

  assert.equal(A.evaluateAlarms("weapon", [sinBonus]).length, 0);
  const conBonus = { ...sinBonus, bonus: { element: "Heat", percent: 40 } };
  assert.equal(A.evaluateAlarms("weapon", [conBonus]).length, 1);
});

test("el elemento se compara sin depender de mayúsculas y el porcentaje es un mínimo", () => {
  limpio();
  A.addAlarmRule({ kind: "weapon", element: "heat", minPercent: 40 });
  const arma = (percent, element = "Heat") => ({
    name: "Coda Hema", vendorKey: "eleanor", bonus: { element, percent }, expiry: enUnaHora(),
  });

  assert.equal(A.evaluateAlarms("weapon", [arma(40)]).length, 1, "justo en el mínimo cuenta");
  limpio();
  A.addAlarmRule({ kind: "weapon", element: "heat", minPercent: 40 });
  assert.equal(A.evaluateAlarms("weapon", [arma(39.9)]).length, 0);
  limpio();
  A.addAlarmRule({ kind: "weapon", element: "heat", minPercent: 40 });
  assert.equal(A.evaluateAlarms("weapon", [arma(50, "Toxin")]).length, 0, "otro elemento");
});

test("Dark Sector Defense cuenta como Defense", () => {
  limpio();
  A.addAlarmRule({ kind: "arbitration", type: "Defense" });
  const hits = A.evaluateAlarms("arbitration", [
    { node: "Cinxia (Ceres)", type: "Dark Sector Defense", tier: "A", expiry: enUnaHora() },
  ]);
  assert.equal(hits.length, 1);
});

test("el tier de arbitración es un mínimo, y sin tier conocido no se dispara", () => {
  limpio();
  A.addAlarmRule({ kind: "arbitration", minTier: "B" });
  const arby = (tier) => ({ node: "Xini (Eris)", type: "Defense", tier, expiry: enUnaHora() });

  assert.equal(A.evaluateAlarms("arbitration", [arby("S")]).length, 1, "S supera a B");
  limpio(); A.addAlarmRule({ kind: "arbitration", minTier: "B" });
  assert.equal(A.evaluateAlarms("arbitration", [arby("C")]).length, 0, "C no llega a B");
  limpio(); A.addAlarmRule({ kind: "arbitration", minTier: "B" });
  assert.equal(A.evaluateAlarms("arbitration", [arby(null)]).length, 0, "sin tier no se garantiza");
});

test("una misma misión solo avisa una vez por rotación", () => {
  limpio();
  A.addAlarmRule({ kind: "fissure", tier: "Lith" });
  const f = { node: "Hepit (Void)", type: "Capture", tier: "Lith", expiry: enUnaHora() };

  assert.equal(A.evaluateAlarms("fissure", [f]).length, 1);
  assert.equal(A.evaluateAlarms("fissure", [f]).length, 0, "la segunda pasada ya no");
  const siguiente = { ...f, expiry: new Date(Date.now() + 7200_000).toISOString() };
  assert.equal(A.evaluateAlarms("fissure", [siguiente]).length, 1);
});

test("dos armas distintas de la misma tienda avisan las dos", () => {
  limpio();
  A.addAlarmRule({ kind: "weapon", vendor: "eleanor" });
  const arma = (name) => ({
    name, vendorKey: "eleanor", bonus: { element: "Heat", percent: 40 }, expiry: enUnaHora(),
  });

  const hits = A.evaluateAlarms("weapon", [arma("Coda Hema"), arma("Coda Pox")]);
  assert.equal(hits.length, 2, `solo avisó de ${hits.map((h) => h.item.name).join()}`);
});

test("una misión ya caducada no dispara aunque encaje", () => {
  limpio();
  A.addAlarmRule({ kind: "fissure", tier: "Lith" });
  const caducada = {
    node: "Hepit (Void)", type: "Capture", tier: "Lith",
    expiry: new Date(Date.now() - 60_000).toISOString(),
  };
  assert.equal(A.evaluateAlarms("fissure", [caducada]).length, 0);
});

test("con las alarmas apagadas no se evalúa nada", () => {
  limpio();
  A.addAlarmRule({ kind: "fissure", tier: "Lith" });
  const prefs = A.getAlarmPrefs();
  A.saveAlarmPrefs({ ...prefs, enabled: false });

  const f = { node: "Hepit (Void)", type: "Capture", tier: "Lith", expiry: enUnaHora() };
  assert.deepEqual(A.evaluateAlarms("fissure", [f]), []);
});

test("las reglas de un tipo no se evalúan contra misiones de otro", () => {
  limpio();
  A.addAlarmRule({ kind: "fissure", tier: "Lith" });
  assert.deepEqual(A.evaluateAlarms("bounty", [
    { node: "Hepit (Void)", type: "Capture", tier: "Lith", expiry: enUnaHora() },
  ]), []);
});

test("borrar una regla la quita de verdad de las preferencias guardadas", () => {
  limpio();
  const r = A.addAlarmRule({ kind: "fissure", tier: "Lith" });
  A.removeAlarmRule(r.id);
  assert.deepEqual(A.getAlarmPrefs().rules, []);
});

test("una regla antigua con un solo desafío se sigue entendiendo", () => {
  assert.deepEqual(A.ruleChallenges({ challenge: "Matar" }), ["Matar"]);
  assert.deepEqual(A.ruleChallenges({ challenge: "any" }), [], "'any' era el comodín");
  assert.deepEqual(A.ruleChallenges({ challenges: ["B", "A"] }), ["A", "B"], "ordenadas");
  assert.deepEqual(A.ruleChallenges({}), []);
});
