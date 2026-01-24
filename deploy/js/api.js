import { WORKER_URL, TEXTS } from "./config.js";
import { state } from "./state.js";

const MEMORY_CACHE = new Map();
const PENDING_REQUESTS = new Map(); 
let activeRequests = 0;
const MAX_CONCURRENT = 5; 

export function getSlug(itemName) {
  if (!itemName) return "";
  let cleanName = itemName.trim().replace(/&/g, "and");
  let slug = cleanName
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .trim()
    .replace(/\s+/g, "_");
  const manualFixes = { kompressa_prime_receiver: "kompressa_prime_reciever" };
  return manualFixes[slug] || slug;
}

export function getRivenSlug(inputVal) {
  let s = inputVal.toLowerCase().trim().replace(/\s+/g, "_");
  const prefixes = ["coda_", "kuva_", "tenet_", "mk1_", "prisma_", "dex_"];
  const suffixes = ["_prime", "_vandal", "_wraith"];
  for (let pre of prefixes) if (s.startsWith(pre)) s = s.replace(pre, "");
  for (let suf of suffixes) if (s.endsWith(suf)) s = s.replace(suf, "");
  return s;
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

export async function fetchRivenWeapons() {
  const CACHE_KEY = "voidstonkscache_fix_v1";
  try {
    const cached = await dbHelper.get(CACHE_KEY);

    if (cached && cached.data && Object.keys(cached.data).length > 100) {
      console.log(
        ` Armas cargadas de caché: ${Object.keys(cached.data).length}`
      );
      state.weaponMap = cached.data;
      state.allRivenNames = Object.keys(state.weaponMap).sort();
      return;
    }

    console.log("⬇️ Descargando armas desde el Worker...");
    const res = await fetch(`${WORKER_URL}?type=weapons_list`);
    const data = await res.json();

    console.log("📦 [LOG]: Datos crudos recibidos del Worker:", data);
    let rawWeapons = data.weapons || data;
    let finalMap = {};

    if (typeof rawWeapons === "object" && !Array.isArray(rawWeapons)) {

      Object.keys(rawWeapons).forEach((name) => {
        const item = rawWeapons[name];

        const realDispo = item.omegaAttenuation || item.d || 1.0;
        const realType = item.type || item.t || "Rifle";

        finalMap[name] = {
          d: parseFloat(realDispo),
          t: realType,
        };
      });
    } else if (Array.isArray(rawWeapons)) {
      rawWeapons.forEach((item) => {
        const name = item.name || item;
        finalMap[name] = {
          d: parseFloat(item.omegaAttenuation || item.d || 1.0),
          t: item.type || item.t || "Rifle",
        };
      });
    }

    if (Object.keys(finalMap).length === 0)
      throw new Error("Mapa de armas vacío");

    state.weaponMap = finalMap;
    state.allRivenNames = Object.keys(state.weaponMap).sort();

    console.log(` ÉXITO: ${state.allRivenNames.length} armas listas.`);

    await dbHelper.set(CACHE_KEY, {
      timestamp: Date.now(),
      data: state.weaponMap,
    });
  } catch (e) {
    //console.error(" Error recuperando armas:", e);
    state.allRivenNames = [];
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
  batchTimer = null;

  // Sacamos todos los slugs únicos que están esperando
  const slugsToFetch = Array.from(PENDING_REQUESTS.keys());
  if (slugsToFetch.length === 0) return;

  // Limpiamos la cola actual para permitir nuevas peticiones mientras procesamos estas
  // (Clonamos el mapa actual para procesarlo y reseteamos el global)
  const currentBatch = new Map(PENDING_REQUESTS);
  PENDING_REQUESTS.clear();

  try {
    
    // Llamamos a TU Worker al endpoint 'prices_batch'
    const url = `${WORKER_URL}?type=prices_batch&q=${slugsToFetch.join(",")}`;
    const res = await fetch(url);
    const data = await res.json(); // Tu worker devuelve { "chroma_prime_set": 120, ... }

    // Procesamos resultados
    slugsToFetch.forEach((slug) => {
      const price = data[slug] || 0; // Si no viene, asumimos 0
      
      // A. Guardar en Caché
      if (price > 0) {
        MEMORY_CACHE.set(slug, price);
        localStorage.setItem(`price_${slug}`, JSON.stringify({
          val: price,
          time: Date.now()
        }));
      }

      // B. Resolver todas las promesas que esperaban este ítem
      const resolvers = currentBatch.get(slug);
      if (resolvers) {
        resolvers.forEach((resolveFunc) => resolveFunc(price));
      }
    });

  } catch (err) {
    console.error("Batch fetch failed:", err);
    // En caso de error, resolvemos todo a 0 para no bloquear la app
    currentBatch.forEach((resolvers) => {
      resolvers.forEach((resolveFunc) => resolveFunc(0));
    });
  }
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
      if (window.showToast)
        window.showToast(TEXTS[state.currentLang].errProfileNotFound);
      return;
    }
    if (window.renderProfileStats) window.renderProfileStats(data.payload);
  } catch (e) {
    showToast(TEXTS[state.currentLang].errProfileFetch);
  }
}
const PRICE_CACHE_DURATION = 4 * 60 * 60 * 1000;




let batchTimer = null;

const CACHE_TTL = 1440; 

