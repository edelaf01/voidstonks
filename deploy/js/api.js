import {
  WORKER_URL,
  TEXTS,
  AYA_STRATEGY_CONFIG,
  DUAL_PATH_FACTIONS,
  NODE_MAP,
  NODE_TO_TYPE,
  VANIA_NAMES,
  CHALLENGE_MAP,
  ZARIMAN_DATA,
  BOUNTY_NAMES,
  OPTIMAL_FILTERS,
  ALLY_MAP,
} from "./config.js";
import { state } from "./state.js";

const MEMORY_CACHE = new Map();
const PENDING_REQUESTS = new Map();
let activeRequests = 0;
const MAX_CONCURRENT = 5;
let batchTimer = null;
export function getSlug(itemName) {
  if (!itemName) return "";
  let cleanName = itemName.trim().replaceAll("&", "and");
  let slug = cleanName
    .toLowerCase()
    .replaceAll(/[^a-z0-9 ]/g, "")
    .trim()
    .replaceAll(/\s+/g, "_");
  const manualFixes = { kompressa_prime_receiver: "kompressa_prime_reciever" };
  return manualFixes[slug] || slug;
}

export function getRivenSlug(inputVal) {
  const originalSlug = inputVal.toLowerCase().trim().replaceAll(/\s+/g, "_");
  let baseCandidate = originalSlug;
  const prefixes = ["coda_", "kuva_", "tenet_", "mk1_", "prisma_", "dex_", "carmine_"];
  const suffixes = ["_prime", "_vandal", "_wraith"];

  let changed = true;
  while (changed) {
    changed = false;
    for (let pre of prefixes) {
      if (baseCandidate.startsWith(pre)) {
        baseCandidate = baseCandidate.substring(pre.length);
        changed = true;
      }
    }
    for (let suf of suffixes) {
      if (baseCandidate.endsWith(suf)) {
        baseCandidate = baseCandidate.substring(0, baseCandidate.length - suf.length);
        changed = true;
      }
    }
  }

  if (baseCandidate === originalSlug) return originalSlug;

  const allNames = state.allRivenNames || [];
  const baseExists = allNames.some(name => {
    const slug = name.toLowerCase().trim().replaceAll(/\s+/g, "_");
    return slug === baseCandidate;
  });

  return baseExists ? baseCandidate : originalSlug;
}

function processRelicData(rawData) {
  let relicsArray =
    rawData.relics && Array.isArray(rawData.relics) ? rawData.relics : [];
  let tempDB = {};
  let tempRelicDB = {};
  let tempStatusDB = {};
  let tempNamesSet = new Set();

  relicsArray.forEach((entry) => {
    if (entry.state !== "Intact") return;
    if (!entry.relicName || entry.relicName === "undefined") return;
    const fullName = `${entry.tier} ${entry.relicName}`;

    if (tempNamesSet.has(fullName)) return;
    tempNamesSet.add(fullName);

    const cleanNameUpper = fullName.toUpperCase();
    if (!tempRelicDB[fullName]) tempRelicDB[fullName] = [];

    tempStatusDB[fullName] = state.activeResurgenceList.has(cleanNameUpper)
      ? "aya"
      : "active";

    if (entry.rewards && Array.isArray(entry.rewards)) {
      entry.rewards.forEach((reward) => {
        const itemName = reward.itemName;
        if (!itemName) return;

        if (!tempDB[itemName]) tempDB[itemName] = [];
        tempDB[itemName].push({
          relic: fullName,
          tier: entry.tier,
          chance: reward.chance,
        });

        tempRelicDB[fullName].push({
          name: itemName,
          chance: reward.chance,
          rarity: reward.rarity,
        });
      });
    }
  });

  state.itemsDatabase = tempDB;
  state.relicsDatabase = tempRelicDB;
  state.relicStatusDB = tempStatusDB;
  state.allRelicNames = Array.from(tempNamesSet).sort((a, b) => {
    const tierOrder = { Lith: 0, Meso: 1, Neo: 2, Axi: 3, Requiem: 4 };
    const aTier = a.split(" ")[0];
    const bTier = b.split(" ")[0];
    const tierDiff = (tierOrder[aTier] ?? 5) - (tierOrder[bTier] ?? 5);
    return tierDiff === 0 ? a.localeCompare(b) : tierDiff;
  });
}

