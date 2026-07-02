import { rawState, get, set, subscribe } from "./store/state.store.js";

// Inicializa el estado en bruto del store
Object.assign(rawState, {
  currentLang: "en",
  activeTab: "relic",
  playerCount: 1,
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
  showAllFarms: false,
  primeInventory: {},
  primeManifest: [],
  autoScanEnabled: false,
  isPrecisionScanActive: false,
  autoSyncRewards: true,
  autoCopyScanResults: false,
  scannerModsMode: false,
  visionSettings: {
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
    valMin: 110
  }
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

    localStorage.setItem("voidStonks_save", JSON.stringify(data));
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
    const newInv = [];
    state.inventory.forEach((name) => {
      const existing = newInv.find((i) => i.name === name);
      if (existing) existing.count++;
      else newInv.push({ name, count: 1 });
    });
    state.inventory = newInv;
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

globalThis.state = state;

/**
 * V187: Helper global para actualizar settings de visión desde la UI
 */
globalThis.updateVisionSetting = (key, value) => {
  if (state.visionSettings) {
    state.visionSettings[key] = value;
    saveAppState();
  }
};
