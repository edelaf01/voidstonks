// Caché de precios: MEMORY_CACHE -> IndexedDB -> snapshot -> cola de lotes.
//
// Es la pieza que usa media app (reliquias, sets, inventario, ducados) y no tenía ningún test
// que la ejecutara. Todo lo que fija este fichero falla en silencio: no rompe la pantalla, solo
// multiplica las peticiones al worker o deja un precio "cargando" para siempre.
//
// En Node no hay indexedDB, y eso está bien: dbHelper.get/set tragan el error y devuelven null,
// así que estos tests recorren el camino "sin caché local", que es el del primer arranque.

import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

/** Sustituye a la red y anota lo que se pidió. */
const peticiones = [];
let respuestaLote = {};
let respuestaSnapshot = { p: {} };

globalThis.fetch = async (url) => {
  const u = String(url);
  peticiones.push(u);
  if (u.includes("type=prices_snapshot")) {
    return { ok: true, status: 200, json: async () => respuestaSnapshot };
  }
  if (u.includes("type=prices_batch")) {
    return { ok: true, status: 200, json: async () => respuestaLote };
  }
  return { ok: false, status: 404, json: async () => ({}) };
};

const { MEMORY_CACHE, getPriceValue, ensurePriceSnapshot } = await import(
  "../deploy/js/repositories/storage.repository.js"
);

const lotesPedidos = () => peticiones.filter((u) => u.includes("type=prices_batch"));
const slugsDe = (url) => decodeURIComponent(url.split("q=")[1] || "").split(",").filter(Boolean);

// Forma y Kuva no se venden por platino, y pedir su precio devolvía siempre 0 tras dar el viaje
// completo hasta el worker. Se cortan antes de tocar nada.
test("los ítems que no tienen precio se resuelven a 0 sin pedir nada", async () => {
  const antes = peticiones.length;
  const casos = [
    ["Forma Blueprint", "forma_blueprint"],
    ["Kuva", "kuva"],
    ["Riven Sliver", "riven_sliver"],
    ["Exilus Weapon Adapter Blueprint", "exilus_weapon_adapter_blueprint"],
  ];
  for (const [nombre, slug] of casos) {
    assert.equal(await getPriceValue(nombre, slug), 0, nombre);
  }
  // Sin nombre o sin slug tampoco se pide.
  assert.equal(await getPriceValue("", "algo"), 0);
  assert.equal(await getPriceValue("Algo", ""), 0);
  assert.equal(peticiones.length, antes, "ninguno debe generar tráfico");
});

test("un precio ya en memoria no vuelve a pedirse", async () => {
  MEMORY_CACHE.set("ash_prime_set", 120);
  const antes = peticiones.length;
  assert.equal(await getPriceValue("Ash Prime Set", "ash_prime_set"), 120);
  assert.equal(peticiones.length, antes);
});

// El snapshot trae la mediana del catálogo entero; una entrada que ya está en memoria viene del
// IDB del usuario o de wfm_live_prices, y las dos son más específicas. Pisarlas con la mediana
// haría que el precio empeorase al cargar la pestaña.
test("el snapshot rellena huecos pero no pisa lo que ya hay", async () => {
  MEMORY_CACHE.set("mag_prime_set", 999);
  respuestaSnapshot = { p: { mag_prime_set: 10, nyx_prime_set: 45 } };
  await ensurePriceSnapshot();

  assert.equal(MEMORY_CACHE.get("mag_prime_set"), 999, "no debe pisar el valor existente");
  assert.equal(MEMORY_CACHE.get("nyx_prime_set"), 45, "sí debe rellenar el que faltaba");
});

test("el snapshot se baja una sola vez por sesión", async () => {
  const antes = peticiones.filter((u) => u.includes("prices_snapshot")).length;
  await ensurePriceSnapshot();
  await ensurePriceSnapshot();
  assert.equal(peticiones.filter((u) => u.includes("prices_snapshot")).length, antes);
});

// Dos componentes pintando el mismo ítem a la vez (pasa en cada render de reliquias) pedían el
// precio por separado. IN_FLIGHT_PROMISES hace que compartan la misma promesa.
test("dos peticiones simultáneas del mismo ítem comparten una sola promesa", async () => {
  respuestaLote = { volt_prime_set: 77 };
  const a = getPriceValue("Volt Prime Set", "volt_prime_set");
  const b = getPriceValue("Volt Prime Set", "volt_prime_set");
  assert.equal(a, b, "debe devolver literalmente la misma promesa");
  assert.equal(await a, 77);
});

// La URL del lote es la clave de caché del edge: si los slugs no van siempre en el mismo orden,
// dos clientes que piden lo mismo generan dos entradas distintas y ninguna acierta.
test("los slugs del lote van en orden alfabético y en tandas de 25", async () => {
  MEMORY_CACHE.clear();
  respuestaSnapshot = { p: {} };
  const nombres = ["Zeta Prime Set", "Alfa Prime Set", "Media Prime Set"];
  const slugs = ["zeta_prime_set", "alfa_prime_set", "media_prime_set"];
  respuestaLote = Object.fromEntries(slugs.map((s) => [s, 5]));

  const antes = lotesPedidos().length;
  await Promise.all(nombres.map((n, i) => getPriceValue(n, slugs[i])));

  const nuevos = lotesPedidos().slice(antes);
  assert.ok(nuevos.length >= 1, "debe haberse pedido al menos un lote");
  const pedidos = slugsDe(nuevos[0]);
  assert.deepEqual(pedidos, [...pedidos].sort(), "los slugs deben ir ordenados");
  for (const url of nuevos) {
    assert.ok(slugsDe(url).length <= 25, "ningún lote puede pasar de 25 slugs");
  }
});

test("un lote grande se parte en tandas de 25 como mucho", async () => {
  MEMORY_CACHE.clear();
  const slugs = Array.from({ length: 60 }, (_, i) => `item_${String(i).padStart(3, "0")}_set`);
  respuestaLote = Object.fromEntries(slugs.map((s) => [s, 3]));

  const antes = lotesPedidos().length;
  await Promise.all(slugs.map((s) => getPriceValue(`Item ${s}`, s)));

  const nuevos = lotesPedidos().slice(antes);
  const total = nuevos.reduce((n, u) => n + slugsDe(u).length, 0);
  assert.equal(total, 60, "deben pedirse los 60 slugs");
  assert.ok(nuevos.length >= 3, `60 slugs necesitan >=3 tandas, hubo ${nuevos.length}`);
  for (const url of nuevos) assert.ok(slugsDe(url).length <= 25);
});

// Sin el tope de reintentos, un slug que el worker no conoce se quedaba en la cola para
// siempre: la promesa nunca resolvía y el precio se quedaba "cargando" en pantalla.
test("un slug que el worker nunca devuelve acaba resolviendo 0, no se cuelga", async () => {
  MEMORY_CACHE.clear();
  respuestaLote = {}; // el worker responde OK pero sin ese slug
  const precio = await getPriceValue("Fantasma Prime Set", "fantasma_prime_set");
  assert.equal(precio, 0);
});

test("un precio recibido queda cacheado en memoria para la siguiente vez", async () => {
  MEMORY_CACHE.clear();
  respuestaLote = { saryn_prime_set: 42 };
  await getPriceValue("Saryn Prime Set", "saryn_prime_set");
  assert.equal(MEMORY_CACHE.get("saryn_prime_set"), 42);

  const antes = lotesPedidos().length;
  assert.equal(await getPriceValue("Saryn Prime Set", "saryn_prime_set"), 42);
  assert.equal(lotesPedidos().length, antes, "la segunda vez sale de memoria");
});
