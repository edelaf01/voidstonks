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

// El recorte arranca donde acaba la cabecera del juego, no donde estaba la primera fila de la
// página con la que se cacheó la zona: el scroll es libre y con un margen fijo bajo esa fila el
// recorte de la página siguiente empezaba a media fila. Y arrancando MÁS arriba (una celda) entraba
// la cabecera, y a una fila medio escondida bajo ella se le leían los iconos como badge ("86").
test("el recorte de página arranca bajo la cabecera y llega al borde inferior", async () => {
  const { makeInventoryFrame } = await import("./_helpers/inventory-frame.mjs");
  const { FakeCanvas } = await import("./_helpers/fake-canvas.mjs");
  const { VisionService } = await import("../deploy/js/services/scanner/vision.service.js");

  const W = 2560, H = 1440;
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

  assert.equal(recorte.sy, Math.floor(H * 0.17), "la cabecera acaba a 0,17 del alto");
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

// El kiosko de ducados es pasivo: el grid se captura solo aunque el auto-scan esté apagado. La
// primera versión dejaba pasar la rama pero el temporizador de captura volvía a mirar el
// interruptor, y el HUD se quedaba en "esperando a que se estabilice" para siempre.
test("en el kiosko se captura la página con el auto-scan apagado", async () => {
  const W = 640, H = 360;
  const frame = (v) => {
    const data = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < data.length; i += 4) { data[i] = data[i + 1] = data[i + 2] = (i / 4 / W | 0) % 29 * 8 + v; data[i + 3] = 255; }
    return { videoWidth: W, videoHeight: H, width: W, height: H, data };
  };
  const video = frame(0);
  globalThis.document._registrar("live-video", video);
  globalThis.state = { ...globalThis.state, autoScanEnabled: false, scannerModsMode: false };
  let capturas = 0;
  S._invQueue = { isFull: false, enqueue: () => { capturas++; return true; } };
  S._frameZoneCache = { key: `${W}x${H}`, zone: { x: 0, y: 0, w: W, h: H } };
  S._sampleRect = null; S.lastRowLums = null; S.autoScrollMuestra = null; S.sawScrollSinceScan = false;
  S.autoScrollStableTimer = null; S.detectionLocked = false; S.isScanning = true;
  S.lastHeaderText = "CB INVENTORY/DUCAT KIOSK";

  const dims = { width: W, height: H, scale: 1 };
  await S.routeFrameAction("INVENTORY", video, dims);   // referencia
  await S.routeFrameAction("INVENTORY", video, dims);   // quieta y sin escanear: programa la captura
  assert.notEqual(S.autoScrollStableTimer, null, "la captura debe quedar programada");
  await new Promise((r) => setTimeout(r, 900));
  S._invQueue = null;
  assert.equal(capturas, 1, "y ejecutarse aunque el auto-scan esté apagado");

  // Fuera del kiosko, con el auto-scan apagado, no se programa nada.
  S.lastHeaderText = "CB INVENTORY/SELL";
  S.autoScrollMuestra = null;
  await S.routeFrameAction("INVENTORY", video, dims);
  assert.equal(S.autoScrollStableTimer, null);
});

// En el juego la cabecera no da contexto nunca, y cada lectura encadenaba las dos pasadas de
// rescate (tema y título centrado): 3 OCR por frame que no iban a servir. Se gastan cada 3 s.
test("sin contexto, las pasadas de rescate de cabecera se gastan como mucho cada 3 s", async () => {
  const { OCRRepository } = await import("../deploy/js/repositories/ocr.repository.js");
  const { SquadService } = await import("../deploy/js/services/scanner/squad.service.js");
  const { FakeCanvas } = await import("./_helpers/fake-canvas.mjs");
  const W = 640, H = 360;
  const frame = (v) => {
    const data = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < data.length; i += 4) { data[i] = (i / 4 % W * 3 + v) % 256; data[i + 1] = 40; data[i + 2] = 60; data[i + 3] = 255; }
    return { videoWidth: W, videoHeight: H, width: W, height: H, data };
  };
  let lecturas = 0;
  const workers = OCRRepository.workers, probe = SquadService.probe;
  OCRRepository.workers = [{ recognize: async () => { lecturas++; return { data: { text: "" } }; } }];
  SquadService.probe = async () => false;
  globalThis.state = { ...globalThis.state, autoScanEnabled: false, scannerModsMode: false };
  Object.assign(S, { isScanning: true, detectionLocked: false, lastHeaderText: null, lastHeaderOcrTime: 0, _ultimoRescate: 0, latchedContext: "UNKNOWN" });
  const lienzo = new FakeCanvas(16, 9);

  await S.processFrame(frame(0), lienzo);
  const primera = lecturas;
  assert.ok(primera >= 2, `la primera lectura sin contexto gasta los rescates (${primera})`);

  lecturas = 0; S.lastHeaderOcrTime = 0; // caduca la caché: la cabecera se relee
  await S.processFrame(frame(50), lienzo);
  assert.equal(lecturas, 1, "hasta que pasen 3 s solo se lee la cabecera una vez");

  lecturas = 0; S.lastHeaderOcrTime = 0; S._ultimoRescate = Date.now() - 3001;
  await S.processFrame(frame(100), lienzo);
  assert.equal(lecturas, primera, "pasados 3 s vuelven los rescates");

  OCRRepository.workers = workers; SquadService.probe = probe; S.isScanning = false;
});

// El candado de processInventoryGrid cortaba processFrame entero durante los ~2 s de OCR de una
// página: el bucle no veía el scroll, no capturaba, y la cola de 3 páginas nunca pasaba de una.
// Con la cola leyendo el bucle sigue; sin cola la página se lee en directo sobre _invSnapshot y
// el candado sigue mandando.
test("con la cola de inventario leyendo el bucle sigue mirando la pantalla; sin cola, manda el candado", async () => {
  const { OCRRepository } = await import("../deploy/js/repositories/ocr.repository.js");
  const { FakeCanvas } = await import("./_helpers/fake-canvas.mjs");
  const W = 640, H = 360;
  const video = { videoWidth: W, videoHeight: H, width: W, height: H, data: new Uint8ClampedArray(W * H * 4).fill(255) };
  const lienzo = new FakeCanvas(16, 9);
  const workers = OCRRepository.workers, ruta = S.routeFrameAction;
  let cabecera = "", rutas = 0;
  OCRRepository.workers = [{ recognize: async () => ({ data: { text: cabecera } }) }];
  S.routeFrameAction = async () => { rutas++; };

  const llega = async ({ latched, header, locked = true, cola = false }) => {
    cabecera = header; rutas = 0;
    Object.assign(S, {
      isScanning: true, detectionLocked: locked, latchedContext: latched, lastRivenContextTime: 0,
      lastHeaderText: null, lastHeaderOcrTime: 0, _ultimoRescate: Date.now(),
      ctxLatch: { latched, unknownCount: 0, pending: null, pendingCount: 0 },
      _invQueue: cola ? { isBusy: true, size: 1, release() {} } : null,
    });
    await S.processFrame(video, lienzo);
    return rutas === 1;
  };

  assert.equal(await llega({ latched: "REWARD", header: "VOID FISSURE/REWARDS", locked: false }), true, "control: sin candado el frame se enruta");
  assert.equal(await llega({ latched: "INVENTORY", header: "INVENTORY/SELL", cola: true }), true, "inventario con la cola leyendo: manda la cola, no el candado");
  assert.equal(await llega({ latched: "INVENTORY", header: "INVENTORY/SELL" }), false, "inventario sin cola: se lee en directo y el candado corta");
  // Al salir del inventario con páginas pendientes no se leía ni la cabecera hasta vaciar la cola.
  assert.equal(await llega({ latched: "REWARD", header: "VOID FISSURE/REWARDS", cola: true }), true, "fuera del inventario, con la cola vaciándose, se sigue mirando la pantalla");
  assert.equal(await llega({ latched: "REWARD", header: "VOID FISSURE/REWARDS" }), false, "recompensas: el candado corta");
  assert.equal(await llega({ latched: "INVENTORY_MODS", header: "INVENTORY/MODS" }), false, "rivens: el candado corta");

  OCRRepository.workers = workers; S.routeFrameAction = ruta;
  Object.assign(S, { isScanning: false, detectionLocked: false, latchedContext: "UNKNOWN", _frameZoneCache: null, _invQueue: null });
});

test("con el tour abierto (pausado) no se enruta nada", async () => {
  const { OCRRepository } = await import("../deploy/js/repositories/ocr.repository.js");
  const { FakeCanvas } = await import("./_helpers/fake-canvas.mjs");
  const W = 64, H = 36;
  const video = { videoWidth: W, videoHeight: H, width: W, height: H, data: new Uint8ClampedArray(W * H * 4).fill(40) };
  const orig = { workers: OCRRepository.workers, ruta: S.routeFrameAction };
  let rutas = 0, lecturas = 0;
  OCRRepository.workers = [{ recognize: async () => { lecturas++; return { data: { text: "VOID FISSURE/REWARDS" } }; } }];
  S.routeFrameAction = async () => { rutas++; };
  try {
    Object.assign(S, { isScanning: true, pausado: true, detectionLocked: false, lastHeaderText: null, lastHeaderOcrTime: 0 });
    await S.processFrame(video, new FakeCanvas(16, 9));
    assert.equal(rutas + lecturas, 0);
  } finally {
    OCRRepository.workers = orig.workers; S.routeFrameAction = orig.ruta;
    Object.assign(S, { isScanning: false, pausado: false });
  }
});

