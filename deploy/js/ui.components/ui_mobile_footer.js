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
 *
 * .site-content ("Sobre VoidStonks · Guia · FAQ") tenia exactamente el mismo problema y se
 * quedo fuera del arreglo: vive junto al footer, tampoco scrollea, y en movil renderizaba
 * bajo la barra de pestañas asomando 15px que no se podian ni leer ni pulsar. Se mueve con
 * el mismo mecanismo, y antes que el footer para conservar el orden del HTML.
 */

const MOBILE_BREAKPOINT = 768;
// En orden de aparicion en el HTML: .site-content (1341) va antes que .site-footer (1569).
const SELECTORS = [".site-content", ".site-footer"];

let blocks = [];
let movedToScroll = false;

/** Mueve los bloques de cierre al final del area con scroll (movil). */
function moveIntoScroll() {
  const contentArea = document.querySelector(".content-area");
  if (!contentArea || movedToScroll || !blocks.length) return;
  for (const b of blocks) {
    contentArea.appendChild(b.el);
    b.el.classList.add("in-scroll");
  }
  movedToScroll = true;
}

/** Los devuelve a su sitio del HTML (escritorio). */
function restore() {
  if (!movedToScroll || !blocks.length) return;
  // Se vuelve delante del ancla y no con appendChild: estos bloques no son los ultimos hijos
  // del body (detras van los scripts y el abanico de pestañas), y devolverlos al final los
  // dejaria en otro sitio del que estaban.
  for (const b of blocks) {
    b.anchor.parentNode?.insertBefore(b.el, b.anchor);
    b.el.classList.remove("in-scroll");
  }
  movedToScroll = false;
}

function apply() {
  if (globalThis.innerWidth <= MOBILE_BREAKPOINT) moveIntoScroll();
  else restore();
}

export function initMobileFooter() {
  // Un ancla (nodo comentario) fija en el sitio original de cada bloque, en vez de guardarse
  // el hermano siguiente: .site-content tiene a .site-footer justo detras, asi que al volver a
  // escritorio se restauraba primero .site-content contra una referencia que en ese momento
  // seguia movida dentro de .content-area — insertBefore reventaba con NotFoundError y el
  // footer se quedaba colgado en la zona de scroll.
  blocks = SELECTORS.map((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const anchor = document.createComment(`vs-anchor:${sel}`);
    el.parentElement.insertBefore(anchor, el);
    return { el, anchor };
  }).filter(Boolean);
  if (!blocks.length) return;

  apply();
  globalThis.addEventListener("resize", apply);
}
