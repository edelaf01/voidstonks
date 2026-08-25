import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { installFakeDocument } from "./_helpers/fake-canvas.mjs";

installFakeDocument();
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const { ScannerService: S } = await import("../deploy/js/services/scanner/scanner.service.js");

const riven = (o = {}) => ({
  weaponName: "Braton", rolls: 3,
  stats: [
    { name: "Crit Damage", value: 120, isPositive: true },
    { name: "Multishot", value: 80, isPositive: true },
    { name: "Zoom", value: 40, isPositive: false },
  ],
  ...o,
});

test("la cantidad de consenso es la más votada, no la última leída", () => {
  const votos = new Map(), destino = new Map();
  for (const q of [9, 9, 8, 9, 91]) {
    S.recordQtyVote("Braton Prime Blueprint", { qty: q, raw: String(q) }, votos, destino);
  }
  assert.equal(destino.get("Braton Prime Blueprint"), 9);
});

test("con empate gana la cantidad mayor", () => {
  const votos = new Map(), destino = new Map();
  S.recordQtyVote("X", { qty: 3, raw: "3" }, votos, destino);
  S.recordQtyVote("X", { qty: 31, raw: "31" }, votos, destino);
  assert.equal(destino.get("X"), 31);
});

test("una lectura sin dígitos no vota, pero se enseña si no hay nada mejor", () => {
  const votos = new Map(), destino = new Map();
  S.recordQtyVote("X", { qty: 1, raw: "" }, votos, destino);
  assert.equal(destino.get("X"), 1, "sin votos válidos se usa la lectura actual");

  S.recordQtyVote("X", { qty: 7, raw: "7" }, votos, destino);
  S.recordQtyVote("X", { qty: 99, raw: "" }, votos, destino);
  assert.equal(destino.get("X"), 7, "el voto válido manda sobre la lectura sin dígitos");
});

test("cada ítem lleva su propia votación", () => {
  const votos = new Map(), destino = new Map();
  S.recordQtyVote("A", { qty: 2, raw: "2" }, votos, destino);
  S.recordQtyVote("B", { qty: 5, raw: "5" }, votos, destino);
  assert.equal(destino.get("A"), 2);
  assert.equal(destino.get("B"), 5);
});

test("sin votos, modeQty devuelve null en vez de un cero engañoso", () => {
  assert.equal(S.modeQty(new Map()), null);
});

test("dos lecturas idénticas son la misma carta", () => {
  assert.equal(S._isSameRiven(riven(), riven()), true);
  assert.equal(S._isSameRiven(null, null), true);
  assert.equal(S._isSameRiven(riven(), null), false);
});

test("una diferencia de valor no convierte la carta en otra", () => {
  const a = riven();
  const b = riven({ stats: a.stats.map((s) => ({ ...s, value: s.value + 0.3 })) });
  assert.equal(S._isSameRiven(a, b), true);
});

test("otro arma, otros ciclos u otro stat sí son otra carta", () => {
  assert.equal(S._isSameRiven(riven(), riven({ weaponName: "Ignis" })), false);
  assert.equal(S._isSameRiven(riven(), riven({ rolls: 4 })), false);
  assert.equal(S._isSameRiven(riven(), riven({ stats: riven().stats.slice(0, 2) })), false);
});

test("perder un stat no rompe la identidad laxa: permite fusionar la lectura", () => {
  const completa = riven();
  const sinCurse = riven({ stats: completa.stats.slice(0, 2) });
  assert.equal(S._isSameRiven(completa, sinCurse), false, "la estricta sí las distingue");
  assert.equal(S._isSameRivenIdentity(completa, sinCurse), true);
});

test("un contador de ciclos ausente no rompe la identidad laxa", () => {
  assert.equal(S._isSameRivenIdentity(riven(), riven({ rolls: null })), true);
  assert.equal(S._isSameRivenIdentity(riven(), riven({ rolls: 9 })), false,
    "pero dos contadores distintos sí");
});

