import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeDocument } from "./_helpers/fake-canvas.mjs";

installFakeDocument();
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const { ScannerService: S } = await import("../deploy/js/services/scanner/scanner.service.js");
const { BusquedaInventarioService } = await import("../deploy/js/services/scanner/busqueda_inventario.service.js");
const { state } = await import("../deploy/js/state.js");
await import("../deploy/js/scanner/live_scanner.js");
const { makeInventoryFrame } = await import("./_helpers/inventory-frame.mjs");
const { capturaConsola, montaContexto } = await import("./_helpers/busqueda-cadena.mjs");
const { catalogoPrime } = await import("./_helpers/prime-catalog.mjs");

for (const [W, H] of [[1920, 1200], [2560, 1080]]) {
  test(`fuera de 16:9 (${W}x${H}) con la fila 0 en la línea de recorte no pone nada a cero`, async () => {
    const nombres = catalogoPrime().filter((name) => / Prime /.test(name) && !/Forma/.test(name)).slice(0, 2);
    const [visible, fantasma] = nombres;
    const pagina = (filled, seed) => makeInventoryFrame({ width: W, height: H, gridX: 66, gridY: Math.floor(H * 0.17), cellW: 208, cellH: 222, cols: 6, rows: 3, art: [180, 160, 140], nameWidthFrac: 0.6, filled, seed });
    const { logs, para } = capturaConsola();
    const ctx = montaContexto(async () => {
      const text = visible.toUpperCase();
      const words = text.split(" ").map((w, k) => ({ text: w, confidence: 90, bbox: { x0: k * 50, y0: 0, x1: (k + 1) * 50, y1: 20 } }));
      return { data: { text, words, confidence: 90 } };
    });
    ctx.video.videoWidth = ctx.video.width = W;
    ctx.video.videoHeight = ctx.video.height = H;
    ctx.dims.width = W;
    ctx.dims.height = H;
    ctx.dims.scale = 1080 / H;
    try {
      state.primeInventory = { [visible]: 3, [fantasma]: 3 };
      await ctx.pasaPagina(pagina("all", 1));
      BusquedaInventarioService.lee = async () => ({ tipo: "piezas", texto: "prime" });
      await ctx.pasaPagina(pagina([0], 2));
      await ctx.pasaPagina(pagina([0], 3));
      assert.equal(state.primeInventory[fantasma], 3);
      assert.equal(state.primeInventory[visible], 3);
      assert.ok(logs.some((l) => l.includes('[BUSQ] piezas "prime": aspecto')));
      assert.ok(!logs.some((l) => l.startsWith("[BUSQ]") && l.includes(" a 0:")));
    } finally {
      para();
      ctx.limpia();
      state.primeInventory = {};
    }
  });
}

for (const gridY of [10, 45]) {
  test(`con la zona borrada antes de procesar (gridY ${gridY}) la guarda de y sigue tapando`, async () => {
    const n = 8;
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
    let orig;
    try {
      state.primeInventory = Object.fromEntries(nombres.map((name) => [name, 3]));
      await ctx.pasaPagina(pagina("all", 1));
      orig = S.processInventoryGrid;
      S.processInventoryGrid = function (...a) { this._frameZoneCache = null; return orig.apply(this, a); };
      BusquedaInventarioService.lee = async () => ({ tipo: "piezas", texto: "prime" });
      const filled = [...Array(n).keys()];
      await ctx.pasaPagina(pagina(filled, 2));
      await ctx.pasaPagina(pagina(filled, 3));
      for (const name of ocultos) {
        assert.notEqual(state.primeInventory[name], 0);
      }
      assert.ok(!logs.some((l) => l.startsWith("[BUSQ]") && l.includes(" a 0:")));
    } finally {
      if (orig) S.processInventoryGrid = orig;
      para();
      ctx.limpia();
      state.primeInventory = {};
    }
  });
}
