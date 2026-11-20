import { test } from "node:test";
import assert from "node:assert/strict";
import {
  VENDER_YA,
  veredictoVenta,
} from "../deploy/js/utils/inventory/vender_ya.js";

test("constantes de configuracion tienen los valores esperados", () => {
  assert.equal(VENDER_YA.VOLUMEN_MIN, 1);
  assert.equal(VENDER_YA.CAIDA_MIN, 0.15);
  assert.equal(VENDER_YA.VC_VIGENCIA_DIAS, 21);
  assert.equal(VENDER_YA.MUCHOS_VENDEDORES, 5);
});

test("sin datos suficientes de precio o media devuelve sinDatos", () => {
  const r = veredictoVenta({});
  assert.deepEqual(r, { urgente: false, motivo: "sinDatos", score: 0 });
});

test("item en el vault no urge vender", () => {
  const r = veredictoVenta({
    tendencia: { vc: { t: "vault", d: "2026-11-01" } },
    hoy: Date.parse("2026-11-10"),
  });
  assert.deepEqual(r, { urgente: false, motivo: "vault", score: 0 });
});

test("resurgencia proxima vigente marca venta urgente", () => {
  const r = veredictoVenta({
    tendencia: { vc: { t: "resurgence_proxima", d: "2026-11-01" }, v: 10 },
    vendedores: 5,
    hoy: Date.parse("2026-11-10"),
  });
  assert.equal(r.urgente, true);
  assert.equal(r.motivo, "resurgenciaProxima");
  assert.equal(r.score, 2.75);
});

test("caida de precio menor al umbral se considera estable", () => {
  const r = veredictoVenta({ precio: 90, tendencia: { p7: 100, v: 5 } });
  assert.deepEqual(r, { urgente: false, motivo: "estable", score: 0 });
});

test("caida con volumen insuficiente se clasifica como pocoVolumen", () => {
  const r = veredictoVenta({ precio: 70, tendencia: { p7: 100, v: 0 } });
  assert.deepEqual(r, { urgente: false, motivo: "pocoVolumen", score: 0 });
});

test("caida significativa con volumen recomienda vender ya", () => {
  const r = veredictoVenta({ precio: 70, tendencia: { p7: 100, v: 5 } });
  assert.equal(r.urgente, true);
  assert.equal(r.motivo, "bajando");
  assert.equal(r.score, 1.43);
});