async function fetchActiveResurgence() {
  try {
    const res = await fetch(`${WORKER_URL}?type=aya`);
    if (!res.ok) return;
    const data = await res.json();
    if (data.PrimeVaultTraders) {
      data.PrimeVaultTraders.forEach((trader) => {
        if (!trader.Closed && trader.Manifest) {
          trader.Manifest.forEach((item) => {
            if (item.ItemType?.includes("Projections")) {
              const rawName = item.ItemType.split("/").pop();
              let tier = "";
              if (rawName.startsWith("T1")) tier = "Lith";
              else if (rawName.startsWith("T2")) tier = "Meso";
              else if (rawName.startsWith("T3")) tier = "Neo";
              else if (rawName.startsWith("T4")) tier = "Axi";
              else if (rawName.startsWith("T5")) tier = "Requiem";

              let code = rawName.replaceAll(/T\d+VoidProjection/, "");
              if (code.length === 1 && code.match(/[A-Z]/)) code += "1";

              if (tier && code)
                state.activeResurgenceList.add(`${tier} ${code}`.toUpperCase());
            }
          });
        }
      });
    }
  } catch (e) {
    console.warn("Aya Fetch Error", e);
  }
}

export async function fetchRivenWeapons() {
  const CACHE_KEY = "voidstonkscache_weapons_v3";
  const ONE_DAY = 24 * 60 * 60 * 1000;

  try {
    const cached = await dbHelper.get(CACHE_KEY);

    if (cached?.data && cached?.timestamp && (Date.now() - cached.timestamp < ONE_DAY)) {
      console.log(` Armas cargadas de caché local: ${Object.keys(cached.data).length}`);
      state.weaponMap = cached.data;

    }

    const res = await fetch("assets/json/cleaned_weapons.json");
    if (!res.ok) throw new Error("Failed to load cleaned_weapons.json");
    const data = await res.json();

    state.weaponDetailsDB = data;
    state.weaponMap = {};

    data.forEach((item) => {
      state.weaponMap[item.name] = {
        d: Number.parseFloat(item.omegaAttenuation || 1),
        t: item.type || "Rifle",
      };
    });

    state.allRivenNames = Object.keys(state.weaponMap).sort((a, b) =>
      a.localeCompare(b),
    );

    console.log(` ÉXITO: ${state.allRivenNames.length} armas listas desde JSON local.`);

    await dbHelper.set(CACHE_KEY, {
      timestamp: Date.now(),
      data: state.weaponMap,
    });

    updateDucatsDB(data);

  } catch (e) {
    console.error("Error cargando armas localmente:", e);
  }
}

const CACHE_TTL = 6 * 60 * 60 * 1000;

export async function fetchRivenAverage(weaponName) {
  if (!weaponName) return;
  let slug = getRivenSlug(weaponName);
  const cacheKey = `riven_avg_${slug}`;

  const box = document.getElementById("riven-avg-box");
  const valSpan = document.getElementById("riven-avg-value");
  if (box) box.style.display = "block";
  if (valSpan) valSpan.innerText = "...";

  try {
    const cached = await dbHelper.get(cacheKey);
    if (cached && (Date.now() - cached.time < CACHE_TTL)) {
      if (valSpan) valSpan.innerText = Math.round(cached.val);
      return;
    }

    const res = await fetch(`${WORKER_URL}?type=riven&q=${slug}`);
    if (!res.ok) throw new Error("Worker Error");
    const data = await res.json();
    const auctions = data.payload?.auctions || [];
    const prices = auctions
      .filter(
        (a) => a.visible && a.buyout_price > 0 && a.owner.status !== "offline",
      )
      .map((a) => a.buyout_price)
      .sort((a, b) => a - b);

    if (prices.length > 0) {
      const subset = prices.slice(0, 20);
      const mid = Math.floor(subset.length / 2);
      const median =
        subset.length % 2 === 0
          ? (subset[mid - 1] + subset[mid]) / 2
          : subset[mid];

      const priceVal = Math.round(median);
      if (valSpan) valSpan.innerText = priceVal;

      dbHelper.set(cacheKey, { val: priceVal, time: Date.now() });
    } else {
      if (valSpan) valSpan.innerText = "N/A";
    }
  } catch (e) {
    console.error("Error fetching riven average:", e);
    if (valSpan) valSpan.innerText = "?";
  }
}

async function savePriceToCache(slug, price) {
  const data = { val: price, time: Date.now() };
  MEMORY_CACHE.set(slug, price);

  try {
    await dbHelper.set(`price_${slug}`, data);
  } catch (e) {
    console.warn("Error saving to IndexedDB cache:", e);
  }
}

