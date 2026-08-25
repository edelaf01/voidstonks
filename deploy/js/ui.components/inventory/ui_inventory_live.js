import { state } from "../../state.js";
import { TEXTS } from "../../config.js";
import { getSlug } from "../../utils/slugs.utils.js";
import { getSetName } from "../../utils/ui_utils.js";
import { exposeGlobals } from "../../utils/global_registry.js";

/**
 * Precios en vivo pintados sobre el inventario ya renderizado.
 *
 * Pinta sobre el DOM existente en vez de repintar el inventario: una tanda de precios puede
 * traer decenas de slugs seguidos y repintar en cada uno tira el scroll y las secciones
 * abiertas.
 */

/** Suscripción al flujo de precios en vivo. Solo se engancha una vez. */
let liveHooked = false;

/**
 * Lo visto en el flujo, por slug. Antes solo vivía en el DOM, así que CUALQUIER repintado del
 * inventario —buscar, cambiar el orden, tocar una cantidad— se llevaba por delante las marcas
 * y el filtro, dejando el chip encendido sin filtrar nada. Guardándolo se puede repintar.
 */
const liveSeen = new Map();   // slug -> plat
const staleSeen = new Map();  // slug -> diff

/** Estado del filtro. En variable y no en la clase del chip, para poder reaplicarlo tras un
 *  repintado sin depender de que el chip siga en pantalla. */
let staleFilterOn = false;

/** Cierto mientras repaintLivePrices reconstruye las marcas: evita N recuentos del chip. */
let repainting = false;

/**
 * Enciende los precios en vivo del inventario.
 *
 * El flujo de WFM solo trae ~3,4% del catálogo cada 3 minutos, así que esto NO da
 * precio a todo: refina los ítems que pasen por el flujo mientras la pestaña está
 * abierta. El precio base (mediana de prices_batch) sigue siendo el que manda.
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
      // El chip se muestra ya, en estado "vigilando": los desvíos llegan a cuentagotas
      // y sin esto la función parecería no existir hasta que saltara el primero.
      refreshStaleChip();
    } else {
      liveHooked = false; // sin inventario o sin socket: se reintenta
    }
  } catch {
    liveHooked = false; // los precios en vivo son un extra: su fallo no rompe el inventario
  }
}

/**
 * Marca en la UI el precio recién visto en el mercado.
 *
 * No pisa el precio base: lo acompaña. El precio base es una mediana de las 5 más
 * baratas; esto es UN listing concreto, y presentarlos como lo mismo sería engañoso.
 */
function paintLivePrice(slug, plat) {
  liveSeen.set(slug, plat);
  // El badge se localiza por el nombre del ítem, que es lo que guarda data-item.
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

    // Reinicia la animación aunque el nodo ya existiera: sin esto, un precio nuevo
    // sobre el mismo ítem pasaría desapercibido.
    tag.classList.remove("is-fresh");
    void tag.offsetWidth;
    tag.classList.add("is-fresh");
  }

  paintLiveSetHeader(slug);
}

/**
 * Señala que el precio guardado ya no cuadra con lo que se ve en el mercado.
 *
 * La flecha indica hacia dónde se ha movido: hacia arriba el ítem vale más de lo que
 * dice la app (venderías barato), hacia abajo menos. Sin dirección el aviso obligaría a
 * abrir cada ítem para saber si te perjudica.
 */
function paintStale(slug, diff) {
  staleSeen.set(slug, diff);
  const t = TEXTS[state.currentLang];
  const up = diff > 0;
  const pct = Math.round(Math.abs(diff) * 100);

  for (const badge of document.querySelectorAll(".price-badge-small[data-item]")) {
    if (getSlug(badge.dataset.item) !== slug) continue;

    // La fila se marca entera para que el chip de filtro pueda seleccionarla.
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
 * Muestra solo los ítems cuyo precio contradice al mercado, o vuelve a mostrarlos todos.
 *
 * Filtra sobre el DOM ya pintado en vez de repintar el inventario: repintar tira el scroll y
 * las secciones abiertas. Lo que se pinta se guarda en staleSeen/liveSeen, así que un
 * repintado del inventario ya no se lleva por delante ni las marcas ni este filtro.
 */
export function toggleStaleFilter() {
  staleFilterOn = !staleFilterOn;
  applyStaleFilter();
}

/** Esconde lo no marcado si el filtro está puesto. Idempotente: se puede llamar tras cada
 *  repintado sin acumular efectos. */
function applyStaleFilter() {
  const on = staleFilterOn;
  document.getElementById("inv-stale-chip")?.classList.toggle("is-active", on);

  for (const row of document.querySelectorAll(".inv-row-mini")) {
    row.style.display = (on && !row.classList.contains("is-price-stale")) ? "none" : "";
  }

  // Un set sin ninguna pieza marcada sobra en pantalla mientras el filtro esté activo.
  for (const group of document.querySelectorAll(".inv-set-group")) {
    const hasStale = group.querySelector(".is-price-stale");
    group.style.display = (on && !hasStale) ? "none" : "";
    // Se despliega para que las piezas marcadas se vean sin tener que abrir cada set.
    if (on && hasStale) group.classList.remove("collapsed");
  }
}

/**
 * Vuelve a poner sobre el inventario recién pintado lo que ya se había visto en el flujo.
 * Lo llama renderPrimeInventory al terminar: sin esto, buscar o reordenar borraba las marcas
 * y el filtro, pero el chip seguía anunciándose activo.
 */
export function repaintLivePrices() {
  // paintStale refresca el chip en cada slug; durante el repintado eso son N recuentos sobre
  // todo el documento para el mismo resultado. Se hace uno solo al final.
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

/** Actualiza el contador del chip de filtro, si está en pantalla. */
function refreshStaleChip() {
  const chip = document.getElementById("inv-stale-chip");
  if (!chip) return;

  const t = TEXTS[state.currentLang];
  const n = document.querySelectorAll(".is-price-stale").length;

  // Visible siempre que la vigilancia esté activa, aunque no haya desvíos: si solo
  // apareciera al detectar uno, no habría forma de saber si está funcionando o si
  // simplemente no hay nada que avisar. Los desvíos llegan por el socket, a cuentagotas.
  chip.style.display = "";
  chip.classList.toggle("is-empty", n === 0);
  chip.disabled = n === 0;

  const count = chip.querySelector(".inv-chip-count");
  if (count) count.textContent = String(n);

  // El HTML trae el texto en español; aquí se ajusta al idioma activo.
  const label = document.getElementById("inv-stale-label");
  if (label) label.textContent = (n === 0 ? t.staleChipWatching : t.staleChip) || label.textContent;

  chip.title = (n === 0 ? t.staleChipWatchingTitle : t.staleChipTitle) || "";
}

/**
 * Señala en la cabecera del set que alguna de sus piezas tiene precio recién visto.
 *
 * Solo un indicador, no una cifra: sumar un listing suelto al subtotal mezclaría una
 * mediana con un dato puntual y daría un total que no significa nada.
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

// El chip de "precios viejos" del inventario lo invoca index.html con onclick inline.
exposeGlobals({ toggleStaleFilter }, "ui.components/inventory/ui_inventory_live.js");
