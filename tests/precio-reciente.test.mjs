// Precio de venta sugerido con las ventas de las últimas 48 h (utils/market/precio_reciente.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { precioSugerido, desfase, revisaPrecios } from "../deploy/js/utils/market/precio_reciente.js";

const AHORA = Date.parse("2026-09-27T16:00:00Z");
const hace = (h) => new Date(AHORA - h * 3600000).toISOString();
// Ash Prime Set medido el 27-09: última venta 63 a las 14:00, mediana de 48 h 67,5 con 157 ventas.
const ASH = { median: 67, volume: 89, reciente: { "": { ultima: 63, hora: hace(2), mediana: 67.5, volumen: 157 } } };
// Primed Flow: el R0 y el R10 no se parecen en nada.
const FLOW = { median: 40, reciente: { 0: { ultima: 22, hora: hace(1), mediana: 26, volumen: 164 }, 10: { ultima: 90, hora: hace(1), mediana: 82, volumen: 130 } } };

test("la mediana de 48 h se mueve hacia la última venta si es de las últimas 12 h", () => {
  assert.equal(precioSugerido(ASH, null, AHORA).precio, 65);
  const vieja = { reciente: { "": { ...ASH.reciente[""], hora: hace(20) } } };
  assert.equal(precioSugerido(vieja, null, AHORA).precio, 68, "una venta de hace 20 h ya no manda");
});

test("cada rango con su mercado, y sin ventas del rango no se inventa con la mediana mezclada", () => {
  assert.equal(precioSugerido(FLOW, 0, AHORA).precio, 24);
  assert.equal(precioSugerido(FLOW, 10, AHORA).precio, 86);
  assert.equal(precioSugerido(FLOW, 5, AHORA), null);
});

test("sin ventas recientes, la mediana del último día, solo en ítems sin rango", () => {
  assert.deepEqual(precioSugerido({ median: 67, volume: 89 }, null, AHORA), { precio: 67, base: "dia", mediana: 67, ventas: 89 });
  assert.equal(precioSugerido({ median: 67 }, 3, AHORA), null);
  assert.equal(precioSugerido(undefined, null, AHORA), null);
});

test("desfasada si se aparta más de un 10 % y de 2p", () => {
  assert.equal(desfase(11, 10).desfasada, false, "1p de diferencia no compensa otra petición");
  assert.equal(desfase(80, 65).desfasada, true);
  assert.equal(desfase(80, 65).pct, 23);
  assert.equal(desfase(66, 65).desfasada, false);
  assert.equal(desfase(40, 65).dif, -25);
});

test("revisa solo las ventas, de más a menos desfase, y cuenta las que están al día o sin datos", () => {
  const ordenes = [
    { id: "a", type: "sell", itemSlug: "ash_prime_set", platinum: 80 },
    { id: "b", type: "sell", itemSlug: "primed_flow", rank: 10, platinum: 60 },
    { id: "c", type: "sell", itemSlug: "primed_flow", rank: 0, platinum: 25 },
    { id: "d", type: "buy", itemSlug: "ash_prime_set", platinum: 10 },
    { id: "e", type: "sell", itemSlug: "sin_mercado", platinum: 5 },
  ];
  const r = revisaPrecios(ordenes, { ash_prime_set: ASH, primed_flow: FLOW }, AHORA);
  assert.deepEqual(r.desfasadas.map((d) => [d.orden.id, d.precio, d.pct]), [["b", 86, -30], ["a", 65, 23]]);
  assert.equal(r.alDia, 1);
  assert.equal(r.sinDatos, 1);
});
