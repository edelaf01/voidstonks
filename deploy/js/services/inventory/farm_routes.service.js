const KEY = "vs_farm_routes_view_v1";

// view: "routes" (set -> relic) | "picks" (relic -> rewards)
const DEFAULTS = { collapsed: false, guideOpen: false, view: "routes" };
const VIEWS = new Set(["routes", "picks"]);

export function getFarmRoutesPrefs() {
    try {
        const data = JSON.parse(localStorage.getItem(KEY)) || {};
        return {
            collapsed: typeof data.collapsed === "boolean" ? data.collapsed : DEFAULTS.collapsed,
            guideOpen: typeof data.guideOpen === "boolean" ? data.guideOpen : DEFAULTS.guideOpen,
            view: VIEWS.has(data.view) ? data.view : DEFAULTS.view,
        };
    } catch {
        return { ...DEFAULTS };
    }
}

export function saveFarmRoutesPrefs(prefs) {
    try {
        localStorage.setItem(KEY, JSON.stringify({ ...getFarmRoutesPrefs(), ...prefs }));
    } catch (e) {
        console.error("Error guardando preferencias de rutas:", e);
    }
}

const PICKS_KEY = "vs_relic_picks_v1";
const PICKS_DEFAULTS = { query: "", era: "", readyOnly: false, sortBy: "useful" };
const PICKS_ERAS = new Set(["", "Lith", "Meso", "Neo", "Axi", "Requiem"]);
const PICKS_SORTS = new Set(["useful", "odds", "value", "minutes"]);

export function getRelicPicksPrefs() {
    try {
        const data = JSON.parse(localStorage.getItem(PICKS_KEY)) || {};
        return {
            query: typeof data.query === "string" ? data.query : "",
            era: PICKS_ERAS.has(data.era) ? data.era : "",
            readyOnly: typeof data.readyOnly === "boolean" ? data.readyOnly : false,
            sortBy: PICKS_SORTS.has(data.sortBy) ? data.sortBy : PICKS_DEFAULTS.sortBy,
        };
    } catch {
        return { ...PICKS_DEFAULTS };
    }
}

export function saveRelicPicksPrefs(prefs) {
    try {
        localStorage.setItem(PICKS_KEY, JSON.stringify({ ...getRelicPicksPrefs(), ...prefs }));
    } catch (e) {
        console.error("Error guardando filtros de reliquias:", e);
    }
}

const BRIDGE_KEY = "vs_sets_bridge_v1";
const BRIDGE_DEFAULTS = { sort: "near", expanded: false, query: "", maxMissing: 0, era: "" };
// "" = any; Requiem relics also complete parts (Kuva/Tenet)
const BRIDGE_ERAS = new Set(["", "Lith", "Meso", "Neo", "Axi", "Requiem"]);
const BRIDGE_SORTS = new Set(["near", "gain"]);

export function getSetsBridgePrefs() {
    try {
        const data = JSON.parse(localStorage.getItem(BRIDGE_KEY)) || {};
        return {
            sort: BRIDGE_SORTS.has(data.sort) ? data.sort : BRIDGE_DEFAULTS.sort,
            expanded: typeof data.expanded === "boolean" ? data.expanded : BRIDGE_DEFAULTS.expanded,
            query: typeof data.query === "string" ? data.query : "",
            // integer >= 0, 0 = no filter
            maxMissing: Number.isInteger(data.maxMissing) && data.maxMissing > 0 ? data.maxMissing : 0,
            era: BRIDGE_ERAS.has(data.era) ? data.era : "",
        };
    } catch {
        return { ...BRIDGE_DEFAULTS };
    }
}

export function saveSetsBridgePrefs(prefs) {
    try {
        localStorage.setItem(BRIDGE_KEY, JSON.stringify({ ...getSetsBridgePrefs(), ...prefs }));
    } catch (e) {
        console.error("Error guardando preferencias de la tira de sets:", e);
    }
}
