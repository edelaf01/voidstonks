import {
  TEXTS,
  APP_VERSION,
  UPDATE_HISTORY_DATA,
  TIER_URLS,
} from "../config.js";
import { state } from "../state.js";
import { exposeGlobals } from "../utils/global_registry.js";
import { isTouchPointer } from "../utils/tap.js";
import { posicionFuera, DEBAJO_PRIMERO, AL_LADO_PRIMERO } from "../utils/tooltip_position.js";
import { getRelicDropTooltip } from "./ui_tooltips.js";

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

import { escapeHTML } from "../utils/escape_html.js";
export { escapeHTML };

export function emptyStateHtml(message, scannerHint = "", mobileHint = "") {
  const onScreen = (id) => document.getElementById(id)?.offsetParent != null;
  const texto = onScreen("scanner-section") ? scannerHint
    : onScreen("mobile-scan-btn") ? mobileHint
      : "";
  const hint = texto
    ? `<div style="margin-top:6px; font-size:0.85em;">${escapeHTML(texto)}</div>`
    : "";
  return `<div style="padding:20px 16px; text-align:center; color:#888; line-height:1.5;">${escapeHTML(message)}${hint}</div>`;
}

export function qtyToast(name, delta) {
  return `${name} ${delta > 0 ? "+" : ""}${delta}`;
}

const activeToasts = new Map();

export function showToast(message, options = {}) {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const {
    action = null,
    tag = null,
    onClose = null,
    type = "info",
    html = false
  } = options || {};
  const actionLabel = action?.label ?? action?.text;
  const actionClick = action?.onClick ?? action?.callback;
  const duration = options?.duration ?? (actionLabel ? 8000 : 6000);

  if (tag && activeToasts.has(tag)) {
    const old = activeToasts.get(tag);
    old.remove();
    activeToasts.delete(tag);
  }

  const toast = document.createElement("div");
  toast.className = `wf-toast ${type}`;
  const icon = type === "error" ? "⚠️" : (type === "success" ? "✓" : "ℹ");

  toast.innerHTML = `
    <span class="toast-icon">${icon}</span>
    <span class="toast-message">${html ? message : escapeHTML(String(message ?? ""))}</span>
    <span class="toast-close">×</span>
  `;

  let closed = false;
  let timer = null;
  const removeToast = () => {
    if (closed) return;
    closed = true;
    if (timer) clearTimeout(timer);
    toast.classList.add("fade-out");
    setTimeout(() => {
      toast.remove();
      if (tag && activeToasts.get(tag) === toast) activeToasts.delete(tag);
      if (onClose) onClose();
    }, 400);
  };

  if (action && actionLabel) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "toast-action";
    btn.textContent = actionLabel;
    let acted = false;
    btn.onclick = (e) => {
      e.stopPropagation();
      if (acted || closed) return;
      acted = true;
      try {
        actionClick?.();
      } finally {
        removeToast();
      }
    };
    toast.appendChild(btn);
  }

  toast.querySelector(".toast-close").onclick = (e) => {
    e.stopPropagation();
    removeToast();
  };

  if (duration > 0) {
    timer = setTimeout(removeToast, duration);
  }

  container.appendChild(toast);
  if (tag) activeToasts.set(tag, toast);

  return toast;
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

let promptModal = null;
let promptAccept = null;
let promptPrevFocus = null;

function onPromptKeydown(e) {
  if (e.key !== "Escape") return;
  e.preventDefault();
  e.stopPropagation();
  closeOrokinPrompt();
}

function closeOrokinPrompt() {
  if (!promptModal || promptModal.modal.classList.contains("hidden")) return;
  promptModal.modal.classList.add("hidden");
  document.removeEventListener("keydown", onPromptKeydown, true);
  promptAccept = null;
  const prev = promptPrevFocus;
  promptPrevFocus = null;
  if (prev?.isConnected) prev.focus?.();
}

function acceptOrokinPrompt() {
  if (!promptModal) return;
  const value = promptModal.input.value.trim();
  if (!value) {
    promptModal.input.focus();
    return;
  }
  const cb = promptAccept;
  closeOrokinPrompt();
  if (typeof cb === "function") cb(value);
}

