import { rawState, get, set, subscribe } from "./store/state.store.js";
import { exposeGlobals } from "./utils/global_registry.js";

/**
 * Pestañas de la app, en el orden del HTML. Viven aquí —y no en config.js, que state.js no
 * puede importar sin saltarse el contrato de capas— porque las necesitan dos sitios:
 * loadAppState() para validar la pestaña guardada y switchTab() para esconder los #mode-*.
 * Dos copias a mano acabarían discrepando y una pestaña nueva dejaría de restaurarse.
 */
export const TABS = ["relic", "set", "riven", "lfg", "bounties", "vosfor", "ducat", "eelog", "orders"];

// Valores admitidos de los chips del panel de inventario. Solo los usa la validación del
// save: si mañana se añade un chip, esta lista es lo único que hay que tocar para que su
// elección sobreviva a la recarga.
const INV_TIERS = ["ALL", "LITH", "MESO", "NEO", "AXI", "REQUIEM"];
const INV_GOALS = ["sets", "plat", "ducats", "ratio", "recent"];

// Valores de fábrica del pipeline de visión. Se sacan aparte para que el botón
// "RESET DEFAULTS" del escáner y el estado inicial no puedan divergir.
export const DEFAULT_VISION_SETTINGS = Object.freeze({
  thresholdC: -15,
  claheClip: 5,
  hsvHueTol: 25,
  bilateralD: 5,
  tesseractPSM: 6,
  dilation: 0,
  erosion: 0,
  autoCalibrate: false,
  blockSize: 31,
  sigmaColor: 75,
  sigmaSpace: 75,
  contrast: 1.0,
  brightness: 0,
  gamma: 1.0,
  ocrLang: "eng",
  showROI: true,
  medianBlur: 9,
  sharpen: 1,
  sharpnessMin: 0,
  glareMax: 0.12,
  satMin: 55,
  valMin: 110,
});

// Inicializa el estado en bruto del store
Object.assign(rawState, {
  currentLang: "en",
  activeTab: "relic",
  // `settings` no se inicializaba en ninguna parte, así que las tres lecturas de
  // `state.settings?.showEmptyPrime` eran siempre undefined: una opción que no existía.
  settings: { showEmptyPrime: false },
  // Cuántos jugadores te FALTAN para la escuadra. Solo alimenta el mensaje de reclutamiento
  // ("H [Lith D1] Rad 1/4"), que es para lo que se puso el contador.
  playerCount: 1,
  // Con cuántos abres las reliquias. Es lo que decide las probabilidades: en escuadra de 4 se
  // abren 4 y te quedas con la mejor recompensa, así que una rara radiante pasa de 10% a ~34%.
  //
  // Campo aparte porque antes esto salía de `playerCount`, o sea del contador "Faltan": poner
  // "me falta 1 jugador" calculaba las runs como si jugaras SOLO. Y como arrancaba en 1, quien
  // nunca tocó ese contador tenía toda la app estimando en solitario. 4 es el caso normal.
  squadSize: 4,
  lfgCount: 1,
  relicSourcesDatabase: {},
  selectedRelic: "",
  itemsDatabase: {},
  relicsDatabase: {},
  relicStatusDB: {},
  allRelicNames: [],
  allRivenNames: [],
  weaponMap: {},
  activeResurgenceList: new Set(),
  currentActiveSet: null,
  activeSetParts: [],
  completedParts: new Set(),
  lfgPresets: [],
  tradePresets: [],
  arbSettings: { minSpread: 5, minPct: 8, minPrice: 0, sort: "spread" },
  inventory: [],
  invFilterTier: "ALL",
  invSearchVal: "",
  // Objetivo del inventario de reliquias: qué quieres sacar de abrirlas. Manda sobre el
  // orden Y sobre el dato que se enseña en cada fila. Por defecto "sets" porque es la
  // pregunta que se hace uno al mirar el inventario: qué abro para terminar algo.
  invGoal: "sets",
  invOnlyActive: false,
  // "relics" | "parts". Antes nacía undefined y solo lo escribía switchInvView; se declara
  // aquí porque ahora se persiste con el resto de modos del panel.
  currentInvView: "relics",
  showAllFarms: false,
  primeInventory: {},
  primeManifest: [],
  autoScanEnabled: false,
  isPrecisionScanActive: false,
  autoSyncRewards: true,
  autoAddMissionRewards: true,
  autoCopyScanResults: false,
  scannerModsMode: false,
  // Reliquias que lleva la escuadra en el run en curso (services/scanner/squad.service.js).
  // No se persiste a propósito: muere con el run.
  squadRun: null,
  visionSettings: { ...DEFAULT_VISION_SETTINGS }
});

