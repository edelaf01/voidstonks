import { state } from "../state.js";
import { TEXTS } from "../config.js";
import { escapeHTML } from "./escape_html.js";

const RELIC_RE = /\b(Lith|Meso|Neo|Axi|Requiem)\s+([A-Z]\d+|I{1,3}|IV)\b/i;
const TAP_SLOP = 10;

let initialized = false;

export function parseRelicName(raw) {
  if (typeof raw !== "string") return null;
  const m = raw.match(RELIC_RE);
  if (!m) return null;
  const era = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
  const code = m[2].toUpperCase();
  const canonical = `${era} ${code}`;
  const db = state.relicsDatabase;
  if (!db || typeof db !== "object") return null;
  if (Object.hasOwn(db, canonical) || Object.hasOwn(db, `${canonical} Relic`)) return canonical;
  return null;
}

export function resolveWeaponName(raw) {
  if (typeof raw !== "string") return null;
  const needle = raw.trim();
  const map = state.weaponMap;
  if (!needle || !map || typeof map !== "object") return null;
  if (Object.hasOwn(map, needle)) return needle;
  const lower = needle.toLowerCase();
  for (const key of Object.keys(map)) {
    if (key.toLowerCase() === lower) return key;
  }
  return null;
}

export function farmLinkHtml(label, kind = "auto") {
  let resolvedKind = null;
  let target = null;
  if (kind === "relic" || kind === "auto") {
    target = parseRelicName(label);
    if (target) resolvedKind = "relic";
  }
  if (!target && (kind === "weapon" || kind === "auto")) {
    target = resolveWeaponName(label);
    if (target) resolvedKind = "weapon";
  }
  if (!target) return escapeHTML(label);
  const texts = TEXTS[state.currentLang]?.farmLinks || TEXTS.en.farmLinks;
  const title = resolvedKind === "relic" ? texts.openRelic : texts.openRiven;
  const extraAttrs =
    resolvedKind === "relic"
      ? ` data-tooltip-relic="${escapeHTML(target)}" aria-label="${escapeHTML(`${title}: ${label}`)}"`
      : ` title="${escapeHTML(title)}"`;
  return `<button type="button" class="farm-link" data-farm-kind="${resolvedKind}" data-farm-target="${escapeHTML(target)}"${extraAttrs}>${escapeHTML(label)}</button>`;
}

export function initFarmLinks() {
  if (initialized) return;
  initialized = true;
  let down = null;
  document.addEventListener("pointerdown", (e) => {
    down = { x: e.clientX, y: e.clientY };
  }, true);
  document.addEventListener("click", (e) => {
    const start = down;
    down = null;
    const el = e.target?.closest ? e.target : e.target?.parentElement;
    const btn = el?.closest?.("[data-farm-kind][data-farm-target]");
    if (!btn) return;
    if (start && e.pointerType !== "" && Math.hypot(e.clientX - start.x, e.clientY - start.y) > TAP_SLOP) return;
    if (globalThis.getSelection?.()?.toString()) return;
    const kind = btn.dataset.farmKind;
    const target = btn.dataset.farmTarget;
    const tab = kind === "relic" ? "relic" : kind === "weapon" ? "riven" : null;
    if (!tab || !target) return;
    e.preventDefault();
    e.stopPropagation();
    const tip = document.getElementById("global-tooltip");
    if (tip) {
      tip.classList.add("hidden");
      tip.classList.remove("mega-mode");
    }
    globalThis.navegarA?.({ tab, ctx: target });
  });
}
