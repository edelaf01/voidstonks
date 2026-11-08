import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeDocument } from "./_helpers/fake-canvas.mjs";

installFakeDocument();
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const { ScannerService: S } = await import("../deploy/js/services/scanner/scanner.service.js");
const { VisionService } = await import("../deploy/js/services/scanner/vision.service.js");
const { BusquedaInventarioService } = await import("../deploy/js/services/scanner/busqueda_inventario.service.js");
const { state } = await import("../deploy/js/state.js");
await import("../deploy/js/scanner/live_scanner.js");
const { FakeCanvas } = await import("./_helpers/fake-canvas.mjs");
const { makeInventoryFrame } = await import("./_helpers/inventory-frame.mjs");
const { capturaConsola, paginaSintetica, montaContexto } = await import("./_helpers/busqueda-cadena.mjs");
const { catalogoPrime } = await import("./_helpers/prime-catalog.mjs");

test("Bronco de punta a punta", async () => {
  const { logs, para } = capturaConsola();
  const ctx = montaContexto();
  try {
    const normal = paginaSintetica("all");
    await ctx.pasaPagina(normal);

    BusquedaInventarioService.lee = async () => ({ tipo: "piezas", texto: "bronco" });

    const f1 = paginaSintetica([0], 1);
    await ctx.pasaPagina(f1);

    const f2 = paginaSintetica([0], 2);
    await ctx.pasaPagina(f2);

    assert.ok(logs.includes('[BUSQ] piezas "bronco": 1 a la vista, 1 sin salir'));
    assert.ok(logs.includes('[BUSQ] piezas "bronco": 1 a la vista, 1 sin salir · a 0: Bronco Prime Barrel'));
    assert.equal(state.primeInventory["Bronco Prime Barrel"], 0);
    assert.equal(state.primeInventory["Akbronco Prime Blueprint"], 1);
    assert.equal(S._autoCalibCache?.calib?.deBusqueda, true);
    assert.equal(S._autoCalibCache?.calib?.deMemoria, true);
    assert.equal(S._autoCalibCache?.calib?.cols, 6);
    assert.equal(S._autoCalibCache?.calib?.rows, 3);
    assert.equal(S._autoCalibCache?.calib?.cellH, 222);
  } finally {
    para();
    ctx.limpia();
  }
});


test("una sola página de búsqueda deja el stock intacto tras un único voto", async () => {
  const { logs, para } = capturaConsola();
  const ctx = montaContexto();
  try {
    const normal = paginaSintetica("all");
    await ctx.pasaPagina(normal);

    BusquedaInventarioService.lee = async () => ({ tipo: "piezas", texto: "bronco" });

    const f1 = paginaSintetica([0], 1);
    await ctx.pasaPagina(f1);

    assert.ok(logs.includes('[BUSQ] piezas "bronco": 1 a la vista, 1 sin salir'));
    assert.ok(!logs.some((l) => l.includes("· a 0:")));
    assert.equal(state.primeInventory["Bronco Prime Barrel"], 8);
    assert.equal(state.primeInventory["Akbronco Prime Blueprint"], 1);
  } finally {
    para();
    ctx.limpia();
  }
});


test("sin página normal previa se salta la página sin buscar ni llamar a onCero", async () => {
  const { logs, para } = capturaConsola();
  const ctx = montaContexto();
  let llamoOnCero = false;
  const prevOnCero = BusquedaInventarioService.onCero;
  BusquedaInventarioService.onCero = (...a) => {
    llamoOnCero = true;
    return prevOnCero?.(...a);
  };
  try {
    BusquedaInventarioService.lee = async () => ({ tipo: "piezas", texto: "bronco" });

    const f1 = paginaSintetica([0], 1);
    await ctx.pasaPagina(f1);

    assert.ok(!logs.some((l) => l.includes("[BUSQ]")));
    assert.ok(logs.some((l) => l.includes("[INV] Página saltada: sin rejilla")));
    assert.equal(state.primeInventory["Bronco Prime Barrel"], 8);
    assert.equal(llamoOnCero, false);
  } finally {
    para();
    BusquedaInventarioService.onCero = prevOnCero;
    ctx.limpia();
  }
});

