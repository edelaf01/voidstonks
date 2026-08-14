// kubrow colors from the Warframe EE.log; the log colors are the truth and replace what the scanner sees
// the parser rules come from real logs (the game does not rewrite cached slots, and dumps a whole catalog mixing Catbrow at startup)
// `_extractColors` is tested with synthetic logs that reproduce each case

import { test } from "node:test";
import assert from "node:assert/strict";

const { EELogReaderService: S } = await import("../deploy/js/services/scanner/ee_log_reader.service.js");

/** a spot-building line as the game writes it, with its timestamp in seconds */
const linea = (ts, ruta) =>
  `${ts.toFixed(3)} Sys [Info]: SpotBuilding ${ruta}`;

const kubrow = (ts, slot) =>
  linea(ts, `/Lotus/Types/Game/KubrowPet/Colors/KubrowPetColor${slot}`);
const catbrow = (ts, slot) =>
  linea(ts, `/Lotus/Types/Game/CatbrowPet/Colors/CatbrowPetColor${slot}`);

const log = (...lineas) => lineas.join("\n");

test("un log sin colores de mascota no devuelve nada", () => {
  assert.deepEqual(S._extractColors(""), []);
  assert.deepEqual(S._extractColors(null), []);
  assert.deepEqual(S._extractColors("100.0 Sys [Info]: nada que ver aquí"), []);
});

test("un set normal devuelve sus colores traducidos", () => {
  const colores = S._extractColors(log(
    kubrow(100.000, "MundaneA"),
    kubrow(100.010, "MidB"),
    kubrow(100.020, "VibrantA"),
  ));
  assert.deepEqual(colores, ["Ash Grey", "Derelict Black", "Anyo Grey"]);
});

test("el slot Eyes no sale en la lista de colores", () => {
  const colores = S._extractColors(log(
    kubrow(100.000, "EyesA"),
    kubrow(100.010, "MundaneA"),
    kubrow(100.020, "MidB"),
  ));
  assert.deepEqual(colores, ["Ash Grey", "Derelict Black"]);
});

test("los slots que llegan en visitas distintas se acumulan", () => {
  const colores = S._extractColors(log(
    kubrow(100.000, "MundaneA"),
    kubrow(100.010, "MidB"),
    // ...minutes later the player goes back to the Arsenal and only one slot is rebuilt
    kubrow(400.000, "VibrantA"),
  ));
  assert.deepEqual(colores, ["Ash Grey", "Derelict Black", "Anyo Grey"]);
});

test("un slot refrescado sustituye al anterior del mismo tipo", () => {
  const colores = S._extractColors(log(
    kubrow(100.000, "MundaneA"),
    kubrow(400.000, "MundaneI"),
  ));
  assert.deepEqual(colores, ["Arid Brown"], "queda el último, no los dos");
});

test("ver otro kubrow reinicia el acumulado en vez de mezclar", () => {
  const colores = S._extractColors(log(
    kubrow(100.000, "MundaneA"),
    kubrow(100.010, "MidB"),
    // the player switches companion: a frame with Eyes arrives
    kubrow(400.000, "EyesA"),
    kubrow(400.010, "VibrantA"),
  ));
  assert.deepEqual(colores, ["Anyo Grey"], "solo lo del kubrow nuevo");
});

test("el catálogo del arranque no se confunde con un set", () => {
  const catalogo = [];
  for (let i = 0; i < 20; i++) {
    catalogo.push(kubrow(10 + i * 0.01, `Mundane${String.fromCharCode(65 + (i % 9))}`));
  }
  assert.deepEqual(S._extractColors(log(...catalogo)), [], "demasiadas líneas seguidas");
});

test("un bloque que mezcla Catbrow se descarta aunque sea corto", () => {
  const colores = S._extractColors(log(
    kubrow(100.000, "MundaneA"),
    catbrow(100.010, "MidB"),
    kubrow(100.020, "VibrantA"),
  ));
  assert.deepEqual(colores, [], "un kubrow real nunca mezcla Catbrow");
});

