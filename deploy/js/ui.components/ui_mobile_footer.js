/**
 * Mobile footer. On mobile .content-area is the only scrolling container, so .site-content and the
 * <footer> move inside it to be reachable at the end of the scroll. The nodes move instead of being
 * copied: updateUILabels() translates the links by id.
 */

const MOBILE_BREAKPOINT = 768;
// HTML order: .site-content comes before .site-footer
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
  // back before the anchor, not appendChild: these blocks are not the last children of body
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
  // a fixed anchor (comment node) at each block's original place: the next sibling can be moved too, and
  // insertBefore threw NotFoundError
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