test("página con 18 resultados deja la búsqueda incompleta y no baja stock", async () => {
  const { logs, para } = capturaConsola();
  const ctx = montaContexto();
  try {
    state.primeInventory["Wukong Prime Blueprint"] = 4;
    const normal = paginaSintetica("all");
    await ctx.pasaPagina(normal);

    BusquedaInventarioService.lee = async () => ({ tipo: "piezas", texto: "bronco" });

    const f1 = paginaSintetica("all", 2);
    await ctx.scrollFrame();
    await ctx.pasaPagina(f1);

    await ctx.scrollFrame();
    const f2 = paginaSintetica("all", 3);
    await ctx.pasaPagina(f2);

    assert.equal(S._autoCalibCache?.calib?.deBusqueda, undefined);
    assert.equal(state.primeInventory["Bronco Prime Barrel"], 8);
    assert.equal(state.primeInventory["Akbronco Prime Blueprint"], 1);
    assert.equal(state.primeInventory["Wukong Prime Blueprint"], 4);
    assert.equal(logs.filter((l) => l.includes("[BUSQ]")).length, 2);
    assert.ok(logs.some((l) => l.includes("[BUSQ]") && l.includes("incompleta")));
    assert.ok(!logs.some((l) => l.includes("· a 0:")));
  } finally {
    para();
    ctx.limpia();
  }
});


test("celda ilegible deja la búsqueda incompleta y no baja stock", async () => {
  const { logs, para } = capturaConsola();
  const ctx = montaContexto();
  try {
    const normal = paginaSintetica("all");
    await ctx.pasaPagina(normal);

    BusquedaInventarioService.lee = async () => ({ tipo: "piezas", texto: "bronco" });
    ctx.worker.recognize = async () => ({
      data: {
        text: "XQZ WVT",
        words: [
          { text: "XQZ", confidence: 90, bbox: { x0: 0, y0: 0, x1: 50, y1: 20 } },
          { text: "WVT", confidence: 90, bbox: { x0: 55, y0: 0, x1: 100, y1: 20 } }
        ],
        confidence: 90
      }
    });

    const f1 = paginaSintetica([0], 1);
    await ctx.pasaPagina(f1);

    await ctx.scrollFrame();
    const f2 = paginaSintetica([0], 2);
    await ctx.pasaPagina(f2);

    assert.equal(logs.filter((l) => l.includes("[BUSQ]")).length, 2);
    assert.ok(logs.some((l) => l.includes("[BUSQ]") && l.includes("incompleta")));
    assert.ok(!logs.some((l) => l.includes("· a 0:")));
    assert.equal(state.primeInventory["Bronco Prime Barrel"], 8);
    assert.equal(state.primeInventory["Akbronco Prime Blueprint"], 1);
  } finally {
    para();
    ctx.limpia();
  }
});


test("con dos resultados de nombres distintos baja el fantasma y no los visibles", async () => {
  const { logs, para } = capturaConsola();
  let indiceCelda = 0;
  const ctx = montaContexto(async () => {
    indiceCelda++;
    const text = indiceCelda % 2 === 1 ? "AKBRONCO PRIME BLUEPRINT" : "BRONCO PRIME RECEIVER";
    const words = text.split(" ").map((w, i) => ({ text: w, confidence: 90, bbox: { x0: i * 50, y0: 0, x1: (i + 1) * 50, y1: 20 } }));
    return { data: { text, words, confidence: 90 } };
  });
  try {
    state.primeInventory = {
      "Bronco Prime Barrel": 8,
      "Akbronco Prime Blueprint": 1,
      "Bronco Prime Receiver": 2
    };

    const normal = paginaSintetica("all");
    await ctx.pasaPagina(normal);

    BusquedaInventarioService.lee = async () => ({ tipo: "piezas", texto: "bronco" });

    const f1 = paginaSintetica([0, 1], 1);
    await ctx.pasaPagina(f1);

    await ctx.scrollFrame();

    const f2 = paginaSintetica([0, 1], 2);
    await ctx.pasaPagina(f2);

    assert.equal(state.primeInventory["Bronco Prime Barrel"], 0);
    assert.equal(state.primeInventory["Akbronco Prime Blueprint"], 1);
    assert.equal(state.primeInventory["Bronco Prime Receiver"], 2);
    assert.ok(logs.includes('[BUSQ] piezas "bronco": 2 a la vista, 1 sin salir · a 0: Bronco Prime Barrel'));
  } finally {
    para();
    ctx.limpia();
  }
});


