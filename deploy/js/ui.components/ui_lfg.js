import { state, saveAppState } from "../state.js";
import { TEXTS } from "../config.js";
import { showToast, escapeHTML } from "./ui_components.js";

let lfgRafId = null;

export function changeLFGCount(n) {
  state.lfgCount = Math.max(1, Math.min(3, state.lfgCount + n));
  const display = document.getElementById("lfgCountDisplay");
  if (display) display.innerText = state.lfgCount;
  generateLFGMessage();
}

export function updateLFGUI() {
  initLFGPresets();
  const act = document.getElementById("lfgActivity").value;
  const container = document.getElementById("lfg-dynamic-options");
  const t = TEXTS[state.currentLang];
  const roles = t.lfgRoles || {};
  const tips = t.tooltips || {};

  container.innerHTML = "";

  const createInfo = (text) => {
    if (!text) return "";
    return `<div style="margin-bottom:10px; font-size:0.85em; color:#888; border-left:2px solid var(--active-theme-color, var(--wf-blue)); padding-left:8px;">${text}</div>`;
  };

  if (act === "eda") {
    container.innerHTML = `
            ${createInfo(tips.eda)}
            <label class="lfg-checkbox-wrapper" style="margin-bottom:10px;">
                <input type="checkbox" id="lfg-eda-elite" checked onchange="generateLFGMessage()"> 
                <span class="lfg-label">${roles.elite}</span>
            </label>`;
  } else if (act === "temporal") {
    container.innerHTML = `
            ${createInfo(tips.temporal)}
            <label class="lfg-checkbox-wrapper" style="margin-bottom:10px;">
                <input type="checkbox" id="lfg-temp-elite" onchange="generateLFGMessage()"> 
                <span class="lfg-label">${roles.elite}</span>
            </label>`;
  } else if (act === "netra") {
    container.innerHTML = createInfo(tips.netra);
  } else if (act === "eidolon") {
    container.innerHTML = `
            <div style="margin-bottom:10px;">
                <label style="font-size:0.8em; color:#888; margin-bottom:5px; display:block;">Pace / Ritmo <span data-tooltip="${tips.rotation || "Rotation info"
      }">(?)</span></label>
                <select id="lfg-eidolon-runs" class="wf-input" onchange="generateLFGMessage()">
                    <option value="3x3">${roles.run3x3}</option>
                    <option value="5x3">${roles.run5x3}</option>
                    <option value="6x3">${roles.run6x3}</option>
                    <option value="casual">${roles.casual}</option>
                </select>
            </div>
            <div class="lfg-grid">
                ${createCheckbox("DPS", roles.dps, tips.dps)}
                ${createCheckbox("VS", "VS", tips.vs)}
                ${createCheckbox("Lures", roles.lure, tips.lure)}
                ${createCheckbox("Volt", roles.volt, tips.volt)}
                ${createCheckbox("Harrow", roles.harrow, tips.harrow)}
                ${createCheckbox("Wisp", roles.wisp, tips.wisp)}
            </div>`;
  } else if (act === "profit") {
    container.innerHTML = `
            ${createInfo(tips.profit)} 
            <div class="lfg-grid">
                ${createCheckbox("Chroma", "Chroma")}
                ${createCheckbox("Volt", "Volt")}
                ${createCheckbox("Saryn", "Saryn")}
                ${createCheckbox("Zenith", "Zenith")}
            </div>`;
  } else if (act === "arbi") {
    container.innerHTML = `
            ${createInfo(tips.arbi)}
            <select id="lfg-arbi-type" class="wf-input" onchange="generateLFGMessage()">
                <option value="Meta">${roles.meta}</option>
                <option value="Normal">${roles.casual}</option>
            </select>`;
  } else if (act === "circuit") {
    container.innerHTML = `
            ${createInfo(tips.circuit)}
            <select id="lfg-circuit-mode" class="wf-input" onchange="generateLFGMessage()">
                <option value="normal">${roles.normal || "Normal"}</option>
                <option value="SP">${roles.steelpath || "Steel Path"}</option>
            </select>`;
  } else if (act === "eso" || act === "so") {
    container.innerHTML = `
            ${createInfo(act === "eso" ? tips.eso : tips.so)}
            <div class="lfg-grid">
                ${createCheckbox("Saryn", roles.saryn || "Saryn", tips.saryn)}
                ${createCheckbox("Mirage", roles.mirage || "Mirage", tips.mirage)}
                ${createCheckbox("Volt", "Volt", tips.volt)}
                ${createCheckbox("Support", roles.support || "Support", tips.support)}
                ${createCheckbox("DPS", roles.dps, tips.dps)}
            </div>`;
  } else if (act === "isovault") {
    container.innerHTML = `
            ${createInfo(tips.isovault)}
            <select id="lfg-isovault-tier" class="wf-input" onchange="generateLFGMessage()">
                <option value="T1">T1</option>
                <option value="T2">T2</option>
                <option value="T3" selected>T3</option>
            </select>`;
  } else if (act === "kuva") {
    container.innerHTML = `
            ${createInfo(tips.kuva)}
            <select id="lfg-kuva-type" class="wf-input" onchange="generateLFGMessage()">
                <option value="Survival">${roles.kuvaSurvival || "Survival"}</option>
                <option value="Flood">Flood</option>
                <option value="Siphon">Siphon</option>
            </select>`;
  } else if (act === "archon") {
    container.innerHTML = createInfo(tips.archon);
  } else if (act === "sortie") {
    container.innerHTML = createInfo(tips.sortie);
  } else if (act === "radshare") {
    container.innerHTML = `
            <div style="padding:10px; background:#1a1c20; border:1px dashed #444; color:#aaa; font-size:0.9em;">
                <span data-tooltip="${tips.radshare || ""}">${t.lfgOpts.radshareInfo
      }</span>
            </div>`;
  }
  generateLFGMessage();
}