export const state = new Proxy(rawState, {
  get(target, prop) {
    if (prop === "subscribe") return subscribe;
    return target[prop];
  },
  set(target, prop, value) {
    set(prop, value);
    return true;
  }
});
let saveTimer = null;
export function saveAppState() {
  if (saveTimer) clearTimeout(saveTimer);

  saveTimer = setTimeout(() => {
    const data = {
      lang: state.currentLang,
      // switchTab() ya llamaba a saveAppState() en cada cambio, pero activeTab no viajaba en
      // este objeto: la escritura se hacía y la app seguía abriendo siempre en "relic".
      activeTab: state.activeTab,
      // Modos del panel de inventario. Se guarda lo que es una DECISIÓN (tier, objetivo,
      // vaulted, vista) y no invSearchVal: recuperar una búsqueda a medias hace que el
      // inventario parezca vacío al arrancar sin que se vea por qué.
      invFilterTier: state.invFilterTier,
      invGoal: state.invGoal,
      invOnlyActive: state.invOnlyActive,
      showEmptyPrime: !!state.settings?.showEmptyPrime,
      currentInvView: state.currentInvView,
      relicInput: state.selectedRelic || "",
      refinement: state.refinement || "Rad", // Requires UI to update state.refinement
      lfgActivity: state.lfgActivity || "eidolon", // Requires UI to update state.lfgActivity
      username: state.username || "", // Requires UI to update state.username
      mr: state.mr || 0, // Requires UI to update state.mr
      currentActiveSet: state.currentActiveSet,
      squadSize: state.squadSize,
      activeSetParts: state.activeSetParts,
      completedParts: Array.from(state.completedParts),
      lfgPresets: state.lfgPresets,
      tradePresets: state.tradePresets,
      arbSettings: state.arbSettings,
      inventory: state.inventory,
      showAllFarms: state.showAllFarms,
      primeInventory: state.primeInventory,
      autoSyncRewards: state.autoSyncRewards,
      autoAddMissionRewards: state.autoAddMissionRewards,
      autoCopyScanResults: state.autoCopyScanResults,
      scannerModsMode: state.scannerModsMode,
      visionSettings: state.visionSettings,
    };

    try {
      localStorage.setItem("voidStonks_save", JSON.stringify(data));
    } catch (e) {
      // Sin este aviso, quedarse sin cuota (inventarios grandes) perdía el guardado sin
      // que nada lo dijera: la app seguía enseñando los datos en memoria y se iban al
      // recargar. El usuario tiene que enterarse en el momento.
      console.error("[state] no se pudo guardar en localStorage:", e);
      globalThis.showToast?.(
        state.currentLang === "es"
          ? "No se pudo guardar: almacenamiento lleno"
          : "Save failed: storage full",
      );
    }
    saveTimer = null;
  }, 1000);
}
/**
 * Idioma de la PRIMERA visita, leído del navegador.
 *
 * Sin esto se arrancaba siempre en inglés: `currentLang` nace en "en" y la única línea que
 * pone "es" está dentro del `try` de loadAppState(), o sea solo para quien ya tiene guardado.
 * Como el HTML estático está escrito en español, un hispanohablante nuevo veía la página
 * reescribirse sola al inglés a los pocos ms de cargar.
 *
 * Se recorre `languages` EN ORDEN y gana la primera que reconocemos: con ["en-US","es"] el
 * usuario prefiere inglés, y un `some(startsWith("es"))` le habría puesto español.
 */
function detectLang() {
  const nav = globalThis.navigator;
  const preferidos = nav?.languages?.length ? nav.languages : [nav?.language];
  for (const etiqueta of preferidos) {
    const code = String(etiqueta || "").toLowerCase();
    if (code.startsWith("es")) return "es";
    if (code.startsWith("en")) return "en";
  }
  return "en";
}

/**
 * Restores app state from localStorage. Pure — no DOM access.
 * @returns {{ activeTab: string, domValues: object }} domValues contains raw
 *   input values that the caller should apply to the DOM via hydrateDOM().
 */
