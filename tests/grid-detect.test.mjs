import { test } from "node:test";
import assert from "node:assert/strict";
import {
  rowProfile,
  findBands,
  blocksInBand,
  estimatePitch,
  bestArithmeticChain,
  detectInventoryGrid,
} from "../deploy/js/utils/vision/grid_detect.js";
import { makeInventoryFrame, setPixel } from "./_helpers/inventory-frame.mjs";

// ===========================================================================
// Fixture generator: pinta un frame ImageData-like ({ data, width, height })
// simulando la rejilla de inventario de Warframe (3 filas x N columnas de
// cards). Réplica del smoke-test verificado manualmente:
//   1920x1080, fondo rgb(30,25,35), gx=400 gy=140 cellW=250 cellH=290 cols=6,
//   nombre = rectángulo top=gridY+fila*cellH+0.62*cellH, alto=0.12*cellH,
//   ancho=0.6*cellW centrado, patrón de columnas 3px on / 2px off,
//   color rgb(240,235,220)  ->  detectInventoryGrid da {x:400,y:146,cellW:250,
//   cellH:290,cols:6} (el smoke-test original citaba x:399; el redondeo real
//   del módulo da 400 con este generador, dentro de cualquier tolerancia razonable).
// ===========================================================================

// ===========================================================================
// estimatePitch
// ===========================================================================

test("estimatePitch: múltiplos con huecos ([240,480,241] -> ~240)", () => {
  const r = estimatePitch([240, 480, 241]);
  assert.ok(r, "debe encontrar un pitch");
  assert.ok(Math.abs(r.pitch - 240) < 3, `pitch ${r.pitch} debería ser ~240`);
  assert.equal(r.support, 3, "los 3 diffs (incl. el múltiplo 480=2x) deben soportar el pitch");
});

test("estimatePitch: lista vacía -> null", () => {
  assert.equal(estimatePitch([]), null);
});

test("estimatePitch: solo negativos/ceros -> null", () => {
  assert.equal(estimatePitch([0, -5, -10]), null);
});

test("estimatePitch: jitter moderado sigue convergiendo al pitch real", () => {
  const r = estimatePitch([238, 242, 239, 481]);
  assert.ok(r, "debe encontrar un pitch pese al jitter");
  assert.ok(Math.abs(r.pitch - 240) < 5, `pitch ${r.pitch} debería ser ~240 con jitter moderado`);
  assert.ok(r.support >= 3, `support ${r.support} debería cubrir la mayoría de los diffs`);
});

// ===========================================================================
// bestArithmeticChain
// ===========================================================================

test("bestArithmeticChain: 3 posiciones equiespaciadas + 2 bandas HUD sueltas -> cadena = las 3 reales", () => {
  // HUD (título masivo y fila suelta) a alturas que NO forman paso con las filas
  // reales dentro de [minPitch, maxPitch]: 60 y 150 frente a filas 500/800/1100.
  const items = [
    { pos: 60, mass: 900, centers: [400] },                 // título: masivo pero fuera de cadena
    { pos: 150, mass: 300, centers: [100, 700] },
    { pos: 500, mass: 500, centers: [200, 450, 700] },
    { pos: 800, mass: 500, centers: [200, 450, 700] },
    { pos: 1100, mass: 500, centers: [200, 450, 700] },
  ];
  const r = bestArithmeticChain(items, 250, 350);
  assert.ok(r, "debe encontrar cadena");
  assert.deepEqual(r.members, [500, 800, 1100]);
  assert.ok(Math.abs(r.pitch - 300) < 3, `pitch ${r.pitch} debería ser ~300`);
  assert.equal(r.len, 3);
});

test("bestArithmeticChain: banda HUD enganchada con paso ~8% distinto se poda del extremo", () => {
  // Caso real: fila de iconos/buscador a y=245 se engancha a la cadena de filas
  // (590, 965, 1340, pitch 375) con paso 345 (~8% menos). La poda de extremos
  // (desviación >6% de la mediana de pasos) debe eliminarla.
  const items = [245, 590, 965, 1340].map(pos => ({ pos, mass: 500, centers: [200, 500, 800] }));
  const r = bestArithmeticChain(items, 170, 715);
  assert.ok(r, "debe encontrar cadena");
  assert.deepEqual(r.members, [590, 965, 1340], "la banda HUD (245) debe quedar podada");
  assert.ok(Math.abs(r.pitch - 375) < 3, `pitch ${r.pitch} debería ser ~375`);
});

test("bestArithmeticChain: entre cadenas de >=3 filas gana la de más MASA (nombres pesan ~10x más que badges)", () => {
  // Scoring de la 3ª iteración: los badges de cantidad forman una cadena
  // PARALELA al mismo pitch que la de nombres (una banda por fila, desfasada
  // ~0.6*cellH), así que longitud y alineación no discriminan; la masa sí
  // (los nombres concentran ~10x más píxeles brillantes que los badges).
  // Prioridad: len>=3 primero, luego MASA, luego alineación, luego longitud.
  const items = [
    // cadena "badges": alineada pero ligera
    { pos: 100, mass: 100, centers: [50, 200, 350] },
    { pos: 250, mass: 100, centers: [50, 200, 350] },
    { pos: 400, mass: 100, centers: [50, 200, 350] },
    // cadena "nombres": desalineada (centros derivan 30px > 15% del pitch) pero masiva
    { pos: 1000, mass: 900, centers: [50, 200, 350] },
    { pos: 1150, mass: 900, centers: [90, 240, 390] },
    { pos: 1300, mass: 900, centers: [130, 280, 430] },
  ];
  const r = bestArithmeticChain(items, 100, 200);
  assert.ok(r, "debe encontrar cadena");
  assert.deepEqual(r.members, [1000, 1150, 1300], "debe ganar la cadena masiva (nombres), no la alineada ligera (badges)");
});

test("bestArithmeticChain: a MASA igual, desempata la alineación de columnas", () => {
  const items = [
    // cadena alineada (centros idénticos banda a banda)
    { pos: 100, mass: 500, centers: [50, 200, 350] },
    { pos: 250, mass: 500, centers: [50, 200, 350] },
    { pos: 400, mass: 500, centers: [50, 200, 350] },
    // cadena de igual masa total pero desalineada
    { pos: 1000, mass: 500, centers: [50, 200, 350] },
    { pos: 1150, mass: 500, centers: [90, 240, 390] },
    { pos: 1300, mass: 500, centers: [130, 280, 430] },
  ];
  const r = bestArithmeticChain(items, 100, 200);
  assert.ok(r, "debe encontrar cadena");
  assert.deepEqual(r.members, [100, 250, 400], "a masa igual debe ganar la cadena con columnas alineadas");
  assert.ok(r.alignment > 0);
});

test("bestArithmeticChain: <2 items -> null", () => {
  assert.equal(bestArithmeticChain([], 100, 200), null);
  assert.equal(bestArithmeticChain([{ pos: 5, mass: 1 }], 100, 200), null);
});

