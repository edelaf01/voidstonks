import { state } from "../state.js";
import { TEXTS } from "../config.js";
import { escapeHTML } from "../ui.components/ui_components.js";
import { getSlug, getPriceValue } from "../api.js";

const iconPathCache = new Map();
const setNameCache = new Map();
const requiredCountCache = new Map();

export function getSetName(fullName) {
  if (!fullName) return (state.currentLang === "es" ? "Otros" : "Others");
  if (setNameCache.has(fullName)) return setNameCache.get(fullName);
  const match = fullName.match(/(.*?) (Prime|Vandal|Wraith)/);
  const res = match ? match[0].trim() : (state.currentLang === "es" ? "Otros" : "Others");
  setNameCache.set(fullName, res);
  return res;
}

export function getRequiredCount(setName, partName) {
  const cacheKey = `${setName}::${partName}`;
  if (requiredCountCache.has(cacheKey)) return requiredCountCache.get(cacheKey);

  const resolveCount = () => {
    const manifest = state.primeManifest || [];
    const weapons = state.weaponDetailsDB || [];
    const item =
      manifest.find((i) => i.name === setName) ||
      weapons.find((i) => i.name === setName);
    if (!item?.components) return 1;

    let cleanPart =
      partName === setName ? "Blueprint" : partName.replace(setName, "").trim();
    if (cleanPart.endsWith(" Blueprint"))
      cleanPart = cleanPart.replace(" Blueprint", "").trim();

    const comp = item.components.find(
      (c) =>
        c.name === cleanPart ||
        c.name + " Blueprint" === cleanPart ||
        setName + " " + c.name === partName,
    );
    return comp ? comp.itemCount : 1;
  };

  const res = resolveCount();
  requiredCountCache.set(cacheKey, res);
  return res;
}

export function generateDotsHtml(owned, required) {
  const lblOwned = TEXTS[state.currentLang]?.lblOwned || "obtenidos";
  const badgeHTML = `<span class="owned-qty" style="visibility:${owned > 0 ? 'visible' : 'hidden'}; color:var(--wf-gold-text); background:rgba(221,169,56,0.15); border:1px solid rgba(221,169,56,0.3); padding:2px 6px; border-radius:4px; font-weight:bold; font-size:0.75em; margin-left:8px; text-transform:uppercase; letter-spacing:0.5px; box-shadow: 0 0 5px rgba(221,169,56,0.1); white-space:nowrap;">${owned > 0 ? owned : 0} ${lblOwned}</span>`;

  if (required <= 1) return `<div style="display:flex; align-items:center;">${badgeHTML}</div>`;

  const displayFilled = (owned > 0 && owned % required === 0) ? required : (owned % required);
  const isComplete = (displayFilled === required);

  let html = `<div class="tracker-dots ${isComplete ? "complete" : ""}" style="display: flex; align-items: center; gap: 3px; margin-left: 8px;">`;
  for (let i = 0; i < required; i++) {
    html += `<span class="tracker-dot ${i < displayFilled ? "filled" : ""}"></span>`;
  }
  return html + badgeHTML + `</div>`;
}

export function calculateTotalFullSets(setName) {
  if (!setName || setName === "Otros") return 0;

  let allParts = [];
  if (state.setsDatabase?.[setName]) {
    allParts = state.setsDatabase[setName];
  } else {
    if (!globalThis.setPartsCache) globalThis.setPartsCache = new Map();
    if (!globalThis.setPartsCache.has(setName) || globalThis.setPartsCache.get(setName).length === 0) {
      const parts = Object.keys(state.itemsDatabase || {}).filter(
        (name) =>
          (name === setName || name.startsWith(setName + " ")) &&
          !name.endsWith(" Set")
      );
      globalThis.setPartsCache.set(setName, parts);
    }
    allParts = globalThis.setPartsCache.get(setName);
  }


  let possibleSets = Infinity;
  allParts.forEach((partName) => {
    const requiredCount = getRequiredCount(setName, partName);
    const owned = state.primeInventory[partName] || 0;
    const safeReq = requiredCount > 0 ? requiredCount : 1;
    const sets = Math.floor(owned / safeReq);
    if (!Number.isNaN(sets) && sets < possibleSets) {
      possibleSets = sets;
    }
  });
  if (possibleSets === Infinity || Number.isNaN(possibleSets)) {
    possibleSets = 0;
  }

  const setItemOwned = state.primeInventory[setName + " Set"] || 0;
  return possibleSets + setItemOwned;
}

