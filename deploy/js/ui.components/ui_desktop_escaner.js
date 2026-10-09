import { avisa, escucha, pistasDelLog } from "../utils/ganchos.js";
import {
  mostrarPaneles, quitarPaneles, quitarTodosLosPaneles, alPulsarEnOverlay, ajustaPanelesAlContexto,
} from "../services/desktop.service.js";
import { panelKiosko, panelReliquias, panelRiven, panelRivenComparacion, panelInventario, panelArcanos } from "../utils/overlay_paneles.js";
import { duermePorLog, firmaPorLog, tarjetasPorLog, armaRivenPorLog, rejillaListaPorLog, cambioPantallaPorLog, recompensasAbiertasPorLog, enMisionPorLog, paraVigiaDelJuego } from "../services/scanner/log_gate.service.js";
import { EELogLive } from "../services/scanner/eelog_live.service.js";
import { getItemIcon } from "../utils/ui_utils.js";
import { state } from "../state.js";
import { TEXTS } from "../config.js";

const RELIQUIAS_DURACION_MS = 120_000;
let conectado = false;

export function conectaEscaner() {
  if (conectado) return;
  conectado = true;
  Object.assign(pistasDelLog, {
    duerme: duermePorLog,
    firma: firmaPorLog,
    tarjetas: tarjetasPorLog,
    armaRiven: armaRivenPorLog,
    reliquiaPorGastar: () => EELogLive.reliquiaPorGastar(),
    rejillaLista: rejillaListaPorLog,
    cambioPantalla: cambioPantallaPorLog,
    recompensasAbiertas: recompensasAbiertasPorLog,
    enMision: enMisionPorLog,
  });
  escucha("contexto", (contexto) => ajustaPanelesAlContexto(contexto));
  escucha("escaner-parado", () => {
    quitarTodosLosPaneles();
    paraVigiaDelJuego();
  });
  escucha("kiosko", ({ items, rotulo }) => {
    const encima = panelKiosko(items, rotulo);
    if (encima) mostrarPaneles("kiosko", [encima]);
    else quitarPaneles("kiosko");
  });
  escucha("riven", (aviso) => {
    if (!aviso) return quitarPaneles("riven");
    mostrarPaneles("riven", [aviso.tipo === "comparacion" ? panelRivenComparacion(aviso.datos) : panelRiven(aviso.datos)]);
  });
  alPulsarEnOverlay("riven", (accion) => avisa("overlay-riven", accion));
  escucha("reliquias", ({ picks, era, opciones }) => {
    const panel = panelReliquias(picks, era, TEXTS[state.currentLang].scannerHUD, { ...opciones, iconoDe: getItemIcon });
    mostrarPaneles("reliquias", [panel], { duracionMs: RELIQUIAS_DURACION_MS });
  });
  alPulsarEnOverlay("reliquias", (accion) => avisa("overlay-reliquias", accion));

  escucha("inventario", (datos) => {
    if (!datos) return quitarPaneles("inventario");
    mostrarPaneles("inventario", [panelInventario(datos, TEXTS[state.currentLang].scannerHUD)]);
  });
  alPulsarEnOverlay("inventario", (accion) => avisa("overlay-inventario", accion));

  escucha("arcanos", (datos) => {
    const panel = datos && panelArcanos(datos.filas, TEXTS[state.currentLang]);
    if (!panel) return quitarPaneles("arcanos");
    mostrarPaneles("arcanos", [panel]);
  });

  EELogLive.onReliquiaAbierta = (nombre) => avisa("reliquia-abierta", nombre);
  EELogLive.onConstruido = (nombre) => avisa("construido", nombre);
  EELogLive.escuchar((live) => {
    if (live.estado === "leyendo") avisa("eligiendo-reliquia", { ahora: !!live.juego.eligiendoReliquia, mision: live.juego.mision });
  });
}