// ===========================================================================
// findBands
// ===========================================================================

test("findBands: filtra una banda débil tipo badge (masa < 22% de la máxima)", () => {
  const height = 100;
  const prof = new Float32Array(height);
  // 3 bandas "nombre" fuertes, altura 7px (>= minBandH=6), masa 700 cada una.
  // Separadas 23px: bien por encima de mergeGapY=12 para que no se fusionen.
  for (let y = 10; y <= 16; y++) prof[y] = 100;
  for (let y = 40; y <= 46; y++) prof[y] = 100;
  for (let y = 70; y <= 76; y++) prof[y] = 100;
  // Banda débil tipo badge: altura 7px pero valor bajo -> masa 105 (< 22% de 700 = 154).
  for (let y = 90; y <= 96; y++) prof[y] = 15;

  const bands = findBands(prof, height);
  assert.equal(bands.length, 3, "solo las 3 bandas fuertes deben sobrevivir al filtro de masa");
  for (const b of bands) assert.equal(b.mass, 700);
  assert.deepEqual(bands.map(b => b.y0), [10, 40, 70]);
});

test("findBands: imagen sin señal (perfil plano) -> sin bandas", () => {
  const height = 50;
  const prof = new Float32Array(height); // todo cero
  assert.deepEqual(findBands(prof, height), []);
});

// ===========================================================================
// blocksInBand
// ===========================================================================

test("blocksInBand: 3 bloques de texto rayado separados por gaps grandes", () => {
  // blocksInBand cuenta BORDES por |Δluma| por columna (independiente del tema),
  // no píxeles sobre un umbral absoluto. El "texto" debe pintarse rayado
  // (3on/2off, como los trazos de letras); un bloque sólido solo produce 2
  // bordes (sus extremos). Cada trazo aporta 2 bordes (subida y bajada), así
  // que el bloque se extiende hasta el borde de BAJADA del último trazo.
  const width = 300, height = 6;
  const data = new Uint8ClampedArray(width * height * 4);
  const stripe = (x0, x1) => {
    for (let y = 0; y < height; y++) {
      for (let x = x0; x <= x1; x++) {
        if ((x - x0) % 5 < 3) {
          const i = (y * width + x) * 4;
          data[i] = 220; data[i + 1] = 220; data[i + 2] = 220; data[i + 3] = 255;
        }
      }
    }
  };
  // bandH = 6 -> gap de separación de bloques = max(6, round(6*1.2)) = 7px.
  // Las columnas con borde son subidas/bajadas de trazo (cada ~3px): los gaps
  // intra-bloque quedan por debajo del umbral de 7px y no parten el bloque.
  stripe(10, 39);   // trazos que arrancan en 10,15,...,35 (último trazo: 35..37)
  stripe(100, 129); // gap con el anterior: 100-38 = 62 > 7 -> bloque aparte
  stripe(200, 229);

  const blocks = blocksInBand({ data, width, height }, 0, height - 1);
  assert.equal(blocks.length, 3);
  // x1 = borde de BAJADA del último trazo (38/128/228), no su inicio.
  assert.deepEqual(blocks.map(b => [b.x0, b.x1]), [[10, 38], [100, 128], [200, 228]]);
  const centers = blocks.map(b => b.cx);
  assert.ok(Math.abs(centers[0] - 24) <= 3);
  assert.ok(Math.abs(centers[1] - 114) <= 3);
  assert.ok(Math.abs(centers[2] - 214) <= 3);
  // Texto rayado = muchos bordes: masa alta (6 filas x 6 trazos x 2 bordes = 72)
  for (const b of blocks) assert.equal(b.mass, 72);
});

test("blocksInBand: un bloque SÓLIDO ancho (reflejo de arte) se filtra frente al texto rayado", () => {
  // Un reflejo metálico del arte es un rectángulo sólido brillante: con el
  // conteo por bordes (|Δluma|) solo produce 2 columnas aisladas (sus extremos,
  // muy separadas entre sí), ninguna supera el filtro de anchura mínima (>=4px)
  // -> desaparece. El texto rayado, en cambio, es un racimo denso de bordes.
  const width = 400, height = 6;
  const data = new Uint8ClampedArray(width * height * 4);
  const paint = (x, y) => {
    const i = (y * width + x) * 4;
    data[i] = 220; data[i + 1] = 220; data[i + 2] = 220; data[i + 3] = 255;
  };
  for (let y = 0; y < height; y++) {
    // Texto rayado 3on/2off en 10..59
    for (let x = 10; x <= 59; x++) if ((x - 10) % 5 < 3) paint(x, y);
    // Bloque SÓLIDO del mismo tamaño en 150..199
    for (let x = 150; x <= 199; x++) paint(x, y);
  }
  const blocks = blocksInBand({ data, width, height }, 0, height - 1);
  assert.equal(blocks.length, 1, "el bloque sólido debe quedar filtrado (bordes aislados <4px)");
  assert.equal(blocks[0].x0, 10, "el bloque superviviente es el de texto rayado");
  assert.ok(blocks[0].mass >= 36, "el texto rayado rinde masa alta (dos bordes por trazo y fila)");
});

// ===========================================================================
// detectInventoryGrid: casos positivos con distintas resoluciones
// ===========================================================================

function assertDetected(res, { gridX, gridY, cellW, cellH, cols }, { wTol = 0.10, hTol = 0.10, cellHTol = 0.10 } = {}) {
  assert.ok(res, "detectInventoryGrid no debería devolver null");
  assert.equal(res.cols, cols, `cols exacto esperado ${cols}, obtenido ${res.cols}`);
  assert.ok(
    Math.abs(res.cellW - cellW) <= cellW * wTol,
    `cellW ${res.cellW} fuera de tolerancia (esperado ~${cellW})`,
  );
  assert.ok(
    Math.abs(res.cellH - cellH) <= cellH * cellHTol,
    `cellH ${res.cellH} fuera de tolerancia (esperado ~${cellH})`,
  );
  assert.ok(
    Math.abs(res.gridZone.x - gridX) <= 0.3 * cellW,
    `gridZone.x ${res.gridZone.x} fuera de tolerancia (esperado ~${gridX})`,
  );
  assert.ok(
    Math.abs(res.gridZone.y - gridY) <= 0.3 * cellH,
    `gridZone.y ${res.gridZone.y} fuera de tolerancia (esperado ~${gridY})`,
  );
}

test("detectInventoryGrid: 1920x1080, 6 columnas, todas llenas", () => {
  const truth = { gridX: 400, gridY: 140, cellW: 250, cellH: 290, cols: 6 };
  const img = makeInventoryFrame({ width: 1920, height: 1080, ...truth });
  const res = detectInventoryGrid(img);
  assertDetected(res, truth);
});

