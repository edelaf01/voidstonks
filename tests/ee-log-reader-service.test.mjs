// Lectura de los colores del kubrow desde el EE.log de Warframe.
//
// Los colores del log son la VERDAD (códigos de asset exactos) y sustituyen a lo que ve el
// escáner, así que un fallo aquí no se nota: enseña un set de colores plausible pero de otro
// bicho. El parser está lleno de reglas que salieron de mirar logs reales —el juego no reescribe
// los slots que ya tiene cacheados, y al arrancar vuelca un catálogo entero que mezcla Catbrow—
// y ninguna de ellas se deduce leyendo el código sin esos logs delante.
//
// Se prueba `_extractColors` con logs sintéticos que reproducen cada situación.

import { test } from "node:test";
import assert from "node:assert/strict";

const { EELogReaderService: S } = await import("../deploy/js/services/scanner/ee_log_reader.service.js");

/** Una línea de spot-building tal como la escribe el juego, con su timestamp en segundos. */
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

// Eyes se usa como señal interna ("el jugador está mirando un companion ahora"), pero no es un
// color del pelaje: enseñarlo entre los cuatro colores del set sería un dato de más.
test("el slot Eyes no sale en la lista de colores", () => {
  const colores = S._extractColors(log(
    kubrow(100.000, "EyesA"),
    kubrow(100.010, "MundaneA"),
    kubrow(100.020, "MidB"),
  ));
  assert.deepEqual(colores, ["Ash Grey", "Derelict Black"]);
});

// El caso que obligó a acumular en vez de quedarse con el último bloque: al volver a ver el
// kubrow el juego solo reconstruye los slots que no tenía cacheados, a veces uno solo. Sin
// acumular, el usuario veía un único color donde hay cuatro.
test("los slots que llegan en visitas distintas se acumulan", () => {
  const colores = S._extractColors(log(
    kubrow(100.000, "MundaneA"),
    kubrow(100.010, "MidB"),
    // ...minutos después, el jugador vuelve al Arsenal y solo se reconstruye un slot
    kubrow(400.000, "VibrantA"),
  ));
  assert.deepEqual(colores, ["Ash Grey", "Derelict Black", "Anyo Grey"]);
});

// Refrescar un slot ya conocido lo SUSTITUYE (mismo kubrow, color cambiado), no lo duplica.
test("un slot refrescado sustituye al anterior del mismo tipo", () => {
  const colores = S._extractColors(log(
    kubrow(100.000, "MundaneA"),
    kubrow(400.000, "MundaneI"),
  ));
  assert.deepEqual(colores, ["Arid Brown"], "queda el último, no los dos");
});

// La señal de "estoy viendo OTRO kubrow": Eyes siempre se recarga al abrir un companion, así
// que reinicia el acumulado. Sin esto se mezclaban los colores de dos bichos vistos en la misma
// sesión y salía un set que no existe.
test("ver otro kubrow reinicia el acumulado en vez de mezclar", () => {
  const colores = S._extractColors(log(
    kubrow(100.000, "MundaneA"),
    kubrow(100.010, "MidB"),
    // el jugador cambia de companion: llega un frame con Eyes
    kubrow(400.000, "EyesA"),
    kubrow(400.010, "VibrantA"),
  ));
  assert.deepEqual(colores, ["Anyo Grey"], "solo lo del kubrow nuevo");
});

// Al arrancar el juego el log vuelca el catálogo entero de colores de mascota. Es un bloque
// largo y seguido que mezcla Catbrow; un set real nunca lo hace.
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

// Tras el catálogo el jugador entra al Arsenal: ese set sí vale, y es el que hay que devolver.
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

// Un color puede repetirse en dos slots: deduplicar borraría uno y el set saldría incompleto.
test("el mismo color en dos slots distintos no se deduplica", () => {
  const colores = S._extractColors(log(
    kubrow(100.000, "MundaneA"),
    kubrow(100.010, "VibrantA"),
  ));
  assert.equal(colores.length, 2);
});

// Un código que no está en la tabla se enseña crudo en vez de adivinar un nombre bonito: es
// preferible un "KubrowPetColorMundaneZZ" raro a un nombre inventado que el usuario copie.
test("un código desconocido se devuelve tal cual, sin inventar nombre", () => {
  const colores = S._extractColors(log(kubrow(100.000, "MundaneZZ")));
  assert.deepEqual(colores, ["KubrowPetColorMundaneZZ"]);
});

test("nunca se devuelven más colores de los que caben en un kubrow", () => {
  const lineas = ["Mundane", "Mid", "Vibrant", "Accent"]
    .map((c, i) => kubrow(100 + i * 0.01, `${c}A`));
  assert.ok(S._extractColors(log(...lineas)).length <= 6);
});

// --- La capa de arriba: nada de esto puede tumbar el escáner --------------------------------

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

// El log puede estar en uso por el juego, la carpeta puede haberse movido, el permiso puede
// revocarse: el escáner tiene que seguir funcionando con su visión artificial.
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

// Leer el EE.log entero son varios MB en cada consulta del escáner; solo se lee la cola.
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

// Sin evento de kubrow en la cola devuelve null en vez de un resultado vacío: el escáner
// distingue "no hay dato" de "el kubrow no tiene colores".
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