async function processQueue() {
  batchTimer = null;

  const slugsToFetch = Array.from(PENDING_REQUESTS.keys());
  if (slugsToFetch.length === 0) return;

  const currentBatch = new Map(PENDING_REQUESTS);
  PENDING_REQUESTS.clear();

  for (let i = 0; i < slugsToFetch.length; i += 25) {
    const chunk = slugsToFetch.slice(i, i + 25);
    try {
      const url = `${WORKER_URL}?type=prices_batch&q=${chunk.join(",")}`;
      const res = await fetch(url);

      if (!res.ok) throw new Error(`Error en Worker: ${res.status}`);

      const data = await res.json();

      chunk.forEach((slug) => {
        const price = data[slug] || 0;
        if (price > 0) savePriceToCache(slug, price);

        const resolvers = currentBatch.get(slug);
        if (resolvers) resolvers.forEach((resolveFunc) => resolveFunc(price));
      });

    } catch (err) {
      console.error("Batch chunk fetch failed:", err);
      // Resolve failed chunk with 0 to unblock UI
      chunk.forEach((slug) => {
        const resolvers = currentBatch.get(slug);
        if (resolvers) resolvers.forEach((resolveFunc) => resolveFunc(0));
      });
    }
  }
}

export async function warmupPrices() {
  if (!state.primeInventory && state.inventory.length === 0) return;

  const itemsToCheck = new Set();
  const getSetNameHelper = (fullName) => {
    const match = fullName.match(/(.*?) (Prime|Vandal|Wraith)/);
    return match ? match[0].trim() : null;
  };

  // 1. Collect all potential slugs
  Object.keys(state.primeInventory).forEach(name => {
    const slug = getSlug(name);
    itemsToCheck.add(slug);

    const setName = getSetNameHelper(name);
    if (setName) {
      itemsToCheck.add(getSlug(setName + " Set"));
    }
  });

  state.inventory.forEach(item => {
    const drops = state.relicsDatabase[item.name];
    if (drops) {
      drops.forEach(d => {
        itemsToCheck.add(getSlug(d.name));
      });
    }
  });

  if (itemsToCheck.size === 0) return;

  const slugsToFetch = [];
  const now = Date.now();

  // 2. Filter out already cached items (Memory or IndexedDB)
  for (const slug of itemsToCheck) {
    if (MEMORY_CACHE.has(slug)) continue;

    const cached = await dbHelper.get(`price_${slug}`);
    if (cached && (now - cached.time < CACHE_TTL)) {
      MEMORY_CACHE.set(slug, cached.val);
      continue;
    }
    slugsToFetch.push(slug);
  }

  if (slugsToFetch.length === 0) return;

  // 3. Batch fetch remaining missing prices
  for (let i = 0; i < slugsToFetch.length; i += 30) {
    const chunk = slugsToFetch.slice(i, i + 30);
    try {
      const url = `${WORKER_URL}?type=prices_batch&q=${chunk.join(",")}`;
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = await res.json();
      Object.entries(data).forEach(([slug, price]) => {
        if (price > 0) savePriceToCache(slug, price);
      });
    } catch (e) {
      console.warn("Prefetch error", e);
    }
  }
}

export async function fetchBestFissures() {
  try {
    const res = await fetch(`${WORKER_URL}?type=fissures`);
    if (!res.ok) throw new Error("Error al conectar con el Worldstate");

    const fissures = await res.json();
    const now = new Date();
    const fastMissions = new Set([
      "Capture",
      "Extermination",
      "Rescue",
      "Void Cascade",
    ]);
    return fissures.reduce((acc, f) => {
      const isValidType =
        (fastMissions.has(f.missionType) || f.tier === "Omnia") && !f.isStorm;
      const expiryDate = new Date(f.expiry);

      if (isValidType && expiryDate > now) {
        const diffMs = expiryDate - now;
        const diffMins = Math.round(diffMs / 60000);
        let timeText =
          diffMins >= 60
            ? `${Math.floor(diffMins / 60)}h ${diffMins % 60}m`
            : `${diffMins}m`;

        acc.push({
          node: f.node,
          type: f.missionType,
          tier: f.tier,
          eta: timeText,
          isSP: f.isHard === true,
          isOmnia: f.tier === "Omnia",
        });
      }
      return acc;
    }, []);
  } catch (e) {
    console.error("Error en Worldstate:", e);
    return [];
  }
}
export async function fetchUserProfile(username, platform) {
  try {
    const res = await fetch(
      `${WORKER_URL}?type=profile&platform=${platform}&user=${encodeURIComponent(
        username,
      )}`,
    );
    if (!res.ok) throw new Error("Worker Error");
    const data = await res.json();
    if (data.error) {
      if (globalThis.showToast)
        globalThis.showToast(TEXTS[state.currentLang].errProfileNotFound);
      return;
    }
    if (globalThis.renderProfileStats)
      globalThis.renderProfileStats(data.payload);
  } catch (e) {
    console.error("Error fetching user profile:", e);
    if (globalThis.showToast)
      globalThis.showToast(TEXTS[state.currentLang].errProfileFetch);
  }
}

