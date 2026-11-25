import { state } from "../state.js";
import { TEXTS } from "../config.js";

const STORAGE_KEY = "vs:tutorial:nav:v1";
const AUTO_DELAY_MS = 2500;
const FOCUSABLE =
  'button:not([disabled]):not([hidden]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const BLOCKING_MODAL = [
  ".palette-veil:not(.hidden)",
  "#scan-success-modal:not(.hidden)",
  "#grading-modal:not(.hidden)",
  "#update-modal:not(.hidden)",
  "#calibration-modal:not(.hidden)",
  "#orokin-confirm-modal:not(.hidden)",
  "#ds-permisos",
  ".orders-modal-backdrop",
  '[role="dialog"]',
  '[aria-modal="true"]',
].join(",");

let veil = null;
let dialog = null;
let titleEl = null;
let progressEl = null;
let dotsEl = null;
let stepTitleEl = null;
let stepBodyEl = null;
let closeXBtn = null;
let backBtn = null;
let closeBtn = null;
let nextBtn = null;
let trigger = null;
let stepIndex = 0;
let lastFocus = null;
let autoTimer = null;
let initialized = false;

const t = () => (TEXTS[state.currentLang] || TEXTS.es).tutorial || TEXTS.es.tutorial;

function currentSteps() {
  const copy = t();
  const coarse = Boolean(globalThis.matchMedia?.("(pointer: coarse)").matches);
  return (coarse ? copy.mobile : copy.desktop) || [];
}

function hasSeen() {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return true;
  }
}

function markSeen() {
  try {
    localStorage.setItem(STORAGE_KEY, "1");
  } catch {}
}

function hasOpenModal() {
  if (document.body.classList.contains("palette-open")) return true;
  for (const el of document.querySelectorAll(BLOCKING_MODAL)) {
    if (veil?.contains(el)) continue;
    if (el.closest(".hidden, [hidden]")) continue;
    if (getComputedStyle(el).display === "none") continue;
    if (el.getClientRects().length > 0) return true;
  }
  return false;
}

function fillText(el, str) {
  el.textContent = "";
  for (const part of String(str || "").split(/(<kbd>[^<]+<\/kbd>)/g)) {
    if (!part) continue;
    if (part.startsWith("<kbd>") && part.endsWith("</kbd>")) {
      const kbd = document.createElement("kbd");
      kbd.className = "tutorial-kbd";
      kbd.textContent = part.slice(5, -6);
      el.appendChild(kbd);
    } else {
      el.appendChild(document.createTextNode(part));
    }
  }
}

function getFocusables() {
  return [...dialog.querySelectorAll(FOCUSABLE)].filter(
    (el) => !el.closest(".hidden, [hidden]") && getComputedStyle(el).display !== "none",
  );
}

function onKeydown(e) {
  if (!veil || veil.classList.contains("hidden")) return;
  if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    closeTutorial();
    return;
  }
  if (e.key !== "Tab") return;
  const items = getFocusables();
  if (!items.length) {
    e.preventDefault();
    dialog.focus();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  if (e.shiftKey) {
    if (document.activeElement === first || !dialog.contains(document.activeElement)) {
      e.preventDefault();
      last.focus();
    }
  } else if (document.activeElement === last || !dialog.contains(document.activeElement)) {
    e.preventDefault();
    first.focus();
  }
}

function build() {
  veil = document.createElement("div");
  veil.className = "tutorial-veil hidden";

  dialog = document.createElement("div");
  dialog.className = "tutorial-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "tutorial-title");
  dialog.setAttribute("aria-describedby", "tutorial-body");
  dialog.tabIndex = -1;

  const header = document.createElement("div");
  header.className = "tutorial-header";

  titleEl = document.createElement("h2");
  titleEl.id = "tutorial-title";
  titleEl.className = "tutorial-title";

  closeXBtn = document.createElement("button");
  closeXBtn.type = "button";
  closeXBtn.className = "tutorial-close-x vs-plain";
  closeXBtn.textContent = "×";
  closeXBtn.addEventListener("click", () => closeTutorial());

  header.append(titleEl, closeXBtn);

  const meta = document.createElement("div");
  meta.className = "tutorial-meta";

  progressEl = document.createElement("span");
  progressEl.className = "tutorial-progress";
  progressEl.setAttribute("aria-live", "polite");

  dotsEl = document.createElement("span");
  dotsEl.className = "tutorial-dots";
  dotsEl.setAttribute("aria-hidden", "true");

  meta.append(progressEl, dotsEl);

  const content = document.createElement("div");
  content.className = "tutorial-content";

  stepTitleEl = document.createElement("h3");
  stepTitleEl.className = "tutorial-step-title";

  stepBodyEl = document.createElement("p");
  stepBodyEl.id = "tutorial-body";
  stepBodyEl.className = "tutorial-step-body";

  content.append(stepTitleEl, stepBodyEl);

  const actions = document.createElement("div");
  actions.className = "tutorial-actions";

  backBtn = document.createElement("button");
  backBtn.type = "button";
  backBtn.className = "tutorial-btn tutorial-btn-secondary";
  backBtn.addEventListener("click", () => goStep(stepIndex - 1));

  const actionsEnd = document.createElement("div");
  actionsEnd.className = "tutorial-actions-end";

  closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "tutorial-btn tutorial-btn-secondary";
  closeBtn.addEventListener("click", () => closeTutorial());

  nextBtn = document.createElement("button");
  nextBtn.type = "button";
  nextBtn.className = "tutorial-btn tutorial-btn-primary";
  nextBtn.addEventListener("click", () => goStep(stepIndex + 1));

  actionsEnd.append(closeBtn, nextBtn);
  actions.append(backBtn, actionsEnd);

  dialog.append(header, meta, content, actions);
  veil.appendChild(dialog);
  document.body.appendChild(veil);

  veil.addEventListener("pointerdown", (e) => {
    if (e.target === veil) closeTutorial();
  });
}