test("detectInventoryGrid: 2560x1440, 8 columnas, todas llenas", () => {
  const truth = { gridX: 300, gridY: 120, cellW: 280, cellH: 340, cols: 8 };
  const img = makeInventoryFrame({ width: 2560, height: 1440, ...truth });
  const res = detectInventoryGrid(img);
  assertDetected(res, truth);
});

test("detectInventoryGrid: 1366x768, 6 columnas, todas llenas", () => {
  const truth = { gridX: 200, gridY: 100, cellW: 180, cellH: 210, cols: 6 };
  const img = makeInventoryFrame({ width: 1366, height: 768, ...truth });
  const res = detectInventoryGrid(img);
  assertDetected(res, truth);
});

test("detectInventoryGrid: rejilla con huecos (60% llena, diffs de centro de 2*cellW) sigue dando cols y pitches correctos", () => {
  const truth = { gridX: 400, gridY: 140, cellW: 250, cellH: 290, cols: 6 };
  // 18 celdas (3x6), 11 llenas (~61%) con huecos que fuerzan diffs de centros = 2*cellW
  // en algunas filas (p.ej. fila 0: cols 0,1,3,4 -> hueco en col 2).
  const filled = [0, 1, 3, 4, 7, 8, 10, 11, 14, 15, 16];
  const img = makeInventoryFrame({ width: 1920, height: 1080, ...truth, filled });
  const res = detectInventoryGrid(img);
  assertDetected(res, truth);
});

test("detectInventoryGrid: nombres a 2 líneas mezclados con 1 línea siguen detectando (cellH ±15%)", () => {
  const truth = { gridX: 400, gridY: 140, cellW: 250, cellH: 290, cols: 6 };
  const img = makeInventoryFrame({
    width: 1920, height: 1080, ...truth,
    twoLineNames: [0, 2, 4, 7, 9, 11],
  });
  const res = detectInventoryGrid(img);
  assertDetected(res, truth, { cellHTol: 0.15 });
});

test("detectInventoryGrid: badges de cantidad no rompen la detección (cellH no cae a la mitad)", () => {
  const truth = { gridX: 400, gridY: 140, cellW: 250, cellH: 290, cols: 6 };
  const img = makeInventoryFrame({ width: 1920, height: 1080, ...truth, badges: true });
  const res = detectInventoryGrid(img);
  assertDetected(res, truth);
  assert.ok(res.cellH > truth.cellH * 0.6, `cellH ${res.cellH} no debería colapsar a ~mitad por los badges`);
});

test("detectInventoryGrid: ruido de fondo + gradiente sigue detectando", () => {
  // Nota: el detector por BORDES (|Δluma|) tolera el ruido gracias a la
  // estructura aguas abajo (masa de banda, autocorrelación), no por inmunidad
  // per-píxel como el antiguo umbral absoluto. noise=0.3 (±24 de luma) es un
  // estrés realista para una captura; la batería de PNG reales (inventory-captures)
  // cubre el ruido/anti-aliasing de verdad.
  const truth = { gridX: 400, gridY: 140, cellW: 250, cellH: 290, cols: 6 };
  const img = makeInventoryFrame({
    width: 1920, height: 1080, ...truth,
    noise: 0.3, bgGradient: true,
  });
  const res = detectInventoryGrid(img);
  assertDetected(res, truth);
});

// ===========================================================================
// Invariancia al TEMA: el bug que motivó pasar de umbral absoluto de brillo a
// densidad de bordes por |Δluma|. Con un tema de FONDO claro (magenta, cian…)
// el fondo entero superaba el umbral 185 y el texto dejaba de producir
// transiciones -> la autodetección caía a la calibración manual (rejilla
// desalineada, "UNMATCHED CELL"). |Δluma| es invariante al color/brillo del
// fondo Y del texto, así que estas combinaciones deben detectar igual.
// ===========================================================================

const themeCombos = [
  ["fondo MAGENTA claro / texto blanco", [210, 40, 190], [255, 255, 255]],
  ["fondo CIAN claro / texto dorado (Grineer)", [90, 200, 235], [255, 224, 153]],
  ["fondo MAGENTA claro / texto teal OSCURO (Tenno)", [210, 40, 190], [6, 106, 74]],
  ["fondo crema claro / texto oscuro", [220, 210, 180], [40, 30, 50]],
];

for (const [name, bgColor, textColor] of themeCombos) {
  test(`detectInventoryGrid: invariante al tema — ${name}`, () => {
    const truth = { gridX: 400, gridY: 140, cellW: 250, cellH: 290, cols: 6 };
    const img = makeInventoryFrame({
      width: 1920, height: 1080, ...truth, bgColor, textColor,
    });
    const res = detectInventoryGrid(img);
    assertDetected(res, truth);
  });
}

test("detectInventoryGrid: última fila cortada por scroll (solo 2 bandas de nombre completas) -> null", () => {
  // Regla nueva y deliberada del detector: exige una cadena aritmética de al
  // menos o.rows (=3) bandas de fila. Con solo 2 bandas visibles cualquier par
  // forma "cadena" y el pitch vertical no está corroborado (hace falta un
  // segundo paso consistente), así que devuelve null y el caller cae a la
  // calibración manual guardada.
  const truth = { gridX: 400, gridY: 140, cellW: 250, cellH: 290, cols: 6 };
  const row2NameTop = truth.gridY + 2 * truth.cellH + 0.62 * truth.cellH;
  const height = Math.floor(row2NameTop) - 5; // corta justo antes de que empiece la banda de la fila 2
  const img = makeInventoryFrame({ width: 1920, height, ...truth });
  const trace = {};
  const res = detectInventoryGrid(img, { trace });
  assert.equal(res, null, "con 2 filas visibles el pitch no está corroborado -> null");
  assert.match(trace.fail ?? "", /cadena/, "el trace debe explicar que la cadena es insuficiente");
});

// ===========================================================================
// detectInventoryGrid: negativos
// ===========================================================================

test("detectInventoryGrid: imagen negra -> null", () => {
  const width = 1920, height = 1080;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 3; i < data.length; i += 4) data[i] = 255; // alpha opaco, RGB=0
  assert.equal(detectInventoryGrid({ data, width, height }), null);
});

test("detectInventoryGrid: una sola banda de texto (pantalla de recompensas, 4 bloques en una banda) -> null", () => {
  const width = 1920, height = 1080;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  const paint = (x, y) => {
    const i = (y * width + x) * 4;
    data[i] = 240; data[i + 1] = 235; data[i + 2] = 220;
  };
  const y0 = 500, y1 = 540;
  for (const x0 of [100, 400, 700, 1000]) {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x < x0 + 150; x++) if ((x - x0) % 5 < 3) paint(x, y);
    }
  }
  // Solo una banda de texto en total: el módulo exige bands.length >= 2 para
  // siquiera intentar estimar el pitch vertical -> corta pronto y da null.
  assert.equal(detectInventoryGrid({ data, width, height }), null);
});

