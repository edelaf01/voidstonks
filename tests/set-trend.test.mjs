// Histórico local de precios de los sets propios: el util, cómo se apunta y el bloque del panel Prime.
import { test } from "node:test";
import assert from "node:assert/strict";

const almacen = new Map();
globalThis.localStorage = {
  getItem: (k) => (almacen.has(k) ? almacen.get(k) : null),
  setItem: (k, v) => almacen.set(k, String(v)),
  removeItem: (k) => almacen.delete(k),
};

const { apuntaPrecios, tendencias, diaDe, DIAS_GUARDADOS } = await import("../deploy/js/utils/inventory/set_trend.js");
const { state } = await import("../deploy/js/state.js");
const { apuntaPreciosDeSets, tendenciaDeSets } = await import("../deploy/js/services/inventory/inventory.service.js");
const { leeHistorialSets } = await import("../deploy/js/repositories/storage.repository.js");
const { setTrendHtml } = await import("../deploy/js/ui.components/inventory/ui_set_trend.js");

const HOY = 20000;
const DIA_MS = 86400000;

test("diaDe cuenta días enteros desde 1970", () => {
  assert.equal(diaDe(0), 0);
  assert.equal(diaDe(DIA_MS - 1), 0);
  assert.equal(diaDe(3 * DIA_MS), 3);
});

test("sin histórico empieza hoy con el precio redondeado", () => {
  assert.deepEqual(apuntaPrecios(null, { "Saryn Prime": 60.4 }, HOY), { d: HOY, p: { "Saryn Prime": [60] } });
});

test("los días sin abrir la app quedan a 0 y el de hoy lleva su precio", () => {
  const h = apuntaPrecios({ d: HOY - 1, p: { "Saryn Prime": [60] } }, { "Saryn Prime": 65 }, HOY + 2);
  assert.deepEqual(h, { d: HOY - 1, p: { "Saryn Prime": [60, 0, 0, 65] } });
});

test("volver a apuntar el mismo día sin precio conserva el que ya había", () => {
  const h = apuntaPrecios({ d: HOY, p: { "Saryn Prime": [60] } }, { "Saryn Prime": 0 }, HOY);
  assert.deepEqual(h.p["Saryn Prime"], [60]);
});

test("un set que ya no tienes sale del histórico y uno nuevo entra con ceros detrás", () => {
  const h = apuntaPrecios({ d: HOY - 1, p: { "Saryn Prime": [60, 62] } }, { "Mesa Prime": 90 }, HOY);
  assert.deepEqual(h.p, { "Mesa Prime": [0, 90] });
});

test("solo se guardan los últimos DIAS_GUARDADOS días", () => {
  const serie = Array.from({ length: DIAS_GUARDADOS }, (_, i) => i + 1);
  const h = apuntaPrecios({ d: HOY - DIAS_GUARDADOS + 1, p: { "Saryn Prime": serie } }, { "Saryn Prime": 99 }, HOY + 1);
  assert.equal(h.d, HOY - DIAS_GUARDADOS + 2);
  assert.equal(h.p["Saryn Prime"].length, DIAS_GUARDADOS);
  assert.equal(h.p["Saryn Prime"][0], 2);
  assert.equal(h.p["Saryn Prime"].at(-1), 99);
});

// Un reloj que se fue al futuro y volvió dejaba d > hoy: largo negativo y series vacías para siempre.
test("un histórico con fecha futura se descarta y se empieza de cero", () => {
  assert.deepEqual(apuntaPrecios({ d: HOY + 5, p: { "Saryn Prime": [1] } }, { "Saryn Prime": 60 }, HOY), { d: HOY, p: { "Saryn Prime": [60] } });
});

test("tendencias compara con hace N días y ordena de más subida a más bajada", () => {
  const h = { d: HOY - 2, p: { A: [100, 0, 110], B: [50, 0, 40], C: [20, 0, 20] } };
  assert.deepEqual(tendencias(h, HOY, 2), [
    { clave: "A", actual: 110, antes: 100, cambio: 10, pct: 10 },
    { clave: "C", actual: 20, antes: 20, cambio: 0, pct: 0 },
    { clave: "B", actual: 40, antes: 50, cambio: -10, pct: -20 },
  ]);
});

