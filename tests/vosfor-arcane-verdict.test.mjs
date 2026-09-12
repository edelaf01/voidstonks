import { test } from "node:test";
import assert from "node:assert/strict";

import { arcaneVerdict, ARC_STATS } from "../deploy/js/services/vosfor.service.js";

const ARCANES = { raro: { vosfor: 24, maxRank: 5, rarity: "RARE" } };
ARC_STATS.set("raro", { pe: 6, v: 10, vm: 2, bb: 0, pem: 0, bbm: 0, rm: 0 });

const GANADOR_CRUDO = { rate: 0.5, balancedRate: 0.2, packId: "a", pack: { es: "A", en: "A" } };
const GASTO_REAL = { rate: 0.3, balancedRate: 0.3, packId: "b", pack: { es: "B", en: "B" } };

test("descuenta la disolución con la tasa ajustada del pack de gasto real", () => {
  const v = arcaneVerdict("raro", ARCANES, GASTO_REAL);
  assert.equal(v.netDissolveAdj, 113.4);
  assert.equal(v.bestAction, "dissolve", "113 disolviendo contra 84 garantizados");
  assert.equal(v.bestPackEs, "B");
});

test("con el ganador crudo el mismo arcano cambiaba de veredicto: por eso el caller pasa el ajustado", () => {
  const v = arcaneVerdict("raro", ARCANES, GANADOR_CRUDO);
  assert.equal(v.netDissolveAdj, 75.6);
  assert.equal(v.bestAction, "sell_r0");
});

test("el EV nominal por copia sale de la tasa cruda del pack de gasto, para el tooltip", () => {
  const v = arcaneVerdict("raro", ARCANES, GASTO_REAL);
  assert.equal(v.dissolvePlat, 7.2, "24 x 0,3, sin el 7.199999999999999 de coma flotante");
});

test("los platinos del veredicto van redondeados a un decimal", () => {
  ARC_STATS.set("barato", { pe: 2, v: 1.5, vm: 0, bb: 0, pem: 19, bbm: 0, rm: 5 });
  const v = arcaneVerdict("barato", { barato: { vosfor: 24, maxRank: 5 } }, GASTO_REAL);
  assert.equal(v.sell, 0.6);
  assert.equal(v.sell21R0, 12.6);
  for (const k of ["sellR5", "dissolvePlat", "dissolvePlat21", "netDissolveAdj", "guaranteedBest"]) {
    assert.match(String(v[k]), /^\d+(\.\d)?$/, `${k} = ${v[k]}`);
  }
});

test("sin pack todavía el veredicto queda pendiente", () => {
  const v = arcaneVerdict("raro", ARCANES, null);
  assert.equal(v.bestAction, "pending");
  assert.equal(v.netDissolveAdj, 0);
});

test("sin stats no hay veredicto", () => {
  assert.deepEqual(arcaneVerdict("sin_datos", { sin_datos: { vosfor: 24 } }, GASTO_REAL), {});
});
