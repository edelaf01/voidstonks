// Eventos útiles del EE.log de Warframe. El juego registra cada pantalla al crearla
// ("Created /Lotus/Interface/X.swf") pero no al cerrarla.

const RE_TIEMPO = /^(\d+\.\d+) /;
// Solo pantallas de primer nivel: las subcarpetas son retículas, HUDs y fondos.
const RE_PANTALLA = /Created \/Lotus\/Interface\/(\w+)\.swf/;
const RE_DIALOGO = /Dialog::Create\w*\(description=(.*?), title=/;
const RE_RELIQUIA = /equip (\w+ \w+) Relic(?: \[(\w+)\])? for this mission/;
const RE_REFINA = /^Refine (\w+ \w+) Relic to (\w+)\?/;
const RE_CICLO_RIVEN = /^Are you sure you want to cycle (.+) for ([\d,]+)\?/;
// Refinada al equiparla: el diálogo no lleva corchetes y el refinamiento sale del coste.
const RE_RELIQUIA_REFINA = /refine and equip (\w+ \w+) Relic\? It will cost (\d+) Void Traces/;
const POR_COSTE = { 25: "EXCEPTIONAL", 50: "FLAWLESS", 100: "RADIANT" };
const RE_MISION = /MissionIntro\.lua: MissionName: (.+)$/;
const RE_FIN_MISION = /EndOfMatch\.lua: Skip ReturnedToShip|GameRulesImpl - changing state from \w+ to SS_ENDED/;
const RE_RECOMPENSAS = /ProjectionRewardChoice\.lua: (Got rewards|Relic reward screen shut down|Missing icon data!)/;
// Solo sale la recompensa propia: las de la escuadra no se registran.
const RE_PROPIA = /VoidProjections: \w+ gets reward (\/Lotus\/\S+)/;
const RE_MENU = /(\w+)\.lua: DBG: HudVis ([01])\s*$/;
// "Selling Prime Parts" es el kiosko de ducados de Baro; "Inventory", el inventario normal.
const RE_MODO_INVENTARIO = /InventoryTest - CurrMode: (.+?)\s*$/;

export const PANTALLAS = {
  ProjectionRewardChoice: { es: "Elegir recompensa de fisura", en: "Fissure reward choice", contexto: "REWARD" },
  ThemedProjectionManager: { es: "Elegir reliquia", en: "Relic selection" },
  SurvivalReward: { es: "Recompensa de rotación", en: "Rotation reward" },
  InventoryTest: { es: "Inventario", en: "Inventory", contexto: "INVENTORY" },
  TopMenu: { es: "Menú", en: "Menu" },
  LoadOutRedux: { es: "Arsenal", en: "Arsenal" },
  StoreLite: { es: "Mercado", en: "Market" },
  Dialog: { es: "Diálogo", en: "Dialog" },
};

const RUIDO = new Set([
  "FocusGainMessage", "Transmission", "Notifications", "ToolTip", "ChallengePopUp", "ContextAction",
  "UICommonResources", "ProjectionsCountdown", "PortTimerStatus", "RailjackText", "ThemedButtonBar",
  "ThemedContextMenu",
]);

export function parseLinea(linea) {
  const t = Number(RE_TIEMPO.exec(linea)?.[1] ?? NaN);
  const rec = RE_RECOMPENSAS.exec(linea);
  if (rec) {
    if (rec[1] === "Missing icon data!") return { tipo: "tarjeta", t };
    return { tipo: "recompensas", fase: rec[1] === "Got rewards" ? "llenas" : "cerradas", t };
  }
  const modo = RE_MODO_INVENTARIO.exec(linea);
  if (modo) return { tipo: "inventario", modo: modo[1], kiosco: modo[1] === "Selling Prime Parts", t };
  const menu = RE_MENU.exec(linea);
  if (menu) return { tipo: "menu", modulo: menu[1], visible: menu[2] === "1", t };
  const mision = RE_MISION.exec(linea);
  if (mision) return { tipo: "mision", fase: "empieza", nombre: mision[1].trim(), t };
  if (RE_FIN_MISION.test(linea)) return { tipo: "mision", fase: "acaba", t };
  const propia = RE_PROPIA.exec(linea);
  if (propia) return { tipo: "propia", ruta: propia[1], t };
  const pantalla = RE_PANTALLA.exec(linea);
  if (pantalla) {
    const swf = pantalla[1];
    if (RUIDO.has(swf)) return null;
    return { tipo: "pantalla", swf, contexto: PANTALLAS[swf]?.contexto || null, t };
  }
  const dialogo = RE_DIALOGO.exec(linea);
  if (!dialogo) return null;
  const reliquia = RE_RELIQUIA.exec(dialogo[1]);
  if (reliquia) return { tipo: "reliquia", nombre: reliquia[1], refinamiento: reliquia[2] || "INTACT", t };
  const refina = RE_REFINA.exec(dialogo[1]);
  if (refina) return { tipo: "refino", nombre: refina[1], refinamiento: refina[2], t };
  const ciclo = RE_CICLO_RIVEN.exec(dialogo[1]);
  if (ciclo) {
    const partes = ciclo[1].trim().split(/\s+/);
    return { tipo: "rivenCiclo", arma: partes.slice(0, -1).join(" "), riven: partes.at(-1), kuva: Number(ciclo[2].replace(/,/g, "")), t };
  }
  const refinada = RE_RELIQUIA_REFINA.exec(dialogo[1]);
  if (refinada) return { tipo: "reliquia", nombre: refinada[1], refinamiento: POR_COSTE[refinada[2]] || "?", t };
  // Las claves /Lotus/Language/... son avisos internos (reconectando, creando sesión).
  if (dialogo[1].startsWith("/Lotus/")) return null;
  return { tipo: "dialogo", texto: dialogo[1], t };
}

export function nombrePantalla(swf, lang) {
  return PANTALLAS[swf]?.[lang === "en" ? "en" : "es"] || swf;
}

// "/Lotus/StoreItems/Types/Recipes/Weapons/WeaponParts/VentoPrimeHandle" -> "Vento Prime Handle".
// Es el nombre interno: alguno no coincide con el visible (Vento es el Venato Prime).
export function nombreInterno(ruta) {
  return (ruta?.split("/").pop() || "").replace(/([a-z])([A-Z])/g, "$1 $2");
}
