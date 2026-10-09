import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodePng } from "./_helpers/png.mjs";
import { rejillaConMemoria, memoriaDeRejilla } from "../deploy/js/utils/vision/grid_memoria.js";
import {
  rowProfile,
  findBands,
  blocksInBand,
  estimatePitch,
  bestArithmeticChain,
  detectInventoryGrid,
} from "../deploy/js/utils/vision/grid_detect.js";
import { makeInventoryFrame, setPixel } from "./_helpers/inventory-frame.mjs";
import { PLANTILLA_CHECK, CHECK_OFFSET, CHECK_CELDA_REF, CHECK_ESCALA_REF } from "../deploy/js/utils/vision/check_anchor.js";

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

test("bestArithmeticChain: 3 posiciones equiespaciadas + 2 bandas HUD sueltas -> cadena = las 3 reales", () => {
  // HUD bands (a massive title and a stray row) at heights that do NOT step with the real rows: 60 and 150
  // against 500/800/1100
  const items = [
    { pos: 60, mass: 900, centers: [400] },                 // title: massive but off the chain
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
  // real case: the icons and search row at y=245 joins the row chain (590, 965, 1340, pitch 375) with a 345
  // step
  // trimming the ends (>6% off the median step) has to drop it
  const items = [245, 590, 965, 1340].map(pos => ({ pos, mass: 500, centers: [200, 500, 800] }));
  const r = bestArithmeticChain(items, 170, 715);
  assert.ok(r, "debe encontrar cadena");
  assert.deepEqual(r.members, [590, 965, 1340], "la banda HUD (245) debe quedar podada");
  assert.ok(Math.abs(r.pitch - 375) < 3, `pitch ${r.pitch} debería ser ~375`);
});

test("bestArithmeticChain: entre cadenas de >=3 filas gana la de más MASA (nombres pesan ~10x más que badges)", () => {
  // quantity badges form a chain PARALLEL to the names at the same pitch, so length and alignment do not
  // tell them apart; mass does
  // priority: len>=3, then mass, then alignment, then length
  const items = [
    // "badges" chain: aligned but light
    { pos: 100, mass: 100, centers: [50, 200, 350] },
    { pos: 250, mass: 100, centers: [50, 200, 350] },
    { pos: 400, mass: 100, centers: [50, 200, 350] },
    // "names" chain: misaligned (centers drift 30px > 15% of the pitch) but massive
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
    // aligned chain (same centers band to band)
    { pos: 100, mass: 500, centers: [50, 200, 350] },
    { pos: 250, mass: 500, centers: [50, 200, 350] },
    { pos: 400, mass: 500, centers: [50, 200, 350] },
    // same total mass, misaligned
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

test("findBands: filtra una banda débil tipo badge (masa < 22% de la máxima)", () => {
  const height = 100;
  const prof = new Float32Array(height);
  // 3 strong "name" bands, 7px tall (>= minBandH=6), mass 700 each, 23px apart: well over mergeGapY=12 so
  // they do not merge
  for (let y = 10; y <= 16; y++) prof[y] = 100;
  for (let y = 40; y <= 46; y++) prof[y] = 100;
  for (let y = 70; y <= 76; y++) prof[y] = 100;
  // weak badge-like band: 7px tall but low value -> mass 105 (< 22% of 700 = 154)
  for (let y = 90; y <= 96; y++) prof[y] = 15;

  const bands = findBands(prof, height);
  assert.equal(bands.length, 3, "solo las 3 bandas fuertes deben sobrevivir al filtro de masa");
  for (const b of bands) assert.equal(b.mass, 700);
  assert.deepEqual(bands.map(b => b.y0), [10, 40, 70]);
});

test("findBands: imagen sin señal (perfil plano) -> sin bandas", () => {
  const height = 50;
  const prof = new Float32Array(height);
  assert.deepEqual(findBands(prof, height), []);
});

test("blocksInBand: 3 bloques de texto rayado separados por gaps grandes", () => {
  // blocksInBand counts EDGES (|Δluma|) per column, not pixels over a threshold, so "text" is painted
  // striped (3 on / 2 off, like letter strokes)
  // a solid block only gives 2 edges; each stroke gives 2, so the block ends at the FALLING edge of the last
  // stroke
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
  // bandH = 6 -> block split gap = max(6, round(6·1.2)) = 7px; the gaps between strokes stay under it and do
  // not split the block
  stripe(10, 39);   // strokes start at 10,15,...,35 (last stroke 35..37)
  stripe(100, 129); // gap to the previous one: 100-38 = 62 > 7 -> separate block
  stripe(200, 229);

  const blocks = blocksInBand({ data, width, height }, 0, height - 1);
  assert.equal(blocks.length, 3);
  assert.deepEqual(blocks.map(b => [b.x0, b.x1]), [[10, 38], [100, 128], [200, 228]]);
  const centers = blocks.map(b => b.cx);
  assert.ok(Math.abs(centers[0] - 24) <= 3);
  assert.ok(Math.abs(centers[1] - 114) <= 3);
  assert.ok(Math.abs(centers[2] - 214) <= 3);
  // striped text = many edges: 6 rows x 6 strokes x 2 edges = 72
  for (const b of blocks) assert.equal(b.mass, 72);
});

test("blocksInBand: un bloque SÓLIDO ancho (reflejo de arte) se filtra frente al texto rayado", () => {
  // a metallic art reflection is a solid bright rectangle: by edge count it leaves 2 isolated columns, both
  // under the 4px minimum width, so it vanishes
  // striped text is a dense cluster of edges
  const width = 400, height = 6;
  const data = new Uint8ClampedArray(width * height * 4);
  const paint = (x, y) => {
    const i = (y * width + x) * 4;
    data[i] = 220; data[i + 1] = 220; data[i + 2] = 220; data[i + 3] = 255;
  };
  for (let y = 0; y < height; y++) {
    // striped text 3 on / 2 off at 10..59
    for (let x = 10; x <= 59; x++) if ((x - 10) % 5 < 3) paint(x, y);
    // SOLID block of the same size at 150..199
    for (let x = 150; x <= 199; x++) paint(x, y);
  }
  const blocks = blocksInBand({ data, width, height }, 0, height - 1);
  assert.equal(blocks.length, 1, "el bloque sólido debe quedar filtrado (bordes aislados <4px)");
  assert.equal(blocks[0].x0, 10, "el bloque superviviente es el de texto rayado");
  assert.ok(blocks[0].mass >= 36, "el texto rayado rinde masa alta (dos bordes por trazo y fila)");
});

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

// a search leaves one or two result rows; two only count when their step matches cell width × 1.069
// (measured on 40 captures) and both rows have ✓ marks: any pair of text bands makes a "chain"
function conChecks(img, { gridX, gridY, cellW, cellH, cols, celdas }) {
  const f = Math.round(CHECK_ESCALA_REF * cellH / CHECK_CELDA_REF);
  for (const k of celdas) {
    const cx = gridX + (k % cols) * cellW + CHECK_OFFSET.x * cellW, cy = gridY + Math.floor(k / cols) * cellH + CHECK_OFFSET.y * cellH;
    for (let j = 0; j < 16; j++) for (let i = 0; i < 16; i++) {
      const v = parseInt(PLANTILLA_CHECK[j * 16 + i], 16) * 16;
      for (let dy = 0; dy < f; dy++) for (let dx = 0; dx < f; dx++) {
        const p = ((Math.round(cy) + (j - 8) * f + dy) * img.width + Math.round(cx) + (i - 8) * f + dx) * 4;
        img.data[p] = img.data[p + 1] = img.data[p + 2] = v;
      }
    }
  }
  return img;
}

test("detectInventoryGrid: dos filas de una búsqueda, solo con el paso del ancho de celda y marcas ✓ en las dos", () => {
  const geo = { gridX: 81, gridY: 252, cellW: 277, cols: 6 };
  const dos = (cellH, celdas = [0, 1, 2, 6, 7]) => detectInventoryGrid(conChecks(
    makeInventoryFrame({ width: 2560, height: 1440, ...geo, cellH, rows: 2, filled: [0, 1, 2, 3, 4, 5, 6, 7, 8] }), { ...geo, cellH, celdas }));
  const r = dos(296);
  assert.deepEqual({ rows: r.rows, cols: r.cols, cellW: r.cellW, cellH: r.cellH }, { rows: 2, cols: 6, cellW: 277, cellH: 296 });
  assert.ok(Math.abs(r.gridX - 81) <= 3 && Math.abs(r.gridY - 252) <= 3);
  assert.equal(dos(330), null, "el paso no casa con el ancho");
  assert.equal(dos(296, [0, 1, 2, 3]), null, "marcas solo en la primera fila");
});

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
  // 18 cells (3x6), 11 filled, with gaps that give center diffs of 2·cellW in some rows (row 0: cols
  // 0,1,3,4)
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
  const truth = { gridX: 400, gridY: 140, cellW: 250, cellH: 290, cols: 6 };
  const img = makeInventoryFrame({
    width: 1920, height: 1080, ...truth,
    noise: 0.3, bgGradient: true,
  });
  const res = detectInventoryGrid(img);
  assertDetected(res, truth);
});

// theme invariance: with a light BACKGROUND theme (magenta, cyan…) the old absolute brightness threshold
// lit the whole background and the text stopped producing transitions
// |Δluma| does not depend on background or text color, so every combination has to detect the same

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
  // deliberate rule: the chain needs at least o.rows (=3) row bands; with only 2 any pair is a "chain" and
  // the vertical pitch is not corroborated
  // so it returns null and the caller falls back to the saved manual calibration
  const truth = { gridX: 400, gridY: 140, cellW: 250, cellH: 290, cols: 6 };
  const row2NameTop = truth.gridY + 2 * truth.cellH + 0.62 * truth.cellH;
  const height = Math.floor(row2NameTop) - 5; // cuts just before the row 2 band starts
  const img = makeInventoryFrame({ width: 1920, height, ...truth });
  const trace = {};
  const res = detectInventoryGrid(img, { trace });
  assert.equal(res, null, "con 2 filas visibles el pitch no está corroborado -> null");
  assert.match(trace.fail ?? "", /cadena/, "el trace debe explicar que la cadena es insuficiente");
});

