// Bounties activas: normalizar lo que mandan tres fuentes distintas (worldstate, tenno.tools y
// el oracle) a una lista con tier, nivel, condición y reputación.
//
// Nada de esto se ve mal si falla: la tarjeta sale igual, solo que con el tier equivocado, la
// reputación de otra facción o el rango de nivel de la versión normal en una Steel Path. El
// usuario elige qué farmear con esos números.

import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

let respuesta = { ws: [], tt: [], oracle: {} };
let ok = true;
const urls = [];
globalThis.fetch = async (url) => {
  const u = String(url);
  urls.push(u);
  if (u.includes("type=time")) {
    return { ok: true, status: 200, json: async () => ({ now: Date.now() }) };
  }
  return { ok, status: ok ? 200 : 502, json: async () => respuesta };
};

const { fetchActiveBounties } = await import("../deploy/js/services/farms/bounties.service.js");
const { ZARIMAN_DATA } = await import("../deploy/js/config.js");

/** Respuesta del worker con una sola facción y los trabajos indicados. */
function conJobs(syndicate, jobs, oracle = {}) {
  respuesta = { ws: [{ syndicate, jobs }], tt: [], oracle };
  ok = true;
}

const job = (o = {}) => ({
  uniqueName: "SomeJobExterminate",
  enemyLevels: [10, 20],
  standingStages: [100, 200],
  ...o,
});

async function misiones() {
  return fetchActiveBounties(true); // siempre force: en Node no hay IndexedDB que cachee
}

// --- Tier -------------------------------------------------------------------------------

// El tier ordena la lista y decide la reputación. Narmer y los liches no son "el tier 6": son
// categorías aparte que el juego nombra, y mostrarlas como número las mezcla con las normales.
test("Narmer y los liches tienen tier propio; el resto va por posición", async () => {
  conJobs("Ostron", [
    job({ uniqueName: "JobA" }),
    job({ uniqueName: "JobB" }),
    job({ uniqueName: "NarmerJobC" }),
    job({ uniqueName: "CodaJobD" }),
  ]);
  const m = await misiones();
  const porNombre = Object.fromEntries(m.map((x) => [x.uName, x.tier]));

  assert.equal(porNombre.JobA, 1, "el primero es tier 1, no tier 0");
  assert.equal(porNombre.JobB, 2);
  assert.equal(porNombre.NarmerJobC, "NARMER");
  assert.equal(porNombre.CodaJobD, "CODA");
});

// --- Tipo de misión ---------------------------------------------------------------------

// El tipo se deduce del nombre interno del trabajo. Es lo que alimenta los filtros del panel y
// las alarmas: si cae al genérico "Bounty", esa misión deja de ser filtrable.
test("el tipo técnico sale del nombre interno del trabajo", async () => {
  const casos = {
    JobMobDefOne: "Mobile Defense",
    JobExterminateTwo: "Exterminate",
    JobCascadeThree: "Void Cascade",
    JobArmageddonFour: "Void Armageddon",
    JobFloodFive: "Void Flood",
    JobCaptureSix: "Capture",
    JobDefenseSeven: "Defense",
  };
  conJobs("Ostron", Object.keys(casos).map((uniqueName) => job({ uniqueName })));
  const m = await misiones();

  for (const [uName, esperado] of Object.entries(casos)) {
    assert.equal(m.find((x) => x.uName === uName).technicalType, esperado, uName);
  }
});

// --- Niveles ----------------------------------------------------------------------------

// Steel Path suma 100 al rango. Enseñar el rango normal en la tarjeta de SP manda al jugador a
// una misión para la que no está preparado.
test("el rango de Steel Path va 100 niveles por encima", async () => {
  conJobs("Ostron", [job({ enemyLevels: [15, 25] })]);
  const [m] = await misiones();
  assert.equal(m.level, "15-25");
  assert.equal(m.levelSP, "115-125");
});

test("los niveles se leen del campo que traiga cada fuente", async () => {
  conJobs("Ostron", [job({ enemyLevels: undefined, minEnemyLevel: 30, maxEnemyLevel: 40 })]);
  assert.equal((await misiones())[0].level, "30-40");

  conJobs("Ostron", [job({ enemyLevels: undefined, minLevel: 5, maxLevel: 15 })]);
  assert.equal((await misiones())[0].level, "5-15");
});

// --- Reputación --------------------------------------------------------------------------

