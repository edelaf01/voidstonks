import { state } from "../state.js";
import { TEXTS } from "../config.js";
import { escapeHTML } from "../utils/escape_html.js";
import { getSlug } from "../utils/slugs.utils.js";
import { getPriceValue } from "../services/market/prices.service.js";
import { getItemIcon, getRequiredCount, calculateTotalFullSets } from "../utils/ui_utils.js";

/**
 * Tooltips de sets y reliquias: el HTML que se pinta al pasar por encima de una pieza.
 *
 * Estaba en utils/ui_utils.js, mezclado con el cálculo. La mitad de aquel módulo eran funciones
 * puras que usan services y utils (y por eso las importan `relic_set_value.js` y
 * `wfm_link.service.js`), y la otra mitad montaba markup y pedía precios — que es lo que
 * obligaba a un `utils/` a importar de `services/`, saltándose el contrato de capas.
 *
 * Al separarlas, el cálculo se quedó donde puede usarlo todo el mundo y el markup subió aquí,
 * que es la capa que sí puede pedirle cosas a un service.
 */

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
    html += buildGroupedSourcesHtml(sources);
  } else {
    html += `<div style="color:#888; font-style:italic; font-size:0.85em; margin-top:8px;">${TEXTS[state.currentLang].vaulted || "Vaulted"}</div>`;
  }

  return html;
}

// Misiones de una pasada, de más rápida a más lenta
const SHORT_MISSION_RANK = {
  "Capture": 0, "Exterminate": 1, "Rescue": 2, "Sabotage": 3,
  "Spy": 4, "Hive": 5, "Assassination": 6, "Hijack": 7,
  "Mobile Defense": 8, "Assault": 9, "Junction": 10,
};

// Modos endless: la recompensa depende de la rotación (A/B/C)
const ENDLESS_MODES = new Set([
  "Survival", "Conjunction Survival", "Defense", "Interception",
  "Excavation", "Disruption", "Defection", "Infested Salvage", "Salvage",
  "Sanctuary Onslaught", "Elite Sanctuary Onslaught",
  "Void Cascade", "Void Flood", "Void Armageddon", "Alchemy",
]);

function sourceGroupRank(s) {
  if (s.type !== "mission") return 300;
  if (ENDLESS_MODES.has(s.mission)) return 100;
  const r = SHORT_MISSION_RANK[s.mission];
  return r !== undefined ? r : 50;
}

function buildGroupedSourcesHtml(sources) {
  const isES = state.currentLang === "es";

  const groups = new Map();
  sources.forEach((s) => {
    const key = `${s.type}|${s.mission}`;
    if (!groups.has(key)) {
      groups.set(key, { mission: s.mission, rank: sourceGroupRank(s), rows: [] });
    }
    groups.get(key).rows.push(s);
  });

  const topFive = new Set(
      [...sources].sort((a, b) => b.chance - a.chance).slice(0, 5),
  );

  const sortedGroups = [...groups.values()].sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    return Math.max(...b.rows.map((r) => r.chance)) - Math.max(...a.rows.map((r) => r.chance));
  });

  let html = "";
  sortedGroups.forEach((g) => {
    const isEndless = g.rank === 100;
    const isBounty = g.rank === 300;

    g.rows.sort((a, b) => {
      if (isEndless || isBounty) {
        const rotCmp = String(a.rotation).localeCompare(String(b.rotation));
        if (rotCmp !== 0) return rotCmp;
      }
      return b.chance - a.chance;
    });

    let tag = "";
    if (isEndless) {
      tag = `<span style='font-weight:600; color:#888; text-transform:none; font-size:0.85em;'>${isES ? "endless · por rotación" : "endless · by rotation"}</span>`;
    } else if (isBounty) {
      tag = `<span style='font-weight:600; color:#888; text-transform:none; font-size:0.85em;'>${isES ? "por fase" : "by stage"}</span>`;
    }

    html += `<div style='display:flex; align-items:baseline; gap:8px; margin:10px 0 2px 0; font-weight:800; color:#ddd; font-size:0.9em; text-transform:uppercase; border-bottom:1px solid #444; padding-bottom:2px;'>${escapeHTML(g.mission)} ${tag}</div>`;
    html += "<ul class='tooltip-list' style='font-size:1.0em;'>";

    g.rows.forEach((s) => {
      const rot = s.type === "mission"
        ? s.rotation
        : String(s.rotation).replaceAll("Rotation ", "").replaceAll("Stage ", "St.");
      const locText = `<span class="t-loc">${escapeHTML(
          s.location,
      )}</span> <span class='rot-badge'>${escapeHTML(rot)}</span>`;

      const rowClass = topFive.has(s) ? "top-drop" : "";

      let chanceColor = "#888";
      if (s.chance > 10) chanceColor = "var(--wf-gold-text)";
      else if (s.chance > 5) chanceColor = "var(--wf-blue)";

      html += `<li class="${rowClass}">
        <div class="t-row">${locText}</div>
        <span class='drop-chance' style="color:${chanceColor}">${s.chance.toFixed(2)}%</span>
      </li>`;
    });

    html += "</ul>";
  });

  return html;
}
