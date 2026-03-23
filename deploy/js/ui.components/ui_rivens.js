import { state } from "../state.js";
import { TEXTS, RIVEN_STATS } from "../config.js";
import { calculateRivenGrade } from "../riven_logic.js";
import { getRivenSlug, fetchRivenAverage } from "../api.js";
import { getItemIcon } from "../ui.js";

import { escapeHTML, showToast } from "./ui_components.js";
let rivenDebounceTimer;
let gradeDebounceTimer;

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
    console.log("Weapon Details Loaded (UI Fallback):", data.length);
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
  const dispoValue = basic ? basic.d : details ? 1.0 : 1.0;
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
  let imgPath = "";

  if (weaponName.toUpperCase().includes("PRIME")) {
    imgPath = getItemIcon(weaponName);
  }

  if (!imgPath && details?.localImage) {
    let rawPath = details.localImage;
    if (rawPath.endsWith(".png")) rawPath = rawPath.replace(".png", ".webp");
    if (rawPath.startsWith("weapons/")) {
      rawPath = rawPath.replace("weapons/", "relic_contents/");
    }
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

  const hasComponents = details.components && details.components.length > 0;
  const nameUpper = details.name.toUpperCase();
  const isLichPrefix =
    nameUpper.startsWith("KUVA") ||
    nameUpper.startsWith("TENET") ||
    nameUpper.startsWith("CODA");
  const isShopItem = details.components?.some((c) =>
    c.name.toUpperCase().includes("HOLOKEY"),
  );
  const isLichWeapon = isLichPrefix && !isShopItem;

  if (!hasComponents && !isLichWeapon) return "";

  const weaponWikiUrl = `https://wiki.warframe.com/w/${encodeURIComponent(details.name)}`;
  let html = `<div class="preview-tooltip"><h4><a href="${weaponWikiUrl}" target="_blank" class="wiki-link" style="color:var(--wf-purple); border-bottom-color:var(--wf-purple);">${details.name}</a></h4>`;

  if (hasComponents && !isLichWeapon) {
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
      const onclickAttr = isItemInteractive
        ? `onclick="event.stopPropagation(); globalThis.openSetFromRelicReward('${c.name.replace(/'/g, "\\'")}')" title="Ver Set de ${c.name}"`
        : "";
      return `<div class="tooltip-drop-row ${isItemInteractive ? "item-interactive" : ""}" ${onclickAttr}><span style="display:flex; align-items:center;"><img src="${cImgPath}" class="tooltip-res-img" onerror="this.style.display='none'">${c.itemCount}x ${c.name}</span><span style="color:#888">${c.ducats || 0}d</span></div>`;
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
        allDrops.push({
          part: c.name,
          loc: d.location,
          chance: d.chance,
          rarity: d.rarity,
        }),
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
      let colorClass = "t-chance-low";
      if (d.rarity === "Common") colorClass = "t-chance-high";
      if (d.rarity === "Rare") colorClass = "t-chance-low";

      let locHtml = "";
      if (d.loc.includes("Relic")) {
        const relicName = d.loc.replace(" Relic", "").trim();
        locHtml = `<span class="relic-link" onclick="selectRelicFromPreview('${relicName.replaceAll("'", "\\'")}')" title="Click to view Relic" style="max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; display:inline-block; vertical-align:bottom;">${d.loc}</span>`;
      } else {
        const cleanLoc = d.loc.split(":")[0].split(",")[0].split("(")[0].trim();
        const wikiUrl = `https://wiki.warframe.com/w/${encodeURIComponent(cleanLoc)}`;
        locHtml = `<a href="${wikiUrl}" target="_blank" class="wiki-link" title="Open Wiki for ${cleanLoc}" style="max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; display:inline-block; vertical-align:bottom;">${d.loc}</a>`;
      }
      return `<div class="tooltip-drop-row">${locHtml}<span class="${colorClass}">${(d.chance * 100).toFixed(1)}%</span></div>`;
    })
    .join("");
  html += `</div>`;
  return html;
}

function buildLichHtml(nameUpper) {
  let sourceName = "Unknown Source";
  let sourceUrl = "";
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
  return `<div class="tooltip-section"><span class="tooltip-section-title">Acquisition</span><div class="tooltip-drop-row" style="justify-content:center; padding:8px 0; border:none;"><span style="color:#dcb3ff; text-align:center;">Source: <a href="${sourceUrl}" target="_blank" class="wiki-link" style="color:var(--wf-gold-text); border-bottom-style:dotted;">${sourceName}</a></span></div><div class="tooltip-drop-row" style="justify-content:center; border:none;"><span style="color:#666; font-size:0.8em; font-style:italic;">(Pre-built weapon drop)</span></div></div>`;
}

