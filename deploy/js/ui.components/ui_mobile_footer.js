/**
 * Footer en movil.
 *
 * En movil el <footer> estaba oculto con `display:none`, asi que se perdian los enlaces
 * legales (Privacidad, Terminos), Guia, Contacto y Novedades: en el movil no habia forma
 * de llegar a ellos.
 *
 * No bastaba con volver a mostrarlo. El layout movil convierte .content-area en el unico
 * contenedor con scroll y deja la barra de pestañas fija abajo; el <footer> vive FUERA de
 * .card, asi que mostrandolo tal cual quedaba en una zona que no scrollea, detras de la
 * barra de pestañas y sin poder alcanzarse.
 *
 * La solucion es moverlo dentro de .content-area para que forme parte del scroll y aparezca
 * al llegar al final, que es donde se espera encontrarlo. Se mueve el nodo en vez de
 * duplicar el marcado: los enlaces tienen ids que updateUILabels() traduce, y dos copias
 * significarian dos elementos con el mismo id.
 */

const MOBILE_BREAKPOINT = 768;

let footerEl = null;
let originalParent = null;
let originalNext = null;
let movedToScroll = false;

/** Mueve el footer al final del area con scroll (movil). */
function moveIntoScroll() {
  const contentArea = document.querySelector(".content-area");
  if (!contentArea || movedToScroll || !footerEl) return;
  contentArea.appendChild(footerEl);
  footerEl.classList.add("in-scroll");
  movedToScroll = true;
}

/** Lo devuelve a su sitio del HTML (escritorio). */
function restore() {
  if (!movedToScroll || !footerEl || !originalParent) return;
  // insertBefore con la referencia guardada, no appendChild: el footer no es el ultimo
  // hijo del body (detras van los scripts y el abanico de pestañas), y devolverlo al final
  // lo dejaria en otro sitio del que estaba.
  originalParent.insertBefore(footerEl, originalNext);
  footerEl.classList.remove("in-scroll");
  movedToScroll = false;
}

function apply() {
  if (globalThis.innerWidth <= MOBILE_BREAKPOINT) moveIntoScroll();
  else restore();
}

export function initMobileFooter() {
  footerEl = document.querySelector(".site-footer");
  if (!footerEl) return;

  originalParent = footerEl.parentElement;
  originalNext = footerEl.nextElementSibling;

  apply();
  globalThis.addEventListener("resize", apply);
}
