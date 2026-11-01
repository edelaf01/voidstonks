import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeDocument, fakeCanvas } from "./_helpers/fake-canvas.mjs";

installFakeDocument();
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const { BusquedaInventarioService } = await import("../deploy/js/services/scanner/busqueda_inventario.service.js");
const { DucatKioskService } = await import("../deploy/js/services/scanner/ducat_kiosk.service.js");
const { OCRRepository } = await import("../deploy/js/repositories/ocr.repository.js");
const { state } = await import("../deploy/js/state.js");
const { ESTADO_BUSQUEDA } = await import("../deploy/js/utils/inventory/busqueda_rejilla.js");

function construyePagina(filas, cols, itemNames = [], options = {}) {
  const { busqueda = null, ruido = [], relics = null } = options;
  const ruidoSet = new Set(ruido);
  const items = new Map();
  const reliquias = new Map();
  const vacias = new Set();
  const celdas = [];

  for (let r = 0; r < filas; r++) {
    for (let c = 0; c < cols; c++) {
      const key = `r${r}c${c}`;
      celdas.push({ r, c, sx: c * 100, sy: r * 100 });
      const idx = r * cols + c;
      if (relics && idx < relics.length) {
        reliquias.set(key, relics[idx]);
      } else if (!relics && idx < itemNames.length) {
        items.set(key, itemNames[idx]);
      } else {
        vacias.add(key);
      }
    }
  }

  const lienzo = fakeCanvas(cols * 100, filas * 100, (x, y) => {
    const c = Math.floor(x / 100);
    const r = Math.floor(y / 100);
    const key = `r${r}c${c}`;
    if (items.has(key) || reliquias.has(key) || ruidoSet.has(key)) {
      return x % 2 === 0 ? [255, 255, 255, 255] : [0, 0, 0, 255];
    }
    return [12, 14, 18, 255];
  });

  return {
    busqueda,
    contexto: "INVENTORY",
    filaTapada: false,
    filas,
    cols,
    celdas,
    items,
    reliquias,
    vacias,
    lienzo,
    cellW: 100,
    cellH: 100,
  };
}

const creaEscaner = () => ({
  sessionInventory: new Map(),
  sessionRelics: new Map(),
  lastHeaderText: "INVENTORY",
  autoScrollMuestra: { x: 1 },
  fotosSinScroll: 3,
  _categoriaTexto: "PRIME PARTS",
});

const prepara = () => {
  BusquedaInventarioService.reset();
  const llamadas = [];
  BusquedaInventarioService.onCero = (...args) => llamadas.push(args);
  DucatKioskService.reset();
  DucatKioskService.enMesa.clear();
  DucatKioskService.vendiendo = null;
  state.primeInventory = {};
  state.inventory = [];
  return llamadas;
};

test("piezas con consulta bronco", () => {
  const llamadas = prepara();
  const escaner = creaEscaner();
  state.primeInventory = {
    "Akbronco Prime Blueprint": 1,
    "Akbronco Prime Link": 2,
    "Bronco Prime Barrel": 1,
    "Braton Prime Stock": 4,
  };
  const busqueda = { tipo: "piezas", texto: "bronco|" };
  const pagina = construyePagina(3, 6, ["Akbronco Prime Blueprint", "Bronco Prime Barrel"], { busqueda });

  const r1 = BusquedaInventarioService.revisa(escaner, pagina);
  assert.equal(r1, 16);
  assert.equal(llamadas.length, 0);
  assert.equal(escaner.autoScrollMuestra, null);
  assert.equal(escaner.fotosSinScroll, 2);

  const r2 = BusquedaInventarioService.revisa(escaner, pagina);
  assert.equal(r2, 16);
  assert.equal(llamadas.length, 1);
  assert.deepEqual(llamadas[0], ["piezas", ["Akbronco Prime Link"], "bronco"]);
  assert.equal(llamadas[0][1].includes("Braton Prime Stock"), false);
});