test("detectInventoryGrid: textos en bandas no periódicas -> null", () => {
  const width = 1920, height = 1080;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  const paint = (x, y) => {
    const i = (y * width + x) * 4;
    data[i] = 240; data[i + 1] = 235; data[i + 2] = 220;
  };
  // 4 bandas horizontales con tops en 80, 210, 400, 610 (diffs 130,190,210: sin
  // patrón de múltiplos común dentro de la tolerancia del 12% de estimatePitch),
  // 3 bloques de texto por banda en columnas también no periódicas.
  const bands = [[80, 110], [210, 245], [400, 430], [610, 650]];
  for (const [y0, y1] of bands) {
    for (const x0 of [150, 500, 900]) {
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x < x0 + 130; x++) if ((x - x0) % 5 < 3) paint(x, y);
      }
    }
  }
  assert.equal(detectInventoryGrid({ data, width, height }), null);
});

// ===========================================================================
// Escenario "captura real": pantalla INVENTORY/SELL con HUD y panel lateral.
// Réplica de la captura 2551x1429 verificada a mano contra el detector:
//   - título grande y masivo arriba (y~60, alto ~55px)
//   - fila de iconos de categoría + buscador (y~245, 16 bloques pequeños + 2 medianos)
//   - panel derecho con bloques de texto a alturas no periódicas
//   - grid 6 cols: gx=115, gy=320, cellW=352, cellH=375, nombres NARANJA
//     rgb(247,140,25) con top de banda a 0.72*cellH (geometría de la captura
//     real: tops de banda de nombre en 590/965/1340), badges de cantidad.
// Resultado verificado: cellW=352 cellH=375 cols=6 x=116 y=365, cadena [590,965,1340].
// ===========================================================================

const REAL = { width: 2551, height: 1429, gridX: 115, gridY: 320, cellW: 352, cellH: 375, cols: 6, rows: 3 };

function makeRealisticFrame({ withGrid = true } = {}) {
  const { width, height } = REAL;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) setPixel(data, width, height, x, y, 30, 25, 35);
  }
  const stripe = (x0, x1, y0, y1, r, g, b) => {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if ((x - x0) % 5 < 3) setPixel(data, width, height, x, y, r, g, b);
      }
    }
  };

  // Título "INVENTORY / SELL" arriba: muy masivo (no debe colarse como fila)
  stripe(80, 700, 60, 114, 255, 255, 255);
  // Fila de iconos de categoría + buscador: 16 bloques pequeños + 2 medianos
  for (let k = 0; k < 16; k++) {
    const x0 = 100 + k * 60;
    stripe(x0, x0 + 34, 245, 275, 220, 220, 220);
  }
  stripe(1200, 1400, 245, 275, 220, 220, 220);
  stripe(1500, 1750, 245, 275, 220, 220, 220);
  // Panel derecho (SELL ITEMS / TOTAL...): bloques a alturas NO periódicas
  stripe(2350, 2530, 730, 762, 230, 230, 230);
  stripe(2350, 2500, 1120, 1150, 230, 230, 230);

  if (withGrid) {
    const { gridX, gridY, cellW, cellH, cols, rows } = REAL;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cellX = gridX + c * cellW;
        const cellY = gridY + r * cellH;
        const w = Math.round(cellW * 0.6);
        const x0 = Math.round(cellX + (cellW - w) / 2);
        const y0 = Math.round(cellY + cellH * 0.72); // tops de nombre: 590/965/1340
        const lh = Math.round(cellH * 0.12);
        stripe(x0, x0 + w, y0, y0 + lh - 1, 247, 140, 25); // nombre naranja del tema
        // Badge de cantidad top-left
        const bw = Math.round(cellW * 0.12);
        const bh = Math.round(cellH * 0.06);
        const by0 = Math.round(cellY + cellH * 0.04);
        for (let y = by0; y < by0 + bh; y++) {
          for (let x = cellX + 2; x < cellX + 2 + bw; x++) {
            setPixel(data, width, height, x, y, 247, 140, 25);
          }
        }
      }
    }
  }
  return { data, width, height };
}

test("detectInventoryGrid: captura real (HUD + panel lateral + grid naranja 6 cols) detecta la rejilla", () => {
  const trace = {};
  const res = detectInventoryGrid(makeRealisticFrame(), { trace });
  assert.ok(res, `no debería fallar; trace.fail = ${trace.fail}`);
  assert.equal(res.cols, REAL.cols, `cols exacto esperado ${REAL.cols}, obtenido ${res.cols}`);
  assert.ok(
    Math.abs(res.cellW - REAL.cellW) <= REAL.cellW * 0.10,
    `cellW ${res.cellW} fuera de tolerancia (esperado ~${REAL.cellW})`,
  );
  assert.ok(
    Math.abs(res.cellH - REAL.cellH) <= REAL.cellH * 0.10,
    `cellH ${res.cellH} fuera de tolerancia (esperado ~${REAL.cellH})`,
  );
  // Nombres al 60% del ancho de celda = valle ANCHO entre celdas: la fase por
  // centro-de-racha del valle debe seguir clavando el origen igualmente
  // (verificado a mano: x=116 frente al real 115 -> ±1px).
  assert.ok(
    Math.abs(res.gridZone.x - REAL.gridX) <= 0.1 * REAL.cellW,
    `gridZone.x ${res.gridZone.x} fuera de tolerancia estrecha (esperado ~${REAL.gridX} ±${0.1 * REAL.cellW})`,
  );
  // gridY sale 365 (= 590 - 0.60*375) frente a la verdad 320: el offset fijo
  // 0.60 de banda de nombre no coincide con el 0.72 real de esta captura, pero
  // queda dentro de 0.3*cellH y detectRowPhase/_applyRowPhase afina la fase en producción.
  assert.ok(
    Math.abs(res.gridZone.y - REAL.gridY) <= 0.3 * REAL.cellH,
    `gridZone.y ${res.gridZone.y} fuera de tolerancia (esperado ~${REAL.gridY})`,
  );
  // La cadena debe ser exactamente las 3 filas de nombres, sin HUD ni panel
  assert.deepEqual(trace.chain?.members, [634, 1009, 1384]);
  // rows ahora es dinámico (= longitud de la cadena): aquí hay 3 filas de nombres
  assert.equal(res.rows, 3);
});

test("detectInventoryGrid: solo HUD + panel lateral (sin grid) -> null", () => {
  const trace = {};
  const res = detectInventoryGrid(makeRealisticFrame({ withGrid: false }), { trace });
  assert.equal(res, null, "sin filas de nombres no hay cadena de >=3 bandas -> null");
  assert.ok(trace.fail, "el trace debe llevar el motivo del fallo");
});

