import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

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

test("dos peticiones simultáneas del mismo ítem comparten una sola promesa", async () => {
  respuestaLote = { volt_prime_set: 77 };
  const a = getPriceValue("Volt Prime Set", "volt_prime_set");
  const b = getPriceValue("Volt Prime Set", "volt_prime_set");
  assert.equal(a, b, "debe devolver literalmente la misma promesa");
  assert.equal(await a, 77);
});

// batch url is edge cache key: if slugs are not sorted, identical requests miss edge cache
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

test("un slug que el worker nunca devuelve acaba resolviendo 0, no se cuelga", async () => {
  MEMORY_CACHE.clear();
  respuestaLote = {};
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

test("el snapshot se renueva pasada una hora y solo pisa lo que puso el anterior", async () => {
  const peticionesSnapshot = () => peticiones.filter((u) => u.includes("type=prices_snapshot")).length;
  const ahora = Date.now() + 10 * 3600000;
  MEMORY_CACHE.set("de_otra_fuente", 99);
  respuestaSnapshot = { p: { de_otra_fuente: 50, del_snapshot: 10 } };
  await ensurePriceSnapshot(ahora);
  const antes = peticionesSnapshot();
  await ensurePriceSnapshot(ahora + 30 * 60000);
  assert.equal(peticionesSnapshot(), antes, "dentro de la hora no se vuelve a pedir");
  assert.equal(MEMORY_CACHE.get("de_otra_fuente"), 99, "el IDB del usuario o el precio en vivo mandan");
  assert.equal(MEMORY_CACHE.get("del_snapshot"), 10);

  respuestaSnapshot = { p: { de_otra_fuente: 55, del_snapshot: 12 } };
  await ensurePriceSnapshot(ahora + 2 * 3600000);
  assert.equal(peticionesSnapshot(), antes + 1);
  assert.equal(MEMORY_CACHE.get("del_snapshot"), 12, "lo que puso el snapshot anterior se actualiza");
  assert.equal(MEMORY_CACHE.get("de_otra_fuente"), 99);
  assert.ok(peticiones.filter((u) => u.includes("type=prices_snapshot")).length >= 1);
});
