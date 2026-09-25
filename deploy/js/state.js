import { rawState, get, set, subscribe } from "./store/state.store.js";
import { exposeGlobals } from "./utils/global_registry.js";

export const TABS = ["relic", "set", "riven", "lfg", "bounties", "vosfor", "ducat", "eelog", "orders"];

const INV_TIERS = ["ALL", "LITH", "MESO", "NEO", "AXI", "REQUIEM"];
const INV_GOALS = ["sets", "plat", "ducats", "ratio", "recent"];

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

Object.assign(rawState, {
  currentLang: "en",
  activeTab: "relic",
  settings: { showEmptyPrime: false },
  // players still missing from the squad, only for the recruit message
  playerCount: 1,
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
  invGoal: "sets",
  invOnlyActive: false,
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
      activeTab: state.activeTab,
      invFilterTier: state.invFilterTier,
      invGoal: state.invGoal,
      invOnlyActive: state.invOnlyActive,
      showEmptyPrime: !!state.settings?.showEmptyPrime,
      currentInvView: state.currentInvView,
      relicInput: state.selectedRelic || "",
      refinement: state.refinement || "Rad",
      lfgActivity: state.lfgActivity || "eidolon",
      username: state.username || "",
      mr: state.mr || 0,
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

const updateVisionSetting = (key, value) => {
  if (state.visionSettings) {
    state.visionSettings[key] = value;
    saveAppState();
  }
};

const resetVisionSettings = () => {
  state.visionSettings = { ...DEFAULT_VISION_SETTINGS };
  saveAppState();
  globalThis.syncScannerModeUI?.();
  globalThis.showToast?.(
    state.currentLang === "es" ? "Ajustes de visión restaurados" : "Vision settings reset",
  );
};

exposeGlobals({ state, updateVisionSetting, resetVisionSettings }, "state.js");
