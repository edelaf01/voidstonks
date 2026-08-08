/**
 * Activación por toque de elementos "clicables" que no son <button> ni <a>.
 *
 * En móvil un `click` sobre un <div> se pierde con facilidad: el navegador consume el primer
 * toque para aplicar el :hover pegajoso o para cerrar el teclado (que reflowea la página), y
 * el usuario acaba teniendo que tocar dos veces. Pasó en los dos buscadores de rivens: el
 * autocompletado del arma y los desplegables de stats del tasador.
 *
 * Por eso la selección se resuelve en `pointerup`, que llega antes de esa heurística, con dos
 * guardas:
 *   - si el dedo se movió más de TAP_SLOP px es un scroll de la lista, no una selección;
 *   - el `click` posterior se ignora si `pointerup` ya activó hace menos de DEDUPE_MS. Ese
 *     `click` hay que seguir escuchándolo: el teclado físico (Enter) activa la opción con
 *     `.click()` programático, que NO emite eventos de puntero.
 */

const TAP_SLOP = 10;
const DEDUPE_MS = 700;

/**
 * @param {HTMLElement} el elemento a activar
 * @param {(e: Event) => void} handler qué hacer al activarlo
 * @param {{ preventDown?: boolean }} [opts] preventDown evita el foco/blur del pointerdown
 *   (los desplegables de stats lo necesitan para que el input no pierda el foco).
 */
export function onTap(el, handler, opts = {}) {
  let startX = 0;
  let startY = 0;
  let lastTap = 0;

  el.addEventListener("pointerdown", (e) => {
    startX = e.clientX;
    startY = e.clientY;
    if (opts.preventDown) e.preventDefault();
  });

  el.addEventListener("pointerup", (e) => {
    if (Math.hypot(e.clientX - startX, e.clientY - startY) > TAP_SLOP) return;
    lastTap = Date.now();
    handler(e);
  });

  el.addEventListener("click", (e) => {
    if (Date.now() - lastTap < DEDUPE_MS) return;
    handler(e);
  });
}