// Cada facción paga distinto y por motivos distintos: es el número con el que se decide qué
// bounty compensa, así que copiar la fórmula de una a otra da consejos falsos.
test("cada facción calcula su reputación con su propia regla", async () => {
  conJobs("Ostron", [job({ standingStages: [100, 200, 300] })]);
  const [ostron] = await misiones();
  assert.equal(ostron.standing, 600, "las facciones normales suman las etapas");
  assert.equal(ostron.standingSP, 900, "y Steel Path paga 1,5x");

  conJobs("Hex", [job({ uniqueName: "JobA" }), job({ uniqueName: "JobB" })]);
  const hex = await misiones();
  const t2 = hex.find((m) => m.tier === 2);
  assert.equal(t2.standing, 2000, "Hex paga 1000 por tier");
  assert.equal(t2.standingSP, 2500, "y 500 fijos más en SP");
});

test("Zariman paga por cantidad de objetos, no por etapas", async () => {
  conJobs("Holdfasts", [job({ uniqueName: "JobA" })]);
  const [m] = await misiones();
  assert.equal(m.standing, ZARIMAN_DATA.counts.normal[1] * ZARIMAN_DATA.value);
  assert.equal(m.standingSP, ZARIMAN_DATA.counts.sp[1] * ZARIMAN_DATA.value);
});

// Los Ángeles del Vacío llevan un extra fijo que no sale del recuento normal.
test("un Void Angel de Zariman suma su extra a las dos vías", async () => {
  conJobs("Holdfasts", [job({ uniqueName: "JobVoidAngelHunt" })]);
  const [m] = await misiones();
  const base = ZARIMAN_DATA.counts.normal[1] * ZARIMAN_DATA.value;
  assert.equal(m.standing, base + 2500);
  assert.equal(m.standingSP, ZARIMAN_DATA.counts.sp[1] * ZARIMAN_DATA.value + 2500);
});

// --- Steel Path y camino dual -------------------------------------------------------------

// Las facciones de camino dual publican las dos versiones a la vez, así que su tarjeta enseña
// ambas columnas; las demás son una u otra y marcarlas mal duplica o esconde la mitad.
// Holdfasts, Cavia y Hex publican las dos versiones a la vez, así que su tarjeta enseña las dos
// columnas y no tiene sentido marcarlas como "esta es la SP".
test("las facciones de camino dual nunca salen marcadas como SP", async () => {
  conJobs("Hex", [job({ isHard: true, enemyLevels: [100, 130] })]);
  const [hex] = await misiones();
  assert.equal(hex.isDual, true);
  assert.equal(hex.isSP, false, "ni con isHard ni con nivel 100: la tarjeta ya enseña las dos vías");
});

// En las de un solo camino sí hay que decidir. El nivel 100 es el corte del juego, y sirve de
// respaldo cuando la fuente no manda isHard — que es lo normal en el worldstate crudo.
test("en las facciones de un solo camino, el nivel alto ya implica Steel Path", async () => {
  conJobs("Ostron", [job({ enemyLevels: [100, 130] })]);
  const [alto] = await misiones();
  assert.equal(alto.isDual, false);
  assert.equal(alto.isSP, true, "de nivel 100 para arriba es SP aunque no lo diga el dato");

  conJobs("Ostron", [job({ enemyLevels: [10, 20] })]);
  assert.equal((await misiones())[0].isSP, false);

  conJobs("Ostron", [job({ enemyLevels: [10, 20], isHard: true })]);
  assert.equal((await misiones())[0].isSP, true, "y si la fuente lo dice, se respeta");
});

// --- Recompensas y orden -----------------------------------------------------------------

test("las recompensas repetidas se listan una sola vez", async () => {
  conJobs("Ostron", [job({ rewardPool: ["Lith A1", "Lith A1", "Meso B2"] })]);
  const [m] = await misiones();
  assert.deepEqual(m.rewards, ["Lith A1", "Meso B2"]);
});

// La lista se pinta tal cual: sin ordenar, la bounty que más paga puede quedar la última.
test("las misiones salen ordenadas por reputación descendente", async () => {
  conJobs("Ostron", [
    job({ uniqueName: "Poca", standingStages: [100] }),
    job({ uniqueName: "Mucha", standingStages: [5000] }),
    job({ uniqueName: "Media", standingStages: [1000] }),
  ]);
  const m = await misiones();
  assert.deepEqual(m.map((x) => x.uName), ["Mucha", "Media", "Poca"]);
});

// --- Fallos -------------------------------------------------------------------------------

// Un panel vacío es recuperable en el siguiente ciclo; una excepción sin capturar corta el
// arranque y se lleva por delante al resto de pestañas.
test("un fallo del worker devuelve lista vacía, no una excepción", async () => {
  ok = false;
  assert.deepEqual(await misiones(), []);
  ok = true;
});

