// Estado global de la aplicación
export const state = {
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
  inventory: [],
  invFilterTier: "ALL",
  invSearchVal: "",
  showAllFarms: false,
  primeInventory: {},
  primeManifest: [],
  autoSyncRewards: true,
  autoCopyScanResults: false,
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
    contrast: 1,
    brightness: 0,
    gamma: 1,
    ocrLang: "eng",
    showROI: true,
    medianBlur: 9,
    sharpen: 1
  }
};
let saveTimer = null;
export function saveAppState() {
  if (saveTimer) clearTimeout(saveTimer);

  saveTimer = setTimeout(() => {
    const data = {
      lang: state.currentLang,
      relicInput: document.getElementById("relicInput")?.value || "",
      refinement: document.getElementById("refinement")?.value || "Rad",
      lfgActivity: document.getElementById("lfgActivity")?.value || "eidolon",
      username: document.getElementById("usernameInput")?.value || "",
      mr: document.getElementById("mrInput")?.value || 0,
      currentActiveSet: state.currentActiveSet,
      activeSetParts: state.activeSetParts,
      completedParts: Array.from(state.completedParts),
      lfgPresets: state.lfgPresets,
      inventory: state.inventory,
      showAllFarms: state.showAllFarms,
      primeInventory: state.primeInventory,
      autoSyncRewards: state.autoSyncRewards,
      autoCopyScanResults: state.autoCopyScanResults,
    };

    localStorage.setItem("voidStonks_save", JSON.stringify(data));

    //console.log("Estado guardado");
    saveTimer = null;
  }, 1000);
}
function restoreDOMInputs(data) {
  const map = {
    relicInput: "relicInput",
    refinement: "refinement",
    username: "usernameInput",
    mr: "mrInput",
    lfgActivity: "lfgActivity"
  };
  for (const [key, id] of Object.entries(map)) {
    if (data[key] !== undefined && data[key] !== null) {
      const el = document.getElementById(id);
      if (el) el.value = data[key];
    }
  }
}

export function loadAppState() {
  const saved = localStorage.getItem("voidStonks_save");
  if (!saved) return "relic";

  try {
    const data = JSON.parse(saved);
    state.currentLang = data.lang || "en";

    restoreDOMInputs(data);

    if (data.relicInput) state.selectedRelic = data.relicInput;
    if (data.currentActiveSet) {
      state.currentActiveSet = data.currentActiveSet;
      state.activeSetParts = data.activeSetParts || [];
      state.completedParts = new Set(data.completedParts || []);
    }

    const simpleKeys = ["showAllFarms", "lfgPresets", "inventory", "primeInventory", "autoSyncRewards", "autoCopyScanResults"];
    simpleKeys.forEach(k => {
      if (data[k] !== undefined) state[k] = data[k];
    });

    if (data.visionSettings) {
      state.visionSettings = { ...state.visionSettings, ...data.visionSettings };
    }

    return state.activeTab;
  } catch (e) {
    console.warn("Error cargando save:", e);
    return "relic";
  }
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
