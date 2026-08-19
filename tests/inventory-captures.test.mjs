import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { decodePng } from "./_helpers/png.mjs";
import { installFakeDocument, FakeCanvas } from "./_helpers/fake-canvas.mjs";

installFakeDocument();
const { VisionService } = await import("../deploy/js/services/scanner/vision.service.js");

const DIR = process.env.INVENTORY_CAPTURES_DIR
  || "/home/ppsoy/Imágenes/Capturas de pantalla/inventario";

const KNOWN_ISSUES = new Map([]);

function listCaptures() {
  if (!fs.existsSync(DIR)) return [];
  return fs.readdirSync(DIR).filter(f => f.toLowerCase().endsWith(".png")).sort();
}

const files = listCaptures();

test("hay capturas de inventario que testear", { skip: files.length === 0 && `sin capturas en ${DIR}` }, () => {
  assert.ok(files.length > 0);
});

for (const file of files) {
  const known = KNOWN_ISSUES.get(file);
  test(`detecta rejilla dinámica: ${file}`, { todo: known }, () => {
    const img = decodePng(fs.readFileSync(path.join(DIR, file)));
    const calib = VisionService.detectGridAutoCalib(img, img.width, img.height);

    assert.ok(calib, "detectGridAutoCalib no debería devolver null");
    assert.ok(calib.rows === 3 || calib.rows === 4, `rows ${calib.rows} debería ser 3 (o 4 si asoma otra)`);
    assert.ok(calib.cols >= 4 && calib.cols <= 10, `cols ${calib.cols} fuera de rango sano`);
    const cwFrac = calib.cellW / img.width, chFrac = calib.cellH / img.height;
    assert.ok(cwFrac > 0.07 && cwFrac < 0.18, `cellW ${calib.cellW} (${(cwFrac * 100).toFixed(1)}% del ancho) fuera de rango`);
    assert.ok(chFrac > 0.15 && chFrac < 0.26, `cellH ${calib.cellH} (${(chFrac * 100).toFixed(1)}% del alto) fuera de rango`);
    assert.ok(calib.gridZone.x + calib.gridZone.w <= img.width * 0.75,
      `la zona (fin x=${calib.gridZone.x + calib.gridZone.w}) invade el panel de venta`);
    assert.ok(calib.confidence >= 0.5, `confianza ${calib.confidence} demasiado baja`);
  });
}

for (const file of files) {
  const known = KNOWN_ISSUES.get(file);
  test(`buildAutoGrid sin desfase espurio: ${file}`, { todo: known }, () => {
    const img = decodePng(fs.readFileSync(path.join(DIR, file)));
    const calib = VisionService.detectGridAutoCalib(img, img.width, img.height);
    if (!calib) return;

    const snapshot = new FakeCanvas();
    snapshot.width = img.width;
    snapshot.height = img.height;
    snapshot.getContext("2d").drawImage(img, 0, 0);

    const theme = VisionService.detectThemeFromSnapshot(
      snapshot, calib.gridZone.x, calib.gridZone.y, calib.gridZone.w, calib.gridZone.h
    );
    assert.ok(theme, "detectThemeFromSnapshot no debería devolver null");

    const grid = VisionService.buildAutoGrid(snapshot, calib.gridZone, theme, calib);
    assert.ok(grid, "buildAutoGrid no debería devolver null");

    const dy = grid.phaseShift || 0;
    assert.ok(Math.abs(dy) <= 10,
      `phaseShift ${dy}px demasiado grande — detectRowPhase probablemente se enganchó al arte`);

    const rowsFound = new Set(grid.cellRects.map(c => c.r)).size;
    assert.ok(rowsFound >= calib.rows,
      `solo ${rowsFound} filas tras _applyRowPhase (esperadas ${calib.rows}) — dy espurio descartó filas`);

    assert.equal(grid.cellRects.length, calib.rows * calib.cols,
      `${grid.cellRects.length} celdas != ${calib.rows * calib.cols} esperadas`);
  });
}
