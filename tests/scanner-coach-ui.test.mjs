import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

const almacen = new Map();
globalThis.localStorage = {
  getItem: (k) => (almacen.has(k) ? almacen.get(k) : null),
  setItem: (k, v) => almacen.set(k, String(v)),
  removeItem: (k) => almacen.delete(k),
};

const nodo = () => ({
  id: "", className: "", style: {}, innerHTML: "", innerText: "", textContent: "",
  appendChild() {}, remove() {}, addEventListener() {},
  classList: { add() {}, remove() {}, contains: () => false },
  querySelector: () => nodo(), querySelectorAll: () => [nodo(), nodo()],
  getBoundingClientRect: () => ({ top: 10, left: 10, right: 90, bottom: 30, width: 80, height: 20 }),
});
const nodos = new Map();
globalThis.document = {
  // no toast container on purpose: showToast 60 s timer keeps the test process alive until expiry
  getElementById: (id) => (id === "toast-container" ? null
    : (nodos.has(id) ? nodos.get(id) : (nodos.set(id, nodo()), nodos.get(id)))),
  createElement: () => nodo(),
  body: { appendChild() {} },
};
globalThis.innerHeight = 800;

const C = await import("../deploy/js/ui.components/ui_scanner_coach.js");

beforeEach(() => {
  almacen.clear();
  globalThis.ScannerService = { detectionLocked: false };
});

describe("el tour para el escáner y lo deja como estaba", () => {
  test("abrirlo bloquea la detección", () => {
    C.abreTourEscaner();
    assert.equal(globalThis.ScannerService.detectionLocked, true);
  });

  test("cerrarlo la reanuda si estaba corriendo", () => {
    C.abreTourEscaner();
    C.cierraTourEscaner();
    assert.equal(globalThis.ScannerService.detectionLocked, false);
  });

  test("si YA estaba bloqueado (modal de recompensa abierto), cerrar NO lo desbloquea", () => {
    globalThis.ScannerService.detectionLocked = true;
    C.abreTourEscaner();
    C.cierraTourEscaner();
    assert.equal(globalThis.ScannerService.detectionLocked, true,
      "el tour ha reactivado el escáner con el modal abierto");
  });

  test("sin escáner arrancado no revienta", () => {
    globalThis.ScannerService = undefined;
    C.abreTourEscaner();
    C.cierraTourEscaner();
  });
});

describe("avisos de contexto", () => {
  test("el aviso de una pantalla se marca como visto y no vuelve", async () => {
    const { yaVisto } = await import("../deploy/js/utils/scanner_coach.js");
    C.avisaContexto("INVENTORY");
    assert.equal(yaVisto("INVENTORY"), true);
  });

  test("la pantalla de recompensa no marca ni avisa: tiene reloj", async () => {
    const { yaVisto } = await import("../deploy/js/utils/scanner_coach.js");
    C.avisaContexto("REWARD");
    assert.equal(yaVisto("REWARD"), false);
  });
});

describe("el foco cae sobre el elemento correcto", () => {
  test("se salta los pasos cuyo elemento está oculto", () => {
    const oculto = { ...nodo(), getBoundingClientRect: () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }) };
    nodos.set("btn-manual-scan", oculto);
    nodos.set("btn-auto-scan", oculto);
    C.abreTourEscaner();
    C.avanzaTourEscaner();
    C.avanzaTourEscaner();
    const hueco = nodos.get("coach-hole");
    assert.ok(!/width:0px|height:0px/.test(hueco.style.cssText || ""), "recorte de tamaño cero");
    C.cierraTourEscaner();
    nodos.delete("btn-manual-scan");
    nodos.delete("btn-auto-scan");
  });

  test("el HUD se abre para el tour y se deja como estaba", () => {
    const hud = nodos.get("inv-hud") || nodo();
    nodos.set("inv-hud", hud);
    hud.style.display = "none";
    C.abreTourEscaner();
    assert.equal(hud.style.display, "block", "el tour explica el HUD: hay que verlo");
    C.cierraTourEscaner();
    assert.equal(hud.style.display, "none", "no puede dejarlo abierto si estaba cerrado");
  });
});