const PRICE_CACHE_DURATION = CACHE_TTL;

export function getPriceValue(itemName, itemSlug) {
  return new Promise(async (resolve) => {
    if (
      !itemName ||
      !itemSlug ||
      itemName.includes("Forma") ||
      itemName.includes("Kuva") ||
      itemName === "Riven Sliver" ||
      itemName === "Exilus Weapon Adapter Blueprint"
    ) {
      resolve(0);
      return;
    }

    if (MEMORY_CACHE.has(itemSlug)) {
      resolve(MEMORY_CACHE.get(itemSlug));
      return;
    }

    try {
      const cached = await dbHelper.get(`price_${itemSlug}`);
      if (cached && (Date.now() - cached.time < CACHE_TTL)) {
        MEMORY_CACHE.set(itemSlug, cached.val);
        resolve(cached.val);
        return;
      }
    } catch (e) {
      console.warn(`Error reading price cache for ${itemSlug}:`, e);
    }

    if (PENDING_REQUESTS.has(itemSlug)) {
      PENDING_REQUESTS.get(itemSlug).push(resolve);
      return;
    }

    PENDING_REQUESTS.set(itemSlug, [resolve]);

    if (!batchTimer) {
      batchTimer = setTimeout(processQueue, 50);
    }
  });
}

export async function fetchPrimeManifest() {
  try {
    const res = await fetch("assets/json/cleaned_entities.json");
    if (!res.ok) throw new Error("Entities Load Failed");
    const data = await res.json();
    state.primeManifest = data;
    state.entitiesDB = data;

    console.log("Entities Manifest Loaded:", data.length, "items");

    updateDucatsDB(data);

  } catch (e) {
    console.warn("Error loading entities manifest:", e);
  }
}

function updateDucatsDB(itemsArray) {
  if (!state.ducatsDatabase) state.ducatsDatabase = {};

  itemsArray.forEach(item => {
    if (item.components) {
      item.components.forEach(comp => {
        if (comp.ducats > 0) {

          let fullName = comp.name;

          if (["Blueprint", "Barrel", "Receiver", "Stock", "Blade", "Hilt", "Chassis", "Neuroptics", "Systems", "Carapace", "Cerebrum", "Harness", "Wings", "Link", "Pouch", "Stars", "Head", "Motor", "Grip", "String", "Limb", "Guard", "Disc", "Boot", "Gauntlet", "Chain", "Handle", "Ornament"].includes(comp.name)) {
            fullName = `${item.name} ${comp.name}`;
          }
          state.ducatsDatabase[fullName] = {
            name: fullName,
            ducats: comp.ducats
          };

          if (["Chassis", "Neuroptics", "Systems", "Harness", "Wings"].includes(comp.name)) {
            const fullnameBP = fullName + " Blueprint";
            state.ducatsDatabase[fullnameBP] = {
              name: fullnameBP,
              ducats: comp.ducats
            };
          }

          if (comp.name !== fullName) {
            // state.ducatsDatabase[comp.name] = { name: comp.name, ducats: comp.ducats };
          }
        }
      });
    }
  });
}

/*export async function fetchRelicDatabase() {
  console.log("Relic/Ducat Database auto-populated from Weapons/Entities.");
}*/

export async function downloadRelics() {
  const loadEl = document.getElementById("loading");
  if (loadEl) loadEl.style.display = "flex";

  // await fetchRelicDatabase().catch(console.warn);

  const CACHE_KEY = "voidstonks_weapons_v6_full_data";
  const CACHE_TIME = 48 * 60 * 60 * 1000;
  let rawData = null;

  try {
    rawData = await loadRelicsData(CACHE_KEY, CACHE_TIME);
    if (!rawData) throw new Error("Failed to load relics data");

    fetchActiveResurgence().catch(console.warn);

    const activeDropsSet = new Set();
    state.relicSourcesDatabase = {};

    const cleanRelicName = (name) => name.replaceAll(" Relic", "").trim();
    const addSource = (relicFull, sourceData) => {
      const name = cleanRelicName(relicFull);
      if (!state.relicSourcesDatabase[name])
        state.relicSourcesDatabase[name] = [];
      state.relicSourcesDatabase[name].push(sourceData);
    };

    processMissionRewards(rawData, activeDropsSet, addSource);
    processBountySources(rawData, activeDropsSet, addSource);
    processRelicDatabase(rawData, activeDropsSet);

    if (globalThis.finishLoading) globalThis.finishLoading();
  } catch (e) {
    console.error("Error crítico descarga:", e);
    if (globalThis.showToast)
      globalThis.showToast("Error de datos. Recarga la página.");
    if (loadEl) loadEl.style.display = "none";
  }
}

