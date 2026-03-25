import { state } from "../state.js";
import { TEXTS, RIVEN_STATS } from "../config.js";
import { calculateRivenGrade } from "../riven_logic.js";
import { getRivenSlug, fetchRivenAverage } from "../api.js";
import {
  getItemIcon,
  getSetName,
  getRequiredCount,
  generateDotsHtml,
} from "./ui_utils.js";
import { escapeHTML, showToast } from "./ui_components.js";

let rivenDebounceTimer;
let gradeDebounceTimer;

/**
 * Normalizador Dinámico: Traduce nombres de la UI a nombres técnicos de la DB.
 */
const normalizeStatName = (name) => {
  if (!name) return "";
  return name
    .replaceAll(/\bCrit\b/g, "Critical")
    .replaceAll(/\bDmg\b/g, "Damage")
    .replaceAll(/\bStats\b/g, "Status")
    .trim();
};

if (!globalThis._rivenTooltipListenerAdded) {
  document.addEventListener("click", function (event) {
    const preview = document.querySelector(
      ".riven-weapon-preview.mobile-active",
    );
    if (preview && !preview.contains(event.target)) {
      preview.classList.remove("mobile-active");
    }
  });
  globalThis._rivenTooltipListenerAdded = true;
}

// --- LÓGICA DE UI Y PREVIEW ---

export function populateRivenSelects(weaponType = "Rifle") {
  const selects = document.querySelectorAll(".riven-stat-select");
  const isSpan = state.currentLang === "es";

  selects.forEach((sel) => {
    const currentValue = sel.value;
    const fragment = document.createDocumentFragment();

    const defOpt = document.createElement("option");
    defOpt.value = "";
    defOpt.textContent = sel.classList.contains("negative")
      ? "- NEGATIVA"
      : "+ STAT";
    fragment.appendChild(defOpt);

    RIVEN_STATS.forEach((stat) => {
      const opt = document.createElement("option");
      const statName = isSpan ? stat.name_es : stat.name_en;
      opt.value = stat.name_en;
      opt.textContent = statName;
      fragment.appendChild(opt);
    });

    sel.replaceChildren(fragment);
    sel.value = currentValue;
  });
  updateSelectExclusions();
}

export async function loadWeaponDetails() {
  if (state.weaponDetailsDB) return;
  try {
    const res = await fetch("assets/json/cleaned_weapons.json");
    if (!res.ok)
      throw new Error("Failed to load weapon details from UI fallback");
    const data = await res.json();
    state.weaponDetailsDB = data;
  } catch (e) {
    console.error("Error loading weapon details:", e);
  }
}

export function renderRivenPreview(weaponName) {
  const panel = document.getElementById("riven-preview-panel");
  if (!panel) return;

  if (!weaponName) {
    panel.replaceChildren();
    const carousel = document.getElementById("riven-variants-carousel");
    if (carousel) carousel.dataset.baseWeapon = "";
    return;
  }

  const details = getWeaponDetails(weaponName);
  const basic = state.weaponMap ? state.weaponMap[weaponName] : null;

  if (!details && !basic) {
    panel.replaceChildren();
    return;
  }

  const dispoData = getDispositionData(details, basic);
  const imgPath = getWeaponImagePath(weaponName, details);
  const tooltipHtml = buildTooltipHtml(details);

  updatePreviewDOM(panel, imgPath, dispoData, tooltipHtml);
  renderVariants(weaponName);
}

function getWeaponDetails(weaponName) {
  if (!state.weaponDetailsDB) return null;
  let details = state.weaponDetailsDB.find(
    (w) => w.name.toUpperCase() === weaponName.toUpperCase(),
  );
  if (!details && !weaponName.includes("Prime")) {
    details = state.weaponDetailsDB.find(
      (w) => w.name.toUpperCase() === (weaponName + " PRIME").toUpperCase(),
    );
  }
  return details;
}

