// La guía de atributos debe graduar los stats con los pesos del ML de ESE arma, no con una lista
// global. Antes las listas curadas `pos`/`midPos` llegaban vacías en 556 de 620 armas, así que el
// 90% del catálogo veía la misma recomendación genérica aunque el ML publique pesos para 608.
//
// Lo que se protege aquí es sobre todo la COHERENCIA: el panel y la tasación tienen que ordenar los
// stats igual. Si el panel dijera que Critical Chance es BEST y el precio lo tratara como relleno,
// el usuario no puede confiar en ninguno de los dos.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { optionalSource } from "./_helpers/optional-source.mjs";

globalThis.localStorage = { getItem: () => null, setItem: () => {} };
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ML_ROOT = path.resolve(__dirname, "../deploy/assets/ml");
globalThis.fetch = async (url) => {
  const f = path.join(ML_ROOT, path.basename(String(url).split("?")[0]));
  if (!fs.existsSync(f)) throw new Error(`File not found: ${f}`);
  return { ok: true, json: async () => JSON.parse(fs.readFileSync(f, "utf8")) };
};

const { state } = await import("../deploy/js/state.js");
const { gradeWeaponStats, areWeightsDegenerate, STAT_TIER_TOP, STAT_TIER_MID } =
  await import("../deploy/js/utils/rivens/riven_logic.js");
state.currentLang = "es";

// El cache está en .gitignore: en un clon no existe y estos tests salen en skip.
const { src: apiCacheSrc, missing: sinCache, test } = optionalSource(
  pathToFileURL(path.resolve(__dirname, "../scripts-actu/ML-rivenvaluation/cache_datos_api.json")),
);
const apiMap = sinCache ? {} : JSON.parse(apiCacheSrc).api_map;

const conPesos = Object.entries(apiMap)
  .filter(([, w]) => w.dynamic_weights && Object.keys(w.dynamic_weights).length >= 12);

test("la mayoría del catálogo se gradúa con pesos propios, no genéricos", () => {
  let propios = 0;
  for (const [nm, w] of conPesos) {
    const g = gradeWeaponStats({ name: nm, ...w }, null);
    if (g && g.fuente === "arma") propios++;
  }
  // Medido: 606 de 620. Con >=500 se detecta si alguien vuelve a colgar el panel de las listas
  // curadas (que solo cubren 64 armas).
  assert.ok(propios >= 500,
    `solo ${propios} armas se gradúan con sus propios pesos; el resto caería en genérico`);
});

test("los tiers respetan los cortes y van ordenados de mejor a peor", () => {
  const fallos = [];
  for (const [nm, w] of conPesos.slice(0, 120)) {
    const g = gradeWeaponStats({ name: nm, ...w }, null);
    if (!g || g.fuente !== "arma") continue;
    for (const s of g.best) if (g.pesos[s] < STAT_TIER_TOP) fallos.push(`${nm}: BEST ${s}=${g.pesos[s]}`);
    for (const s of g.mid) {
      if (g.pesos[s] >= STAT_TIER_TOP || g.pesos[s] < STAT_TIER_MID) fallos.push(`${nm}: MID ${s}=${g.pesos[s]}`);
    }
    for (const s of g.meh) if (g.pesos[s] >= STAT_TIER_MID) fallos.push(`${nm}: MEH ${s}=${g.pesos[s]}`);
  }
  assert.deepEqual(fallos.slice(0, 5), [], `stats en el tier equivocado: ${fallos.slice(0, 5).join(" | ")}`);
});

test("un stat BEST del arma nunca pesa menos que uno MID de la misma arma", () => {
  const fallos = [];
  for (const [nm, w] of conPesos.slice(0, 150)) {
    const g = gradeWeaponStats({ name: nm, ...w }, null);
    if (!g || !g.best.length || !g.mid.length) continue;
    const peorBest = Math.min(...g.best.map(s => g.pesos[s]));
    const mejorMid = Math.max(...g.mid.map(s => g.pesos[s]));
    if (peorBest <= mejorMid) fallos.push(`${nm}: best min ${peorBest} <= mid max ${mejorMid}`);
  }
  assert.deepEqual(fallos, [], `jerarquía rota: ${fallos.slice(0, 4).join(" | ")}`);
});

// Los pesos saturados se construyen a mano y NO se buscan en cache_datos_api.json: ese fichero lo
// regenera el entrenamiento desde la API, así que la anomalía aparece y desaparece según el día. Un
// test que dependa de encontrarla se rompe solo (pasó el 2026-08-07). Lo que se prueba es la REGLA.
const SATURADA = {
  name: "SaturadaSintetica",
  liquidity_score: 40,
  // 30 stats con 8 empatados a 1.0 —Zoom y Recoil entre ellos—, como traía Seer.
  dynamic_weights: Object.fromEntries([
    ...["Critical Damage", "Critical Chance", "Multishot", "Status Duration",
      "Fire Rate / Attack Speed", "Electric Damage", "Zoom", "Recoil"].map(s => [s, 1]),
    ...["Cold Damage", "Toxin Damage", "Heat Damage", "Ammo Maximum", "Magazine Capacity",
      "Reload Speed", "Punch Through", "Status Chance", "Impact Damage", "Puncture Damage",
      "Slash Damage", "Projectile Speed", "Damage Vs Grineer", "Damage Vs Corpus",
      "Damage Vs Infested", "Base Damage / Melee Damage", "Range", "Initial Combo",
      "Combo Duration", "Heavy Attack Efficiency", "Finisher Damage", "Heavy Attack Damage",
    ].map((s, i) => [s, 0.4 - i * 0.01]),
  ]),
};

test("los pesos saturados se detectan como no fiables", () => {
  assert.equal(areWeightsDegenerate(SATURADA.dynamic_weights), true,
    "8 de 30 pesos a 1.0 debe considerarse saturado");
});

test("un arma con pesos saturados NO se gradúa con ellos", () => {
  const g = gradeWeaponStats(SATURADA, null);
  // Sin prior no hay con qué graduar: devolver null es correcto, lo inaceptable es usar los saturados.
  if (g) {
    assert.notEqual(g.fuente, "arma", "se graduó con pesos que no discriminan");
  }
});

test("con pesos saturados se usa el prior global si está disponible", () => {
  const prior = {
    "Critical Damage": 1.0, "Multishot": 0.9, "Critical Chance": 0.89, "Range": 0.89,
    "Base Damage / Melee Damage": 0.7, "Zoom": 0.02, "Recoil": 0.01,
  };
  const g = gradeWeaponStats(SATURADA, prior);
  assert.ok(g, "con prior debería poder graduar");
  assert.equal(g.fuente, "prior");
  assert.ok(g.best.includes("Critical Damage"), "el prior debe ordenar CD arriba");
  assert.ok(!g.best.includes("Zoom"), "Zoom no puede salir como mejor positivo");
});

test("el panel y la tasación comparten los cortes de tier", () => {
  // Si alguien cambia 0.7/0.4 en un sitio y no en el otro, el panel y el precio se contradicen.
  const ui = fs.readFileSync(
    path.resolve(__dirname, "../deploy/js/ui.components/rivens/ui_rivens.js"), "utf8");
  assert.match(ui, /STAT_TIER_TOP/, "ui_rivens debe usar la constante compartida, no 0.7 a pelo");
  assert.match(ui, /STAT_TIER_MID/, "ui_rivens debe usar la constante compartida, no 0.4 a pelo");
  assert.equal(STAT_TIER_TOP, 0.7);
  assert.equal(STAT_TIER_MID, 0.4);
});
