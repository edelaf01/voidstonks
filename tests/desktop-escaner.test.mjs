import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeDocument } from "./_helpers/fake-canvas.mjs";

globalThis.location = { hostname: "voidstonks.localhost" };
const enviados = [];
let alAccion = null;
globalThis.voidstonksNativo = {
  paneles: async (d) => { enviados.push(d); return true; },
  alAccion: (fn) => { alAccion = fn; return () => {}; },
};

installFakeDocument();
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const { avisa, escucha, pistasDelLog } = await import("../deploy/js/utils/ganchos.js");
const svc = await import("../deploy/js/services/desktop.service.js");
const { duermePorLog, armaRivenPorLog } = await import("../deploy/js/services/scanner/log_gate.service.js");
const { EELogLive } = await import("../deploy/js/services/scanner/eelog_live.service.js");
const { conectaEscaner } = await import("../deploy/js/ui.components/ui_desktop_escaner.js");
const { ScannerHUD } = await import("../deploy/js/ui.components/ui_scanner_hud.js");

const esperaCola = () => new Promise((r) => setTimeout(r, 0));

test("al conectar el escritorio, las pistas del log salen del EE.log", () => {
  conectaEscaner();
  conectaEscaner();
  assert.equal(pistasDelLog.duerme, duermePorLog);
  assert.equal(pistasDelLog.armaRiven, armaRivenPorLog);
  assert.equal(pistasDelLog.reliquiaPorGastar(), EELogLive.reliquiaPorGastar());
});

test("lo que avisa el escáner acaba en el overlay, y se quita cuando toca", async () => {
  svc.activaOverlay(true);
  avisa("kiosko", { items: [{ name: "Paris Prime String", qty: 2, plat: 4, ducats: 25 }], rotulo: "A la venta" });
  await esperaCola();
  avisa("kiosko", { items: [], rotulo: "A la venta" });
  await esperaCola();
  avisa("riven", { tipo: "tirada", datos: { arma: "Torid", stats: [], rotulos: {} } });
  await esperaCola();
  avisa("escaner-parado");
  await esperaCola();
  assert.deepEqual(enviados.map((d) => [d.grupo, d.paneles.length]), [["kiosko", 1], ["kiosko", 0], ["riven", 1], ["riven", 0]]);
  svc.activaOverlay(false);
});

test("los clics del overlay y las reliquias del log vuelven al escáner como avisos", () => {
  const recibidos = [];
  escucha("overlay-reliquias", (a) => recibidos.push(["overlay", a]));
  escucha("reliquia-abierta", (n) => recibidos.push(["abierta", n]));
  alAccion?.("reliquias", "refino:Rad");
  alAccion?.("kiosko", "vendido:1");
  EELogLive.onReliquiaAbierta("Meso K9");
  assert.deepEqual(recibidos, [["overlay", "refino:Rad"], ["abierta", "Meso K9"]]);
});

test("ajustaPanelesAlContexto respeta reliquias en RELICS y kiosko en INVENTORY", async () => {
  svc.activaOverlay(true);
  enviados.length = 0;
  avisa("reliquias", { picks: [], era: "Meso", opciones: {} });
  await esperaCola();
  avisa("contexto", "RELICS");
  await esperaCola();
  assert.equal(enviados.filter(d => d.grupo === "reliquias" && d.paneles.length === 0).length, 0);

  avisa("kiosko", { items: [{ name: "Braton", qty: 1 }], rotulo: "Prueba" });
  await esperaCola();
  avisa("contexto", "INVENTORY");
  await esperaCola();
  assert.equal(enviados.filter(d => d.grupo === "reliquias" && d.paneles.length === 0).length, 1);
  assert.equal(enviados.filter(d => d.grupo === "kiosko" && d.paneles.length === 0).length, 0);
  svc.activaOverlay(false);
});

