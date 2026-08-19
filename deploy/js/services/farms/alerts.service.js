// Motor de alarmas de rotaciones

const PREFS_KEY = "vs_farm_alarms_v1";
const FIRED_KEY = "vs_farm_alarms_fired_v1";

export const ALARM_KINDS = ["bounty", "fissure", "arbitration", "weapon"];

// Max min valence bonus for weapons
export const VALENCE_MIN = 25;
export const VALENCE_MAX = 60;

// Tiers comunitarios de Arbitración, de peor a mejor).
export const ARBY_TIER_ORDER = ["F", "D", "C", "B", "A", "S"];

// Tiers especiales (NARMER / CODA) .
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
  return SPECIAL_TIER_VALUE;
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
    //arbi rule by tier
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
    // weapon rotation reminder: alert when weapon rolls element at or above X%
    newRule = {
      id,
      kind: "weapon",
      vendor: rule.vendor || "any", // "any" | "eleanor" | "glast"
      weapon: rule.weapon || "any",
      element: rule.element || "any",
      minPercent: Math.min(VALENCE_MAX, Math.max(VALENCE_MIN, Number(rule.minPercent) || VALENCE_MIN)),
    };
    dup = prefs.rules.some(
      (r) => r.kind === "weapon" && (r.vendor || "any") === newRule.vendor
        && (r.weapon || "any") === newRule.weapon && (r.element || "any") === newRule.element
        && Number(r.minPercent) === newRule.minPercent,
    );
  } else if (rule.kind === "fissure") {
    //fissure rule by tier, type, planet, source and sp or not
    newRule = {
      id,
      kind: "fissure",
      tier: rule.tier || "any",
      type: rule.type || "any",
      planet: rule.planet || "any",
      source: rule.source || "any", // "any" | "normal" | "railjack"
      sp: rule.sp || "any", // "any" | "sp" (Steel Path only) | "normal" (no Steel Path)
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
      // empty = any challenge
      challenges: [...new Set(rule.challenges || [])].sort(),
    };
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
  return Notification.permission;
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

// Fires once per (rule, mission, rotation).

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

// Older rules stored a single `challenge` string ("any" = no filter).
export function ruleChallenges(rule) {
  if (Array.isArray(rule.challenges)) return [...rule.challenges].sort();
  if (rule.challenge && rule.challenge !== "any") return [rule.challenge];
  return [];
}

// "Kiliken (Venus)" -> "Venus"
export function planetOfNode(node) {
  const m = /\(([^)]+)\)\s*$/.exec(node || "");
  return m ? m[1] : "";
}

const MATCHERS = {
  bounty(rule, m) {
    if (rule.faction !== "any" && rule.faction !== m.factionKey) return false;
    if ((rule.type || "any") !== "any" && rule.type !== m.technicalType) return false;
    const chals = ruleChallenges(rule);
    if (chals.length > 0 && !chals.includes((m.condition || "").trim())) return false;
    return tierValue(m.tier) >= rule.minTier;
  },
  // f: { node, type, tier, expiry, isSP, isStorm } from fissures.service
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
  // w: { name, vendorKey, bonus: { element, percent } }
  weapon(rule, w) {
    if ((rule.vendor || "any") !== "any" && rule.vendor !== w.vendorKey) return false;
    if ((rule.weapon || "any") !== "any" && rule.weapon !== w.name) return false;
    //no found bonus as of now 
    if (!w.bonus) return false;
    const el = (rule.element || "any");
    if (el !== "any" && el.toLowerCase() !== String(w.bonus.element).toLowerCase()) return false;
    return Number(w.bonus.percent) >= Number(rule.minPercent || 0);
  },
  // m: { node, type, enemy, tier ("S".."F" | null), expiry }
  arbitration(rule, m) {
    const norm = (t) => (t || "").replace(/^dark sector /i, "");
    if ((rule.type || "any") !== "any" && norm(rule.type) !== norm(m.type)) return false;
    const minTier = rule.minTier || "any";
    if (minTier === "any") return true;
    const val = (t) => ARBY_TIER_ORDER.indexOf((t || "").toUpperCase());
    return val(m.tier) >= val(minTier);
  },
};

/**
 * Rules that fire for the first time in this rotation. Sends the browser notification
 * and the sound; the caller shows the toast.
 * @param {string} kind
 * @param {Array} items
 * @returns {Array<{rule, item}>}
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
      // factionKey identifica bounties
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
    //TODO handle error
  }
}

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
