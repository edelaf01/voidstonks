import { rawState, get, set, subscribe } from "./store/state.store.js";
import { exposeGlobals } from "./utils/global_registry.js";

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
  showAllFarms: false,
  primeInventory: {},
  primeManifest: [],
  autoScanEnabled: false,
  isPrecisionScanActive: false,
  autoSyncRewards: true,
  autoCopyScanResults: false,
  scannerModsMode: false,
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
 * Restores app state from localStorage. Pure — no DOM access.
 * @returns {{ activeTab: string, domValues: object }} domValues contains raw
 *   input values that the caller should apply to the DOM via hydrateDOM().
 */
export function loadAppState() {
  const saved = localStorage.getItem("voidStonks_save");
  const domValues = {};
  if (!saved) return { activeTab: "relic", domValues };

  try {
    const data = JSON.parse(saved);

    state.currentLang = data.lang || "es";
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