// Salir del inventario con una página aún en OCR: dismiss() del HUD de rivens soltaba el candado justo
// antes de mirarlo, y la rejilla de reliquias ponía psm 11 al worker con las celdas en vuelo.
test("con una página de inventario en OCR, pasar a reliquias no arranca la rejilla ni suelta el candado", async () => {
  const { RivenScannerHUD } = await import("../deploy/js/ui.components/rivens/ui_riven_scanner_hud.js");
  const { RelicScreenService } = await import("../deploy/js/services/scanner/relic_screen.service.js");
  const orig = { hud: globalThis.RivenScannerHUD, process: RelicScreenService.process };
  let lecturas = 0;
  globalThis.RivenScannerHUD = RivenScannerHUD;
  RelicScreenService.process = async () => { lecturas++; };
  try {
    S.detectionLocked = true;
    await S.routeFrameAction("RELICS", {}, { width: 64, height: 36, scale: 1 });
    assert.equal(lecturas, 0);
    assert.equal(S.detectionLocked, true);
  } finally {
    globalThis.RivenScannerHUD = orig.hud;
    RelicScreenService.process = orig.process;
    S.detectionLocked = false;
  }
});

// Lo que el candado sigue cortando DENTRO del bucle ahora que processFrame no lo hace: el kiosko
// y la rejilla de reliquias cambian el psm del worker 0 (una celda en vuelo lo heredaría), y el
// "done" del HUD pisaría el "scanning" de la página que se está leyendo.
test("con una página en OCR: ni kiosko, ni 'done' en el HUD, ni rejilla de reliquias", async () => {
  const { DucatKioskService } = await import("../deploy/js/services/scanner/ducat_kiosk.service.js");
  const { RelicScreenService } = await import("../deploy/js/services/scanner/relic_screen.service.js");
  const { SquadService } = await import("../deploy/js/services/scanner/squad.service.js");
  const { ScannerHUD } = await import("../deploy/js/ui.components/ui_scanner_hud.js");
  const { FakeCanvas } = await import("./_helpers/fake-canvas.mjs");
  const W = 640, H = 360;
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < data.length; i += 4) { data[i] = data[i + 1] = data[i + 2] = (i / 4 / W | 0) % 29 * 8; data[i + 3] = 255; }
  const video = { videoWidth: W, videoHeight: H, width: W, height: H, data };
  const dims = { width: W, height: H, scale: 1 };
  const orig = { kiosko: DucatKioskService.process, reliquias: RelicScreenService.process, probe: SquadService.probe, hud: ScannerHUD.updateScrollStatus };
  const n = { kiosko: 0, reliquias: 0, estados: [] };
  DucatKioskService.process = async () => { n.kiosko++; };
  RelicScreenService.process = async () => { n.reliquias++; };
  SquadService.probe = async () => false;
  ScannerHUD.updateScrollStatus = (estado) => { n.estados.push(estado); };
  globalThis.state = { ...globalThis.state, autoScanEnabled: true, scannerModsMode: false };

  const inventario = async (locked) => {
    n.kiosko = 0; n.estados = [];
    Object.assign(S, {
      detectionLocked: locked, lastHeaderText: "CB INVENTORY/DUCAT KIOSK", _invQueue: { isFull: false },
      _frameZoneCache: { key: `${W}x${H}`, zone: { x: 0, y: 0, w: W, h: H } }, _sampleRect: null, lastRowLums: null, autoScrollStableTimer: null,
    });
    await S.routeFrameAction("INVENTORY", video, dims); // referencia (fija la región y borra las muestras)
    // La misma muestra que va a tomar el bucle: la página cuenta como ya vista.
    const sCtx = new FakeCanvas(48, 108).getContext("2d");
    sCtx.drawImage(video, 0, 0, W, H, 0, 0, 48, 108);
    const px = sCtx.getImageData(0, 0, 48, 108).data;
    const vista = new Uint8Array(48 * 108);
    for (let i = 0; i < vista.length; i++) vista[i] = px[i * 4] * 0.299 + px[i * 4 + 1] * 0.587 + px[i * 4 + 2] * 0.114;
    Object.assign(S, { autoScrollMuestra: vista, sawScrollSinceScan: false });
    await S.routeFrameAction("INVENTORY", video, dims); // quieta y ya vista
    await S.routeFrameAction("INVENTORY", video, dims);
    return { kiosko: n.kiosko, dones: n.estados.filter((e) => e === "done").length, scanning: n.estados.filter((e) => e === "scanning").length };
  };
  assert.deepEqual(await inventario(false), { kiosko: 3, dones: 2, scanning: 0 }, "control: sin candado se lee el kiosko y el HUD vuelve a 'done'");
  assert.deepEqual(await inventario(true), { kiosko: 0, dones: 0, scanning: 2 }, "con candado: ni kiosko ni 'done'; el HUD dice que escanea");

  S.detectionLocked = false;
  await S.routeFrameAction("RELICS", video, dims);
  S.detectionLocked = true;
  await S.routeFrameAction("RELICS", video, dims);
  assert.equal(n.reliquias, 1, "reliquias solo se lee sin candado");

  Object.assign(DucatKioskService, { process: orig.kiosko });
  Object.assign(RelicScreenService, { process: orig.reliquias });
  Object.assign(SquadService, { probe: orig.probe });
  Object.assign(ScannerHUD, { updateScrollStatus: orig.hud });
  Object.assign(S, { detectionLocked: false, _invQueue: null, _frameZoneCache: null, autoScrollMuestra: null, sawScrollSinceScan: false, scrollDirectionAccumulator: 0 });
});

// --- Color de nombre y pool de Tesseract en modo preciso ----------------------------------------
//
// Elegir el color del nombre cuesta hasta 6 lecturas de Tesseract, y con el lote de Paddle solo lo
// usan los respaldos (6 celdas en 30 páginas medidas): se elige cuando el primero lo pide. Y el
// pool de Tesseract no se crea mientras Paddle CARGA: la página lo espera, no lee con el clásico.
async function escaneaPagina({ motor, lote = {}, paddleListo = true }) {
  const { VisionService } = await import("../deploy/js/services/scanner/vision.service.js");
  const { OCRRepository } = await import("../deploy/js/repositories/ocr.repository.js");
  const { PaddleRepository } = await import("../deploy/js/repositories/paddle.repository.js");
  const { ScannerHUD } = await import("../deploy/js/ui.components/ui_scanner_hud.js");
  const M = await import("../deploy/js/services/scanner/ocr_engine.service.js");
  const { state } = await import("../deploy/js/state.js");
  const { FakeCanvas } = await import("./_helpers/fake-canvas.mjs");

  const orig = {
    detect: VisionService.detectGridAutoCalib, build: VisionService.buildAutoGrid, cands: VisionService.pageNameColorCandidates,
    workers: OCRRepository.workers, ensure: OCRRepository.ensureWorkers,
    warm: PaddleRepository.warmUp, service: PaddleRepository._service, fallo: PaddleRepository.ultimoFallo, lote: PaddleRepository.recognizeStripWords,
    scroll: ScannerHUD.updateScrollStatus, items: ScannerHUD.updateDetectedItems, open: ScannerHUD.isDebugOpen,
    relics: state.allRelicNames,
  };
  const W = 600, H = 400;
  const cellW = 277, cellH = 296;
  VisionService.detectGridAutoCalib = () => ({ gridZone: { x: 0, y: 0, w: W, h: H }, cellW, cellH, cols: 2, rows: 1, auto: true });
  VisionService.buildAutoGrid = () => ({ cellRects: [{ r: 0, c: 0, sx: 0, sy: 0 }, { r: 0, c: 1, sx: cellW, sy: 0 }], cellW, cellH, cols: 2, rows: 1 });
  VisionService.pageNameColorCandidates = () => [[255, 255, 255]];
  state.allRelicNames = ["Lith C1", "Meso K3"];
  const worker = { llamadas: 0, recognize: async () => { worker.llamadas++; return { data: { words: [
    { text: "LITH", bbox: { x0: 0, x1: 30, y0: 0, y1: 20 }, confidence: 90 }, { text: "C1", bbox: { x0: 34, x1: 50, y0: 0, y1: 20 }, confidence: 90 }] } }; } };
  const pedidos = [];
  OCRRepository.workers = [worker];
  OCRRepository.ensureWorkers = async (n) => { pedidos.push(n); };
  PaddleRepository.warmUp = async () => ({});
  PaddleRepository._service = paddleListo ? {} : null;
  PaddleRepository.ultimoFallo = null;
  let lecturasAlLote = null;
  PaddleRepository.recognizeStripWords = async () => { lecturasAlLote = worker.llamadas; return new Map(Object.entries(lote)); };
  ScannerHUD.updateScrollStatus = () => {}; ScannerHUD.updateDetectedItems = () => {}; ScannerHUD.isDebugOpen = () => false;
  M.aplicaMotor(motor);
  Object.assign(S, { _temaCache: { key: `${W}x${H}`, theme: { name: "Default", r: 227, g: 128, b: 20, actualR: 227, actualG: 128, actualB: 20 } },
    _nameColorCache: null, _gridReintentado: true, _autoCalibCache: null, detectionLocked: false, lastHeaderText: "INVENTORY/SELL" });
  try {
    const snapshot = new FakeCanvas(W, H);
    await S.processInventoryGrid(snapshot, W, H, 1);
    return { lecturas: worker.llamadas, lecturasAlLote, pedidos, color: S._nameColorCache?.color ?? null, log: [...S.lastRawOcrLog] };
  } finally {
    Object.assign(VisionService, { detectGridAutoCalib: orig.detect, buildAutoGrid: orig.build, pageNameColorCandidates: orig.cands });
    Object.assign(OCRRepository, { workers: orig.workers, ensureWorkers: orig.ensure });
    Object.assign(PaddleRepository, { warmUp: orig.warm, _service: orig.service, ultimoFallo: orig.fallo, recognizeStripWords: orig.lote });
    Object.assign(ScannerHUD, { updateScrollStatus: orig.scroll, updateDetectedItems: orig.items, isDebugOpen: orig.open });
    state.allRelicNames = orig.relics;
    M.aplicaMotor(M.MOTOR_CLASICO);
    S.detectionLocked = false;
  }
}