export function loadAppState() {
  const saved = localStorage.getItem("voidStonks_save");
  const domValues = {};
  if (!saved) {
    state.currentLang = detectLang();
    return { activeTab: "relic", domValues };
  }

  try {
    const data = JSON.parse(saved);

    state.currentLang = data.lang || "es";
    // Se validan contra la lista de valores posibles: un save viejo (o tocado a mano) con una
    // pestaña que ya no existe dejaba la app sin ningún #mode-* visible, o sea en blanco.
    if (TABS.includes(data.activeTab)) state.activeTab = data.activeTab;
    if (INV_TIERS.includes(data.invFilterTier)) state.invFilterTier = data.invFilterTier;
    if (INV_GOALS.includes(data.invGoal)) state.invGoal = data.invGoal;
    if (typeof data.invOnlyActive === "boolean") state.invOnlyActive = data.invOnlyActive;
    if (typeof data.showEmptyPrime === "boolean") {
      state.settings = { ...state.settings, showEmptyPrime: data.showEmptyPrime };
    }
    if (data.currentInvView === "parts" || data.currentInvView === "relics") {
      state.currentInvView = data.currentInvView;
    }
    if (data.relicInput) state.selectedRelic = data.relicInput;
    if (data.currentActiveSet) {
      state.currentActiveSet = data.currentActiveSet;
      state.activeSetParts = data.activeSetParts || [];
      state.completedParts = new Set(data.completedParts || []);
    }
    if (typeof data.showAllFarms !== "undefined") state.showAllFarms = data.showAllFarms;
    // Se acota al rango válido: una escuadra de 0 o de 7 tiraría abajo el cálculo de odds.
    if (Number.isFinite(data.squadSize)) state.squadSize = Math.min(4, Math.max(1, data.squadSize));
    if (data.lfgPresets) state.lfgPresets = data.lfgPresets;
    if (data.tradePresets) state.tradePresets = data.tradePresets;
    if (data.arbSettings) state.arbSettings = { ...state.arbSettings, ...data.arbSettings };
    if (data.inventory) state.inventory = data.inventory;
    if (data.primeInventory) state.primeInventory = data.primeInventory;
    if (data.autoSyncRewards !== undefined) state.autoSyncRewards = data.autoSyncRewards;
    if (data.autoAddMissionRewards !== undefined) state.autoAddMissionRewards = data.autoAddMissionRewards;
    if (data.autoCopyScanResults !== undefined) state.autoCopyScanResults = data.autoCopyScanResults;
    if (data.scannerModsMode !== undefined) state.scannerModsMode = data.scannerModsMode;
    if (data.visionSettings) state.visionSettings = { ...state.visionSettings, ...data.visionSettings };

    // Set up DOM values to pass to hydrating function
    domValues.relicInput = data.relicInput || "";
    domValues.refinement = data.refinement || "Rad";
    domValues.username = data.username || "";
    domValues.mr = data.mr || 0;
    domValues.lfgActivity = data.lfgActivity || "eidolon";
  } catch (e) {
    console.warn("Error cargando save:", e);
  }

  return { activeTab: state.activeTab || "relic", domValues };
}

/**
 * Applies saved input values to DOM elements.
 * @param {object} domValues - from loadAppState().domValues
 */
export function hydrateDOM(domValues) {
  const set = (id, val) => { const el = document.getElementById(id); if (el && val) el.value = val; };
  set("relicInput", domValues.relicInput);
  set("refinement", domValues.refinement);
  set("usernameInput", domValues.username);
  set("mrInput", domValues.mr);
  set("lfgActivity", domValues.lfgActivity);
}

export function updateInventoryCount(relicName, change) {
  if (state.inventory.length > 0 && typeof state.inventory[0] === "string") {
    // Con un find() por elemento la migración del formato viejo (array de strings) era
    // O(n²) sobre TODO el inventario, y corre al primer +/- que se pulse.
    const counts = new Map();
    for (const name of state.inventory) counts.set(name, (counts.get(name) || 0) + 1);
    state.inventory = [...counts].map(([name, count]) => ({ name, count }));
  }

  const itemIndex = state.inventory.findIndex((i) => i.name === relicName);

  if (itemIndex >= 0) {
    state.inventory[itemIndex].count += change;
    if (state.inventory[itemIndex].count <= 0) {
      state.inventory.splice(itemIndex, 1);
    }
  } else if (change > 0) {
    state.inventory.push({ name: relicName, count: change });
  }
}
export function updateInventoryBatch(relicList) {
  relicList.forEach((relicName) => {
    const itemIndex = state.inventory.findIndex((i) => i.name === relicName);
    if (itemIndex >= 0) {
      state.inventory[itemIndex].count += 1;
    } else {
      state.inventory.push({ name: relicName, count: 1 });
    }
  });

  state.inventory = state.inventory.filter((i) => i.count > 0);
}

/**
 * V187: Helper global para actualizar settings de visión desde la UI
 */
const updateVisionSetting = (key, value) => {
  if (state.visionSettings) {
    state.visionSettings[key] = value;
    saveAppState();
  }
};

/**
 * Devuelve el pipeline de visión a valores de fábrica ("RESET DEFAULTS" del escáner).
 * El botón existía en index.html desde antes, pero la función no estaba implementada:
 * pulsarlo lanzaba "resetVisionSettings is not a function" y no reseteaba nada.
 */
const resetVisionSettings = () => {
  state.visionSettings = { ...DEFAULT_VISION_SETTINGS };
  saveAppState();
  // El panel de ajustes lee los valores al pintarse, así que hay que refrescar los
  // controles ya montados o seguirían enseñando los valores viejos.
  globalThis.syncScannerModeUI?.();
  globalThis.showToast?.(
    state.currentLang === "es" ? "Ajustes de visión restaurados" : "Vision settings reset",
  );
};

// state y los helpers de visión los consumen el HTML inline y los scripts planos del
// escáner (live_calibration.js, live_grid_editor.js), que no pueden importar.
exposeGlobals({ state, updateVisionSetting, resetVisionSettings }, "state.js");