function getDispositionData(details, basic) {
  let dispoValue = 1;
  if (basic) {
    dispoValue = basic.d;
  }
  let circles = 0;
  if (dispoValue < 0.7) circles = 1;
  else if (dispoValue < 0.9) circles = 2;
  else if (dispoValue <= 1.1) circles = 3;
  else if (dispoValue <= 1.3) circles = 4;
  else circles = 5;

  let circlesHtml = "";
  for (let i = 1; i <= 5; i++) {
    circlesHtml += `<div class="dispo-circle ${i <= circles ? "filled" : ""}"></div>`;
  }
  return { value: dispoValue, circles, circlesHtml };
}

function getWeaponImagePath(weaponName, details) {
  let imgPath = weaponName.toUpperCase().includes("PRIME")
    ? getItemIcon(weaponName)
    : "";

  if (!imgPath && details?.localImage) {
    let rawPath = details.localImage.replace(".png", ".webp");
    if (rawPath.startsWith("weapons/"))
      rawPath = rawPath.replace("weapons/", "relic_contents/");
    imgPath = `assets/${rawPath}`;
  }

  if (!imgPath) {
    const slug = weaponName
      .toLowerCase()
      .replaceAll(/[\s-]+/g, "_")
      .replaceAll(/[^a-z0-9_]/g, "")
      .replaceAll(/_+/g, "_");
    imgPath = `assets/relic_contents/${slug}.webp`;
  }
  return imgPath;
}

function buildTooltipHtml(details) {
  if (!details) return "";
  const nameUpper = details.name.toUpperCase();
  const isLichPrefix =
    nameUpper.startsWith("KUVA") ||
    nameUpper.startsWith("TENET") ||
    nameUpper.startsWith("CODA");
  const isShopItem = details.components?.some((c) =>
    c.name.toUpperCase().includes("HOLOKEY"),
  );
  const isLichWeapon = isLichPrefix && !isShopItem;

  if (!details.components?.length && !isLichWeapon) return "";

  const weaponWikiUrl = `https://wiki.warframe.com/w/${encodeURIComponent(details.name)}`;
  let html = `<div class="preview-tooltip"><h4><a href="${weaponWikiUrl}" target="_blank" class="wiki-link" style="color:var(--wf-purple); border-bottom-color:var(--wf-purple);">${details.name}</a></h4>`;

  if (details.components?.length && !isLichWeapon) {
    html += buildComponentsHtml(details.components);
    html += buildDropsHtml(details.components);
  } else if (isLichWeapon) {
    html += buildLichHtml(nameUpper);
  }

  html += `</div>`;
  return html;
}

function buildComponentsHtml(components) {
  let html = `<div class="tooltip-section"><span class="tooltip-section-title">Requirements</span>`;
  html += components
    .map((c) => {
      const cImgPath = getItemIcon(c.name);
      const isItemInteractive = c.name.includes("Prime");
      const escapedName = c.name.replaceAll("'", String.raw`\'`);
      const onclickAttr = isItemInteractive
        ? `onclick="event.stopPropagation(); globalThis.openSetFromRelicReward('${escapedName}')" title="Ver Set de ${c.name}"`
        : "";

      return `<div class="tooltip-drop-row ${isItemInteractive ? "item-interactive" : ""}" ${onclickAttr}><span style="display:flex; align-items:center;"><img src="${cImgPath}" class="tooltip-res-img" onerror="this.style.display='none'">${c.itemCount}x ${c.name}</span><span style="color:#888">${c.ducats || 0}<img src="assets/Ducats.webp" class="ducat-icon"></span></div>`;
    })
    .join("");
  html += `</div>`;
  return html;
}