test("consulta nikana", () => {
  const llamadas = prepara();
  const escaner = creaEscaner();
  state.primeInventory = {
    "Nikana Prime Blade": 1,
    "Nikana Prime Hilt": 1,
    "Nikana Prime Blueprint": 1,
  };
  const busqueda = { tipo: "piezas", texto: "nikana" };
  const pagina = construyePagina(4, 6, ["Nikana Prime Blade", "Nikana Prime Hilt"], { busqueda });

  BusquedaInventarioService.revisa(escaner, pagina);
  assert.equal(llamadas.length, 0);
  BusquedaInventarioService.revisa(escaner, pagina);
  assert.equal(llamadas.length, 1);
  assert.deepEqual(llamadas[0], ["piezas", ["Nikana Prime Blueprint"], "nikana"]);
});

test("consulta generica con pagina llena", () => {
  const llamadas = prepara();
  const escaner = creaEscaner();
  state.primeInventory = { "Extra Prime Blueprint": 1 };
  const nombresPrime = Array.from({ length: 18 }, (_, i) => `Arma ${i} Prime`);
  const paginaPrime = construyePagina(3, 6, nombresPrime, { busqueda: { tipo: "piezas", texto: "prime" } });

  assert.equal(BusquedaInventarioService.revisa(escaner, paginaPrime), 0);
  assert.equal(BusquedaInventarioService.revisa(escaner, paginaPrime), 0);
  assert.equal(llamadas.length, 0);

  const nombresBp = Array.from({ length: 18 }, (_, i) => `Arma ${i} Blueprint`);
  const paginaBp = construyePagina(3, 6, nombresBp, { busqueda: { tipo: "piezas", texto: "blueprint" } });

  assert.equal(BusquedaInventarioService.revisa(escaner, paginaBp), 0);
  assert.equal(BusquedaInventarioService.revisa(escaner, paginaBp), 0);
  assert.equal(llamadas.length, 0);
});

test("pieza contada en sesion", () => {
  const llamadas = prepara();
  const escaner = creaEscaner();
  escaner.sessionInventory.set("Bronco Prime Receiver", 2);
  state.primeInventory = { "Akbronco Prime Blueprint": 1, "Bronco Prime Barrel": 1 };
  const busqueda = { tipo: "piezas", texto: "bronco|" };
  const pagina = construyePagina(3, 6, ["Akbronco Prime Blueprint", "Bronco Prime Barrel"], { busqueda });

  BusquedaInventarioService.revisa(escaner, pagina);
  assert.equal(llamadas.length, 0);
  BusquedaInventarioService.revisa(escaner, pagina);
  assert.equal(llamadas.length, 1);
  assert.deepEqual(llamadas[0], ["piezas", ["Bronco Prime Receiver"], "bronco"]);
});

test("reliquias", () => {
  const llamadas = prepara();
  const escaner = creaEscaner();
  escaner._categoriaTexto = "VOID RELICS";
  state.inventory = [
    { name: "Axi A1 Relic", count: 1 },
    { name: "Axi C3 Relic", count: 2 },
    { name: "Lith A1 Relic", count: 1 },
  ];
  const busqueda = { tipo: "reliquias", texto: "axi" };
  const pagina = construyePagina(3, 6, [], { busqueda, relics: ["AXI A1"] });

  BusquedaInventarioService.revisa(escaner, pagina);
  assert.equal(llamadas.length, 0);
  BusquedaInventarioService.revisa(escaner, pagina);
  assert.equal(llamadas.length, 1);
  assert.deepEqual(llamadas[0], ["reliquias", ["AXI C3"], "axi"]);
});

