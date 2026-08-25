import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  isPauseScreen, refinementOf, groupWordCells, parseSquadRelics,
  SQUAD_STRIP_CROP, PAUSE_MENU_CROP,
} from "../deploy/js/utils/vision/squad_panel.js";

globalThis.document ??= { createElement: () => ({ getContext: () => null }) };
const { OCRService } = await import("../deploy/js/services/scanner/ocr.service.js");
const { state } = await import("../deploy/js/state.js");

// ===========================================================================
// Lectura del panel de escuadra de la pantalla de pausa.
//
// El caso principal NO es sintético: son las 109 cajas de palabra que devolvió
// tesseract sobre la captura real del usuario (ver `_source` del fixture), con
// su fila de nombres ilegible incluida. Así el test cubre lo que de verdad
// rompe —el OCR mezclando las cuatro columnas en una sola línea— y no una
// versión limpia que nunca se da en vivo.
// ===========================================================================

const FIXTURE = JSON.parse(
  readFileSync(new URL("./_fixtures/squad-panel-words.json", import.meta.url), "utf8"),
);

// El catálogo real que consulta getRelicMatch. Con las cuatro de la captura basta
// para que el matcher tenga que elegir entre códigos parecidos (A12 vs A15).
state.allRelicNames = [
  "Neo N12", "Neo V11", "Neo A15", "Neo A12", "Neo A11", "Neo N11",
  "Lith N12", "Meso V11", "Axi A15",
];
const matchRelic = (words) => OCRService.getRelicMatch(words);

describe("recortes", () => {
  test("la franja del squad no llega a los contadores de la esquina derecha", () => {
    // Platino, ducados y el resto del HUD superior viven a partir de ~0.78 del ancho:
    // meterlos en el recorte solo añade dígitos sueltos que el matcher tiene que descartar.
    assert.equal(SQUAD_STRIP_CROP.x, 0);
    assert.ok(SQUAD_STRIP_CROP.x + SQUAD_STRIP_CROP.w <= 0.75);
  });

  test("el menú se lee por debajo de las filas de equipamiento", () => {
    assert.ok(PAUSE_MENU_CROP.y >= 0.20);
  });
});

describe("ancla de pantalla de pausa", () => {
  test("el menú de misión engancha", () => {
    assert.equal(isPauseScreen("RESUME\nCHALLENGES\nABILITIES\nABORT MISSION"), true);
    assert.equal(isPauseScreen("REANUDAR\nDESAFÍOS\nABORTAR MISIÓN"), true);
  });

  test("el menú del Orbiter NO engancha: no hay run del que leer reliquias", () => {
    assert.equal(isPauseScreen("PROFILE\nOPTIONS\nCOMMUNICATION\nEXIT"), false);
    assert.equal(isPauseScreen("PERFIL\nOPCIONES\nSALIR"), false);
  });

  test("texto vacío o basura no engancha", () => {
    assert.equal(isPauseScreen(""), false);
    assert.equal(isPauseScreen(null), false);
    assert.equal(isPauseScreen("go TC (ims sovo Mesh"), false);
  });
});

describe("refinamiento", () => {
  test("lee los cuatro, en los dos idiomas y con paréntesis", () => {
    assert.equal(refinementOf("(Intact)"), "intact");
    assert.equal(refinementOf("(Exceptional)"), "exceptional");
    assert.equal(refinementOf("(Flawless)"), "flawless");
    assert.equal(refinementOf("(Radiant)"), "radiant");
    assert.equal(refinementOf("(Radiante)"), "radiant");
    assert.equal(refinementOf("(Impecable)"), "flawless");
  });

  test("lo que no es un refinamiento devuelve null", () => {
    assert.equal(refinementOf("Relic"), null);
    assert.equal(refinementOf("[30]"), null);
    assert.equal(refinementOf(""), null);
  });
});

describe("celdas por columna", () => {
  test("la fila de reliquias se parte en cuatro celdas, una por jugador", () => {
    const cells = groupWordCells(FIXTURE.words)
      .filter((c) => c.words.some((w) => /Relic/i.test(w)));
    assert.equal(cells.length, 4);
    assert.deepEqual(cells[0].words, ["Neo", "N12", "Relic", "(Radiant)"]);
    assert.deepEqual(cells[3].words, ["Neo", "A12", "Relic", "(Radiant)"]);
  });

  test("ninguna celda mezcla dos columnas", () => {
    // El hueco entre columnas de la captura es 81 px y el mayor hueco DENTRO de una
    // celda es 35: si el corte se fuera de sitio, aparecerían celdas con dos "Relic".
    for (const cell of groupWordCells(FIXTURE.words)) {
      const relics = cell.words.filter((w) => /^Relic$/i.test(w)).length;
      assert.ok(relics <= 1, `celda con ${relics} reliquias: ${cell.words.join(" ")}`);
    }
  });
});

describe("parseSquadRelics sobre la captura real", () => {
  const relics = parseSquadRelics(FIXTURE.words, { matchRelic });

  test("saca las cuatro reliquias con su refinamiento, en orden de izquierda a derecha", () => {
    assert.deepEqual(
      relics.map((r) => `${r.name} ${r.refinement}`),
      ["Neo N12 radiant", "Neo V11 intact", "Neo A15 intact", "Neo A12 radiant"],
    );
  });

  test("no cuela nada del resto del panel", () => {
    // Warframes, auras, armas y la fila de nombres ilegible comparten la franja.
    assert.equal(relics.length, 4);
  });
});

describe("parseSquadRelics: casos que no están en la captura", () => {
  const cell = (words, x) => words.map((text, i) => ({
    text, x0: x + i * 70, x1: x + i * 70 + 52, y0: 200, y1: 225,
  }));

  test("una escuadra a medias devuelve solo las reliquias que hay", () => {
    const words = [...cell(["Neo", "N12", "Relic", "(Intact)"], 100),
                   ...cell(["Volt", "Prime", "[30]"], 900)];
    assert.deepEqual(parseSquadRelics(words, { matchRelic }).map((r) => r.name), ["Neo N12"]);
  });

  test("sin la palabra Relic no se acepta: el panel también lista armas", () => {
    const words = cell(["Neo", "N12", "[30]"], 100);
    assert.deepEqual(parseSquadRelics(words, { matchRelic }), []);
  });

  test("sin paréntesis legible el refinamiento queda en null, no inventado", () => {
    const words = cell(["Neo", "N12", "Relic"], 100);
    assert.deepEqual(parseSquadRelics(words, { matchRelic }), [{ name: "Neo N12", refinement: null, x0: 100 }]);
  });

  test("sin palabras, sin matcher o con basura no revienta", () => {
    assert.deepEqual(parseSquadRelics([], { matchRelic }), []);
    assert.deepEqual(parseSquadRelics(null, { matchRelic }), []);
    assert.deepEqual(parseSquadRelics(FIXTURE.words, {}), []);
    assert.deepEqual(groupWordCells(null), []);
  });
});