// ===========================================================================
// REGRESIÓN (bug de producción, 2ª captura real): UI a menor escala, nombres
// al 90% del ancho de celda y TODOS a 2 líneas. Con nombres tan anchos el
// hueco entre celdas (~28px) es MENOR que el umbral de merge intra-banda
// (1.2·altoBanda ~49px): blocksInBand fusiona celdas vecinas en un solo bloque
// gigante. La versión antigua (centros de bloque + estimatePitch) no podía
// sacar cellW de ahí; la actual usa autocorrelación del perfil de columnas y
// fase por valle, que no dependen de la separación de bloques.
// Frame 2548x1390, grid gx=110 gy=255 cellW=276 cellH=296 cols=6 con 4 filas
// (la 4ª asoma cortada por abajo). Resultado verificado a mano:
//   {x:110, y:284, cellW:276, cellH:296, cols:6, rows:4}, cadena [462,758,1054,1350]
// ===========================================================================

const SMALL = { width: 2548, height: 1390, gridX: 110, gridY: 255, cellW: 276, cellH: 296, cols: 6, rows: 4 };

function makeSmallScaleFrame({ nameWidthFrac = 0.9 } = {}) {
  const { width, height } = SMALL;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) setPixel(data, width, height, x, y, 30, 25, 35);
  }
  const stripe = (x0, x1, y0, y1, r, g, b) => {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if ((x - x0) % 5 < 3) setPixel(data, width, height, x, y, r, g, b);
      }
    }
  };

  // HUD: título grande (y~45, alto ~60)
  stripe(80, 650, 45, 104, 255, 255, 255);
  // Fila de iconos + NAME/SEARCH (y~195)
  for (let k = 0; k < 14; k++) {
    const x0 = 100 + k * 55;
    stripe(x0, x0 + 30, 195, 222, 220, 220, 220);
  }
  stripe(1100, 1260, 195, 222, 220, 220, 220);
  stripe(1400, 1620, 195, 222, 220, 220, 220);
  // Panel derecho: bloques a alturas no periódicas (y~570-640 y y~1145-1250)
  stripe(2300, 2520, 570, 600, 230, 230, 230);
  stripe(2300, 2480, 612, 640, 230, 230, 230);
  stripe(2300, 2520, 1145, 1178, 230, 230, 230);
  stripe(2300, 2460, 1218, 1250, 230, 230, 230);

  const { gridX, gridY, cellW, cellH, cols, rows } = SMALL;
  const lh = Math.round(cellH * 0.065); // ~19px por línea de nombre
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cellX = gridX + c * cellW;
      const cellY = gridY + r * cellH;
      const w = Math.round(cellW * nameWidthFrac);
      const x0 = Math.round(cellX + (cellW - w) / 2);
      // Nombre a 2 líneas: primera al 0.70*cellH (tops: 462/758/1054/1350),
      // segunda 3px debajo con márgenes de 20px por lado (línea más corta).
      const y0 = Math.round(cellY + cellH * 0.70);
      stripe(x0, x0 + w - 1, y0, y0 + lh - 1, 247, 140, 25);
      const y1 = y0 + lh + 3;
      stripe(x0 + 20, x0 + w - 1 - 20, y1, y1 + lh - 1, 247, 140, 25);
      // Badge de cantidad 42x20 en la esquina sup-izq
      const by0 = Math.round(cellY + cellH * 0.04);
      for (let y = by0; y < by0 + 20; y++) {
        for (let x = cellX + 2; x < cellX + 2 + 42; x++) {
          setPixel(data, width, height, x, y, 247, 140, 25);
        }
      }
    }
  }
  return { data, width, height };
}

test("detectInventoryGrid REGRESIÓN: UI pequeña, nombres 90% a 2 líneas (celdas fusionadas), 4ª fila asomando", () => {
  const trace = {};
  const res = detectInventoryGrid(makeSmallScaleFrame(), { trace });
  assert.ok(res, `no debería fallar; trace.fail = ${trace.fail}`);
  assert.equal(res.cols, SMALL.cols, `cols exacto esperado ${SMALL.cols}, obtenido ${res.cols}`);
  assert.ok(
    Math.abs(res.cellW - SMALL.cellW) <= SMALL.cellW * 0.03,
    `cellW ${res.cellW} fuera de tolerancia (esperado ${SMALL.cellW} ±3%)`,
  );
  assert.ok(
    Math.abs(res.cellH - SMALL.cellH) <= SMALL.cellH * 0.03,
    `cellH ${res.cellH} fuera de tolerancia (esperado ${SMALL.cellH} ±3%)`,
  );
  assert.ok(
    Math.abs(res.gridZone.x - SMALL.gridX) <= 10,
    `gridZone.x ${res.gridZone.x} fuera de tolerancia (esperado ${SMALL.gridX} ±10px)`,
  );
  // rows dinámico: la 4ª fila asoma con su banda de nombre (top 1350) y entra en la cadena
  assert.equal(res.rows, 4, `rows esperado 4 (4ª fila asomando), obtenido ${res.rows}`);
  assert.deepEqual(trace.chain?.members, [502, 798, 1094, 1389]);
});

test("detectInventoryGrid REGRESIÓN: misma UI pequeña con nombres al 60% (valle ancho) mantiene el origen", () => {
  // Con nombres cortos el valle entre celdas es muy ancho: cualquier residuo del
  // fondo minimiza el perfil. La fase debe tomar el CENTRO de la racha de mínimos
  // para que el borde no derive hacia un lado del hueco.
  const trace = {};
  const res = detectInventoryGrid(makeSmallScaleFrame({ nameWidthFrac: 0.6 }), { trace });
  assert.ok(res, `no debería fallar; trace.fail = ${trace.fail}`);
  assert.equal(res.cols, SMALL.cols);
  assert.ok(
    Math.abs(res.gridZone.x - SMALL.gridX) <= 0.1 * SMALL.cellW,
    `gridZone.x ${res.gridZone.x} fuera de tolerancia (esperado ~${SMALL.gridX} ±${0.1 * SMALL.cellW})`,
  );
  assert.ok(Math.abs(res.cellW - SMALL.cellW) <= SMALL.cellW * 0.03);
});

// ===========================================================================
// REGRESIÓN (bug de producción, 3ª captura real): el detector se anclaba a los
// BADGES de cantidad en vez de a los nombres. Con badges grandes y sólidos
// (70x40) las bandas de badges superan el filtro de masa y forman una cadena
// aritmética PARALELA al mismo pitch que la de nombres — incluso más larga
// aquí (la 4ª fila asoma mostrando SOLO sus badges). El re-anclaje pliega el
// perfil de filas módulo cellH y busca el arco de masa máxima (= nombres),
// reconstruyendo las filas en esos slots.
// Frame 2403x1218, grid gx=5 gy=270 cellW=265 cellH=295 cols=6, 4 filas (la
// 4ª solo con badges visibles: su nombre caería en y=1385, fuera del frame).
// Resultado verificado a mano: {x:6, y:323, cellW:265, cellH:295, cols:6, rows:3}
// (esta réplica sintética da x=5; misma geometría dentro de ±1px).
// ===========================================================================

const BADGY = { width: 2403, height: 1218, gridX: 5, gridY: 270, cellW: 265, cellH: 295, cols: 6 };