function buildDropsHtml(components) {
  const allDrops = [];
  components.forEach((c) => {
    if (c.drops) {
      c.drops.forEach((d) =>
        allDrops.push({ loc: d.location, chance: d.chance, rarity: d.rarity }),
      );
    }
  });

  const relevantDrops = allDrops
    .filter((d) => d.loc && !d.loc.includes("Vaulted"))
    .sort((a, b) => b.chance - a.chance)
    .slice(0, 8);

  if (relevantDrops.length === 0) return "";

  let html = `<div class="tooltip-section"><span class="tooltip-section-title">Drop Locations</span>`;

  html += relevantDrops
    .map((d) => {
      const colorClass =
        d.rarity === "Common" ? "t-chance-high" : "t-chance-low";
      let locHtml = "";
      if (d.loc.includes("Relic")) {
        const relicName = d.loc.replace(" Relic", "").trim();
        const escapedRelic = relicName.replaceAll("'", String.raw`\'`);
        locHtml = `<span class="relic-link" onclick="selectRelicFromPreview('${escapedRelic}')" title="Ver Reliquia">${d.loc}</span>`;
      } else {
        const cleanLoc = d.loc.split(":")[0].split(",")[0].trim();
        const wikiUrl = `https://wiki.warframe.com/w/${encodeURIComponent(cleanLoc)}`;
        locHtml = `<a href="${wikiUrl}" target="_blank" class="wiki-link">${d.loc}</a>`;
      }

      return `<div class="tooltip-drop-row">${locHtml}<span class="${colorClass}">${(d.chance * 100).toFixed(1)}%</span></div>`;
    })
    .join("");

  html += `</div>`;
  return html;
}

function buildLichHtml(nameUpper) {
  let sourceName = "Unknown Source",
    sourceUrl = "";
  if (nameUpper.startsWith("KUVA")) {
    sourceName = "Kuva Lich (Vanquish)";
    sourceUrl = "https://wiki.warframe.com/w/Kuva_Lich";
  } else if (nameUpper.startsWith("TENET")) {
    sourceName = "Sisters of Parvos (Vanquish)";
    sourceUrl = "https://wiki.warframe.com/w/Sisters_of_Parvos";
  } else if (nameUpper.startsWith("CODA")) {
    sourceName = "Infested Liches (1999)";
    sourceUrl = "https://wiki.warframe.com/w/Technocyte_Coda";
  }
  return `<div class="tooltip-section"><span class="tooltip-section-title">Acquisition</span><div class="tooltip-drop-row" style="justify-content:center; padding:8px 0; border:none;"><span style="color:#dcb3ff; text-align:center;">Source: <a href="${sourceUrl}" target="_blank" class="wiki-link" style="color:var(--wf-gold-text);">${sourceName}</a></span></div></div>`;
}

function updatePreviewDOM(panel, imgPath, dispoData, tooltipHtml) {
  let wrapper =
    panel.querySelector(".riven-weapon-preview") ||
    document.createElement("div");
  if (!wrapper.parentElement) {
    wrapper.className = "riven-weapon-preview";
    wrapper.onclick = (e) => {
      wrapper.classList.toggle("mobile-active");
      e.stopPropagation();
    };
    panel.appendChild(wrapper);
  }

  let img =
    wrapper.querySelector(".riven-weapon-img") || document.createElement("img");
  if (!img.parentElement) {
    img.className = "riven-weapon-img";
    img.onerror = () => {
      img.src = "assets/img/default-weapon.png";
      img.style.opacity = 0.5;
    };
    wrapper.appendChild(img);
  }

  const absPath = new URL(imgPath, globalThis.location.href).href;
  if (img.src !== absPath) {
    img.classList.add("loading");
    img.onload = () => img.classList.remove("loading");
    img.src = imgPath;
  }

  let dispoRow =
    wrapper.querySelector(".riven-disposition-row") ||
    document.createElement("div");
  if (!dispoRow.parentElement) wrapper.appendChild(dispoRow);
  dispoRow.className = `riven-disposition-row dispo-level-${dispoData.circles}`;
  dispoRow.innerHTML = `${dispoData.circlesHtml}<span class="dispo-text">${dispoData.value.toFixed(2)}</span>`;

  wrapper.querySelector(".preview-tooltip")?.remove();
  if (tooltipHtml) {
    const temp = document.createElement("div");
    temp.innerHTML = tooltipHtml;
    if (temp.firstChild) wrapper.appendChild(temp.firstChild);
  }
}