function updatePreviewDOM(panel, imgPath, dispoData, tooltipHtml) {
  let wrapper = panel.querySelector(".riven-weapon-preview");
  if (!wrapper) {
    wrapper = document.createElement("div");
    wrapper.className = "riven-weapon-preview";
    wrapper.onclick = (e) => {
      wrapper.classList.toggle("mobile-active");
      e.stopPropagation();
    };
    panel.appendChild(wrapper);
  }

  let img = wrapper.querySelector(".riven-weapon-img");
  if (!img) {
    img = document.createElement("img");
    img.className = "riven-weapon-img";
    img.onerror = () => {
      img.src = "assets/img/default-weapon.png";
      img.style.opacity = 0.5;
    };
    wrapper.appendChild(img);
  }

  const absoluteImgPath = new URL(imgPath, globalThis.location.href).href;
  if (img.src !== absoluteImgPath) {
    img.classList.add("loading");
    img.onload = () => img.classList.remove("loading");
    img.src = imgPath;
  }

  let dispoRow = wrapper.querySelector(".riven-disposition-row");
  if (!dispoRow) {
    dispoRow = document.createElement("div");
    wrapper.appendChild(dispoRow);
  }

  const displayDispo = Number.parseFloat(dispoData.value).toFixed(2);
  dispoRow.className = `riven-disposition-row dispo-level-${dispoData.circles}`;
  dispoRow.title = `Disposition: ${displayDispo}`;
  dispoRow.innerHTML = `${dispoData.circlesHtml}<span class="dispo-text">${displayDispo}</span>`;

  let oldTooltip = wrapper.querySelector(".preview-tooltip");
  if (oldTooltip) oldTooltip.remove();

  if (tooltipHtml) {
    const temp = document.createElement("div");
    temp.innerHTML = tooltipHtml;
    if (temp.firstChild) wrapper.appendChild(temp.firstChild);
  }
}

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
  if (!section || !carousel) return;

  if (!currentWeaponName || !state.allRivenNames || !state.weaponMap) {
    section.style.display = "none";
    return;
  }

  const currentNaked = getNakedName(currentWeaponName);
  const siblings = state.allRivenNames.filter(
    (name) => getNakedName(name) === currentNaked,
  );

  if (siblings.length <= 1) {
    section.style.display = "none";
    carousel.dataset.baseWeapon = "";
    return;
  }

  const oldBase = carousel.dataset.baseWeapon;
  const scrollToActive = () => {
    setTimeout(() => {
      const activeItem = carousel.querySelector(".variant-card.active");
      if (activeItem)
        activeItem.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
          inline: "center",
        });
    }, 150);
  };

  if (oldBase === currentNaked) {
    const cards = carousel.querySelectorAll(".variant-card");
    cards.forEach((card) =>
      card.classList.toggle(
        "active",
        card.title.toUpperCase() === currentWeaponName.toUpperCase(),
      ),
    );
    scrollToActive();
    return;
  }

  carousel.dataset.baseWeapon = currentNaked;
  section.style.display = "block";
  const fragment = document.createDocumentFragment();
  siblings.sort();

  siblings.forEach((name) => {
    const isSelected = name.toUpperCase() === currentWeaponName.toUpperCase();
    const weaponData = state.weaponMap[name];
    const dispoValue = weaponData ? Number.parseFloat(weaponData.d) : 1;
    const displayDispo = dispoValue.toFixed(2);

    let circles = 0;
    if (dispoValue < 0.7) circles = 1;
    else if (dispoValue < 0.9) circles = 2;
    else if (dispoValue <= 1.1) circles = 3;
    else if (dispoValue <= 1.3) circles = 4;
    else circles = 5;

    let circlesHtml = "";
    for (let i = 1; i <= 5; i++)
      circlesHtml += `<div class="v-dispo-dot ${i <= circles ? "filled" : ""}"></div>`;

    const imgPath =
      getItemIcon(name) ||
      `assets/relic_contents/${name
        .toLowerCase()
        .replaceAll(/[\s-]+/g, "_")
        .replaceAll(/[^a-z0-9_]/g, "")
        .replaceAll(/_+/g, "_")}.webp`;

    const card = document.createElement("div");
    card.className = `variant-card ${isSelected ? "active" : ""}`;
    card.title = name;
    card.onclick = () => selectRivenWeapon(name);

    let displayLabel = name;
    const nakedUpper = currentNaked.toUpperCase();
    if (name.toUpperCase().includes(nakedUpper)) {
      displayLabel =
        name.toUpperCase().replace(nakedUpper, "").trim() || "Base";
    }

    const img = document.createElement("img");
    img.src = imgPath;
    img.onerror = () => {
      img.src = "assets/img/default-weapon.png";
    };
    card.appendChild(img);

    if (name.toUpperCase().includes("PRIME")) {
      const setShortcut = document.createElement("div");
      setShortcut.className = "variant-set-shortcut";
      setShortcut.innerHTML = "SET ↗";
      setShortcut.title = `Ver Set de ${name}`;
      setShortcut.onclick = (e) => {
        e.stopPropagation();
        if (globalThis.openSetFromRelicReward)
          globalThis.openSetFromRelicReward(name);
      };
      card.appendChild(setShortcut);
    }

    const nameSpan = document.createElement("span");
    nameSpan.className = "v-name-small";
    nameSpan.textContent = displayLabel;
    card.appendChild(nameSpan);

    const dispoRow = document.createElement("div");
    dispoRow.className = "v-dispo-row";

    const dotsDiv = document.createElement("div");
    dotsDiv.className = "v-dispo-dots";
    dotsDiv.innerHTML = circlesHtml;
    dispoRow.appendChild(dotsDiv);

    const dispoValSpan = document.createElement("span");
    dispoValSpan.className = "v-dispo-val";
    dispoValSpan.textContent = displayDispo;
    dispoRow.appendChild(dispoValSpan);

    card.appendChild(dispoRow);
    fragment.appendChild(card);
  });

  carousel.replaceChildren(fragment);
  scrollToActive();

  if (!carousel._hasCarouselScrollListener) {
    carousel.addEventListener("mousemove", (e) => {
      if (globalThis.matchMedia("(pointer: fine)").matches) {
        const rect = carousel.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const ratio = mouseX / rect.width;
        carousel.scrollLeft = ratio * (carousel.scrollWidth - rect.width);
      }
    });
    carousel._hasCarouselScrollListener = true;
  }
}

