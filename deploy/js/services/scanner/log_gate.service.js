import { EELogLive } from "./eelog_live.service.js";
import { INITIAL_LATCH } from "../../utils/vision/context_latch.js";
import { ajustaPanelesAlContexto } from "../desktop.service.js";
import { seguirJuegoDelLanzador } from "../../repositories/launcher.repository.js";

export const CABECERA_RECOMPENSAS = "VOID FISSURE/REWARDS";
export const TICK_DORMIDO_MS = 1000;
const RECOMPENSAS_ABIERTAS_MS = 20_000;

let vigilado = null;
let juegoOculto = false;
let cortaJuego = null;

const motivo = () => (juegoOculto ? "GAME_HIDDEN" : EELogLive.modoEscaner()?.modo === "dormido" ? "LOG_WAIT" : null);

function despierta(scanner) {
  if (!scanner.isScanning || !scanner._dormidoPorLog || motivo()) return;
  clearTimeout(scanner.scanInterval);
  scanner._dormidoPorLog = false;
  scanner.loop();
}

function vigila(scanner) {
  if (vigilado !== scanner) {
    vigilado = scanner;
    EELogLive.escuchar(() => despierta(scanner));
  }
  cortaJuego ??= seguirJuegoDelLanzador((estado) => {
    juegoOculto = estado === "oculto";
    despierta(scanner);
  });
}

export function paraVigiaDelJuego() {
  cortaJuego?.();
  cortaJuego = null;
  juegoOculto = false;
}

export function duermePorLog(scanner) {
  vigila(scanner);
  const espera = motivo();
  if (!espera) return (scanner._dormidoPorLog = false);
  if (!scanner._dormidoPorLog) {
    if (scanner.latchedContext === "REWARD") scanner.rescataRecompensaParcial();
    scanner.releaseFrames();
    ajustaPanelesAlContexto("UNKNOWN");
    Object.assign(scanner, {
      latchedContext: "UNKNOWN", ctxLatch: INITIAL_LATCH, _recompensaLeida: false, detectionLocked: false, _dormidoPorLog: true,
    });
  }
  scanner.scanInterval = setTimeout(() => scanner.loop(), TICK_DORMIDO_MS);
  return espera;
}

export function firmaPorLog() {
  const m = EELogLive.modoEscaner();
  return m?.modo === "forzado" && m.contexto === "REWARD" ? { texto: CABECERA_RECOMPENSAS } : null;
}

export function armaRivenPorLog() {
  return EELogLive.estado === "leyendo" ? EELogLive.juego.riven?.arma || null : null;
}

export function tarjetasPorLog() {
  const m = EELogLive.modoEscaner();
  return m?.modo === "forzado" ? m.tarjetas || null : null;
}

export function rejillaListaPorLog(ahora = Date.now()) {
  if (EELogLive.estado !== "leyendo" || !EELogLive.juego.inventario) return null;
  if (EELogLive.juego.inventario.lista) return true;
  if (ahora - EELogLive.juego.inventario.desde < 3000) return false;
  return null;
}

export function cambioPantallaPorLog() {
  return EELogLive.estado === "leyendo" ? EELogLive.juego.inventarioCambios : 0;
}

export function recompensasAbiertasPorLog(ahora = Date.now()) {
  const recompensas = EELogLive.estado === "leyendo" && EELogLive.juego.recompensas;
  return recompensas?.fase === "abiertas" && ahora - recompensas.desde < RECOMPENSAS_ABIERTAS_MS;
}

export function enMisionPorLog() {
  return EELogLive.estado === "leyendo" ? EELogLive.juego.enMision : null;
}
