import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ESTADO_SESION_INICIAL,
  siguienteSesion,
} from "../deploy/js/utils/inventory/sesiones_farmeo.js";

test("estado inicial contiene valores nulos", () => {
  assert.deepEqual(ESTADO_SESION_INICIAL, {
    actual: null,
    mision: null,
    reliquia: null,
    cambio: null,
  });
});

test("evento mision actualiza el nombre de la mision", () => {
  const estado = siguienteSesion(ESTADO_SESION_INICIAL, { tipo: "mision", nombre: "Mot" });
  assert.equal(estado.mision, "Mot");
});

test("evento reliquia guarda la reliquia pendiente", () => {
  const estado = siguienteSesion(ESTADO_SESION_INICIAL, { tipo: "reliquia", nombre: "Axi A1" });
  assert.equal(estado.reliquia, "Axi A1");
});

test("evento inicio arranca una sesion con la mision previa", () => {
  const conMision = { ...ESTADO_SESION_INICIAL, mision: "Mot" };
  const estado = siguienteSesion(conMision, { tipo: "inicio", ahora: 1000, t: 10 });
  assert.equal(estado.actual?.mision, "Mot");
  assert.equal(estado.actual?.inicio, 1000);
  assert.equal(estado.actual?.inicioT, 10);
  assert.equal(estado.actual?.cerrada, false);
});

test("evento recompensas incrementa rondas y calcula duracion", () => {
  const sesion = siguienteSesion(ESTADO_SESION_INICIAL, { tipo: "inicio", ahora: 0, t: 0 });
  const estado = siguienteSesion(sesion, { tipo: "recompensas", ahora: 120000, t: 120 });
  assert.equal(estado.actual.rondas, 1);
  assert.equal(estado.actual.minutos, 2);
});

test("evento confirmadas suma items, plat y emite cambio", () => {
  const sesion = siguienteSesion(ESTADO_SESION_INICIAL, { tipo: "inicio", ahora: 0, t: 0 });
  const items = [{ name: "Braton Prime", qty: 2, plat: 15 }];
  const estado = siguienteSesion(sesion, { tipo: "confirmadas", items, ahora: 60000 });
  assert.equal(estado.actual.plat, 30);
  assert.equal(estado.actual.items.length, 1);
  assert.equal(estado.cambio?.plat, 30);
});

test("evento cierre marca la sesion como cerrada y emite cambio", () => {
  const sesion = siguienteSesion(ESTADO_SESION_INICIAL, { tipo: "inicio", ahora: 0, t: 0 });
  const estado = siguienteSesion(sesion, { tipo: "cierre", ahora: 180000, t: 180 });
  assert.equal(estado.actual.cerrada, true);
  assert.equal(estado.actual.minutos, 3);
  assert.equal(estado.cambio?.cerrada, true);
});

test("evento sin sesion activa no modifica el estado", () => {
  const estado = siguienteSesion(ESTADO_SESION_INICIAL, { tipo: "cierre" });
  assert.equal(estado.actual, null);
});
