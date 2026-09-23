// Las marcas ✓ como ancla de fase de la rejilla: se encuentran donde están, no donde no están, y
// con tres de acuerdo fijan dónde empiezan filas y columnas.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PLANTILLA_CHECK, CHECK_OFFSET, buscaChecks, faseDesdeChecks, picosCheck, reduceMax, ventanasDeFilas } from "../deploy/js/utils/vision/check_anchor.js";

/** Zona sintética: fondo oscuro con ruido suave y ✓ (la plantilla ampliada ×2) en las celdas pedidas. */
function zona({ w = 900, h = 700, cellW = 277, cellH = 296, gridX = 40, gridY = 25, celdas = [] }) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { const v = 20 + ((i * 7919) % 11); data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v; data[i * 4 + 3] = 255; }
  for (const [r, c] of celdas) {
    const cx = gridX + c * cellW + CHECK_OFFSET.x * cellW, cy = gridY + r * cellH + CHECK_OFFSET.y * cellH;
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      const v = 20 + parseInt(PLANTILLA_CHECK[(y >> 1) * 16 + (x >> 1)], 16) * 13;
      const px = Math.round(cx - 16 + x), py = Math.round(cy - 16 + y);
      if (px < 0 || py < 0 || px >= w || py >= h) continue;
      const i = (py * w + px) * 4; data[i] = data[i + 1] = v; data[i + 2] = Math.round(v * 0.6); // dorado
    }
  }
  return { width: w, height: h, data };
}

test("encuentra las marcas donde están y ninguna donde no hay", () => {
  const celdas = [[0, 0], [0, 2], [1, 1], [2, 0], [2, 2]];
  const picos = buscaChecks(zona({ celdas }), 296);
  assert.equal(picos.length, celdas.length, JSON.stringify(picos));
  for (const [r, c] of celdas) {
    const cx = 40 + c * 277 + CHECK_OFFSET.x * 277, cy = 25 + r * 296 + CHECK_OFFSET.y * 296;
    assert.ok(picos.some((p) => Math.abs(p.x - cx) <= 4 && Math.abs(p.y - cy) <= 4), `falta r${r}c${c}`);
  }
  assert.equal(buscaChecks(zona({ celdas: [] }), 296).length, 0, "sin marcas no hay picos");
});

test("con tres marcas de acuerdo sale la fase; con dos, no", () => {
  const picos = buscaChecks(zona({ celdas: [[0, 0], [1, 1], [2, 2], [0, 2]], gridX: 61, gridY: 33 }), 296);
  const f = faseDesdeChecks(picos, { cellW: 277, cellH: 296 });
  assert.ok(f, "hay fase");
  assert.ok(Math.abs(f.gridX - 61) <= 4 && Math.abs(f.gridY - 33) <= 4, JSON.stringify(f));
  assert.equal(faseDesdeChecks(picos.slice(0, 2), { cellW: 277, cellH: 296 }), null);
  assert.equal(faseDesdeChecks([], { cellW: 277, cellH: 296 }), null);
});

test("una marca fuera de sitio no arrastra la fase de las demás", () => {
  const picos = [...buscaChecks(zona({ celdas: [[0, 0], [1, 0], [2, 1], [1, 2]] }), 296), { x: 500, y: 333, score: 0.9 }];
  const f = faseDesdeChecks(picos, { cellW: 277, cellH: 296 });
  assert.ok(Math.abs(f.gridX - 40) <= 4 && Math.abs(f.gridY - 25) <= 4, JSON.stringify(f));
});

test("reduceMax reduce por bloques con el canal máximo", () => {
  const img = { width: 4, height: 2, data: new Uint8ClampedArray([10, 0, 0, 255, 0, 30, 0, 255, 0, 0, 50, 255, 70, 0, 0, 255, 10, 0, 0, 255, 0, 30, 0, 255, 0, 0, 50, 255, 70, 0, 0, 255]) };
  const r = reduceMax(img, 2);
  assert.deepEqual([r.w, r.h], [2, 1]);
  assert.deepEqual(Array.from(r.data), [20, 60]);
  assert.equal(picosCheck(r).length, 0);
});

// --- Páginas reales (fuera del repo; sin ellas se salta) ---------------------------------------
// Sobre las páginas grabadas, la fase por ✓ tiene que coincidir con la rejilla que dio grid_detect
// (que en esas páginas leyó 18/18): si difieren, una de las dos está mal, y hay que mirar cuál.
const DEBUG = process.env.DEBUG_OCR_DIR || "/var/home/ppsoy/Descargas/OCR/DEBUG/voidstonks-debug-2026-09-20-11-10";
for (const pagina of ["003-inventario", "020-inventario", "036-inventario"]) {
  const dir = path.join(DEBUG, pagina);
  const falta = !fs.existsSync(path.join(dir, "frame.png")) && `sin ${pagina}`;
  test(`página grabada ${pagina}: la fase por ✓ coincide con la rejilla leída`, { skip: falta }, async () => {
    const { decodePng } = await import("./_helpers/png.mjs");
    const { installFakeDocument, FakeCanvas } = await import("./_helpers/fake-canvas.mjs");
    installFakeDocument();
    const { VisionService } = await import("../deploy/js/services/scanner/vision.service.js");
    const meta = JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf8"));
    let img = decodePng(fs.readFileSync(path.join(dir, "frame.png")));
    const snap = new FakeCanvas(img.width, img.height); snap.getContext("2d").putImageData(img, 0, 0); img = null;
    const { cellW, cellH, zone } = meta.rejilla;
    const c00 = meta.celdas.find((c) => c.r === 0 && c.c === 0);
    const calib = { cellW, cellH, gridX: c00.sx, gridY: c00.sy };
    const zona = { x: 0, y: 0, w: snap.width, h: snap.height };
    void zone;
    const ancla = VisionService.anclaPorChecks(snap, zona, calib);
    assert.ok(ancla, "hay marcas suficientes");
    assert.ok(Math.abs(ancla.gridX - c00.sx) <= 6 && Math.abs(ancla.gridY - c00.sy) <= 6, `ancla ${JSON.stringify(ancla)} vs rejilla ${c00.sx},${c00.sy}`);
  });
}

test("con rejilla propuesta solo se barren las franjas de sus filas, y el resultado es el mismo", () => {
  const celdas = [[0, 0], [1, 1], [2, 2], [0, 2]];
  const img = zona({ celdas, gridY: 25 });
  const ventanas = ventanasDeFilas({ gridY: 25, cellH: 296, rows: 3 }, 0);
  assert.equal(ventanas.length, 4, "una fila extra por si asoma");
  const conVentanas = buscaChecks(img, 296, { ventanasY: ventanas });
  assert.equal(conVentanas.length, celdas.length);
  // Franjas que no pasan por ningún ✓: nada.
  assert.equal(buscaChecks(img, 296, { ventanasY: [[400, 420]] }).length, 0);
  assert.equal(ventanasDeFilas({ gridY: NaN, cellH: 296 }), null);
});
