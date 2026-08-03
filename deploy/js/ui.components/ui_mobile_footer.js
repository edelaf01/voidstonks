const MOBILE_BREAKPOINT = 768;

let footerEl = null;
let originalParent = null;
let originalNext = null;
let movedToScroll = false;

function moveIntoScroll() {
  const contentArea = document.querySelector(".content-area");
  if (!contentArea || movedToScroll || !footerEl) return;
  contentArea.appendChild(footerEl);
  footerEl.classList.add("in-scroll");
  movedToScroll = true;
}

function restore() {
  if (!movedToScroll || !footerEl || !originalParent) return;
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
