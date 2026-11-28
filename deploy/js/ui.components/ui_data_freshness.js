import { state } from "../state.js";
import { TEXTS } from "../config.js";
import { ensurePriceSnapshot, getSnapshotAge } from "../services/market/prices.service.js";
import { ensureArcanePricesUpdated, getArcanePricesAge } from "./ui_vosfor.js?v=3.0";

const PRICES_WARN_MS = 12 * 60 * 60 * 1000;
const ARCANE_WARN_MS = 172800000;
const REFRESH_MS = 60 * 1000;

let initialized = false;

function formatAge(ageMs, t) {
  if (ageMs < 3600000) {
    const mins = Math.max(1, Math.floor(ageMs / 60000));
    return (t.dataFreshMin || "{n} min").replace("{n}", String(mins));
  }
  if (ageMs < 86400000) {
    const hours = Math.floor(ageMs / 3600000);
    return (t.dataFreshHour || "{n} h").replace("{n}", String(hours));
  }
  const days = Math.floor(ageMs / 86400000);
  return (t.dataFreshDay || "{n} d").replace("{n}", String(days));
}

export function getFreshnessInfo() {
  const pricesAge = getSnapshotAge();
  const arcaneAge = getArcanePricesAge();
  const ages = [pricesAge, arcaneAge].filter((a) => a !== null);
  if (!ages.length) return null;
  const oldest = Math.max(...ages);
  const t = TEXTS[state.currentLang] || TEXTS.es;
  const text = (t.dataFresh || "Datos: hace {n}").replace("{n}", formatAge(oldest, t));
  const warn = (pricesAge !== null && pricesAge > PRICES_WARN_MS) || (arcaneAge !== null && arcaneAge > ARCANE_WARN_MS);
  return { text, warn };
}

export function renderDataFreshness() {
  const chip = document.getElementById("data-freshness-chip");
  if (!chip) return;
  const info = getFreshnessInfo();
  if (!info) {
    chip.classList.add("hidden");
    chip.classList.remove("data-fresh-chip--warn");
    chip.textContent = "";
    return;
  }
  chip.textContent = info.text;
  chip.classList.toggle("data-fresh-chip--warn", info.warn);
  chip.classList.remove("hidden");
}

export function initDataFreshness() {
  if (initialized) return;
  initialized = true;
  renderDataFreshness();
  state.subscribe("currentLang", renderDataFreshness);
  ensurePriceSnapshot().then(renderDataFreshness).catch(() => {});
  ensureArcanePricesUpdated().then(renderDataFreshness).catch(() => {});
  setInterval(renderDataFreshness, REFRESH_MS);
}