async function loadRelicsData(cacheKey, cacheTtl) {
  try {
    const cachedRecord = await dbHelper.get(cacheKey);
    if (cachedRecord && Date.now() - cachedRecord.timestamp < cacheTtl) {
      console.log("Cargando desde caché local.");
      return cachedRecord.data;
    }
  } catch (e) {
    console.warn("Cache local ignorada:", e);
  }

  console.log("Descargando del servidor...");

  const [relicsRes, missionsRes, bountiesRes] = await Promise.all([
    fetch(`${WORKER_URL}?type=relics_opt`),
    fetch(`${WORKER_URL}?type=missions_opt`),
    fetch(`${WORKER_URL}?type=bounties_opt`),
  ]);

  if (!relicsRes.ok || !missionsRes.ok || !bountiesRes.ok) {
    throw new Error("Worker Error (Partial)");
  }

  const rData = await relicsRes.json();
  const mData = await missionsRes.json();
  const bData = await bountiesRes.json();

  const rawData = {
    relics: rData.relics || [],
    missionRewards: mData.missionRewards || {},
    cetusBountyRewards: bData.cetus || [],
    solarisBountyRewards: bData.solaris || [],
    zarimanRewards: bData.zariman || [],
    deimosRewards: bData.deimos || [],
  };

  await dbHelper.set(cacheKey, { timestamp: Date.now(), data: rawData });

  return rawData;
}

function processMissionRewards(rawData, activeDropsSet, addSource) {
  if (!rawData.missionRewards) return;

  for (const planet in rawData.missionRewards) {
    for (const node in rawData.missionRewards[planet]) {
      const d = rawData.missionRewards[planet][node];
      if (!d.rewards) continue;

      for (const rot in d.rewards) {
        const rewardsList = d.rewards[rot];
        if (!Array.isArray(rewardsList)) continue;

        rewardsList.forEach((i) => {
          if (i.itemName?.includes("Relic")) {
            activeDropsSet.add(i.itemName);
            addSource(i.itemName, {
              type: "mission",
              location: `${node} (${planet})`,
              mission: d.gameMode,
              rotation: rot,
              chance: i.chance,
            });
          }
        });
      }
    }
  }
}

function processBountySources(rawData, activeDropsSet, addSource) {
  const bountySources = [
    { data: rawData.cetusBountyRewards, name: "Cetus" },
    { data: rawData.solarisBountyRewards, name: "Fortuna" },
    { data: rawData.zarimanRewards, name: "Zariman" },
    { data: rawData.deimosRewards, name: "Deimos" },
  ];

  bountySources.forEach((src) => {
    if (!Array.isArray(src.data)) return;

    src.data.forEach((b) => {
      if (!b.rewards) return;

      for (const stage in b.rewards) {
        const rewardsList = b.rewards[stage];
        if (!Array.isArray(rewardsList)) continue;

        rewardsList.forEach((i) => {
          if (i.itemName?.includes("Relic")) {
            activeDropsSet.add(i.itemName);
            addSource(i.itemName, {
              type: "bounty",
              location: `${src.name} Bounty`,
              mission: b.bountyLevel || "Contrato",
              rotation: stage,
              chance: i.chance,
            });
          }
        });
      }
    });
  });
}

