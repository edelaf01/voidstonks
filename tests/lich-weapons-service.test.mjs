import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

let respuesta = { vendors: [] };
let ok = true;
const urls = [];
globalThis.fetch = async (url) => {
  const u = String(url);
  urls.push(u);
  if (u.includes("type=time")) return { ok: true, status: 200, json: async () => ({ now: Date.now() }) };
  if (!ok) throw new Error("sin red");
  return { ok: true, status: 200, json: async () => respuesta };
};

const { fetchLichWeapons } = await import("../deploy/js/services/farms/lich_weapons.service.js");

const vendedor = (key, weapons, end = Date.now() + 3600_000) => ({ key, weapons, end });
const arma = (name) => ({ name, bonus: { element: "Heat", percent: 40 } });

test("la rotación del worker se devuelve tal cual cuando trae armas", async () => {
  respuesta = { vendors: [vendedor("eleanor", [arma("Coda Hema")])] };
  ok = true;
  const v = await fetchLichWeapons(true);
  assert.equal(v.length, 1);
  assert.equal(v[0].key, "eleanor");
});

test("un vendedor sin armas se descarta sin llevarse a los demás", async () => {
  respuesta = {
    vendors: [
      vendedor("eleanor", []),
      vendedor("glast", [arma("Tenet Envoy")]),
      { key: "roto" },
      { weapons: [arma("Sin Key")] },
    ],
  };
  ok = true;
  const v = await fetchLichWeapons(true);
  assert.deepEqual(v.map((x) => x.key), ["glast"]);
});

test("una respuesta con forma inesperada devuelve vacío, no a medias", async () => {
  ok = true;
  for (const cuerpo of [{}, { vendors: null }, { vendors: "no es lista" }, null]) {
    respuesta = cuerpo;
    assert.deepEqual(await fetchLichWeapons(true), [], JSON.stringify(cuerpo));
  }
});

test("forzar el refresco estrena URL para saltarse también la caché del navegador", async () => {
  respuesta = { vendors: [vendedor("eleanor", [arma("Coda Hema")])] };
  ok = true;
  urls.length = 0;

  await fetchLichWeapons(false);
  const normal = urls.find((u) => u.includes("lich_weapons"));
  assert.ok(!normal.includes("_cb="), "sin force no se ensucia la URL");

  urls.length = 0;
  await fetchLichWeapons(true);
  assert.match(urls.find((u) => u.includes("lich_weapons")), /_cb=\d+/);
});

test("si el worker falla, no se sirve una rotación ya terminada", async () => {
  const errorReal = console.error;
  console.error = () => {};
  try {
    ok = false;
    assert.deepEqual(await fetchLichWeapons(true), []);
  } finally {
    console.error = errorReal;
    ok = true;
  }
});

test("antes de nada se sincroniza el reloj del servidor", async () => {
  respuesta = { vendors: [vendedor("eleanor", [arma("Coda Hema")])] };
  ok = true;
  urls.length = 0;
  await fetchLichWeapons(true);
  assert.ok(urls.some((u) => u.includes("lich_weapons")), "debe pedir las armas");
});
