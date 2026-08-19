// Motor de alarmas de rotaciones. Genérico por "kind": hoy solo se evalúan
// bounties (kind: "bounty"), pero el esquema de reglas y el deduplicado por
// expiry están pensados para añadir fisuras (kind: "fissure") con un matcher
// nuevo sin tocar el almacenamiento ni la UI de reglas.

const PREFS_KEY = "vs_farm_alarms_v1";
const FIRED_KEY = "vs_farm_alarms_fired_v1";

export const ALARM_KINDS = ["bounty", "fissure", "arbitration", "weapon"];

// Rango real del bonus de valencia que genera el juego. Acota el selector del builder y
// evita reglas imposibles (un ≥70% no saltaría nunca).
export const VALENCE_MIN = 25;
export const VALENCE_MAX = 60;

// Tiers comunitarios de Arbitración, de peor a mejor (para "tier mínimo").
export const ARBY_TIER_ORDER = ["F", "D", "C", "B", "A", "S"];

// Tiers especiales (NARMER / CODA) se tratan como el máximo.
export const SPECIAL_TIER_VALUE = 6;

const DEFAULT_PREFS = {
  enabled: false,
  sound: true,
  rules: [],
};

export function tierValue(tier) {
  if (typeof tier === "number") return tier;
  const n = Number.parseInt(tier, 10);
  if (!Number.isNaN(n)) return n;
  return SPECIAL_TIER_VALUE; // NARMER, CODA...
}

export function getAlarmPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS, rules: [] };
    const data = JSON.parse(raw);
    return {
      enabled: !!data.enabled,
      sound: data.sound !== false,
      rules: Array.isArray(data.rules) ? data.rules : [],
    };
  } catch {
    return { ...DEFAULT_PREFS, rules: [] };
  }
}

