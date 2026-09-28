// Catálogo de rótulos por resolución (services/scanner/title_signatures.service.js): qué se aprende,
// dónde se guarda y que vuelva al recargar.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { installFakeDocument } from "./_helpers/fake-canvas.mjs";

installFakeDocument();
const almacen = new Map();
globalThis.localStorage = { getItem: (k) => almacen.get(k) ?? null, setItem: (k, v) => almacen.set(k, String(v)), removeItem: (k) => almacen.delete(k) };

const { FirmasTitulo } = await import("../deploy/js/services/scanner/title_signatures.service.js");
const { conRotulo } = await import("./_helpers/rotulo.mjs");

beforeEach(() => { almacen.clear(); FirmasTitulo._clave = null; FirmasTitulo._catalogo = null; });

test("un rótulo aprendido se reconoce, también tras recargar la página", () => {
  FirmasTitulo.aprende(conRotulo(3), "VOID FISSURE/REWARDS", "REWARD");
  assert.equal(FirmasTitulo.reconoce(conRotulo(3))?.contexto, "REWARD");
  FirmasTitulo._clave = null;
  assert.equal(FirmasTitulo.reconoce(conRotulo(3))?.texto, "VOID FISSURE/REWARDS", "cargado de localStorage");
  assert.equal(FirmasTitulo.reconoce(conRotulo(7)), null, "otro rótulo");
});

test("cada resolución tiene su propio catálogo", () => {
  FirmasTitulo.aprende(conRotulo(3), "VOID FISSURE/REWARDS", "REWARD");
  assert.deepEqual([...almacen.keys()], ["vs_titulos_v1_640x360"]);
  assert.equal(FirmasTitulo.reconoce(conRotulo(3, { W: 800, H: 450 })), null);
});

test("no aprende de pantallas sin rótulo ni de textos que no son un rótulo", () => {
  FirmasTitulo.aprende(conRotulo(3), "AstilModulaionay | Narin[30]", "INVENTORY_MODS");
  FirmasTitulo.aprende(conRotulo(4), "MISSION COMPLETE/X", "MISSION_COMPLETE");
  FirmasTitulo.aprende(conRotulo(5), "VOID FISSURE/REWARDS", "REWARD");
  assert.equal(FirmasTitulo.reconoce(conRotulo(3)), null, "la pausa con AstralModulation en la escuadra");
  assert.equal(FirmasTitulo.reconoce(conRotulo(4)), null, "fin de misión: el título va centrado, no en la franja");
  assert.equal(FirmasTitulo.reconoce(conRotulo(5))?.contexto, "REWARD");
});

test("sin vídeo no revienta", () => {
  assert.equal(FirmasTitulo.reconoce(null), null);
  assert.equal(FirmasTitulo.reconoce({ videoWidth: 0 }), null);
  FirmasTitulo.aprende(null, "VOID FISSURE/REWARDS", "REWARD");
  assert.equal(almacen.size, 0);
});