test("puertas y bloqueos", () => {
  const llamadas = prepara();
  const basePagina = () => construyePagina(3, 6, ["Akbronco Prime Blueprint"], { busqueda: { tipo: "piezas", texto: "bronco|" } });
  state.primeInventory = { "Akbronco Prime Blueprint": 1, "Akbronco Prime Link": 2 };

  const puertas = [
    { modPagina: { contexto: "TRADE" } },
    { modPagina: { contexto: "INVENTORY_ARCANES" } },
    { modPagina: { filaTapada: true } },
    { modEscaner: { lastHeaderText: "TRADE" } },
    { modKiosco: () => { DucatKioskService.conDialogo = true; } },
    { modKiosco: () => { DucatKioskService.enMesa.add("Pieza"); } },
    { modKiosco: () => { DucatKioskService.vendiendo = { lista: [], t: Date.now() }; } },
    { modPagina: { busqueda: null } },
    { modPagina: { busqueda: { tipo: "desconocido", texto: "bronco|" } } },
  ];

  for (const p of puertas) {
    prepara();
    llamadas.length = 0;
    const escaner = creaEscaner();
    if (p.modEscaner) Object.assign(escaner, p.modEscaner);
    if (p.modKiosco) p.modKiosco();
    const pag = { ...basePagina(), ...(p.modPagina || {}) };

    const r1 = BusquedaInventarioService.revisa(escaner, pag);
    const r2 = BusquedaInventarioService.revisa(escaner, pag);

    assert.equal(r1, 0);
    assert.equal(r2, 0);
    assert.equal(llamadas.length, 0);
    assert.equal(BusquedaInventarioService.estado, ESTADO_BUSQUEDA);
  }
});

test("ruido en celda vacia", () => {
  const llamadas = prepara();
  const escaner = creaEscaner();
  state.primeInventory = { "Akbronco Prime Blueprint": 1, "Akbronco Prime Link": 2 };
  const busqueda = { tipo: "piezas", texto: "bronco|" };
  const pagina = construyePagina(3, 6, ["Akbronco Prime Blueprint"], { busqueda, ruido: ["r0c1"] });

  const r1 = BusquedaInventarioService.revisa(escaner, pagina);
  const r2 = BusquedaInventarioService.revisa(escaner, pagina);

  assert.equal(r1, 0);
  assert.equal(r2, 0);
  assert.equal(llamadas.length, 0);
});

test("exclusion de kiosko con noVota", () => {
  const llamadas = prepara();
  const escaner = creaEscaner();
  state.primeInventory = {
    "Akbronco Prime Blueprint": 1,
    "Bronco Prime Barrel": 1,
    "Akbronco Prime Link": 2,
    "Bronco Prime Receiver": 1,
  };
  const busqueda = { tipo: "piezas", texto: "bronco|" };
  const pagina = construyePagina(3, 6, ["Akbronco Prime Blueprint", "Bronco Prime Barrel"], { busqueda });

  const origNoVota = DucatKioskService.noVota;
  DucatKioskService.noVota = (n) => n === "Bronco Prime Receiver";
  try {
    BusquedaInventarioService.revisa(escaner, pagina);
    BusquedaInventarioService.revisa(escaner, pagina);

    assert.equal(llamadas.length, 1);
    assert.deepEqual(llamadas[0], ["piezas", ["Akbronco Prime Link"], "bronco"]);
    assert.equal(llamadas[0][1].includes("Bronco Prime Receiver"), false);
  } finally {
    DucatKioskService.noVota = origNoVota;
  }
});

test("cambio de consulta o categoria entre escaneos", () => {
  const llamadas = prepara();
  const escaner = creaEscaner();
  state.primeInventory = {
    "Akbronco Prime Blueprint": 1,
    "Akbronco Prime Link": 2,
    "Nikana Prime Blade": 1,
    "Nikana Prime Hilt": 1,
    "Nikana Prime Blueprint": 1,
  };
  const pagBronco = construyePagina(3, 6, ["Akbronco Prime Blueprint"], { busqueda: { tipo: "piezas", texto: "bronco|" } });
  const pagNikana = construyePagina(3, 6, ["Nikana Prime Blade", "Nikana Prime Hilt"], { busqueda: { tipo: "piezas", texto: "nikana|" } });

  BusquedaInventarioService.revisa(escaner, pagBronco);
  assert.equal(llamadas.length, 0);
  BusquedaInventarioService.revisa(escaner, pagNikana);
  assert.equal(llamadas.length, 0);

  prepara();
  llamadas.length = 0;
  state.primeInventory = {
    "Axi Prime Blueprint": 1,
    "Axi Prime Stock": 1,
  };
  state.inventory = [
    { name: "Axi A1 Relic", count: 1 },
    { name: "Axi C3 Relic", count: 2 },
  ];
  const pagPiezasAxi = construyePagina(3, 6, ["Axi Prime Blueprint"], { busqueda: { tipo: "piezas", texto: "axi" } });
  const pagReliquiasAxi = construyePagina(3, 6, [], { busqueda: { tipo: "reliquias", texto: "axi" }, relics: ["AXI A1"] });

  BusquedaInventarioService.revisa(escaner, pagPiezasAxi);
  assert.equal(llamadas.length, 0);
  BusquedaInventarioService.revisa(escaner, pagReliquiasAxi);
  assert.equal(llamadas.length, 0);
});

