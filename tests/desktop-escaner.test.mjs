import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.location = { hostname: "voidstonks.localhost" };
const enviados = [];
let alAccion = null;
globalThis.voidstonksNativo = {
  paneles: async (d) => { enviados.push(d); return true; },
  alAccion: (fn) => { alAccion = fn; return () => {}; },
};

const { avisa, escucha, pistasDelLog } = await import("../deploy/js/utils/ganchos.js");
const svc = await import("../deploy/js/services/desktop.service.js");
const { duermePorLog, armaRivenPorLog } = await import("../deploy/js/services/scanner/log_gate.service.js");
const { EELogLive } = await import("../deploy/js/services/scanner/eelog_live.service.js");
const { conectaEscaner } = await import("../deploy/js/ui.components/ui_desktop_escaner.js");

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