function createCheckbox(val, label, tip = "") {
  const tooltip = tip ? `data-tooltip="${tip}"` : "";
  return `<label class="lfg-checkbox-wrapper"><input type="checkbox" class="lfg-role" value="${val}" onchange="generateLFGMessage()"> <span class="lfg-label" ${tooltip}>${label}</span></label>`;
}

export function generateLFGMessage() {
  if (lfgRafId) cancelAnimationFrame(lfgRafId);

  lfgRafId = requestAnimationFrame(() => {
    lfgRafId = null;

    const actEl = document.getElementById("lfgActivity");
    const extraEl = document.getElementById("lfgExtra");

    if (!actEl) return;

    const act = actEl.value;
    const extra = extraEl ? extraEl.value.trim() : "";

    const t = TEXTS[state.currentLang];
    const opts = t.lfgOpts || {};

    let activityName = opts[act] || act.toUpperCase();
    let msg = `H ${activityName}`;

    const optionsContainer = document.getElementById("lfg-dynamic-options");
    const getRoles = () => {
      if (!optionsContainer) return [];
      return Array.from(
        optionsContainer.querySelectorAll(".lfg-role:checked"),
      ).map((c) => c.value);
    };

    if (act === "eidolon") {
      const runsEl = document.getElementById("lfg-eidolon-runs");
      const runs = runsEl ? runsEl.value : "3x3";

      msg = `H ${activityName} ${runs}`;
      const roles = getRoles();
      if (roles.length > 0) msg += ` LF ${roles.join("/")}`;
    } else if (act === "netra") {
      msg = `H ${activityName}`;
    } else if (act === "temporal") {
      const eliteEl = document.getElementById("lfg-temp-elite");
      //TODO deja vu not following DRY
      const prefix = eliteEl?.checked
        ? state.currentLang === "es"
          ? "Élite "
          : "Elite "
        : "";
      msg = `H ${prefix}${activityName}`;
    } else if (act === "eda") {
      const eliteEl = document.getElementById("lfg-eda-elite");
      const prefix = eliteEl?.checked
        //TODO deja vu not following DRY

        ? state.currentLang === "es"
          ? "Élite "
          : "Elite "
        : "";
      msg = `H ${prefix}${activityName}`;
    } else if (act === "profit") {
      msg = `H ${activityName}`;
      const roles = getRoles();
      if (roles.length > 0) msg += ` LF ${roles.join("/")}`;
    } else if (act === "arbi") {
      const arbiTypeEl = document.getElementById("lfg-arbi-type");
      if (arbiTypeEl) {
        msg = `H ${arbiTypeEl.value} ${activityName}`;
      }
    } else if (act === "circuit") {
      const modeEl = document.getElementById("lfg-circuit-mode");
      const prefix = modeEl?.value === "SP" ? "SP " : "";
      msg = `H ${prefix}${activityName}`;
    } else if (act === "eso" || act === "so") {
      msg = `H ${activityName}`;
      const roles = getRoles();
      if (roles.length > 0) msg += ` LF ${roles.join("/")}`;
    } else if (act === "isovault") {
      const tierEl = document.getElementById("lfg-isovault-tier");
      const tier = tierEl ? tierEl.value : "T3";
      msg = `H ${tier} ${activityName}`;
    } else if (act === "kuva") {
      const typeEl = document.getElementById("lfg-kuva-type");
      const type = typeEl ? typeEl.value : "Survival";
      msg = `H ${activityName} ${type}`;
    }

    if (extra) msg += ` ${extra}`;

    const count = state?.lfgCount ? state.lfgCount : 1;
    msg += ` ${count}/4`;

    const box = document.getElementById("finalMessage");
    if (box && box.innerText !== msg) {
      box.innerText = msg;
    }
  });
}

