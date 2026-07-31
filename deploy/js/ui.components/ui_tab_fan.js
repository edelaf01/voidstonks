/**
 * Abanico de pestañas para movil.
 *
 * La barra inferior solo muestra PRIMARY_TABS y un boton "Más" que despliega el
 * resto sobre un velo oscuro. Se abre con un tap, o manteniendo pulsado para
 * deslizar el dedo hasta la opcion y soltar.
 */

const PRIMARY_TABS = ["relic", "set", "riven", "bounties"];

const LONG_PRESS_MS = 220;

let fanEl = null;
let overlayEl = null;
let moreBtn = null;
let isOpen = false;
let longPressTimer = null;
let dragMode = false;
let pointerMoved = false;
let highlightedItem = null;
// Ignora el click sintetico que el navegador emite tras pointerup.
let suppressClick = false;
// Momento de apertura: el click diferido del tap cae sobre el velo recien
// aparecido y lo cerraria de inmediato, asi que se descarta esa ventana.
let openedAt = 0;

function getOverflowTabs() {
  return Array.from(document.querySelectorAll(".tabs .tab-btn"))
    .filter((btn) => btn.id && btn.id.startsWith("btn-"))
    .filter((btn) => !btn.classList.contains("tab-more-btn"))
    .map((btn) => btn.id.slice("btn-".length))
    .filter((mode) => !PRIMARY_TABS.includes(mode));
}

/**
 * setTab() reescribe el innerHTML del boton y deja el texto como nodo suelto
 * junto al <img>, por eso se lee textContent en vez de un <span> concreto.
 */
function getTabLabel(mode) {
  const btn = document.getElementById("btn-" + mode);
  if (!btn) return mode;
  return btn.textContent.trim() || mode;
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
    }

    const span = document.createElement("span");
    span.className = "tab-fan-label";
    span.textContent = getTabLabel(mode);
    item.appendChild(span);

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

  // Con el abanico abierto este toque solo sirve para cerrarlo.
  if (isOpen) return;

  cancelLongPress();

  // Mantiene los pointermove aunque el dedo salga del boton, para poder
  // deslizar hasta una opcion sin perder el evento.
  if (e.pointerId != null && moreBtn.setPointerCapture) {
    try {
      moreBtn.setPointerCapture(e.pointerId);
    } catch {
      /* sin captura el tap sigue funcionando */
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
      /* nada que liberar */
    }
  }

  if (dragMode) {
    if (highlightedItem) {
      if (e.cancelable) e.preventDefault();
      selectMode(highlightedItem.dataset.mode);
    } else if (pointerMoved) {
      closeFan();
    } else {
      // Hold sin mover: se queda abierto para elegir con tap.
      dragMode = false;
    }
    return;
  }

  // Tap: alterna. Cubre tanto abrir como cerrar con el abanico ya abierto.
  if (wasShortPress || isOpen) {
    if (e.cancelable) e.preventDefault();
    toggleFan();
  }
}

export function initTabFan() {
  fanEl = document.getElementById("tab-fan");
  overlayEl = document.getElementById("tab-fan-overlay");
  moreBtn = document.getElementById("btn-tab-more");

  if (!fanEl || !overlayEl || !moreBtn) return;

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
    // Sin PointerEvent (o activacion por teclado) el click es el unico gesto.
    toggleFan();
  });

  overlayEl.addEventListener("click", () => {
    if (Date.now() - openedAt < 350) return;
    closeFan();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isOpen) closeFan();
  });

  globalThis.addEventListener("resize", () => {
    if (isOpen) closeFan();
  });
}

export { closeFan };
