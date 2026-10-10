import { test } from "node:test";
import assert from "node:assert/strict";
import { wordsToCards } from "../deploy/js/utils/vision/riven_card_words.js";

const palabra = (text, x0 = 0, x1 = 50, y0 = 10, y1 = 30, conf = 90, bbox = true) => {
  const obj = { text };
  if (conf !== undefined) obj.confidence = conf;
  if (bbox) obj.bbox = { x0, y0, x1, y1 };
  return obj;
};

const grupoPalabras = (prefijo, offsetX, conf = 90) => [
  palabra(`${prefijo}Uno`, offsetX, offsetX + 40, 10, 30, conf),
  palabra(`${prefijo}Dos`, offsetX + 45, offsetX + 85, 10, 30, conf),
  palabra(`${prefijo}Tres`, offsetX + 90, offsetX + 130, 10, 30, conf),
];

test("data nulo o indefinido devuelve null sin lanzar errores", (t) => {
  t.mock.method(console, "log", () => {});
  assert.equal(wordsToCards(null, 1000), null);
  assert.equal(wordsToCards(undefined, 1000), null);
  assert.equal(wordsToCards({}, 1000), null);
});

test("las palabras se extraen de data.words si está presente", (t) => {
  t.mock.method(console, "log", () => {});
  const ws = [...grupoPalabras("A", 10), ...grupoPalabras("B", 250)];
  assert.deepEqual(wordsToCards({ words: ws }, 1000), ["AUno ADos ATres", "BUno BDos BTres"]);
});

test("si words está vacío o ausente se extraen de lines, paragraphs y blocks en orden", (t) => {
  t.mock.method(console, "log", () => {});
  const ws = [...grupoPalabras("A", 10), ...grupoPalabras("B", 250)];
  assert.deepEqual(
    wordsToCards({ words: [], lines: [{ words: ws.slice(0, 3) }, { words: ws.slice(3) }] }, 1000),
    ["AUno ADos ATres", "BUno BDos BTres"]
  );
  assert.deepEqual(
    wordsToCards({
      lines: [],
      paragraphs: [
        { lines: [{ words: ws.slice(0, 3) }] },
        { lines: null },
        { lines: [{ words: ws.slice(3) }] },
      ],
    }, 1000),
    ["AUno ADos ATres", "BUno BDos BTres"]
  );
  assert.deepEqual(
    wordsToCards({
      paragraphs: [],
      blocks: [
        { paragraphs: [{ lines: [{ words: ws.slice(0, 3) }] }] },
        { paragraphs: null },
        { paragraphs: [{ lines: [{ words: ws.slice(3) }] }] },
      ],
    }, 1000),
    ["AUno ADos ATres", "BUno BDos BTres"]
  );
});

test("las palabras sin bbox se ignoran", (t) => {
  t.mock.method(console, "log", () => {});
  const ws = [
    { text: "SinCaja", confidence: 90 },
    { text: "CajaNula", confidence: 90, bbox: null },
    ...grupoPalabras("A", 10),
    ...grupoPalabras("B", 250),
  ];
  assert.deepEqual(wordsToCards({ words: ws }, 1000), ["AUno ADos ATres", "BUno BDos BTres"]);
  assert.equal(wordsToCards({ words: [{ text: "Solitaria", confidence: 90 }] }, 1000), null);
});

test("la ausencia de confianza se interpreta como cero", (t) => {
  t.mock.method(console, "log", () => {});
  const ws = [
    ...grupoPalabras("A", 10),
    ...grupoPalabras("B", 250),
    { text: "SinConfianza", bbox: { x0: 20, y0: 10, x1: 60, y1: 30 } },
  ];
  assert.deepEqual(wordsToCards({ words: ws }, 1000), ["AUno ADos ATres", "BUno BDos BTres"]);
  const soloSinConf = [
    { text: "PalabraUno", bbox: { x0: 10, y0: 10, x1: 50, y1: 30 } },
    { text: "PalabraDos", bbox: { x0: 60, y0: 10, x1: 100, y1: 30 } },
    { text: "PalabraTres", bbox: { x0: 110, y0: 10, x1: 150, y1: 30 } },
  ];
  assert.equal(wordsToCards({ words: soloSinConf }, 1000), null);
});

test("los objetos y arrays de entrada no se modifican", (t) => {
  t.mock.method(console, "log", () => {});
  const data = {
    words: [
      ...grupoPalabras("A", 10),
      ...grupoPalabras("B", 250),
    ],
  };
  const copia = JSON.parse(JSON.stringify(data));
  wordsToCards(data, 1000);
  assert.deepEqual(data, copia);
});

