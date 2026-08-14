/**
 * Farms tab preferences in localStorage: visible syndicates, folded groups and
 * missions starred as optimal.
 */

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

// Optimal missions are keyed by pattern (faction|tier|type), not by rotation.
// added forces a mission as optimal; removed hides a default one (OPTIMAL_FILTERS).

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
