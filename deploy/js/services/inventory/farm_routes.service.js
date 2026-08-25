/**
 * Preferencias de vista del panel "Rutas aconsejadas": si está plegado y si la guía está
 * abierta.
 *
 * Vive aquí y no en el componente por dos motivos: un `ui.component` no toca localStorage
 * (ARCHITECTURE.md §A), y el panel se repinta entero cada 150 s al rotar las fisuras — sin un
 * sitio donde persistirlo, el usuario que plegaba el panel o abría la guía se los encontraba
 * abiertos otra vez al siguiente refresco.
 */

const KEY = "vs_farm_routes_view_v1";

// Abierto de serie: es el ÚNICO bloque de la parte de arriba desde que absorbió al de
// recomendaciones, y plegado no se ve nada de lo que aporta. Estuvo plegado mientras eran dos
// apilados (52vh + 30vh), que entre los dos dejaban el listado en su min-height de 120px; ese
// motivo desapareció con la fusión. Su techo lo pone .fr-body en styles.css.
// `view` elige entre las dos caras del panel: "routes" (set → qué reliquia) y "picks"
// (reliquia → qué me daría). Por defecto la de siempre.
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

/**
 * Filtros de la vista "por reliquia". Clave aparte de los de rutas porque filtran cosas
 * distintas: allí las filas son SETS (piezas restantes, umbrales de platino por hora) y aquí
 * son reliquias. Compartir clave hacía que un "máx. 1 pieza restante" puesto en rutas dejara
 * la otra vista vacía sin ningún control que lo explicara.
 */
// v2 al entrar el orden "la que más acerca a cerrar un set": el orden viejo ("más recompensas
// que me sirven") quedaba guardado y seguía mandando, que es justo el que no distingue entre
// una pieza que cierra un set y una de uno sin empezar.
const PICKS_KEY = "vs_relic_picks_v2";
const PICKS_DEFAULTS = { query: "", era: "", readyOnly: false, sortBy: "best" };
const PICKS_ERAS = new Set(["", "Lith", "Meso", "Neo", "Axi", "Requiem"]);
const PICKS_SORTS = new Set(["best", "useful", "odds", "value", "minutes"]);

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

/**
 * Preferencias de la tira "los tienes a medias" de la pestaña Set (ui_sets_bridge.js).
 *
 * Viven en este módulo y no en uno propio porque son las dos hermanas de arriba: ambas vistas
 * salen de `buildFarmRoutes` y ambas son ajustes de presentación que un `ui.component` no puede
 * guardar por su cuenta (ARCHITECTURE.md §A). Clave aparte para que plegar una no toque a la otra.
 */
const BRIDGE_KEY = "vs_sets_bridge_v1";
// Plegada de serie: es un puente, no la lista principal. Y por cercanía, que es lo que la hace
// útil de un vistazo — ordenar por platino de entrada pondría arriba sets a los que les falta todo.
const BRIDGE_DEFAULTS = { sort: "near", expanded: false, query: "", maxMissing: 0, era: "" };
// "" = cualquiera. Requiem entra porque sus reliquias también cierran piezas (Kuva/Tenet).
const BRIDGE_ERAS = new Set(["", "Lith", "Meso", "Neo", "Axi", "Requiem"]);
const BRIDGE_SORTS = new Set(["near", "gain"]);

export function getSetsBridgePrefs() {
    try {
        const data = JSON.parse(localStorage.getItem(BRIDGE_KEY)) || {};
        return {
            sort: BRIDGE_SORTS.has(data.sort) ? data.sort : BRIDGE_DEFAULTS.sort,
            expanded: typeof data.expanded === "boolean" ? data.expanded : BRIDGE_DEFAULTS.expanded,
            query: typeof data.query === "string" ? data.query : "",
            // Entero >= 0; 0 = sin filtro. Un NaN guardado compararía siempre false y dejaría la
            // tira vacía sin que ningún control pareciera puesto.
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