test("un roll nuevo con el mismo arma y contador no se fusiona con el viejo", () => {
  const viejo = riven();
  const nuevo = riven({
    stats: [
      { name: "Fire Rate / Attack Speed", value: 50, isPositive: true },
      { name: "Ammo Maximum", value: 60, isPositive: true },
      { name: "Recoil", value: 30, isPositive: false },
    ],
  });
  assert.equal(S._isSameRivenIdentity(viejo, nuevo), false);
});

test("una lectura sin arma no pisa a una que sí la tiene", () => {
  assert.equal(S._isBetterOrEqualRead(riven({ weaponName: null }), riven()), false);
  assert.equal(S._isBetterOrEqualRead(riven(), riven({ weaponName: null })), true);
});

test("perder el contador de ciclos tampoco justifica sustituir la lectura", () => {
  assert.equal(S._isBetterOrEqualRead(riven({ rolls: null }), riven()), false);
});

test("sin lectura previa, cualquiera vale; sin lectura nueva, no se sustituye", () => {
  assert.equal(S._isBetterOrEqualRead(riven(), null), true);
  assert.equal(S._isBetterOrEqualRead(null, riven()), false);
});

test("los fragmentos de una letra delatan el ruido del arte", () => {
  assert.equal(S._isGarbledCellText(["BRATON", "PRIME"]), false);
  assert.equal(S._isGarbledCellText(["AL", "4", "BRATON"]), false, "un solo fragmento se tolera");
  assert.equal(S._isGarbledCellText(["A", "L", "4", "X"]), true);
});

test("demasiadas palabras en una celda también son ruido", () => {
  assert.equal(S._isGarbledCellText("uno dos tres cuatro cinco seis siete ocho nueve".split(" ")), true);
});

test("una celda vacía no se marca como ruido", () => {
  assert.equal(S._isGarbledCellText([]), false);
  assert.equal(S._isGarbledCellText(null), false);
});

test("una celda de riven se reconoce por su nombre o por su categoría", () => {
  assert.equal(S._isRivenCellText(["RIVEN", "MOD"]), true);
  assert.equal(S._isRivenCellText(["RIFLE", "MOD"]), true);
  assert.equal(S._isRivenCellText(["MELEE", "MOD"]), true);
  assert.equal(S._isRivenCellText(["BRATON", "PRIME", "BLUEPRINT"]), false);
  assert.equal(S._isRivenCellText(["MOD"]), false, "'MOD' a secas no basta");
});

const SRC = readFileSync(new URL("../deploy/js/services/scanner/scanner.service.js", import.meta.url), "utf8");

// browsers decode each <img> even with display:none: rebuilding 10 thumbnails per page cost 1.9 GB
test("la imagen del historial de debug no se genera con el panel cerrado", () => {
  const i = SRC.indexOf("this.debugHistory.unshift(");
  assert.notEqual(i, -1, "falta el historial de debug");
  const bloque = SRC.slice(i - 800, i + 400);

  assert.match(bloque, /img:\s*ScannerHUD\.isDebugOpen\(\) \?/,
    "el toDataURL solo puede hacerse con el panel abierto");
});

test("con el panel cerrado tampoco se repintan las miniaturas", () => {
  const i = SRC.indexOf("this.debugHistory.unshift(");
  const cola = SRC.slice(i, i + 900);
  assert.match(cola, /if \(ScannerHUD\.isDebugOpen\(\) && ScannerHUD\.updateDebugHistory\)/,
    "reconstruir las 10 <img> es justo lo que costaba la RAM");
});

test("el log del escaneo se sigue guardando aunque el panel esté cerrado", () => {
  const i = SRC.indexOf("this.debugHistory.unshift(");
  const bloque = SRC.slice(i, i + 400);
  assert.match(bloque, /log:\s*\[\.\.\.this\.lastRawOcrLog\]/);
  assert.ok(!/log:\s*debugVisible/.test(bloque), "el log no puede depender del panel");
});
