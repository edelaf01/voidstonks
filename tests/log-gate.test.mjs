import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeDocument } from "./_helpers/fake-canvas.mjs";

installFakeDocument();
globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };

const { EELogLive } = await import("../deploy/js/services/scanner/eelog_live.service.js");
const { duermePorLog, firmaPorLog, tarjetasPorLog, CABECERA_RECOMPENSAS } = await import("../deploy/js/services/scanner/log_gate.service.js");
const { VisionService } = await import("../deploy/js/services/scanner/vision.service.js");

const MISION = "64.824 Script [Info]: MissionIntro.lua: MissionName: TUVUL COMMONS";
const LLENAS = "306.127 Script [Info]: ProjectionRewardChoice.lua: Got rewards";
const TARJETA = "306.128 Script [Info]: ProjectionRewardChoice.lua: Missing icon data!";
const CERRADAS = "321.128 Script [Info]: ProjectionRewardChoice.lua: Relic reward screen shut down";

function escaner() {
  return {
    isScanning: true, latchedContext: "REWARD", ctxLatch: { latched: "REWARD" }, _recompensaLeida: true, detectionLocked: true,
    rescates: 0, sueltas: 0, vueltas: 0, scanInterval: null,
    rescataRecompensaParcial() { this.rescates++; },
    releaseFrames() { this.sueltas++; },
    loop() { this.vueltas++; },
  };
}

function conLog(lineas, fn) {
  EELogLive.cambiaEstado("ruta", "/x/EE.log");
  EELogLive.leer(lineas);
  try { return fn(); } finally { EELogLive.parar(); }
}

test("sin log el escáner nunca duerme ni fuerza nada", () => {
  const s = escaner();
  assert.equal(duermePorLog(s), false);
  assert.equal(firmaPorLog(), null);
  assert.equal(tarjetasPorLog(), null);
});

test("al dormirse cierra lo que quedaba de recompensas para leer la ronda siguiente de cero", () => {
  conLog([MISION], () => {
    const s = escaner();
    assert.equal(duermePorLog(s), true);
    clearTimeout(s.scanInterval);
    assert.equal(s.rescates, 1);
    assert.equal(s.sueltas, 1);
    assert.equal(s.latchedContext, "UNKNOWN");
    assert.equal(s._recompensaLeida, false);
    assert.equal(s.detectionLocked, false);
    assert.equal(duermePorLog(s), true);
    clearTimeout(s.scanInterval);
    assert.equal(s.rescates, 1);
  });
});

test("con las recompensas a la vista la cabecera y el número de tarjetas vienen del log", () => {
  conLog([MISION, LLENAS, TARJETA, TARJETA, TARJETA], () => {
    assert.equal(duermePorLog(escaner()), false);
    assert.deepEqual(firmaPorLog(), { texto: CABECERA_RECOMPENSAS });
    assert.equal(VisionService.determineContext(CABECERA_RECOMPENSAS), "REWARD");
    assert.equal(tarjetasPorLog(), 3);
  });
});

test("un escáner dormido despierta en cuanto el log cambia de modo", () => {
  conLog([MISION], () => {
    const s = escaner();
    duermePorLog(s);
    EELogLive.leer([LLENAS]);
    assert.equal(s.vueltas, 1);
    assert.equal(s._dormidoPorLog, false);
    EELogLive.leer([TARJETA]);
    assert.equal(s.vueltas, 1);
    EELogLive.leer([CERRADAS]);
    assert.equal(s.vueltas, 1, "volver a dormir no despierta");
  });
});
