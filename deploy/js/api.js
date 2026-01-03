import { WORKER_URL, WEAPON_SOURCES, TEXTS } from "./config.js";
import { state } from "./state.js";
import {
  updatePriceUI,
  showToast,
  renderProfileStats,
  calculateCaps,
  finishLoading,
  getRivenSlug,
  getSlug,
} from "./ui.js";
const PRICE_QUEUE = [];
const REQUEST_QUEUE = [];
let isQueueRunning = false;
const MEMORY_CACHE = new Map();
let isProcessingQueue = false;
const PRICE_CACHE = new Map();
// --- RELIC DATA ---

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
  state.allRelicNames = Array.from(tempNamesSet).sort();
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
            if (item.ItemType && item.ItemType.includes("Projections")) {
              const rawName = item.ItemType.split("/").pop();
              let tier = "";
              if (rawName.startsWith("T1")) tier = "Lith";
              else if (rawName.startsWith("T2")) tier = "Meso";
              else if (rawName.startsWith("T3")) tier = "Neo";
              else if (rawName.startsWith("T4")) tier = "Axi";
              else if (rawName.startsWith("T5")) tier = "Requiem";

              let code = rawName.replace(/T\d+VoidProjection/, "");
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

// --- RIVENS ---

export async function fetchRivenWeapons() {
  if (state.allRivenNames && state.allRivenNames.length > 0) return;

  //console.log("Iniciando carga de armas...");

  try {
    const response = await fetch(`${WORKER_URL}?type=weapons_list`);

    if (!response.ok) throw new Error("Error en petición al Worker");

    const data = await response.json();
    //console.log("Datos recibidos del Worker:", data);

    if (!data.weapons || data.weapons.length === 0) {
      throw new Error("El Worker devolvió una lista vacía");
    }

    state.allRivenNames = data.weapons;

    state.weaponMap = {};
    state.allRivenNames.forEach(
      (w) => (state.weaponMap[w.toUpperCase()] = true)
    );

    //console.log(`✅ ÉXITO: Cargadas ${state.allRivenNames.length} armas.`);
  } catch (error) {
    // console.error("❌ ERROR cargando armas:", error);

    state.allRivenNames = [
      "Bramma Kuva",
      "Nikana Prime",
      "Rubico Prime",
      "Torid",
      "Burston",
      "Glaive Prime",
      "Felarx",
      "Laetum",
      "Phenmor",
      "Lex Prime",
      "Magistar",
    ];
    console.log("⚠️ Usando lista de respaldo manual.");
  }
}
export async function fetchRivenAverage(weaponName) {
  if (!weaponName) return;
  let slug = getRivenSlug(weaponName);
  const box = document.getElementById("riven-avg-box");
  const valSpan = document.getElementById("riven-avg-value");
  if (box) box.style.display = "block";
  if (valSpan) valSpan.innerText = "...";

  try {
    const res = await fetch(`${WORKER_URL}?type=riven&q=${slug}`);
    if (!res.ok) throw new Error("Worker Error");
    const data = await res.json();
    const auctions = data.payload?.auctions || [];
    const prices = auctions
      .filter(
        (a) => a.visible && a.buyout_price > 0 && a.owner.status !== "offline"
      )
      .map((a) => a.buyout_price)
      .sort((a, b) => a - b);

    if (prices.length > 0) {
      const subset = prices.slice(0, 20);
      const mid = Math.floor(subset.length / 2);
      const median =
        subset.length % 2 !== 0
          ? subset[mid]
          : (subset[mid - 1] + subset[mid]) / 2;
      if (valSpan) valSpan.innerText = Math.round(median);
    } else {
      if (valSpan) valSpan.innerText = "N/A";
    }
  } catch (e) {
    if (valSpan) valSpan.innerText = "?";
  }
}

async function processQueue() {
  if (isProcessingQueue || REQUEST_QUEUE.length === 0) return;
  isProcessingQueue = true;
  while (REQUEST_QUEUE.length > 0) {
    const task = REQUEST_QUEUE.shift();
    const price = await getPriceValue(task.name, task.slug);
    updatePriceUI(task.el, price);
    await new Promise((r) => setTimeout(r, 50));
  }
  isProcessingQueue = false;
}

export async function fetchBestFissures() {
  try {
    const res = await fetch(`${WORKER_URL}?type=fissures`);
    if (!res.ok) throw new Error("Error al conectar con el Worldstate");

    const fissures = await res.json();
    const now = new Date();
    const fastMissions = ["Capture", "Extermination", "Rescue", "Void Cascade"];
    return fissures.reduce((acc, f) => {
      const isValidType =
        (fastMissions.includes(f.missionType) || f.tier === "Omnia") &&
        !f.isStorm;
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
        username
      )}`
    );
    if (!res.ok) throw new Error("Worker Error");
    const data = await res.json();
    if (data.error) {
      showToast(TEXTS[state.currentLang].errProfileNotFound);
      return;
    }
    renderProfileStats(data.payload);
  } catch (e) {
    showToast(TEXTS[state.currentLang].errProfileFetch);
  }
}

export function getPriceValue(itemName, itemSlug) {
  return new Promise((resolve) => {
    if (
      !itemName ||
      itemName.includes("Forma") ||
      itemName.includes("Kuva") ||
      itemName === "Riven Sliver" ||
      itemName === "Exilus Weapon Adapter Blueprint"
    ) {
      resolve(0);
      return;
    }
    if (!itemSlug) {
      resolve(0);
      return;
    }

    if (MEMORY_CACHE.has(itemSlug)) {
      const cached = MEMORY_CACHE.get(itemSlug);
      if (cached > 0) {
        resolve(cached);
        return;
      }
    }

    const stored = localStorage.getItem(`price_${itemSlug}`);
    if (stored) {
      const { val, time } = JSON.parse(stored);

      if (val > 0 && Date.now() - time < 14400000) {
        MEMORY_CACHE.set(itemSlug, val);
        resolve(val);
        return;
      }
    }

    PRICE_QUEUE.push({ slug: itemSlug, resolve });

    if (typeof isQueueRunning !== "undefined" && !isQueueRunning)
      processPriceQueue();
    else if (typeof isQueueRunning === "undefined") processPriceQueue();
  });
}

export async function downloadRelics() {
  const loadEl = document.getElementById("loading");
  if (loadEl) loadEl.style.display = "flex";

  const CACHE_KEY = "voidstonks_full_data_v3";
  const CACHE_TIME = 48 * 60 * 60 * 1000; // 48 Horas

  let rawData = null;

  // 1. INTENTAR CARGAR DE INDEXEDDB
  try {
    const cachedRecord = await dbHelper.get(CACHE_KEY);
    if (cachedRecord) {
      if (Date.now() - cachedRecord.timestamp < CACHE_TIME) {
        rawData = cachedRecord.data;
        console.log("Cargando datos masivos desde IndexedDB.");
      } else {
        console.log("Caché expirada.");
        await dbHelper.delete(CACHE_KEY);
      }
    }
  } catch (e) {
    console.warn("Error leyendo IndexedDB:", e);
  }

  // 2. SI NO HAY CACHÉ, DESCARGAR DEL WORKER
  try {
    if (!rawData) {
      const response = await fetch(`${WORKER_URL}?type=allData`);
      if (!response.ok) throw new Error("Worker Error al bajar allData");

      rawData = await response.json();

      try {
        await dbHelper.set(CACHE_KEY, { timestamp: Date.now(), data: rawData });
        console.log("Datos guardados en IndexedDB correctamente.");
      } catch (dbError) {
        console.error("No se pudo guardar en DB:", dbError);
      }
    }

    try {
      await fetchActiveResurgence();
    } catch (e) {
      console.warn("Aya error (fetchActiveResurgence)", e);
    }

    const activeDropsSet = new Set();
    state.relicSourcesDatabase = {}; 

    const cleanRelicName = (name) => name.replace(" Relic", "").trim();

    const addSource = (relicFull, sourceData) => {
      const name = cleanRelicName(relicFull);
      if (!state.relicSourcesDatabase[name]) {
        state.relicSourcesDatabase[name] = [];
      }
      state.relicSourcesDatabase[name].push(sourceData);
    };

    if (rawData.missionRewards) {
      for (const planet in rawData.missionRewards) {
        for (const node in rawData.missionRewards[planet]) {
          const nodeData = rawData.missionRewards[planet][node];

          if (nodeData.rewards) {
            Object.keys(nodeData.rewards).forEach((rot) => {
              const pool = nodeData.rewards[rot];
              if (Array.isArray(pool)) {
                pool.forEach((item) => {
                  if (item.itemName && item.itemName.includes("Relic")) {
                    activeDropsSet.add(item.itemName);

                    addSource(item.itemName, {
                      type: "mission",
                      location: `${node} (${planet})`,
                      mission: nodeData.gameMode,
                      rotation: rot,
                      chance: item.chance,
                    });
                  }
                });
              }
            });
          }
        }
      }
    }

    const bountySources = [
      { data: rawData.cetusBountyRewards, name: "Cetus" },
      { data: rawData.solarisBountyRewards, name: "Fortuna" },
      { data: rawData.zarimanRewards, name: "Zariman" },
      { data: rawData.deimosRewards, name: "Necralisk (Deimos)" },
    ];

    bountySources.forEach((source) => {
      if (Array.isArray(source.data)) {
        source.data.forEach((bounty) => {
          if (bounty.rewards) {
            Object.keys(bounty.rewards).forEach((stageKey) => {
              const pool = bounty.rewards[stageKey];
              if (Array.isArray(pool)) {
                pool.forEach((item) => {
                  if (item.itemName && item.itemName.includes("Relic")) {
                    activeDropsSet.add(item.itemName);

                    addSource(item.itemName, {
                      type: "bounty",
                      location: `${source.name} Bounty`,
                      mission: bounty.bountyLevel || "Contrato",
                      rotation: stageKey,
                      chance: item.chance,
                    });
                  }
                });
              }
            });
          }
        });
      }
    });

    Object.keys(state.relicSourcesDatabase).forEach((key) => {
      state.relicSourcesDatabase[key].sort((a, b) => b.chance - a.chance);
    });

    state.allRelicNames = [];
    state.relicsDatabase = {};
    state.itemsDatabase = {};

    const relicsList = rawData.relics || [];

    relicsList.forEach((r) => {
      if (r.state === "Intact") {
        const rName = r.relicName || r.name;
        if (!rName || !r.tier) return;

        const tierName = `${r.tier} ${rName}`;
        const fullNameRelic = `${tierName} Relic`;

        state.allRelicNames.push(tierName);

        state.relicsDatabase[tierName] = r.rewards.map((reward) => ({
          name: reward.itemName,
          chance: reward.chance,
          rarity: reward.rarity,
        }));

        r.rewards.forEach((reward) => {
          const iName = reward.itemName;
          if (!state.itemsDatabase[iName]) state.itemsDatabase[iName] = [];
          state.itemsDatabase[iName].push({
            relic: tierName,
            tier: r.tier,
            chance: reward.chance,
          });
        });

        const isAya = state.activeResurgenceList.has(tierName.toUpperCase());
        const dropsInGame = activeDropsSet.has(fullNameRelic);
        const isRequiem = r.tier === "Requiem";

        if (isAya) {
          state.relicStatusDB[tierName] = "aya";
        } else if (isRequiem || dropsInGame) {
          state.relicStatusDB[tierName] = "active";
        } else {
          state.relicStatusDB[tierName] = "vaulted";
        }
      }
    });

    state.allRelicNames.sort();
    finishLoading();
  } catch (e) {
    console.error("Error downloadRelics:", e);
    showToast("Error cargando datos. Intenta recargar.");
  }
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

async function processPriceQueue() {
  if (PRICE_QUEUE.length === 0) {
    isQueueRunning = false;
    return;
  }

  isQueueRunning = true;

  const task = PRICE_QUEUE.shift();

  try {
    const targetUrl = `${WORKER_URL}?type=price&q=${task.slug}&v=CACHE_FIX`;

    const res = await fetch(targetUrl);

    let price = 0;
    if (res.ok) {
      const data = await res.json();
      if (typeof data === "number") {
        price = data;
      } else if (data.price) {
        price = data.price;
      } else if (
        data.payload &&
        data.payload.orders &&
        data.payload.orders.length > 0
      ) {
        price = data.payload.orders[0].platinum;
      }
    }

    savePriceToCache(task.slug, price);
    task.resolve(price);
  } catch (e) {
    console.warn(`Error obteniendo precio para ${task.slug}:`, e);
    task.resolve(0);
  }

  setTimeout(() => processPriceQueue(), 300);
}
function savePriceToCache(slug, price) {
  const data = { val: price, time: Date.now() };
  MEMORY_CACHE.set(slug, price);
  try {
    localStorage.setItem(`price_${slug}`, JSON.stringify(data));
  } catch (e) {}
}

/*async function fetchPriceFromWorker(slug) {
  try {
    const res = await fetch(`${WORKER_URL}?type=price&q=${slug}`);

    if (res.status === 429) return 0; // Rate Limit
    if (!res.ok) return 0;

    const data = await res.json();

    // Leer formato optimizado del Worker
    if (typeof data.price === "number") return data.price;

    // Fallback formato antiguo
    if (data.payload?.orders?.length > 0)
      return data.payload.orders[0].platinum;

    return 0;
  } catch (e) {
    return 0;
  }
}*/
export function addToQueue(itemName, element) {
  const slug = getSlug(itemName);
  getPriceValue(itemName, slug).then((price) => {
    updatePriceUI(element, price);
  });
}
const DB_NAME = "VoidStonksDB";
const STORE_NAME = "bigData";

const dbHelper = {
  open: () => {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },
  get: async (key) => {
    const db = await dbHelper.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },
  set: async (key, value) => {
    const db = await dbHelper.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(value, key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  },
  delete: async (key) => {
    const db = await dbHelper.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      store.delete(key);
      tx.oncomplete = () => resolve();
    });
  },
};
