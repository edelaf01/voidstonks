// Comportamiento de applyIcon (utils/wfm_assets.js).
//
// tests/wfm-assets.test.mjs ya vigila el contrato leyendo el fuente y los assets del repo;
// aquí se EJECUTA la función, que es donde vive lo que se rompe sin dar la cara: qué URL
// acaba en el <img>, cuándo se escribe y cuántas comprobaciones se lanzan por pantalla.
//
// El origen de todo es un fallo real: "Cannot GET /deploy/assets/relic_contents/
// hunter_munitions.webp". getItemIcon SIEMPRE devuelve una ruta, exista el archivo o no, así
// que con un mod se inventaba un asset y la tarjeta parpadeaba de icono roto al de WFM.

import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
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

const WFM = "https://warframe.market/static/assets/";
const img = () => ({ src: "" });
const ultimaSonda = () => sondas.at(-1);

test("sin asset local que probar, el icono de WFM se pinta ya", () => {
  const el = img();
  const antes = sondas.length;

  // getItemIcon devuelve null solo si no hay nombre; ahí no hay nada que decidir y esperar
  // a una comprobación dejaría la tarjeta en blanco para nada.
  applyIcon(el, "", "icons/mod.png");

  assert.equal(el.src, WFM + "icons/mod.png");
  assert.equal(sondas.length, antes, "no debe comprobar nada");
});

test("sin nombre y sin thumb no se toca el src", () => {
  const el = img();
  // Un src vacío o "undefined" no deja el hueco quieto: el navegador lo resuelve contra la
  // propia página y se descarga el documento entero como si fuera una imagen.
  applyIcon(el, "", null);
  assert.equal(el.src, "");
});

test("sin respaldo remoto el asset local se pinta sin comprobarlo", () => {
  const el = img();
  const antes = sondas.length;

  applyIcon(el, "Vigilante Armaments");

  assert.equal(el.src, "assets/relic_contents/vigilante_armaments.webp");
  assert.equal(sondas.length, antes, "sin alternativa, comprobar solo retrasa el pintado");
});

test("el asset propio gana al CDN de warframe.market, pero solo tras comprobarlo", async () => {
  const el = img();
  applyIcon(el, "Ash Prime Set", "icons/ash_prime_set.png");

  // La decisión es asíncrona: al volver de applyIcon el src sigue vacío. Es la trampa que ya
  // se coló una vez en ui_orders.js, donde un `if (!img.src)` posterior forzaba SIEMPRE el
  // CDN y anulaba la preferencia por el asset propio.
  assert.equal(el.src, "");

  ultimaSonda().onload();
  await Promise.resolve();

  assert.equal(el.src, "assets/relic_contents/ash_prime.webp");
});

test("si el asset propio no existe, se cae al icono de warframe.market", async () => {
  const el = img();
  applyIcon(el, "Hunter Munitions", "icons/hunter_munitions.png");

  ultimaSonda().onerror();
  await Promise.resolve();

  // La base se concatena aquí: el thumb tiene que llegar relativo. Si el llamante ya manda la
  // URL absoluta sale un "https://warframe.market/static/assets/https://..." que da 404.
  assert.equal(el.src, WFM + "icons/hunter_munitions.png");
});

test("una ruta ya comprobada no se vuelve a sondear, la pidan las tarjetas que la pidan", async () => {
  const a = img();
  const b = img();
  const antes = sondas.length;

  // Ash y Volt comparten icono genérico (prime_neuroptics.webp): la caché va por RUTA, no por
  // nombre, y en la lista de órdenes eso son decenas de tarjetas contra un solo archivo.
  applyIcon(a, "Ash Prime Neuroptics Blueprint", "icons/ash.png");
  applyIcon(b, "Volt Prime Neuroptics Blueprint", "icons/volt.png");

  // Las dos llegan antes de que resuelva la primera: se cachea la promesa, no el resultado,
  // justo para que compartan la comprobación en vuelo.
  assert.equal(sondas.length, antes + 1, "una sonda por ruta, no por tarjeta");

  ultimaSonda().onload();
  await Promise.resolve();
  assert.equal(a.src, "assets/relic_contents/prime_neuroptics.webp");
  assert.equal(b.src, "assets/relic_contents/prime_neuroptics.webp");

  const c = img();
  applyIcon(c, "Nova Prime Neuroptics Blueprint", "icons/nova.png");
  assert.equal(sondas.length, antes + 1, "ya resuelta: tampoco se repite después");
  await Promise.resolve();
  assert.equal(c.src, "assets/relic_contents/prime_neuroptics.webp");
});

test("un 404 recordado tampoco se reintenta: la tarjeta va directa al CDN", async () => {
  const a = img();
  applyIcon(a, "Vigilante Vigor", "icons/vv.png");
  const antes = sondas.length;
  ultimaSonda().onerror();
  await Promise.resolve();
  assert.equal(a.src, WFM + "icons/vv.png");

  const b = img();
  applyIcon(b, "Vigilante Vigor", "icons/vv2.png");
  assert.equal(sondas.length, antes, "el resultado negativo también se cachea");
  await Promise.resolve();
  assert.equal(b.src, WFM + "icons/vv2.png");
});