test("con el lote del preciso leyendo todas las celdas no se gasta Tesseract en elegir el color", async () => {
  const M = await import("../deploy/js/services/scanner/ocr_engine.service.js");
  const r = await escaneaPagina({ motor: M.MOTOR_PRECISO, lote: { r0c0: ["LITH", "C1"], r0c1: ["MESO", "K3"] } });
  assert.equal(r.lecturas, 0, "ninguna lectura de Tesseract");
  assert.equal(r.color, null);
  assert.ok(!r.log.some((l) => l.startsWith("[NAME-COLOR]")), "sin color no hay línea [NAME-COLOR]");
});

test("el primer respaldo elige el color, y nunca antes del lote", async () => {
  const M = await import("../deploy/js/services/scanner/ocr_engine.service.js");
  const r = await escaneaPagina({ motor: M.MOTOR_PRECISO, lote: { r0c0: ["LITH", "C1"], r0c1: ["ZZZZ", "QQQQ"] } });
  assert.equal(r.lecturasAlLote, 0, "el lote sale antes de gastar Tesseract");
  assert.deepEqual(r.color, [255, 255, 255]);
  assert.ok(r.log.includes("[NAME-COLOR] rgb(255,255,255)"));
});

test("con el clásico el color se elige antes de la primera celda: la máscara lo necesita", async () => {
  const M = await import("../deploy/js/services/scanner/ocr_engine.service.js");
  const r = await escaneaPagina({ motor: M.MOTOR_CLASICO });
  const color = r.log.findIndex((l) => l === "[NAME-COLOR] rgb(255,255,255)");
  const celda = r.log.findIndex((l) => /^\[r0c\d\]/.test(l));
  assert.ok(color >= 0, "se eligió");
  assert.ok(celda < 0 || color < celda, "antes de cualquier celda");
});

test("la página que espera al preciso no crea el pool de Tesseract; con el clásico sí", async () => {
  const M = await import("../deploy/js/services/scanner/ocr_engine.service.js");
  const esperando = await escaneaPagina({ motor: M.MOTOR_PRECISO, paddleListo: false, lote: { r0c0: ["LITH", "C1"], r0c1: ["MESO", "K3"] } });
  assert.deepEqual(esperando.pedidos, []);
  const clasico = await escaneaPagina({ motor: M.MOTOR_CLASICO });
  assert.deepEqual(clasico.pedidos, [2]);
});

test("en modo preciso el pool de Tesseract solo se crea si el preciso está caído", async () => {
  const { OCRRepository } = await import("../deploy/js/repositories/ocr.repository.js");
  const { PaddleRepository } = await import("../deploy/js/repositories/paddle.repository.js");
  const { DucatKioskService } = await import("../deploy/js/services/scanner/ducat_kiosk.service.js");
  const M = await import("../deploy/js/services/scanner/ocr_engine.service.js");
  const W = 640, H = 360;
  const data = new Uint8ClampedArray(W * H * 4).fill(40);
  const video = { videoWidth: W, videoHeight: H, width: W, height: H, data };
  const orig = { ensure: OCRRepository.ensureWorkers, service: PaddleRepository._service, fallo: PaddleRepository.ultimoFallo, kiosko: DucatKioskService.process, warm: PaddleRepository.warmUp };
  const pedidos = [];
  OCRRepository.ensureWorkers = async (n) => { pedidos.push(n); };
  PaddleRepository.warmUp = async () => ({}); // elegir el preciso lo descarga; aquí no hay red
  DucatKioskService.process = async () => {};
  globalThis.state = { ...globalThis.state, autoScanEnabled: true, scannerModsMode: false };
  Object.assign(S, { lastHeaderText: "INVENTORY/SELL", _frameZoneCache: null, lastRowLums: null, autoScrollMuestra: null, detectionLocked: false, autoScrollStableTimer: null });
  const dims = { width: W, height: H, scale: 1 };
  try {
    M.aplicaMotor(M.MOTOR_PRECISO);
    PaddleRepository._service = null; PaddleRepository.ultimoFallo = null;
    await S.routeFrameAction("INVENTORY", video, dims);
    assert.deepEqual(pedidos, [], "cargando: la página va a esperarlo");
    PaddleRepository._service = {};
    await S.routeFrameAction("INVENTORY", video, dims);
    assert.deepEqual(pedidos, [], "listo");
    PaddleRepository.ultimoFallo = new Error("CDN");
    await S.routeFrameAction("INVENTORY", video, dims);
    assert.deepEqual(pedidos, [2], "caído: lee Tesseract");
    M.aplicaMotor(M.MOTOR_CLASICO); PaddleRepository.ultimoFallo = null;
    await S.routeFrameAction("INVENTORY", video, dims);
    assert.deepEqual(pedidos, [2, 2]);
  } finally {
    if (S.autoScrollStableTimer) { clearTimeout(S.autoScrollStableTimer); S.autoScrollStableTimer = null; }
    Object.assign(OCRRepository, { ensureWorkers: orig.ensure });
    Object.assign(PaddleRepository, { _service: orig.service, ultimoFallo: orig.fallo, warmUp: orig.warm });
    DucatKioskService.process = orig.kiosko;
    M.aplicaMotor(M.MOTOR_CLASICO);
  }
});

// --- La franja del rótulo decide cuándo se relee la cabecera ---------------------------------
//
// El hash 16×9 de antes no veía "INVENTORY/SELL" -> "INVENTORY/MODS" y el reloj (2,5 s) era lo
// único que lo detectaba: un OCR cada 2,5 s con la pantalla quieta. Ahora se compara la franja
// del rótulo y la cabecera vale 10 s.
async function cabeceraConRotulo({ invertido = false, filaCambiada = false } = {}) {
  const W = 640, H = 360;
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    let v = 30;
    // Franja del rótulo: x 60-288, y 13-31 del vídeo (0.21-1.0 × 0.30-0.72 del recorte de cabecera).
    if (x >= 60 && x < 288 && y >= 13 && y < 31) v = ((x >> 3) & 1) ^ (invertido ? 1 : 0) ? 220 : 30;
    // Una fila de celdas justo debajo: dentro del recorte de cabecera, fuera de la franja.
    if (filaCambiada && y >= 35 && y < 43) v = 200;
    data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255;
  }
  return { videoWidth: W, videoHeight: H, width: W, height: H, data };
}

async function lecturasDeCabecera({ haceMs, frame2 }) {
  const { OCRRepository } = await import("../deploy/js/repositories/ocr.repository.js");
  const { regionLuma } = await import("../deploy/js/utils/vision/frame_hash.js");
  const { FRANJA_TITULO_VIDEO } = await import("../deploy/js/utils/vision/context_latch.js");
  const { FakeCanvas } = await import("./_helpers/fake-canvas.mjs");
  let lecturas = 0;
  const orig = { workers: OCRRepository.workers, ruta: S.routeFrameAction };
  OCRRepository.workers = [{ recognize: async () => { lecturas++; return { data: { text: "INVENTORY/SELL" } }; } }];
  S.routeFrameAction = async () => {};
  const lienzo = new FakeCanvas(16, 9);
  const base = await cabeceraConRotulo();
  Object.assign(S, { isScanning: true, detectionLocked: false, lastHeaderText: "INVENTORY/SELL", lastHeaderOcrTime: Date.now() - haceMs,
    lastHeaderHash: regionLuma(base, FRANJA_TITULO_VIDEO), _headerEstable: 0, _headerCtxPrevio: "INVENTORY", latchedContext: "INVENTORY" });
  try {
    await S.processFrame(frame2, lienzo);
    return lecturas;
  } finally {
    OCRRepository.workers = orig.workers; S.routeFrameAction = orig.ruta; S.isScanning = false;
  }
}

test("con el rótulo quieto la cabecera vale 10 s aunque el resto del recorte cambie", async () => {
  const lecturas = await lecturasDeCabecera({ haceMs: 5000, frame2: await cabeceraConRotulo({ filaCambiada: true }) });
  assert.equal(lecturas, 0);
});

test("si cambia el rótulo se relee aunque no hayan pasado 2,5 s", async () => {
  const lecturas = await lecturasDeCabecera({ haceMs: 1500, frame2: await cabeceraConRotulo({ invertido: true }) });
  assert.equal(lecturas, 1);
});