function makeBadgeHeavyFrame() {
  const { width, height, gridX, gridY, cellW, cellH, cols } = BADGY;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) setPixel(data, width, height, x, y, 30, 25, 35);
  }
  const stripe = (x0, x1, y0, y1, r, g, b) => {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if ((x - x0) % 5 < 3) setPixel(data, width, height, x, y, r, g, b);
      }
    }
  };
  const solid = (x0, x1, y0, y1, r, g, b) => {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) setPixel(data, width, height, x, y, r, g, b);
    }
  };

  // HUD: título, contador de platino, pestaña PRIME PARTS, iconos, NAME/SEARCH
  stripe(80, 620, 45, 110, 255, 255, 255);
  stripe(1830, 2290, 70, 105, 255, 255, 255);
  stripe(90, 380, 155, 185, 230, 230, 230);
  for (let k = 0; k < 15; k++) {
    const x0 = 420 + k * 50;
    stripe(x0, x0 + 28, 200, 235, 220, 220, 220);
  }
  stripe(1300, 1560, 205, 235, 220, 220, 220);
  // Panel derecho: bloques A LA ALTURA DE LOS BADGES de la fila 1 (579-619) y TOTAL
  stripe(2140, 2390, 585, 615, 230, 230, 230);
  stripe(2140, 2340, 630, 660, 230, 230, 230);
  stripe(2140, 2390, 1150, 1180, 230, 230, 230);

  const lh = Math.round(cellH * 0.075); // ~22px
  for (let r = 0; r < 4; r++) { // 4 filas: la 4ª (cellY=1155) solo asoma sus badges
    for (let c = 0; c < cols; c++) {
      const cellX = gridX + c * cellW;
      const cellY = gridY + r * cellH;
      // Badge GRANDE Y SÓLIDO 70x40 en (cx+16, cy+14): masa comparable a la de
      // un nombre -> las bandas de badges sobreviven al bandMassFloor
      solid(cellX + 16, cellX + 16 + 69, cellY + 14, cellY + 14 + 39, 247, 140, 25);
      // Nombre a 1 línea al 0.78*cellH (tops: 500/795/1090; el de la 4ª fila
      // caería en 1385 > height), 80% del ancho, rayado 3on/2off
      const w = Math.round(cellW * 0.8);
      const x0 = Math.round(cellX + (cellW - w) / 2);
      const y0 = Math.round(cellY + cellH * 0.78);
      stripe(x0, x0 + w - 1, y0, y0 + lh - 1, 247, 140, 25);
    }
  }
  return { data, width, height };
}

test("detectInventoryGrid REGRESIÓN: badges grandes no roban el anclaje de fila (re-anclaje a nombres)", () => {
  const trace = {};
  const res = detectInventoryGrid(makeBadgeHeavyFrame(), { trace });
  assert.ok(res, `no debería fallar; trace.fail = ${trace.fail}`);
  assert.equal(res.cols, BADGY.cols, `cols exacto esperado ${BADGY.cols}, obtenido ${res.cols}`);
  assert.ok(
    Math.abs(res.cellW - BADGY.cellW) <= BADGY.cellW * 0.02,
    `cellW ${res.cellW} fuera de tolerancia (esperado ${BADGY.cellW} ±2%)`,
  );
  assert.ok(
    Math.abs(res.cellH - BADGY.cellH) <= BADGY.cellH * 0.02,
    `cellH ${res.cellH} fuera de tolerancia (esperado ${BADGY.cellH} ±2%)`,
  );
  assert.ok(
    Math.abs(res.gridZone.x - BADGY.gridX) <= 10,
    `gridZone.x ${res.gridZone.x} fuera de tolerancia (esperado ~${BADGY.gridX} ±10px)`,
  );
  // rows = 3: la cadena elegida puede ser la de badges (4 miembros, tops
  // 284/579/874/1169), pero el re-anclaje debe reconstruir las filas sobre las
  // bandas de NOMBRES (500/795/1090) — la 4ª fila sin nombre visible no cuenta.
  assert.equal(res.rows, 3, `rows esperado 3, obtenido ${res.rows}`);
  assert.deepEqual(trace.rowBands, [500, 795, 1090], "las filas re-ancladas deben ser las bandas de nombres");
  // gridY anclado a los NOMBRES: 500 - 0.60*295 = 323, a <0.2*cellH del real 270.
  // Si se anclara a los badges saldría ~107 (284-177) y fallaría de largo.
  assert.ok(
    Math.abs(res.gridZone.y - BADGY.gridY) <= 0.2 * BADGY.cellH,
    `gridZone.y ${res.gridZone.y} fuera de tolerancia (esperado ~${BADGY.gridY} ±${0.2 * BADGY.cellH})`,
  );
  // NOTA: trace.trimmedCols NO se asserta aquí: el panel derecho está a la
  // altura de los badges, no de los nombres, así que no entra en el perfil de
  // columnas de las filas re-ancladas y no hay columnas fantasma que recortar
  // (verificado: trimmedCols === undefined en este fixture).
});

// ===========================================================================
// REGRESIÓN (4ª iteración): GUARDIA DE MEDIO PITCH. Si los badges caen casi
// equidistantes entre dos filas de nombres (badge en cy+40, nombre en cy+205
// con cellH=330 -> pasos badge->nombre de 165/165 EXACTOS), la cadena
// badge->nombre->badge cuela un pitch de cellH/2. Tras re-anclar, con >=5
// rowBands y masas de filas alternas asimétricas (min < 0.6*max), la guardia
// duplica cellH y conserva solo la paridad pesada (los nombres).
// Frame 1661x1116, grid gx=0 gy=150 cellW=270 cellH=330 cols=6, 3 filas.
// Verificado a mano: cadena [355,520,685,850,1015] pitch 165 ->
// halfPitchFixed {cellHBefore:165, kept:[355,685,1015]} y resultado final
// {x:0, y:157, cellW:270, cellH:330, cols:6, rows:3}.
// (El badge de la fila 0, top=190, queda bajo el hudLimit de 0.2*1116=223 y no
// entra ni en cadena ni en re-anclaje; por eso la cadena empieza en 355.)
// ===========================================================================

const HALFP = { width: 1661, height: 1116, gridX: 0, gridY: 150, cellW: 270, cellH: 330, cols: 6 };