function render() {
  if (!veil) return;
  const copy = t();
  const steps = currentSteps();
  if (!steps.length) return;
  if (stepIndex >= steps.length) stepIndex = steps.length - 1;
  const step = steps[stepIndex];
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === steps.length - 1;

  titleEl.textContent = copy.title;
  closeXBtn.setAttribute("aria-label", copy.close);
  closeXBtn.title = copy.close;
  progressEl.textContent = copy.stepOf
    .replace("{n}", String(stepIndex + 1))
    .replace("{total}", String(steps.length));

  dotsEl.textContent = "";
  for (let i = 0; i < steps.length; i++) {
    const dot = document.createElement("span");
    dot.className = i === stepIndex ? "tutorial-dot is-active" : "tutorial-dot";
    dotsEl.appendChild(dot);
  }

  stepTitleEl.textContent = step.title;
  fillText(stepBodyEl, step.body);

  backBtn.textContent = copy.back;
  backBtn.disabled = isFirst;

  closeBtn.textContent = copy.close;
  closeBtn.className = isLast
    ? "tutorial-btn tutorial-btn-primary"
    : "tutorial-btn tutorial-btn-secondary";

  nextBtn.textContent = copy.next;
  nextBtn.hidden = isLast;
}

function goStep(nextIndex) {
  const steps = currentSteps();
  if (!steps.length) return;
  const clamped = Math.max(0, Math.min(steps.length - 1, nextIndex));
  if (clamped === stepIndex) return;
  const activeEl = document.activeElement;
  stepIndex = clamped;
  render();
  if (activeEl === nextBtn && nextBtn.hidden) {
    closeBtn.focus();
  } else if (activeEl === backBtn && backBtn.disabled) {
    (nextBtn.hidden ? closeBtn : nextBtn).focus();
  }
}

function applyTriggerTexts() {
  if (!trigger) return;
  const label = t().triggerLabel || t().title;
  trigger.setAttribute("aria-label", label);
  trigger.title = label;
}

export function openTutorial() {
  if (autoTimer) {
    clearTimeout(autoTimer);
    autoTimer = null;
  }
  if (!veil) build();
  if (!veil.classList.contains("hidden")) return;
  markSeen();
  lastFocus = document.activeElement;
  stepIndex = 0;
  render();
  veil.classList.remove("hidden");
  document.body.classList.add("tutorial-open");
  document.addEventListener("keydown", onKeydown, true);
  (nextBtn.hidden ? closeBtn : nextBtn).focus();
}

export function closeTutorial() {
  if (!veil || veil.classList.contains("hidden")) return;
  markSeen();
  veil.classList.add("hidden");
  document.body.classList.remove("tutorial-open");
  document.removeEventListener("keydown", onKeydown, true);
  if (lastFocus?.isConnected) lastFocus.focus?.();
  lastFocus = null;
}

export function initTutorial() {
  trigger = document.getElementById("btn-tutorial-trigger");
  if (trigger) {
    applyTriggerTexts();
    if (!initialized) trigger.addEventListener("click", () => openTutorial());
  }
  if (initialized) return;
  initialized = true;
  state.subscribe("currentLang", () => {
    applyTriggerTexts();
    if (veil && !veil.classList.contains("hidden")) render();
  });
  if (!hasSeen()) {
    autoTimer = setTimeout(() => {
      autoTimer = null;
      if (!hasSeen() && !hasOpenModal()) openTutorial();
    }, AUTO_DELAY_MS);
  }
}
