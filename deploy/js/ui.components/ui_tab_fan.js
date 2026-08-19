/**
 * Abanico de pestañas: las que no caben en la barra se despliegan sobre un velo.
 *
 * En movil se abre con un tap, o manteniendo pulsado para deslizar el dedo hasta
 * la opcion y soltar.
 *
 * QUE ENTRA EN EL ABANICO
 * No hay lista fija: reflowTabs() mide el ancho real de la barra y esconde por la
 * cola las que no quepan. Antes eran dos listas paralelas —PRIMARY_TABS aqui y un
 * `#btn-lfg, #btn-vosfor, ... { display: none }` en styles.css— que habia que
 * mantener sincronizadas a mano, asi que una pestaña nueva se desbordaba en
 * escritorio y en movil salia encogiendo a las demas hasta romper la barra.
 * Ahora añadir un <button class="tab-btn"> al HTML basta: se acomoda solo.
 */

// Ancho minimo utilizable de una pestaña en escritorio. Por debajo de esto el
// icono y la etiqueta se pisan, asi que es el punto donde conviene mandarla al
// abanico en vez de seguir encogiendo.
const MIN_TAB_PX = 104;

// En movil las pestañas van en rejilla fija (icono sobre etiqueta) y el ancho de
// pantalla no da para mas de cuatro sin que la etiqueta quede ilegible.
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
// Cerrojo de reflowTabs frente al MutationObserver (ver reflowTabs).
let reflowing = false;
// Ignora el click sintetico que el navegador emite tras pointerup.
let suppressClick = false;
// Momento de apertura: el click diferido del tap cae sobre el velo recien
// aparecido y lo cerraria de inmediato, asi que se descarta esa ventana.
let openedAt = 0;

/** Todas las pestañas reales, en el orden del HTML (sin el boton "Más"). */
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

/**
 * Decide cuantas pestañas caben y esconde el resto (.is-overflow).
 *
 * Se mide sobre el contenedor, no sobre los botones: con flex:1 cada boton ya
 * viene encogido al ancho disponible, asi que preguntarle su tamaño devuelve el
 * valor deformado y nunca detectaria el desbordamiento.
 */
export function reflowTabs() {
  const all = getAllTabButtons();
  if (!tabsEl || all.length === 0 || reflowing) return;

  // reflowTabs escribe clases sobre los mismos botones que vigila el
  // MutationObserver: sin este cerrojo cada pasada se reinvocaba a si misma.
  reflowing = true;
  try {
    applyReflow(all);
  } finally {
    // En microtarea, no sincrono: las mutaciones de esta pasada se entregan al
    // observer despues del bloque, y liberando antes volveria a entrar.
    queueMicrotask(() => { reflowing = false; });
  }
}

function applyReflow(all) {
  const isMobile = globalThis.innerWidth <= MOBILE_BREAKPOINT;
  const barWidth = tabsEl.clientWidth;
  if (barWidth === 0) return; // barra aun sin layout (pestaña oculta): se reintenta al mostrarla

  let visibleCount;
  if (isMobile) {
    visibleCount = MOBILE_MAX_TABS;
  } else {
    // Se reserva el hueco del boton "Más" solo si de verdad va a sobrar alguna:
    // descontarlo siempre expulsaria una pestaña que cabia de sobra.
    const fitsAll = Math.floor(barWidth / MIN_TAB_PX) >= all.length;
    const usable = fitsAll ? barWidth : barWidth - MIN_TAB_PX;
    visibleCount = Math.max(1, Math.min(all.length, Math.floor(usable / MIN_TAB_PX)));
  }

  // La pestaña activa nunca se esconde: si le toca caer en el overflow, cambia el
  // sitio con la ultima visible para que siga viendose donde estas.
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
    // El orden visual sigue los huecos, no el del HTML: asi el intercambio de la
    // pestaña activa no la deja descolocada respecto a sus vecinas.
    btn.style.order = String(slot);
  });

  // El boton "Más" solo existe si hay algo detras: con todas las pestañas a la
  // vista ocuparia un hueco para abrir un menu vacio.
  const overflowCount = all.length - visibleCount;
  moreBtn.classList.toggle("is-needed", overflowCount > 0);
  moreBtn.style.order = String(all.length);

  if (isOpen && overflowCount === 0) closeFan();
}