function makeHalfPitchFrame({ badges = true } = {}) {
  const { width, height, gridX, gridY, cellW, cellH, cols } = HALFP;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) setPixel(data, width, height, x, y, 30, 25, 35);
  }
  const stripe = (x0, x1, y0, y1, r, g, b) => {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if ((x - x0) % 5 < 3) setPixel(data, width, height, x, y, r, g, b);
      }
    }
  };

  // HUD compacto: 17 iconos con pitch 48 + NAME + SEARCH en la franja superior
  for (let k = 0; k < 17; k++) {
    const x0 = 20 + k * 48;
    stripe(x0, x0 + 28, 15, 45, 220, 220, 220);
  }
  stripe(1090, 1310, 15, 40, 230, 230, 230);
  stripe(1420, 1600, 15, 40, 230, 230, 230);

  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < cols; c++) {
      const cellX = gridX + c * cellW;
      const cellY = gridY + r * cellH;
      // Badge rayado en (cx+14..cx+64, cy+100..cy+138): baselines 288/618/948, justo
      // a cellH/2=165 de los nombres -> cadena de medio pitch
      if (badges) stripe(cellX + 14, cellX + 64, cellY + 100, cellY + 138, 247, 140, 25);
      // Nombre 1 línea al 0.80*cellH (cy+264, alto 40), 80% del ancho centrado
      const w = Math.round(cellW * 0.8);
      const x0 = Math.round(cellX + (cellW - w) / 2);
      stripe(x0, x0 + w - 1, cellY + 264, cellY + 303, 247, 140, 25);
    }
  }
  return { data, width, height };
}

test("detectInventoryGrid REGRESIÓN: guardia de medio pitch (badges equidistantes entre nombres)", () => {
  const trace = {};
  const res = detectInventoryGrid(makeHalfPitchFrame(), { trace });
  assert.ok(res, `no debería fallar; trace.fail = ${trace.fail}`);
  // La cadena elegida es la de medio pitch (badge->nombre->badge, 165px)...
  assert.deepEqual(trace.chain?.members, [288, 453, 618, 783, 948, 1113]);
  // ...y la guardia debe corregirla: duplicar cellH y quedarse con los nombres
  assert.ok(trace.halfPitchFixed, "la guardia de medio pitch debe activarse");
  assert.ok(
    Math.abs(trace.halfPitchFixed.cellHBefore - 165) <= 165 * 0.02,
    `cellHBefore ${trace.halfPitchFixed.cellHBefore} debería ser ~165`,
  );
  assert.deepEqual(trace.halfPitchFixed.kept, [414, 744, 1074]);
  assert.deepEqual(trace.rowBands, [414, 744, 1074]);
  assert.ok(
    Math.abs(res.cellH - HALFP.cellH) <= HALFP.cellH * 0.02,
    `cellH ${res.cellH} fuera de tolerancia (esperado ${HALFP.cellH} ±2%)`,
  );
  assert.equal(res.cols, HALFP.cols);
  assert.equal(res.rows, 3);
  assert.ok(
    Math.abs(res.gridZone.x - HALFP.gridX) <= 10,
    `gridZone.x ${res.gridZone.x} fuera de tolerancia (esperado ~${HALFP.gridX} ±10px)`,
  );
  assert.ok(
    Math.abs(res.gridZone.y - HALFP.gridY) <= 0.2 * HALFP.cellH,
    `gridZone.y ${res.gridZone.y} fuera de tolerancia (esperado ~${HALFP.gridY} ±${0.2 * HALFP.cellH})`,
  );
});

test("detectInventoryGrid control: mismo fixture SIN badges no activa la guardia y da la misma geometría", () => {
  const trace = {};
  const res = detectInventoryGrid(makeHalfPitchFrame({ badges: false }), { trace });
  assert.ok(res, `no debería fallar; trace.fail = ${trace.fail}`);
  assert.equal(trace.halfPitchFixed, undefined, "sin badges no hay cadena de medio pitch que corregir");
  assert.deepEqual(trace.rowBands, [414, 744, 1074]);
  assert.ok(Math.abs(res.cellH - HALFP.cellH) <= HALFP.cellH * 0.02);
  assert.equal(res.cols, HALFP.cols);
  assert.equal(res.rows, 3);
  assert.ok(Math.abs(res.gridZone.x - HALFP.gridX) <= 10);
  assert.ok(Math.abs(res.gridZone.y - HALFP.gridY) <= 0.2 * HALFP.cellH);
});

// ===========================================================================
// REGRESIÓN (5ª iteración, PRIMERA traza real en vivo): los REFLEJOS metálicos
// del arte de las cards son bloques sólidos brillantes que, contando píxeles,
// inflaban las masas de banda y la cadena encontraba caminos "batidos" de paso
// ~0.63*cellH mezclando bandas de nombres/badges/arte. Con el conteo por
// TRANSICIONES oscuro→brillante el texto domina (decenas de bordes de letra
// por línea) y un bloque sólido puntúa ~1 por línea.
// Frame 2403x1390, grid gx=81 gy=237 cellW=277 cellH=296 cols=6, 4 filas;
// badges sólidos 42x22, ARTE sólido brillante en celdas alternas y nombres a
// 2 líneas rayadas (gap real de 9px entre líneas -> mergeGapY=12 las funde en
// una banda por fila). Resultado verificado a mano:
//   chain/rowBands [459,755,1051,1347] pitch 296, sin halfPitchFixed,
//   {x:81, y:281, cellW:277, cellH:296, cols:6, rows:4}
// (esta réplica sintética da x=79: misma geometría a ±2px del verificado).
// ===========================================================================

const ARTY = { width: 2403, height: 1390, gridX: 81, gridY: 237, cellW: 277, cellH: 296, cols: 6 };

function makeArtHeavyFrame() {
  const { width, height, gridX, gridY, cellW, cellH, cols } = ARTY;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) setPixel(data, width, height, x, y, 30, 25, 35);
  }
  const stripe = (x0, x1, y0, y1, r, g, b) => {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if ((x - x0) % 5 < 3) setPixel(data, width, height, x, y, r, g, b);
      }
    }
  };
  const solid = (x0, x1, y0, y1, r, g, b) => {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) setPixel(data, width, height, x, y, r, g, b);
    }
  };

  // HUD: título rayado + 17 iconos + NAME/SEARCH (y=206-230, bajo el hudLimit
  // del 20% = 278px: quedan excluidos de la cadena)
  stripe(80, 620, 65, 117, 255, 255, 255);
  for (let k = 0; k < 17; k++) {
    const x0 = 100 + k * 48;
    stripe(x0, x0 + 28, 206, 230, 220, 220, 220);
  }
  stripe(1090, 1310, 206, 230, 230, 230, 230);
  stripe(1420, 1600, 206, 230, 230, 230, 230);

  for (let r = 0; r < 4; r++) { // 4 filas: la 4ª asoma (nombres en 1347, cortados)
    for (let c = 0; c < cols; c++) {
      const cx = gridX + c * cellW;
      const cy = gridY + r * cellH;
      // Badge SÓLIDO 42x22 (con transiciones puntúa ~1 por línea: despreciable)
      solid(cx + 16, cx + 16 + 41, cy + 18, cy + 18 + 21, 230, 220, 180);
      // ARTE sólido brillante (reflejos metálicos) en celdas alternas
      if ((r + c) % 2 === 0) solid(cx + 70, cx + 200, cy + 70, cy + 165, 230, 230, 230);
      if ((r * 7 + c * 3) % 3 === 0) solid(cx + 120, cx + 180, cy + 170, cy + 205, 230, 230, 230);
      // Nombre a 2 LÍNEAS rayadas: tops de banda 459/755/1051/1347; el gap de
      // 9px entre líneas (241->251) se funde con mergeGapY=12
      const w = Math.round(cellW * 0.85);
      const x0 = Math.round(cx + (cellW - w) / 2);
      stripe(x0, x0 + w - 1, cy + 222, cy + 241, 247, 140, 25);
      stripe(x0 + 18, x0 + w - 1 - 18, cy + 251, cy + 270, 247, 140, 25);
    }
  }
  return { data, width, height };
}