test("dos Akbronco a la vista alargan la consulta a kbronco y no votan contra Bronco", async () => {
  const { logs, para } = capturaConsola();
  let indiceCelda = 0;
  const ctx = montaContexto(async () => {
    indiceCelda++;
    const text = indiceCelda % 2 === 1 ? "AKBRONCO PRIME BLUEPRINT" : "AKBRONCO PRIME LINK";
    const words = text.split(" ").map((w, i) => ({ text: w, confidence: 90, bbox: { x0: i * 50, y0: 0, x1: (i + 1) * 50, y1: 20 } }));
    return { data: { text, words, confidence: 90 } };
  });
  try {
    state.primeInventory = {
      "Bronco Prime Barrel": 8,
      "Akbronco Prime Blueprint": 1,
      "Akbronco Prime Link": 2
    };

    const normal = paginaSintetica("all");
    await ctx.pasaPagina(normal);

    BusquedaInventarioService.lee = async () => ({ tipo: "piezas", texto: "bronco" });

    const f1 = paginaSintetica([0, 1], 1);
    await ctx.pasaPagina(f1);

    await ctx.scrollFrame();

    const f2 = paginaSintetica([0, 1], 2);
    await ctx.pasaPagina(f2);

    assert.equal(state.primeInventory["Bronco Prime Barrel"], 8);
    assert.equal(state.primeInventory["Akbronco Prime Blueprint"], 1);
    assert.equal(state.primeInventory["Akbronco Prime Link"], 2);
    assert.ok(!logs.some((l) => l.includes("· a 0:")));
    const lineasBusq = logs.filter((l) => l.includes("[BUSQ]"));
    assert.ok(lineasBusq.length >= 2);
    assert.ok(lineasBusq.every((l) => l.includes("kbronco")));
  } finally {
    para();
    ctx.limpia();
  }
});


test("frame sin bandas con búsqueda y zona válida conserva la zona y anula la calibración", async () => {
  const ctx = montaContexto();
  try {
    const snapshot = new FakeCanvas(1248, 897);
    S.detectionLocked = false;
    S._autoCalibCache = { key: "1248x897", calib: { cellW: 208, cellH: 222, cols: 6, rows: 3 } };
    S._frameZoneCache = { key: "1248x897", zone: { x: 66, y: 183, w: 1248, h: 897 } };
    const busqueda = { tipo: "piezas", texto: "bronco" };

    await S.processInventoryGrid(snapshot, 1248, 897, 1, 1248, "INVENTORY", busqueda);

    assert.equal(S._autoCalibCache, null);
    assert.notEqual(S._frameZoneCache, null);
    assert.deepEqual(S._frameZoneCache.zone, { x: 66, y: 183, w: 1248, h: 897 });
  } finally {
    ctx.limpia();
  }
});

test("frame sin bandas con búsqueda y zona nula anula la calibración y la zona", async () => {
  const ctx = montaContexto();
  try {
    const snapshot = new FakeCanvas(1248, 897);
    S.detectionLocked = false;
    S._autoCalibCache = { key: "1248x897", calib: { cellW: 208, cellH: 222, cols: 6, rows: 3 } };
    S._frameZoneCache = { key: "1248x897", zone: null };
    const busqueda = { tipo: "piezas", texto: "bronco" };

    await S.processInventoryGrid(snapshot, 1248, 897, 1, 1248, "INVENTORY", busqueda);

    assert.equal(S._autoCalibCache, null);
    assert.equal(S._frameZoneCache, null);
  } finally {
    ctx.limpia();
  }
});

test("frame sin bandas sin búsqueda anula la calibración y la zona", async () => {
  const ctx = montaContexto();
  try {
    const snapshot = new FakeCanvas(1248, 897);
    S.detectionLocked = false;
    S._autoCalibCache = { key: "1248x897", calib: { cellW: 208, cellH: 222, cols: 6, rows: 3 } };
    S._frameZoneCache = { key: "1248x897", zone: { x: 66, y: 183, w: 1248, h: 897 } };

    await S.processInventoryGrid(snapshot, 1248, 897, 1, 1248, "INVENTORY", null);

    assert.equal(S._autoCalibCache, null);
    assert.equal(S._frameZoneCache, null);
  } finally {
    ctx.limpia();
  }
});

test("cero aciertos con búsqueda conserva la calibración sin reintentar rejilla", async () => {
  const ctx = montaContexto(async () => ({ data: { text: "", words: [], confidence: 0 } }));
  try {
    const frame = makeInventoryFrame({
      width: 1248, height: 666, gridX: 0, gridY: 0, cellW: 208, cellH: 222, cols: 6, rows: 3,
      filled: "all", art: [180, 160, 140]
    });
    const snapshot1 = new FakeCanvas(1248, 666);
    snapshot1.data.set(frame.data);

    VisionService._memoriasRejilla.clear();
    S.detectionLocked = false;
    S._gridReintentado = false;
    S._autoCalibCache = null;
    const busqueda = { tipo: "piezas", texto: "bronco" };
    await S.processInventoryGrid(snapshot1, 1248, 666, 1, 1248, "INVENTORY", busqueda);

    assert.notEqual(S._autoCalibCache, null);
    assert.equal(S._gridReintentado, false);

    const snapshot2 = new FakeCanvas(1248, 666);
    snapshot2.data.set(frame.data);

    VisionService._memoriasRejilla.clear();
    S.detectionLocked = false;
    S._gridReintentado = false;
    S._autoCalibCache = null;
    await S.processInventoryGrid(snapshot2, 1248, 666, 1, 1248, "INVENTORY", null);

    assert.equal(S._autoCalibCache, null);
    assert.equal(S._gridReintentado, true);
  } finally {
    ctx.limpia();
  }
});