// --- LÓGICA DE NOMBRES Y VARIANTES ---

export function getNakedName(name) {
  if (!name) return "";
  let s = name.toLowerCase().replaceAll("_", " ").trim();
  const prefixes = [
    "kuva ",
    "tenet ",
    "coda ",
    "carmine ",
    "rakta ",
    "synoid ",
    "sancti ",
    "vaykor ",
    "telos ",
    "secura ",
    "mk1 ",
    "mk1-",
    "prisma ",
    "mara ",
    "dex ",
  ];
  const suffixes = [" prime", " vandal", " wraith", " prisma", " coda"];

  for (const pre of prefixes) {
    if (s.startsWith(pre)) {
      s = s.substring(pre.length);
      break;
    }
  }
  for (const suf of suffixes) {
    if (s.endsWith(suf)) {
      s = s.substring(0, s.length - suf.length);
      break;
    }
  }
  return s.trim();
}

export function renderVariants(currentWeaponName) {
  const section = document.getElementById("riven-variants-carousel-section");
  const carousel = document.getElementById("riven-variants-carousel");
  if (!section || !carousel || !state.allRivenNames) return;

  const currentNaked = getNakedName(currentWeaponName);
  const siblings = state.allRivenNames.filter(
    (name) => getNakedName(name) === currentNaked,
  );

  if (siblings.length <= 1) {
    section.style.display = "none";
    return;
  }

  section.style.display = "block";
  carousel.dataset.baseWeapon = currentNaked;
  const fragment = document.createDocumentFragment();

  siblings
    .toSorted((a, b) => a.localeCompare(b))
    .forEach((name) => {
      const isSelected = name.toUpperCase() === currentWeaponName.toUpperCase();
      const weaponData = state.weaponMap[name];
      const dispo = weaponData ? Number.parseFloat(weaponData.d) : 1;

      const card = document.createElement("div");
      card.className = `variant-card ${isSelected ? "active" : ""}`;
      card.title = name;
      card.onclick = () => selectRivenWeapon(name);
      const displayLabel =
        name.toUpperCase().replace(currentNaked.toUpperCase(), "").trim() ||
        "Base";

      card.innerHTML = `
        <img src="${getItemIcon(name)}" onerror="this.src='assets/img/default-weapon.png'">
        <span class="v-name-small">${displayLabel}</span>
        <div class="v-dispo-row">
            <span class="v-dispo-val">${dispo.toFixed(2)}</span>
        </div>`;

      fragment.appendChild(card);
    });

  carousel.replaceChildren(fragment);
}

// --- LÓGICA DE GRADING Y MERCADO ---

export function handleRivenInput() {
  clearTimeout(rivenDebounceTimer);
  rivenDebounceTimer = setTimeout(() => {
    const input = document.getElementById("rivenWeaponInput");
    const dropdown = document.getElementById("rivenDropdown");
    if (!input || !dropdown) return;

    const val = input.value.toUpperCase().trim();
    if (!val) {
      dropdown.classList.add("hidden");
      return;
    }

    if (!state.allRivenNames?.length) {
      state.allRivenNames = Object.keys(state.weaponMap || {}).sort((a, b) =>
        a.localeCompare(b),
      );
    }

    const matches = state.allRivenNames
      .filter((n) => n.toUpperCase().includes(val))
      .slice(0, 10);
    if (matches.length > 0) {
      dropdown.replaceChildren(
        ...matches.map((name) => {
          const item = document.createElement("div");
          item.className = "dropdown-item";
          item.textContent = name;
          item.onclick = () => selectRivenWeapon(name);
          return item;
        }),
      );
      dropdown.classList.remove("hidden");
    } else {
      dropdown.classList.add("hidden");
    }
  }, 300);
}