// Visto en vivo (ZIP 2026-09-20-11-10): al pasar a una página nueva el HUD se quedaba en
// "esperando estabilización" y no la leía. El estimador de dirección (bestDy, ventana ±24 filas
// sobre una rejilla periódica) daba un scroll hacia ABAJO por hacia arriba, y la regla "arriba se
// ignora" marcaba la página como vista sin escanearla.
test("una página nueva se escanea aunque el scroll parezca hacia arriba, y el HUD no se queda en 'estabilizando'", async () => {
  const { DucatKioskService } = await import("../deploy/js/services/scanner/ducat_kiosk.service.js");
  const { ScannerHUD } = await import("../deploy/js/ui.components/ui_scanner_hud.js");
  const W = 640, H = 360;
  const frame = (fase) => {
    const data = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; const v = ((y + fase) % 40) < 8 ? 200 : 30; data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255; }
    return { videoWidth: W, videoHeight: H, width: W, height: H, data };
  };
  const estados = [];
  const orig = { hud: ScannerHUD.updateScrollStatus, kiosko: DucatKioskService.process };
  ScannerHUD.updateScrollStatus = (e) => estados.push(e);
  DucatKioskService.process = async () => {};
  globalThis.state = { ...globalThis.state, autoScanEnabled: true, scannerModsMode: false };
  let capturas = 0;
  S._invQueue = { isFull: false, enqueue: () => { capturas++; return true; } };
  S._frameZoneCache = { key: `${W}x${H}`, zone: { x: 0, y: 0, w: W, h: H } };
  Object.assign(S, { _sampleRect: null, lastRowLums: null, autoScrollMuestra: null, sawScrollSinceScan: false, autoScrollStableTimer: null, detectionLocked: true, isScanning: true, lastHeaderText: "INVENTORY/SELL" });
  const dims = { width: W, height: H, scale: 1 };
  try {
    globalThis.document._registrar("live-video", frame(20));
    await S.routeFrameAction("INVENTORY", frame(0), dims);   // referencia
    await S.routeFrameAction("INVENTORY", frame(0), dims);   // quieta: 1ª página
    await new Promise((r) => setTimeout(r, 900));
    assert.equal(capturas, 1);
    // Desplazamiento de 20 px: en la muestra de 108 filas el patrón periódico se alias a dy negativo.
    await S.routeFrameAction("INVENTORY", frame(20), dims);
    await S.routeFrameAction("INVENTORY", frame(20), dims);
    await new Promise((r) => setTimeout(r, 900));
    assert.equal(capturas, 2, "la página nueva se captura");
    await S.routeFrameAction("INVENTORY", frame(20), dims);
    assert.equal(estados.at(-1), "scanning", "con una página en OCR y esta encolada, el HUD dice que escanea");
  } finally {
    if (S.autoScrollStableTimer) { clearTimeout(S.autoScrollStableTimer); S.autoScrollStableTimer = null; }
    S._invQueue = null; S.detectionLocked = false; S.isScanning = false;
    ScannerHUD.updateScrollStatus = orig.hud; DucatKioskService.process = orig.kiosko;
  }
});

// Visto en vivo (capturas del 20-09): "MISSION COMPLETE" solo lo lee la 3ª pasada (título
// centrado) y, con el límite de 3 s y la caché de 10 s, un fin de misión que llegaba con el
// rescate recién gastado se quedaba en UNKNOWN hasta 10 s. Pantalla parada = rescate ya.
test("con la pantalla parada y sin contexto, los rescates de cabecera no esperan a los 3 s", async () => {
  const { OCRRepository } = await import("../deploy/js/repositories/ocr.repository.js");
  const { SquadService } = await import("../deploy/js/services/scanner/squad.service.js");
  const { FakeCanvas } = await import("./_helpers/fake-canvas.mjs");
  const W = 640, H = 360;
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < data.length; i += 4) { data[i] = (i / 4 % W * 3) % 256; data[i + 1] = 40; data[i + 2] = 60; data[i + 3] = 255; }
  const quieta = { videoWidth: W, videoHeight: H, width: W, height: H, data };
  let lecturas = 0;
  const orig = { workers: OCRRepository.workers, probe: SquadService.probe };
  OCRRepository.workers = [{ recognize: async () => { lecturas++; return { data: { text: "" } }; } }];
  SquadService.probe = async () => false;
  globalThis.state = { ...globalThis.state, autoScanEnabled: false, scannerModsMode: false };
  Object.assign(S, { isScanning: true, detectionLocked: false, lastHeaderText: null, lastHeaderOcrTime: 0, _ultimoRescate: Date.now(), latchedContext: "UNKNOWN", _franjaTickAnterior: null });
  const lienzo = new FakeCanvas(16, 9);
  try {
    await S.processFrame(quieta, lienzo);        // primer tick: la franja aún no se sabe quieta
    lecturas = 0; S.lastHeaderOcrTime = 0; S._ultimoRescate = Date.now();
    await S.processFrame(quieta, lienzo);        // mismo frame: parada
    assert.ok(lecturas >= 2, `con la pantalla parada se rescata aunque el último rescate fuera hace 0 s (${lecturas})`);
  } finally { OCRRepository.workers = orig.workers; SquadService.probe = orig.probe; S.isScanning = false; }
});

test("un UNKNOWN cacheado caduca a los 3 s, no a los 10", async () => {
  const lecturas = await (async () => {
    const { OCRRepository } = await import("../deploy/js/repositories/ocr.repository.js");
    const { regionLuma } = await import("../deploy/js/utils/vision/frame_hash.js");
    const { FRANJA_TITULO_VIDEO } = await import("../deploy/js/utils/vision/context_latch.js");
    const { FakeCanvas } = await import("./_helpers/fake-canvas.mjs");
    let n = 0;
    const orig = { workers: OCRRepository.workers, ruta: S.routeFrameAction };
    OCRRepository.workers = [{ recognize: async () => { n++; return { data: { text: "" } }; } }];
    S.routeFrameAction = async () => {};
    const lienzo = new FakeCanvas(16, 9);
    const frame = await cabeceraConRotulo(), base = frame;
    Object.assign(S, { isScanning: true, detectionLocked: false, lastHeaderText: "", lastHeaderOcrTime: Date.now() - 5000,
      lastHeaderHash: regionLuma(base, FRANJA_TITULO_VIDEO), _headerEstable: 0, _headerCtxPrevio: "UNKNOWN", latchedContext: "UNKNOWN", _ultimoRescate: Date.now() });
    try { await S.processFrame(frame, lienzo); return n; } finally { OCRRepository.workers = orig.workers; S.routeFrameAction = orig.ruta; S.isScanning = false; }
  })();
  assert.ok(lecturas >= 1, "a los 5 s sin contexto se relee");
});

// Fin de misión con la escena 3D moviéndose detrás (enemigos animados, cámara): el hash del
// frame ENTERO no se daba por quieto nunca y el panel de recompensas no se leía jamás. Lo que
// tiene que estar quieto es el panel de la derecha.
test("el fin de misión se lee aunque el fondo se mueva: solo cuenta el panel de recompensas", async () => {
  const { OCRRepository } = await import("../deploy/js/repositories/ocr.repository.js");
  const W = 640, H = 360;
  const frame = (semilla) => {
    const data = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      // Izquierda: escena que cambia; derecha (panel): fija.
      const v = x < W * 0.45 ? ((x * 3 + y * 5 + semilla * 37) % 251) : ((x + y) % 40 < 20 ? 220 : 30);
      data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255;
    }
    return { videoWidth: W, videoHeight: H, width: W, height: H, data };
  };
  const orig = { workers: OCRRepository.workers };
  OCRRepository.workers = [{ recognize: async () => ({ data: { text: "" } }) }];
  // El detector real necesita una pantalla real: aquí basta con saber si se llega a él.
  const dims = { width: W, height: H, scale: 1 };
  Object.assign(S, { _mcStableHash: null, _mcGrid: null, _mcFrameCvs: null });
  try {
    // El detector real necesita una pantalla real: basta con ver que se llega a él (traza "[MC]").
    const logs = [];
    const log = console.log; console.log = (...a) => { logs.push(a.join(" ")); };
    try {
      await S.processMissionComplete(frame(1), dims);
      await S.processMissionComplete(frame(2), dims);
      await S.processMissionComplete(frame(3), dims);
    } finally { console.log = log; }
    assert.ok(logs.some((l) => l.startsWith("[MC]")), `con el panel quieto se pasa a detectar la rejilla (logs: ${logs.length})`);
  } finally { OCRRepository.workers = orig.workers; }
});

// Visto en vivo (fisura sin fin): al pasar de REWARDS a SELECT RELIC el latch seguía en REWARD y el
// panel "Axi A6 Relic [Radiant] - Possible Rewards" abrió el modal con un Chroma Prime Blueprint.
test("las recompensas solo se leen con la cabecera diciendo REWARDS", async () => {
  const W = 64, H = 36;
  const video = { videoWidth: W, videoHeight: H, width: W, height: H, data: new Uint8ClampedArray(W * H * 4).fill(40) };
  const congela = { width: W, height: H, getContext: () => ({ drawImage() { throw new Error("congelado"); } }) };
  const orig = { cvs: S._rewardFrameCvs, cab: S.lastHeaderText, sin: S.lastRewardNoResult };
  try {
    for (const cabecera of ["VOID FISSURE/SELECT RELIC", "C8 ~ VOID FISS", null]) {
      Object.assign(S, { _rewardFrameCvs: congela, lastHeaderText: cabecera, lastRewardNoResult: { hash: null, time: 0 } });
      await S.processRewards(video, { width: W, height: H, scale: 1 });
    }
    Object.assign(S, { lastHeaderText: "VOID FISSURE/REWARDS" });
    await assert.rejects(S.processRewards(video, { width: W, height: H, scale: 1 }), /congelado/);
  } finally { Object.assign(S, { _rewardFrameCvs: orig.cvs, lastHeaderText: orig.cab, lastRewardNoResult: orig.sin }); }
});

