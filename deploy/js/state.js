// Estado global de la aplicación
export let state = {
  currentLang: "es",
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
};

// --- GUARDAR ESTADO ---
export function saveAppState() {
  const data = {
    lang: state.currentLang,
    // tab: state.activeTab,
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
  };
  localStorage.setItem("voidStonks_save", JSON.stringify(data));
}

export function loadAppState() {
  const saved = localStorage.getItem("voidStonks_save");
  if (saved) {
    try {
      const data = JSON.parse(saved);

      state.currentLang = data.lang || "es";
      // state.activeTab = data.tab || "relic";

      if (data.relicInput) {
        const ri = document.getElementById("relicInput");
        if (ri) ri.value = data.relicInput;
        state.selectedRelic = data.relicInput;
      }
      if (data.refinement)
        document.getElementById("refinement").value = data.refinement;
      if (data.username)
        document.getElementById("usernameInput").value = data.username;
      if (data.mr) document.getElementById("mrInput").value = data.mr;
      if (data.lfgActivity)
        document.getElementById("lfgActivity").value = data.lfgActivity;

      if (data.currentActiveSet) {
        state.currentActiveSet = data.currentActiveSet;
        state.activeSetParts = data.activeSetParts || [];
        state.completedParts = new Set(data.completedParts || []);
      }
      if (data.lfgPresets) state.lfgPresets = data.lfgPresets;
      if (data.inventory) state.inventory = data.inventory;
      return state.activeTab;
    } catch (e) {
      console.warn("Error cargando save:", e);
    }
  }
  return "relic";
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
      state.inventory.splice(itemIndex, 1); // Borrar si es 0
    }
  } else if (change > 0) {
    // Añadir nuevo
    state.inventory.push({ name: relicName, count: change });
  }
}