export function generateSetProgressTooltip(setName) {
  if (!setName || setName === "Otros") return "";

  let partsList = [];
  if (state.setsDatabase?.[setName]) {
    partsList = state.setsDatabase[setName];
  } else {
    if (!globalThis.setPartsCache) globalThis.setPartsCache = new Map();
    if (!globalThis.setPartsCache.has(setName)) {
      const parts = Object.keys(state.itemsDatabase || {}).filter(
        (name) =>
          (name === setName || name.startsWith(setName + " ")) &&
          !name.endsWith(" Set")
      );
      globalThis.setPartsCache.set(setName, parts);
    }
    partsList = globalThis.setPartsCache.get(setName);
  }

  const itemNames = [...partsList].sort();

  if (itemNames.length === 0) return "";

  const totalFullSets = calculateTotalFullSets(setName);
  const setSuffix = state.currentLang === "es" ? "Sets" : (totalFullSets === 1 ? "Set" : "Sets");
  const setBadge = totalFullSets > 0 ? `<span style="color:var(--wf-gold-text); margin-left:8px; font-weight:normal; font-size:0.8em; background:rgba(221,169,56,0.15); border:1px solid rgba(221,169,56,0.3); padding:2px 6px; border-radius:4px; text-transform:uppercase;">(${totalFullSets} ${setSuffix})</span>` : "";

  let html = `<div class="set-progress-tooltip-inner" style="background:#1a1e24; border:1px solid var(--wf-orokin); border-radius:6px; padding:10px; min-width:220px; box-shadow: 0 4px 12px rgba(0,0,0,0.5);">`;
  html += `<div style="color:var(--wf-gold-text); font-weight:bold; font-size:1.1em; border-bottom:1px solid #333; padding-bottom:5px; margin-bottom:8px; text-transform:uppercase; display:flex; align-items:center; justify-content:space-between;"><span>${escapeHTML(setName)}</span>${setBadge}</div>`;

  itemNames.forEach((itemName) => {
    const icon = getItemIcon(itemName);
    const shortName = itemName.replace(setName, "").trim() || (TEXTS[state.currentLang].lblBlueprint || "Blueprint");
    const req = getRequiredCount(setName, itemName);
    const owned = state.primeInventory[itemName] || 0;

    html += `
      <div style="display:flex; align-items:center; gap:8px; margin-bottom:5px;">
         ${icon ? `<img src="${icon}" style="width:24px; height:24px; object-fit:contain;">` : ""}
         <div style="display:flex; flex-direction:column; flex:1;">
            <span style="font-size:0.85em; color:#ddd;">${escapeHTML(shortName)}${req > 1 ? ` <span style="color:#aaa;">x${req}</span>` : ""}</span>
            <div class="live-tracker" data-part="${escapeHTML(itemName)}" data-req="${req}" style="margin-left:-8px;">
               ${generateDotsHtml(owned, req)}
            </div>
         </div>
      </div>
    `;
  });
  html += `</div>`;
  return html;
}

