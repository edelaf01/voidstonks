import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeDocument } from "./_helpers/fake-canvas.mjs";

installFakeDocument();
// several scanner modules access bare window; in node it must be aliased to globalThis
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

// quantity badges are the most fragile inventory element: item art bleeds into the crop and a 9 reads as
// 9, 8, 91... so votes are tallied across frames instead of trusting the latest read
test("la cantidad de consenso es la más votada, no la última leída", () => {
  const votos = new Map(), destino = new Map();
  for (const q of [9, 9, 8, 9, 91]) {
    S.recordQtyVote("Braton Prime Blueprint", { qty: q, raw: String(q) }, votos, destino);
  }
  assert.equal(destino.get("Braton Prime Blueprint"), 9);
});

// ties pick the higher quantity: OCR drops digits far more often than it invents them; between "3" and
// "31" with equal votes, the 1 was likely clipped
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

// values are ignored on purpose: OCR jitters decimals between frames and the HUD would flicker repainting
// the same card
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

// LOOSE identity exists to merge two reads of the same card when one missed a faint curse; without it they
// would be treated as distinct cards and the curse would never be recovered
test("perder un stat no rompe la identidad laxa: permite fusionar la lectura", () => {
  const completa = riven();
  const sinCurse = riven({ stats: completa.stats.slice(0, 2) });
  assert.equal(S._isSameRiven(completa, sinCurse), false, "la estricta sí las distingue");
  assert.equal(S._isSameRivenIdentity(completa, sinCurse), true);
});

// the "MR / ↻" row is missed in many frames: null rolls cannot break identity, or merging would be blocked
// when most needed
test("un contador de ciclos ausente no rompe la identidad laxa", () => {
  assert.equal(S._isSameRivenIdentity(riven(), riven({ rolls: null })), true);
  assert.equal(S._isSameRivenIdentity(riven(), riven({ rolls: 9 })), false,
    "pero dos contadores distintos sí");
});

// why stat overlap is required: on the reroll screen the NEW card shares weapon and cycle count with the
// old one (unconfirmed reroll), but is a different roll and must REPLACE it, not merge with it
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

// a bad frame must not overwrite a good one: this caused an already read card to degrade when moving the
// phone slightly
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

// used for multi-frame consensus, so stat ORDER returned by ocr cannot change the fingerprint: otherwise
// every frame looks like a distinct card and consensus never converges
test("la huella no depende del orden en que llegaron los stats", () => {
  const a = riven();
  const b = riven({ stats: [...a.stats].reverse() });
  assert.equal(S._rivenFingerprint(a), S._rivenFingerprint(b));
});

test("el signo sí cambia la huella: un curse no es un buff", () => {
  const a = riven();
  const b = riven({ stats: a.stats.map((s) => ({ ...s, isPositive: !s.isPositive })) });
  assert.notEqual(S._rivenFingerprint(a), S._rivenFingerprint(b));
});

test("sin carta hay huella igualmente, para poder comparar", () => {
  assert.equal(typeof S._rivenFingerprint(null), "string");
});

// the hash decides whether the page changed: too sensitive rescans all the time, too tolerant misses the scroll
test("dos hashes iguales son el mismo frame", () => {
  assert.equal(S._compareHashes("a1b2c3d4", "a1b2c3d4"), true);
});

test("una diferencia pequeña sigue siendo el mismo frame (ruido de vídeo)", () => {
  assert.equal(S._compareHashes("505050", "525151"), true);
});

test("una diferencia grande es otro frame", () => {
  assert.equal(S._compareHashes("000000", "ffffff"), false);
});

test("sin hash, o con hashes de distinto tamaño, no se afirma que sean iguales", () => {
  assert.equal(S._compareHashes(null, "abcd"), false);
  assert.equal(S._compareHashes("abcd", null), false);
  assert.equal(S._compareHashes("abcd", "abcdef"), false);
});

// background art generates loose fragments: a real name contains at most one single-letter token (a code
// split by OCR); two or more is noise
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

// rivens do not go into parts inventory: they are detected to route them to the appraiser
test("una celda de riven se reconoce por su nombre o por su categoría", () => {
  assert.equal(S._isRivenCellText(["RIVEN", "MOD"]), true);
  assert.equal(S._isRivenCellText(["RIFLE", "MOD"]), true);
  assert.equal(S._isRivenCellText(["MELEE", "MOD"]), true);
  assert.equal(S._isRivenCellText(["BRATON", "PRIME", "BLUEPRINT"]), false);
  assert.equal(S._isRivenCellText(["MOD"]), false, "'MOD' a secas no basta");
});
