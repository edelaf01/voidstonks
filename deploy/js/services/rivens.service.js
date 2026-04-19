import { WORKER_URL } from "../config.js";
import { state } from "../state.js";
import { dbHelper } from "../repositories/storage.repository.js";
import { getRivenSlug } from "./slugs.service.js";

/**
 * Loads weapon database, updates state.weaponMap and state.allRivenNames.
 */
export async function fetchRivenWeapons() {
    const CACHE_KEY = "voidstonkscache_weapons_v3";
    const ONE_DAY = 24 * 60 * 60 * 1000;
    try {
        const cached = await dbHelper.get(CACHE_KEY);
        if (cached?.data && cached?.timestamp && (Date.now() - cached.timestamp < ONE_DAY)) {
            state.weaponMap = cached.data;
        }
        const res = await fetch("assets/json/cleaned_weapons.json");
        if (!res.ok) throw new Error("Failed weapons.json");
        const data = await res.json();
        state.weaponDetailsDB = data;
        state.weaponMap = {};
        data.forEach((item) => {
            state.weaponMap[item.name] = {
                d: Number.parseFloat(item.omegaAttenuation || 1),
                t: item.type || "Rifle",
            };
        });
        state.allRivenNames = Object.keys(state.weaponMap).sort((a, b) => a.localeCompare(b));
        dbHelper.set(CACHE_KEY, { timestamp: Date.now(), data: state.weaponMap });
        
        const { updateDucatsDB } = await import("./relics.service.js");
        updateDucatsDB(data);
    } catch (e) {
        console.error("Error weapons local:", e);
    }
}

/**
 * Computes median, min, and max from a sorted price array, displays them, and persists to cache.
 */
async function computeAndDisplayPrices(prices, cacheKey) {
    const subset = prices.slice(0, 20);
    const mid = Math.floor(subset.length / 2);
    const median = subset.length % 2 === 0
        ? (subset[mid - 1] + subset[mid]) / 2
        : subset[mid];
    const priceVal = Math.round(median);
    const minVal = prices[0];
    const maxVal = prices[prices.length - 1];

    const valSpan = document.getElementById("riven-avg-value");
    const minSpan = document.getElementById("riven-min-value");
    const maxSpan = document.getElementById("riven-max-value");

    if (valSpan) valSpan.innerText = priceVal;
    if (minSpan) minSpan.innerText = minVal;
    if (maxSpan) maxSpan.innerText = maxVal;

    await dbHelper.set(cacheKey, { val: priceVal, min: minVal, max: maxVal, time: Date.now() });
}

/**
 * Fetches the riven auction median price.
 * @param {string} weaponName
 */
export async function fetchRivenAverage(weaponName) {
    if (!weaponName) return;
    const slug = getRivenSlug(weaponName);
    const cacheKey = `riven_avg_${slug}`;
    const CACHE_TTL = 6 * 60 * 60 * 1000;
    const box = document.getElementById("riven-avg-box");
    const valSpan = document.getElementById("riven-avg-value");
    const minSpan = document.getElementById("riven-min-value");
    const maxSpan = document.getElementById("riven-max-value");

    if (box) box.style.display = "block";
    if (valSpan) valSpan.innerText = "...";
    if (minSpan) minSpan.innerText = "...";
    if (maxSpan) maxSpan.innerText = "...";

    try {
        const cached = await dbHelper.get(cacheKey);
        if (cached && (Date.now() - cached.time < CACHE_TTL)) {
            if (valSpan) valSpan.innerText = Math.round(cached.val);
            if (minSpan && cached.min != null) minSpan.innerText = cached.min;
            if (maxSpan && cached.max != null) maxSpan.innerText = cached.max;
            return;
        }
        const res = await fetch(`${WORKER_URL}?type=riven&q=${slug}`);
        if (!res.ok) throw new Error("Worker Error");
        const data = await res.json();
        const prices = (data.payload?.auctions || [])
            .filter((a) => a.visible && a.buyout_price > 0 && a.owner.status !== "offline")
            .map((a) => a.buyout_price)
            .sort((a, b) => a - b);

        if (prices.length > 0) {
            await computeAndDisplayPrices(prices, cacheKey);
        } else {
            if (valSpan) valSpan.innerText = "N/A";
            if (minSpan) minSpan.innerText = "N/A";
            if (maxSpan) maxSpan.innerText = "N/A";
        }
    } catch {
        if (valSpan) valSpan.innerText = "?";
        if (minSpan) minSpan.innerText = "?";
        if (maxSpan) maxSpan.innerText = "?";
    }
}
