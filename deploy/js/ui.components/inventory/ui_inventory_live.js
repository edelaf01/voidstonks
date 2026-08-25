import { state } from "../../state.js";
import { TEXTS } from "../../config.js";
import { getSlug } from "../../utils/slugs.utils.js";
import { getSetName } from "../../utils/ui_utils.js";
import { exposeGlobals } from "../../utils/global_registry.js";

/**
 * Live prices painted over the rendered inventory, on the existing DOM: a price burst can bring dozens
 * of slugs, and repainting on each lost the scroll and the open sections.
 */

let liveHooked = false;

/**
 * Seen in the stream, by slug, so any inventory repaint can restore the marks and the filter.
 */
const liveSeen = new Map();   // slug -> plat
const staleSeen = new Map();  // slug -> diff

/**
 * Filter state in a variable, not the chip class, so it reapplies after a repaint.
 */
let staleFilterOn = false;

/** True while repaintLivePrices rebuilds the marks: one chip count instead of N. */
let repainting = false;

/**
 * Turns on the inventory live prices. The WFM stream only brings ~3.4% of the catalog every 3 minutes:
 * it refines the items that pass by while the tab is open. The base price (prices_batch median) still
 * rules.
 */
export async function initLivePrices() {
  if (liveHooked) return;
  liveHooked = true;

  try {
    const { startLivePrices, onLivePrice, onStalePrice } =
      await import("../../services/market/wfm_live_prices.service.js");

    onLivePrice(({ slug, plat }) => paintLivePrice(slug, plat));
    onStalePrice(({ slug, diff }) => paintStale(slug, diff));

    if (await startLivePrices()) {
      // the chip shows right away as "watching": deviations trickle in
      refreshStaleChip();
    } else {
      liveHooked = false; // no inventory or no socket: retried
    }
  } catch {
    liveHooked = false; // live prices are an extra: a failure does not break the inventory
  }
}

/**
 * Marks the price just seen on the market next to the base price, not over it: the base is a median of
 * the 5 cheapest, this is one listing.
 */
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

    // restart the animation even on an existing node, or a new price on the same item goes unnoticed
    tag.classList.remove("is-fresh");
    void tag.offsetWidth;
    tag.classList.add("is-fresh");
  }

  paintLiveSetHeader(slug);
}

/**
 * Flags that the saved price no longer matches the market. The arrow shows the direction: up means the
 * item is worth more than the app says (you would sell cheap).
 */
function paintStale(slug, diff) {
  staleSeen.set(slug, diff);
  const t = TEXTS[state.currentLang];
  const up = diff > 0;
  const pct = Math.round(Math.abs(diff) * 100);

  for (const badge of document.querySelectorAll(".price-badge-small[data-item]")) {
    if (getSlug(badge.dataset.item) !== slug) continue;

    // the whole row, so the filter chip can select it
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

/**
 * Shows only the items whose price contradicts the market, or all again. Filters the painted DOM
 * instead of repainting.
 */
export function toggleStaleFilter() {
  staleFilterOn = !staleFilterOn;
  applyStaleFilter();
}

/**
 * Hides what is not flagged when the filter is on. Idempotent: safe after every repaint.
 */
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

/**
 * Puts back over the freshly painted inventory what the stream already showed. Called by
 * renderPrimeInventory at the end.
 */
export function repaintLivePrices() {
  // paintStale refreshes the chip on every slug: one count at the end instead
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

  // visible whenever watching is on, even with no deviations, so you can tell it works
  chip.style.display = "";
  chip.classList.toggle("is-empty", n === 0);
  chip.disabled = n === 0;

  const count = chip.querySelector(".inv-chip-count");
  if (count) count.textContent = String(n);

  // the HTML holds the Spanish text; set to the active language here
  const label = document.getElementById("inv-stale-label");
  if (label) label.textContent = (n === 0 ? t.staleChipWatching : t.staleChip) || label.textContent;

  chip.title = (n === 0 ? t.staleChipWatchingTitle : t.staleChipTitle) || "";
}

/**
 * Marks the set header when one of its parts has a fresh price. Only a flag, not a figure: adding one
 * listing to a median subtotal would mean nothing.
 */
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

// index.html calls toggleStaleFilter with an inline onclick
exposeGlobals({ toggleStaleFilter }, "ui.components/inventory/ui_inventory_live.js");