test("rejilla de búsqueda sin badges en primera fila procesa todas las celdas", async () => {
  const { logs, para } = capturaConsola();
  const ctx = montaContexto(async () => ({
    data: {
      text: "AKBRONCO PRIME BLUEPRINT",
      words: [{ text: "AKBRONCO", bbox: { x0: 0, y0: 0, x1: 50, y1: 20 } }],
      confidence: 90
    }
  }));
  try {
    VisionService._memoriasRejilla.clear();
    VisionService._memoriasRejilla.set("INVENTORY|1248x897", { cellW: 208, cellH: 222, cols: 6, gridX: 0 });

    const frame = makeInventoryFrame({
      width: 1248, height: 897, gridX: 0, gridY: -6, cellW: 208, cellH: 222, cols: 6, rows: 3,
      filled: [0], art: [180, 160, 140]
    });
    const snapshot = new FakeCanvas(1248, 897);
    snapshot.data.set(frame.data);

    S.detectionLocked = false;
    S._gridReintentado = false;
    S._autoCalibCache = null;
    S._frameZoneCache = { key: "1248x897", zone: { x: 67, y: 183, w: 1248, h: 897, hud: 100 } };
    const busqueda = { tipo: "piezas", texto: "bronco" };

    await S.processInventoryGrid(snapshot, 1248, 897, 1, 1248, "INVENTORY", busqueda);

    assert.ok(logs.some((l) => l.includes("[INV] Preparadas 18 celdas")));
    assert.ok(S.lastRawOcrLog.some((l) => l.includes("cells 18/18")));
  } finally {
    para();
    ctx.limpia();
  }
});


test("memoria de 4 columnas aprendida con 16 items no vota las celdas de la derecha al buscar con 5 resultados", async () => {
  const { logs, para } = capturaConsola();
  const nombresVisibles = [
    "BRONCO PRIME BARREL",
    "BRONCO PRIME RECEIVER",
    "AKBRONCO PRIME BLUEPRINT",
    "AKBRONCO PRIME LINK"
  ];
  let indiceCelda = 0;
  const ctx = montaContexto(async () => {
    const text = nombresVisibles[indiceCelda % nombresVisibles.length];
    indiceCelda++;
    const words = text.split(" ").map((w, i) => ({ text: w, confidence: 90, bbox: { x0: i * 50, y0: 0, x1: (i + 1) * 50, y1: 20 } }));
    return { data: { text, words, confidence: 90 } };
  });

  try {
    await ctx.pasaPagina(paginaSintetica("all"));
    await ctx.pasaPagina(paginaSintetica(Array.from({ length: 16 }, (_, i) => i)));

    assert.ok([...VisionService._memoriasRejilla.values()].some((m) => m.cols === 4));

    state.primeInventory = {
      "Bronco Prime Barrel": 1,
      "Bronco Prime Receiver": 1,
      "Akbronco Prime Blueprint": 1,
      "Akbronco Prime Link": 1,
      "Volt Prime Blueprint": 1
    };

    BusquedaInventarioService.lee = async () => ({ tipo: "piezas", texto: "prime" });
    indiceCelda = 0;

    const f1 = paginaSintetica([0, 1, 2, 3, 4], 1);
    await ctx.pasaPagina(f1);

    await ctx.scrollFrame();

    const f2 = paginaSintetica([0, 1, 2, 3, 4], 2);
    await ctx.pasaPagina(f2);

    assert.ok(logs.some((l) => l.includes('[BUSQ] piezas "prime": fila_llena')));
    assert.ok(!logs.some((l) => l.includes("· a 0:")));
    assert.equal(state.primeInventory["Bronco Prime Barrel"], 1);
    assert.equal(state.primeInventory["Bronco Prime Receiver"], 1);
    assert.equal(state.primeInventory["Akbronco Prime Blueprint"], 1);
    assert.equal(state.primeInventory["Akbronco Prime Link"], 1);
    assert.equal(state.primeInventory["Volt Prime Blueprint"], 1);
  } finally {
    para();
    ctx.limpia();
  }
});