function processRelicDatabase(rawData, activeDropsSet) {
  state.allRelicNames = [];
  state.relicsDatabase = {};
  state.itemsDatabase = {};
  state.relicStatusDB = {};

  const ducatMap = {};
  if (state.ducatsDatabase) {
    Object.values(state.ducatsDatabase).forEach(item => {
      const normalized = item.name.toLowerCase().trim();
      ducatMap[normalized] = item.ducats;
    });
  }

  if (!rawData.relics) return;

  rawData.relics.forEach((r) => {
    if (r.state !== "Intact") return;

    const rName = r.relicName || r.name;
    if (!rName || !r.tier) return;

    const tierName = `${r.tier} ${rName}`;
    state.allRelicNames.push(tierName);

    state.relicsDatabase[tierName] = r.rewards.map((rw) => {
      const normalized = rw.itemName.toLowerCase().trim();
      return {
        name: rw.itemName,
        chance: rw.chance,
        rarity: rw.rarity,
        ducats: ducatMap[normalized] || 0
      };
    });

    r.rewards.forEach((rw) => {
      const normalized = rw.itemName.toLowerCase().trim();
      if (!state.itemsDatabase[rw.itemName])
        state.itemsDatabase[rw.itemName] = [];
      state.itemsDatabase[rw.itemName].push({
        relic: tierName,
        tier: r.tier,
        chance: rw.chance,
        ducats: ducatMap[normalized] || 0
      });
    });

    const isAya = state.activeResurgenceList.has(tierName.toUpperCase());
    const dropsInGame = activeDropsSet.has(`${tierName} Relic`);

    if (isAya) state.relicStatusDB[tierName] = "aya";
    else if (r.tier === "Requiem" || dropsInGame)
      state.relicStatusDB[tierName] = "active";
    else state.relicStatusDB[tierName] = "vaulted";
  });

  state.allRelicNames.sort();
}
function isRelicUnvaulted(tier, name, allData) {
  const searchString = `${tier} ${name} Relic`;
  let isFound = false;

  for (const planet in allData.missionRewards) {
    for (const node in allData.missionRewards[planet]) {
      const rotations = allData.missionRewards[planet][node].rewards;
      for (const rot in rotations) {
        if (rotations[rot].some((item) => item.itemName === searchString)) {
          return true;
        }
      }
    }
  }

  const bountyFiles = [
    allData.cetusBountyRewards,
    allData.solarisBountyRewards,
    allData.zarimanRewards,
  ];

  for (const bountyFile of bountyFiles) {
    if (!bountyFile) continue;
    for (const bounty of bountyFile) {
      for (const stage in bounty.rewards) {
        if (
          bounty.rewards[stage].some((item) => item.itemName === searchString)
        ) {
          return true;
        }
      }
    }
  }

  return isFound;
}

export function addToQueue(itemName, element) {
  const slug = getSlug(itemName);
  getPriceValue(itemName, slug).then((price) => {
    if (globalThis.updatePriceUI) globalThis.updatePriceUI(element, price);
  });
}
const DB_NAME = "VoidStonksDB_V1";
const STORE_NAME = "bigData";

const dbHelper = {
  dbInstance: null,

  open: () => {
    return new Promise((resolve, reject) => {
      if (dbHelper.dbInstance) {
        return resolve(dbHelper.dbInstance);
      }

      const request = indexedDB.open(DB_NAME, 1);

      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };

      request.onsuccess = (e) => {
        const db = e.target.result;
        dbHelper.dbInstance = db;

        db.onversionchange = () => {
          db.close();
          dbHelper.dbInstance = null;
          console.log(
            "Base de datos cerrada automáticamente para permitir actualización.",
          );
        };

        resolve(db);
      };

      request.onerror = (e) => {
        console.warn("Error abriendo DB:", e.target.error);
        reject(e.target.error);
      };

      request.onblocked = () => {
        console.warn(
          "Base de datos bloqueada. Cerrando conexiones antiguas...",
        );
      };
    });
  },

  get: async (key) => {
    try {
      const db = await dbHelper.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    } catch (e) {
      console.warn("Error DB Get", e);
      return null;
    }
  },

  set: async (key, value) => {
    try {
      const db = await dbHelper.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        const req = store.put(value, key);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch (e) {
      console.warn("Error DB Set", e);
    }
  },

  delete: async (key) => {
    try {
      const db = await dbHelper.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        store.delete(key);
        tx.oncomplete = () => resolve();
      });
    } catch (e) {
      console.warn("Error DB Delete", e);
    }
  },
};
export async function initializeOCRDatabase() {
  try {
    const res = await fetch(`${WORKER_URL}?type=prime_items_list`);
    if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);

    const data = await res.json();
    state.ocrReferenceList = data.items;
  } catch (e) {
    console.error("Error detallado al cargar referencia OCR:", e);
    throw e;
  }
}