/**
 * Se prefiere el <span> de texto (#tab-<modo>-text) y solo se cae a textContent
 * para las pestañas que ya paso por setTab(), que reescribe el innerHTML y deja el
 * texto como nodo suelto junto al <img>. Sin esa preferencia, las pestañas cuyo
 * icono es un emoji en un <span> (Mis ordenes) devolvian "📋 Mis ordenes" y el
 * abanico pintaba el emoji dos veces: como icono y dentro de la etiqueta.
 */
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
      // Sin <img>: el icono puede ser un emoji dentro del <span class="tab-icon-img">
      // (Mis ordenes). Sin esta rama esa entrada salia sin icono, descuadrada
      // respecto a las demas del menu.
      const emoji = document.querySelector(`#btn-${mode} .tab-icon-img`)?.textContent?.trim();
      if (emoji) {
        const glyph = document.createElement("span");
        glyph.className = "tab-fan-icon";
        glyph.setAttribute("aria-hidden", "true");
        glyph.textContent = emoji;
        item.appendChild(glyph);
      }
    }

    // Etiqueta y, debajo, la frase que explica la pestaña.
    //
    // En movil solo caben cuatro pestañas (MOBILE_MAX_TABS) y el resto vive aqui dentro, asi
    // que este menu es el UNICO sitio donde se descubren Vosfor, Ducados, Farms, LFG y Mis
    // ordenes. Con el nombre a secas hay que entrar en cada una para saber que hace.
    //
    // El texto sale del data-tooltip que updateNavTabs() ya pone en cada boton: la misma
    // frase que en escritorio se ve al pasar por encima, aqui impresa. Una sola fuente, asi
    // que no puede acabar diciendo una cosa el tooltip y otra el menu.
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

/**
 * Ancla el menu bajo el boton "Más" (solo escritorio).
 *
 * En movil las coordenadas las pone el CSS (barra inferior fija) y tocarlas aqui
 * lo descolocaria, por eso se limpian las propiedades en vez de calcularlas.
 */
function placeFan() {
  if (globalThis.innerWidth <= MOBILE_BREAKPOINT) {
    fanEl.style.top = "";
    fanEl.style.left = "";
    return;
  }
  const r = moreBtn.getBoundingClientRect();
  fanEl.style.top = `${Math.round(r.bottom)}px`;
  // Alineado por la derecha del boton, y nunca fuera de la ventana.
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
  // Despues de quitar [hidden]: placeFan mide el ancho real del menu, y oculto
  // seria 0 y lo pegaria al borde equivocado.
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
  tabsEl = document.querySelector(".tabs");

  if (!fanEl || !overlayEl || !moreBtn || !tabsEl) return;

  reflowTabs();

  // ResizeObserver y no solo el resize de window: la barra tambien cambia de ancho
  // sin que la ventana lo haga (aparicion de la barra de scroll, zoom del navegador,
  // paneles laterales que se abren).
  if (globalThis.ResizeObserver) {
    new ResizeObserver(() => reflowTabs()).observe(tabsEl);
  } else {
    globalThis.addEventListener("resize", () => reflowTabs());
  }

  // switchTab no sabe del abanico: se escucha el cambio de .active para poder
  // rescatar la pestaña abierta si estaba en el overflow.
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

  // En escritorio el menu no tiene velo detras (ver .tab-fan-overlay), asi que el
  // click fuera hay que capturarlo aqui o el desplegable se queda abierto.
  document.addEventListener("click", (e) => {
    if (!isOpen || globalThis.innerWidth <= MOBILE_BREAKPOINT) return;
    if (Date.now() - openedAt < 350) return;
    if (fanEl.contains(e.target) || moreBtn.contains(e.target)) return;
    closeFan();
  });

  // Con position:fixed el menu no acompaña a la pagina al hacer scroll: se le
  // vuelven a dar coordenadas en vez de dejarlo flotando lejos del boton.
  globalThis.addEventListener("scroll", () => {
    if (isOpen) placeFan();
  }, { passive: true });

  globalThis.addEventListener("resize", () => {
    if (isOpen) closeFan();
  });
}

export { closeFan };
