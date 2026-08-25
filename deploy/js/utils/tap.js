// tap activation on pointerup for clickable non-button elements on mobile

const TAP_SLOP = 10;
const DEDUPE_MS = 700;

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

// checks hover capability not screen width: a wide tablet is touch and a narrow laptop is not
export function isTouchPointer() {
  return globalThis.matchMedia?.("(hover: none)").matches ?? false;
}