function checkIsOptimal(key, info) {
  return OPTIMAL_FILTERS.some((f) => {
    const fac = !f.factions || f.factions.includes(key);
    const typ = !f.types || f.types.includes(info.techType);
    const tie = !f.tiers || f.tiers.includes(info.tier);
    const cha =
      !f.challenges || f.challenges.some((c) => info.uName.includes(c));
    return fac && typ && tie && cha;
  });
}
function getTier(index, isNarmer, isLich) {
  if (isNarmer) return "NARMER";
  if (isLich) return "CODA";
  return index + 1;
}
function getTechType(uName, nodeKey) {
  const chall = uName.toLowerCase();
  if (chall.includes("mobdef")) return "Mobile Defense";
  if (chall.includes("exterminate")) return "Exterminate";
  if (chall.includes("cascade")) return "Void Cascade";
  if (chall.includes("armageddon")) return "Void Armageddon";
  if (chall.includes("flood")) return "Void Flood";
  if (chall.includes("capture")) return "Capture";
  if (chall.includes("defense")) return "Defense";
  return NODE_TO_TYPE[nodeKey] || "Bounty";
}
function extractJobInfo(job, source, faction, oracleJob = null, index = 0) {
  const uName = oracleJob?.challenge || job.uniqueName || job.jobType || "";
  const nodeKey = oracleJob?.node || job.node || "";
  const allyKey = oracleJob?.ally?.split("/").pop() || null;

  const isLich =
    uName.toLowerCase().includes("lich") ||
    uName.toLowerCase().includes("coda");
  const isNarmer =
    uName.toLowerCase().includes("narmer") ||
    job.type?.toLowerCase().includes("narmer");

  const tier = getTier(index, isNarmer, isLich);
  const techType = getTechType(uName, nodeKey);
  const missionName = getMissionName(
    job,
    techType,
    faction,
    isLich,
    nodeKey,
    allyKey,
  );

  const challengeKey = Object.keys(CHALLENGE_MAP).find((k) =>
    uName.includes(k),
  );
  const condition = challengeKey
    ? CHALLENGE_MAP[challengeKey]
    : job.description || "";

  return {
    min: job.enemyLevels?.[0] || job.minEnemyLevel || job.minLevel || 0,
    max: job.enemyLevels?.[1] || job.maxEnemyLevel || job.maxLevel || 0,
    name:
      missionName === "Bounty"
        ? isNarmer
          ? missionName
          : `Bounty Tier ${tier}`
        : missionName,
    techType,
    condition,
    uName,
    tier,
    hideTier: techType === "Excavation" || job.isVault,
    isLich,
  };
}
function getMissionName(job, techType, faction, isLich, nodeKey, allyKey) {
  if (faction === "The Hex") {
    if (isLich) return "Coda bounty/ antivirus";
    if (techType === "Capture") return "Capture Antivirus";
    const allyName = ALLY_MAP[allyKey];
    if (allyName) return `${allyName}'s Bounty (${techType})`;
  }
  if (NODE_MAP[nodeKey]) return `${techType} (${NODE_MAP[nodeKey]})`;
  return job.type || job.title || techType;
}
function formatDropItem(d) {
  return { name: d.name, chance: (d.chance || 0) * 100 };
}

function processStageRewards(stage, simple) {
  const drops = (Array.isArray(stage) ? stage : [])
    .map(formatDropItem)
    .sort((a, b) => b.chance - a.chance);
  drops.forEach((d) => simple.push(d.name));
  return drops;
}

function processJobRewards(job, ttSyn) {
  let detailed = null;
  const initial = Array.isArray(job.rewardPool) ? job.rewardPool : [];
  let simple = [...initial];
  if (ttSyn?.jobs) {
    const minLvl = job.minLevel || job.minEnemyLevel || job.enemyLevels?.[0];
    const match = ttSyn.jobs.find(
      (tj) => (tj.minLevel || tj.minEnemyLevel) === minLvl,
    );
    if (Array.isArray(match?.rewards)) {
      simple = [];
      detailed = match.rewards.map((stage, i) => {
        const drops = processStageRewards(stage, simple);
        return { stage: i + 1, drops };
      });
    }
  }
  return { simple: [...new Set(simple)], detailed };
}

function calculateStandingXp(arr) {
  if (!Array.isArray(arr)) return 0;
  return arr.reduce((a, b) => a + (Number(b) || 0), 0);
}

