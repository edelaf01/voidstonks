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

// Cola de peticiones
const REQUEST_QUEUE = [];
let isProcessingQueue = false;

// --- RELIC DATA ---
export async function downloadRelics() {
  const loadEl = document.getElementById("loading");
  if (loadEl) loadEl.style.display = "flex";

  await fetchActiveResurgence();

  const CACHE_KEY = "voidstonks_relics_v1";
  const CACHE_TIME = 30 * 24 * 60 * 60 * 1000;

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
      try {
        localStorage.setItem(
          CACHE_KEY,
          JSON.stringify({ timestamp: Date.now(), data: rawData })
        );
      } catch (e) {}
    }

    processRelicData(rawData);
    finishLoading();
  } catch (error) {
    console.error(error);
    showToast(TEXTS[state.currentLang].errLoad);
    if (loadEl) loadEl.style.display = "none";
  }
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

    let status = "vaulted";
    if (state.activeResurgenceList.has(cleanNameUpper)) status = "aya";
    else status = "active";

    tempStatusDB[fullName] = status;

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
  try {
    const responses = await Promise.all(
      WEAPON_SOURCES.map((url) => fetch(url).then((r) => r.json()))
    );
    const allWeapons = responses.flat();

    const unique = new Set();
    allWeapons.forEach((item) => {
      if (item.name) unique.add(item.name);
    });
    state.allRivenNames = Array.from(unique).sort();

    state.allRivenNames.forEach((name) => {
      state.weaponMap[name] = getRivenSlug(name);
    });
  } catch (e) {
    console.warn("Riven list failed", e);
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

// --- PRICES ---
export async function getPriceValue(itemName, slug) {
  if (!itemName || itemName === "Forma Blueprint") return 0;
  try {
    const res = await fetch(`${WORKER_URL}?type=price&q=${slug}`);
    if (!res.ok) throw new Error("Worker Error");
    const data = await res.json();
    const realData = data.payload ? data.payload : data;
    const sells = realData.orders || realData.data?.sell || [];
    const active = sells.filter(
      (o) => o.user.status === "ingame" || o.user.status === "online"
    );
    active.sort((a, b) => a.platinum - b.platinum);
    return active.length > 0 ? active[0].platinum : 0;
  } catch (e) {
    return 0;
  }
}

export async function addToQueue(itemName, element) {
  if (!itemName || itemName === "Forma Blueprint") return;
  const slug = getSlug(itemName);
  REQUEST_QUEUE.push({ name: itemName, slug: slug, el: element });
  processQueue();
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
// --- WORLDSTATE FISSURES ---

export async function fetchBestFissures() {
  try {
    const res = await fetch(`${WORKER_URL}?type=fissures`);
    if (!res.ok) throw new Error("Error al conectar con el Worldstate");

    const fissures = await res.json();
    const now = new Date();

    // Tipos de misión eficientes
    const fastMissions = ["Capture", "Extermination", "Rescue", "Void Cascade"];

    return fissures
      .filter(
        (f) =>
          (fastMissions.includes(f.missionType) || f.tier === "Omnia") &&
          !f.isStorm
      )
      .map((f) => {
        const expiryDate = new Date(f.expiry);
        const diffMs = expiryDate - now;
        const diffMins = Math.round(diffMs / 60000);

        let timeText = f.eta;
        if (diffMins > 0) {
          timeText =
            diffMins > 60
              ? `${Math.floor(diffMins / 60)}h ${diffMins % 60}m`
              : `${diffMins}m`;
        }

        return {
          node: f.node,
          type: f.missionType,
          tier: f.tier,
          eta: timeText,
          isSP: f.isHard === true,
          isOmnia: f.tier === "Omnia",
        };
      });
  } catch (e) {
    console.error("Error en Worldstate:", e);
    return [];
  }
}
// --- PROFILE ---
export async function fetchUserProfile() {
  const username = document.getElementById("usernameInput").value.trim();
  if (!username) return alert("Please enter username");
  const container = document.getElementById("profile-data");
  container.innerHTML =
    '<div class="price-badge loading" style="width:100%">Loading...</div>';

  try {
    const res = await fetch(
      `${WORKER_URL}?type=profile&q=${encodeURIComponent(username)}`
    );
    if (!res.ok) throw new Error("API Blocked");
    const data = await res.json();
    if (data && typeof data.masteryRank !== "undefined") {
      document.getElementById("mrInput").value = data.masteryRank;
      renderProfileStats(
        data.masteryRank,
        data.dailyFocus || 0,
        data.dailyStanding || {}
      );
    } else {
      throw new Error("Invalid Data");
    }
  } catch (e) {
    container.innerHTML =
      '<div style="color:orange;font-size:0.9em;padding:10px;">Perfil no encontrado.<br>Usando calculadora.</div>';
    calculateCaps();
  }
}
