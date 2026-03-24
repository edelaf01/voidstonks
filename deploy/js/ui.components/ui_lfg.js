import { state, saveAppState } from "../state.js";
import { TEXTS } from "../config.js";
import { showToast, escapeHTML } from "./ui_components.js";
import {
  getItemIcon,
  getSetName,
  getRequiredCount,
  generateDotsHtml,
} from "./ui_utils.js";
export function changeLFGCount(n) {
  state.lfgCount = Math.max(1, Math.min(3, state.lfgCount + n));
  const display = document.getElementById("lfgCountDisplay");
  if (display) display.innerText = state.lfgCount;
  generateLFGMessage();
}

export function generateLFGMessage() {
  const act = document.getElementById("lfgActivity")?.value;
  const extra = document.getElementById("lfgExtra")?.value.trim() || "";
  const t = TEXTS[state.currentLang];

  let activityName = t.lfgOpts[act] || act?.toUpperCase();
  let msg = `H ${activityName}`;

  if (act === "eidolon") {
    const runs = document.getElementById("lfg-eidolon-runs")?.value || "3x3";
    msg = `H ${activityName} ${runs}`;
    const roles = Array.from(
      document.querySelectorAll(".lfg-role:checked"),
    ).map((c) => c.value);
    if (roles.length > 0) msg += ` LF ${roles.join("/")}`;
  }

  if (extra) msg += ` ${extra}`;
  msg += ` ${state.lfgCount}/4`;

  const box = document.getElementById("finalMessage");
  if (box) box.innerText = msg;
}

// Exponer para el HTML
Object.assign(globalThis, {
  changeLFGCount,
  generateLFGMessage,
  toggleLfgDropdown: () =>
    document.getElementById("lfgDropdown").classList.toggle("hidden"),
  selectLfgOption: (val, txt) => {
    document.getElementById("lfgActivity").value = val;
    document.getElementById("lfgSelectedText").innerText = txt;
    document.getElementById("lfgDropdown").classList.add("hidden");
    globalThis.updateLFGUI();
    saveAppState();
  },
});
