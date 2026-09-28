// applyIcon execution behavior (utils/wfm_assets.js)
// checks image URLs, timing and probe counts during runtime
// bad paths like "Cannot GET ... hunter_munitions.webp" happened because getItemIcon ALWAYS returns a path
// regardless of whether the file exists, flickering broken icons

import { test } from "node:test";
import assert from "node:assert/strict";

const guardado = {};
globalThis.localStorage = { getItem: (k) => guardado[k] ?? null, setItem: (k, v) => { guardado[k] = v; }, removeItem() {} };
globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });

/** probes created by checkLocal, resolved manually */
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
  // empty or "undefined" src is not inert: browsers resolve it against current page and download the whole
  // HTML document as an image
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

  // asynchronous decision: on return from applyIcon src remains empty; a subsequent if (!img.src) once
  // slipped into ui_orders.js, ALWAYS forcing the CDN over local assets
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

  // Ash and Volt share prime_neuroptics.webp: cached by PATH rather than name, sharing one check across
  // dozens of order cards
  applyIcon(a, "Ash Prime Neuroptics Blueprint");
  applyIcon(b, "Volt Prime Neuroptics Blueprint");

  // both arrive before the first resolves: caches the in-flight promise so concurrent checks deduplicate
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
