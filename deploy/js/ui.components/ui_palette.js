import { state, TABS } from "../state.js";
import { TEXTS, TIER_URLS } from "../config.js";
import { buildSearchIndex, searchIndex } from "../utils/fuzzy_search.js";

const MAX_PER_KIND = 6;
const EMPTY_TABS_SHOWN = 9;
const THRESHOLD = 0.5;
const RECENTS_KEY = "vs:palette:recientes";
const MAX_RECENTS = 6;
const VALID_KINDS = new Set(["tab", "relic", "set", "riven"]);

let veil = null;
let input = null;
let list = null;
let hint = null;
let trigger = null;
let results = [];
let active = 0;
let lastFocus = null;
let indexes = { relic: null, set: null, riven: null };
let signatures = {};

const t = () => (TEXTS[state.currentLang] || TEXTS.es).palette || TEXTS.es.palette;

function esEditable(el) {
  return !!el?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
}

function slugIconPath(name) {
  const slug = String(name).toLowerCase().trim().replaceAll(/\s+/g, "_").replaceAll(/[^a-z0-9_]/g, "");
  return `assets/relic_contents/${slug}.webp`;
}

function resultIcon(r) {
  if (r.kind === "tab") {
    const src = document.getElementById(`btn-${r.id}`)?.querySelector("img.tab-icon-img")?.getAttribute("src");
    return src ? { src, fallback: null } : null;
  }
  if (r.kind === "relic") {
    const first = String(r.id).trim().split(/\s+/)[0] || "";
    const tier = first ? first[0].toUpperCase() + first.slice(1).toLowerCase() : "";
    return { src: TIER_URLS[tier] || "assets/relic.webp", fallback: "assets/relic.webp" };
  }
  if (r.kind === "set") {
    return { src: slugIconPath(r.id), fallback: "assets/mod.svg" };
  }
  if (r.kind === "riven") {
    return { src: slugIconPath(r.id), fallback: "assets/riven.webp" };
  }
  return null;
}

function buildThumb(r) {
  const wrap = document.createElement("span");
  wrap.className = "palette-opt-thumb";
  wrap.setAttribute("aria-hidden", "true");
  const icon = resultIcon(r);
  if (icon) {
    const img = document.createElement("img");
    img.className = "palette-opt-img";
    img.loading = "lazy";
    img.decoding = "async";
    img.alt = "";
    img.onerror = () => {
      img.onerror = null;
      if (icon.fallback && img.getAttribute("src") !== icon.fallback) {
        img.src = icon.fallback;
      } else {
        img.remove();
      }
    };
    img.src = icon.src;
    wrap.appendChild(img);
  }
  return wrap;
}

function tabLabel(id) {
  const btn = document.getElementById(`btn-${id}`);
  if (!btn || btn.closest("[hidden]")) return null;
  const clone = btn.cloneNode(true);
  clone.querySelectorAll(".tab-wip-badge").forEach((n) => n.remove());
  return clone.textContent.replace(/\s+/g, " ").trim() || null;
}

function tabItems() {
  const out = [];
  for (const id of TABS) {
    const label = tabLabel(id);
    if (label) out.push({ kind: "tab", id, label });
  }
  return out;
}

function cached(kind, signature, build) {
  if (signatures[kind] !== signature || !indexes[kind]) {
    signatures[kind] = signature;
    indexes[kind] = buildSearchIndex(build(), { key: "label" });
  }
  return indexes[kind];
}

function relicIndex() {
  const names = state.allRelicNames || [];
  return cached("relic", `${names.length}`, () => names.map((n) => ({ kind: "relic", id: n, label: n })));
}

function setIndex() {
  const map = state.setDePieza;
  const names = map ? [...new Set(Object.values(map).map((n) => String(n).replace(/\s+Set$/, "")))] : [];
  return cached("set", `${names.length}`, () => names.map((n) => ({ kind: "set", id: n, label: n })));
}