test("ScannerHUD en inventario borra el panel de ducados", async () => {
  svc.activaOverlay(true);
  conectaEscaner();
  enviados.length = 0;
  ScannerHUD.updateContext("UNKNOWN");
  const panel = globalThis.document.createElement("div");
  panel.id = "kiosk-sale-panel";
  globalThis.document.body.appendChild(panel);
  globalThis.document._registrar("kiosk-sale-panel", panel);
  
  ScannerHUD.updateKioskSale([{ name: "Paris Prime String", qty: 2, plat: 4, ducats: 50, ratio: 12.5 }], "PARA ECHAR");
  ScannerHUD.updateContext("INVENTORY");
  ScannerHUD.updateDetectedItems(new Map(), new Map());
  await esperaCola();
  assert.equal(enviados.filter(d => d.grupo === "kiosko" && d.paneles.length === 0).length, 1);
  
  ScannerHUD.updateContext("DUCAT_KIOSK");
  enviados.length = 0;
  ScannerHUD.updateKioskSale([{ name: "Paris Prime String", qty: 2, plat: 4, ducats: 50, ratio: 12.5 }], "PARA ECHAR");
  await esperaCola();
  assert.equal(enviados.filter(d => d.grupo === "kiosko" && d.paneles.length === 0).length, 0);
  assert.equal(enviados.filter(d => d.grupo === "kiosko" && d.paneles.length === 1).length, 1);
  
  ScannerHUD.updateContext("UNKNOWN");
  await esperaCola();
  svc.activaOverlay(false);
});

test("ScannerHUD actualiza el panel de arcanos", async () => {
  const panel = globalThis.document.createElement("div");
  panel.id = "arcane-panel";
  globalThis.document.body.appendChild(panel);
  globalThis.document._registrar("arcane-panel", panel);

  ScannerHUD.updateArcanos([]);
  assert.equal(panel.style.display, "none");
  assert.equal(panel.children.length, 0);

  const filaMock = { name: "Arcane Nullifier", qty: 21, maxRank: 5, rangosMax: 1, accion: "sell_max", r: 0, c: 1, precioR0: 4, precioMax: 120 };
  ScannerHUD.updateArcanos([{ ...filaMock, c: 0, name: "Arcane Grace", accion: "dissolve" }, filaMock]);

  assert.equal(panel.style.display, "");
  assert.equal(panel.children.length, 2);
  assert.equal(panel.children[0].className, "kiosk-title");

  const rejilla = panel.children[1];
  assert.equal(rejilla.className, "arcane-grid");
  assert.equal(rejilla.children.length, 2);
  const celda = rejilla.children[1];
  assert.equal(celda.className, "arcane-cell");
  assert.deepEqual(celda.children.map((n) => n.textContent), ["Arcane Nullifier", "21 · 1×R5", "R0 4 pl", "R5 120 pl", "SELL R5"]);
  assert.equal(celda.children[0].className, "arcane-name");
  assert.equal(celda.children[2].className, "arcane-line arcane-oro");
  assert.equal(celda.children[4].className, "arcane-line arcane-verde");
});

test("ScannerHUD panel de inventario y acciones", async () => {
  svc.activaOverlay(true);
  conectaEscaner();
  enviados.length = 0;
  
  ScannerHUD.updateContext("INVENTORY");
  await esperaCola();
  const envi = enviados.filter(d => d.grupo === "inventario" && d.paneles.length === 1);
  assert.equal(envi.length, 1);
  assert.ok(envi[0].paneles[0].bloques.find((b) => b.tipo === "botones"));
  
  ScannerHUD.updateContext("DUCAT_KIOSK");
  await esperaCola();
  assert.ok(enviados.some(d => d.grupo === "inventario" && d.paneles.length === 0));
  
  ScannerHUD.updateContext("INVENTORY");
  await esperaCola();
  enviados.length = 0;
  ScannerHUD.updateContext("UNKNOWN");
  await esperaCola();
  assert.ok(enviados.some(d => d.grupo === "inventario" && d.paneles.length === 0));
  
  let accionRecibida = null;
  escucha("overlay-inventario", (accion) => { accionRecibida = accion; });
  alAccion?.("inventario", "inv:auto");
  assert.equal(accionRecibida, "inv:auto");

  svc.activaOverlay(false);
});