test("criterio de palabra con contenido requiere al menos 3 alfanuméricos o algún dígito", (t) => {
  t.mock.method(console, "log", () => {});
  const ws = [
    palabra("ab", 10, 50, 10, 30, 90),
    palabra("a1", 10, 50, 40, 60, 90),
    palabra("+9%", 10, 50, 70, 90, 90),
    palabra("a-b-c", 10, 50, 100, 120, 90),
    palabra("!!!", 10, 50, 130, 150, 90),
    ...grupoPalabras("B", 250),
  ];
  const res = wordsToCards({ words: ws }, 1000);
  assert.ok(res);
  assert.ok(!res[0].includes("ab"));
  assert.ok(!res[0].includes("!!!"));
  assert.ok(res[0].includes("a1"));
  assert.ok(res[0].includes("+9%"));
  assert.ok(res[0].includes("a-b-c"));
});

test("las anclas requieren confianza mayor o igual a 70", (t) => {
  t.mock.method(console, "log", () => {});
  const wsValido = [
    ...grupoPalabras("A", 10, 70),
    ...grupoPalabras("B", 250, 70),
    palabra("Tenue", 20, 60, 10, 30, 28),
  ];
  const resValido = wordsToCards({ words: wsValido }, 1000);
  assert.ok(resValido);
  assert.ok(resValido[0].includes("Tenue"));

  const wsInvalido = [
    ...grupoPalabras("A", 10, 70),
    palabra("BUno", 250, 290, 10, 30, 70),
    palabra("BDos", 295, 335, 10, 30, 70),
    palabra("BTres", 340, 380, 10, 30, 69),
    palabra("Tenue", 20, 60, 10, 30, 28),
  ];
  const resInvalido = wordsToCards({ words: wsInvalido }, 1000);
  assert.ok(resInvalido);
  assert.ok(!resInvalido[0].includes("Tenue"));
});

test("las anclas se ordenan por x0 y se separan en nuevo grupo al superar gapThresh", (t) => {
  t.mock.method(console, "log", () => {});
  const desordenadas = [
    palabra("ATres", 90, 130, 10, 30, 90),
    palabra("AUno", 10, 50, 10, 30, 90),
    palabra("ADos", 55, 85, 10, 30, 90),
    palabra("BTres", 340, 380, 10, 30, 90),
    palabra("BUno", 250, 290, 10, 30, 90),
    palabra("BDos", 295, 335, 10, 30, 90),
  ];
  assert.deepEqual(wordsToCards({ words: desordenadas }, 1000), ["AUno ADos ATres", "BUno BDos BTres"]);
});

test("el umbral gapThresh aplica suelo de 40 según el ancho del lienzo", (t) => {
  t.mock.method(console, "log", () => {});
  const data = {
    words: [
      palabra("AUno", 10, 40, 10, 30, 90),
      palabra("ADos", 45, 75, 10, 30, 90),
      palabra("ATres", 80, 100, 10, 30, 90),
      palabra("BUno", 150, 180, 10, 30, 90),
      palabra("BDos", 185, 215, 10, 30, 90),
      palabra("BTres", 220, 250, 10, 30, 90),
    ],
  };
  const res1000 = wordsToCards(data, 1000);
  assert.ok(Array.isArray(res1000));
  assert.equal(res1000.length, 2);
  const res2000 = wordsToCards(data, 2000);
  assert.equal(res2000, null);
});

test("los grupos con menos de 3 anclas se descartan", (t) => {
  t.mock.method(console, "log", () => {});
  const tresGrupos = [
    ...grupoPalabras("A", 10),
    palabra("MedioUno", 200, 230, 10, 30, 90),
    palabra("MedioDos", 235, 265, 10, 30, 90),
    ...grupoPalabras("C", 350),
  ];
  const resTres = wordsToCards({ words: tresGrupos }, 1000);
  assert.ok(resTres);
  assert.equal(resTres.length, 2);
  assert.equal(resTres[0], "AUno ADos ATres");
  assert.equal(resTres[1], "CUno CDos CTres");

  const dosGruposUnoPequeno = [
    ...grupoPalabras("A", 10),
    palabra("MedioUno", 200, 230, 10, 30, 90),
    palabra("MedioDos", 235, 265, 10, 30, 90),
  ];
  assert.equal(wordsToCards({ words: dosGruposUnoPequeno }, 1000), null);
});

test("en el camino principal cada carta incluye palabras con confianza al menos 28 dentro del margen ampliado en X", (t) => {
  t.mock.method(console, "log", () => {});
  const anclasA = [
    palabra("AnclaUno", 100, 120, 10, 30, 90),
    palabra("AnclaDos", 140, 160, 10, 30, 90),
    palabra("AnclaTres", 180, 200, 10, 30, 90),
  ];
  const ws = [
    ...anclasA,
    ...grupoPalabras("B", 350),
    palabra("ConfVeintisiete", 140, 160, 40, 60, 27),
    palabra("ConfVeintiocho", 140, 160, 70, 90, 28),
    palabra("BordeDentroIzq", 93, 95, 100, 120, 50),
    palabra("BordeFueraIzq", 91, 93, 130, 150, 50),
    palabra("BordeDentroDer", 205, 207, 160, 180, 50),
    palabra("BordeFueraDer", 207, 209, 190, 210, 50),
    palabra("LejosEnY", 140, 160, 900, 920, 28),
  ];
  const res = wordsToCards({ words: ws }, 1000);
  assert.ok(res);
  const cartaA = res[0];
  assert.ok(!cartaA.includes("ConfVeintisiete"));
  assert.ok(cartaA.includes("ConfVeintiocho"));
  assert.ok(cartaA.includes("BordeDentroIzq"));
  assert.ok(!cartaA.includes("BordeFueraIzq"));
  assert.ok(cartaA.includes("BordeDentroDer"));
  assert.ok(!cartaA.includes("BordeFueraDer"));
  assert.ok(cartaA.includes("LejosEnY"));
});

