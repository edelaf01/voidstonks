import { test } from "node:test";
import assert from "node:assert/strict";

const respuesta = (cuerpo) => async () => ({ ok: true, json: async () => cuerpo });
const ahora = Date.parse("2026-10-05T12:00:00Z");
const energize = { p: 7, h: 8, v: 194.5, pe: 8, rm: 5, pm: 110, hm: 130, vm: 123.5, pem: 130, d: 16, bb: 6 };

test("los precios diarios del cron rellenan los arcanos de una sola vez", async () => {
  const svc = await import("../deploy/js/services/vosfor.service.js?diario");
  let lecturas = 0;
  const lee = async () => { lecturas++; return respuesta({ updated: "2026-10-05T03:40:00Z", arcanos: { arcane_energize: energize } })(); };
  await svc.cargaPreciosDiarios({ lee, ahora });
  await svc.cargaPreciosDiarios({ lee, ahora });
  assert.equal(lecturas, 1);
  assert.deepEqual(svc.ARC_STATS.get("arcane_energize"), energize);
  assert.equal(svc.vosforPerPlat({ vosfor: 100 }, energize).sellers, null, "las estadísticas no dan vendedores: no se inventan");
});

test("un fichero de hace más de 3 días se ignora y manda el worker", async () => {
  const svc = await import("../deploy/js/services/vosfor.service.js?viejo");
  const d = await svc.cargaPreciosDiarios({ lee: respuesta({ updated: "2026-10-01T03:40:00Z", arcanos: { arcane_energize: energize } }), ahora });
  assert.equal(d, null);
  assert.equal(svc.ARC_STATS.has("arcane_energize"), false);
});

test("sin fichero o con error, no rompe nada", async () => {
  const svc = await import("../deploy/js/services/vosfor.service.js?sin");
  assert.equal(await svc.cargaPreciosDiarios({ lee: async () => ({ ok: false }), ahora }), null);
  const otro = await import("../deploy/js/services/vosfor.service.js?error");
  assert.equal(await otro.cargaPreciosDiarios({ lee: async () => { throw new Error("red"); }, ahora }), null);
});