export function getRelicDropTooltip(tierName) {
  const sources = state.relicSourcesDatabase[tierName] || [];
  const contents = state.relicsDatabase[tierName] || [];
  const tKeys = TEXTS[state.currentLang]?.inventory?.tooltips || {
    dropsFor: "Drops for", contentsOf: "Relic Contents", avgPlat: "Avg Plat", avgDucats: "Avg Ducats", vaulted: "VAULTED", active: "ACTIVE"
  };

  sources.sort((a, b) => b.chance - a.chance);

  const averages = state.relicAverages ? state.relicAverages[tierName] : null;
  const platHtml = averages ? `<span style='color:var(--wf-gold-text); display:flex; align-items:center; gap:4px;'><img src='assets/relic_contents/platinum.webp' style='width:16px;height:16px;object-fit:contain;'> ${averages.avgPlat.toFixed(1)}</span>` : "";
  const ducatHtml = averages ? `<span style='color:#2196f3; display:flex; align-items:center; gap:4px;'><img src='assets/Ducats.webp' style='width:16px;height:16px;object-fit:contain;'> ${averages.avgDucats.toFixed(0)}</span>` : "";
  const avgHeader = averages ? `<div style='display:flex; gap:20px; margin-top:8px; font-size:1.1em; font-weight:bold; background:rgba(0,0,0,0.4); padding:6px 10px; border-radius:6px; justify-content:center;'>${platHtml} ${ducatHtml}</div>` : "";

  let html = `<div class='tooltip-header'>
    <div style='margin-bottom:4px; font-size:1.3em;'>${tKeys.dropsFor ? tKeys.dropsFor : "Drops for"} ${escapeHTML(tierName)}</div>
    ${avgHeader}
  </div>`;

  if (contents.length > 0) {
    html += `<div style='margin:12px 0 6px 0; padding-bottom:6px; border-bottom:1px solid #555; font-weight:900; color:#ddd; font-size:1.0em; text-transform:uppercase;'>${tKeys.contentsOf ? tKeys.contentsOf : "Contents"}</div>`;
    html += `<div style='display:flex; flex-direction:column; gap:6px; margin-bottom:14px;'>`;
    contents.forEach(item => {
      const isRare = item.chance <= 5;
      const isUncommon = item.chance > 5 && item.chance <= 22;
      const color = isRare ? "var(--wf-gold-text)" : isUncommon ? "var(--wf-blue)" : "#bbb";
      const itemSlug = getSlug(item.name);

      const isForma = item.name.toLowerCase().includes("forma") || item.name.toLowerCase().includes("kuva");

      if (isForma) {
        html += `<div style='display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; background:rgba(0,0,0,0.25); padding:4px 8px; border-radius:4px; border-left:3px solid ${color}; gap:10px; width:100%; box-sizing:border-box;'>
          <span style='font-size:0.9em; color:#fff; flex:1; min-width:140px; word-break:break-word; line-height:1.2;'>${escapeHTML(item.name)}</span>
        </div>`;
        return;
      }

      const cachedPrice = globalThis.MEMORY_CACHE?.get(itemSlug) || "...";

      if (getPriceValue) {
        getPriceValue(item.name, itemSlug).then(price => {
          const el = document.getElementById(`tt-price-${getSlug(tierName)}-${itemSlug}`);
          if (el && price > 0) {
            el.innerHTML = `${price}`;
          }
        });
      }

      html += `<div style='display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; background:rgba(0,0,0,0.25); padding:4px 8px; border-radius:4px; border-left:3px solid ${color}; gap:10px; width:100%; box-sizing:border-box;'>
        <span style='font-size:0.9em; color:#fff; flex:1; min-width:140px; word-break:break-word; line-height:1.2;'>${escapeHTML(item.name)}</span>
        <div style='display:flex; gap:10px; align-items:center; font-size:0.9em; font-weight:bold; flex-shrink:0;'>
          ${(item.ducats && item.ducats > 0) ? `<span style='color:#2196f3; display:flex; align-items:center; gap:3px;'><img src='assets/Ducats.webp' style='width:12px;height:12px;'>${item.ducats}</span>` : ''}
          <span style='color:var(--wf-gold-text); display:flex; align-items:center; gap:3px;'><img src='assets/relic_contents/platinum.webp' style='width:12px;height:12px;'><span id='tt-price-${getSlug(tierName)}-${itemSlug}'>${cachedPrice}</span></span>
        </div>
      </div>`;
    });
    html += `</div>`;
  }

  if (sources.length > 0) {
    html += `<div style='margin:12px 0 6px 0; font-weight:800; color:#aaa; font-size:0.95em; text-transform:uppercase;'>Farming Sources (${sources.length})</div>`;
    html += "<ul class='tooltip-list' style='font-size:1.0em;'>";
  } else {
    html += `<div style="color:#888; font-style:italic; font-size:0.85em; margin-top:8px;">${TEXTS[state.currentLang].vaulted || "Vaulted"}</div>`;
  }

  sources.forEach((s, index) => {
    let locText = "";

    if (s.type === "mission") {
      locText = `<span class="t-loc">${escapeHTML(
          s.location,
      )}</span> <span style="color:#888">-</span> ${escapeHTML(
          s.mission,
      )} <span class='rot-badge'>${escapeHTML(s.rotation)}</span>`;
    } else {
      let stage = s.rotation
          .replaceAll("Rotation ", "")
          .replaceAll("Stage ", "St.");
      locText = `<span class="t-loc">${escapeHTML(
          s.location,
      )}</span> <span style="color:#888">-</span> ${escapeHTML(
          s.mission,
      )} <span class='rot-badge'>${escapeHTML(stage)}</span>`;
    }

    const isTop = index < 5;
    const rowClass = isTop ? "top-drop" : "";

    let chanceColor = "#888";
    if (s.chance > 10) chanceColor = "var(--wf-gold-text)";
    else if (s.chance > 5) chanceColor = "var(--wf-blue)";

    const sanitizedLocText = locText;

    html += `<li class="${rowClass}">
      <div class="t-row">${sanitizedLocText}</div>
      <span class='drop-chance' style="color:${chanceColor}">${s.chance.toFixed(
        2,
    )}%</span>
    </li>`;
  });

  html += "</ul>";
  return html;
}

globalThis.getRelicDropTooltip = getRelicDropTooltip;