function ensureOrokinPrompt() {
  if (promptModal && promptModal.modal.isConnected) return promptModal;
  const modal = document.createElement("div");
  modal.id = "orokin-prompt-modal";
  modal.className = "hidden";
  modal.innerHTML = `
    <div class="modal-backdrop"></div>
    <div class="scan-result-card simple-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="orokin-prompt-msg" style="max-width: 400px; height: auto">
      <div style="padding: 25px 20px; text-align: center">
        <label id="orokin-prompt-msg" for="orokin-prompt-input" style="display: block; color: #eee; font-size: 1rem; margin-bottom: 16px"></label>
        <input id="orokin-prompt-input" type="text" class="wf-input" autocomplete="off" style="margin-bottom: 18px" />
        <div style="display: flex; gap: 12px; justify-content: center">
          <button id="orokin-prompt-confirm" type="button" class="action-btn confirm" style="flex: 1; font-weight: 700"></button>
          <button id="orokin-prompt-cancel" type="button" class="action-btn" style="background: transparent; border: 1px solid rgba(255, 68, 68, 0.4); color: #ff4444; flex: 1; cursor: pointer; padding: 10px 20px; text-transform: uppercase; font-weight: 700; transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1)"></button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(modal);

  const msgEl = modal.querySelector("#orokin-prompt-msg");
  const input = modal.querySelector("#orokin-prompt-input");
  const confirmBtn = modal.querySelector("#orokin-prompt-confirm");
  const cancelBtn = modal.querySelector("#orokin-prompt-cancel");

  modal.querySelector(".modal-backdrop").addEventListener("click", closeOrokinPrompt);
  cancelBtn.addEventListener("click", closeOrokinPrompt);
  confirmBtn.addEventListener("click", acceptOrokinPrompt);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      acceptOrokinPrompt();
    }
  });

  promptModal = { modal, msgEl, input, confirmBtn, cancelBtn };
  return promptModal;
}

export function showCustomPrompt(message, onAccept, defaultValue = "") {
  const ui = ensureOrokinPrompt();
  const t = TEXTS[state.currentLang] || {};

  if (!ui.modal.classList.contains("hidden")) {
    document.removeEventListener("keydown", onPromptKeydown, true);
  } else {
    promptPrevFocus = document.activeElement;
  }

  promptAccept = onAccept;
  ui.msgEl.textContent = message ?? "";
  ui.input.value = defaultValue == null ? "" : String(defaultValue);
  ui.confirmBtn.textContent = t.btnConfirm || "CONFIRM";
  ui.cancelBtn.textContent = t.btnCancel || "CANCEL";

  ui.modal.classList.remove("hidden");
  document.addEventListener("keydown", onPromptKeydown, true);
  ui.input.focus();
  if (ui.input.value) ui.input.select();
}

exposeGlobals({ showToast, qtyToast, closeOrokinConfirm }, "ui.components/ui_components.js");

export async function checkUpdates() {
  const lastSeenVersion = localStorage.getItem("last_seen_version");
  const currentVersionStr = String(APP_VERSION);

  if (!lastSeenVersion) {
    localStorage.setItem("last_seen_version", currentVersionStr);
    return;
  }

  if (lastSeenVersion !== currentVersionStr) {
    openUpdateHistory();
  }
}

export function openUpdateHistory() {
  const container = document.getElementById("update-history-content");
  if (container) {
    const history = UPDATE_HISTORY_DATA[state.currentLang] || UPDATE_HISTORY_DATA.en;
    container.innerHTML = history;
    document.getElementById("update-modal")?.classList.remove("hidden");
  }
}

export function closeUpdateModal() {
  document.getElementById("update-modal").classList.add("hidden");
  localStorage.setItem("last_seen_version", String(APP_VERSION));
  console.log("Versión guardada con éxito:", APP_VERSION);
}

// closed side panels stay in the focus order and CSS cannot fix it, so they get inert
export function keepPanelInertWhileClosed(panel) {
  if (!panel || panel.dataset.inertWatch) return;
  panel.dataset.inertWatch = "1";
  const sync = () => {
    const cerrado = !panel.classList.contains("open");
    for (const hijo of panel.children) {
      if (hijo.id?.endsWith("toggle-btn")) continue;
      hijo.inert = cerrado;
    }
  };
  new MutationObserver(sync).observe(panel, {
    attributes: true,
    attributeFilter: ["class"],
    childList: true,
  });
  sync();
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

    if (left < 8) left = 8;
    if (top < 8) top = 8;

    tooltipEl.style.left = `${left}px`;
    tooltipEl.style.top = `${top}px`;
  };

  const colocaFueraDe = (target, orden) => {
    const vista = { ancho: globalThis.innerWidth, alto: globalThis.innerHeight };
    const { left, top } = posicionFuera(target.getBoundingClientRect(), tooltipEl.offsetWidth, tooltipEl.offsetHeight, vista, orden);
    tooltipEl.style.left = `${left}px`;
    tooltipEl.style.top = `${top}px`;
  };

  const showTooltip = (e, target) => {
    if (closeTimer) clearTimeout(closeTimer);

    let htmlContent = target.dataset.tooltipHtml;
    const textContent = target.dataset.tooltip;
    const relicName = target.dataset.tooltipRelic;

    if (relicName) {
      htmlContent = getRelicDropTooltip(relicName);
    }

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
      colocaFueraDe(target, AL_LADO_PRIMERO);
    } else if (isTouchPointer() && e.detail !== 0) {
      moveSimpleTooltip(e);
    } else {
      const enBarraLateral = document.documentElement?.dataset.shell === "desktop" && target.closest(".card-top-bar");
      colocaFueraDe(target, enBarraLateral ? AL_LADO_PRIMERO : DEBAJO_PRIMERO);
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

  let openTimer = null;
  let currentHoverTarget = null;

  document.addEventListener("mouseover", (e) => {
    const target = e.target.closest("[data-tooltip], [data-tooltip-html], [data-tooltip-relic]");
    const isOverTooltip = e.target.closest("#global-tooltip");

    if (target || isOverTooltip) {
      if (closeTimer) clearTimeout(closeTimer);

      if (target && target !== currentHoverTarget) {
        if (openTimer) clearTimeout(openTimer);
        currentHoverTarget = target;
        openTimer = setTimeout(() => {
          showTooltip(e, target);
        }, 350);
      }
    }
  });

  document.addEventListener("mousemove", (e) => {
    if (currentMode === "simple" && isTouchPointer() && !tooltipEl.classList.contains("hidden")) {
      moveSimpleTooltip(e);
    }
  });

  document.addEventListener("mouseout", (e) => {
    const isTrigger = e.target.closest("[data-tooltip], [data-tooltip-html], [data-tooltip-relic]");
    const isTooltip = e.target.closest("#global-tooltip");

    if (isTrigger || isTooltip) {
      const related = e.relatedTarget;
      if (
        related &&
        (related.closest("[data-tooltip], [data-tooltip-html], [data-tooltip-relic]") ||
          related.closest("#global-tooltip"))
      ) {
        return;
      }
      currentHoverTarget = null;
      if (openTimer) clearTimeout(openTimer);
      hideTooltip();
    }
  });

  document.addEventListener("click", (e) => {
    let target = e.target.closest("[data-tooltip], [data-tooltip-html], [data-tooltip-relic]");
    if (e.target.closest("#global-tooltip")) return;
    // on touch the same tap runs the control, only tabs and links drop the tooltip
    if (target && isTouchPointer() && target.closest(".tab-btn, a[href]")) target = null;
    if (target) {
      const alreadyOpen = !tooltipEl.classList.contains("hidden") && currentHoverTarget === target;
      if (openTimer) clearTimeout(openTimer);
      if (alreadyOpen) {
        currentHoverTarget = null;
        tooltipEl.classList.add("hidden");
        tooltipEl.classList.remove("mega-mode");
      } else {
        currentHoverTarget = target;
        showTooltip(e, target);
      }
    } else if (!tooltipEl.classList.contains("hidden")) {
      currentHoverTarget = null;
      tooltipEl.classList.add("hidden");
      tooltipEl.classList.remove("mega-mode");
    }
  });

  document.addEventListener("focusin", (e) => {
    const target = e.target.closest?.("[data-tooltip], [data-tooltip-html], [data-tooltip-relic]");
    if (!target || target !== e.target || !target.matches(":focus-visible")) return;
    if (openTimer) clearTimeout(openTimer);
    currentHoverTarget = target;
    showTooltip(e, target);
  });

  document.addEventListener("focusout", (e) => {
    const target = e.target.closest?.("[data-tooltip], [data-tooltip-html], [data-tooltip-relic]");
    if (!target || target !== currentHoverTarget) return;
    if (e.relatedTarget?.closest?.("#global-tooltip")) return;
    currentHoverTarget = null;
    hideTooltip();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || tooltipEl.classList.contains("hidden")) return;
    if (openTimer) clearTimeout(openTimer);
    if (closeTimer) clearTimeout(closeTimer);
    currentHoverTarget = null;
    tooltipEl.classList.add("hidden");
    tooltipEl.classList.remove("mega-mode");
  });
}

export function initDisclaimerSystem() {
  setTimeout(() => {
    const disclaimer = document.getElementById("txt-disclaimer");
    if (!disclaimer) return;
    if (getComputedStyle(disclaimer).position === "static") return;
    disclaimer.classList.add("fade-out");
    setTimeout(() => {
      disclaimer.style.display = "none";
    }, 2000);
  }, 8000);
}
