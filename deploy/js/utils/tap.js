/**
 * Tap activation of "clickable" elements that are not <button> or <a>.
 *
 * On mobile a `click` on a <div> gets lost easily: the browser spends the first tap on the sticky :hover or on
 * closing the keyboard (which reflows the page), and the user ends up tapping twice.
 *
 * So the selection resolves on `pointerup`, which arrives before that heuristic, with two guards:
 *   - if the finger moved more than TAP_SLOP px it is a list scroll, not a selection;
 *   - the following `click` is ignored if `pointerup` already fired less than DEDUPE_MS ago. That `click` must
 *     still be listened to: the physical keyboard (Enter) activates the option with a programmatic
 *     `.click()`, which emits NO pointer events.
 */

const TAP_SLOP = 10;
const DEDUPE_MS = 700;

/**
 * @param {HTMLElement} el element to activate
 * @param {(e: Event) => void} handler what to do on activation
 * @param {{ preventDown?: boolean }} [opts] preventDown stops the pointerdown focus/blur
 *   (the stat dropdowns need it so the input keeps focus).
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
