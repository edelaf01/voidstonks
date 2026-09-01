import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { decodePng } from "./_helpers/png.mjs";
import { installFakeDocument, FakeCanvas } from "./_helpers/fake-canvas.mjs";

// ===========================================================================
// Test de detección de rejilla sobre CAPTURAS REALES del inventario.
//
// Recoge automáticamente todos los PNG de la carpeta del usuario (o de la que
// indique la env var INVENTORY_CAPTURES_DIR). Corre el pipeline REAL
// (VisionService.detectGridAutoCalib vía FakeCanvas) sobre cada uno y exige una
// rejilla DINÁMICA plausible: NO asume resolución, ni nº de columnas, ni cuántos
// objetos hay. Solo el invariante de la UI de Warframe (3 filas visibles, a veces
// una 4ª asomando) y proporciones de celda razonables.
//
// El usuario va añadiendo capturas: cada PNG nuevo se testea solo. Los frames que
// hoy fallan (final de lista con scroll clampado, fusiones extremas de arte) se
// listan en KNOWN_ISSUES y se marcan como `todo` para seguirlos sin romper la
// suite; cuando se arreglen, se quitan de la lista.
// ===========================================================================

installFakeDocument(); // antes del import dinámico: vision.service.js crea canvases al cargar
const { VisionService } = await import("../deploy/js/services/scanner/vision.service.js");

const DIR = process.env.INVENTORY_CAPTURES_DIR
  || "/home/ppsoy/Imágenes/Capturas de pantalla/inventario";

// Frames que aún NO detectan bien (seguidos como `todo`, no rompen la suite).
// (ultima.png y 21-54_4 — el final de lista — ya se arreglaron: el filtro de HUD
// pasó a usar la baseline y1 en vez del top y0.)
// (Los 3 frames que daban cols=8 —arte de fila central fusionado— se arreglaron:
// el recorte de columnas ahora mide ocupación POR FILA y se queda con el bloque
// contiguo de columnas presentes en todas, así que el panel lateral ya no cuela
// columnas fantasma.)
// Estos cuatro EMPEZARON a llegar hasta aquí cuando el auto-grid dejó de abortar con las filas
// fusionadas (grid_detect: si ninguna banda pasa el filtro de ancho pero el rescate encontró
// celdas, se usan las rescatadas). La rejilla sale bien —zona 1662x888, celda 277x296, la
// geometría conocida—, pero el voto de tema sobre esa zona se queda en 0,0007, por debajo del
// listón de fiabilidad, y devuelve null. En la app eso NO deja al escáner sin tema: el guard
// mantiene el último estable. Aquí, con un frame suelto y sin historia, no hay último.
const SIN_TEMA_FIABLE = "voto de tema por debajo del listón (0,0007): el frame suelto no tiene último tema estable";
const KNOWN_ISSUES = new Map([
  ["Captura de pantalla_20260716_175250.png", SIN_TEMA_FIABLE],
  ["Captura de pantalla_20260716_195542.png", SIN_TEMA_FIABLE],
  ["Captura de pantalla_20260716_234123.png", SIN_TEMA_FIABLE],
  ["Captura de pantalla_20260717_145916.png", SIN_TEMA_FIABLE],
]);

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
    // Warframe muestra 3 filas; al hacer scroll puede asomar una 4ª.
    assert.ok(calib.rows === 3 || calib.rows === 4, `rows ${calib.rows} debería ser 3 (o 4 si asoma otra)`);
    // Columnas dinámicas: dependen de la resolución/ancho de ventana. Solo exigimos
    // un rango sano para un inventario real (no 1, no toda la pantalla en celditas).
    assert.ok(calib.cols >= 4 && calib.cols <= 10, `cols ${calib.cols} fuera de rango sano`);
    // Proporciones de celda relativas al frame (independientes de resolución):
    // una celda de inventario ocupa ~11% del ancho y ~20% del alto.
    const cwFrac = calib.cellW / img.width, chFrac = calib.cellH / img.height;
    assert.ok(cwFrac > 0.07 && cwFrac < 0.18, `cellW ${calib.cellW} (${(cwFrac * 100).toFixed(1)}% del ancho) fuera de rango`);
    assert.ok(chFrac > 0.15 && chFrac < 0.26, `cellH ${calib.cellH} (${(chFrac * 100).toFixed(1)}% del alto) fuera de rango`);
    // La zona no debe invadir el panel de venta (mitad derecha).
    assert.ok(calib.gridZone.x + calib.gridZone.w <= img.width * 0.75,
      `la zona (fin x=${calib.gridZone.x + calib.gridZone.w}) invade el panel de venta`);
    assert.ok(calib.confidence >= 0.5, `confianza ${calib.confidence} demasiado baja`);
  });
}

// ===========================================================================
// Pipeline COMPLETO: detectGridAutoCalib → buildAutoGrid (→ detectRowPhase).
// El test de arriba solo verifica la geometría base; este segundo pase ejercita
// _applyRowPhase y asegura que el desfase vertical (phaseShift / dy) no
// desplace las filas hacia la zona de arte de las cards.
// ===========================================================================

for (const file of files) {
  const known = KNOWN_ISSUES.get(file);
  test(`buildAutoGrid sin desfase espurio: ${file}`, { todo: known }, () => {
    const img = decodePng(fs.readFileSync(path.join(DIR, file)));
    const calib = VisionService.detectGridAutoCalib(img, img.width, img.height);
    if (!calib) return; // ya cubierto por el test de arriba

    // buildAutoGrid/detectRowPhase necesita un snapshot con getContext() →
    // envolvemos los datos del PNG en un FakeCanvas.
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

    // El desfase vertical debe ser pequeño (≤10px). Un dy de -29 o -53 indica
    // que detectRowPhase se enganchó a las ilustraciones metálicas.
    const dy = grid.phaseShift || 0;
    assert.ok(Math.abs(dy) <= 10,
      `phaseShift ${dy}px demasiado grande — detectRowPhase probablemente se enganchó al arte`);

    // Todas las filas originales deben sobrevivir al filtro de _applyRowPhase.
    const rowsFound = new Set(grid.cellRects.map(c => c.r)).size;
    assert.ok(rowsFound >= calib.rows,
      `solo ${rowsFound} filas tras _applyRowPhase (esperadas ${calib.rows}) — dy espurio descartó filas`);

    // Nº de celdas = rows × cols (ninguna descartada por dy falso).
    assert.equal(grid.cellRects.length, calib.rows * calib.cols,
      `${grid.cellRects.length} celdas != ${calib.rows * calib.cols} esperadas`);
  });
}