// Visto en vivo: de la pantalla de recompensas se pasa a FIN DE MISIÓN y, mientras el reloj de
// la cabecera no deja releer, el texto cacheado sigue diciendo "VOID FISSURE/REWARDS": el panel
// de fin de misión se leyó como banda de recompensas y abrió el modal de elegir.
test("la cabecera cacheada se marca como no vigente cuando el rótulo cambió y el reloj no deja releer", async () => {
  const { OCRRepository } = await import("../deploy/js/repositories/ocr.repository.js");
  const { regionLuma } = await import("../deploy/js/utils/vision/frame_hash.js");
  const { FRANJA_TITULO_VIDEO } = await import("../deploy/js/utils/vision/context_latch.js");
  const { FakeCanvas } = await import("./_helpers/fake-canvas.mjs");
  const orig = { workers: OCRRepository.workers, ruta: S.routeFrameAction };
  OCRRepository.workers = [{ recognize: async () => ({ data: { text: "VOID FISSURE/REWARDS" } }) }];
  S.routeFrameAction = async () => {};
  const lienzo = new FakeCanvas(16, 9);
  const base = await cabeceraConRotulo();
  try {
    // Recién leída (hace 100 ms, racha estable => intervalo 1,2 s) y el rótulo ya es otro.
    Object.assign(S, { isScanning: true, detectionLocked: false, lastHeaderText: "VOID FISSURE/REWARDS", lastHeaderOcrTime: Date.now() - 100,
      lastHeaderHash: regionLuma(base, FRANJA_TITULO_VIDEO), _headerEstable: 3, _headerCtxPrevio: "REWARD", latchedContext: "REWARD" });
    await S.processFrame(await cabeceraConRotulo({ invertido: true }), lienzo);
    assert.equal(S._cabeceraVigente, false, "el texto es de la pantalla anterior");
    // Mismo rótulo que el leído: vigente aunque no se relea.
    await S.processFrame(await cabeceraConRotulo(), lienzo);
    assert.equal(S._cabeceraVigente, true);
  } finally { OCRRepository.workers = orig.workers; S.routeFrameAction = orig.ruta; S.isScanning = false; }
});

// Fin de misión: las casillas de recursos (badge ≥ 10) no se leen ni con Paddle ni con Tesseract.
test("en fin de misión las casillas de recursos se descartan sin OCR", async () => {
  const { OCRRepository } = await import("../deploy/js/repositories/ocr.repository.js");
  const { PaddleRepository } = await import("../deploy/js/repositories/paddle.repository.js");
  const W = 640, H = 360;
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < data.length; i += 4) { data[i] = data[i + 1] = data[i + 2] = 40; data[i + 3] = 255; }
  const frame = { videoWidth: W, videoHeight: H, width: W, height: H, data };
  const leidas = [];
  const orig = { workers: OCRRepository.workers, listo: PaddleRepository.listo };
  OCRRepository.workers = [{ recognize: async (cvs) => { leidas.push(cvs); return { data: { text: "", blocks: [] } }; } }];
  PaddleRepository.listo = () => false; // sin lote: cada casilla que se lea pasa por Tesseract
  const celda = (row, col, badge) => ({ x: 300 + col * 60, y: 60 + row * 60, w: 50, h: 50, row, col, named: true, badge, qty: 1 });
  const grid = { cells: [celda(0, 0, "8126"), celda(0, 1, ""), celda(0, 2, "2"), celda(0, 3, "45"), { ...celda(0, 4, ""), named: false }], accent: [190, 169, 102], pitch: 60, occluded: false, cut: false };
  Object.assign(S, { _mcStableHash: null, _mcGrid: null, _mcFrameCvs: null, mcLedger: S.mcLedger });
  S._mcCache.clear();
  try {
    await S.processMissionComplete(frame, { width: W, height: H, scale: 1 }); // fija la estabilidad
    S._mcGrid = { hash: S._mcStableHash, grid };
    await S.processMissionComplete(frame, { width: W, height: H, scale: 1 });
    assert.equal(leidas.length, 2, "solo la casilla sin badge y la ×2; créditos, endo y el mod, fuera");
  } finally { OCRRepository.workers = orig.workers; PaddleRepository.listo = orig.listo; S._mcGrid = null; S._mcStableHash = null; }
});

// "Tengo que esperar un rato en fin de misión": la cadena era tick de 3 s (auto-scan apagado) →
// cabecera en caché por el reloj → segundo tick de 3 s para confirmar el latch → 800 ms × 2 en
// la pantalla. Tres cortes: pantalla nueva parada se lee ya, la confirmación va a 300 ms y en
// UNKNOWN el tick es de 1 s sin mirar el auto-scan.
test("una pantalla nueva parada se lee aunque el reloj de la cabecera aún no haya vencido", async () => {
  const { OCRRepository } = await import("../deploy/js/repositories/ocr.repository.js");
  const { regionLuma } = await import("../deploy/js/utils/vision/frame_hash.js");
  const { FRANJA_TITULO_VIDEO } = await import("../deploy/js/utils/vision/context_latch.js");
  const { FakeCanvas } = await import("./_helpers/fake-canvas.mjs");
  let lecturas = 0;
  const orig = { workers: OCRRepository.workers, ruta: S.routeFrameAction };
  OCRRepository.workers = [{ recognize: async () => { lecturas++; return { data: { text: "INVENTORY/SELL" } }; } }];
  S.routeFrameAction = async () => {};
  const lienzo = new FakeCanvas(16, 9);
  const base = await cabeceraConRotulo();
  const nueva = await cabeceraConRotulo({ invertido: true });
  try {
    Object.assign(S, { isScanning: true, detectionLocked: false, lastHeaderText: "INVENTORY/SELL", lastHeaderOcrTime: Date.now() - 100,
      lastHeaderHash: regionLuma(base, FRANJA_TITULO_VIDEO), _headerEstable: 3, _headerCtxPrevio: "INVENTORY", latchedContext: "INVENTORY", _franjaTickAnterior: null });
    await S.processFrame(nueva, lienzo); // primer tick con la pantalla nueva: aún no se sabe parada
    assert.equal(lecturas, 0, "en movimiento manda el reloj");
    await S.processFrame(nueva, lienzo); // mismo rótulo dos ticks seguidos: parada y distinta → se lee
    assert.equal(lecturas, 1);
  } finally { OCRRepository.workers = orig.workers; S.routeFrameAction = orig.ruta; S.isScanning = false; }
});

test("en UNKNOWN el tick es de 1 s con el auto-scan apagado, y con un cambio de contexto pendiente baja a 300 ms", async () => {
  const { SquadService } = await import("../deploy/js/services/scanner/squad.service.js");
  const { OCRRepository } = await import("../deploy/js/repositories/ocr.repository.js");
  const { INITIAL_LATCH } = await import("../deploy/js/utils/vision/context_latch.js");
  const { FakeCanvas } = await import("./_helpers/fake-canvas.mjs");
  const orig = { probe: SquadService.probe, workers: OCRRepository.workers };
  SquadService.probe = async () => false;
  globalThis.state = { ...globalThis.state, autoScanEnabled: false, scannerModsMode: false };
  const W = 640, H = 360, data = new Uint8ClampedArray(W * H * 4).fill(40);
  const video = { videoWidth: W, videoHeight: H, width: W, height: H, data };
  try {
    await S.routeFrameAction("UNKNOWN", video, { width: W, height: H, scale: 1 });
    assert.equal(S.currentRate, 1000);
    // De recompensas a fin de misión: el latch pide un 2º frame de acuerdo; ese tick va a 300 ms.
    OCRRepository.workers = [{ recognize: async () => ({ data: { text: "MISSION COMPLETE" } }) }];
    const ruta = S.routeFrameAction;
    S.routeFrameAction = async () => { S.currentRate = 1000; };
    Object.assign(S, { isScanning: true, detectionLocked: false, lastHeaderText: null, lastHeaderOcrTime: 0, latchedContext: "REWARD", ctxLatch: { ...INITIAL_LATCH, latched: "REWARD" } });
    try {
      await S.processFrame(video, new FakeCanvas(16, 9));
      assert.equal(S.ctxLatch.pending, "MISSION_COMPLETE");
      assert.equal(S.currentRate, 300);
    } finally { S.routeFrameAction = ruta; }
  } finally { SquadService.probe = orig.probe; OCRRepository.workers = orig.workers; S.isScanning = false; }
});

