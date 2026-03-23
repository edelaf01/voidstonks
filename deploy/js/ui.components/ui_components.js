import {
  TEXTS,
  APP_VERSION,
  UPDATE_HISTORY_CONTENT,
  TIER_URLS,
} from "../config.js";
import { state } from "../state.js";

export function preloadCriticalAssets() {
  const assets = [
    "assets/relic_contents/platinum.webp",
    ...Object.values(TIER_URLS),
  ];
  assets.forEach((url) => {
    const img = new Image();
    img.src = url;
  });
}

export function escapeHTML(str) {
  if (!str) return "";
  const p = document.createElement("p");
  p.textContent = str;
  return p.innerHTML;
}

export function showToast(message) {
  const toast = document.getElementById("error-toast");
  if (!toast) return;
  toast.innerText = message;
  toast.classList.add("visible");
  setTimeout(() => toast.classList.remove("visible"), 3000);
}

export function showCustomConfirm(message, onConfirm) {
  const modal = document.getElementById("orokin-confirm-modal");
  const msgEl = document.getElementById("orokin-confirm-msg");
  const confirmBtn = document.getElementById("orokin-btn-confirm");
  const cancelBtn = document.getElementById("orokin-btn-cancel");

  if (!modal || !msgEl || !confirmBtn) return;

  const t = TEXTS[state.currentLang];
  msgEl.innerText = message;
  confirmBtn.innerText = t.btnConfirm || "CONFIRM";
  if (cancelBtn) cancelBtn.innerText = t.btnCancel || "CANCEL";

  modal.classList.remove("hidden");

  confirmBtn.onclick = () => {
    onConfirm();
    closeOrokinConfirm();
  };
}

export function closeOrokinConfirm() {
  document.getElementById("orokin-confirm-modal")?.classList.add("hidden");
}

export async function checkUpdates() {
  const lastSeenVersion = localStorage.getItem("last_seen_version");
  const currentVersionStr = String(APP_VERSION);

  if (lastSeenVersion !== currentVersionStr) {
    const container = document.getElementById("update-history-content");
    if (container) {
      container.innerHTML = UPDATE_HISTORY_CONTENT;
      document.getElementById("update-modal").classList.remove("hidden");
    }
  }
}

export function closeUpdateModal() {
  document.getElementById("update-modal").classList.add("hidden");
  localStorage.setItem("last_seen_version", String(APP_VERSION));
  console.log("Versión guardada con éxito:", APP_VERSION);
}

export function initGlobalTooltipSystem() {
  let tooltipEl = document.getElementById("global-tooltip");
  let closeTimer = null;
  let currentMode = "simple";

  if (!tooltipEl) {
    tooltipEl = document.createElement("div");
    tooltipEl.id = "global-tooltip";
    tooltipEl.className = "global-tooltip hidden";
    document.body.appendChild(tooltipEl);
  }

  const moveSimpleTooltip = (e) => {
    const offset = 15;
    const tWidth = tooltipEl.offsetWidth;
    const tHeight = tooltipEl.offsetHeight;

    let left = e.clientX + offset;
    let top = e.clientY + offset;

    if (left + tWidth > globalThis.innerWidth)
      left = e.clientX - tWidth - offset;
    if (top + tHeight > globalThis.innerHeight)
      top = e.clientY - tHeight - offset;

    tooltipEl.style.left = `${left}px`;
    tooltipEl.style.top = `${top}px`;
  };

  const positionMegaTooltip = (target) => {
    const rect = target.getBoundingClientRect();
    const tWidth = tooltipEl.offsetWidth;
    const tHeight = tooltipEl.offsetHeight;
    const gap = 5;

    let left = rect.right + gap;
    let top = rect.top;

    if (left + tWidth > globalThis.innerWidth) left = rect.left - tWidth - gap;
    if (top + tHeight > globalThis.innerHeight) top = rect.bottom - tHeight;
    if (top < 10) top = 10;
    if (left < 10) left = 10;

    tooltipEl.style.left = `${left}px`;
    tooltipEl.style.top = `${top}px`;
  };

  const showTooltip = (e, target) => {
    if (closeTimer) clearTimeout(closeTimer);

    const htmlContent = target.dataset.tooltipHtml;
    const textContent = target.dataset.tooltip;

    if (htmlContent) {
      currentMode = "mega";
      tooltipEl.innerHTML = htmlContent;
      tooltipEl.classList.add("mega-mode");
    } else if (textContent) {
      currentMode = "simple";
      tooltipEl.innerText = textContent;
      tooltipEl.classList.remove("mega-mode");
    } else {
      return;
    }

    tooltipEl.classList.remove("hidden");

    if (currentMode === "mega") {
      positionMegaTooltip(target);
    } else {
      moveSimpleTooltip(e);
    }
  };

  const hideTooltip = () => {
    if (currentMode === "simple") {
      tooltipEl.classList.add("hidden");
    } else {
      if (closeTimer) clearTimeout(closeTimer);
      closeTimer = setTimeout(() => {
        tooltipEl.classList.add("hidden");
        tooltipEl.classList.remove("mega-mode");
      }, 300);
    }
  };

  document.addEventListener("mouseover", (e) => {
    const target = e.target.closest("[data-tooltip], [data-tooltip-html]");
    const isOverTooltip = e.target.closest("#global-tooltip");

    if (target || isOverTooltip) {
      if (closeTimer) clearTimeout(closeTimer);
      if (target) showTooltip(e, target);
    }
  });

  document.addEventListener("mousemove", (e) => {
    if (currentMode === "simple" && !tooltipEl.classList.contains("hidden")) {
      moveSimpleTooltip(e);
    }
  });

  document.addEventListener("mouseout", (e) => {
    const isTrigger = e.target.closest("[data-tooltip], [data-tooltip-html]");
    const isTooltip = e.target.closest("#global-tooltip");

    if (isTrigger || isTooltip) {
      const related = e.relatedTarget;
      if (
        related &&
        (related.closest("[data-tooltip], [data-tooltip-html]") ||
          related.closest("#global-tooltip"))
      ) {
        return;
      }
      hideTooltip();
    }
  });
}

export function initDisclaimerSystem() {
  setTimeout(() => {
    const disclaimer = document.getElementById("txt-disclaimer");
    if (disclaimer) {
      disclaimer.classList.add("fade-out");
      setTimeout(() => {
        disclaimer.style.display = "none";
      }, 2000);
    }
  }, 8000);
}
