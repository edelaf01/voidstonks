export const ESTADO_JUEGO_INICIAL = Object.freeze({
  enMision: false,
  enHub: false,
  mision: null,
  recompensas: null, // { fase: "abiertas" | "llenas", tarjetas, propia }
  eligiendoReliquia: false,
  riven: null,
  menus: Object.freeze([]),
  despiertoHasta: 0,
  inventario: null,
  inventarioCambios: 0,
});

const NO_SON_MENU = new Set(["HudRedux", "OverlayBackground", "ThemedProjectionManager", "DefenseReward", "EndOfMatch"]);

const DE_LA_MISION = new Set([
  "SurvivalReward", "FocusGainMessage", "ProjectionsCountdown", "Transmission", "Dialog", "Notifications",
  "ChallengePopUp", "EndOfMatch", "PortTimerStatus", "UICommonResources", "ToolTip", "ThemedSquadOverlay",
  "ThemedContextMenu", "ThemedButtonBar", "Subtitles", "MissionIntro", "ItemInfoPopup", "GenericNotification",
  "ConsumablesOverlay", "Background", "AcceptInvitePanel", "HudRedux", "ProjectionRewardChoice",
  "ThemedProjectionManager", "DefenseReward",
]);

const EN_EL_CICLO = new Set(["DioramaViewer", "Dialog", "ToolTip", "Notifications", "Transmission", "ChallengePopUp"]);

export const VENTANA_DESCONOCIDA_MS = 20_000;

export function siguienteEstado(estado, ev, ahora = Date.now()) {
  switch (ev?.tipo) {
    case "mision":
      return ev.fase === "empieza"
        ? { ...estado, enMision: !estado.enHub, mision: ev.nombre }
        : { ...ESTADO_JUEGO_INICIAL, inventarioCambios: estado.inventarioCambios + (estado.inventario ? 1 : 0) };
    case "nivel": {
      const base = ev.nuevo ? { ...ESTADO_JUEGO_INICIAL, inventarioCambios: estado.inventarioCambios + (estado.inventario ? 1 : 0) } : estado;
      return ev.empieza ? { ...base, enMision: !base.enHub } : base;
    }
    case "pantalla":
      if (ev.swf === "Hub" || ev.swf === "ThemedMainMenu") return { ...ESTADO_JUEGO_INICIAL, enHub: ev.swf === "Hub", inventarioCambios: estado.inventarioCambios + (estado.inventario ? 1 : 0) };
      if (ev.swf === "ProjectionRewardChoice") {
        return { ...estado, eligiendoReliquia: false, recompensas: { fase: "abiertas", tarjetas: 0, propia: null, desde: ahora } };
      }
      if (ev.swf === "ThemedProjectionManager") return { ...estado, eligiendoReliquia: true };
      if (ev.swf === "OmegaRerollSelection") return { ...estado, riven: { arma: null } };
      if (estado.riven && !EN_EL_CICLO.has(ev.swf)) estado = { ...estado, riven: null };
      if (estado.enMision && !DE_LA_MISION.has(ev.swf)) return { ...estado, despiertoHasta: ahora + VENTANA_DESCONOCIDA_MS };
      return estado;
    case "recompensas":
      if (ev.fase === "cerradas") return { ...estado, recompensas: null };
      return { ...estado, recompensas: { tarjetas: 0, propia: null, ...estado.recompensas, fase: "llenas" } };
    case "tarjeta":
      if (!estado.recompensas) return estado;
      return { ...estado, recompensas: { ...estado.recompensas, tarjetas: estado.recompensas.tarjetas + 1 } };
    case "propia":
      if (!estado.recompensas) return estado;
      return { ...estado, recompensas: { ...estado.recompensas, propia: ev.ruta } };
    case "rivenCiclo":
      return estado.riven ? { ...estado, riven: { arma: ev.arma, nombre: ev.riven } } : estado;
    case "inventario":
      return { ...estado, inventario: { kiosco: ev.kiosco, lista: false, desde: ahora }, inventarioCambios: estado.inventarioCambios + 1 };
    case "rejilla": {
      let inventarioCambios = estado.inventarioCambios;
      if (!estado.inventario) inventarioCambios++;
      return { ...estado, inventario: { kiosco: estado.inventario?.kiosco ?? false, lista: ev.lista, desde: ahora }, inventarioCambios };
    }
    case "menu": {
      let st = estado;
      if (ev.modulo === "InventoryTest" && !ev.visible) {
        st = { ...st, inventario: null, inventarioCambios: st.inventarioCambios + 1 };
      }
      if (NO_SON_MENU.has(ev.modulo)) return st;
      const sin = st.menus.filter((m) => m !== ev.modulo);
      return { ...st, menus: ev.visible ? [...sin, ev.modulo] : sin };
    }
    default:
      return estado;
  }
}

export function modoEscaner(estado, ahora = Date.now()) {
  if (estado.recompensas?.fase === "llenas") {
    return { modo: "forzado", contexto: "REWARD", tarjetas: estado.recompensas.tarjetas || null };
  }
  if (!estado.enMision) return { modo: "normal" };
  if (estado.menus.length || estado.eligiendoReliquia || estado.recompensas || ahora < estado.despiertoHasta) return { modo: "normal" };
  return { modo: "dormido" };
}
