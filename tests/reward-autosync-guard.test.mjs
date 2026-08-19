// Auto-sync de recompensas: qué se puede escribir en el inventario y qué no.
//
// Esto no es precisión de OCR, es pérdida de datos. `closeScanModal` hace
// `primeInventory[pieza] = item.owned`, y una lectura FALLIDA devolvía `owned: 0` — un número,
// así que pasaba la guarda `typeof item.owned === 'number'` y ponía a cero piezas que el
// usuario tenía guardadas. Con auto-sync activado eso pasa solo, sin confirmación.
//
// El síntoma en pantalla eran cuatro tarjetas con "0 SEEN" mientras el juego mostraba
// "3 Owned" y "Crafted".

import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const { OCRService } = await import("../deploy/js/services/scanner/ocr.service.js");

const palabras = (txt) => txt.split(" ").map((t, i) => ({ text: t, x: i * 10, y: 0 }));

test("un número junto al tag SÍ es una lectura fiable", () => {
  const m = OCRService.extractInventoryMetadata(palabras("3 OWNED"));
  assert.equal(m.owned, 3);
  assert.equal(m.ownedRead, true);
});

// El caso que borraba piezas: sin tag ni número, antes devolvía owned: 0.
test("sin tag no se inventa un 0: owned null y ownedRead false", () => {
  const m = OCRService.extractInventoryMetadata(palabras("BALLISTICA PRIME STRING"));
  assert.equal(m.ownedRead, false);
  assert.notEqual(m.owned, 0, "un 0 aquí es indistinguible de 'no tienes ninguna' y se escribía");
  assert.equal(m.owned, null);
});

test("sin palabras tampoco", () => {
  const m = OCRService.extractInventoryMetadata([]);
  assert.equal(m.ownedRead, false);
  assert.equal(m.owned, null);
});

// El juego oculta el número cuando la pieza está forjada, así que no hay nada que escribir.
test("crafted nunca cuenta como lectura del número", () => {
  const m = OCRService.extractInventoryMetadata(palabras("CRAFTED"));
  assert.equal(m.crafted, 1);
  assert.equal(m.ownedRead, false);
});

// Ver "Owned" sin su número deja pintar "al menos 1", pero escribirlo dejaría en 1 a quien
// tuviera 9. Se pinta, no se escribe.
test("el tag sin número se pinta pero no se marca como leído", () => {
  const m = OCRService.extractInventoryMetadata(palabras("OWNED"));
  assert.equal(m.owned, 1);
  assert.equal(m.ownedRead, false);
});

// La regla que protege el inventario, tal cual la aplica closeScanModal.
function sincronizar(item, guardado, seleccionado) {
  if (item.crafted) return seleccionado ? guardado + 1 : guardado;
  if (!item.ownedRead) return seleccionado ? guardado + 1 : guardado;
  return item.owned + (seleccionado ? 1 : 0);
}

test("una lectura fallida NO toca lo que ya tenías", () => {
  assert.equal(sincronizar({ owned: null, ownedRead: false }, 2, false), 2, "tenías 2, sigues con 2");
  assert.equal(sincronizar({ owned: 0, ownedRead: false }, 5, false), 5);
});

test("una lectura fiable sí manda sobre lo guardado", () => {
  assert.equal(sincronizar({ owned: 3, ownedRead: true }, 2, false), 3);
  assert.equal(sincronizar({ owned: 3, ownedRead: true }, 2, true), 4, "+1 por la que acabas de elegir");
});

test("elegir la recompensa suma aunque no se pueda leer el tag", () => {
  assert.equal(sincronizar({ owned: null, ownedRead: false }, 2, true), 3);
  assert.equal(sincronizar({ crafted: 1 }, 9, true), 10);
});