export function getPriceValue(itemName, itemSlug) {
  return new Promise((resolve) => {
    if (
      !itemName || !itemSlug ||
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

    const stored = localStorage.getItem(`price_${itemSlug}`);
    if (stored) {
      try {
        const { val, time } = JSON.parse(stored);
        if (val >= 0 && Date.now() - time < CACHE_TTL) {
          MEMORY_CACHE.set(itemSlug, val);
          resolve(val);
          return;
        }
      } catch (e) {
        localStorage.removeItem(`price_${itemSlug}`);
      }
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

export async function downloadRelics() {
  const loadEl = document.getElementById("loading");
  if (loadEl) loadEl.style.display = "flex";

  const CACHE_KEY = "voidstonks_weapons_v6_full_data";
  const CACHE_TIME = 48 * 60 * 60 * 1000;

  let rawData = null;

  try {
    try {
      const cachedRecord = await dbHelper.get(CACHE_KEY);
      if (cachedRecord && Date.now() - cachedRecord.timestamp < CACHE_TIME) {
        rawData = cachedRecord.data;
        console.log("Cargando desde caché local.");
      }
    } catch (e) {
      console.warn("Cache local ignorada:", e);
    }

    if (!rawData) {
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

      rawData = {
        relics: rData.relics || [],
        missionRewards: mData.missionRewards || {},
        cetusBountyRewards: bData.cetus || [],
        solarisBountyRewards: bData.solaris || [],
        zarimanRewards: bData.zariman || [],
        deimosRewards: bData.deimos || [],
      };

      await dbHelper.set(CACHE_KEY, { timestamp: Date.now(), data: rawData });
    }

    fetchActiveResurgence().catch(console.warn);

    const activeDropsSet = new Set();
    state.relicSourcesDatabase = {};

    const cleanRelicName = (name) => name.replace(" Relic", "").trim();
    const addSource = (relicFull, sourceData) => {
      const name = cleanRelicName(relicFull);
      if (!state.relicSourcesDatabase[name])
        state.relicSourcesDatabase[name] = [];
      state.relicSourcesDatabase[name].push(sourceData);
    };

    if (rawData.missionRewards) {
      for (const planet in rawData.missionRewards) {
        for (const node in rawData.missionRewards[planet]) {
          const d = rawData.missionRewards[planet][node];
          if (d.rewards) {
            for (const rot in d.rewards) {
              const rewardsList = d.rewards[rot];
              if (!Array.isArray(rewardsList)) continue;

              rewardsList.forEach((i) => {
                if (i.itemName && i.itemName.includes("Relic")) {
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
    }

    const bountySources = [
      { data: rawData.cetusBountyRewards, name: "Cetus" },
      { data: rawData.solarisBountyRewards, name: "Fortuna" },
      { data: rawData.zarimanRewards, name: "Zariman" },
      { data: rawData.deimosRewards, name: "Deimos" },
    ];

    bountySources.forEach((src) => {
      if (Array.isArray(src.data)) {
        src.data.forEach((b) => {
          if (b.rewards) {
            for (const stage in b.rewards) {
              const rewardsList = b.rewards[stage];
              if (!Array.isArray(rewardsList)) continue;

              rewardsList.forEach((i) => {
                if (i.itemName && i.itemName.includes("Relic")) {
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
          }
        });
      }
    });

    state.allRelicNames = [];
    state.relicsDatabase = {};
    state.itemsDatabase = {};
    state.relicStatusDB = {};

    if (rawData.relics) {
      rawData.relics.forEach((r) => {
        if (r.state !== "Intact") return;

        const rName = r.relicName || r.name;
        if (!rName || !r.tier) return;

        const tierName = `${r.tier} ${rName}`;
        state.allRelicNames.push(tierName);

        state.relicsDatabase[tierName] = r.rewards.map((rw) => ({
          name: rw.itemName,
          chance: rw.chance,
          rarity: rw.rarity,
        }));

        r.rewards.forEach((rw) => {
          if (!state.itemsDatabase[rw.itemName])
            state.itemsDatabase[rw.itemName] = [];
          state.itemsDatabase[rw.itemName].push({
            relic: tierName,
            tier: r.tier,
            chance: rw.chance,
          });
        });

        const isAya = state.activeResurgenceList.has(tierName.toUpperCase());
        const dropsInGame = activeDropsSet.has(`${tierName} Relic`);

        if (isAya) state.relicStatusDB[tierName] = "aya";
        else if (r.tier === "Requiem" || dropsInGame)
          state.relicStatusDB[tierName] = "active";
        else state.relicStatusDB[tierName] = "vaulted";
      });
    }

    state.allRelicNames.sort();
    if (window.finishLoading) window.finishLoading();
  } catch (e) {
    console.error("Error crítico descarga:", e);
    showToast("Error de datos. Recarga la página.");
    if (loadEl) loadEl.style.display = "none";
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

    if (res.status === 429) return 0;
    if (!res.ok) return 0;

    const data = await res.json();

    if (typeof data.price === "number") return data.price;

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
    if (window.updatePriceUI) window.updatePriceUI(element, price);
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
            "Base de datos cerrada automáticamente para permitir actualización."
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
          "Base de datos bloqueada. Cerrando conexiones antiguas..."
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
    const data = await res.json();
    state.ocrReferenceList = data.items;
    console.log("DB de Referencia OCR cargada:", state.ocrReferenceList.length);
  } catch (e) {
    console.error("Fallo al cargar referencia OCR");
  }
}
