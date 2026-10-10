import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeDocument } from "./_helpers/fake-canvas.mjs";

installFakeDocument();
globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };

const { EELogLive } = await import("../deploy/js/services/scanner/eelog_live.service.js");
const { duermePorLog, firmaPorLog, tarjetasPorLog, CABECERA_RECOMPENSAS, enMisionPorLog, paraVigiaDelJuego, recompensasAbiertasPorLog } = await import("../deploy/js/services/scanner/log_gate.service.js");
const { VisionService } = await import("../deploy/js/services/scanner/vision.service.js");

const MISION = "64.824 Script [Info]: MissionIntro.lua: MissionName: TUVUL COMMONS";
const ABIERTAS = "300.797 Sys [Info]: Created /Lotus/Interface/ProjectionRewardChoice.swf";
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

function conJuego(fn) {
  paraVigiaDelJuego();
  const vigia = { alCambio: null, cortes: 0 };
  globalThis.voidstonksNativo = {
    seguirJuego(alCambio) {
      vigia.alCambio = alCambio;
      return () => { vigia.cortes++; };
    },
  };
  try { return fn(vigia); } finally { paraVigiaDelJuego(); delete globalThis.voidstonksNativo; }
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
    assert.equal(duermePorLog(s), "LOG_WAIT");
    clearTimeout(s.scanInterval);
    assert.equal(s.rescates, 1);
    assert.equal(s.sueltas, 1);
    assert.equal(s.latchedContext, "UNKNOWN");
    assert.equal(s._recompensaLeida, false);
    assert.equal(s.detectionLocked, false);
    assert.equal(duermePorLog(s), "LOG_WAIT");
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

test("con el juego minimizado el escáner duerme aunque no haya log y despierta al volver", () => {
  conJuego((vigia) => {
    const s = escaner();
    assert.equal(duermePorLog(s), false);
    vigia.alCambio("oculto");
    assert.equal(s.vueltas, 0, "dormirse no da vueltas");
    assert.equal(duermePorLog(s), "GAME_HIDDEN");
    clearTimeout(s.scanInterval);
    assert.equal(s.rescates, 1);
    assert.equal(s.sueltas, 1);
    assert.equal(s.latchedContext, "UNKNOWN");
    vigia.alCambio("visible");
    assert.equal(s.vueltas, 1);
    assert.equal(s._dormidoPorLog, false);
    assert.equal(duermePorLog(s), false);
  });
});

test("con el juego minimizado en plena misión sigue dormido al volver hasta que el log lo despierte", () => {
  conJuego((vigia) => {
    conLog([MISION], () => {
      const s = escaner();
      assert.equal(duermePorLog(s), "LOG_WAIT");
      clearTimeout(s.scanInterval);
      vigia.alCambio("oculto");
      assert.equal(duermePorLog(s), "GAME_HIDDEN");
      clearTimeout(s.scanInterval);
      vigia.alCambio("visible");
      assert.equal(s.vueltas, 0);
      assert.equal(duermePorLog(s), "LOG_WAIT");
      clearTimeout(s.scanInterval);
      assert.equal(s.rescates, 1, "el cambio de motivo no vuelve a cerrar nada");
      EELogLive.leer([LLENAS]);
      assert.equal(s.vueltas, 1);
    });
  });
});

test("sin ventana del juego no se duerme, y al parar se deja de vigilar", () => {
  conJuego((vigia) => {
    const s = escaner();
    duermePorLog(s);
    vigia.alCambio(null);
    assert.equal(duermePorLog(s), false);
    vigia.alCambio("oculto");
    paraVigiaDelJuego();
    assert.equal(vigia.cortes, 1);
    assert.equal(duermePorLog(s), false, "parar olvida que estaba minimizado");
  });
});

test("enMisionPorLog devuelve null si no hay log, y el estado de la misión si lo hay", () => {
  assert.equal(enMisionPorLog(), null);
  conLog([MISION], () => {
    EELogLive.juego.enMision = true;
    assert.equal(enMisionPorLog(), true);
    EELogLive.juego.enMision = false;
    assert.equal(enMisionPorLog(), false);
  });
});

test("las recompensas abiertas solo se anuncian entre que se crea la pantalla y llegan las tarjetas", () => {
  assert.equal(recompensasAbiertasPorLog(), false);
  conLog([MISION, ABIERTAS], () => {
    assert.equal(recompensasAbiertasPorLog(), true);
    assert.equal(recompensasAbiertasPorLog(Date.now() + 20_000), false, "una pantalla abierta sin tarjetas deja de anunciarse");
    EELogLive.leer([LLENAS]);
    assert.equal(recompensasAbiertasPorLog(), false);
    EELogLive.leer([CERRADAS]);
    assert.equal(recompensasAbiertasPorLog(), false);
  });
});
