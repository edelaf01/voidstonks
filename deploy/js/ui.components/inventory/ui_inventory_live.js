import { state } from "../../state.js";
import { TEXTS } from "../../config.js";
import { getSlug } from "../../utils/slugs.utils.js";
import { getSetName } from "../../utils/ui_utils.js";
import { exposeGlobals } from "../../utils/global_registry.js";

let liveHooked = false;

const liveSeen = new Map();
const staleSeen = new Map();

let staleFilterOn = false;

let repainting = false;

export async function initLivePrices() {
  if (liveHooked) return;
  liveHooked = true;

  try {
    const { startLivePrices, onLivePrice, onStalePrice } =
      await import("../../services/market/wfm_live_prices.service.js");

    onLivePrice(({ slug, plat }) => paintLivePrice(slug, plat));
    onStalePrice(({ slug, diff }) => paintStale(slug, diff));

    if (await startLivePrices()) {
      refreshStaleChip();
    } else {
      liveHooked = false;
    }
  } catch {
    liveHooked = false;
  }
}

function paintLivePrice(slug, plat) {
  liveSeen.set(slug, plat);
  for (const badge of document.querySelectorAll(".price-badge-small[data-item]")) {
    if (getSlug(badge.dataset.item) !== slug) continue;

    let tag = badge.parentElement?.querySelector(".price-live-tag");
    if (!tag) {
      tag = document.createElement("span");
      tag.className = "price-live-tag";
      badge.after(tag);
    }
    tag.textContent = `${plat}p`;
    tag.title = TEXTS[state.currentLang].liveNowTitle || "";

    // restart animation on existing node, or a new price on the same item goes unnoticed
    tag.classList.remove("is-fresh");
    void tag.offsetWidth;
    tag.classList.add("is-fresh");
  }

  paintLiveSetHeader(slug);
}

function paintStale(slug, diff) {
  staleSeen.set(slug, diff);
  const t = TEXTS[state.currentLang];
  const up = diff > 0;
  const pct = Math.round(Math.abs(diff) * 100);

  for (const badge of document.querySelectorAll(".price-badge-small[data-item]")) {
    if (getSlug(badge.dataset.item) !== slug) continue;

    const row = badge.closest(".inv-row-mini") || badge.parentElement;
    row?.classList.add("is-price-stale");

    let tag = row?.querySelector(".price-stale-tag");
    if (!tag) {
      tag = document.createElement("span");
      tag.className = "price-stale-tag";
      badge.after(tag);
    }
    tag.textContent = `${up ? "▲" : "▼"}${pct}%`;
    tag.classList.toggle("is-up", up);
    tag.title = (up ? t.staleUpTitle : t.staleDownTitle) || "";
  }

  if (!repainting) refreshStaleChip();
}

export function toggleStaleFilter() {
  staleFilterOn = !staleFilterOn;
  applyStaleFilter();
}

function applyStaleFilter() {
  const on = staleFilterOn;
  document.getElementById("inv-stale-chip")?.classList.toggle("is-active", on);

  for (const row of document.querySelectorAll(".inv-row-mini")) {
    row.style.display = (on && !row.classList.contains("is-price-stale")) ? "none" : "";
  }

  for (const group of document.querySelectorAll(".inv-set-group")) {
    const hasStale = group.querySelector(".is-price-stale");
    group.style.display = (on && !hasStale) ? "none" : "";
    if (on && hasStale) group.classList.remove("collapsed");
  }
}

export function repaintLivePrices() {
  repainting = true;
  try {
    for (const [slug, plat] of liveSeen) paintLivePrice(slug, plat);
    for (const [slug, diff] of staleSeen) paintStale(slug, diff);
  } finally {
    repainting = false;
  }
  applyStaleFilter();
  refreshStaleChip();
}

function refreshStaleChip() {
  const chip = document.getElementById("inv-stale-chip");
  if (!chip) return;

  const t = TEXTS[state.currentLang];
  const n = document.querySelectorAll(".is-price-stale").length;

  chip.style.display = "";
  chip.classList.toggle("is-empty", n === 0);
  chip.disabled = n === 0;

  const count = chip.querySelector(".inv-chip-count");
  if (count) count.textContent = String(n);

  const label = document.getElementById("inv-stale-label");
  if (label) label.textContent = (n === 0 ? t.staleChipWatching : t.staleChip) || label.textContent;

  chip.title = (n === 0 ? t.staleChipWatchingTitle : t.staleChipTitle) || "";
}

function paintLiveSetHeader(slug) {
  const setName = Object.keys(state.primeInventory || {})
    .find(name => getSlug(name) === slug);
  if (!setName) return;

  const safeSetId = getSetName(setName).replaceAll(/[^a-zA-Z0-9]/g, "");
  const header = document.getElementById(`set-price-${safeSetId}`)?.parentElement;
  if (!header) return;

  let dot = header.querySelector(".set-live-dot");
  if (!dot) {
    dot = document.createElement("span");
    dot.className = "set-live-dot";
    dot.title = TEXTS[state.currentLang].liveNowTitle || "";
    header.appendChild(dot);
  }
  dot.classList.remove("is-fresh");
  void dot.offsetWidth;
  dot.classList.add("is-fresh");
}

exposeGlobals({ toggleStaleFilter }, "ui.components/inventory/ui_inventory_live.js");