test("una respuesta con forma inesperada tampoco revienta", async () => {
  const errorReal = console.error;
  console.error = () => {};
  try {
    respuesta = null;
    assert.deepEqual(await misiones(), []);
    respuesta = { ws: "no es lista", tt: null, oracle: {} };
    assert.deepEqual(await misiones(), []);
  } finally {
    console.error = errorReal;
  }
});

test("una facción sin trabajos no aporta nada ni rompe a las demás", async () => {
  respuesta = {
    ws: [{ syndicate: "Ostron", jobs: [] }, { syndicate: "Solaris", jobs: [job()] }],
    tt: [],
    oracle: {},
  };
  ok = true;
  const m = await misiones();
  assert.deepEqual(m.map((x) => x.factionKey), ["Solaris United"]);
});

// El refetch de rotación tiene que esquivar también la caché del navegador: sin el parámetro
// anticaché el reintento se responde a sí mismo con las misiones caducadas.
test("forzar el refresco llega hasta la petición", async () => {
  conJobs("Ostron", [job()]);
  urls.length = 0;
  await fetchActiveBounties(true);
  const p = urls.find((u) => u.includes("type=active_bounties"));
  assert.ok(p, "debe pedirse el endpoint de bounties");
  assert.match(p, /_cb=\d+/, "force debe estrenar clave de caché");
});

// --- Tipo de misión ---------------------------------------------------------------------
//
// `techType` es lo que compara checkIsOptimal, así que si sale mal la vista "Solo óptimas"
// queda vacía sin dar ninguna pista: las tarjetas se pintan igual, solo que ninguna lleva
// estrella. Se miraba únicamente el uniqueName, y en Cetus/Fortuna/Deimos ese campo es una
// TABLA DE RECOMPENSAS, no el tipo — las 23 bounties vivas caían todas en "Bounty".

test("el tipo sale del uniqueName cuando lo lleva", async () => {
  conJobs("Ostron", [job({ uniqueName: "ZarimanExterminateFastCompleteChallenge" })]);
  assert.equal((await misiones())[0].technicalType, "Exterminate");
});

// Forma real del worldstate: el uniqueName es la tabla de premios y el tipo solo está en el
// título. Sin mirarlo, una captura de Cetus no se distingue de una excavación.
test("con uniqueName de tabla de premios, el tipo sale del título", async () => {
  conJobs("Ostron", [job({
    uniqueName: "/Lotus/Types/Game/MissionDecks/EidolonJobMissionRewards/TierCTableBRewards",
    type: "Search and Rescue",
    id: "RescueBountyResc1787070250203",
  })]);
  assert.equal((await misiones())[0].technicalType, "Rescue");
});

// El id engaña y el título no: esta bounty se llama AssassinateBountyCap y es una CAPTURA.
// Por eso el título va antes que el id.
test("el título manda sobre el id cuando discrepan", async () => {
  conJobs("Ostron", [job({
    uniqueName: "/Lotus/Types/Game/MissionDecks/EidolonJobMissionRewards/TierATableARewards",
    type: "Capture the New Grineer Commander",
    id: "AssassinateBountyCap1787070250203",
  })]);
  assert.equal((await misiones())[0].technicalType, "Capture");
});

// Y al revés: títulos temáticos que no nombran la misión. Ahí el id es lo único que queda.
test("si el título no dice la misión, se cae al id", async () => {
  conJobs("Ostron", [job({
    uniqueName: "/Lotus/Types/Game/MissionDecks/EidolonJobMissionRewards/TierATableARewards",
    type: "Rise and Fall (Narmer)",
    id: "AssassinateBountyAss1787070250203",
  })]);
  assert.equal((await misiones())[0].technicalType, "Assassination");
});

// Rescate es una misión de una pasada, igual que exterminio y captura: el panel de fisuras ya
// lo contaba así y aquí no estaba. No se distingue camino normal de acero — checkIsOptimal no
// mira isSP, así que una rápida lo es en los dos.
test("rescate, exterminio y captura cuentan como misión rápida", async () => {
  conJobs("Ostrons", [
    job({ uniqueName: "x", type: "Search and Rescue", id: "RescueBountyResc1" }),
    job({ uniqueName: "x", type: "Capture Their Leader", id: "AttritionBountyCap1" }),
    job({ uniqueName: "SomeJobExterminate", type: "Cleanse", id: "z1" }),
    job({ uniqueName: "x", type: "Core Samples", id: "DeimosExcavateBounty1" }),
  ]);
  const porTipo = Object.fromEntries((await misiones()).map((m) => [m.technicalType, m.isOptimal]));
  assert.equal(porTipo.Rescue, true, "rescate tiene que entrar en las rápidas");
  assert.equal(porTipo.Capture, true);
  assert.equal(porTipo.Exterminate, true);
  assert.equal(porTipo.Excavation, false, "una excavación no es de una pasada");
});
