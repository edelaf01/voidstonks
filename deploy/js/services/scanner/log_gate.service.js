// El EE.log decide cuándo trabaja el escáner en la app de escritorio (ver utils/eelog_estado.js).
// Sin log, o en la web, todo devuelve null/false y el escáner va como siempre.
import { EELogLive } from "./eelog_live.service.js";
import { INITIAL_LATCH } from "../../utils/vision/context_latch.js";
import { ajustaPanelesAlContexto } from "../desktop.service.js";

export const CABECERA_RECOMPENSAS = "VOID FISSURE/REWARDS";
export const TICK_DORMIDO_MS = 1000;

let vigilado = null;

// Despierta el bucle en cuanto el log cambia de modo. Solo si estaba dormido: con un frame en vuelo
// habría dos bucles a la vez.
function vigila(scanner) {
  if (vigilado === scanner) return;
  vigilado = scanner;
  EELogLive.escuchar(() => {
    if (!scanner.isScanning || !scanner._dormidoPorLog || EELogLive.modoEscaner()?.modo === "dormido") return;
    clearTimeout(scanner.scanInterval);
    scanner._dormidoPorLog = false;
    scanner.loop();
  });
}

// true si este tick no se procesa. Al dormirse se cierra lo que hubiera de recompensas, para que la
// ronda siguiente se lea de cero.
export function duermePorLog(scanner) {
  vigila(scanner);
  if (EELogLive.modoEscaner()?.modo !== "dormido") return (scanner._dormidoPorLog = false);
  if (!scanner._dormidoPorLog) {
    if (scanner.latchedContext === "REWARD") scanner.rescataRecompensaParcial();
    scanner.releaseFrames();
    ajustaPanelesAlContexto("UNKNOWN");
    Object.assign(scanner, {
      latchedContext: "UNKNOWN", ctxLatch: INITIAL_LATCH, _recompensaLeida: false, detectionLocked: false, _dormidoPorLog: true,
    });
  }
  scanner.scanInterval = setTimeout(() => scanner.loop(), TICK_DORMIDO_MS);
  return true;
}

// La cabecera que el log ya sabe, para no leerla: { texto } como una firma reconocida, o null.
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
