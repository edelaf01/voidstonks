// moves tabs that do not fit in the bar into a fan menu over a veil

const MIN_TAB_PX = 104;

const MOBILE_MAX_TABS = 4;
const MOBILE_BREAKPOINT = 768;

const LONG_PRESS_MS = 220;

let fanEl = null;
let overlayEl = null;
let moreBtn = null;
let tabsEl = null;
let isOpen = false;
let longPressTimer = null;
let dragMode = false;
let pointerMoved = false;
let highlightedItem = null;
let reflowing = false;
let suppressClick = false;
// tap deferred click lands on the fresh veil and would close it, so that window is skipped
let openedAt = 0;

function getAllTabButtons() {
  if (!tabsEl) return [];
  return Array.from(tabsEl.querySelectorAll(".tab-btn"))
    .filter((btn) => btn.id && btn.id.startsWith("btn-"))
    .filter((btn) => !btn.classList.contains("tab-more-btn"));
}

function getOverflowTabs() {
  return getAllTabButtons()
    .filter((btn) => btn.classList.contains("is-overflow"))
    .map((btn) => btn.id.slice("btn-".length));
}

export function reflowTabs() {
  const all = getAllTabButtons();
  if (!tabsEl || all.length === 0 || reflowing) return;

  // reflowTabs writes classes the MutationObserver watches: without this lock it re-entered
  reflowing = true;
  try {
    applyReflow(all);
  } finally {
    queueMicrotask(() => { reflowing = false; });
  }
}

function applyReflow(all) {
  const isMobile = globalThis.innerWidth <= MOBILE_BREAKPOINT;
  const barWidth = tabsEl.clientWidth;
  if (barWidth === 0) return;

  let visibleCount;
  if (isMobile) {
    visibleCount = MOBILE_MAX_TABS;
  } else {
    const fitsAll = Math.floor(barWidth / MIN_TAB_PX) >= all.length;
    const usable = fitsAll ? barWidth : barWidth - MIN_TAB_PX;
    visibleCount = Math.max(1, Math.min(all.length, Math.floor(usable / MIN_TAB_PX)));
  }

  const activeIndex = all.findIndex((btn) => btn.classList.contains("active"));
  const order = all.map((_, i) => i);
  if (activeIndex >= visibleCount) {
    order[visibleCount - 1] = activeIndex;
    order[activeIndex] = visibleCount - 1;
  }

  order.forEach((tabIndex, slot) => {
    const btn = all[tabIndex];
    const hidden = slot >= visibleCount;
    btn.classList.toggle("is-overflow", hidden);
    btn.style.order = String(slot);
  });

  const overflowCount = all.length - visibleCount;
  moreBtn.classList.toggle("is-needed", overflowCount > 0);
  moreBtn.style.order = String(all.length);

  if (isOpen && overflowCount === 0) closeFan();
}

function getTabLabel(mode) {
  const btn = document.getElementById("btn-" + mode);
  if (!btn) return mode;
  const span = document.getElementById(`tab-${mode}-text`);
  return (span?.textContent || btn.textContent).trim() || mode;
}

function getTabIconSrc(mode) {
  const img = document.querySelector("#btn-" + mode + " img");
  return img ? img.getAttribute("src") : null;
}

function buildFanItems() {
  const modes = getOverflowTabs();
  fanEl.innerHTML = "";

  modes.forEach((mode, index) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "tab-fan-item";
    item.dataset.mode = mode;
    item.setAttribute("role", "menuitem");

    const iconSrc = getTabIconSrc(mode);
    if (iconSrc) {
      const img = document.createElement("img");
      img.src = iconSrc;
      img.alt = "";
      img.className = "tab-fan-icon";
      item.appendChild(img);
    } else {
      const emoji = document.querySelector(`#btn-${mode} .tab-icon-img`)?.textContent?.trim();
      if (emoji) {
        const glyph = document.createElement("span");
        glyph.className = "tab-fan-icon";
        glyph.setAttribute("aria-hidden", "true");
        glyph.textContent = emoji;
        item.appendChild(glyph);
      }
    }

    const textos = document.createElement("span");
    textos.className = "tab-fan-text";

    const span = document.createElement("span");
    span.className = "tab-fan-label";
    span.textContent = getTabLabel(mode);
    textos.appendChild(span);

    const desc = document.getElementById("btn-" + mode)?.dataset.tooltip;
    if (desc) {
      const p = document.createElement("span");
      p.className = "tab-fan-desc";
      p.textContent = desc;
      textos.appendChild(p);
    }
    item.appendChild(textos);

    if (document.getElementById("btn-" + mode)?.classList.contains("active")) {
      item.classList.add("is-active");
    }

    item.style.setProperty("--fan-index", String(index));

    item.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      selectMode(mode);
    });

    fanEl.appendChild(item);
  });
}

function selectMode(mode) {
  closeFan();
  if (typeof globalThis.switchTab === "function") {
    globalThis.switchTab(mode);
  }
}

function placeFan() {
  if (globalThis.innerWidth <= MOBILE_BREAKPOINT) {
    fanEl.style.top = "";
    fanEl.style.left = "";
    return;
  }
  const r = moreBtn.getBoundingClientRect();
  fanEl.style.top = `${Math.round(r.bottom)}px`;
  const width = fanEl.offsetWidth || 190;
  const left = Math.min(Math.max(8, r.right - width), globalThis.innerWidth - width - 8);
  fanEl.style.left = `${Math.round(left)}px`;
}