test("fuga de deBusqueda no evita la omision de primera fila tapada en llamada posterior sin busqueda", async () => {
  const { para } = capturaConsola();
  const ctx = montaContexto();
  try {
    const toCanvas = (f) => { const c = new FakeCanvas(f.width, f.height); c.data.set(f.data); return c; };
    const resetS = () => {
      S.detectionLocked = false;
      S._gridReintentado = false;
      S._autoCalibCache = null;
      S._frameZoneCache = { key: "1248x897", zone: { x: 67, y: 183, w: 1248, h: 897, hud: 100 } };
    };
    const snapNormal = toCanvas(makeInventoryFrame({ width: 1248, height: 897, gridX: 0, gridY: 0, cellW: 208, cellH: 222, cols: 6, rows: 3, filled: "all", art: [180, 160, 140] }));
    resetS();
    await S.processInventoryGrid(snapNormal, 1248, 897, 1, 1248, "INVENTORY", null);

    const memoria = VisionService._memoriasRejilla.get("INVENTORY|1248x897");
    assert.equal(memoria?.cols, 6);

    const snapshot = toCanvas(makeInventoryFrame({ width: 1248, height: 897, gridX: 0, gridY: -6, cellW: 208, cellH: 222, cols: 6, rows: 3, filled: [0, 1, 6], art: [180, 160, 140] }));
    resetS();
    const busqueda = { tipo: "piezas", texto: "bronco" };

    await S.processInventoryGrid(snapshot, 1248, 897, 1, 1248, "INVENTORY", busqueda);

    assert.equal(S._autoCalibCache?.calib?.deBusqueda, true);
    assert.ok(!S.lastRawOcrLog.some((l) => l.includes("[r0] SKIPPED")));

    const origDetect = VisionService.detectGridAutoCalib;
    VisionService.detectGridAutoCalib = () => null;
    try {
      S.detectionLocked = false;
      await S.processInventoryGrid(snapshot, 1248, 897, 1, 1248, "INVENTORY", null);
    } finally {
      VisionService.detectGridAutoCalib = origDetect;
    }

    assert.ok(S.lastRawOcrLog.some((l) => l.includes("[r0] SKIPPED")));

    resetS();
    await S.processInventoryGrid(snapNormal, 1248, 897, 1, 1248, "INVENTORY", busqueda);
    assert.notEqual(S._autoCalibCache?.calib?.deBusqueda, true);
    assert.ok(S.lastRawOcrLog.some((l) => l.includes("[r0] SKIPPED")));
  } finally {
    para();
    ctx.limpia();
  }
});


test("memoria sin zona valida no activa rejilla de busqueda y salta la pagina", async () => {
  const { logs, para } = capturaConsola();
  const ctx = montaContexto();
  try {
    const frameNormal = makeInventoryFrame({
      width: 1248, height: 897, gridX: 0, gridY: 0, cellW: 208, cellH: 222, cols: 6, rows: 3,
      filled: "all", art: [180, 160, 140]
    });
    const snapNormal = new FakeCanvas(1248, 897);
    snapNormal.data.set(frameNormal.data);
    S.detectionLocked = false;
    S._gridReintentado = false;
    S._autoCalibCache = null;
    S._frameZoneCache = { key: "1248x897", zone: { x: 67, y: 183, w: 1248, h: 897, hud: 100 } };
    await S.processInventoryGrid(snapNormal, 1248, 897, 1, 1248, "INVENTORY", null);

    assert.notEqual(VisionService._memoriasRejilla.get("INVENTORY|1248x897"), null);
    assert.equal(VisionService._memoriasRejilla.get("INVENTORY|1248x897")?.cols, 6);

    S._frameZoneCache = null;
    S._autoCalibCache = null;
    S.detectionLocked = false;

    const frameBusq = makeInventoryFrame({
      width: 1248, height: 897, gridX: 0, gridY: -6, cellW: 208, cellH: 222, cols: 6, rows: 3,
      filled: [0], art: [180, 160, 140]
    });
    const snapBusq = new FakeCanvas(1248, 897);
    snapBusq.data.set(frameBusq.data);

    const busqueda = { tipo: "piezas", texto: "bronco" };
    await S.processInventoryGrid(snapBusq, 1248, 897, 1, 1248, "INVENTORY", busqueda);

    assert.ok(!logs.some((l) => l.startsWith("[BUSQ]")));
    assert.ok(logs.some((l) => l.includes("[INV] Página saltada: sin rejilla")));
    assert.equal(S._autoCalibCache, null);
  } finally {
    para();
    ctx.limpia();
  }
});