export function selectRivenWeapon(name) {
  const input = document.getElementById("rivenWeaponInput");
  if (!input) return;
  input.value = name;
  document.getElementById("rivenDropdown")?.classList.add("hidden");

  renderRivenPreview(name);
  const weaponData = state.weaponMap?.[name];
  if (weaponData) {
    populateRivenSelects(weaponData.t);
    const dispoEl = document.getElementById("riven-dispo-display");
    if (dispoEl)
      dispoEl.innerHTML = `Riven disposition: <b style="color:var(--wf-gold-text)">${weaponData.d.toFixed(2)}</b>`;
  }
  fetchRivenAverage(getNakedName(name));
}

export function openRivenMarket() {
  const inputVal = document.getElementById("rivenWeaponInput")?.value.trim();
  if (!inputVal) return showToast("Por favor selecciona un arma primero");

  const baseWeaponName = getNakedName(inputVal);
  let url = `https://warframe.market/auctions/search?type=riven&weapon_url_name=${getRivenSlug(baseWeaponName)}&polarity=any&sort_by=price_asc`;

  const getStatSlug = (id) => {
    const val = document.getElementById(id)?.value;
    if (!val) return null;
    const internalName = normalizeStatName(val);
    return (
      RIVEN_STATS.find((s) => normalizeStatName(s.name_en) === internalName)
        ?.slug || val
    );
  };

  const positives = ["rivenStat1", "rivenStat2", "rivenStat3"]
    .map(getStatSlug)
    .filter(Boolean);
  const negative = getStatSlug("rivenStatNeg");

  if (positives.length > 0) url += `&positive_stats=${positives.join(",")}`;
  if (negative) url += `&negative_stats=${negative}`;

  globalThis.open(url, "_blank");
}

export function renderRivenGradingUI(weaponName, statsArray) {
  const weaponData = state.weaponMap[weaponName];
  if (!weaponData) return "";
  const disposition = weaponData.disposition || 1.0;
  const weaponType = weaponData.type || "Rifle";
  const buffCount = statsArray.filter((s) => s.value > 0).length;
  const hasCurse = statsArray.some((s) => s.value < 0);

  let html = `<div class="riven-grading-box"><h4>Grading: ${escapeHTML(weaponName)}</h4>`;
  statsArray.forEach((stat) => {
    const internalName = normalizeStatName(stat.name);
    const res = calculateRivenGrade(
      weaponType,
      disposition,
      internalName,
      stat.value,
      stat.value < 0,
      buffCount,
      hasCurse,
    );
    let color = "grade-f";

    if (res.percentage > 90) {
      color = "grade-s";
    } else if (res.percentage > 50) {
      color = "grade-b";
    }
    html += `<div class="grade-row"><span>${escapeHTML(stat.name)}</span><div class="grade-bar ${color}" style="width:${res.percentage}%"></div><span class="grade-badge ${color}">${res.grade}</span></div>`;
  });
  return html + `</div>`;
}

