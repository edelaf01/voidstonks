import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });

const precios = await import("../deploy/js/services/market/prices.service.js");
const repo = await import("../deploy/js/repositories/storage.repository.js");

test("expone la API de precios que consume la UI", () => {
  for (const nombre of ["getPriceValue", "addToQueue", "preloadPricesToMemory", "ensurePriceSnapshot"]) {
    assert.equal(typeof precios[nombre], "function", `falta ${nombre}()`);
  }
  assert.ok(precios.MEMORY_CACHE instanceof Map);
});

test("es la MISMA caché que la del repositorio, no una copia", () => {
  assert.equal(precios.MEMORY_CACHE, repo.MEMORY_CACHE);
  assert.equal(precios.getPriceValue, repo.getPriceValue);
});

const JS = fileURLToPath(new URL("../deploy/js", import.meta.url));

test("ningún componente pide los precios al repositorio", () => {
  const dir = join(JS, "ui.components");
  const culpables = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".js")) continue;
    const src = readFileSync(join(dir, f), "utf8");
    if (/from\s+["'][^"']*repositories\/storage\.repository\.js["']/.test(src)) culpables.push(f);
  }
  assert.deepEqual(culpables, [], "deben pasar por services/prices.service.js");
});

test("api.js ya no existe: la migración está terminada, no a medias", () => {
  const raiz = readdirSync(JS);
  assert.ok(!raiz.includes("api.js"),
    "si vuelve el barrel, vuelve la vía para que un componente llegue al repositorio sin que se note");
});