test("después del catálogo, el set real sí se lee", () => {
  const catalogo = [];
  for (let i = 0; i < 20; i++) catalogo.push(kubrow(10 + i * 0.01, "MundaneA"));
  const colores = S._extractColors(log(
    ...catalogo,
    kubrow(500.000, "MundaneI"),
    kubrow(500.010, "MidB"),
  ));
  assert.deepEqual(colores, ["Arid Brown", "Derelict Black"]);
});

test("el mismo color en dos slots distintos no se deduplica", () => {
  const colores = S._extractColors(log(
    kubrow(100.000, "MundaneA"),
    kubrow(100.010, "VibrantA"),
  ));
  assert.equal(colores.length, 2);
});

test("un código desconocido se devuelve tal cual, sin inventar nombre", () => {
  const colores = S._extractColors(log(kubrow(100.000, "MundaneZZ")));
  assert.deepEqual(colores, ["KubrowPetColorMundaneZZ"]);
});

test("nunca se devuelven más colores de los que caben en un kubrow", () => {
  const lineas = ["Mundane", "Mid", "Vibrant", "Accent"]
    .map((c, i) => kubrow(100 + i * 0.01, `${c}A`));
  assert.ok(S._extractColors(log(...lineas)).length <= 6);
});

test("sin carpeta conectada no se lee nada ni se rompe", async () => {
  S._dirHandle = null;
  assert.equal(await S.getLatestKubrowColors(), null);
  assert.equal(S.isConnected(), false);
  assert.equal(await S.ensurePermission(false), false);
});

test("sin permiso concedido no se abre el fichero", async () => {
  let abierto = false;
  S._dirHandle = {
    queryPermission: async () => "prompt",
    requestPermission: async () => "denied",
    getFileHandle: async () => { abierto = true; throw new Error("no debería llegar aquí"); },
  };
  assert.equal(await S.getLatestKubrowColors(), null);
  assert.equal(abierto, false, "no puede tocar el disco sin permiso");
  S._dirHandle = null;
});

test("un fallo leyendo el fichero devuelve null, no una excepción", async () => {
  const real = console.warn;
  console.warn = () => {};
  try {
    S._dirHandle = {
      queryPermission: async () => "granted",
      getFileHandle: async () => { throw new Error("EBUSY"); },
    };
    await assert.doesNotReject(() => S.getLatestKubrowColors());
    assert.equal(await S.getLatestKubrowColors(), null);
  } finally {
    console.warn = real;
    S._dirHandle = null;
  }
});

test("solo se lee la cola del log, no el fichero entero", async () => {
  const TAM = 5 * 1024 * 1024;
  let cortes = null;
  S._dirHandle = {
    queryPermission: async () => "granted",
    getFileHandle: async () => ({
      getFile: async () => ({
        size: TAM,
        lastModified: 1234,
        slice: (a, b) => { cortes = [a, b]; return { text: async () => kubrow(100, "MundaneA") }; },
      }),
    }),
  };

  const r = await S.getLatestKubrowColors();
  assert.deepEqual(r.colors, ["Ash Grey"]);
  assert.equal(cortes[1], TAM, "lee hasta el final");
  assert.ok(cortes[1] - cortes[0] < TAM, `leyó ${cortes[1] - cortes[0]} bytes de ${TAM}`);
  S._dirHandle = null;
});

test("una cola sin eventos de kubrow devuelve null, no una lista vacía", async () => {
  S._dirHandle = {
    queryPermission: async () => "granted",
    getFileHandle: async () => ({
      getFile: async () => ({
        size: 100, lastModified: 1,
        slice: () => ({ text: async () => "nada interesante" }),
      }),
    }),
  };
  assert.equal(await S.getLatestKubrowColors(), null);
  S._dirHandle = null;
});
