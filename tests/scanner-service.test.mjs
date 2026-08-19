// Las decisiones que toma el escáner entre frames.
//
// El escáner no lee una imagen: lee DECENAS por segundo, todas distintas, y tiene que decidir
// qué se queda. Esa parte es lógica pura y es donde están los fallos que el usuario nota — el
// contador que baila entre 3 y 31, la carta de riven que parpadea, la lectura buena pisada por
// una peor. Todo eso pasa sin un solo error en consola.
//
// El resto del módulo (la orquestación del OCR, los canvases) necesita el stack completo y
// capturas reales; se queda fuera y está anotado en DEUDA.md §5.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { installFakeDocument } from "./_helpers/fake-canvas.mjs";

installFakeDocument();
// Varios módulos de la cadena del escáner usan `window` a pelo; en navegador es globalThis.
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

// --- Consenso de cantidades entre frames ----------------------------------------------------

// El badge de cantidad es lo más frágil del inventario: el arte de la pieza se cuela en el
// recorte y un mismo 9 se lee 9, 8, 91… Por eso se vota entre frames en vez de creerse el
// último.
test("la cantidad de consenso es la más votada, no la última leída", () => {
  const votos = new Map(), destino = new Map();
  for (const q of [9, 9, 8, 9, 91]) {
    S.recordQtyVote("Braton Prime Blueprint", { qty: q, raw: String(q) }, votos, destino);
  }
  assert.equal(destino.get("Braton Prime Blueprint"), 9);
});

// Empate = gana la mayor. El OCR pierde dígitos mucho más de lo que se los inventa: entre "3" y
// "31" con los mismos votos, lo probable es que el 1 se cortara.
test("con empate gana la cantidad mayor", () => {
  const votos = new Map(), destino = new Map();
  S.recordQtyVote("X", { qty: 3, raw: "3" }, votos, destino);
  S.recordQtyVote("X", { qty: 31, raw: "31" }, votos, destino);
  assert.equal(destino.get("X"), 31);
});

// Una lectura sin ningún dígito no es un voto: es el OCR devolviendo basura. Pero mientras no
// haya ningún voto válido se enseña igual, que es mejor que dejar la celda vacía.
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

// --- Identidad de una carta de riven --------------------------------------------------------

test("dos lecturas idénticas son la misma carta", () => {
  assert.equal(S._isSameRiven(riven(), riven()), true);
  assert.equal(S._isSameRiven(null, null), true);
  assert.equal(S._isSameRiven(riven(), null), false);
});

// Los valores se ignoran a propósito: el OCR los mueve un decimal entre frames y el HUD
// parpadearía repintando la misma carta.
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

// La identidad LAXA existe para poder fusionar dos lecturas de la misma carta cuando una perdió
// el curse tenue. Sin ella se tratarían como cartas distintas y el curse no se recuperaría nunca.
test("perder un stat no rompe la identidad laxa: permite fusionar la lectura", () => {
  const completa = riven();
  const sinCurse = riven({ stats: completa.stats.slice(0, 2) });
  assert.equal(S._isSameRiven(completa, sinCurse), false, "la estricta sí las distingue");
  assert.equal(S._isSameRivenIdentity(completa, sinCurse), true);
});

// La fila "MR / ↻" se pierde en muchos frames: un `rolls` a null no puede romper la identidad,
// o el merge quedaría bloqueado justo cuando más falta hace.
test("un contador de ciclos ausente no rompe la identidad laxa", () => {
  assert.equal(S._isSameRivenIdentity(riven(), riven({ rolls: null })), true);
  assert.equal(S._isSameRivenIdentity(riven(), riven({ rolls: 9 })), false,
    "pero dos contadores distintos sí");
});

// El caso que motivó exigir solapamiento de stats: en la pantalla de reroll la carta NUEVA
// comparte arma y contador con la vieja (aún no se ha confirmado el ciclo), pero es otro roll y
// tiene que REEMPLAZARLA, no fusionarse con ella.
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

// --- Calidad de una lectura -----------------------------------------------------------------

// Un frame malo no puede pisar uno bueno: es lo que hacía que la carta ya leída "se
// desdibujara" al mover un poco el móvil.
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

// --- Huella de una carta --------------------------------------------------------------------

// Se usa para el consenso entre frames, así que el ORDEN en que el OCR devuelva los stats no
// puede cambiar la huella: si cambiara, cada frame parecería una carta distinta y no habría
// consenso nunca.
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

// --- Comparación de hashes de frame ---------------------------------------------------------

// El hash decide si la página ha cambiado (hay que reescanear) o no. Demasiado sensible =
// reescaneo constante; demasiado tolerante = no se entera del scroll.
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

// --- Filtros de texto de celda --------------------------------------------------------------

// El arte de fondo genera fragmentos sueltos. Un nombre real trae como mucho un token de una
// letra (un código partido por el OCR); dos o más es ruido.
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

// Los rivens no van al inventario de piezas: se detectan para mandarlos al tasador.
test("una celda de riven se reconoce por su nombre o por su categoría", () => {
  assert.equal(S._isRivenCellText(["RIVEN", "MOD"]), true);
  assert.equal(S._isRivenCellText(["RIFLE", "MOD"]), true);
  assert.equal(S._isRivenCellText(["MELEE", "MOD"]), true);
  assert.equal(S._isRivenCellText(["BRATON", "PRIME", "BLUEPRINT"]), false);
  assert.equal(S._isRivenCellText(["MOD"]), false, "'MOD' a secas no basta");
});

// --- Coste en RAM del historial de debug ----------------------------------------------------

// Esto se comprueba sobre el FUENTE y no ejecutándolo a propósito: es un invariante
// estructural ("esta llamada cara va detrás de esta guarda") que para reproducirlo de verdad
// necesitaría el stack de OCR entero y un navegador que decodifique imágenes.
const SRC = readFileSync(new URL("../deploy/js/services/scanner/scanner.service.js", import.meta.url), "utf8");

// Costó 1,9 GB de pestaña en un inventario grande. Cada página escaneada hacía un toDataURL
// de la zona de rejilla entera y el HUD reconstruía sus 10 miniaturas; el navegador decodifica
// cada <img> AUNQUE su contenedor esté en display:none, así que eran ~6 MB × 10 tirados y
// vueltos a crear por página, y el GC no daba abasto.
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

// El log son cadenas y lo necesita el botón "COPY LOG": ese sí se guarda siempre, o depurar
// un escaneo obligaría a reproducirlo con el panel ya abierto.
test("el log del escaneo se sigue guardando aunque el panel esté cerrado", () => {
  const i = SRC.indexOf("this.debugHistory.unshift(");
  const bloque = SRC.slice(i, i + 400);
  assert.match(bloque, /log:\s*\[\.\.\.this\.lastRawOcrLog\]/);
  assert.ok(!/log:\s*debugVisible/.test(bloque), "el log no puede depender del panel");
});