// Log real (21-09): en MISSION COMPLETE el recorte izquierdo leía "BB MIS", el rescate del
// título centrado estaba gastado (<3 s) y la escena animada no dejaba la franja quieta: dos
// UNKNOWN seguidos tiraban el latch, el ledger se reiniciaba y "Sevagoth Prime Blueprint" se
// leyó cinco veces sin darse de alta nunca.
test("en fin de misión, la basura del recorte izquierdo va directa al título centrado", async () => {
  const { OCRRepository } = await import("../deploy/js/repositories/ocr.repository.js");
  const { SquadService } = await import("../deploy/js/services/scanner/squad.service.js");
  const { FakeCanvas } = await import("./_helpers/fake-canvas.mjs");
  const W = 640, H = 360;
  const frame = (v) => {
    const data = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < data.length; i += 4) { data[i] = (i / 4 % W * 3 + v) % 256; data[i + 1] = 40; data[i + 2] = 60; data[i + 3] = 255; }
    return { videoWidth: W, videoHeight: H, width: W, height: H, data };
  };
  const textos = [];
  const orig = { workers: OCRRepository.workers, probe: SquadService.probe, mc: S.processMissionComplete };
  // 1ª pasada basura; la centrada (la última que se pide) lee el título.
  OCRRepository.workers = [{ recognize: async () => { textos.push(1); return { data: { text: textos.length % 2 === 0 ? "MISSION COMPLETE" : "BB MIS" } }; } }];
  SquadService.probe = async () => false;
  S.processMissionComplete = async () => {};
  globalThis.state = { ...globalThis.state, autoScanEnabled: false, scannerModsMode: false };
  Object.assign(S, { isScanning: true, detectionLocked: false, lastHeaderText: "MISSION COMPLETE", lastHeaderOcrTime: 0, _ultimoRescate: Date.now(), latchedContext: "MISSION_COMPLETE", _franjaTickAnterior: null });
  S.ctxLatch = { latched: "MISSION_COMPLETE", candidate: null, count: 0 };
  S.mcLedger = { consensus: { items: { "Sevagoth Prime Blueprint": { score: 1, confirmed: false } } }, committed: null };
  const lienzo = new FakeCanvas(16, 9);
  try {
    await S.processFrame(frame(0), lienzo);
    assert.equal(textos.length, 2, "basura + título centrado, sin la pasada de tema y sin esperar 3 s");
    assert.equal(S.latchedContext, "MISSION_COMPLETE");
    assert.equal(S.mcLedger.consensus.items["Sevagoth Prime Blueprint"].score, 1, "el consenso en curso sigue vivo");
  } finally { Object.assign(OCRRepository, { workers: orig.workers }); SquadService.probe = orig.probe; S.processMissionComplete = orig.mc; S.isScanning = false; }
});

// "Con seguridad y lógica podemos descartar ese hash si se llega a otro mission complete": una
// pantalla de fin de misión no cambia hasta que el jugador pulsa. Leída y confirmada, se duerme:
// ni sellos ni OCR hasta otro fin de misión, salvo que el panel cambie de verdad (desplazamiento).
test("fin de misión leído entero se duerme hasta otro fin de misión", async () => {
  const { OCRRepository } = await import("../deploy/js/repositories/ocr.repository.js");
  const { PaddleRepository } = await import("../deploy/js/repositories/paddle.repository.js");
  const W = 640, H = 360;
  const cuadro = (v) => {
    const data = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < data.length; i += 4) { data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255; }
    return { videoWidth: W, videoHeight: H, width: W, height: H, data };
  };
  let ocr = 0;
  const { state } = await import("../deploy/js/state.js");
  const orig = { workers: OCRRepository.workers, listo: PaddleRepository.listo, commit: globalThis.commitMissionCompleteRewards, relics: state.allRelicNames };
  // Una reliquia: casa contra state.allRelicNames, que aquí se controla (el catálogo de piezas no está cargado).
  state.allRelicNames = ["Lith C1"];
  OCRRepository.workers = [{ recognize: async () => { ocr++; return { data: { text: "LITH C1 RELIC", blocks: [] } }; } }];
  PaddleRepository.listo = () => false;
  const commits = [], gastadas = [];
  globalThis.commitMissionCompleteRewards = (items, gastada) => { commits.push(items.map((i) => i.name)); gastadas.push(gastada); };
  const grid = { cells: [{ x: 300, y: 60, w: 50, h: 50, row: 0, col: 0, named: true, badge: "", qty: 1 }], accent: [190, 169, 102], pitch: 60, occluded: false, cut: false };
  // Una reliquia vista antes en la pantalla de reliquias, y una misión que solo da una reliquia:
  // sin piezas prime la misión no era una fisura y la reliquia no se ha gastado.
  const { RelicScreenService } = await import("../deploy/js/services/scanner/relic_screen.service.js");
  RelicScreenService.reset();
  RelicScreenService.reliquiaElegida = "Axi A5";
  Object.assign(S, { _mcStableHash: null, _mcGrid: null, _mcFrameCvs: null, _mcDormido: null, mcLedger: { consensus: { items: {} }, committed: null }, latchedContext: "MISSION_COMPLETE" });
  S._mcCache.clear();
  const dims = { width: W, height: H, scale: 1 };
  try {
    await S.processMissionComplete(cuadro(40), dims);          // fija la estabilidad
    S._mcGrid = { hash: S._mcStableHash, grid };
    await S.processMissionComplete(cuadro(40), dims);          // lee (OCR) → consenso 1
    await S.processMissionComplete(cuadro(40), dims);          // todo en caché → consenso 2, alta y a dormir
    assert.equal(ocr, 1);
    assert.deepEqual(commits, [["Lith C1"]]);
    assert.deepEqual(gastadas, [null], "sin recompensas prime no se descuenta la reliquia");
    assert.equal(RelicScreenService.reliquiaElegida, "Axi A5", "se guarda para la fisura");
    assert.ok(S._mcDormido, "leída entera: dormida");

    // Dormida: la deriva de la escena tras el panel (cambio pequeño) no despierta ni cuesta nada.
    const antes = S._mcCache.size;
    S._mcCache.clear();
    await S.processMissionComplete(cuadro(44), dims);
    assert.equal(ocr, 1, "sin OCR");
    assert.equal(S._mcCache.size, 0, "ni sellos: no se llega a las casillas");
    assert.ok(antes >= 1);

    // Un cambio grande del panel (desplazamiento) sí la despierta.
    await S.processMissionComplete(cuadro(200), dims);
    assert.equal(S._mcDormido, null);

  } finally { OCRRepository.workers = orig.workers; PaddleRepository.listo = orig.listo; globalThis.commitMissionCompleteRewards = orig.commit; state.allRelicNames = orig.relics; S._mcGrid = null; S._mcStableHash = null; S._mcDormido = null; S._mcCache.clear(); RelicScreenService.reset(); }
});

// --- Sensor entre ticks ------------------------------------------------------------------------
//
// "Quiero responsividad, sin escanear cada frame": con el auto-scan apagado el tick del inventario
// es de 3 s, y cambiar de pestaña tardaba eso en verse. El sensor se arma en los menús con tick
// largo; en UNKNOWN no, porque jugando la franja se para y arranca a cada rato y cada despertar
// sería un OCR de cabecera más.
test("el sensor se arma en los menús con tick largo, y nunca en UNKNOWN ni con tick corto", async () => {
  const W = 640, H = 360;
  globalThis.document._registrar("live-video", { videoWidth: W, videoHeight: H, width: W, height: H, data: new Uint8ClampedArray(W * H * 4), paused: false, ended: false });
  const orig = { proc: S.processFrame, sensor: S._sensor, si: globalThis.setInterval, ci: globalThis.clearInterval };
  const vivos = new Set();
  globalThis.setInterval = () => { const id = Symbol("sensor"); vivos.add(id); return id; };
  globalThis.clearInterval = (id) => { vivos.delete(id); };
  S._sensor = null;
  try {
    for (const [ctx, rate, armado] of [["INVENTORY", 3000, true], ["INVENTORY_MODS", 1000, true], ["UNKNOWN", 1000, false], ["REWARD", 400, false]]) {
      S.processFrame = async () => { S.latchedContext = ctx; S.currentRate = rate; };
      S.isScanning = true;
      await S.loop();
      assert.equal(vivos.size > 0, armado, `${ctx} con tick de ${rate} ms`);
      clearTimeout(S.scanInterval); S._sensor?.para();
    }
  } finally {
    S.processFrame = orig.proc; S.isScanning = false; clearTimeout(S.scanInterval); S._sensor?.para(); S._sensor = orig.sensor;
    Object.assign(globalThis, { setInterval: orig.si, clearInterval: orig.ci });
  }
});

// El tick despertado tiene que LEER: el reloj de la cabecera acaba de leer (hace 100 ms) y solo una
// franja vista quieta lo salta. Sin pasarle la muestra previa del sensor, el primer tick no sabía
// que el rótulo estaba parado y esperaba a otro (ver "una pantalla nueva parada se lee...").
test("despertado por el sensor, el rótulo nuevo se lee en ese mismo tick", async () => {
  const { OCRRepository } = await import("../deploy/js/repositories/ocr.repository.js");
  const { regionLuma } = await import("../deploy/js/utils/vision/frame_hash.js");
  const { FRANJA_TITULO_VIDEO, INITIAL_LATCH } = await import("../deploy/js/utils/vision/context_latch.js");
  const { sensorDelEscaner } = await import("../deploy/js/utils/vision/wake_sensor.js");
  const { FakeCanvas } = await import("./_helpers/fake-canvas.mjs");
  let lecturas = 0, vuelta = null;
  const orig = { workers: OCRRepository.workers, ruta: S.routeFrameAction, loop: S.loop, cvs: S.virtualCanvas, sensor: S._sensor };
  OCRRepository.workers = [{ recognize: async () => { lecturas++; return { data: { text: "INVENTORY/MODS" } }; } }];
  S.routeFrameAction = async () => { S.currentRate = 3000; };
  S.loop = function () { vuelta = orig.loop.call(this); return vuelta; };
  const video = globalThis.document._registrar("live-video", { ...(await cabeceraConRotulo()), paused: false, ended: false });
  const reloj = { fn: null, setInterval(fn) { this.fn = fn; return 1; }, clearInterval() { this.fn = null; } };
  Object.assign(S, { isScanning: true, detectionLocked: false, virtualCanvas: new FakeCanvas(16, 9), _sensor: null,
    lastHeaderText: "INVENTORY/SELL", lastHeaderOcrTime: Date.now() - 100, lastHeaderHash: regionLuma(video, FRANJA_TITULO_VIDEO),
    _headerEstable: 3, _headerCtxPrevio: "INVENTORY", latchedContext: "INVENTORY", ctxLatch: { ...INITIAL_LATCH, latched: "INVENTORY" }, _franjaTickAnterior: null });
  try {
    sensorDelEscaner(S, video, { reloj }).arma();
    video.data = (await cabeceraConRotulo({ invertido: true })).data;
    reloj.fn(); reloj.fn();
    assert.ok(vuelta, "el sensor despertó al bucle");
    await vuelta;
    assert.equal(lecturas, 1);
    assert.equal(S.ctxLatch.pending, "INVENTORY_MODS", "y el cambio de pestaña ya está en camino");
  } finally {
    Object.assign(OCRRepository, { workers: orig.workers });
    Object.assign(S, { routeFrameAction: orig.ruta, loop: orig.loop, virtualCanvas: orig.cvs, isScanning: false });
    clearTimeout(S.scanInterval); S._sensor?.para(); S._sensor = orig.sensor;
  }
});

