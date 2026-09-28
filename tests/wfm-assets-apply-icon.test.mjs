// Comportamiento de applyIcon (utils/wfm_assets.js).
//
// tests/wfm-assets.test.mjs ya vigila el contrato leyendo el fuente y los assets del repo;
// aquí se EJECUTA la función, que es donde vive lo que se rompe sin dar la cara: qué URL
// acaba en el <img>, cuándo se escribe y cuántas comprobaciones se lanzan por pantalla.
//
// El origen de todo es un fallo real: "Cannot GET /deploy/assets/relic_contents/
// hunter_munitions.webp". getItemIcon SIEMPRE devuelve una ruta, exista el archivo o no, así
// que con un mod se inventaba un asset y la tarjeta parpadeaba de icono roto al respaldo.

import { test } from "node:test";
import assert from "node:assert/strict";

const guardado = {};
globalThis.localStorage = { getItem: (k) => guardado[k] ?? null, setItem: (k, v) => { guardado[k] = v; }, removeItem() {} };
globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });

/** Sondas creadas por checkLocal, para resolverlas a mano. */
const sondas = [];
globalThis.Image = class {
  constructor() {
    this.onload = null;
    this.onerror = null;
    sondas.push(this);
  }
};

const { applyIcon } = await import("../deploy/js/utils/wfm_assets.js");

const GENERICO = "assets/mod.svg";
const img = () => ({ src: "" });
const ultimaSonda = () => sondas.at(-1);

test("sin nombre no se toca el src", () => {
  const el = img();
  // Un src vacío o "undefined" no deja el hueco quieto: el navegador lo resuelve contra la
  // propia página y se descarga el documento entero como si fuera una imagen.
  applyIcon(el, "");
  assert.equal(el.src, "");
});

test("una reliquia lleva el icono de reliquia sin sondear nada", () => {
  const el = img();
  const antes = sondas.length;
  applyIcon(el, "Lith A8 Relic");
  assert.equal(el.src, "assets/relic.webp");
  assert.equal(sondas.length, antes);
});

test("el asset propio se pinta, pero solo tras comprobarlo", async () => {
  const el = img();
  applyIcon(el, "Ash Prime Set");

  // La decisión es asíncrona: al volver de applyIcon el src sigue vacío. Es la trampa que ya
  // se coló una vez en ui_orders.js, donde un `if (!img.src)` posterior forzaba SIEMPRE el
  // CDN y anulaba la preferencia por el asset propio.
  assert.equal(el.src, "");

  ultimaSonda().onload();
  await Promise.resolve();

  assert.equal(el.src, "assets/relic_contents/ash_prime.webp");
});

test("si el asset propio no existe, el icono genérico y no el CDN de warframe.market", async () => {
  const el = img();
  applyIcon(el, "Hunter Munitions");

  ultimaSonda().onerror();
  await Promise.resolve();

  assert.equal(el.src, GENERICO);
});

test("una ruta ya comprobada no se vuelve a sondear, la pidan las tarjetas que la pidan", async () => {
  const a = img();
  const b = img();
  const antes = sondas.length;

  // Ash y Volt comparten icono genérico (prime_neuroptics.webp): la caché va por RUTA, no por
  // nombre, y en la lista de órdenes eso son decenas de tarjetas contra un solo archivo.
  applyIcon(a, "Ash Prime Neuroptics Blueprint");
  applyIcon(b, "Volt Prime Neuroptics Blueprint");

  // Las dos llegan antes de que resuelva la primera: se cachea la promesa, no el resultado,
  // justo para que compartan la comprobación en vuelo.
  assert.equal(sondas.length, antes + 1, "una sonda por ruta, no por tarjeta");

  ultimaSonda().onload();
  await Promise.resolve();
  assert.equal(a.src, "assets/relic_contents/prime_neuroptics.webp");
  assert.equal(b.src, "assets/relic_contents/prime_neuroptics.webp");

  const c = img();
  applyIcon(c, "Nova Prime Neuroptics Blueprint");
  assert.equal(sondas.length, antes + 1, "ya resuelta: tampoco se repite después");
  await Promise.resolve();
  assert.equal(c.src, "assets/relic_contents/prime_neuroptics.webp");
});

test("un 404 se recuerda entre sesiones: cada sonda fallida es un error en la consola", async () => {
  const a = img();
  applyIcon(a, "Vigilante Vigor");
  ultimaSonda().onerror();
  await Promise.resolve();
  assert.equal(a.src, GENERICO);
  assert.ok(JSON.parse(guardado.vs_iconos_sin_asset).includes("assets/relic_contents/vigilante_vigor.webp"));

  const b = img();
  const antes = sondas.length;
  applyIcon(b, "Vigilante Vigor");
  assert.equal(sondas.length, antes);
  await Promise.resolve();
  assert.equal(b.src, GENERICO);
});