test("tras parar y volver a arrancar en el inventario, el panel de escaneo vuelve", async () => {
  svc.activaOverlay(true);
  conectaEscaner();
  ScannerHUD.updateContext("UNKNOWN");
  ScannerHUD.updateContext("INVENTORY");
  await esperaCola();
  avisa("escaner-parado");
  await esperaCola();
  enviados.length = 0;
  ScannerHUD.updateContext("INVENTORY");
  ScannerHUD.updateScrollStatus("done", 0);
  await esperaCola();
  assert.equal(enviados.filter((d) => d.grupo === "inventario" && d.paneles.length === 1).length, 1);
  svc.activaOverlay(false);
});

test("ScannerHUD.updateScrollStatus('captured') manda autoScanCaptured, y 'done' vuelve a detectados", async () => {
  svc.activaOverlay(true);
  conectaEscaner();
  ScannerHUD.updateContext("UNKNOWN");
  ScannerHUD.updateContext("INVENTORY");
  enviados.length = 0;
  ScannerHUD.updateScrollStatus("captured", 0);
  await esperaCola();
  let envi = enviados.filter((d) => d.grupo === "inventario" && d.paneles.length === 1).at(-1);
  assert.equal(envi.paneles[0].bloques.find(b => b.tipo === "estado").texto, "✓ PAGE CAPTURED");
  assert.equal(envi.paneles[0].bloques.find(b => b.tipo === "estado").tono, "verde");

  enviados.length = 0;
  ScannerHUD.updateScrollStatus("done", 3);
  await esperaCola();
  envi = enviados.filter((d) => d.grupo === "inventario" && d.paneles.length === 1).at(-1);
  assert.equal(envi.paneles[0].bloques.find(b => b.tipo === "estado").texto, "DETECTED ITEMS: 0");
  
  svc.activaOverlay(false);
});

test("avisa arcanos manda y quita panel, ajustaPaneles quita en INVENTORY", async () => {
  svc.activaOverlay(true);
  conectaEscaner();
  
  enviados.length = 0;
  avisa("arcanos", { filas: [{ name: "Arcane Nullifier", qty: 21, maxRank: 5, rangosMax: 1, accion: "sell_max" }] });
  await esperaCola();
  let envi = enviados.filter((d) => d.grupo === "arcanos").at(-1);
  assert.ok(envi.paneles.length > 0);
  
  enviados.length = 0;
  avisa("arcanos", null);
  await esperaCola();
  envi = enviados.filter((d) => d.grupo === "arcanos").at(-1);
  assert.equal(envi.paneles.length, 0);
  
  avisa("arcanos", { filas: [{ name: "Arcane Nullifier", qty: 21, maxRank: 5, rangosMax: 1, accion: "sell_max" }] });
  await esperaCola();
  svc.ajustaPanelesAlContexto("INVENTORY");
  await esperaCola();
  envi = enviados.filter((d) => d.grupo === "arcanos").at(-1);
  assert.equal(envi.paneles.length, 0);
});

test("con la ventana sin foco se pausan las animaciones, y vuelven al recuperarlo", async () => {
  const { pausaAnimacionesSinFoco } = await import("../deploy/js/ui.components/ui_desktop_shell.js");
  let foco = false;
  const clases = new Set();
  const doc = {
    hasFocus: () => foco,
    documentElement: { classList: { toggle: (c, si) => (si ? clases.add(c) : clases.delete(c)) } },
  };
  const oyentes = {};
  const win = { addEventListener: (ev, fn) => { oyentes[ev] = fn; } };
  pausaAnimacionesSinFoco(doc, win);
  assert.ok(clases.has("ds-sin-foco"), "arranca detrás del juego");
  foco = true;
  oyentes.focus();
  assert.ok(!clases.has("ds-sin-foco"));
  foco = false;
  oyentes.blur();
  assert.ok(clases.has("ds-sin-foco"));
});