function rivenIndex() {
  const names = state.allRivenNames || [];
  return cached("riven", `${names.length}`, () => names.map((n) => ({ kind: "riven", id: n, label: n })));
}

function readRecents() {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set();
    const out = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const { kind, id, label } = item;
      if (!VALID_KINDS.has(kind) || typeof id !== "string" || !id || typeof label !== "string" || !label) continue;
      const key = `${kind}\0${id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ kind, id, label });
      if (out.length >= MAX_RECENTS) break;
    }
    return out;
  } catch {
    return [];
  }
}

function recordRecent(r) {
  if (!r || !VALID_KINDS.has(r.kind) || !r.id || !r.label) return;
  const entry = { kind: r.kind, id: String(r.id), label: String(r.label) };
  const next = [entry, ...readRecents().filter((x) => !(x.kind === entry.kind && x.id === entry.id))].slice(0, MAX_RECENTS);
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {}
}

function compute(query) {
  const q = query.trim();
  const tabs = tabItems();
  if (!q) {
    const tabMap = new Map(tabs.map((tab) => [tab.id, tab]));
    const recents = readRecents().map((r) => ({
      ...r,
      label: r.kind === "tab" && tabMap.has(r.id) ? tabMap.get(r.id).label : r.label,
      recent: true,
    }));
    const recentTabs = new Set(recents.filter((r) => r.kind === "tab").map((r) => r.id));
    const restTabs = tabs.filter((tab) => !recentTabs.has(tab.id)).slice(0, EMPTY_TABS_SHOWN);
    return [...recents, ...restTabs].slice(0, EMPTY_TABS_SHOWN + MAX_RECENTS);
  }
  const take = (index) => searchIndex(q, index, { limit: MAX_PER_KIND, threshold: THRESHOLD }).map((h) => h.item);
  return [
    ...take(buildSearchIndex(tabs, { key: "label" })),
    ...take(relicIndex()),
    ...take(setIndex()),
    ...take(rivenIndex()),
  ];
}

function kindLabel(kind) {
  const p = t();
  return { tab: p.kindTab, relic: p.kindRelic, set: p.kindSet, riven: p.kindRiven }[kind];
}

function sectionHeader(label) {
  const li = document.createElement("li");
  li.className = "palette-section";
  li.setAttribute("role", "presentation");
  li.textContent = label;
  return li;
}

function render() {
  list.textContent = "";
  if (!results.length) {
    const li = document.createElement("li");
    li.className = "palette-empty";
    li.textContent = t().empty;
    list.appendChild(li);
    input.removeAttribute("aria-activedescendant");
    return;
  }
  const p = t();
  const hasRecents = Boolean(results[0]?.recent);
  let tabHeaderShown = false;
  if (hasRecents) list.appendChild(sectionHeader(p.recents));
  results.forEach((r, i) => {
    if (hasRecents && !r.recent && !tabHeaderShown) {
      tabHeaderShown = true;
      list.appendChild(sectionHeader(p.tabs));
    }
    const li = document.createElement("li");
    li.id = `palette-opt-${i}`;
    li.className = "palette-opt";
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", String(i === active));
    const thumb = buildThumb(r);
    const name = document.createElement("span");
    name.className = "palette-opt-name";
    name.textContent = r.label;
    const tag = document.createElement("span");
    tag.className = `palette-opt-kind palette-kind-${r.kind}`;
    tag.textContent = kindLabel(r.kind);
    li.append(thumb, name, tag);
    li.addEventListener("pointermove", () => { if (active !== i) setActive(i, false); });
    li.addEventListener("click", () => choose(i));
    list.appendChild(li);
  });
  input.setAttribute("aria-activedescendant", `palette-opt-${active}`);
}

function setActive(i, scroll = true) {
  if (!results.length) return;
  active = (i + results.length) % results.length;
  list.querySelectorAll(".palette-opt").forEach((el, idx) => el.setAttribute("aria-selected", String(idx === active)));
  input.setAttribute("aria-activedescendant", `palette-opt-${active}`);
  if (scroll) document.getElementById(`palette-opt-${active}`)?.scrollIntoView({ block: "nearest" });
}

function refresh() {
  results = compute(input.value);
  active = 0;
  render();
}

function build() {
  veil = document.createElement("div");
  veil.className = "palette-veil hidden";
  veil.innerHTML = `
    <div class="palette" role="dialog" aria-modal="true">
      <input class="palette-input" type="text" role="combobox" aria-expanded="true" aria-controls="palette-list"
        aria-autocomplete="list" autocomplete="off" autocapitalize="off" spellcheck="false" />
      <ul id="palette-list" class="palette-list" role="listbox"></ul>
      <div class="palette-hint"></div>
    </div>`;
  document.body.appendChild(veil);
  input = veil.querySelector(".palette-input");
  list = veil.querySelector(".palette-list");
  hint = veil.querySelector(".palette-hint");
  veil.addEventListener("pointerdown", (e) => { if (e.target === veil) close(); });
  input.addEventListener("input", refresh);
  veil.addEventListener("keydown", onKeydown);
}

function applyTriggerTexts() {
  if (!trigger) return;
  const label = t().triggerLabel || t().title;
  trigger.setAttribute("aria-label", label);
  trigger.title = label;
}

function applyTexts() {
  const p = t();
  veil.querySelector(".palette").setAttribute("aria-label", p.title);
  input.placeholder = p.placeholder;
  input.setAttribute("aria-label", p.title);
  list.setAttribute("aria-label", p.title);
  hint.textContent = p.hint;
}

function onKeydown(e) {
  if (e.key === "Escape") {
    e.preventDefault();
    close();
  } else if (e.key === "ArrowDown") {
    e.preventDefault();
    setActive(active + 1);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    setActive(active - 1);
  } else if (e.key === "Home" && results.length) {
    e.preventDefault();
    setActive(0);
  } else if (e.key === "End" && results.length) {
    e.preventDefault();
    setActive(results.length - 1);
  } else if (e.key === "Enter") {
    if (e.isComposing) return;
    e.preventDefault();
    choose(active);
  } else if (e.key === "Tab") {
    e.preventDefault();
    input.focus();
  }
}

export function openPalette() {
  if (!veil) build();
  if (!veil.classList.contains("hidden")) return;
  lastFocus = document.activeElement;
  applyTexts();
  input.value = "";
  veil.classList.remove("hidden");
  document.body.classList.add("palette-open");
  refresh();
  list.scrollTop = 0;
  input.focus();
}

export function closePalette() {
  close();
}

function close(restore = true) {
  if (!veil || veil.classList.contains("hidden")) return;
  veil.classList.add("hidden");
  document.body.classList.remove("palette-open");
  if (restore && lastFocus?.isConnected) lastFocus.focus?.();
  lastFocus = null;
}

function choose(i) {
  const r = results[i];
  if (!r) return;
  recordRecent(r);
  close(false);
  if (r.kind === "tab") {
    globalThis.navegarA?.({ tab: r.id });
  } else if (r.kind === "relic" || r.kind === "set" || r.kind === "riven") {
    globalThis.navegarA?.({ tab: r.kind, ctx: r.id });
  }
}

export function initPalette() {
  trigger = document.getElementById("btn-palette-trigger");
  if (trigger) {
    applyTriggerTexts();
    trigger.addEventListener("click", () => openPalette());
  }
  state.subscribe("currentLang", () => {
    applyTriggerTexts();
    if (veil && !veil.classList.contains("hidden")) {
      applyTexts();
      refresh();
    }
  });
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
      e.preventDefault();
      if (veil && !veil.classList.contains("hidden")) close();
      else openPalette();
      return;
    }
    if (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey && !e.defaultPrevented) {
      if (esEditable(e.target) || (veil && !veil.classList.contains("hidden"))) return;
      e.preventDefault();
      openPalette();
    }
  });
}