test("detectInventoryGrid REGRESIÓN: arte sólido brillante no bate la cadena (conteo por transiciones)", () => {
  const trace = {};
  const res = detectInventoryGrid(makeArtHeavyFrame(), { trace });
  assert.ok(res, `no debería fallar; trace.fail = ${trace.fail}`);
  // La cadena debe ser EXACTAMENTE las 4 bandas de nombres, sin mezclar
  // arte/badges (el camino batido de ~0.63*cellH del bug original)
  assert.deepEqual(trace.chain?.members, [507, 803, 1099, 1389]);
  assert.deepEqual(trace.rowBands, [459, 755, 1051, 1347]);
  assert.equal(trace.halfPitchFixed, undefined, "la guardia de medio pitch no debe intervenir");
  assert.ok(
    Math.abs(res.cellW - ARTY.cellW) <= ARTY.cellW * 0.02,
    `cellW ${res.cellW} fuera de tolerancia (esperado ${ARTY.cellW} ±2%)`,
  );
  assert.ok(
    Math.abs(res.cellH - ARTY.cellH) <= ARTY.cellH * 0.02,
    `cellH ${res.cellH} fuera de tolerancia (esperado ${ARTY.cellH} ±2%)`,
  );
  assert.equal(res.cols, ARTY.cols, `cols exacto esperado ${ARTY.cols}, obtenido ${res.cols}`);
  assert.equal(res.rows, 4, `rows esperado 4 (4ª fila asomando), obtenido ${res.rows}`);
  assert.ok(
    Math.abs(res.gridZone.x - ARTY.gridX) <= 5,
    `gridZone.x ${res.gridZone.x} fuera de tolerancia (esperado ~${ARTY.gridX} ±5px)`,
  );
  assert.ok(
    Math.abs(res.gridZone.y - ARTY.gridY) <= 0.2 * ARTY.cellH,
    `gridZone.y ${res.gridZone.y} fuera de tolerancia (esperado ~${ARTY.gridY} ±${0.2 * ARTY.cellH})`,
  );
});

// Regresión del bug reportado en vivo (frame 2560x1440): las filas con distinto
// nº de líneas de nombre daban saltos de y0 DESIGUALES (260 vs 306 px) y la cadena
// aritmética se rompía -> "cadena de solo 2 filas (<3)" -> caía a calibración
// manual basura. Anclando la cadena en la BASE de banda (y1) las filas quedan
// equidistantes (los nombres están bottom-anchored en la card). Debe detectar 3 filas.
test("detectInventoryGrid REGRESIÓN: filas con distinto nº de líneas (y0 desigual) detectan 3 filas (bug 2560x1440)", () => {
  const truth = { gridX: 90, gridY: 260, cellW: 277, cellH: 296, cols: 6 };
  const img = makeInventoryFrame({
    width: 2560, height: 1440, ...truth,
    // fila 0 y 1 con nombres a 2 líneas, fila 2 a 1 línea: replica el desfase de y0
    // observado en vivo mientras y1 (base) se mantiene equidistante.
    twoLineNames: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  });
  const trace = {};
  const res = detectInventoryGrid(img, { trace });
  assert.ok(res, `no debería devolver null; trace.fail = ${trace.fail}`);
  assert.equal(res.cols, 6, `cols esperado 6, obtenido ${res.cols}`);
  assert.equal(res.rows, 3, `rows esperado 3, obtenido ${res.rows}`);
  assert.ok(
    Math.abs(res.cellH - truth.cellH) <= truth.cellH * 0.15,
    `cellH ${res.cellH} fuera de tolerancia (~${truth.cellH})`,
  );
});

// Regresión del bug reportado en vivo: al BAJAR y volver a SUBIR, el juego clampa el
// scroll a media fila y la 1ª fila entra CORTADA por arriba. Su nombre cae ENTERO dentro
// de la franja HUD (y1 < 0.2·h), así que el filtro anti-HUD la descartaba junto al
// título/buscador. Con solo 2 filas completas visibles, la cadena se quedaba en 2
// miembros y la detección devolvía NULL ("cadena de solo 2 filas") → el escáner caía a
// la calibración manual guardada, que NO corresponde al scroll actual: de ahí la rejilla
// descuadrada (filas de abajo completas, la primera cortada).
// Ahora esa banda se readmite si cae a un pitch exacto por encima de la cadena Y alinea
// en columnas con ella (dos condiciones que el HUD real no cumple), así que el pitch
// queda corroborado con 3 miembros y la detección sobrevive.
for (const gridY of [-60, -120, -200]) {
  test(`detectInventoryGrid REGRESIÓN: scroll clampado, 1ª fila cortada (gridY=${gridY}) no colapsa a NULL`, () => {
    const truth = { gridX: 400, gridY, cellW: 250, cellH: 290, cols: 6 };
    // 3 filas totales: con la 1ª cortada solo quedan 2 completas — el caso que rompía.
    const img = makeInventoryFrame({ width: 1920, height: 1080, ...truth, rows: 3 });
    const trace = {};
    const res = detectInventoryGrid(img, { trace });

    assert.ok(res, `no debería devolver null (caería a la calibración manual); trace.fail = ${trace.fail}`);
    assert.equal(res.cols, 6, `cols esperado 6, obtenido ${res.cols}`);
    assert.ok(
      Math.abs(res.cellH - truth.cellH) <= truth.cellH * 0.12,
      `cellH ${res.cellH} fuera de tolerancia (~${truth.cellH})`,
    );
    // La fila cortada debe haberse reconocido como fila real, no como HUD.
    assert.ok(trace.clippedTopRow, "la fila cortada por arriba debería readmitirse en la cadena");
    // El origen nunca sale del frame, y las filas caen sobre la retícula real.
    assert.ok(res.gridZone.y >= 0, `gridZone.y no puede ser negativo: ${res.gridZone.y}`);
    for (let k = 0; k < res.rows; k++) {
      const top = res.gridZone.y + k * res.cellH;
      let d = (top - gridY) % truth.cellH;
      if (d > truth.cellH / 2) d -= truth.cellH;
      if (d < -truth.cellH / 2) d += truth.cellH;
      assert.ok(Math.abs(d) <= 6,
        `fila ${k} desalineada ${d}px respecto a la retícula real (¿anclada a la fila equivocada?)`);
    }
  });
}