export function getItemIcon(itemName) {
  if (!itemName) return null;
  if (iconPathCache.has(itemName)) return iconPathCache.get(itemName);

  const resolveIcon = () => {
    let originalName = itemName
        .toLowerCase()
        .trim()
        .replace(/^\d+x\s+/, "");

    if (originalName === "forma blueprint") {
      return "assets/relic_contents/forma.webp";
    }

    if (originalName === "silva & aegis prime") return "assets/relic_contents/silva__aegis_prime.webp";
    if (originalName === "kavasa prime" || originalName === "kavasa prime collar") return "assets/relic_contents/kavasa_prime_kubrow_collar.webp";

    const baseSlug = originalName
        .replace(" set", "")
        .replaceAll(/\s+&\s+/g, "__")
        .replaceAll(/[\s-]+/g, "_")
        .replaceAll(/[^a-z0-9_]/g, "");

    const pPrefix = originalName.includes("prime") ? "prime_" : "";
    const basePath = `assets/relic_contents/${pPrefix}`;

    if (originalName.includes("systems")) {
      const archwings = ["amesha", "odonata", "elytron", "itzal"];
      const isArchwing = archwings.some((aw) => originalName.includes(aw));
      return `${basePath}systems${isArchwing ? "_archwing" : ""}.webp`;
    }

    if (/limb(?!o)/.test(originalName)) {
      return `${basePath}blade.webp`;
    }

    if (originalName.includes("string")) {
      return `${basePath}stock.webp`;
    }

    if (
        originalName.includes("grip") ||
        originalName.includes("pouch") ||
        originalName.includes("band")
    ) {
      return `${basePath}grip.webp`;
    }

    const partMappings = [
      ["neuroptics", ["neuroptics"]],
      ["cerebrum", ["cerebrum"]],
      ["carapace", ["carapace"]],
      ["harness", ["harness"]],
      ["wings", ["wings"]],
      ["barrel", ["barrel"]],
      ["receiver", ["receiver"]],
      ["stock", ["stock", "motor"]],
      ["link", ["link", "chain", "buckle"]],
      ["blade", ["blade", "stars"]],
      ["hilt", ["hilt", "handle", "ornament", "tip", "guard"]],
      ["disc", ["disc"]],
      ["boot", ["boot"]],
      ["gauntlet", ["gauntlet"]],
      ["head", ["head"]],
      ["chassis", ["chassis"]],
    ];

    const match = partMappings.find(([_, keywords]) =>
        keywords.some((k) => originalName.includes(k)),
    );

    if (match) {
      return `${basePath}${match[0]}.webp`;
    }

    if (originalName.includes("blueprint") || originalName.endsWith(" bp")) {
      const setSlug = baseSlug.replace(/(_blueprint|_bp)$/, "");
      return `assets/relic_contents/${setSlug}.webp`;
    }

    return `assets/relic_contents/${baseSlug}.webp`;
  };

  const result = resolveIcon();
  iconPathCache.set(itemName, result);
  return result;
}

export const DEFAULT_WEAPON_SVG = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="100%" height="100%"><defs><radialGradient id="bgGlow" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="%231a2233" /><stop offset="100%" stop-color="%230c0f17" /></radialGradient><linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="%23ffe082" /><stop offset="100%" stop-color="%23ffb300" /></linearGradient><filter id="glow"><feGaussianBlur stdDeviation="3" result="coloredBlur"/><feMerge><feMergeNode in="coloredBlur"/><feMergeNode in="SourceGraphic"/></feMerge></defs><rect width="100%" height="100%" fill="url(%23bgGlow)" rx="12" stroke="%2321263d" stroke-width="1.5"/><circle cx="64" cy="64" r="44" stroke="%2321263d" stroke-width="2" fill="none" opacity="0.6"/><circle cx="64" cy="64" r="44" stroke="url(%23goldGrad)" stroke-width="1.5" fill="none" stroke-dasharray="24 16" opacity="0.4"/><g filter="url(%23glow)" stroke="url(%23goldGrad)" stroke-width="3.5" stroke-linecap="round" fill="none" opacity="0.85"><path d="M44 84 L84 44" /><path d="M40 76 L48 84" /><path d="M44 84 L38 90" stroke-width="5" /><path d="M80 40 L88 32 M88 32 L84 32 M88 32 L88 36" stroke-width="2" /></g><path d="M18 18 L24 18 M18 18 L18 24 M110 18 L104 18 M110 18 L110 24 M18 110 L24 110 M18 110 L18 104 M110 110 L104 110 M110 110 L110 104" stroke="%23383f61" stroke-width="1" fill="none" opacity="0.5"/></svg>`;