// El recorte de cabecera (864×129, lienzo en CPU) se dibujaba en cada tick solo para sacar de él
// la franja del rótulo; ahora la franja sale del vídeo y el recorte solo se dibuja para el OCR.
test("un tick con la cabecera en caché no dibuja el recorte de cabecera; uno que la lee, sí", async () => {
  const { VisionService } = await import("../deploy/js/services/scanner/vision.service.js");
  const prep = VisionService.prepareVirtualCanvas;
  let dibujos = 0;
  VisionService.prepareVirtualCanvas = function (...a) { dibujos++; return prep.apply(this, a); };
  try {
    assert.equal(await lecturasDeCabecera({ haceMs: 5000, frame2: await cabeceraConRotulo({ filaCambiada: true }) }), 0);
    assert.equal(dibujos, 0);
    assert.equal(await lecturasDeCabecera({ haceMs: 1500, frame2: await cabeceraConRotulo({ invertido: true }) }), 1);
    assert.equal(dibujos, 1);
  } finally { VisionService.prepareVirtualCanvas = prep; }
});

test("con una carta de riven ya leída y quieta, el tick deja su región vigilada para el sensor", async () => {
  const { VisionService } = await import("../deploy/js/services/scanner/vision.service.js");
  const { firmaTexto } = await import("../deploy/js/utils/vision/frame_hash.js");
  const W = 640, H = 360, data = new Uint8ClampedArray(W * H * 4).fill(90);
  const video = { videoWidth: W, videoHeight: H, width: W, height: H, data };
  const orig = { l: S.lastParsedL, h: S.lastHashL };
  try {
    Object.assign(S, { lastParsedL: riven(), lastHashL: firmaTexto(video, VisionService.RIVEN_CARD_CROP), _cartaVigilada: null, _zonasCartas: null });
    await S.processRivenCard(video, { width: W, height: H, scale: 3 }, "INVENTORY_MODS");
    assert.deepEqual(S._cartaVigilada, [VisionService.RIVEN_CARD_CROP], "sin cartas localizadas aún, la zona entera");
    assert.equal(S.currentRate, S.RIVEN_RATE_IDLE);
  } finally { Object.assign(S, { lastParsedL: orig.l, lastHashL: orig.h, _cartaVigilada: null }); }
});

// Tras la Update 44 el desplegable de rivens no se abría: la carta se leía con la lista blanca de
// los rótulos (sin "+", "%" ni "."), así que el parser no encontraba ningún stat.
test("una carta de riven se lee con la lista de caracteres de rivens y abre el desplegable", async () => {
  const { OCRRepository } = await import("../deploy/js/repositories/ocr.repository.js");
  const { ESTADO_INICIAL } = await import("../deploy/js/utils/vision/no_result_skip.js");
  const { state } = await import("../deploy/js/state.js");
  const W = 640, H = 360, data = new Uint8ClampedArray(W * H * 4).fill(20);
  const video = { videoWidth: W, videoHeight: H, width: W, height: H, data };
  const orig = { leer: OCRRepository.recognizeWithChars, workers: OCRRepository.workers, show: globalThis.showRivenAppraisal,
    S: { lastParsedL: S.lastParsedL, lastParsedR: S.lastParsedR, lastHashL: S.lastHashL, lastNoResult: S.lastNoResult, rivenConsensusBuffer: S.rivenConsensusBuffer },
    names: state.allRivenNames, map: state.weaponMap };
  let lista = null, mostrado = null;
  OCRRepository.workers = [{}];
  OCRRepository.recognizeWithChars = async (_w, _img, chars) => {
    lista = chars;
    return { data: { text: "Dread Acricron\n+187.6% Critical Chance\n+150.9% Critical Damage\nMR 10" } };
  };
  globalThis.showRivenAppraisal = (l) => { mostrado = l; };
  Object.assign(state, { allRivenNames: ["Dread"], weaponMap: { Dread: { d: 1.25, t: "Bow" } } });
  Object.assign(S, { lastParsedL: null, lastParsedR: null, lastHashL: null, lastNoResult: ESTADO_INICIAL, rivenConsensusBuffer: [] });
  try {
    // Dos lecturas: lo que se ve solo cambia cuando dos seguidas dicen lo mismo.
    await S.processRivenCard(video, { width: W, height: H, scale: 3 }, "INVENTORY_MODS");
    await S.processRivenCard(video, { width: W, height: H, scale: 3 }, "INVENTORY_MODS");
    assert.equal(lista, OCRRepository.RIVEN_CHARS);
    assert.equal(mostrado?.weaponName, "Dread");
    assert.deepEqual(mostrado.stats.map((s) => s.value), [187.6, 150.9]);
  } finally {
    Object.assign(OCRRepository, { recognizeWithChars: orig.leer, workers: orig.workers });
    globalThis.showRivenAppraisal = orig.show;
    Object.assign(S, orig.S);
    Object.assign(state, { allRivenNames: orig.names, weaponMap: orig.map });
  }
});

// --- Responsividad en la pantalla de ciclar -------------------------------------------------------
// Pantalla de mentira: cada carta es un rectángulo claro y el OCR devuelve el texto que se le pase.
// `linea` cambia una línea de texto dentro de la primera carta; `fondo`, algo que se mueve fuera de
// las cartas (el cristal y las partículas de la pantalla real).
function pantallaCiclo(xs, { linea = false, fondo = false } = {}) {
  const W = 640, H = 360, data = new Uint8ClampedArray(W * H * 4).fill(20);
  const pinta = (x0, x1, y0, y1, v = 190) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * W + x) * 4; data[i] = data[i + 1] = data[i + 2] = v; }
  };
  for (const x0 of xs) pinta(x0, x0 + 90, 200, 300);
  if (linea) pinta(xs[0] + 10, xs[0] + 80, 250, 256, 60);
  if (fondo) pinta(95, 140, 190, 310, 230);
  const cartas = xs.map((x0) => ({ x: x0 / W, y: 200 / H, w: 90 / W, h: 100 / H }));
  return { videoWidth: W, videoHeight: H, width: W, height: H, data, cartas };
}
const CARTA_A = "Dread Acricron\n+187.6% Critical Chance\n+150.9% Critical Damage\nMR 10";
const CARTA_B = "Dread Satiacri\n+139.2% Multishot\n+185.0% Critical Damage\n-37.3% Zoom\nMR 10";
const CARTA_C = "Dread Satiterra\n+111.4% Multishot\n+74.6% Fire Rate\nMR 10";

async function enPantallaDeCiclo(fn) {
  const { OCRRepository } = await import("../deploy/js/repositories/ocr.repository.js");
  const { VisionService } = await import("../deploy/js/services/scanner/vision.service.js");
  const { ESTADO_INICIAL } = await import("../deploy/js/utils/vision/no_result_skip.js");
  const { state } = await import("../deploy/js/state.js");
  const campos = ["lastParsedL", "lastParsedR", "lastHashL", "lastNoResult", "rivenConsensusBuffer", "oneCardStreak",
    "newCardStreak", "weaponSwitchCandidate", "weaponSwitchStreak", "lastTwoCardHash", "currentRate", "_zonasCartas"];
  const orig = { S: Object.fromEntries(campos.map((k) => [k, S[k]])), leer: OCRRepository.recognizeWithChars,
    workers: OCRRepository.workers, segundo: OCRRepository.ensureSecondWorker, prep: VisionService.prepareRivenCardCanvases,
    show: globalThis.showRivenAppraisal, names: state.allRivenNames, map: state.weaponMap };
  const vistos = [], lecturas = { n: 0 };
  let textos = [];
  OCRRepository.workers = [{}];
  OCRRepository.ensureSecondWorker = async () => {};
  OCRRepository.recognizeWithChars = async (_w, img) => { lecturas.n++; return { data: { text: img.texto } }; };
  VisionService.prepareRivenCardCanvases = (video) => textos.map((texto, i) => ({ width: 400, height: 300, texto, zonaVideo: video.cartas?.[i] }));
  globalThis.showRivenAppraisal = (l, r) => vistos.push([l?.stats.map((s) => s.name).join("+") ?? null, r ? r.stats.map((s) => s.name).join("+") : null]);
  Object.assign(state, { allRivenNames: ["Dread"], weaponMap: { Dread: { d: 1.25, t: "Bow" } } });
  Object.assign(S, { lastParsedL: null, lastParsedR: null, lastHashL: null, lastNoResult: ESTADO_INICIAL, rivenConsensusBuffer: [],
    oneCardStreak: 0, newCardStreak: 0, weaponSwitchCandidate: null, weaponSwitchStreak: 0, lastTwoCardHash: null, _zonasCartas: null });
  const lee = async (video, ...t) => {
    textos = t;
    S.currentRate = S.RIVEN_RATE_ACTIVE;
    await S.processRivenCard(video, { width: 640, height: 360, scale: 3 }, "INVENTORY_MODS");
  };
  const muestra = async (video, ...t) => { await lee(video, ...t); await lee(video, ...t); };
  try {
    await fn({ lee, muestra, vistos, lecturas });
  } finally {
    Object.assign(S, orig.S);
    Object.assign(OCRRepository, { recognizeWithChars: orig.leer, workers: orig.workers, ensureSecondWorker: orig.segundo });
    VisionService.prepareRivenCardCanvases = orig.prep;
    globalThis.showRivenAppraisal = orig.show;
    Object.assign(state, { allRivenNames: orig.names, weaponMap: orig.map });
  }
}