test("el camino de rescate opera con confianza mínima 50 cuando fallan las anclas", (t) => {
  t.mock.method(console, "log", () => {});
  const pocos = [
    palabra("AUno", 10, 50, 10, 30, 55),
    palabra("ADos", 55, 95, 10, 30, 55),
  ];
  assert.equal(wordsToCards({ words: pocos }, 1000), null);

  const conf49 = [
    ...grupoPalabras("A", 10, 49),
    ...grupoPalabras("B", 250, 49),
  ];
  assert.equal(wordsToCards({ words: conf49 }, 1000), null);

  const conf50 = [
    ...grupoPalabras("A", 10, 50),
    ...grupoPalabras("B", 250, 50),
    palabra("BajoRescate", 20, 60, 40, 60, 40),
  ];
  const res50 = wordsToCards({ words: conf50 }, 1000);
  assert.ok(Array.isArray(res50));
  assert.equal(res50.length, 2);
  assert.ok(!res50[0].includes("BajoRescate"));

  const soloUnGrupo = [
    palabra("AUno", 10, 40, 10, 30, 60),
    palabra("ADos", 45, 75, 10, 30, 60),
    palabra("ATres", 80, 110, 10, 30, 60),
    palabra("ACuatro", 115, 145, 10, 30, 60),
  ];
  assert.equal(wordsToCards({ words: soloUnGrupo }, 1000), null);
});

test("un diseño con anclas a 70 usa el trazado espacial y a 69 recurre al rescate", (t) => {
  t.mock.method(console, "log", () => {});
  const plantilla = (conf) => ({
    words: [
      ...grupoPalabras("A", 10, conf),
      ...grupoPalabras("B", 250, conf),
      palabra("StatTenue", 20, 60, 40, 60, 35),
    ],
  });
  const res70 = wordsToCards(plantilla(70), 1000);
  assert.ok(res70);
  assert.ok(res70[0].includes("StatTenue"));

  const res69 = wordsToCards(plantilla(69), 1000);
  assert.ok(res69);
  assert.ok(!res69[0].includes("StatTenue"));
});

test("las líneas se agrupan por centro Y según la tolerancia medH y las palabras se ordenan por X", (t) => {
  t.mock.method(console, "log", () => {});
  const desordenadas = [
    palabra("Damage", 55, 100, 60, 80, 90),
    palabra("Chance", 100, 140, 11, 31, 90),
    palabra("+50.0%", 10, 50, 60, 80, 90),
    palabra("+92.4%", 10, 50, 10, 30, 90),
    palabra("Status", 55, 95, 12, 32, 90),
    ...grupoPalabras("B", 250),
  ];
  const res = wordsToCards({ words: desordenadas }, 1000);
  assert.ok(res);
  assert.equal(res[0], "+92.4% Status Chance\n+50.0% Damage");

  const alturaCero = [
    palabra("LineaUnoA", 10, 40, 20, 20, 90),
    palabra("LineaUnoB", 50, 80, 25, 25, 90),
    palabra("LineaUnoC", 90, 120, 22, 22, 90),
    ...grupoPalabras("B", 250),
  ];
  const resCero = wordsToCards({ words: alturaCero }, 1000);
  assert.ok(resCero);
  assert.equal(resCero[0], "LineaUnoA LineaUnoB LineaUnoC");
});

test("la bandera _rivenWordDump emite la traza formateada en console.log", (t) => {
  const lineasLog = [];
  t.mock.method(console, "log", (...args) => {
    lineasLog.push(args.join(" "));
  });
  globalThis._rivenWordDump = true;
  try {
    const ws = [
      palabra("Dread", 10, 50, 20, 40, 95),
      palabra("Acricron", 60, 110, 20, 40, 90),
      palabra("+100%", 10, 50, 50, 70, 85),
      ...grupoPalabras("B", 250),
    ];
    wordsToCards({ words: ws }, 1000);
    const dumpLine = lineasLog.find((l) => l.startsWith("[RIVEN WORDS]"));
    assert.ok(dumpLine);
    assert.ok(dumpLine.includes("Dread@95(30,30)"));
    assert.ok(dumpLine.includes("Acricron@90(85,30)"));
  } finally {
    delete globalThis._rivenWordDump;
  }
});
