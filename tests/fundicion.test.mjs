import { test } from "node:test";
import assert from "node:assert/strict";
import { piezasDeConstruccion } from "../deploy/js/utils/inventory/fundicion.js";

const setsDatabase = {
  "Zhuge Prime": ["Zhuge Prime Blueprint", "Zhuge Prime Barrel", "Zhuge Prime String", "Zhuge Prime Grip"],
  "Zephyr Prime": ["Zephyr Prime Blueprint", "Zephyr Prime Neuroptics Blueprint", "Zephyr Prime Chassis Blueprint", "Zephyr Prime Systems Blueprint"],
  "Helios Prime": ["Helios Prime Blueprint", "Helios Prime Cerebrum", "Helios Prime Carapace", "Helios Prime Systems"],
};

const reqs = (set, piece) => set === "Zhuge Prime" && piece === "Zhuge Prime String" ? 2 : 1;

test("arma: plano y componentes según requeridas()", () => {
  const piezas = piezasDeConstruccion("ZHUGE PRIME", setsDatabase, reqs);
  assert.deepEqual(piezas, [
    { name: "Zhuge Prime Blueprint", qty: 1 },
    { name: "Zhuge Prime Barrel", qty: 1 },
    { name: "Zhuge Prime String", qty: 2 },
    { name: "Zhuge Prime Grip", qty: 1 }
  ]);
});

test("warframe: plano principal, y componentes terminados en Blueprint se obvian (se piden ya forjados)", () => {
  const piezas = piezasDeConstruccion("ZEPHYR PRIME", setsDatabase, reqs);
  assert.deepEqual(piezas, [
    { name: "Zephyr Prime Blueprint", qty: 1 }
  ]);
});

test("componente suelto: si es un blueprint de algún set, lo devuelve", () => {
  const piezas = piezasDeConstruccion("ZEPHYR PRIME NEUROPTICS", setsDatabase, reqs);
  assert.deepEqual(piezas, [
    { name: "Zephyr Prime Neuroptics Blueprint", qty: 1 }
  ]);
});

test("centinela: plano principal y piezas no-plano", () => {
  const piezas = piezasDeConstruccion("HELIOS PRIME", setsDatabase, reqs);
  assert.deepEqual(piezas, [
    { name: "Helios Prime Blueprint", qty: 1 },
    { name: "Helios Prime Cerebrum", qty: 1 },
    { name: "Helios Prime Carapace", qty: 1 },
    { name: "Helios Prime Systems", qty: 1 }
  ]);
});

test("FORMA u objeto irrelevante devuelve array vacío", () => {
  assert.deepEqual(piezasDeConstruccion("FORMA", setsDatabase, reqs), []);
});
