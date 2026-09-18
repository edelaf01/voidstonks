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

// Una lectura sin ningún dígito no es un voto: es el OCR devolviendo basura. Y sin votos la
// cantidad queda DESCONOCIDA (null): antes se apuntaba un 1 "mejor que nada" y al guardar
// pisaba el número real (18 reliquias con el badge sin leer pasaron de 28 copias a 1).
test("una lectura sin dígitos no vota y sin votos la cantidad es desconocida, nunca 1", () => {
  const votos = new Map(), destino = new Map();
  S.recordQtyVote("X", { qty: 1, raw: "" }, votos, destino);
  assert.equal(destino.get("X"), null, "sin votos válidos no se inventa un 1");
  assert.ok(destino.has("X"), "pero la pieza queda vista");

  S.recordQtyVote("X", { qty: 7, raw: "7" }, votos, destino);
  S.recordQtyVote("X", { qty: 99, raw: "" }, votos, destino);
  assert.equal(destino.get("X"), 7, "el voto válido manda sobre la lectura sin dígitos");
});

// Bajo la barra de iconos del HUD el template-matching devuelve ristras como "85603": el parseo
// las convierte en qty 1 y, como "tienen un dígito", votaban ese 1.
test("una ristra implausible (más de tres cifras) no vota", () => {
  const votos = new Map(), destino = new Map();
  S.recordQtyVote("Neo W2", { qty: 1, raw: "85603" }, votos, destino);
  assert.equal(destino.get("Neo W2"), null);
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

// Sobre el fuente: llegar aquí pide el stack de OCR entero. Si la invalidación no incluye la ZONA,
// el recorte descuadrado sigue en pie y cada página vuelve torcida: el bucle de páginas ilegibles.
test("una página que no casa nada invalida también la zona de recorte", () => {
  const i = SRC.indexOf("revision.reDetectar");
  assert.notEqual(i, -1, "falta la revisión de la rejilla cacheada");
  const bloque = SRC.slice(i, i + 600);
  assert.match(bloque, /this\._frameZoneCache = null/, "sin esto se vuelve a detectar dentro del mismo recorte malo");
  assert.match(bloque, /this\._autoCalibCache = null/);
});

// El log son cadenas y lo necesita el botón "COPY LOG": ese sí se guarda siempre, o depurar
// un escaneo obligaría a reproducirlo con el panel ya abierto.
test("el log del escaneo se sigue guardando aunque el panel esté cerrado", () => {
  const i = SRC.indexOf("this.debugHistory.unshift(");
  const bloque = SRC.slice(i, i + 400);
  assert.match(bloque, /log:\s*\[\.\.\.this\.lastRawOcrLog\]/);
  assert.ok(!/log:\s*debugVisible/.test(bloque), "el log no puede depender del panel");
});

// --- Recorte de la página que se encola ------------------------------------------------------

// La zona se calcula una vez por resolución y el scroll es libre: con menos de una celda de
// margen, el recorte de la página siguiente empieza a media fila y esa fila se pierde entera.
test("el recorte de página deja una celda entera de margen sobre la primera fila", async () => {
  const { makeInventoryFrame } = await import("./_helpers/inventory-frame.mjs");
  const { FakeCanvas } = await import("./_helpers/fake-canvas.mjs");
  const { VisionService } = await import("../deploy/js/services/scanner/vision.service.js");

  const W = 2560, H = 1440;
  // gridY muy por debajo de una celda: una página ya scrolleada, que es donde el margen corto fallaba.
  const frame = makeInventoryFrame({
    width: W, height: H, gridX: 92, gridY: 500, cellW: 277, cellH: 296, cols: 6, rows: 3, badges: true,
  });
  const snapshot = new FakeCanvas(W, H);
  snapshot.getContext("2d").drawImage(frame, 0, 0);
  const calib = VisionService.detectGridAutoCalib(snapshot, W, H);
  assert.ok(calib, "el fixture debe dar rejilla: sin ella no se prueba nada");

  let recorte = null;
  S._frameZoneCache = null;
  S._invQueue = { isFull: false, enqueue: (src, sx, sy, sw, sh) => { recorte = { sx, sy, sw, sh }; return true; } };
  assert.equal(S.enqueueInventoryPage(snapshot, { width: W, height: H, scale: 1 }), true);
  S._invQueue = null;

  assert.ok(
    recorte.sy <= calib.gridZone.y - calib.cellH,
    `el recorte empieza en ${recorte.sy}, a menos de una celda (${calib.cellH}) de la primera fila (${calib.gridZone.y})`,
  );
  // Por abajo llega al borde del frame: al final de la lista la última fila baja una celda.
  assert.equal(recorte.sy + recorte.sh, H);
  assert.equal(recorte.sx, calib.gridZone.x);
  assert.equal(recorte.sw, calib.gridZone.w);
});

// El auto-scan se disparaba con la pantalla quieta porque vigilaba media pantalla: ahí están el
// panel de venta, el contador de platino y el fondo animado, que cambian solos. Y no se disparaba
// en RELIQUIAS, donde las cards son iguales y solo cambia el texto.
test("el auto-scan mira solo la zona de recorte, y ahí le basta con que cambie el texto", async () => {
  const { FakeCanvas } = await import("./_helpers/fake-canvas.mjs");
  const W = 800, H = 600;
  const zona = { x: 0, y: 0, w: 400, h: H };

  // "arte" idéntico en toda la zona; el texto es una franja que cambia de sitio; fuera de la zona,
  // un panel que cambia solo (como el de venta).
  const frame = ({ texto = 40, fuera = 0 } = {}) => {
    const data = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        let v = x < zona.w ? (y % 37) * 6 : fuera;
        if (x < zona.w && y >= 200 && y < 240 && x >= texto && x < texto + 160) v = 230;
        data[i] = data[i + 1] = data[i + 2] = v;
        data[i + 3] = 255;
      }
    }
    return { videoWidth: W, videoHeight: H, width: W, height: H, data };
  };
  const muestraDe = (f) => {
    const ctx = new FakeCanvas(48, 108).getContext("2d");
    ctx.drawImage(f, zona.x, zona.y, zona.w, zona.h, 0, 0, 48, 108);
    const px = ctx.getImageData(0, 0, 48, 108).data;
    const m = new Uint8Array(48 * 108);
    for (let i = 0; i < m.length; i++) m[i] = px[i * 4] * 0.299 + px[i * 4 + 1] * 0.587 + px[i * 4 + 2] * 0.114;
    return m;
  };

  const dims = { width: W, height: H, scale: 1 };
  const base = frame();
  const corre = async (f) => {
    globalThis.state = { ...globalThis.state, autoScanEnabled: true, scannerModsMode: false };
    S._frameZoneCache = { key: `${W}x${H}`, zone: zona };
    S._sampleRect = null;
    S.lastRowLums = null;
    S.sawScrollSinceScan = false;
    S.autoScrollStableTimer = null;
    await S.routeFrameAction("INVENTORY", base, dims);   // primer frame: solo referencia
    S.autoScrollMuestra = muestraDe(base);               // esta página ya está escaneada
    await S.routeFrameAction("INVENTORY", f, dims);
    const t = S.autoScrollStableTimer;
    S.autoScrollStableTimer = null;
    clearTimeout(t);
    return { programado: t !== null, movimiento: S.sawScrollSinceScan };
  };

  const fuera = await corre(frame({ fuera: 255 }));
  assert.equal(fuera.movimiento, false, "un cambio fuera del recorte no es movimiento de la página");
  assert.equal(fuera.programado, false, "y tampoco programa un escaneo nuevo");

  const reliquias = await corre(frame({ texto: 220 }));
  assert.equal(reliquias.programado, true, "cambiar solo el texto dentro de la zona SÍ es otra página");
});
// --- Qué rejilla se acepta antes de leer la página --------------------------------------------
//
// Esta decisión (detectada en este frame / heredada de la anterior / guardada a mano) no la
// tocaba ningún test, y ahí se coló un fallo que dejó el escáner sin leer NADA en vivo mientras
// los 1600 tests seguían en verde: el filtro de fase se aplicaba también a la rejilla recién
// detectada, cuyas bandas no son las mismas cuando la ancla el color.
test("la rejilla detectada en este frame no la tumba el filtro de fase", async () => {
  const { VisionService } = await import("../deploy/js/services/scanner/vision.service.js");
  const detect = VisionService.detectGridAutoCalib, build = VisionService.buildAutoGrid;
  const rejilla = { gridZone: { x: 0, y: 236, w: 1662, h: 888 }, cellW: 277, cellH: 296, cols: 6, rows: 3, auto: true };
  VisionService.detectGridAutoCalib = () => rejilla;
  VisionService.buildAutoGrid = () => ({ cellRects: [], cellW: 277, cellH: 296, cols: 6, rows: 3 }); // corta justo después del filtro
  VisionService.ultimasBandas = [{ y0: 900, y1: 950, mass: 900 }]; // no casan con la rejilla

  S._autoCalibCache = null;
  S.detectionLocked = false;
  await S.processInventoryGrid({ width: 1662, height: 1440, getContext: () => null }, 1662, 1440, 1);

  VisionService.detectGridAutoCalib = detect;
  VisionService.buildAutoGrid = build;
  assert.notEqual(S._autoCalibCache, null, "no debe saltarse la página: la rejilla es de este frame");
});

test("la rejilla heredada que no cae sobre los nombres sí se descarta", async () => {
  const { VisionService } = await import("../deploy/js/services/scanner/vision.service.js");
  const detect = VisionService.detectGridAutoCalib;
  VisionService.detectGridAutoCalib = () => null; // sin señal en este frame
  VisionService.ultimasBandas = [{ y0: 460, y1: 508, mass: 9000 }, { y0: 756, y1: 804, mass: 9000 }];

  S._autoCalibCache = { key: "1662x1440", calib: { gridZone: { x: 0, y: 700, w: 1662, h: 888 }, cellW: 277, cellH: 296, cols: 6, rows: 3 } };
  S._frameZoneCache = { key: "1662x1440", zone: { x: 0, y: 0, w: 1662, h: 1440 } };
  S.detectionLocked = false;
  await S.processInventoryGrid({ width: 1662, height: 1440, getContext: () => null }, 1662, 1440, 1);

  VisionService.detectGridAutoCalib = detect;
  assert.equal(S._autoCalibCache, null, "la rejilla de otra página no vale para esta");
  assert.equal(S._frameZoneCache, null, "y el recorte que la produjo tampoco");
});