export function saveAlarmPrefs(prefs) {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

export function addAlarmRule(rule) {
  const prefs = getAlarmPrefs();
  const id = `r${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
  let newRule;
  let dup;

  if (rule.kind === "arbitration") {
    // Regla de arbitración: tier comunitario MÍNIMO (S mejor..F peor) y tipo de misión.
    newRule = {
      id,
      kind: "arbitration",
      minTier: rule.minTier || "any", // "any" | "S".."F"
      type: rule.type || "any",
    };
    dup = prefs.rules.some(
      (r) => r.kind === "arbitration" && (r.minTier || "any") === newRule.minTier
        && (r.type || "any") === newRule.type,
    );
  } else if (rule.kind === "weapon") {
    // Recordatorio de rotación de armas: "avísame cuando <arma> salga con <elemento>
    // al menos al X%". Cualquiera de los tres filtros puede quedar en "any".
    newRule = {
      id,
      kind: "weapon",
      vendor: rule.vendor || "any", // "any" | "eleanor" | "glast"
      weapon: rule.weapon || "any", // nombre exacto del arma
      element: rule.element || "any",
      minPercent: Math.min(VALENCE_MAX, Math.max(VALENCE_MIN, Number(rule.minPercent) || VALENCE_MIN)),
    };
    dup = prefs.rules.some(
      (r) => r.kind === "weapon" && (r.vendor || "any") === newRule.vendor
        && (r.weapon || "any") === newRule.weapon && (r.element || "any") === newRule.element
        && Number(r.minPercent) === newRule.minPercent,
    );
  } else if (rule.kind === "fissure") {
    // Regla de fisura: tier de reliquia exacto (no mínimo), tipo de misión,
    // planeta (extraído del nodo) y origen (normal / Railjack). "any" = sin filtro.
    newRule = {
      id,
      kind: "fissure",
      tier: rule.tier || "any",
      type: rule.type || "any",
      planet: rule.planet || "any",
      source: rule.source || "any", // "any" | "normal" | "railjack"
      sp: rule.sp || "any", // "any" | "sp" (solo Steel Path) | "normal" (solo no-SP)
    };
    dup = prefs.rules.some(
      (r) => r.kind === "fissure" && (r.tier || "any") === newRule.tier
        && (r.type || "any") === newRule.type && (r.planet || "any") === newRule.planet
        && (r.source || "any") === newRule.source && (r.sp || "any") === newRule.sp,
    );
  } else {
    newRule = {
      id,
      kind: rule.kind || "bounty",
      faction: rule.faction || "any",
      minTier: tierValue(rule.minTier ?? 1),
      type: rule.type || "any",
      // Multiselección: lista vacía = cualquier desafío
      challenges: [...new Set(rule.challenges || [])].sort(),
    };
    // Evita duplicados exactos (misma facción, tier mínimo, tipo y desafíos)
    dup = prefs.rules.some(
      (r) => r.kind === newRule.kind && r.faction === newRule.faction
        && r.minTier === newRule.minTier && (r.type || "any") === newRule.type
        && ruleChallenges(r).join("|") === newRule.challenges.join("|"),
    );
  }

  if (dup) return null;
  prefs.rules.push(newRule);
  saveAlarmPrefs(prefs);
  return newRule;
}

export function removeAlarmRule(id) {
  const prefs = getAlarmPrefs();
  prefs.rules = prefs.rules.filter((r) => r.id !== id);
  saveAlarmPrefs(prefs);
}

export function notificationState() {
  if (!("Notification" in globalThis)) return "unsupported";
  return Notification.permission; // "granted" | "denied" | "default"
}

export async function requestNotifyPermission() {
  if (!("Notification" in globalThis)) return "unsupported";
  if (Notification.permission === "granted") return "granted";
  try {
    return await Notification.requestPermission();
  } catch {
    return "denied";
  }
}

// ---- Deduplicado: una alarma por (regla, misión, rotación) ----

function loadFired() {
  try {
    return JSON.parse(localStorage.getItem(FIRED_KEY)) || {};
  } catch {
    return {};
  }
}

function pruneAndSaveFired(fired) {
  const now = Date.now();
  for (const key of Object.keys(fired)) {
    if (fired[key] < now) delete fired[key];
  }
  localStorage.setItem(FIRED_KEY, JSON.stringify(fired));
}

// Desafíos efectivos de una regla, con retrocompatibilidad: las reglas viejas
// guardaban un único `challenge` string ("any" = sin filtro).
export function ruleChallenges(rule) {
  if (Array.isArray(rule.challenges)) return [...rule.challenges].sort();
  if (rule.challenge && rule.challenge !== "any") return [rule.challenge];
  return [];
}

// ---- Matchers por kind ----

// Planeta de un nodo tipo "Kiliken (Venus)" / "Sambir Cloud (Veil)" → "Venus" / "Veil".
export function planetOfNode(node) {
  const m = /\(([^)]+)\)\s*$/.exec(node || "");
  return m ? m[1] : "";
}

const MATCHERS = {
  bounty(rule, m) {
    if (rule.faction !== "any" && rule.faction !== m.factionKey) return false;
    if ((rule.type || "any") !== "any" && rule.type !== m.technicalType) return false;
    // Los desafíos se guardan como etiquetas de CHALLENGE_MAP, que es lo que
    // bounties.service deja en m.condition. Lista vacía = cualquier desafío.
    const chals = ruleChallenges(rule);
    if (chals.length > 0 && !chals.includes((m.condition || "").trim())) return false;
    return tierValue(m.tier) >= rule.minTier;
  },
  // f = fisura normalizada de fissures.service: { node, type, tier, expiry, isSP, isStorm }
  fissure(rule, f) {
    const source = rule.source || "any";
    if (source === "normal" && f.isStorm) return false;
    if (source === "railjack" && !f.isStorm) return false;
    const sp = rule.sp || "any";
    if (sp === "sp" && !f.isSP) return false;
    if (sp === "normal" && f.isSP) return false;
    const tier = f.tier === "Vanguard" ? "Axi" : f.tier;
    if ((rule.tier || "any") !== "any" && rule.tier !== tier) return false;
    if ((rule.type || "any") !== "any" && rule.type !== f.type) return false;
    if ((rule.planet || "any") !== "any" && rule.planet !== planetOfNode(f.node)) return false;
    return true;
  },
  // w = arma de la rotación, aplanada con su tienda: { name, vendorKey, bonus:{element,percent} }
  weapon(rule, w) {
    if ((rule.vendor || "any") !== "any" && rule.vendor !== w.vendorKey) return false;
    if ((rule.weapon || "any") !== "any" && rule.weapon !== w.name) return false;
    // Sin bonus reportado todavía no se puede afirmar que cumpla. No dispara ahora, pero
    // tampoco queda descartada: el deduplicado es por (regla, arma, rotación), así que
    // saltará en cuanto la wiki publique el dato dentro de esta misma ventana.
    if (!w.bonus) return false;
    const el = (rule.element || "any");
    if (el !== "any" && el.toLowerCase() !== String(w.bonus.element).toLowerCase()) return false;
    return Number(w.bonus.percent) >= Number(rule.minPercent || 0);
  },
  // m = arbitración activa de fissures.service: { node, type, enemy, tier ("S".."F"|null), expiry }
  arbitration(rule, m) {
    // "Dark Sector Defense" cuenta como "Defense": el prefijo solo indica el nodo.
    const norm = (t) => (t || "").replace(/^dark sector /i, "");
    if ((rule.type || "any") !== "any" && norm(rule.type) !== norm(m.type)) return false;
    const minTier = rule.minTier || "any";
    if (minTier === "any") return true;
    // Sin tier comunitario conocido no se puede garantizar el mínimo -> no dispara.
    const val = (t) => ARBY_TIER_ORDER.indexOf((t || "").toUpperCase());
    return val(m.tier) >= val(minTier);
  },
};

/**
 * Evalúa las reglas activas contra las misiones actuales y devuelve las que
 * disparan por primera vez en esta rotación. El caller decide cómo mostrarlas
 * (toast); aquí solo se emiten la notificación del navegador y el sonido.
 * @param {string} kind - "bounty" (futuro: "fissure")
 * @param {Array} items - misiones con { factionKey, tier, type, uName, expiry }
 * @returns {Array<{rule, item}>} disparos nuevos
 */
export function evaluateAlarms(kind, items) {
  const prefs = getAlarmPrefs();
  if (!prefs.enabled || prefs.rules.length === 0) return [];
  const matcher = MATCHERS[kind];
  if (!matcher || !Array.isArray(items)) return [];

  const fired = loadFired();
  const now = Date.now();
  const hits = [];

  for (const rule of prefs.rules) {
    if ((rule.kind || "bounty") !== kind) continue;
    for (const item of items) {
      const expiry = Number(new Date(item.expiry)) || now + 3600000;
      if (expiry <= now) continue;
      if (!matcher(rule, item)) continue;
      // factionKey identifica bounties; las fisuras no lo tienen y usan el nodo; las armas,
      // su tienda y su nombre (sin el nombre, dos armas del mismo `type` compartirían clave
      // y solo avisaría de la primera).
      const kindKey = item.factionKey || item.vendorKey || item.node || "?";
      const key = `${rule.id}|${kindKey}|${item.uName || item.name || item.type}|${expiry}`;
      if (fired[key]) continue;
      fired[key] = expiry;
      hits.push({ rule, item });
    }
  }

  if (hits.length > 0) {
    pruneAndSaveFired(fired);
    if (prefs.sound) playAlarmSound();
  }
  return hits;
}

/**
 * Notificación nativa del navegador (si hay permiso). Se agrupan los
 * disparos en una sola notificación para no hacer spam.
 */
export function sendBrowserNotification(title, body) {
  if (!("Notification" in globalThis) || Notification.permission !== "granted") return;
  try {
    const n = new Notification(title, {
      body,
      icon: "assets/farm.webp",
      tag: "vs-farm-alarm",
    });
    n.onclick = () => {
      globalThis.focus();
      n.close();
    };
  } catch (e) {
    console.warn("[ALARMS] Notification failed:", e);
  }
}

// Beep corto con WebAudio: sin assets y funciona offline.
let audioCtx = null;
export function playAlarmSound() {
  try {
    audioCtx = audioCtx || new (globalThis.AudioContext || globalThis.webkitAudioContext)();
    const ctx = audioCtx;
    if (ctx.state === "suspended") ctx.resume();
    [0, 0.18].forEach((delay, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = i === 0 ? 880 : 1174; // A5 → D6
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + delay + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + delay + 0.15);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + delay);
      osc.stop(ctx.currentTime + delay + 0.16);
    });
  } catch {
    /* audio bloqueado hasta el primer gesto del usuario: no es crítico */
  }
}

// ---- Watcher en segundo plano ----
// Un único intervalo compartido evalúa todas las fuentes registradas (bounties,
// fisuras...). Los fetchers cachean (IndexedDB por rotación / memoria 2 min), así
// que el tick es barato: solo golpea la red cuando su caché caduca. Kinds sin
// reglas configuradas ni siquiera ejecutan su fetch.

let watcherInterval = null;
const watcherSources = {}; // kind -> { fetchFn, onFire }

async function watcherTick() {
  const prefs = getAlarmPrefs();
  if (!prefs.enabled || prefs.rules.length === 0) return;
  for (const [kind, src] of Object.entries(watcherSources)) {
    if (!prefs.rules.some((r) => (r.kind || "bounty") === kind)) continue;
    try {
      const items = await src.fetchFn();
      const hits = evaluateAlarms(kind, items);
      if (hits.length > 0 && src.onFire) src.onFire(hits);
    } catch (e) {
      console.warn(`[ALARMS] watcher tick (${kind}) failed:`, e);
    }
  }
}

export function startAlarmWatcher(fetchFn, onFire, kind = "bounty") {
  watcherSources[kind] = { fetchFn, onFire };
  if (!watcherInterval) {
    watcherInterval = setInterval(watcherTick, 60 * 1000);
  }
  watcherTick();
}