export function calculateModalGrade() {
  clearTimeout(gradeDebounceTimer);
  gradeDebounceTimer = setTimeout(() => {
    const weaponName = document.getElementById("rivenWeaponInput").value.trim();
    if (!weaponName || !state.weaponMap[weaponName]) return;

    const weaponData = state.weaponMap[weaponName];
    const currentRank = Number.parseInt(
      document.getElementById("g-rank").value || "8",
    );
    const scaleFactor = 9 / (currentRank + 1);
    const resultsDiv = document.getElementById("grading-modal-results");
    const stats = [];

    const readRow = (selId, valId, isNeg) => {
      const sel = document.getElementById(selId);
      const valIn = document.getElementById(valId);
      if (sel?.offsetParent && sel.value && valIn.value) {
        let val = Number.parseFloat(valIn.value);
        if (isNeg) val = -Math.abs(val);
        stats.push({
          name: sel.value,
          value: val,
          projected: val * scaleFactor,
        });
      }
    };

    ["1", "2", "3"].forEach((n) => readRow(`g-stat${n}`, `g-val${n}`, false));
    readRow("g-statNeg", "g-valNeg", true);

    if (!stats.length) {
      resultsDiv.classList.add("hidden");
      return;
    }

    resultsDiv.classList.remove("hidden");
    const fragment = document.createDocumentFragment();
    stats.forEach((stat) => {
      const internalName = normalizeStatName(stat.name);
      const res = calculateRivenGrade(
        weaponData,
        internalName,
        stat.projected,
        stats,
      );
      let color = "grade-f";
      if (["SSS", "S+", "S"].includes(res.grade)) color = "grade-s";
      else if (["A+", "A"].includes(res.grade)) color = "grade-a";
      else if (["B+", "B"].includes(res.grade)) color = "grade-b";

      const card = document.createElement("div");
      card.className = "grade-card";
      card.innerHTML = `<div class="grade-badge-large ${color}">${res.grade}</div>
                        <div class="grade-info"><div class="grade-stat-name">${stat.name}</div>
                        <div>Valor: ${Math.abs(stat.value)}% <span class="grade-range">/ Ideal: ${res.range}</span></div>
                        <div class="grade-track"><div class="grade-fill ${color}" style="width:${res.pct}%"></div></div></div>`;
      fragment.appendChild(card);
    });
    resultsDiv.replaceChildren(fragment);
  }, 250);
}

export function updateSelectExclusions() {
  const selects = Array.from(document.querySelectorAll(".riven-stat-select"));
  const selected = new Set(selects.map((s) => s.value).filter((v) => v !== ""));
  selects.forEach((sel) => {
    Array.from(sel.options).forEach((opt) => {
      if (opt.value !== "") {
        const isTaken = selected.has(opt.value) && opt.value !== sel.value;
        opt.hidden = isTaken;
        opt.style.display = isTaken ? "none" : "";
      }
    });
  });
}

export function openGradingModal() {
  const name = document.getElementById("rivenWeaponInput").value.trim();
  if (!name || !state.weaponMap[name])
    return alert("Selecciona un arma válida");
  const data = state.weaponMap[name];
  document.getElementById("g-weapon-name").innerHTML =
    `${escapeHTML(name)} <small>(Disp: ${data.d.toFixed(2)})</small>`;
  document.getElementById("grading-modal").classList.remove("hidden");
  resetGradingInputs();
  populateRivenSelects(data.t);
  document.getElementById("grading-modal-results").classList.add("hidden");
}

function resetGradingInputs() {
  document
    .querySelectorAll("#grading-modal input, #grading-modal select")
    .forEach((i) => (i.value = i.id === "g-rank" ? "8" : ""));
}

export function closeGradingModal() {
  document.getElementById("grading-modal").classList.add("hidden");
}
export function showGradingRow(id) {
  document.getElementById(id).classList.remove("hidden");
  document.getElementById(
    id === "row-stat3" ? "btn-add-pos" : "btn-add-neg",
  ).style.display = "none";
}
export function removeGradingRow(id) {
  const row = document.getElementById(id);
  row.classList.add("hidden");
  row.querySelector("select").value = "";
  row.querySelector("input").value = "";
  document.getElementById(
    id === "row-stat3" ? "btn-add-pos" : "btn-add-neg",
  ).style.display = "block";
  calculateModalGrade();
}

Object.assign(globalThis, {
  openGradingModal,
  closeGradingModal,
  calculateModalGrade,
  showGradingRow,
  removeGradingRow,
  handleRivenInput,
  selectRivenWeapon,
  openRivenMarket,
  getNakedName,
});