test("reliquias con pocos resultados por la cadena baja el fantasma y conserva visibles", async () => {
  const { logs, para } = capturaConsola();
  let indiceCelda = 0;
  const ctx = montaContexto(async () => {
    indiceCelda++;
    const text = indiceCelda % 2 === 1 ? "LITH A1 RELIC" : "LITH A2 RELIC";
    const words = text.split(" ").map((w, i) => ({ text: w, confidence: 90, bbox: { x0: i * 50, y0: 0, x1: (i + 1) * 50, y1: 20 } }));
    return { data: { text, words, confidence: 90 } };
  });

  try {
    state.inventory = [
      { name: "Lith A1 Relic", count: 2 },
      { name: "Lith A2 Relic", count: 3 },
      { name: "Lith C9 Relic", count: 1 }
    ];

    const normal = paginaSintetica("all");
    await ctx.pasaPagina(normal);

    BusquedaInventarioService.lee = async () => ({ tipo: "reliquias", texto: "lith" });

    const f1 = paginaSintetica([0, 1], 1);
    await ctx.pasaPagina(f1);

    await ctx.scrollFrame();

    const f2 = paginaSintetica([0, 1], 2);
    await ctx.pasaPagina(f2);

    assert.ok(logs.includes('[BUSQ] reliquias "lith": 2 a la vista, 1 sin salir'));
    assert.ok(logs.includes('[BUSQ] reliquias "lith": 2 a la vista, 1 sin salir · a 0: LITH C9'));
    const cuenta = (nombre) => state.inventory.find((e) => e.name === nombre)?.count ?? 0;
    assert.equal(cuenta("Lith A1 Relic"), 2);
    assert.equal(cuenta("Lith A2 Relic"), 3);
    assert.equal(cuenta("Lith C9 Relic"), 0);
  } finally {
    para();
    ctx.limpia();
  }
});


test("calibracion 3x4 en cache forzando borrado de memoria no vota a cero al buscar con 5 resultados", async () => {
  const { logs, para } = capturaConsola();
  const nombresVisibles = [
    "BRONCO PRIME BARREL",
    "BRONCO PRIME RECEIVER",
    "AKBRONCO PRIME BLUEPRINT",
    "AKBRONCO PRIME LINK"
  ];
  let indiceCelda = 0;
  const ctx = montaContexto(async () => {
    const text = nombresVisibles[indiceCelda % nombresVisibles.length];
    indiceCelda++;
    const words = text.split(" ").map((w, i) => ({ text: w, confidence: 90, bbox: { x0: i * 50, y0: 0, x1: (i + 1) * 50, y1: 20 } }));
    return { data: { text, words, confidence: 90 } };
  });

  try {
    await ctx.pasaPagina(paginaSintetica("all"));
    await ctx.pasaPagina(paginaSintetica(Array.from({ length: 16 }, (_, i) => i)));

    VisionService._memoriasRejilla.delete("INVENTORY|1248x897");

    assert.equal(S._autoCalibCache?.calib?.rows, 3);
    assert.equal(S._autoCalibCache?.calib?.cols, 4);
    assert.equal(VisionService._memoriasRejilla.get("INVENTORY|1248x897"), undefined);

    state.primeInventory = {
      "Bronco Prime Barrel": 1,
      "Bronco Prime Receiver": 1,
      "Akbronco Prime Blueprint": 1,
      "Akbronco Prime Link": 1,
      "Volt Prime Blueprint": 1
    };

    BusquedaInventarioService.lee = async () => ({ tipo: "piezas", texto: "prime" });
    indiceCelda = 0;

    const f1 = paginaSintetica([0, 1, 2, 3, 4], 1);
    await ctx.pasaPagina(f1);

    await ctx.scrollFrame();

    const f2 = paginaSintetica([0, 1, 2, 3, 4], 2);
    await ctx.pasaPagina(f2);

    assert.ok(logs.some((l) => l.includes("uso la rejilla de la anterior")));
    assert.notEqual(S._autoCalibCache?.calib?.deBusqueda, true);
    assert.ok(logs.some((l) => l.includes('[BUSQ] piezas "prime": fila_llena')));
    assert.ok(!logs.some((l) => l.includes("· a 0:")));
    assert.equal(state.primeInventory["Bronco Prime Barrel"], 1);
    assert.equal(state.primeInventory["Bronco Prime Receiver"], 1);
    assert.equal(state.primeInventory["Akbronco Prime Blueprint"], 1);
    assert.equal(state.primeInventory["Akbronco Prime Link"], 1);
    assert.equal(state.primeInventory["Volt Prime Blueprint"], 1);
  } finally {
    para();
    ctx.limpia();
  }
});