function openFan({ drag = false } = {}) {
  if (isOpen) return;
  buildFanItems();

  isOpen = true;
  dragMode = drag;
  highlightedItem = null;
  openedAt = Date.now();

  overlayEl.hidden = false;
  fanEl.hidden = false;
  void fanEl.offsetWidth;
  placeFan();
  overlayEl.classList.add("is-open");
  fanEl.classList.add("is-open");

  moreBtn.setAttribute("aria-expanded", "true");
  moreBtn.classList.add("is-open");
  document.body.classList.add("tab-fan-open");
}

function closeFan() {
  if (!isOpen) return;
  isOpen = false;
  dragMode = false;
  clearHighlight();

  overlayEl.classList.remove("is-open");
  fanEl.classList.remove("is-open");
  moreBtn.setAttribute("aria-expanded", "false");
  moreBtn.classList.remove("is-open");
  document.body.classList.remove("tab-fan-open");

  setTimeout(() => {
    if (!isOpen) {
      overlayEl.hidden = true;
      fanEl.hidden = true;
    }
  }, 200);
}

function toggleFan() {
  if (isOpen) closeFan();
  else openFan();
}

function clearHighlight() {
  if (highlightedItem) {
    highlightedItem.classList.remove("is-highlighted");
    highlightedItem = null;
  }
}

function highlightAt(x, y) {
  const el = document.elementFromPoint(x, y);
  const item = el ? el.closest(".tab-fan-item") : null;
  if (item === highlightedItem) return;
  clearHighlight();
  if (item) {
    item.classList.add("is-highlighted");
    highlightedItem = item;
  }
}

function cancelLongPress() {
  if (longPressTimer) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
}

function onPointerDown(e) {
  if (e.button != null && e.button !== 0) return;

  pointerMoved = false;

  if (isOpen) return;

  cancelLongPress();

  if (e.pointerId != null && moreBtn.setPointerCapture) {
    try {
      moreBtn.setPointerCapture(e.pointerId);
    } catch {
    }
  }

  longPressTimer = setTimeout(() => {
    longPressTimer = null;
    openFan({ drag: true });
  }, LONG_PRESS_MS);
}

function onPointerMove(e) {
  if (!isOpen || !dragMode) return;
  pointerMoved = true;
  if (e.cancelable) e.preventDefault();
  highlightAt(e.clientX, e.clientY);
}

function onPointerUp(e) {
  const wasShortPress = longPressTimer !== null;
  cancelLongPress();
  suppressClick = true;

  if (e.pointerId != null && moreBtn.releasePointerCapture) {
    try {
      moreBtn.releasePointerCapture(e.pointerId);
    } catch {
    }
  }

  if (dragMode) {
    if (highlightedItem) {
      if (e.cancelable) e.preventDefault();
      selectMode(highlightedItem.dataset.mode);
    } else if (pointerMoved) {
      closeFan();
    } else {
      dragMode = false;
    }
    return;
  }

  if (wasShortPress || isOpen) {
    if (e.cancelable) e.preventDefault();
    toggleFan();
  }
}

export function initTabFan() {
  fanEl = document.getElementById("tab-fan");
  overlayEl = document.getElementById("tab-fan-overlay");
  moreBtn = document.getElementById("btn-tab-more");
  tabsEl = document.querySelector(".tabs");

  if (!fanEl || !overlayEl || !moreBtn || !tabsEl) return;

  reflowTabs();

  if (globalThis.ResizeObserver) {
    new ResizeObserver(() => reflowTabs()).observe(tabsEl);
  } else {
    globalThis.addEventListener("resize", () => reflowTabs());
  }

  new MutationObserver(() => reflowTabs()).observe(tabsEl, {
    subtree: true,
    attributes: true,
    attributeFilter: ["class"],
  });

  const hasPointer = Boolean(globalThis.PointerEvent);

  if (hasPointer) {
    moreBtn.addEventListener("pointerdown", onPointerDown);
    moreBtn.addEventListener("pointermove", onPointerMove, { passive: false });
    moreBtn.addEventListener("pointerup", onPointerUp);
    moreBtn.addEventListener("pointercancel", () => {
      cancelLongPress();
      closeFan();
    });
  }

  moreBtn.addEventListener("click", (e) => {
    e.preventDefault();
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    toggleFan();
  });

  overlayEl.addEventListener("click", () => {
    if (Date.now() - openedAt < 350) return;
    closeFan();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isOpen) closeFan();
  });

  document.addEventListener("click", (e) => {
    if (!isOpen || globalThis.innerWidth <= MOBILE_BREAKPOINT) return;
    if (Date.now() - openedAt < 350) return;
    if (fanEl.contains(e.target) || moreBtn.contains(e.target)) return;
    closeFan();
  });

  globalThis.addEventListener("scroll", () => {
    if (isOpen) placeFan();
  }, { passive: true });

  globalThis.addEventListener("resize", () => {
    if (isOpen) closeFan();
  });
}

export { closeFan };
