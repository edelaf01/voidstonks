import { state } from "../../state.js";
import { escapeHTML } from "../../utils/escape_html.js";
import { getItemIcon, getSetName } from "../../utils/ui_utils.js";

// Prime sets carousel shown when the search has nothing to paint. The three groups walk the whole item
// catalog, so they are cached.
let cachedShowcasePools = null;

/** `append` adds it after the "no results" message instead of replacing the content. */
export function renderEmptySetsShowcase(container, { append = false } = {}) {
  const isEs = state.currentLang === "es";

  let poolWarframes = [];
  let poolPrimaries = [];
  let poolMelees = [];

  if (cachedShowcasePools) {
    poolWarframes = cachedShowcasePools.poolWarframes;
    poolPrimaries = cachedShowcasePools.poolPrimaries;
    poolMelees = cachedShowcasePools.poolMelees;
  } else {
    try {
      const dbKeys = Object.keys(state.itemsDatabase || {});
      if (dbKeys.length > 0) {
        const uniqueSetNames = Array.from(new Set(
          dbKeys.map(k => getSetName(k)).filter(name => name && name.endsWith(" Prime"))
        )).sort((a, b) => a.localeCompare(b));

        const manifest = state.primeManifest || [];
        const weapons = state.weaponDetailsDB || [];

        uniqueSetNames.forEach(setName => {
          // 1. entities manifest (warframes and sentinels)
          const entity = manifest.find(i => i.name === setName);
          if (entity) {
            if (entity.type === "Warframe") {
              poolWarframes.push(setName);
            } else {
              poolPrimaries.push(setName); // sentinels and companions
            }
            return;
          }

          // 2. weapons
          const weapon = weapons.find(i => i.name === setName);
          if (weapon) {
            if (weapon.type === "Melee") {
              poolMelees.push(setName);
            } else if (["Pistol", "Dual Pistols", "Throwing"].includes(weapon.type)) {
              poolMelees.push(setName); // secondaries with melee, for balanced columns
            } else {
              poolPrimaries.push(setName);
            }
            return;
          }

          // 3. name heuristics while the catalog is not fully loaded
          const lower = setName.toLowerCase();
          if (lower.includes("carrier") || lower.includes("helios") || lower.includes("wyrm") || lower.includes("dethcube") || lower.includes("nautilus") || lower.includes("shade") || lower.includes("oxylus") || lower.includes("diriga") || lower.includes("djinn") || lower.includes("taxon")) {
            poolPrimaries.push(setName);
          } else if (lower.includes("lex") || lower.includes("pyrana") || lower.includes("ak") || lower.includes("vasto") || lower.includes("bronco") || lower.includes("magnus") || lower.includes("sicarus") || lower.includes("zylok") || lower.includes("knell") || lower.includes("velox") || lower.includes("pandero") || lower.includes("afuris") || lower.includes("aksomati") || lower.includes("akstiletto") || lower.includes("lato") || lower.includes("spira") || lower.includes("hikou")) {
            poolMelees.push(setName);
          } else {
            poolPrimaries.push(setName);
          }
        });

        cachedShowcasePools = { poolWarframes, poolPrimaries, poolMelees };
      }
    } catch (err) {
      console.error("Error dynamically building empty sets showcase pools:", err);
    }
  }

  // fallbacks while the catalog is empty or still loading
  if (poolWarframes.length === 0) {
    poolWarframes = [
      "Xaku Prime",
      "Wisp Prime",
      "Saryn Prime",
      "Mesa Prime",
      "Volt Prime",
      "Rhino Prime",
      "Nekros Prime",
      "Nova Prime"
    ];
  }
  if (poolPrimaries.length === 0) {
    poolPrimaries = [
      "Braton Prime",
      "Burston Prime",
      "Boltor Prime",
      "Soma Prime",
      "Acceltra Prime",
      "Carrier Prime",
      "Helios Prime",
      "Wyrm Prime"
    ];
  }
  if (poolMelees.length === 0) {
    poolMelees = [
      "Glaive Prime",
      "Orthos Prime",
      "Kronen Prime",
      "Nikana Prime",
      "Guandao Prime",
      "Pangolin Prime",
      "Lex Prime",
      "Pyrana Prime"
    ];
  }

  const shuffle = (arr) => {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  };

  const c1 = shuffle(poolWarframes).slice(0, 10);
  const doubleSets1 = [...c1, ...c1];

  const c2 = shuffle(poolPrimaries).slice(0, 10);
  const doubleSets2 = [...c2, ...c2];

  const c3 = shuffle(poolMelees).slice(0, 10);
  const doubleSets3 = [...c3, ...c3];

  const renderColumnCards = (setsList, colId) => {
    let html = "";
    const len = setsList.length;
    for (let i = 0; i < len; i++) {
      const setName = setsList[i];
      let icon = getItemIcon(setName) || globalThis.DEFAULT_WEAPON_DATA_URL;
      if (icon.startsWith("<svg")) {
        icon = "data:image/svg+xml;utf8," + encodeURIComponent(icon);
      }
      const safeIcon = icon.replace(/"/g, '&quot;');
      // data attribute plus delegation, not onclick="...('NAME')": the browser decodes entities before
      // parsing the JS, so HTML escaping would not protect the string literal
      html += `
        <button type="button" class="showcase-card" id="set-showcase-card-${colId}-${i}" data-showcase-set="${escapeHTML(setName)}" title="${escapeHTML(setName)}">
          <img class="showcase-img" src="${safeIcon}" alt="" onerror="this.onerror=null; this.src=globalThis.DEFAULT_WEAPON_DATA_URL;" loading="lazy">
          <span class="showcase-name">${escapeHTML(setName)}</span>
        </button>
      `;
    }
    return html;
  };

  const col1Html = renderColumnCards(doubleSets1, 1);
  const col2Html = renderColumnCards(doubleSets2, 2);
  const col3Html = renderColumnCards(doubleSets3, 3);

  // styles in styles.css (.showcase-*, .ticker-*)
  const showcaseHtml = `
    <div class="empty-showcase-container">
      <div class="showcase-heading">${isEs ? "SETS POPULARES" : "PRIME SETS"}</div>
      <div class="showcase-subheading">
        ${isEs
    ? "Selecciona un set popular para ver sus componentes y precios"
    : "Select a PRIME set to view its components and pricing"}
      </div>

      <div class="ticker-grid-expanded">
        <div class="ticker-column-large">${col1Html}</div>
        <div class="ticker-column-large">${col2Html}</div>
        <div class="ticker-column-large">${col3Html}</div>
      </div>
    </div>
  `;

  if (append) {
    container.insertAdjacentHTML("beforeend", showcaseHtml);
  } else {
    container.innerHTML = showcaseHtml;
  }

  bindShowcaseClicks(container);
}

// the flag avoids one listener per render
function bindShowcaseClicks(container) {
  if (container.dataset.showcaseBound === "1") return;
  container.dataset.showcaseBound = "1";
  container.addEventListener("click", (e) => {
    const card = e.target.closest("[data-showcase-set]");
    if (card) globalThis.selectShowcaseSet(card.dataset.showcaseSet);
  });
}