export function toggleLfgDropdown() {
  document.getElementById("lfgDropdown").classList.toggle("hidden");
}

export function selectLfgOption(value, text) {
  document.getElementById("lfgActivity").value = value;
  document.getElementById("lfgSelectedText").innerText = text;
  document.getElementById("lfgDropdown").classList.add("hidden");
  updateLFGUI();
  saveAppState();
}

export function initLFGPresets() {
  const lfgContainer = document.getElementById("mode-lfg");
  if (!lfgContainer || document.getElementById("lfg-presets-area")) return;

  const presetArea = document.createElement("div");
  presetArea.id = "lfg-presets-area";
  presetArea.className = "lfg-presets-container";

  const activityGroup = lfgContainer.querySelector(".form-group");
  activityGroup.after(presetArea);

  renderLFGPresets();

  if (!document.getElementById("trade-presets-area")) {
    const tradeArea = document.createElement("div");
    tradeArea.id = "trade-presets-area";
    tradeArea.className = "lfg-presets-container";
    presetArea.after(tradeArea);
    renderTradePresets();
  }
}

export function renderTradePresets() {
  const container = document.getElementById("trade-presets-area");
  if (!container) return;

  const t = TEXTS[state.currentLang].tradePresets || {};
  const currentText = document.getElementById("trade-msg-input")?.value || "";

  let html = `<div class="presets-header">
                  <span style="font-size:0.85em; font-weight:bold; color:#888;">${escapeHTML(
    t.title || "Trade Messages",
  )}</span>
                  <button class="mini-action-btn" data-action="save-trade-preset">+ ${escapeHTML(
    t.btnSave || "Save",
  )}</button>
                </div>
                <textarea id="trade-msg-input" class="wf-input" rows="2"
                  placeholder="${escapeHTML(t.placeholderText || "WTS [Arcane Energize] 100p")}"
                  style="width:100%; resize:vertical; margin-bottom:8px; font-size:0.85em;">${escapeHTML(currentText)}</textarea>`;

  if (!state.tradePresets || state.tradePresets.length === 0) {
    html += `<div style="font-size:0.8em; color:#555; font-style:italic; padding:5px;">${escapeHTML(
      t.empty || "No saved trade messages.",
    )}</div>`;
  } else {
    html += `<div class="presets-list">`;
    state.tradePresets.forEach((p, index) => {
      html += `
                <div class="preset-chip" data-action="load-trade-preset" data-index="${index}" title="${escapeHTML(p.text)}">
                    <span class="p-name">${escapeHTML(p.name)}</span>
                    <button class="p-del" data-action="delete-trade-preset" data-index="${index}">×</button>
                </div>
            `;
    });
    html += `</div>`;
  }

  container.innerHTML = html;
}

const saveTradePreset = function () {
  const t = TEXTS[state.currentLang].tradePresets || {};
  const text = (document.getElementById("trade-msg-input")?.value || "").trim();
  if (!text) {
    showToast(t.emptyMsg || "Write a message first");
    return;
  }
  const name = prompt(t.placeholderName || "Preset name");
  if (!name) return;

  if (!state.tradePresets) state.tradePresets = [];
  state.tradePresets.push({ name, text });
  saveAppState();
  renderTradePresets();
};

const loadTradePreset = function (index) {
  const p = state.tradePresets[index];
  if (!p) return;
  const input = document.getElementById("trade-msg-input");
  if (input) input.value = p.text;
  navigator.clipboard
    .writeText(p.text)
    .then(() => showToast(TEXTS[state.currentLang].tradePresets?.copied || "Copied!"))
    .catch((err) => console.error("Error al copiar: ", err));
};

const deleteTradePreset = function (index) {
  const t = TEXTS[state.currentLang].tradePresets || {};
  if (confirm(t.deleteConfirm || "Delete this preset?")) {
    state.tradePresets.splice(index, 1);
    saveAppState();
    renderTradePresets();
  }
};