test("escaneo fallido reinicia el conteo", () => {
  const llamadas = prepara();
  const escaner = creaEscaner();
  state.primeInventory = {
    "Akbronco Prime Blueprint": 1,
    "Bronco Prime Barrel": 1,
    "Akbronco Prime Link": 2,
  };
  const pagBronco = construyePagina(3, 6, ["Akbronco Prime Blueprint", "Bronco Prime Barrel"], { busqueda: { tipo: "piezas", texto: "bronco|" } });
  const nombresPrime = Array.from({ length: 18 }, (_, i) => `Arma ${i} Prime`);
  const pagPrime = construyePagina(3, 6, nombresPrime, { busqueda: { tipo: "piezas", texto: "prime" } });

  BusquedaInventarioService.revisa(escaner, pagBronco);
  assert.equal(llamadas.length, 0);

  const rFull = BusquedaInventarioService.revisa(escaner, pagPrime);
  assert.equal(rFull, 0);
  assert.equal(llamadas.length, 0);

  BusquedaInventarioService.revisa(escaner, pagBronco);
  assert.equal(llamadas.length, 0);

  BusquedaInventarioService.revisa(escaner, pagBronco);
  assert.equal(llamadas.length, 1);
  assert.deepEqual(llamadas[0], ["piezas", ["Akbronco Prime Link"], "bronco"]);
});

test("lee reconocimiento de busqueda", async () => {
  prepara();
  const escaner = creaEscaner();
  const origWorkers = OCRRepository.workers;
  const origPSM = OCRRepository.recognizeWithPSM;
  let ocrLlamado = false;
  OCRRepository.workers = [{}];
  OCRRepository.recognizeWithPSM = async () => {
    ocrLlamado = true;
    return { data: { text: "bronco|" } };
  };

  try {
    escaner._categoriaTexto = "ARCANES";
    const rArcanes = await BusquedaInventarioService.lee(escaner, null);
    assert.equal(rArcanes, null);
    assert.equal(ocrLlamado, false);

    escaner._categoriaTexto = "";
    const rVacio = await BusquedaInventarioService.lee(escaner, null);
    assert.equal(rVacio, null);
    assert.equal(ocrLlamado, false);

    const frameConTexto = fakeCanvas(960, 540, (x, y) => {
      const nx = x / 960;
      const ny = y / 540;
      if (nx >= 0.585 && nx < 0.620 && ny >= 0.140 && ny < 0.158) {
        return [240, 230, 180, 255];
      }
      return [20, 20, 20, 255];
    });
    frameConTexto.videoWidth = 960;
    frameConTexto.videoHeight = 540;

    escaner._categoriaTexto = "PRIME PARTS";
    const rPiezas = await BusquedaInventarioService.lee(escaner, frameConTexto);
    assert.deepEqual(rPiezas, { tipo: "piezas", texto: "bronco|" });
    assert.equal(ocrLlamado, true);

    escaner._categoriaTexto = "VOID RELICS";
    const rReliquias = await BusquedaInventarioService.lee(escaner, frameConTexto);
    assert.deepEqual(rReliquias, { tipo: "reliquias", texto: "bronco|" });

    const frameOscuro = fakeCanvas(960, 540, () => [20, 20, 20, 255]);
    frameOscuro.videoWidth = 960;
    frameOscuro.videoHeight = 540;
    escaner._categoriaTexto = "PRIME PARTS";
    const rOscuro = await BusquedaInventarioService.lee(escaner, frameOscuro);
    assert.equal(rOscuro, null);
  } finally {
    OCRRepository.workers = origWorkers;
    OCRRepository.recognizeWithPSM = origPSM;
  }
});