// Con el hash de 16x9 cambiar el texto de una carta no contaba como cambio: si el cristal del fondo
// no se movía, la tirada nueva no se leía nunca (medido en capturas reales de la pantalla de ciclar).
test("una línea de texto distinta en la carta se relee; la misma pantalla no", async () => {
  await enPantallaDeCiclo(async ({ lee, muestra, lecturas }) => {
    await muestra(pantallaCiclo([300]), CARTA_A);
    const n = lecturas.n;
    await lee(pantallaCiclo([300]), CARTA_A);
    assert.equal(lecturas.n, n, "pantalla quieta ya leída: sin OCR");
    await lee(pantallaCiclo([300], { linea: true }), CARTA_C);
    assert.equal(lecturas.n, n + 1);
  });
});

test("una tirada nueva pendiente de confirmar se relee enseguida, no al ritmo normal", async () => {
  await enPantallaDeCiclo(async ({ lee, muestra, vistos }) => {
    await muestra(pantallaCiclo([300]), CARTA_A);
    await lee(pantallaCiclo([250]), CARTA_C);
    assert.deepEqual(vistos.at(-1), ["Crit Chance+Crit Damage", null], "una lectura sola no cambia lo mostrado");
    assert.equal(S.currentRate, S.RIVEN_RATE_CONFIRM);
    await lee(pantallaCiclo([250]), CARTA_C);
    assert.deepEqual(vistos.at(-1), ["Multishot+Fire Rate / Attack Speed", null]);
  });
});

test("al elegir una carta tras ciclar, la otra se quita a la segunda lectura", async () => {
  await enPantallaDeCiclo(async ({ lee, muestra, vistos }) => {
    const dos = pantallaCiclo([150, 400]), una = pantallaCiclo([150]);
    await muestra(dos, CARTA_A, CARTA_B);
    assert.deepEqual(vistos.at(-1), ["Crit Chance+Crit Damage", "Multishot+Crit Damage+Zoom"]);
    await lee(una, CARTA_A);
    assert.ok(S.lastParsedR, "con una sola lectura todavía no");
    assert.equal(S.currentRate, S.RIVEN_RATE_CONFIRM);
    await lee(una, CARTA_A);
    assert.equal(S.lastParsedR, null);
    assert.deepEqual(vistos.at(-1), ["Crit Chance+Crit Damage", null]);
  });
});

// Si la carta elegida se lee MEJOR que antes (aquí recupera el negativo), esa lectura se muestra al
// momento; pero la bajada a una carta sigue a medias y guardar ya la huella dejaba la otra puesta.
test("al elegir la carta que se había leído a medias, se queda la lectura completa y la otra se quita", async () => {
  await enPantallaDeCiclo(async ({ lee, muestra, vistos }) => {
    // Sin stats en común con CARTA_A: la identidad laxa tolera uno distinto y las confundiría.
    const entera = "Dread Satiterra\n+139.2% Multishot\n+93.3% Fire Rate\n-37.3% Zoom\nMR 10";
    const sinNegativo = "Dread Satiterra\n+139.2% Multishot\n+93.3% Fire Rate\nMR 10";
    await muestra(pantallaCiclo([150, 400]), CARTA_A, sinNegativo);
    const una = pantallaCiclo([400]);
    await lee(una, entera);
    assert.deepEqual(vistos.at(-1), ["Crit Chance+Crit Damage", "Multishot+Fire Rate / Attack Speed"], "una lectura sola no cambia nada");
    await lee(una, entera);
    assert.deepEqual(vistos.at(-1), [null, "Multishot+Fire Rate / Attack Speed+Zoom"]);
  });
});

// En el juego el cristal morado y las partículas se mueven siempre: vigilando la zona entera, la
// pantalla quieta nunca "estaba quieta" y el escáner releía y repintaba el HUD sin parar.
test("lo que se mueve fuera de las cartas no hace releer; un cambio dentro de una carta sí", async () => {
  await enPantallaDeCiclo(async ({ lee, muestra, lecturas }) => {
    await muestra(pantallaCiclo([300]), CARTA_A);
    const n = lecturas.n;
    await lee(pantallaCiclo([300], { fondo: true }), CARTA_A);
    assert.equal(lecturas.n, n, "el fondo animado no cuenta");
    assert.deepEqual(S._cartaVigilada, [pantallaCiclo([300]).cartas[0]], "el sensor vigila la carta, no la zona entera");
    await lee(pantallaCiclo([300], { fondo: true, linea: true }), CARTA_C);
    assert.equal(lecturas.n, n + 1);
  });
});

test("cada recorte de carta dice dónde está esa carta en el vídeo", async () => {
  const { VisionService } = await import("../deploy/js/services/scanner/vision.service.js");
  globalThis.ImageData ??= class { constructor(data, width, height) { Object.assign(this, { data, width, height }); } };
  const W = 1280, H = 720, data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) data.set([20, 15, 30, 255], i * 4);
  // "Texto" lavanda, el color de las cartas, en x 600-697 e y 450-555 del vídeo.
  for (let y = 450; y < 560; y += 16) for (let x = 600; x < 700; x += 5) {
    for (let dy = 0; dy < 9; dy++) for (let dx = 0; dx < 2; dx++) data.set([205, 185, 235], ((y + dy) * W + x + dx) * 4);
  }
  const [carta] = VisionService.prepareRivenCardCanvases({ videoWidth: W, videoHeight: H, width: W, height: H, data }, 1080 / H, VisionService.RIVEN_CARD_CROP);
  const z = carta.zonaVideo;
  const px = [z.x * W, z.y * H, (z.x + z.w) * W, (z.y + z.h) * H].map(Math.round);
  for (const [real, esperado] of px.map((v, i) => [v, [600, 450, 697, 555][i]])) {
    assert.ok(Math.abs(real - esperado) <= 6, `zona ${px} frente a 600,450,697,555`);
  }
});

// Lo que se veía en la pantalla de ciclar: el OCR daba una lectura y luego otra, y con "2 de 3" y
// los atajos el HUD enseñaba las dos por turnos.
test("si el OCR alterna entre dos lecturas no se enseña ninguna hasta que dos seguidas coinciden", async () => {
  await enPantallaDeCiclo(async ({ lee, vistos }) => {
    const pantalla = pantallaCiclo([300]);
    for (const carta of [CARTA_A, CARTA_C, CARTA_A, CARTA_C]) await lee(pantalla, carta);
    assert.deepEqual(vistos, [], "nada confirmado, nada que parpadee");
    await lee(pantalla, CARTA_C);
    assert.deepEqual(vistos, [["Multishot+Fire Rate / Attack Speed", null]]);
  });
});

// Con el bloqueo de la U44 la carta vieja y la nueva comparten el stat bloqueado, con el mismo
// valor, y a veces el negativo: por nombres se tomaba una por la otra.
test("dos cartas que comparten el stat bloqueado no se toman por el mismo riven", () => {
  const st = (name, value, isPositive = true) => ({ name, value, isPositive });
  const nueva = { weaponName: "Verglas", rolls: null, stats: [st("Multishot", 119.9), st("Status Chance", 108.8), st("Crit Chance", 170.9), st("Damage to Corpus", 48, false)] };
  const vieja = { weaponName: "Verglas", rolls: null, stats: [st("Reload Speed", 59.1), st("Fire Rate / Attack Speed", 70.4), st("Crit Chance", 170.9), st("Damage to Corpus", 47, false)] };
  assert.equal(S._isSameRivenIdentity(nueva, vieja), false);
  assert.equal(S._isSameRivenIdentity({ ...vieja, stats: vieja.stats.slice(1) }, nueva), false, "tampoco leyendo la vieja a medias");
  assert.equal(S._isSameRivenIdentity({ ...nueva, stats: nueva.stats.slice(0, 3) }, nueva), true, "la misma carta sin el negativo");
  assert.equal(S._isSameRivenIdentity({ ...nueva, stats: [st("Multishot", 19.9), ...nueva.stats.slice(1)] }, nueva), true, "un valor mal leído");
});

// Con el vídeo a 0×0 (la ventana del juego cambia de tamaño o pasa por una carga) todos los
// recortes salían de 0 px y Tesseract fallaba al leerlos.
test("sin dimensiones de vídeo el tick no procesa y vuelve a mirar en un segundo", async () => {
  globalThis.document._registrar("live-video", { videoWidth: 0, videoHeight: 0, paused: false, ended: false });
  const orig = S.processFrame;
  let procesados = 0;
  S.processFrame = async () => { procesados++; };
  S.isScanning = true;
  try {
    await S.loop();
    assert.equal(procesados, 0);
    assert.ok(S.scanInterval, "reintenta");
  } finally {
    S.processFrame = orig; S.isScanning = false; clearTimeout(S.scanInterval);
  }
});
