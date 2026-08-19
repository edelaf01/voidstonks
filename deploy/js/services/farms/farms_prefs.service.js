/**
 * Preferencias de la pestaña Farms: qué sindicatos se ven, qué grupos van plegados y qué
 * misiones ha marcado el usuario como óptimas.
 *
 * Estaba dentro de ui_bounties.js, mezclado con el render. No pinta nada —es leer y escribir
 * localStorage con validación— y es justo lo que un componente no debería saber hacer.
 */

// ---- Preferencias de vista (chips de sindicato + grupos plegados) ----

const VIEW_KEY = "vs_farms_view_v1";

export function getViewPrefs() {
  try {
    const data = JSON.parse(localStorage.getItem(VIEW_KEY)) || {};
    return {
      hiddenFactions: Array.isArray(data.hiddenFactions) ? data.hiddenFactions : [],
      collapsed: Array.isArray(data.collapsed) ? data.collapsed : [],
    };
  } catch {
    return { hiddenFactions: [], collapsed: [] };
  }
}

export function saveViewPrefs(prefs) {
  localStorage.setItem(VIEW_KEY, JSON.stringify(prefs));
}

// ---- Óptimas personalizadas ----
// El usuario puede marcar/desmarcar misiones como óptimas con la estrella.
// La clave es por patrón (facción|tier|tipo), no por rotación: "Cavia T3
// Exterminate" seguirá siendo óptima en rotaciones futuras hasta que la quite.
// added fuerza óptima; removed anula las óptimas de serie (OPTIMAL_FILTERS).

const OPTIMAL_KEY = "vs_farms_optimal_v1";

export function getOptimalOverrides() {
  try {
    const data = JSON.parse(localStorage.getItem(OPTIMAL_KEY)) || {};
    return {
      added: Array.isArray(data.added) ? data.added : [],
      removed: Array.isArray(data.removed) ? data.removed : [],
    };
  } catch {
    return { added: [], removed: [] };
  }
}

export function saveOptimalOverrides(o) {
  localStorage.setItem(OPTIMAL_KEY, JSON.stringify(o));
}

export function optimalKey(m) {
  return `${m.factionKey}|${m.tier}|${m.technicalType}`;
}

export function isEffectiveOptimal(m, overrides) {
  const key = optimalKey(m);
  if (overrides.added.includes(key)) return true;
  if (overrides.removed.includes(key)) return false;
  return !!m.isOptimal;
}

export function toggleOptimalOverride(key, currentlyOptimal) {
  const o = getOptimalOverrides();
  if (currentlyOptimal) {
    // Quitar de óptimas: si era manual se borra de added; si era de serie, va a removed
    const idx = o.added.indexOf(key);
    if (idx !== -1) o.added.splice(idx, 1);
    else if (!o.removed.includes(key)) o.removed.push(key);
  } else {
    const idx = o.removed.indexOf(key);
    if (idx !== -1) o.removed.splice(idx, 1);
    else if (!o.added.includes(key)) o.added.push(key);
  }
  saveOptimalOverrides(o);
}
