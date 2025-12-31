// Estado global de la aplicación
export let state = {
currentLang: "es",
  activeTab: "relic",
  playerCount: 1,
  lfgCount: 1,
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
  inventory: []
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
      return state.activeTab;
    } catch (e) {
      console.warn("Error cargando save:", e);
    }
  }
  return "relic";
}