test("detectInventoryGrid: imagen negra -> null", () => {
  const width = 1920, height = 1080;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
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
  // a single text band: the module needs bands.length >= 2 to even try a vertical pitch
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
  // 4 bands with tops at 80, 210, 400, 610 (no common multiple within the 12% of estimatePitch), 3 text
  // blocks per band at non periodic columns
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

// "real capture" scenario: INVENTORY/SELL with HUD and side panel, a replica of a 2551x1429 capture
// checked by hand against the detector
// big title on top, icons and search row at y~245, side panel blocks at non periodic heights
// 6 cols with ORANGE names whose band top sits at 0.72·cellH (590/965/1340), plus quantity badges

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

  // INVENTORY / SELL title on top: very massive, must not sneak in as a row
  stripe(80, 700, 60, 114, 255, 255, 255);
  // category icons row + search: 16 small blocks + 2 medium
  for (let k = 0; k < 16; k++) {
    const x0 = 100 + k * 60;
    stripe(x0, x0 + 34, 245, 275, 220, 220, 220);
  }
  stripe(1200, 1400, 245, 275, 220, 220, 220);
  stripe(1500, 1750, 245, 275, 220, 220, 220);
  // right panel (SELL ITEMS / TOTAL...): blocks at NON periodic heights
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
        const y0 = Math.round(cellY + cellH * 0.72); // name tops: 590/965/1340
        const lh = Math.round(cellH * 0.12);
        stripe(x0, x0 + w, y0, y0 + lh - 1, 247, 140, 25); // orange theme name
        // quantity badge top left
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
  // names at 60% of the cell width = WIDE valley between cells: the valley run center phase still has to pin
  // the origin (116 against the real 115)
  assert.ok(
    Math.abs(res.gridZone.x - REAL.gridX) <= 0.1 * REAL.cellW,
    `gridZone.x ${res.gridZone.x} fuera de tolerancia estrecha (esperado ~${REAL.gridX} ±${0.1 * REAL.cellW})`,
  );
  // gridY comes out 365 (= 590 - 0.60·375) against the real 320: the fixed 0.60 name band offset is not the
  // 0.72 of this capture
  // it stays within 0.3·cellH and detectRowPhase/_applyRowPhase fixes the phase in production
  assert.ok(
    Math.abs(res.gridZone.y - REAL.gridY) <= 0.3 * REAL.cellH,
    `gridZone.y ${res.gridZone.y} fuera de tolerancia (esperado ~${REAL.gridY})`,
  );
  // the chain has to be exactly the 3 name rows, no HUD or panel
  assert.deepEqual(trace.chain?.members, [634, 1009, 1384]);
  assert.equal(res.rows, 3);
});