export function handleRivenInput() {
  clearTimeout(rivenDebounceTimer);
  rivenDebounceTimer = setTimeout(() => {
    const input = document.getElementById("rivenWeaponInput");
    const dropdown = document.getElementById("rivenDropdown");
    if (!input || !dropdown) return;

    const val = input.value.toUpperCase().trim();
    if (val.length === 0) {
      dropdown.classList.add("hidden");
      const previewPanel = document.getElementById("riven-preview-panel");
      if (previewPanel) previewPanel.replaceChildren();
      return;
    }

    if (!state.weaponDetailsDB) loadWeaponDetails();

    if (
      (!state.allRivenNames || state.allRivenNames.length === 0) &&
      state.weaponMap
    ) {
      state.allRivenNames = Object.keys(state.weaponMap).sort((a, b) =>
        a.localeCompare(b),
      );
    }

    const source = state.allRivenNames || [];
    const startsWithMatches = [];
    const containsMatches = [];

    source.forEach((n) => {
      const upperN = n.toUpperCase();
      if (upperN.startsWith(val)) startsWithMatches.push(n);
      else if (upperN.includes(val)) containsMatches.push(n);
    });

    const matches = [...startsWithMatches, ...containsMatches].slice(0, 10);

    if (matches.length > 0) {
      dropdown.replaceChildren();
      dropdown.classList.remove("hidden");
      const fragment = document.createDocumentFragment();
      matches.forEach((name) => {
        const item = document.createElement("div");
        item.className = "dropdown-item";
        item.textContent = name;
        item.onclick = () => selectRivenWeapon(name);
        fragment.appendChild(item);
      });
      dropdown.appendChild(fragment);
    } else {
      dropdown.classList.add("hidden");
    }
  }, 300);
}

export function selectRivenWeapon(name) {
  const input = document.getElementById("rivenWeaponInput");
  const dropdown = document.getElementById("rivenDropdown");
  if (!input) return;

  input.value = name;
  if (dropdown) dropdown.classList.add("hidden");

  const weaponData = state.weaponMap ? state.weaponMap[name] : null;
  renderRivenPreview(name);

  if (weaponData) {
    const dispoDisplay = document.getElementById("riven-dispo-display");
    if (dispoDisplay) {
      const displayValue = Number.parseFloat(weaponData.d).toFixed(2);
      dispoDisplay.innerHTML = `Riven disposition: <b style="color:var(--wf-gold-text)">${displayValue}</b>`;
    }
    populateRivenSelects(weaponData.t);
  }

  const baseWeaponName = getNakedName(name);
  fetchRivenAverage(baseWeaponName);
}

