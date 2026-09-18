import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

// a read with no digits is not a vote, it is OCR returning garbage; with no votes quantity stays UNKNOWN
// (null): recording a 1 as fallback overwrote the real count on save (18 relics with unread badges dropped
// from 28 copies to 1)
test("una lectura sin dígitos no vota y sin votos la cantidad es desconocida, nunca 1", () => {
  const votos = new Map(), destino = new Map();
  S.recordQtyVote("X", { qty: 1, raw: "" }, votos, destino);
  assert.equal(destino.get("X"), null, "sin votos válidos no se inventa un 1");
  assert.ok(destino.has("X"), "pero la pieza queda vista");

  S.recordQtyVote("X", { qty: 7, raw: "7" }, votos, destino);
  S.recordQtyVote("X", { qty: 99, raw: "" }, votos, destino);
  assert.equal(destino.get("X"), 7, "el voto válido manda sobre la lectura sin dígitos");
});

// under the HUD icon bar template-matching returns strings like "85603": parsing turned them into qty 1
// and, having a digit, they cast a vote for that 1
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

// checked on SOURCE instead of running on purpose: a structural invariant ("expensive call sits behind
// this guard") whose live reproduction would need the full OCR stack and a browser decoding images
const SRC = readFileSync(new URL("../deploy/js/services/scanner/scanner.service.js", import.meta.url), "utf8");

// cost 1.9 GB of tab memory on a large inventory: each scanned page ran toDataURL on the whole grid and
// the HUD rebuilt its 10 thumbnails; browsers decode each <img> EVEN IF its container has display:none,
// discarding and recreating ~6 MB x 10 per page until GC choked
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

// tested on source because reaching this needs the full OCR stack: if invalidation excludes the ZONE, the
// misaligned crop persists and every page returns skewed in an unreadable loop
test("una página que no casa nada invalida también la zona de recorte", () => {
  const i = SRC.indexOf("revision.reDetectar");
  assert.notEqual(i, -1, "falta la revisión de la rejilla cacheada");
  const bloque = SRC.slice(i, i + 600);
  assert.match(bloque, /this\._frameZoneCache = null/, "sin esto se vuelve a detectar dentro del mismo recorte malo");
  assert.match(bloque, /this\._autoCalibCache = null/);
});

// log entries are strings needed by "COPY LOG": always saved, otherwise debugging a scan would require
// reproducing it with the panel open
test("el log del escaneo se sigue guardando aunque el panel esté cerrado", () => {
  const i = SRC.indexOf("this.debugHistory.unshift(");
  const bloque = SRC.slice(i, i + 400);
  assert.match(bloque, /log:\s*\[\.\.\.this\.lastRawOcrLog\]/);
  assert.ok(!/log:\s*debugVisible/.test(bloque), "el log no puede depender del panel");
});

test("el recorte de página deja una celda entera de margen sobre la primera fila", async () => {
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

  assert.ok(
    recorte.sy <= calib.gridZone.y - calib.cellH,
    `el recorte empieza en ${recorte.sy}, a menos de una celda (${calib.cellH}) de la primera fila (${calib.gridZone.y})`,
  );
  assert.equal(recorte.sy + recorte.sh, H);
  assert.equal(recorte.sx, calib.gridZone.x);
  assert.equal(recorte.sw, calib.gridZone.w);
});

// auto-scan triggered on still screens because it watched half the screen, where the sell panel, plat
// counter and animated background change on their own; it failed on RELICS, where cards look identical and
// only text changes
test("el auto-scan mira solo la zona de recorte, y ahí le basta con que cambie el texto", async () => {
  const { FakeCanvas } = await import("./_helpers/fake-canvas.mjs");
  const W = 800, H = 600;
  const zona = { x: 0, y: 0, w: 400, h: H };

  // identical "art" across the zone; text is a band shifting position; outside the zone, an independently
  // changing panel (like the sell panel)
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
    await S.routeFrameAction("INVENTORY", base, dims);   // first frame: reference only
    S.autoScrollMuestra = muestraDe(base);               // this page has already been scanned
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
// which grid is accepted before reading the page: this decision (detected in this frame / inherited from
// previous / manual) had no tests, slipping a bug that left the scanner reading NOTHING live while 1600
// tests stayed green: the phase filter was applied to newly detected grids, whose bands differ when
// anchored by colour
test("la rejilla detectada en este frame no la tumba el filtro de fase", async () => {
  const { VisionService } = await import("../deploy/js/services/scanner/vision.service.js");
  const detect = VisionService.detectGridAutoCalib, build = VisionService.buildAutoGrid;
  const rejilla = { gridZone: { x: 0, y: 236, w: 1662, h: 888 }, cellW: 277, cellH: 296, cols: 6, rows: 3, auto: true };
  VisionService.detectGridAutoCalib = () => rejilla;
  VisionService.buildAutoGrid = () => ({ cellRects: [], cellW: 277, cellH: 296, cols: 6, rows: 3 }); // cuts off right after the filter
  VisionService.ultimasBandas = [{ y0: 900, y1: 950, mass: 900 }]; // do not match the grid

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
  VisionService.detectGridAutoCalib = () => null; // no signal in this frame
  VisionService.ultimasBandas = [{ y0: 460, y1: 508, mass: 9000 }, { y0: 756, y1: 804, mass: 9000 }];

  S._autoCalibCache = { key: "1662x1440", calib: { gridZone: { x: 0, y: 700, w: 1662, h: 888 }, cellW: 277, cellH: 296, cols: 6, rows: 3 } };
  S._frameZoneCache = { key: "1662x1440", zone: { x: 0, y: 0, w: 1662, h: 1440 } };
  S.detectionLocked = false;
  await S.processInventoryGrid({ width: 1662, height: 1440, getContext: () => null }, 1662, 1440, 1);

  VisionService.detectGridAutoCalib = detect;
  assert.equal(S._autoCalibCache, null, "la rejilla de otra página no vale para esta");
  assert.equal(S._frameZoneCache, null, "y el recorte que la produjo tampoco");
});