test("detectInventoryGrid: solo HUD + panel lateral (sin grid) -> null", () => {
  const trace = {};
  const res = detectInventoryGrid(makeRealisticFrame({ withGrid: false }), { trace });
  assert.equal(res, null, "sin filas de nombres no hay cadena de >=3 bandas -> null");
  assert.ok(trace.fail, "el trace debe llevar el motivo del fallo");
});

// UI at a smaller scale, names at 90% of the cell width and ALL on 2 lines
// the gap between cells (~28px) is SMALLER than the in-band merge threshold (1.2·band height ~49px), so
// blocksInBand fuses neighbor cells into one huge block
// cellW comes from the column profile autocorrelation and the valley phase, which do not depend on block
// separation

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

  // HUD: big title (y~45, ~60 tall)
  stripe(80, 650, 45, 104, 255, 255, 255);
  // icons row + NAME/SEARCH (y~195)
  for (let k = 0; k < 14; k++) {
    const x0 = 100 + k * 55;
    stripe(x0, x0 + 30, 195, 222, 220, 220, 220);
  }
  stripe(1100, 1260, 195, 222, 220, 220, 220);
  stripe(1400, 1620, 195, 222, 220, 220, 220);
  // right panel: blocks at non periodic heights (y~570-640 and y~1145-1250)
  stripe(2300, 2520, 570, 600, 230, 230, 230);
  stripe(2300, 2480, 612, 640, 230, 230, 230);
  stripe(2300, 2520, 1145, 1178, 230, 230, 230);
  stripe(2300, 2460, 1218, 1250, 230, 230, 230);

  const { gridX, gridY, cellW, cellH, cols, rows } = SMALL;
  const lh = Math.round(cellH * 0.065); // ~19px per name line
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cellX = gridX + c * cellW;
      const cellY = gridY + r * cellH;
      const w = Math.round(cellW * nameWidthFrac);
      const x0 = Math.round(cellX + (cellW - w) / 2);
      // 2 line name: the first at 0.70·cellH (tops 462/758/1054/1350), the second 3px below with 20px side
      // margins
      const y0 = Math.round(cellY + cellH * 0.70);
      stripe(x0, x0 + w - 1, y0, y0 + lh - 1, 247, 140, 25);
      const y1 = y0 + lh + 3;
      stripe(x0 + 20, x0 + w - 1 - 20, y1, y1 + lh - 1, 247, 140, 25);
      // 42x20 quantity badge in the top left corner
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
  // the 4th row peeks with its name band (top 1350) and joins the chain
  assert.equal(res.rows, 4, `rows esperado 4 (4ª fila asomando), obtenido ${res.rows}`);
  assert.deepEqual(trace.chain?.members, [502, 798, 1094, 1389]);
});