test("reset devuelve el estado a ESTADO_BUSQUEDA", () => {
  prepara();
  const escaner = creaEscaner();
  state.primeInventory = {
    "Akbronco Prime Blueprint": 1,
    "Bronco Prime Barrel": 1,
    "Akbronco Prime Link": 2,
  };
  const busqueda = { tipo: "piezas", texto: "bronco|" };
  const pagina = construyePagina(3, 6, ["Akbronco Prime Blueprint", "Bronco Prime Barrel"], { busqueda });

  BusquedaInventarioService.revisa(escaner, pagina);
  assert.notEqual(BusquedaInventarioService.estado, ESTADO_BUSQUEDA);

  BusquedaInventarioService.reset();
  assert.equal(BusquedaInventarioService.estado, ESTADO_BUSQUEDA);
});

let manejadorCero;

async function conAviso(t, lang, fn) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { ScannerService: S } = await import("../deploy/js/services/scanner/scanner.service.js");
  const previo = {
    onCero: BusquedaInventarioService.onCero, cambiado: globalThis.inventarioCambiado, crear: document.createElement,
    estado: { primeInventory: state.primeInventory, inventory: state.inventory, currentLang: state.currentLang },
    sesion: { sessionInventory: S.sessionInventory, qtyVotes: S.qtyVotes, sessionRelics: S.sessionRelics, relicQtyVotes: S.relicQtyVotes },
  };
  await import("../deploy/js/scanner/live_scanner.js");
  manejadorCero ||= BusquedaInventarioService.onCero;
  document.createElement = (tag) => Object.assign(previo.crear(tag), { querySelector: () => ({}) });
  const contenedor = document._registrar("toast-container", previo.crear("div"));
  const avisos = { cambios: 0 };
  globalThis.inventarioCambiado = () => { avisos.cambios++; };
  state.currentLang = lang;
  try {
    await fn({ S, avisos, toast: () => contenedor.children[0] });
  } finally {
    document.createElement = previo.crear;
    document._registrar("toast-container", null);
    globalThis.inventarioCambiado = previo.cambiado;
    BusquedaInventarioService.onCero = previo.onCero;
    Object.assign(state, previo.estado);
    Object.assign(S, previo.sesion);
  }
}

function piezasConSesion(S) {
  state.primeInventory = { "Akbronco Prime Blueprint": 2, "Akbronco Prime Link": 3, "Nikana Prime Blade": 1 };
  S.sessionInventory = new Map([["Akbronco Prime Link", 4], ["Nikana Prime Blade", 2]]);
  S.qtyVotes = new Map([["Akbronco Prime Link", new Map([[4, 2]])], ["Nikana Prime Blade", new Map([[2, 1]])]]);
}

test("onCero de piezas pone a 0, limpia la sesión y deshace", async (t) => {
  await conAviso(t, "en", ({ S, avisos, toast }) => {
    piezasConSesion(S);
    manejadorCero("piezas", ["Akbronco Prime Link"], "bronco");
    assert.equal(state.primeInventory["Akbronco Prime Link"], 0);
    assert.equal(state.primeInventory["Akbronco Prime Blueprint"], 2);
    assert.equal(state.primeInventory["Nikana Prime Blade"], 1);
    assert.equal(S.sessionInventory.has("Akbronco Prime Link"), false);
    assert.equal(S.sessionInventory.get("Nikana Prime Blade"), 2);
    assert.equal(S.qtyVotes.has("Akbronco Prime Link"), false);
    assert.ok(avisos.cambios >= 1);
    assert.ok(toast().innerHTML.includes("Search &quot;bronco&quot;"));
    assert.ok(toast().innerHTML.includes("Akbronco Prime Link"));
    const deshacer = toast().children.at(-1);
    assert.equal(deshacer.textContent, "UNDO");
    deshacer.onclick();
    assert.equal(state.primeInventory["Akbronco Prime Link"], 4);
    assert.equal(state.primeInventory["Akbronco Prime Blueprint"], 2);
  });
});