for (const gridY of [45, 139, 10, -10]) {
  for (const n of [8, 14]) {
    test(`fila 0 cortada por encima del recorte (gridY ${gridY}) con ${n} resultados no pone a cero lo que tapa`, async () => {
      const nombres = catalogoPrime().filter((name) => / Prime /.test(name) && !/Forma/.test(name)).slice(0, n);
      const visibles = nombres.slice(6, n);
      const ocultos = nombres.slice(0, 6);
      const pagina = (filled, seed) => makeInventoryFrame({ width: 1920, height: 1080, gridX: 66, gridY, cellW: 208, cellH: 222, cols: 6, rows: 4, art: [180, 160, 140], nameWidthFrac: 0.6, filled, seed });
      const { logs, para } = capturaConsola();
      let i = 0;
      const ctx = montaContexto(async () => {
        const text = visibles[i++ % visibles.length].toUpperCase();
        const words = text.split(" ").map((w, k) => ({ text: w, confidence: 90, bbox: { x0: k * 50, y0: 0, x1: (k + 1) * 50, y1: 20 } }));
        return { data: { text, words, confidence: 90 } };
      });
      try {
        state.primeInventory = Object.fromEntries(nombres.map((name) => [name, 3]));
        await ctx.pasaPagina(pagina("all", 1));
        BusquedaInventarioService.lee = async () => ({ tipo: "piezas", texto: "prime" });
        const filled = [...Array(n).keys()];
        await ctx.pasaPagina(pagina(filled, 2));
        await ctx.pasaPagina(pagina(filled, 3));
        for (const name of ocultos) {
          assert.notEqual(state.primeInventory[name], 0);
        }
        assert.ok(!logs.some((l) => l.startsWith("[BUSQ]") && l.includes(" a 0:")));
      } finally {
        para();
        ctx.limpia();
        state.primeInventory = {};
      }
    });
  }
}

for (const [gridY, vota] of [[183, true], [225, false]]) {
  test(`fila 0 ${vota ? "dentro del recorte" : "a 0,19 de celda bajo el recorte"} (gridY ${gridY}) ${vota ? "pone a cero lo que falta" : "no vota"}`, async () => {
    const [visible, fantasma] = catalogoPrime().filter((name) => / Prime /.test(name) && !/Forma/.test(name)).slice(0, 2);
    const pagina = (filled, seed) => makeInventoryFrame({ width: 1920, height: 1080, gridX: 66, gridY, cellW: 208, cellH: 222, cols: 6, rows: 3, art: [180, 160, 140], nameWidthFrac: 0.6, filled, seed });
    const { logs, para } = capturaConsola();
    const ctx = montaContexto(async () => {
      const text = visible.toUpperCase();
      const words = text.split(" ").map((w, k) => ({ text: w, confidence: 90, bbox: { x0: k * 50, y0: 0, x1: (k + 1) * 50, y1: 20 } }));
      return { data: { text, words, confidence: 90 } };
    });
    try {
      state.primeInventory = { [visible]: 3, [fantasma]: 3 };
      await ctx.pasaPagina(paginaSintetica("all"));
      BusquedaInventarioService.lee = async () => ({ tipo: "piezas", texto: "prime" });
      await ctx.pasaPagina(pagina([0], 2));
      await ctx.pasaPagina(pagina([0], 3));
      assert.equal(state.primeInventory[visible], 3);
      if (vota) {
        assert.equal(state.primeInventory[fantasma], 0);
        assert.ok(logs.some((l) => l.startsWith("[BUSQ]") && l.includes(`· a 0: ${fantasma}`)));
      } else {
        assert.equal(state.primeInventory[fantasma], 3);
        assert.ok(!logs.some((l) => l.startsWith("[BUSQ]") && l.includes(" a 0:")));
      }
    } finally {
      para();
      ctx.limpia();
      state.primeInventory = {};
    }
  });
}

test("deshacer el cero no lo repite con la misma busqueda tras scroll", async () => {
  const { logs, para } = capturaConsola();
  const ctx = montaContexto();
  try {
    await ctx.pasaPagina(paginaSintetica("all"));
    const stockPrevio = state.primeInventory["Bronco Prime Barrel"];
    BusquedaInventarioService.lee = async () => ({ tipo: "piezas", texto: "bronco" });
    await ctx.pasaPagina(paginaSintetica([0], 1));
    await ctx.pasaPagina(paginaSintetica([0], 2));
    assert.equal(state.primeInventory["Bronco Prime Barrel"], 0);
    const cont = globalThis.document.getElementById("toast-container");
    const toast = cont.children.at(-1);
    toast.children.at(-1).onclick();
    assert.equal(state.primeInventory["Bronco Prime Barrel"], stockPrevio);
    const nLogsDeshacer = logs.length;
    for (let i = 0; i < 3; i++) {
      await ctx.scrollFrame();
      await ctx.pasaPagina(paginaSintetica([0], 3 + i));
    }
    assert.equal(state.primeInventory["Bronco Prime Barrel"], stockPrevio);
    const logsNuevos = logs.slice(nLogsDeshacer);
    assert.ok(!logsNuevos.some((l) => l.startsWith("[BUSQ]") && l.includes(" a 0:")));
  } finally {
    para();
    ctx.limpia();
    state.primeInventory = {};
  }
});