export function updateSelectExclusions() {
  const selects = Array.from(document.querySelectorAll(".riven-stat-select"));
  const selectedValues = new Set(
    selects.map((s) => s.value).filter((v) => v !== ""),
  );

  selects.forEach((currentSelect) => {
    const myValue = currentSelect.value;
    Array.from(currentSelect.options).forEach((option) => {
      if (option.value === "") return;
      if (selectedValues.has(option.value) && option.value !== myValue) {
        option.hidden = true;
        option.style.display = "none";
      } else {
        option.hidden = false;
        option.style.display = "";
      }
    });
  });

  if (typeof globalThis.updateGradingUI === "function")
    globalThis.updateGradingUI();
}

export function openRivenMarket() {
  const inputEl = document.getElementById("rivenWeaponInput");
  if (!inputEl) return;
  const inputVal = inputEl.value.trim();
  if (!inputVal) return showToast("Por favor selecciona un arma primero");

  // SOLUCIÓN: Extraemos el nombre base antes de generar el Slug para la URL
  const baseWeaponName = getNakedName(inputVal);
  let slug = getRivenSlug(baseWeaponName);

  let url = `https://warframe.market/auctions/search?type=riven&weapon_url_name=${slug}&polarity=any&sort_by=price_asc`;

  const statToSlugMap = {};
  RIVEN_STATS.forEach((s) => {
    const baseStatKey =
      s.name_en === "Crit Chance"
        ? "Critical Chance"
        : s.name_en === "Crit Damage"
          ? "Critical Damage"
          : s.name_en === "Status Chance"
            ? "Status Chance"
            : s.name_en === "Damage"
              ? "Damage"
              : s.name_en === "Multishot"
                ? "Multishot"
                : s.name_en.split(" / ")[0];
    statToSlugMap[baseStatKey] = s.slug;
  });

  const getStatSlug = (id) => {
    const el = document.getElementById(id);
    if (!el || !el.value) return null;
    return statToSlugMap[el.value] || el.value;
  };

  const stat1 = getStatSlug("rivenStat1");
  const stat2 = getStatSlug("rivenStat2");
  const stat3 = getStatSlug("rivenStat3");
  const statNeg = getStatSlug("rivenStatNeg");

  let positives = [];
  if (stat1) positives.push(stat1);
  if (stat2) positives.push(stat2);
  if (stat3) positives.push(stat3);

  if (positives.length > 0) url += `&positive_stats=${positives.join(",")}`;
  if (statNeg) url += `&negative_stats=${statNeg}`;

  globalThis.open(url, "_blank");
}

export function renderRivenGradingUI(weaponName, statsArray) {
  const weaponData = state.weaponMap[weaponName];
  const disposition = weaponData ? weaponData.disposition : 1.0;
  const weaponType = weaponData ? weaponData.type : "Rifle";
  const buffCount = statsArray.filter((s) => s.value > 0).length;
  const hasCurse = statsArray.some((s) => s.value < 0);

  let html = `<div class="riven-grading-box"><h4>Grading: ${escapeHTML(weaponName)} (Disp: ${disposition})</h4>`;

  statsArray.forEach((stat) => {
    const isCurse = stat.value < 0;
    const result = calculateRivenGrade(
      weaponType,
      disposition,
      stat.name,
      stat.value,
      isCurse,
      buffCount,
      hasCurse,
    );
    const colorClass =
      result.percentage > 90
        ? "grade-s"
        : result.percentage > 50
          ? "grade-b"
          : "grade-f";

    html += `
      <div class="grade-row">
          <span class="stat-name">${escapeHTML(stat.name)}</span>
          <span class="stat-val">${escapeHTML(stat.value.toString())}%</span>
          <div class="grade-bar-container">
              <div class="grade-bar ${colorClass}" style="width: ${result.percentage}%"></div>
          </div>
          <span class="grade-badge ${colorClass}">${escapeHTML(result.grade)}</span>
          <span class="grade-range">Range: ${escapeHTML(result.min.toString())}% - ${escapeHTML(result.max.toString())}%</span>
      </div>`;
  });
  html += `</div>`;
  return html;
}