export function renderLFGPresets() {
  const container = document.getElementById("lfg-presets-area");
  if (!container) return;

  const t = TEXTS[state.currentLang].lfgPresets;

  let html = `<div class="presets-header">
                  <span style="font-size:0.85em; font-weight:bold; color:#888;">${escapeHTML(
    t.title,
  )}</span>
                  <button class="mini-action-btn" data-action="save-lfg-preset">+ ${escapeHTML(
    t.btnSave,
  )}</button>
                </div>`;

  if (!state.lfgPresets || state.lfgPresets.length === 0) {
    html += `<div style="font-size:0.8em; color:#555; font-style:italic; padding:5px;">${escapeHTML(
      t.empty,
    )}</div>`;
  } else {
    html += `<div class="presets-list">`;
    state.lfgPresets.forEach((p, index) => {
      html += `
                <div class="preset-chip" data-action="load-lfg-preset" data-index="${index}">
                    <span class="p-name">${escapeHTML(p.name)}</span>
                    <span class="p-act">${escapeHTML(
        p.activity.toUpperCase(),
      )}</span>
                    <button class="p-del" data-action="delete-lfg-preset" data-index="${index}">×</button>
                </div>
            `;
    });
    html += `</div>`;
  }

  container.innerHTML = html;
}

const saveLFGPreset = function () {
  const t = TEXTS[state.currentLang].lfgPresets;
  const name = prompt(t.placeholder);
  if (!name) return;

  const activity = document.getElementById("lfgActivity").value;
  const extra = document.getElementById("lfgExtra").value;
  const count = state.lfgCount;

  const roles = Array.from(document.querySelectorAll(".lfg-role:checked")).map(
    (c) => c.value,
  );

  const specificData = {};
  const runsEl = document.getElementById("lfg-eidolon-runs");
  if (runsEl) specificData.runs = runsEl.value;

  const arbiEl = document.getElementById("lfg-arbi-type");
  if (arbiEl) specificData.arbiType = arbiEl.value;

  const eliteEda = document.getElementById("lfg-eda-elite");
  if (eliteEda) specificData.elite = eliteEda.checked;

  const eliteTemp = document.getElementById("lfg-temp-elite");
  if (eliteTemp) specificData.eliteTemp = eliteTemp.checked;

  const newPreset = { name, activity, extra, count, roles, specificData };

  if (!state.lfgPresets) state.lfgPresets = [];
  state.lfgPresets.push(newPreset);
  saveAppState();
  renderLFGPresets();
};

const loadLFGPreset = function (index) {
  const p = state.lfgPresets[index];
  if (!p) return;

  document.getElementById("lfgActivity").value = p.activity;

  const t = TEXTS[state.currentLang];
  const actName = t.lfgOpts[p.activity] || p.activity;
  document.getElementById("lfgSelectedText").innerText = actName;

  updateLFGUI();

  document.getElementById("lfgExtra").value = p.extra || "";

  state.lfgCount = p.count || 1;
  document.getElementById("lfgCountDisplay").innerText = state.lfgCount;

  if (p.roles && p.roles.length > 0) {
    p.roles.forEach((rVal) => {
      const chk = document.querySelector(`.lfg-role[value="${rVal}"]`);
      if (chk) chk.checked = true;
    });
  }

  if (p.specificData) {
    if (p.specificData.runs) {
      const el = document.getElementById("lfg-eidolon-runs");
      if (el) el.value = p.specificData.runs;
    }
    if (p.specificData.arbiType) {
      const el = document.getElementById("lfg-arbi-type");
      if (el) el.value = p.specificData.arbiType;
    }
    if (p.specificData.elite !== undefined) {
      const el = document.getElementById("lfg-eda-elite");
      if (el) el.checked = p.specificData.elite;
    }
    if (p.specificData.eliteTemp !== undefined) {
      const el = document.getElementById("lfg-temp-elite");
      if (el) el.checked = p.specificData.eliteTemp;
    }
  }

  generateLFGMessage();
  showToast(`Preset "${p.name}" cargado`);
};

const deleteLFGPreset = function (index) {
  if (confirm(TEXTS[state.currentLang].lfgPresets.deleteConfirm)) {
    state.lfgPresets.splice(index, 1);
    saveAppState();
    renderLFGPresets();
  }
};

Object.assign(globalThis, {
  changeLFGCount,
  generateLFGMessage,
  toggleLfgDropdown,
  selectLfgOption,
  saveLFGPreset,
  loadLFGPreset,
  deleteLFGPreset,
  saveTradePreset,
  loadTradePreset,
  deleteTradePreset,
  copyText,
});

export function copyText() {
  const textToCopy = document.getElementById("finalMessage").innerText;
  navigator.clipboard
    .writeText(textToCopy)
    .then(() => import("./ui_components.js").then(m => m.showToast("Message Copied!")))
    .catch((err) => console.error("Error al copiar: ", err));
}