test("sin zona de recorte la guarda de margen tapa la fila 0 y no vota", async () => {
  const N = 14;
  const nombres = catalogoPrime().filter((name) => / Prime /.test(name) && !/Forma/.test(name)).slice(0, N);
  const pagina = makeInventoryFrame({ width: 1920, height: 1080, gridX: 66, gridY: 177, cellW: 208, cellH: 222, cols: 6, rows: 3, art: [180, 160, 140], nameWidthFrac: 0.6, filled: [...Array(N).keys()], seed: 1 });
  const { para } = capturaConsola();
  let i = 0;
  const ctx = montaContexto(async () => {
    const text = nombres[i++ % N].toUpperCase();
    const words = text.split(" ").map((w, k) => ({ text: w, confidence: 90, bbox: { x0: k * 50, y0: 0, x1: (k + 1) * 50, y1: 20 } }));
    return { data: { text, words, confidence: 90 } };
  });
  const vistas = [];
  const origRevisa = BusquedaInventarioService.revisa;
  BusquedaInventarioService.revisa = function (escaner, o) { vistas.push({ filaTapada: o.filaTapada, minSy: Math.min(...o.celdas.map((c) => c.sy)), cellH: o.cellH }); return origRevisa.call(this, escaner, o); };
  try {
    state.primeInventory = Object.fromEntries(nombres.map((name) => [name, 3]));
    const busqueda = { tipo: "piezas", texto: "prime" };
    BusquedaInventarioService.lee = async () => busqueda;
    S._frameZoneCache = null;
    const lienzo = new FakeCanvas(pagina.width, pagina.height);
    lienzo.data.set(pagina.data);
    await S.processInventoryGrid(lienzo, 1920, 1080, 1, 1920, "INVENTORY", busqueda);
    assert.equal(vistas.length, 1);
    assert.ok(vistas[0].minSy > vistas[0].cellH * 0.25);
    assert.equal(vistas[0].filaTapada, true);
  } finally {
    BusquedaInventarioService.revisa = origRevisa;
    para();
    ctx.limpia();
    state.primeInventory = {};
  }
});

test("rejilla reconstruida desde memoria con la fila 0 llena pide fila parcial y no pone a cero", async () => {
  const N = 14;
  const nombres = catalogoPrime().filter((name) => / Prime /.test(name) && !/Forma/.test(name)).slice(0, N + 1);
  const visibles = nombres.slice(0, N);
  const fantasma = nombres[N];
  const pagina = (filled, seed) => makeInventoryFrame({ width: 1920, height: 1080, gridX: 66, gridY: 177, cellW: 208, cellH: 222, cols: 6, rows: 3, art: [180, 160, 140], nameWidthFrac: 0.6, filled, seed });
  const { logs, para } = capturaConsola();
  let i = 0;
  const ctx = montaContexto(async () => {
    const text = visibles[i++ % visibles.length].toUpperCase();
    const words = text.split(" ").map((w, k) => ({ text: w, confidence: 90, bbox: { x0: k * 50, y0: 0, x1: (k + 1) * 50, y1: 20 } }));
    return { data: { text, words, confidence: 90 } };
  });
  const origDetectGrid = VisionService.detectGridAutoCalib;
  const origRevisa = BusquedaInventarioService.revisa;
  const filasParciales = [];
  try {
    state.primeInventory = Object.fromEntries(nombres.map((name) => [name, 3]));
    await ctx.pasaPagina(pagina("all", 1));
    VisionService.detectGridAutoCalib = function () {
      const r = origDetectGrid.apply(this, arguments);
      return r ? { ...r, deBusqueda: undefined, deMemoria: true } : r;
    };
    BusquedaInventarioService.revisa = function (escaner, o) {
      filasParciales.push(o.filaParcial);
      return origRevisa.call(this, escaner, o);
    };
    BusquedaInventarioService.lee = async () => ({ tipo: "piezas", texto: "prime" });
    await ctx.pasaPagina(pagina([...Array(N).keys()], 2));
    await ctx.pasaPagina(pagina([...Array(N).keys()], 3));
    assert.ok(filasParciales.length > 0);
    assert.ok(filasParciales.every((fp) => fp === true));
    assert.equal(state.primeInventory[fantasma], 3);
    assert.ok(!logs.some((l) => l.startsWith("[BUSQ]") && l.includes(" a 0:")));
  } finally {
    VisionService.detectGridAutoCalib = origDetectGrid;
    BusquedaInventarioService.revisa = origRevisa;
    para();
    ctx.limpia();
    state.primeInventory = {};
  }
});