test("detectInventoryGrid REGRESIÓN: misma UI pequeña con nombres al 60% (valle ancho) mantiene el origen", () => {
  // with short names the valley between cells is very wide and any background residue minimizes the profile
  // the phase has to take the CENTER of the minimum run so the edge does not drift to one side of the gap
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

// what reaches the detector is the page CROP from enqueueInventoryPage, not the screen frame
// that crop starts mid row, so the first name band falls in the top 20%, the strip that is HUD in a full
// frame
// band rescue dropped it by position, the chain stayed at two rows and the grid anchored ~0.25 cell above
// the cards
// the UI is the one from the block above, which fuses the six names edge to edge and forces the rescue

function recorta({ data, width }, x, y, w, h) {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let r = 0; r < h; r++) {
    const src = ((y + r) * width + x) * 4;
    out.set(data.subarray(src, src + w * 4), r * w * 4);
  }
  return { data: out, width: w, height: h };
}

test("detectInventoryGrid REGRESIÓN: el recorte de página que empieza a media fila mantiene la fase", () => {
  const frame = makeSmallScaleFrame();
  const completo = detectInventoryGrid(frame);
  const cropY = SMALL.gridY + Math.round(SMALL.cellH * 0.75);
  // the crop reaches the bottom of the screen, which cuts the 4th row names: three bands are left and one of
  // them falls in the top strip
  const cropH = SMALL.gridY + 3 * SMALL.cellH + Math.round(SMALL.cellH * 0.70) - cropY - 20;
  const trace = {};
  const res = detectInventoryGrid(
    recorta(frame, SMALL.gridX, cropY, SMALL.cols * SMALL.cellW, cropH),
    { trace },
  );
  assert.ok(res, `no debería fallar; trace.fail = ${trace.fail}`);
  assert.equal(res.cols, SMALL.cols, `cols esperado ${SMALL.cols}, obtenido ${res.cols}`);
  assert.ok(
    Math.abs(res.cellH - completo.cellH) <= completo.cellH * 0.03,
    `cellH ${res.cellH} fuera de tolerancia (el frame completo da ${completo.cellH})`,
  );
  // same cards, so the crop grid has to land on the SAME lattice as the full frame, a whole number of cells
  // away
  // out of phase, every cell name crop grabs art and the whole page is unreadable
  const esperada = ((completo.gridZone.y - cropY) % res.cellH + res.cellH) % res.cellH;
  const obtenida = (res.gridZone.y % res.cellH + res.cellH) % res.cellH;
  const desfase = Math.min(Math.abs(obtenida - esperada), res.cellH - Math.abs(obtenida - esperada));
  assert.ok(desfase <= 8, `la rejilla queda ${desfase}px fuera de fase (y=${res.gridZone.y}, cellH=${res.cellH})`);
});

// the detector anchored to the quantity BADGES instead of the names: big solid badges (70x40) pass the
// mass filter and form a PARALLEL chain at the same pitch
// longer here, since the 4th row only shows its badges
// re-anchoring folds the row profile modulo cellH and takes the arc of max mass (= names), rebuilding the
// rows on those slots

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

  // HUD: title, platinum counter, PRIME PARTS tab, icons, NAME/SEARCH
  stripe(80, 620, 45, 110, 255, 255, 255);
  stripe(1830, 2290, 70, 105, 255, 255, 255);
  stripe(90, 380, 155, 185, 230, 230, 230);
  for (let k = 0; k < 15; k++) {
    const x0 = 420 + k * 50;
    stripe(x0, x0 + 28, 200, 235, 220, 220, 220);
  }
  stripe(1300, 1560, 205, 235, 220, 220, 220);
  // right panel: blocks AT THE HEIGHT OF the row 1 BADGES (579-619) and TOTAL
  stripe(2140, 2390, 585, 615, 230, 230, 230);
  stripe(2140, 2340, 630, 660, 230, 230, 230);
  stripe(2140, 2390, 1150, 1180, 230, 230, 230);

  const lh = Math.round(cellH * 0.075); // ~22px
  for (let r = 0; r < 4; r++) { // 4 rows: the 4th (cellY=1155) only shows its badges
    for (let c = 0; c < cols; c++) {
      const cellX = gridX + c * cellW;
      const cellY = gridY + r * cellH;
      // BIG SOLID 70x40 badge at (cx+16, cy+14): mass close to a name, so the badge bands survive bandMassFloor
      solid(cellX + 16, cellX + 16 + 69, cellY + 14, cellY + 14 + 39, 247, 140, 25);
      // 1 line name at 0.78·cellH (tops 500/795/1090; the 4th row one would be at 1385 > height), 80% wide,
      // striped 3 on / 2 off
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
  // the chosen chain may be the badge one (tops 284/579/874/1169), but re-anchoring has to rebuild the rows
  // on the NAME bands (500/795/1090)
  // the 4th row with no visible name does not count
  assert.equal(res.rows, 3, `rows esperado 3, obtenido ${res.rows}`);
  assert.deepEqual(trace.rowBands, [500, 795, 1090], "las filas re-ancladas deben ser las bandas de nombres");
  // gridY anchored to the NAMES: 500 - 0.60·295 = 323, within 0.2·cellH of the real 270; anchored to the
  // badges it would be ~107
  assert.ok(
    Math.abs(res.gridZone.y - BADGY.gridY) <= 0.2 * BADGY.cellH,
    `gridZone.y ${res.gridZone.y} fuera de tolerancia (esperado ~${BADGY.gridY} ±${0.2 * BADGY.cellH})`,
  );
});

// HALF PITCH guard: when badges fall halfway between two name rows (badge at cy+40, name at cy+205 with
// cellH=330, steps of 165/165)
// the badge->name->badge chain sneaks in a cellH/2 pitch
// after re-anchoring, with >=5 rowBands and alternate row masses far apart (min < 0.6·max), the guard
// doubles cellH and keeps only the heavy parity (the names)
// the row 0 badge (top 190) is under the 0.2·1116 = 223 hudLimit, which is why the chain starts at 355

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

  // compact HUD: 17 icons at pitch 48 + NAME + SEARCH in the top strip
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
      // striped badge at (cx+14..cx+64, cy+100..cy+138): baselines 288/618/948, exactly cellH/2 = 165 from the
      // names -> half pitch chain
      if (badges) stripe(cellX + 14, cellX + 64, cellY + 100, cellY + 138, 247, 140, 25);
      // 1 line name at 0.80·cellH (cy+264, 40 tall), 80% wide, centered
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
  // the chosen chain is the half pitch one (badge->name->badge, 165px)...
  assert.deepEqual(trace.chain?.members, [288, 453, 618, 783, 948, 1113]);
  // ...and the guard has to fix it: double cellH and keep the names
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

// metallic REFLECTIONS on the card art are solid bright blocks: counting pixels they inflated the band
// masses
// and the chain found "beaten" paths with a ~0.63·cellH step mixing name, badge and art bands
// counting dark->bright TRANSITIONS the text wins (dozens of letter edges per line) and a solid block
// scores ~1 per line
// names on 2 striped lines with a real 9px gap, which mergeGapY=12 fuses into one band per row

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

  // HUD: striped title + 17 icons + NAME/SEARCH (y=206-230, under the 20% hudLimit = 278px: kept out of the
  // chain)
  stripe(80, 620, 65, 117, 255, 255, 255);
  for (let k = 0; k < 17; k++) {
    const x0 = 100 + k * 48;
    stripe(x0, x0 + 28, 206, 230, 220, 220, 220);
  }
  stripe(1090, 1310, 206, 230, 230, 230, 230);
  stripe(1420, 1600, 206, 230, 230, 230, 230);

  for (let r = 0; r < 4; r++) { // 4 rows: the 4th peeks (names at 1347, cut)
    for (let c = 0; c < cols; c++) {
      const cx = gridX + c * cellW;
      const cy = gridY + r * cellH;
      // SOLID 42x22 badge (by transitions it scores ~1 per line: negligible)
      solid(cx + 16, cx + 16 + 41, cy + 18, cy + 18 + 21, 230, 220, 180);
      // SOLID bright ART (metal reflections) in alternate cells
      if ((r + c) % 2 === 0) solid(cx + 70, cx + 200, cy + 70, cy + 165, 230, 230, 230);
      if ((r * 7 + c * 3) % 3 === 0) solid(cx + 120, cx + 180, cy + 170, cy + 205, 230, 230, 230);
      // name on 2 striped LINES: band tops 459/755/1051/1347; the 9px gap between lines (241->251) fuses with
      // mergeGapY=12
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
  // the chain has to be EXACTLY the 4 name bands, without art or badges (the ~0.63·cellH path of the
  // original bug)
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

// rows with a different number of name lines gave UNEVEN y0 steps (260 vs 306 px) and the arithmetic chain
// broke
// anchored on the band BASE (y1) the rows are evenly spaced, since names are bottom anchored on the card
test("detectInventoryGrid REGRESIÓN: filas con distinto nº de líneas (y0 desigual) detectan 3 filas (bug 2560x1440)", () => {
  const truth = { gridX: 90, gridY: 260, cellW: 277, cellH: 296, cols: 6 };
  const img = makeInventoryFrame({
    width: 2560, height: 1440, ...truth,
    // rows 0 and 1 with 2 line names, row 2 with 1: y0 shifts like it did live while the base y1 stays evenly
    // spaced
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

// scrolling down and back up, the game clamps the scroll mid row and the 1st row comes in CUT at the top,
// its name entirely inside the HUD strip (y1 < 0.2·h)
// the anti HUD filter dropped it, the chain stayed at 2 and detection returned null, falling back to a
// manual calibration that does not match the scroll
// that band is let back in when it falls exactly one pitch above the chain AND lines up in columns with
// it, two things the real HUD does not do
for (const gridY of [-60, -120, -200]) {
  test(`detectInventoryGrid REGRESIÓN: scroll clampado, 1ª fila cortada (gridY=${gridY}) no colapsa a NULL`, () => {
    const truth = { gridX: 400, gridY, cellW: 250, cellH: 290, cols: 6 };
    // 3 rows in total: with the 1st one cut only 2 full ones remain
    const img = makeInventoryFrame({ width: 1920, height: 1080, ...truth, rows: 3 });
    const trace = {};
    const res = detectInventoryGrid(img, { trace });

    assert.ok(res, `no debería devolver null (caería a la calibración manual); trace.fail = ${trace.fail}`);
    assert.equal(res.cols, 6, `cols esperado 6, obtenido ${res.cols}`);
    assert.ok(
      Math.abs(res.cellH - truth.cellH) <= truth.cellH * 0.12,
      `cellH ${res.cellH} fuera de tolerancia (~${truth.cellH})`,
    );
    assert.ok(trace.clippedTopRow, "la fila cortada por arriba debería readmitirse en la cadena");
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

// END OF THE LIST: four rows and the last one half full (3 of 6 cells)
// the "strong" columns were the ones in EVERY row, so the three on the right (in 3 of 4) were trimmed like
// the side panel and the page read as 3 columns
test("detectInventoryGrid: al final de la lista, una última fila a medias no recorta columnas reales", () => {
  const truth = { gridX: 66, gridY: 132, cellW: 277, cellH: 296, cols: 6 };
  const filled = [...Array.from({ length: 18 }, (_, i) => i), 18, 19, 20];
  const img = makeInventoryFrame({ width: 2542, height: 1387, ...truth, rows: 4, filled });
  const trace = {};
  const res = detectInventoryGrid(img, { trace });
  assert.ok(res, `sin detección; traza: ${JSON.stringify(trace)}`);
  assert.equal(res.cols, 6, `cols ${res.cols}: ${JSON.stringify(trace.occCols)} ${JSON.stringify(trace.trimmedCols)}`);
});

test("detectInventoryGrid: captura real del final de la lista de reliquias (si está)", async () => {
  const fs = await import("node:fs");
  const ruta = `${process.env.HOME}/Imágenes/Capturas de pantalla/probar/Captura de pantalla_20260913_221944.png`;
  if (!fs.existsSync(ruta)) return;
  const { decodePng } = await import("./_helpers/png.mjs");
  const trace = {};
  const res = detectInventoryGrid(decodePng(fs.readFileSync(ruta)), { trace });
  assert.ok(res);
  assert.equal(res.cols, 6, JSON.stringify(trace.trimmedCols));
  assert.equal(res.rows, 4);
});

// in the crop, rows with a wide name fuse edge to edge and only come in through the rescue
// if the chain is built only from the clean ones and those are NOT adjacent, the step doubles (592 instead
// of 296) and the grid anchors half a cell up
test("detectInventoryGrid REGRESIÓN: dos filas limpias salteadas no dan el paso doble", () => {
  const cellW = 277, cellH = 296, cols = 6, rows = 4;
  const img = makeInventoryFrame({
    width: cols * cellW, height: rows * cellH - 60, gridX: 0, gridY: 20,
    cellW, cellH, cols, rows, badges: true,
    nameWidthFrac: (r) => (r % 2 === 0 ? 0.6 : 1),
  });
  const trace = {};
  const res = detectInventoryGrid(img, { trace });
  assert.ok(res, `no debería fallar; trace.fail = ${trace.fail}`);
  assert.ok(Math.abs(res.cellH - cellH) <= cellH * 0.05,
    `cellH ${res.cellH} debería rondar ${cellH}, no el doble (cadena: ${JSON.stringify(trace.chain)})`);
});

// the page crop starts under the header and only eats the margin above the first card (~0.1·cellH): that
// row is read whole, a really cut one is not
test("detectInventoryGrid: a la 1ª fila le falta solo el margen sobre la card y se queda", () => {
  const truth = { gridX: 400, cellW: 250, cellH: 290, cols: 6 };
  const poco = detectInventoryGrid(makeInventoryFrame({ width: 1920, height: 1080, ...truth, gridY: -30, rows: 4 }));
  assert.ok(poco);
  assert.ok(poco.gridZone.y < 0 && poco.gridZone.y >= -truth.cellH * 0.15, `debería quedarse en ~-30, no ${poco.gridZone.y}`);
  const mucho = detectInventoryGrid(makeInventoryFrame({ width: 1920, height: 1080, ...truth, gridY: -100, rows: 4 }));
  assert.ok(mucho);
  assert.ok(mucho.gridZone.y > 100, `con 100 px fuera la fila se pierde y la rejilla empieza en la siguiente: ${mucho.gridZone.y}`);
});

test("detectInventoryGrid: pestaña de arcanos, el arte pesa más que los nombres y no se lleva la rejilla", () => {
  const img = decodePng(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "_fixtures/inventory_arcanes_1920x1080.png")));
  const trace = {};
  const res = detectInventoryGrid(img, { trace });
  assert.ok(res, `trace.fail = ${trace.fail}`);
  assert.equal(res.cols, 6);
  assert.ok(!res.colorAnchored, `anclada por color ${res.nameColor}`);
  assert.ok(Math.abs(res.cellW - 208) <= 3 && Math.abs(res.cellH - 222) <= 3, `celda ${res.cellW}x${res.cellH}`);
  assert.ok(Math.abs(res.gridZone.x - 67) <= 21 && Math.abs(res.gridZone.y - 182) <= 22, `origen ${res.gridZone.x},${res.gridZone.y}`);
});

test("detectInventoryGrid: en arcanos, la interfaz a la derecha de la rejilla no cuenta como columnas aunque una llegue a fuerte", () => {
  const img = decodePng(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "_fixtures/inventory_arcanes_1920x1080.png")));
  const data = new Uint8ClampedArray(img.data);
  for (const y0 of [348, 570]) for (const c of [6, 7, 8]) {
    for (let y = y0; y < y0 + 22; y++) for (let x = 108 + c * 207; x < Math.min(img.width, 228 + c * 207); x++) {
      const i = (y * img.width + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = (x >> 2) & 1 ? 240 : 20;
    }
  }
  const trace = {};
  const res = detectInventoryGrid({ width: img.width, height: img.height, data }, { trace });
  assert.ok(res, `trace.fail = ${trace.fail}`);
  assert.equal(trace.occCols.join(","), "4,4,4,4,4,4,2,3,2");
  assert.equal(res.cols, 6);
  assert.ok(Math.abs(res.gridZone.x - 67) <= 21, `origen ${res.gridZone.x}`);
});

test("detectInventoryGrid: en arcanos, si los bordes fallan, el brillo del arte no ancla la rejilla por color y la memoria la recupera", () => {
  const img = decodePng(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "_fixtures/inventory_arcanes_1920x1080.png")));
  const data = new Uint8ClampedArray(img.data);
  for (let x = 0; x < 1300; x++) {
    for (let y = 336; y < 392; y++) {
      const i = (y * img.width + x) * 4;
      data[i] = 8; data[i + 1] = 8; data[i + 2] = 16; data[i + 3] = 255;
    }
    for (let y = 990; y < img.height; y++) {
      const i = (y * img.width + x) * 4;
      data[i] = 8; data[i + 1] = 8; data[i + 2] = 16; data[i + 3] = 255;
    }
  }
  const frame = { width: img.width, height: img.height, data };
  const sinFreno = detectInventoryGrid(frame, { colorBandFracMax: 1 });
  assert.ok(sinFreno?.colorAnchored, "sin el freno el arte ancla la rejilla por color");
  const trace = {};
  const res = detectInventoryGrid(frame, { trace });
  assert.equal(res, null, "sin memoria no hay rejilla: el arte ya no la ancla");
  assert.ok(trace.colorFallback.tried.some((t) => !t.ok && t.nameBandFrac > 0.33));
  const limpia = detectInventoryGrid(img);
  const recuperada = rejillaConMemoria(res, trace, memoriaDeRejilla(limpia), frame);
  assert.ok(recuperada?.deMemoria, `ajuste ${JSON.stringify(trace.memoria)}`);
  assert.equal(recuperada.cols, 6);
  assert.equal(recuperada.gridX, limpia.gridX);
  assert.equal(recuperada.gridY, limpia.gridY);
  assert.equal(recuperada.rows, limpia.rows);
});

test("detectInventoryGrid: una columna interior casi vacía no recorta la rejilla si a su derecha hay una columna llena", () => {
  const filled = [...Array(24).keys()].filter((i) => ![10, 16, 22].includes(i));
  const trace = {};
  const res = detectInventoryGrid(makeInventoryFrame({ width: 1920, height: 1080, gridX: 100, gridY: 150, cellW: 207, cellH: 222, cols: 6, rows: 4, filled }), { trace });
  assert.ok(res, `trace.fail = ${trace.fail}`);
  assert.equal(trace.occCols.join(","), "4,4,4,4,1,4");
  assert.equal(res.cols, 6);
});