export function openGradingModal() {
  const weaponInput = document.getElementById("rivenWeaponInput");
  const weaponName = weaponInput.value.trim();

  if (!weaponName || !state.weaponMap[weaponName]) {
    alert("Please select a valid weapon on the field above.");
    return;
  }

  const weaponData = state.weaponMap[weaponName];

  document.getElementById("g-weapon-name").innerHTML =
    `${escapeHTML(weaponName)} <span style="color:#888; font-weight:normal; font-size:0.8em;">(Disp: ${escapeHTML(weaponData.d.toString())})</span>`;
  document.getElementById("grading-modal").classList.remove("hidden");

  resetGradingInputs();
  populateRivenSelects(weaponData.t);

  document.getElementById("row-stat3").classList.add("hidden");
  document.getElementById("row-statNeg").classList.add("hidden");
  document.getElementById("btn-add-pos").style.display = "block";
  document.getElementById("btn-add-neg").style.display = "block";
  document.getElementById("grading-modal-results").classList.add("hidden");
}

export function closeGradingModal() {
  document.getElementById("grading-modal").classList.add("hidden");
}

export function showGradingRow(rowId) {
  document.getElementById(rowId).classList.remove("hidden");
  if (rowId === "row-stat3")
    document.getElementById("btn-add-pos").style.display = "none";
  if (rowId === "row-statNeg")
    document.getElementById("btn-add-neg").style.display = "none";
}

export function removeGradingRow(rowId) {
  const row = document.getElementById(rowId);
  row.classList.add("hidden");
  row.querySelector("select").value = "";
  row.querySelector("input").value = "";

  if (rowId === "row-stat3")
    document.getElementById("btn-add-pos").style.display = "block";
  if (rowId === "row-statNeg")
    document.getElementById("btn-add-neg").style.display = "block";

  calculateModalGrade();
}

function resetGradingInputs() {
  const inputs = document.querySelectorAll(
    "#grading-modal input, #grading-modal select",
  );
  inputs.forEach((i) => {
    if (i.id === "g-rank") i.value = "8";
    else i.value = "";
  });
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

    const readModalRow = (selId, valId, isNeg) => {
      const sel = document.getElementById(selId);
      const valInput = document.getElementById(valId);
      if (sel.offsetParent !== null && sel.value && valInput.value) {
        let val = Number.parseFloat(valInput.value);
        if (Number.isNaN(val)) return;
        if (isNeg) val = -Math.abs(val);
        stats.push({
          name: sel.value,
          value: val,
          projected: val * scaleFactor,
          isPenaltySlot: isNeg,
        });
      }
    };

    readModalRow("g-stat1", "g-val1", false);
    readModalRow("g-stat2", "g-val2", false);
    readModalRow("g-stat3", "g-val3", false);
    readModalRow("g-statNeg", "g-valNeg", true);

    if (stats.length === 0) {
      resultsDiv.classList.add("hidden");
      return;
    }

    resultsDiv.classList.remove("hidden");
    const fragment = document.createDocumentFragment();
    stats.forEach((stat) => {
      const result = calculateRivenGrade(
        weaponData,
        stat.name,
        stat.projected,
        stats,
      );
      let colorClass = "grade-f";
      if (["SSS", "S+", "S"].includes(result.grade)) colorClass = "grade-s";
      else if (["A+", "A"].includes(result.grade)) colorClass = "grade-a";
      else if (["B+", "B"].includes(result.grade)) colorClass = "grade-b";

      const card = document.createElement("div");
      card.className = "grade-card";
      card.style.background = "rgba(0,0,0,0.3)";
      card.innerHTML = `
        <div class="grade-badge-large ${colorClass}">${result.grade}</div>
        <div class="grade-info">
            <div class="grade-stat-name">${stat.name}</div>
            <div class="grade-values">Valor: <span style="color:#fff">${Math.abs(stat.value)}%</span><span class="grade-range" style="font-size:0.8em"> / Ideal: ${result.range}</span></div>
            <div class="grade-track"><div class="grade-fill ${colorClass}" style="width: ${result.pct}%"></div></div>
        </div>
      `;
      fragment.appendChild(card);
    });

    resultsDiv.replaceChildren(fragment);
  }, 250);
}
Object.assign(globalThis, {
  openGradingModal,
  closeGradingModal,
  calculateModalGrade,
  showGradingRow,
  removeGradingRow,
});
