import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeDocument } from "./_helpers/fake-canvas.mjs";

installFakeDocument();
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const { DucatKioskService } = await import("../deploy/js/services/scanner/ducat_kiosk.service.js");
const { state } = await import("../deploy/js/state.js");
await import("../deploy/js/scanner/live_scanner.js");

function capturaConsola() {
  const origLog = console.log;
  const logs = [];
  console.log = (...args) => logs.push(args.join(" "));
  return { logs, para() { console.log = origLog; } };
}

test("onSale con stock escribe en consola la venta descontada y remanente", async () => {
  const { logs, para } = capturaConsola();
  try {
    state.primeInventory = { "Vadarya Prime Receiver": 5 };
    DucatKioskService.onSale([{ name: "Vadarya Prime Receiver", qty: 2, ducats: 90 }]);
    assert.equal(logs[0], "[KIOSKO] venta descontada: 2× Vadarya Prime Receiver (quedan 3)");
  } finally {
    para();
    state.primeInventory = {};
    DucatKioskService.reset();
    DucatKioskService.vendiendo = null;
    DucatKioskService.enMesa.clear();
  }
});

test("onSale sin stock registrado escribe en consola las piezas ausentes", async () => {
  const { logs, para } = capturaConsola();
  try {
    state.primeInventory = {};
    DucatKioskService.onSale([{ name: "Vadarya Prime Receiver", qty: 2, ducats: 90 }]);
    assert.equal(logs[0], "[KIOSKO] venta descontada: nada · sin stock registrado: Vadarya Prime Receiver");
  } finally {
    para();
    state.primeInventory = {};
    DucatKioskService.reset();
    DucatKioskService.vendiendo = null;
    DucatKioskService.enMesa.clear();
  }
});

test("onSale con mezcla de piezas con stock y sin stock escribe ambos tramos", async () => {
  const { logs, para } = capturaConsola();
  try {
    state.primeInventory = { "Vadarya Prime Receiver": 5 };
    DucatKioskService.onSale([
      { name: "Vadarya Prime Receiver", qty: 2, ducats: 90 },
      { name: "Zylok Prime Barrel", qty: 1, ducats: 45 }
    ]);
    assert.equal(logs[0], "[KIOSKO] venta descontada: 2× Vadarya Prime Receiver (quedan 3) · sin stock registrado: Zylok Prime Barrel");
  } finally {
    para();
    state.primeInventory = {};
    DucatKioskService.reset();
    DucatKioskService.vendiendo = null;
    DucatKioskService.enMesa.clear();
  }
});