test("un hueco a 0 toma el último precio conocido de antes", () => {
  const h = { d: HOY - 3, p: { A: [80, 0, 0, 0] } };
  assert.deepEqual(tendencias(h, HOY, 2), [{ clave: "A", actual: 80, antes: 80, cambio: 0, pct: 0 }]);
});

test("sin datos de hace N días no hay comparación", () => {
  assert.deepEqual(tendencias({ d: HOY - 1, p: { A: [80, 90] } }, HOY, 2), []);
  assert.deepEqual(tendencias(null, HOY, 2), []);
});

function inventario() {
  almacen.clear();
  state.setsDatabase = {
    "Saryn Prime": ["Saryn Prime Blueprint", "Saryn Prime Chassis"],
    "Mesa Prime": ["Mesa Prime Blueprint"],
  };
  state.primeInventory = { "Saryn Prime Chassis": 1, "Mesa Prime Blueprint": 0 };
}

test("se apunta solo el precio de los sets de los que tienes alguna pieza", () => {
  inventario();
  apuntaPreciosDeSets({ saryn_prime_set: 60, mesa_prime_set: 90 }, HOY * DIA_MS);
  assert.deepEqual(leeHistorialSets(), { d: HOY, p: { "Saryn Prime": [60] } });
});

test("sin snapshot o sin sets propios no se toca el histórico", () => {
  inventario();
  apuntaPreciosDeSets(undefined, HOY * DIA_MS);
  assert.equal(leeHistorialSets(), null);
  state.primeInventory = {};
  apuntaPreciosDeSets({ saryn_prime_set: 60 }, HOY * DIA_MS);
  assert.equal(leeHistorialSets(), null);
});

test("tendenciaDeSets lee lo apuntado en días distintos", () => {
  inventario();
  apuntaPreciosDeSets({ saryn_prime_set: 60 }, (HOY - 2) * DIA_MS);
  apuntaPreciosDeSets({ saryn_prime_set: 75 }, HOY * DIA_MS);
  assert.deepEqual(tendenciaDeSets(2, HOY * DIA_MS), [{ clave: "Saryn Prime", actual: 75, antes: 60, cambio: 15, pct: 25 }]);
});

test("el bloque enseña primero las subidas y después las bajadas más fuertes", () => {
  state.currentLang = "es";
  const html = setTrendHtml([
    { clave: "A", actual: 110, antes: 100, cambio: 10, pct: 10 },
    { clave: "B", actual: 95, antes: 100, cambio: -5, pct: -5 },
    { clave: "C", actual: 80, antes: 100, cambio: -20, pct: -20 },
  ]);
  const nombres = [...html.matchAll(/set-trend-name">([^<]+)</g)].map((m) => m[1]);
  assert.deepEqual(nombres, ["A", "C", "B"]);
  assert.match(html, /100 → 110/);
  assert.match(html, /\+10%/);
  assert.match(html, /-20%/);
});

test("el nombre del set va escapado", () => {
  const html = setTrendHtml([{ clave: "<b>X</b>", actual: 2, antes: 1, cambio: 1, pct: 100 }]);
  assert.ok(!html.includes("<b>X</b>"));
  assert.match(html, /&lt;b&gt;X&lt;\/b&gt;/);
});

test("sin datos explica cuándo aparecerá y sin cambios lo dice", () => {
  state.currentLang = "es";
  assert.match(setTrendHtml([]), /Vuelve dentro de 2 días/);
  assert.match(setTrendHtml([{ clave: "A", actual: 1, antes: 1, cambio: 0, pct: 0 }]), /Ningún set tuyo ha cambiado/);
  state.currentLang = "en";
  assert.match(setTrendHtml([]), /Come back in 2 days/);
});