export async function fetchActiveBounties() {
  const CACHE_KEY = "active_bounties_cache";
  try {
    const cached = await dbHelper.get(CACHE_KEY);
    const now = Date.now();

    if (cached && cached.expiryTime > now) {
      return cached.data;
    }

    const res = await fetch(`${WORKER_URL}?type=active_bounties`);
    if (!res.ok) return [];

    const rawData = await res.json();
    const { ws = [], tt = [], oracle = {} } = rawData;

    const realExpiry = oracle.expiry
      ? new Date(Number(oracle.expiry)).toISOString()
      : new Date(now + 600000).toISOString();

    const allMissions = [];
    const factionMap = [
      {
        key: "Ostrons",
        ttId: "696e78a80000000000000010",
        wsMatch: "Ostron",
        wsId: "CetusSyndicate",
      },
      {
        key: "The Holdfasts",
        ttId: "ZarimanSyndicate",
        wsMatch: "Holdfasts",
        wsId: "ZarimanSyndicate",
      },
      {
        key: "Cavia",
        ttId: "CaviaSyndicate",
        wsMatch: "Cavia",
        wsId: "EntratiLabSyndicate",
      },
      {
        key: "The Hex",
        ttId: "HexSyndicate",
        wsMatch: "Hex",
        wsId: "HexSyndicate",
      },
      {
        key: "Entrati",
        ttId: "696e78a80000000000000002",
        wsMatch: "Entrati",
        wsId: "EntratiSyndicate",
      },
      {
        key: "Solaris United",
        ttId: "696e78a80000000000000031",
        wsMatch: "Solaris",
        wsId: "SolarisSyndicate",
      },
    ];

    factionMap.forEach(({ key, ttId, wsMatch, wsId }) => {
      const wsSyn = ws.find((s) =>
        (s.syndicate || s.syndicateKey || "")
          .toLowerCase()
          .includes(wsMatch.toLowerCase()),
      );
      const ttSyn = tt.find(
        (t) =>
          t.id === ttId || (t.syndicate || "").startsWith(key.substring(0, 4)),
      );
      const sourceFromTt = ttSyn ? "tt" : "none";
      const source = wsSyn?.jobs && wsSyn.jobs.length > 0 ? "ws" : sourceFromTt;
      if (source === "none") return;

      const jobs = source === "ws" ? wsSyn.jobs : ttSyn.jobs;
      const oracleData = oracle.bounties?.[wsId] || [];

      const useOracleAsLeader = source === "tt" && oracleData.length > 0;
      const jobsToProcess = useOracleAsLeader ? oracleData : jobs;

      jobsToProcess.forEach((item, idx) => {
        const oracleJob = useOracleAsLeader ? item : oracleData[idx];
        const j = useOracleAsLeader ? jobs[idx] || jobs[jobs.length - 1] : item;

        const info = extractJobInfo(j, source, key, oracleJob, idx);
        const rewards = processJobRewards(j, ttSyn);
        const isDual = DUAL_PATH_FACTIONS.has(key);

        const numericTier =
          info.tier === "NARMER" || info.isLich
            ? 6
            : Number.parseInt(info.tier) || 1;

        let sNorm = 0;
        let sSP = 0;

        if (key === "The Hex") {
          sNorm = numericTier * 1000;
          sSP = sNorm + 500;
        } else if (key === "The Holdfasts") {
          const tIdx = Math.min(numericTier, 5);
          sNorm = (ZARIMAN_DATA.counts.normal[tIdx] || 0) * ZARIMAN_DATA.value;
          sSP = (ZARIMAN_DATA.counts.sp[tIdx] || 0) * ZARIMAN_DATA.value;
          if (info.uName.includes("VoidAngel")) {
            sNorm += 2500;
            sSP += 2500;
          }
        } else {
          sNorm = calculateStandingXp(j.standingStages || j.xpAmounts);
          sSP = Math.round(sNorm * 1.5);
        }

        allMissions.push({
          factionKey: key,
          type: info.name,
          technicalType: info.techType,
          tier: info.tier,
          hideTier: info.hideTier,
          standing: sNorm,
          standingSP: sSP,
          level: `${info.min}-${info.max}`,
          levelSP: `${info.min + 100}-${info.max + 100}`,
          rewards: rewards.simple,
          detailedRewards: rewards.detailed,
          expiry: realExpiry,
          isDual: isDual,
          isSP: !isDual && (j.isHard || info.min >= 100),
          condition: info.condition,
          uName: info.uName,
          isOptimal: checkIsOptimal(key, info),
        });
      });
    });

    allMissions.sort((a, b) => b.standing - a.standing);

    const serverExpiry = oracle.expiry ? Number(oracle.expiry) : now + 600000;

    await dbHelper.set(CACHE_KEY, {
      expiryTime: serverExpiry,
      data: allMissions,
    });

    return allMissions;
  } catch (e) {
    console.error("Error fetching active bounties:", e);
    return [];
  }
}
