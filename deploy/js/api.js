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
  // Si ya tenemos datos, no hacemos nada
  if (state.allRivenNames && state.allRivenNames.length > 0) return;

  console.log("Iniciando carga de armas..."); // LOG DE DEBUG

  try {
    const response = await fetch(`${WORKER_URL}?type=weapons_list`);

    if (!response.ok) throw new Error("Error en petición al Worker");

    const data = await response.json();
    console.log("Datos recibidos del Worker:", data); // LOG DE DEBUG

    // Si el worker devuelve array vacío, forzamos error para usar el fallback
    if (!data.weapons || data.weapons.length === 0) {
      throw new Error("El Worker devolvió una lista vacía");
    }

    state.allRivenNames = data.weapons;

    // Crear mapa para búsqueda rápida
    state.weaponMap = {};
    state.allRivenNames.forEach(
      (w) => (state.weaponMap[w.toUpperCase()] = true)
    );

    console.log(`✅ ÉXITO: Cargadas ${state.allRivenNames.length} armas.`);
  } catch (error) {
    console.error("❌ ERROR cargando armas:", error);

    // FALLBACK: Lista de emergencia si todo falla
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

    // 1. Mirar en RAM
    if (MEMORY_CACHE.has(itemSlug)) {
      const cached = MEMORY_CACHE.get(itemSlug);
      if (cached > 0) {
        // Solo devolver si es mayor a 0
        resolve(cached);
        return;
      }
    }

    // 2. Mirar en LocalStorage
    const stored = localStorage.getItem(`price_${itemSlug}`);
    if (stored) {
      const { val, time } = JSON.parse(stored);
      // VALIDACIÓN: Si vale 0, lo ignoramos para forzar una nueva búsqueda.
      // Si tiene más de 4 horas, también lo ignoramos.
      if (val > 0 && Date.now() - time < 14400000) {
        MEMORY_CACHE.set(itemSlug, val);
        resolve(val);
        return;
      }
    }

    // 3. Cola de peticiones
    PRICE_QUEUE.push({ slug: itemSlug, resolve });
    // Importante: Asegúrate de que processPriceQueue esté definida en el archivo (como te pasé antes)
    // No usamos isQueueRunning aquí si processPriceQueue se llama recursivamente,
    // pero si usas el código anterior, mantén la lógica de la cola.
    if (typeof isQueueRunning !== "undefined" && !isQueueRunning)
      processPriceQueue();
    else if (typeof isQueueRunning === "undefined") processPriceQueue();
  });
}

export async function downloadRelics() {
  const loadEl = document.getElementById("loading");
  if (loadEl) loadEl.style.display = "flex";

  const CACHE_KEY = "voidstonks_relics_v6";
  const CACHE_TIME = 7 * 24 * 60 * 60 * 1000;

  let rawData = null;
  const localData = localStorage.getItem(CACHE_KEY);

  if (localData) {
    try {
      const parsed = JSON.parse(localData);
      if (Date.now() - parsed.timestamp < CACHE_TIME) {
        rawData = parsed.data;
      }
    } catch (e) {
      localStorage.removeItem(CACHE_KEY);
    }
  }

  try {
    if (!rawData) {
      const response = await fetch(`${WORKER_URL}?type=relics`);
      if (!response.ok) throw new Error("Worker Error");
      rawData = await response.json();
      localStorage.setItem(
        CACHE_KEY,
        JSON.stringify({ timestamp: Date.now(), data: rawData })
      );
    }

    try {
      await fetchActiveResurgence();
    } catch (e) {
      console.warn("Aya error", e);
    }

    state.allRelicNames = [];
    state.relicsDatabase = {};
    state.itemsDatabase = {};
    rawData.relics.forEach((r) => {
      if (r.state === "Intact") {
        const rName = r.relicName || r.name;
        const tierName = `${r.tier} ${rName}`;
        if (!rName || !r.tier) return;
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
        state.relicStatusDB[tierName] = isAya
          ? "aya"
          : r.vaulted
          ? "vaulted"
          : "active";
      }
    });

    state.allRelicNames.sort();
    finishLoading();
  } catch (e) {
    console.error("Error downloadRelics:", e);
    showToast("Error cargando base de datos. Recarga.");
  }
}

// [En api.js] - Reemplaza la función processPriceQueue existente por esta:

async function processPriceQueue() {
  // 1. Si la cola está vacía, paramos
  if (PRICE_QUEUE.length === 0) {
    isQueueRunning = false;
    return;
  }

  isQueueRunning = true;

  // 2. Tomamos SOLO UN elemento (importante para que tu Worker no falle)
  const task = PRICE_QUEUE.shift();

  try {
    // 3. Petición GET individual con "truco" para limpiar caché (&v=CACHE_FIX)
    const targetUrl = `${WORKER_URL}?type=price&q=${task.slug}&v=CACHE_FIX`;

    const res = await fetch(targetUrl);

    let price = 0;
    if (res.ok) {
      const data = await res.json();
      // Soportamos todos los formatos posibles de respuesta
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

    // 4. Guardamos el precio y actualizamos la pantalla (resolve)
    savePriceToCache(task.slug, price);
    task.resolve(price);
  } catch (e) {
    console.warn(`Error obteniendo precio para ${task.slug}:`, e);
    task.resolve(0); // Si falla, liberamos la tarea con 0 para no atascar la cola
  }

  // 5. Pausa de seguridad (300ms) y procesamos el siguiente
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
