import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.document ??= { createElement: () => ({ getContext: () => null }) };

const { OCRService } = await import("../deploy/js/services/scanner/ocr.service.js");
const { state } = await import("../deploy/js/state.js");
const { catalogoPrime, comoItemsDatabase } = await import("./_helpers/prime-catalog.mjs");

const nombres = catalogoPrime();
state.itemsDatabase = comoItemsDatabase(nombres);
OCRService.cachedDbItems = [];
OCRService.initMatcherData();

const casa = (texto) => OCRService.getValidItemMatch(texto)?.originalName ?? null;
const primes = nombres.filter((n) => / Prime /.test(n));

function barrido(degradar, excepciones = new Set()) {
  const fallos = [];
  for (const n of primes) {
    if (excepciones.has(n)) continue;
    const texto = degradar(n.toUpperCase());
    if (texto === n.toUpperCase() && degradar !== IGUAL) continue;
    const got = casa(texto);
    if (got !== n) fallos.push(`${texto} -> ${got}`);
  }
  return fallos;
}
const IGUAL = (u) => u;
const DOS_LETRAS = new Set(primes.filter((n) => n.split(" ")[0].length <= 2));
const AKLEX_RARO = new Set(["Aklex Prime Lex Prime"]);

test("un warframe se identifica pieza a pieza: plano, chasis, neuróptica, sistemas", () => {
  assert.equal(casa("ATLAS PRIME BLUEPRINT"), "Atlas Prime Blueprint");
  assert.equal(casa("ATLAS PRIME CHASSIS BLUEPRINT"), "Atlas Prime Chassis Blueprint");
  assert.equal(casa("ATLAS PRIME NEUROPTICS BLUEPRINT"), "Atlas Prime Neuroptics Blueprint");
  assert.equal(casa("ATLAS PRIME SYSTEMS BLUEPRINT"), "Atlas Prime Systems Blueprint");
  assert.equal(casa("ATLAS PRIME CHASSIS"), "Atlas Prime Chassis Blueprint");
  assert.equal(casa("ATLAS PRIME SYSTEMS BLUEPR"), "Atlas Prime Systems Blueprint");
});

test("un arma se identifica pieza a pieza: plano frente a cañón, receptor, culata", () => {
  assert.equal(casa("ACCELTRA PRIME BLUEPRINT"), "Acceltra Prime Blueprint");
  assert.equal(casa("ACCELTRA PRIME BARREL"), "Acceltra Prime Barrel");
  assert.equal(casa("ACCELTRA PRIME RECEIVER"), "Acceltra Prime Receiver");
  assert.equal(casa("ACCELTRA PRIME STOCK"), "Acceltra Prime Stock");
  assert.equal(casa("ACCELTRA PRIME BARRE"), "Acceltra Prime Barrel");
});

test("solo el nombre del prime no identifica ninguna pieza: null, no la primera que cuadre", () => {
  assert.equal(casa("ATLAS PRIME"), null);
  assert.equal(casa("ACCELTRA PRIME"), null);
  assert.equal(casa("ATLAS"), null);
});

test("todas las piezas del catálogo se reconocen leídas tal cual", () => {
  assert.deepEqual(barrido(IGUAL), []);
});

test("PRIME mal leído (PFIME) no cambia la pieza", () => {
  assert.deepEqual(barrido((u) => u.replace("PRIME", "PFIME")), []);
});

test("PRIME pegado a la siguiente palabra, bien o mal leído, no cambia la pieza", () => {
  assert.deepEqual(barrido((u) => u.replace("PRIME ", "PRIME")), []);
  assert.deepEqual(barrido((u) => u.replace("PRIME ", "PFIME"), AKLEX_RARO), []);
});

test("el nombre pegado a PRIME (ASHPRIME, LEXPRIME) no cambia la pieza", () => {
  assert.deepEqual(barrido((u) => u.replace(" PRIME", "PRIME"), DOS_LETRAS), []);
});

test("perder la última letra o confundir I con L no cambia la pieza", () => {
  assert.deepEqual(barrido((u) => u.slice(0, -1)), []);
  assert.deepEqual(barrido((u) => u.replaceAll("I", "L")), []);
});

test("la O por cero no cambia la pieza: SAR0FANG sigue siendo Sarofang, no Fang", () => {
  const fallos = barrido((u) => u.replaceAll("O", "0"), new Set([...DOS_LETRAS, "Kogake Prime Boot"]));
  assert.deepEqual(fallos, []);
  assert.equal(casa("SAR0FANG PRIME BLADE"), "Sarofang Prime Blade");
});

test("un componente con el nombre del prime ilegible no se convierte en otra pieza", () => {
  // "CHASSIS" looks like "QUASSUS" (0.7): without this guard it came in as Quassus Prime Blueprint
  assert.equal(casa("XXQZ PRIME CHASSIS BLUEPRINT"), null);
  assert.equal(casa("PRIME CHASSIS BLUEPRINT"), null);
  assert.equal(casa("BLUEPRINT"), null);
});

test("un riven o un rótulo ajeno no casan con ninguna pieza", () => {
  assert.equal(casa("RIFLE RIVEN MOD"), null);
  assert.equal(casa("VULKAR CRITACAN"), null);
});