test("onCero de reliquias las quita, limpia la sesión y deshace con su nombre", async (t) => {
  await conAviso(t, "en", ({ S, toast }) => {
    state.inventory = [{ name: "Axi A1 Relic", count: 2 }, { name: "Axi B2 Relic", count: 1 }, { name: "Lith C3 Relic", count: 5 }];
    S.sessionRelics = new Map([["Axi B2", 3], ["Lith C3", 5]]);
    S.relicQtyVotes = new Map([["Axi B2", new Map([[3, 1]])], ["Lith C3", new Map([[5, 1]])]]);
    manejadorCero("reliquias", ["AXI A1", "AXI B2"], "axi");
    const cuenta = (nombre) => state.inventory.find((e) => e.name === nombre)?.count;
    assert.equal(state.inventory.some((e) => e.name.startsWith("Axi")), false);
    assert.equal(cuenta("Lith C3 Relic"), 5);
    assert.equal(S.sessionRelics.has("Axi B2"), false);
    assert.equal(S.sessionRelics.get("Lith C3"), 5);
    assert.equal(S.relicQtyVotes.has("Axi B2"), false);
    assert.ok(toast().innerHTML.includes("Search &quot;axi&quot;"));
    assert.ok(toast().innerHTML.includes("Axi A1 Relic"));
    assert.ok(toast().innerHTML.includes("Axi B2 Relic"));
    toast().children.at(-1).onclick();
    assert.equal(cuenta("Axi A1 Relic"), 2);
    assert.equal(cuenta("Axi B2 Relic"), 3);
    assert.equal(cuenta("Lith C3 Relic"), 5);
  });
});

test("onCero en español usa el texto en español", async (t) => {
  await conAviso(t, "es", ({ S, toast }) => {
    piezasConSesion(S);
    manejadorCero("piezas", ["Akbronco Prime Link"], "bronco");
    assert.ok(toast().innerHTML.includes("Búsqueda &quot;bronco&quot;"));
    assert.ok(toast().innerHTML.includes("puesto a 0"));
    assert.equal(toast().children.at(-1).textContent, "DESHACER");
  });
});

test("lee descarta texto vacio y placeholder SEARCH...", async () => {
  prepara();
  const escaner = creaEscaner();
  escaner._categoriaTexto = "PRIME PARTS";
  const origWorkers = OCRRepository.workers;
  const origPSM = OCRRepository.recognizeWithPSM;
  OCRRepository.workers = [{}];

  const frameConTexto = fakeCanvas(960, 540, (x, y) => {
    const nx = x / 960;
    const ny = y / 540;
    if (nx >= 0.585 && nx < 0.620 && ny >= 0.140 && ny < 0.158) {
      return [240, 230, 180, 255];
    }
    return [20, 20, 20, 255];
  });
  frameConTexto.videoWidth = 960;
  frameConTexto.videoHeight = 540;

  try {
    OCRRepository.recognizeWithPSM = async () => ({ data: { text: "SEARCH..." } });
    const rSearch = await BusquedaInventarioService.lee(escaner, frameConTexto);
    assert.equal(rSearch, null);

    const escanerVacio = creaEscaner();
    escanerVacio._categoriaTexto = "PRIME PARTS";
    OCRRepository.recognizeWithPSM = async () => ({ data: { text: "" } });
    const rVacio = await BusquedaInventarioService.lee(escanerVacio, frameConTexto);
    assert.equal(rVacio, null);
  } finally {
    OCRRepository.workers = origWorkers;
    OCRRepository.recognizeWithPSM = origPSM;
  }
});

test("revisa de reliquias filtra candidatos cercanos por distancia de edicion", () => {
  const llamadas = prepara();
  const escaner = creaEscaner();
  escaner._categoriaTexto = "VOID RELICS";
  state.inventory = [
    { name: "Lith A5 Relic", count: 1 },
    { name: "Lith A6 Relic", count: 1 },
    { name: "Lith C9 Relic", count: 1 },
  ];
  const busqueda = { tipo: "reliquias", texto: "lith" };
  const pagina = construyePagina(3, 6, [], { busqueda, relics: ["LITH A6"] });

  BusquedaInventarioService.revisa(escaner, pagina);
  assert.equal(llamadas.length, 0);
  BusquedaInventarioService.revisa(escaner, pagina);
  assert.equal(llamadas.length, 1);
  assert.deepEqual(llamadas[0], ["reliquias", ["LITH C9"], "lith"]);
});
