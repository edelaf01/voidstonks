import { test } from "node:test";
import assert from "node:assert/strict";

const guardado = {};
globalThis.localStorage = { getItem: (k) => guardado[k] ?? null, setItem: (k, v) => { guardado[k] = v; }, removeItem() {} };
globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });

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
  // empty or "undefined" src resolves against current page and downloads the whole HTML as an image
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

  applyIcon(a, "Ash Prime Neuroptics Blueprint");
  applyIcon(b, "Volt Prime Neuroptics Blueprint");

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
