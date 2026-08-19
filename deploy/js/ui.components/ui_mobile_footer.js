// moves site-content and footer inside the scrolling container on mobile

const MOBILE_BREAKPOINT = 768;
const SELECTORS = [".site-content", ".site-footer"];

let blocks = [];
let movedToScroll = false;

function moveIntoScroll() {
  const contentArea = document.querySelector(".content-area");
  if (!contentArea || movedToScroll || !blocks.length) return;
  for (const b of blocks) {
    contentArea.appendChild(b.el);
    b.el.classList.add("in-scroll");
  }
  movedToScroll = true;
}

function restore() {
  if (!movedToScroll || !blocks.length) return;
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
  // fixed anchor comment node: the next sibling can move and insertBefore threw NotFoundError
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
