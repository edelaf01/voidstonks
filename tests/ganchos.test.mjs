import { test } from "node:test";
import assert from "node:assert/strict";

const { avisa, escucha, pistasDelLog } = await import("../deploy/js/utils/ganchos.js");

test("sin nadie escuchando, avisar no hace nada", () => {
  assert.doesNotThrow(() => avisa("nadie-escucha", { x: 1 }));
});

test("cada oyente recibe los avisos de su tema y deja de recibirlos al soltarlo", () => {
  const recibidos = [];
  const suelta = escucha("kiosko", (d) => recibidos.push(["a", d]));
  escucha("riven", (d) => recibidos.push(["riven", d]));
  avisa("kiosko", 1);
  suelta();
  avisa("kiosko", 2);
  avisa("riven", null);
  assert.deepEqual(recibidos, [["a", 1], ["riven", null]]);
});

test("un oyente que falla no impide que avisen los demás", () => {
  const avisos = [];
  const avisoOriginal = console.warn;
  console.warn = () => {};
  try {
    escucha("contexto", () => { throw new Error("roto"); });
    escucha("contexto", (c) => avisos.push(c));
    avisa("contexto", "REWARD");
  } finally {
    console.warn = avisoOriginal;
  }
  assert.deepEqual(avisos, ["REWARD"]);
});

test("en la web, sin escritorio, las pistas del log no dicen nada", () => {
  assert.equal(pistasDelLog.duerme({}), false);
  assert.equal(pistasDelLog.firma(), null);
  assert.equal(pistasDelLog.tarjetas(), null);
  assert.equal(pistasDelLog.armaRiven(), null);
  assert.equal(pistasDelLog.reliquiaPorGastar(), null);
  assert.equal(pistasDelLog.enMision(), null);
});
