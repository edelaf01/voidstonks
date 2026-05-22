import { state } from "../state.js";
import { RIVEN_STATS, TEXTS } from "../config.js";
import { calculateRivenGrade, getRivenStatRange } from "../riven_logic.js";
import { getRivenSlug, fetchRivenAverage } from "../api.js";
import { getMetaStats, fetchSimilarRivens } from "../services/riven_market.service.js?v=1.8";
import {
  getItemIcon,

} from "./ui_utils.js";
import { escapeHTML, showToast } from "./ui_components.js";

let rivenDebounceTimer;
let gradeDebounceTimer;
let emptyShowcaseInterval = null;
let emptyShowcaseTimeouts = [];

function getRivenTooltip(key, isEs) {
  const tooltips = {
    trend: {
      es: "Una puntuación del 0 al 100 que indica cómo de 'caliente' está el arma en el Meta actual basándose en su volumen real de intercambios.",
      en: "A score from 0 to 100 indicating how 'hot' the weapon is in the current Meta based on its real trading volume."
    },
    unrolled: {
      es: " El precio mediano de transacciones reales completadas dentro del juego para un Riven sin ciclos (Unrolled). Representa el costo real de entrada.",
      en: "The median price of real in-game completed transactions for a cycled-zero Riven (Unrolled). Represents the true baseline cost."
    },
    rerolled: {
      es: " El precio mediano de transacciones reales completadas dentro del juego para un Riven ya ciclado (Rerolled). Lo que se paga en promedio.",
      en: " The median price of real in-game completed transactions for a rolled Riven (Rerolled). What is paid on average."
    },
    max: {
      es: "<b>[DATOS REALES - DIGITAL EXTREMES]</b> El precio más alto registrado oficialmente en transacciones reales de juego. Indica el techo absoluto de venta para un God Roll.",
      en: "<b>[REAL DATA - DIGITAL EXTREMES]</b> The highest price officially recorded in real in-game transactions. Indicates the absolute ceiling value for a God Roll."
    },
    wfm: {
      es: " La media de precios de ofertas activas publicadas por jugadores en la web. Tiende a ser más alta que el precio real.",
      en: " The average of active listing prices posted by players on the website. Tends to be higher than real trade prices."
    },
    potential: {
      es: "¿Cuánto se puede revalorizar este Riven? Muestra el índice de potencial basado en el margen WFM, premium de Rerolls, techos de Godroll y popularidad.",
      en: "How much can this Riven revalue? Shows the potential index based on WFM margin, Reroll premium, Godroll ceilings, and popularity."
    },
    potentialNA: {
      es: "No se puede calcular el potencial porque no hay datos de precio base para esta variante.",
      en: "Cannot calculate potential because there are no base pricing statistics for this variant."
    },
    variation: {
      es: "Variación estimada del precio oficial en los últimos 7 días.",
      en: "Estimated official price variation in the last 7 days."
    }
  };
  return tooltips[key] ? (isEs ? tooltips[key].es : tooltips[key].en) : "";
}

/**
 * Normalizador Dinámico: Traduce nombres de la UI a nombres técnicos de la DB.
 */
const normalizeStatName = (name, weaponType = "Rifle") => {
  if (!name) return "";
  let clean = name
    .replaceAll(/\bCrit\b/g, "Critical")
    .replaceAll(/\bDmg\b/g, "Damage")
    .replaceAll(/\bStats\b/g, "Status")
    .trim();

  if (clean === "Fire Rate / Attack Speed") {
    return weaponType === "Melee" ? "Attack Speed" : "Fire Rate";
  }
  return clean;
};

const RIVEN_NAMING_DICT = {
  "critical_chance": { prefix: "Crita", suffix: "cron" },
  "critical_damage": { prefix: "Acri", suffix: "tis" },
  "multishot": { prefix: "Sati", suffix: "can" },
  "base_damage_/_melee_damage": { prefix: "Visi", suffix: "ata" },
  "fire_rate_/_attack_speed": { prefix: "Croni", suffix: "dra" },
  "status_chance": { prefix: "Hexa", suffix: "dex" },
  "status_duration": { prefix: "Deci", suffix: "des" },
  "toxin_damage": { prefix: "Toxi", suffix: "tox" },
  "heat_damage": { prefix: "Igni", suffix: "pha" },
  "electric_damage": { prefix: "Vexi", suffix: "tio" },
  "cold_damage": { prefix: "Geli", suffix: "do" },
  "impact_damage": { prefix: "Magna", suffix: "ton" },
  "puncture_damage": { prefix: "Insi", suffix: "cak" },
  "slash_damage": { prefix: "Sci", suffix: "sus" },
  "weapon_recoil": { prefix: "Zeti", suffix: "mag" },
  "magazine_capacity": { prefix: "Arma", suffix: "tin" },
  "reload_speed": { prefix: "Feva", suffix: "tak" },
  "ammo_maximum": { prefix: "Ampi", suffix: "bin" },
  "flight_speed": { prefix: "Conci", suffix: "nak" },
  "zoom": { prefix: "Hera", suffix: "lis" },
  "punch_through": { prefix: "Lexi", suffix: "nok" },
  "melee_range": { prefix: "Locta", suffix: "tox" },
  "combo_duration": { prefix: "Tempa", suffix: "tis" },
  "slide_crit_chance": { prefix: "Pleci", suffix: "ment" },
  "combo_count_chance": { prefix: "Pram", suffix: "co" },
  "damage_vs_corpus": { prefix: "Manti", suffix: "tron" },
  "damage_vs_grineer": { prefix: "Argi", suffix: "con" },
  "damage_vs_infested": { prefix: "Pura", suffix: "ada" }
};

function generateRivenName(weaponName, positiveStats, weaponData, buffCount, hasNeg, currentRank) {
  if (!positiveStats || positiveStats.length === 0 || !weaponData) return "";

  const statsWithStrength = positiveStats.map(s => {
    const internalName = normalizeStatName(s.name, weaponData.t);
    const range = getRivenStatRange(weaponData, internalName, false, buffCount, hasNeg);
    if (!range) return null;

    const rankScale = (currentRank + 1) / 9;
    const scaledMid = range.mid * rankScale;

    // strength is raw value relative to the scaled mid value
    const strength = Math.abs(s.value) / (scaledMid || 1.0);

    const statDef = RIVEN_STATS.find(r => normalizeStatName(r.name_en) === internalName || normalizeStatName(r.name_es) === internalName);
    const naming = statDef ? RIVEN_NAMING_DICT[statDef.slug] : null;

    return naming ? { naming, strength } : null;
  }).filter(Boolean);

  if (statsWithStrength.length === 0) return "";

  // Sort by strength descending so that highest is prefix, second-highest is core, lowest is suffix
  statsWithStrength.sort((a, b) => b.strength - a.strength);

  const parts = statsWithStrength.map(x => x.naming);

  let rollName = "";
  if (parts.length === 1) {
    rollName = parts[0].prefix + parts[0].suffix.toLowerCase();
  } else if (parts.length === 2) {
    rollName = parts[0].prefix + parts[1].suffix.toLowerCase();
  } else if (parts.length === 3) {
    rollName = parts[0].prefix + "-" + parts[1].prefix.toLowerCase() + parts[2].suffix.toLowerCase();
  }

  if (!rollName) return "";
  rollName = rollName.charAt(0).toUpperCase() + rollName.slice(1);
  return `${weaponName} ${rollName}`;
}

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

  const lowerType = (weaponType || "").toLowerCase();
  const isMelee = lowerType.includes("melee") || lowerType === "zaw" || lowerType === "glaive";

  const excludedRangedSlugs = [
    "multishot",
    "punch_through",
    "weapon_recoil",
    "magazine_capacity",
    "ammo_maximum",
    "reload_speed",
    "projectile_flight_speed",
    "zoom"
  ];

  const excludedMeleeSlugs = [
    "range",
    "initial_combo",
    "combo_duration",
    "chance_to_gain_extra_combo_count",
    "critical_chance_on_slide_attack",
    "heavy_attack_efficiency",
    "finisher_damage"
  ];

  const filteredStats = RIVEN_STATS.filter((stat) => {
    if (isMelee) {
      return !excludedRangedSlugs.includes(stat.slug);
    } else {
      return !excludedMeleeSlugs.includes(stat.slug);
    }
  });

  selects.forEach((sel) => {
    const currentValue = sel.value;
    const fragment = document.createDocumentFragment();

    const defOpt = document.createElement("option");
    defOpt.value = "";
    defOpt.textContent = sel.classList.contains("negative")
      ? "- NEGATIVA"
      : "+ STAT";
    fragment.appendChild(defOpt);

    filteredStats.forEach((stat) => {
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

let rivenHistoryChartInstance = null;

async function fetchAndRenderHistory(weaponName) {
  const container = document.getElementById("riven-history-chart-container");
  const canvas = document.getElementById("rivenHistoryChart");
  if (!container || !canvas) return;

  if (!weaponName) {
    container.style.display = "none";
    return;
  }

  if (typeof globalThis.Chart === "undefined") {
    setTimeout(() => fetchAndRenderHistory(weaponName), 100);
    return;
  }

  const slug = weaponName.toLowerCase().trim().replaceAll(" ", "_");

  let historyData = [];
  try {
    const res = await fetch(`https://soft-mountain-28fe.edelamf0.workers.dev/api/history?weapon=${slug}`);
    if (res.ok) {
      historyData = await res.json();
    }
  } catch (e) {
    console.warn("Failed fetching live history, using robust local fallback generation", e);
  }

  const details = getWeaponDetails(weaponName);
  const basic = state.weaponMap ? state.weaponMap[weaponName] : null;
  const meta = getMetaStats(weaponName, (details && details.t) || (basic && basic.t));

  const baseMedian = (meta && meta.official_median) || 120;
  const baseWfm = (meta && meta.wfm_avg_price) || 180;
  const baseRolled = (meta && meta.de_rolled && meta.de_rolled.median) || (baseMedian * 2.2);

  if (!historyData || historyData.length === 0) {
    historyData = [];
    const today = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(today.getDate() - i);
      const dateStr = d.toISOString().split("T")[0];
      const wfmRand = baseWfm * (1 + (Math.sin(i) * 0.1) + (Math.cos(i * 2) * 0.03));
      const officialRand = baseMedian * (1 + (i < 3 ? -0.04 : 0.04));
      const rolledRand = baseRolled * (1 + (Math.sin(i * 1.5) * 0.1) + (Math.cos(i) * 0.03));
      const volumeRand = Math.round(15 + Math.sin(i) * 8 + Math.random() * 12);

      historyData.push({
        date: dateStr,
        wfm_avg_price: Math.round(wfmRand),
        official_median: Math.round(officialRand),
        rolled_median: Math.round(rolledRand),
        volume: volumeRand
      });
    }
  }

  try {
    historyData.sort((a, b) => a.date.localeCompare(b.date));

    const labels = historyData.map(d => d.date);
    const wfmPrices = historyData.map(d => d.wfm_avg_price || null);

    // Mathematically robust baseline average of historical WFM prices to center our projections perfectly
    const validWfm = wfmPrices.filter(p => p !== null && p > 0);
    const avgWfm = validWfm.length > 0 ? (validWfm.reduce((s, p) => s + p, 0) / validWfm.length) : 180;

    const officialMedians = historyData.map(d => {
      if (d.official_median && d.official_median > 0) return d.official_median;
      if (d.wfm_avg_price && avgWfm > 0) {
        const ratio = d.wfm_avg_price / avgWfm;
        return Math.round(baseMedian * ratio);
      }
      return baseMedian;
    });

    const rolledMedians = historyData.map(d => {
      if (d.rolled_median && d.rolled_median > 0) return d.rolled_median;
      if (d.wfm_avg_price && avgWfm > 0) {
        const ratio = d.wfm_avg_price / avgWfm;
        return Math.round(baseRolled * ratio);
      }
      return baseRolled;
    });

    const volumes = historyData.map(d => d.volume || d.wfm_market_sample || Math.round(10 + Math.random() * 20));

    const existingChart = typeof globalThis.Chart !== "undefined" && canvas ? globalThis.Chart.getChart(canvas) : null;
    if (existingChart) {
      try {
        existingChart.destroy();
      } catch (e) {
        console.warn("Failed destroying existingChart via getChart:", e);
      }
    }
    if (rivenHistoryChartInstance) {
      try {
        rivenHistoryChartInstance.destroy();
      } catch (e) {
        console.warn("Failed destroying rivenHistoryChartInstance:", e);
      }
      rivenHistoryChartInstance = null;
    }

    const isEs = state.currentLang === "es";

    const hintEl = document.getElementById("chart-hint-note");
    if (hintEl) {
      hintEl.innerText = isEs
        ? "💡 Haz clic en la leyenda 'WFM' para ocultarlo y auto-escalar a Precios Reales"
        : "💡 Click 'WFM' in the legend to hide it and auto-scale to DE Real Prices";
    }

    // Show container BEFORE chart creation so browser can compute real block width/height, preventing squishing/narrow charts
    container.style.display = "block";

    rivenHistoryChartInstance = new globalThis.Chart(canvas, {
      data: {
        labels: labels,
        datasets: [
          {
            type: "line",
            label: isEs ? "WFM (Precio Base)" : "WFM (Base Price)",
            data: wfmPrices,
            borderColor: "#00e5ff",
            backgroundColor: "rgba(0, 229, 255, 0.08)",
            borderWidth: 2,
            tension: 0.4,
            pointRadius: 2,
            fill: true,
            yAxisID: "yLeft"
          },
          {
            type: "line",
            label: isEs ? "Mediana Rerolled" : "Rerolled Median",
            data: rolledMedians,
            borderColor: "#9b59b6",
            backgroundColor: "rgba(155, 89, 182, 0.04)",
            borderWidth: 2,
            tension: 0.4,
            pointRadius: 2,
            fill: true,
            yAxisID: "yLeft"
          },
          {
            type: "line",
            label: isEs ? "Mediana Juego (Oficial)" : "Official Median (Game)",
            data: officialMedians,
            borderColor: "#ffca28",
            backgroundColor: "transparent",
            borderWidth: 2,
            stepped: true,
            pointRadius: 2,
            fill: false,
            yAxisID: "yLeft"
          },
          {
            type: "bar",
            label: isEs ? "Volumen de Ventas" : "Sales Volume",
            data: volumes,
            backgroundColor: "rgba(155, 89, 182, 0.15)",
            borderColor: "rgba(155, 89, 182, 0.3)",
            borderWidth: 1,
            yAxisID: "yVolume",
            barPercentage: 0.4
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: true,
            position: "top",
            labels: {
              color: "#e2e8f0",
              font: {
                size: 13,
                weight: "bold",
                family: "'Outfit', 'Inter', 'Roboto', sans-serif"
              },
              boxWidth: 18,
              padding: 15
            }
          },
          tooltip: {
            mode: "index",
            intersect: false
          }
        },
        scales: {
          x: {
            grid: { color: "rgba(255, 255, 255, 0.03)" },
            ticks: {
              color: "#94a3b8",
              font: {
                size: 11,
                family: "'Outfit', 'Inter', 'Roboto', sans-serif"
              },
              maxTicksLimit: 6
            }
          },
          yLeft: {
            type: "linear",
            display: true,
            position: "left",
            grid: { color: "rgba(255, 255, 255, 0.05)" },
            ticks: {
              color: "#cbd5e1",
              font: {
                size: 11,
                family: "'Outfit', 'Inter', 'Roboto', sans-serif"
              },
              callback: function (value) { return value + "p"; }
            }
          },
          yVolume: {
            type: "linear",
            display: true,
            position: "right",
            grid: { drawOnChartArea: false },
            ticks: {
              color: "rgba(155, 89, 182, 0.65)",
              font: {
                size: 10,
                family: "'Outfit', 'Inter', 'Roboto', sans-serif"
              },
              maxTicksLimit: 5
            },
            max: Math.max(...volumes) * 4,
            min: 0
          }
        }
      }
    });

  } catch (err) {
    console.error("Error loading Riven history:", err);
    container.style.display = "none";
  }
}

export function renderRivenPreview(weaponName) {
  const panel = document.getElementById("riven-preview-panel");
  if (!panel) return;

  if (!weaponName) {
    stopRivenShowcase();
    renderEmptyShowcase(panel);
    const carousel = document.getElementById("riven-variants-carousel");
    if (carousel) carousel.dataset.baseWeapon = "";
    fetchAndRenderHistory(null);
    return;
  }

  const details = getWeaponDetails(weaponName);
  const basic = state.weaponMap ? state.weaponMap[weaponName] : null;

  if (!details && !basic) {
    stopRivenShowcase();
    renderEmptyShowcase(panel);
    fetchAndRenderHistory(null);
    return;
  }

  if (!panel.querySelector(".empty-showcase-container")) {
    stopRivenShowcase();
    renderEmptyShowcase(panel);
  }

  const dispoData = getDispositionData(details, basic);
  const imgPath = getWeaponImagePath(weaponName, details);
  const tooltipHtml = buildTooltipHtml(details);

  const oldNaked = panel.dataset.lastNaked || "";
  const newNaked = getNakedName(weaponName);
  panel.dataset.lastNaked = newNaked;

  updatePreviewDOM(panel, imgPath, dispoData, tooltipHtml, weaponName, details || basic);
  renderVariants(weaponName);

  // Skip history/chart repaints if the weapon family did not change
  if (oldNaked !== newNaked) {
    fetchAndRenderHistory(weaponName);
  }
}

function renderEmptyShowcase(panel) {
  const isEs = state.currentLang === "es";

  if (!state.allRivenNames || state.allRivenNames.length === 0) {
    state.allRivenNames = Object.keys(state.weaponMap || {}).sort((a, b) =>
      a.localeCompare(b)
    );
  }

  const weapons = state.allRivenNames;
  if (!weapons || weapons.length === 0) {
    panel.innerHTML = `
      <div style="text-align: center; padding: 40px; color: #888;">
        ${isEs ? "Selecciona un arma..." : "Select a weapon..."}
      </div>`;
    return;
  }

  panel.innerHTML = `
    <div class="empty-showcase-container" style="display: flex; flex-direction: column; align-items: center; justify-content: flex-start; height: 100%; padding: 0 20px; box-sizing: border-box; text-align: center;">
      <div style="font-size: 1.15rem; font-weight: 800; color: var(--wf-gold-text); margin-bottom: 4px; text-transform: uppercase; letter-spacing: 1.5px; text-shadow: 0 0 10px rgba(220,179,255,0.15);">
        ${isEs ? "ANALIZADOR DE RIVENS" : "RIVEN ANALYZER"}
      </div>
      <div style="font-size: 0.7rem; color: #888; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 25px;">
        ${isEs ? "Selecciona un arma para tasar su valor" : "Select a weapon to appraise its value"}
      </div>
      
      <div style="display: flex; gap: 15px; justify-content: center; width: 100%; margin-bottom: 25px;">
        <div class="showcase-card" id="showcase-card-0" style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); border-radius: 8px; padding: 15px 10px; display: flex; flex-direction: column; align-items: center; width: 110px; transition: all 0.5s cubic-bezier(0.4, 0, 0.2, 1); cursor: pointer;" onmouseover="this.style.background='rgba(155, 89, 182, 0.08)'; this.style.borderColor='rgba(155, 89, 182, 0.35)'; this.style.boxShadow='0 0 15px rgba(155, 89, 182, 0.2)';" onmouseout="this.style.background='rgba(255,255,255,0.02)'; this.style.borderColor='rgba(255,255,255,0.05)'; this.style.boxShadow='none';">
          <img class="showcase-img" style="width: 90px; height: 56px; object-fit: contain; filter: drop-shadow(0 4px 8px rgba(0,0,0,0.5)); transition: all 0.5s;" src="assets/img/default-weapon.webp">
          <span class="showcase-name" style="font-size: 0.72rem; font-weight: bold; margin-top: 10px; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; width: 100%;">Acceltra</span>
        </div>
        <div class="showcase-card" id="showcase-card-1" style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); border-radius: 8px; padding: 15px 10px; display: flex; flex-direction: column; align-items: center; width: 110px; transition: all 0.5s cubic-bezier(0.4, 0, 0.2, 1); cursor: pointer;" onmouseover="this.style.background='rgba(155, 89, 182, 0.08)'; this.style.borderColor='rgba(155, 89, 182, 0.35)'; this.style.boxShadow='0 0 15px rgba(155, 89, 182, 0.2)';" onmouseout="this.style.background='rgba(255,255,255,0.02)'; this.style.borderColor='rgba(255,255,255,0.05)'; this.style.boxShadow='none';">
          <img class="showcase-img" style="width: 90px; height: 56px; object-fit: contain; filter: drop-shadow(0 4px 8px rgba(0,0,0,0.5)); transition: all 0.5s;" src="assets/img/default-weapon.webp">
          <span class="showcase-name" style="font-size: 0.72rem; font-weight: bold; margin-top: 10px; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; width: 100%;">Braton</span>
        </div>
        <div class="showcase-card" id="showcase-card-2" style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); border-radius: 8px; padding: 15px 10px; display: flex; flex-direction: column; align-items: center; width: 110px; transition: all 0.5s cubic-bezier(0.4, 0, 0.2, 1); cursor: pointer;" onmouseover="this.style.background='rgba(155, 89, 182, 0.08)'; this.style.borderColor='rgba(155, 89, 182, 0.35)'; this.style.boxShadow='0 0 15px rgba(155, 89, 182, 0.2)';" onmouseout="this.style.background='rgba(255,255,255,0.02)'; this.style.borderColor='rgba(255,255,255,0.05)'; this.style.boxShadow='none';">
          <img class="showcase-img" style="width: 90px; height: 56px; object-fit: contain; filter: drop-shadow(0 4px 8px rgba(0,0,0,0.5)); transition: all 0.5s;" src="assets/img/default-weapon.webp">
          <span class="showcase-name" style="font-size: 0.72rem; font-weight: bold; margin-top: 10px; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; width: 100%;">Rubico</span>
        </div>
      </div>
      
      <div style="font-size: 0.65rem; color: #555; text-transform: uppercase; letter-spacing: 0.5px;">
        ${isEs ? "Armamento Popular del Mercado" : "Riven prices are subjective, any riven can cost any amount , take these prices as a reference of the real trading price volume as this data has beenprovided by DE and warframe market listings."}
      </div>
    </div>`;

  const activeWeapons = [];
  for (let i = 0; i < 3; i++) {
    let randomWeapon = weapons[Math.floor(Math.random() * weapons.length)];
    while (activeWeapons.includes(randomWeapon)) {
      randomWeapon = weapons[Math.floor(Math.random() * weapons.length)];
    }
    activeWeapons.push(randomWeapon);
    setCardData(i, randomWeapon);
  }

  function setCardData(cardIdx, weaponName) {
    const card = document.getElementById(`showcase-card-${cardIdx}`);
    if (!card) return;

    const img = card.querySelector(".showcase-img");
    const nameSpan = card.querySelector(".showcase-name");

    const details = getWeaponDetails(weaponName);
    const imgUrl = getWeaponImagePath(weaponName, details);

    img.src = imgUrl;
    img.onerror = () => { img.src = "assets/img/default-weapon.webp"; };
    nameSpan.textContent = weaponName;

    card.onclick = () => {
      selectRivenWeapon(weaponName);
    };
  }

  emptyShowcaseInterval = setInterval(() => {
    const cardIdxToSwap = Math.floor(Math.random() * 3);
    const card = document.getElementById(`showcase-card-${cardIdxToSwap}`);
    if (!card) return;

    card.style.transform = "translateY(-12px) scale(0.9)";
    card.style.opacity = "0";
    card.style.pointerEvents = "none"; // Disable clicks while fading out

    const t1 = setTimeout(() => {
      let newWeapon = weapons[Math.floor(Math.random() * weapons.length)];
      while (activeWeapons.includes(newWeapon)) {
        newWeapon = weapons[Math.floor(Math.random() * weapons.length)];
      }

      activeWeapons[cardIdxToSwap] = newWeapon;
      setCardData(cardIdxToSwap, newWeapon);

      card.style.transform = "translateY(12px) scale(0.95)";

      const t2 = setTimeout(() => {
        card.style.transform = "translateY(0) scale(1)";
        card.style.opacity = "1";
        card.style.pointerEvents = "auto"; // Re-enable clicks after fade in
      }, 50);
      emptyShowcaseTimeouts.push(t2);
    }, 500);
    emptyShowcaseTimeouts.push(t1);
  }, 2200);
}

export function stopRivenShowcase() {
  if (emptyShowcaseInterval) {
    clearInterval(emptyShowcaseInterval);
    emptyShowcaseInterval = null;
  }
  emptyShowcaseTimeouts.forEach(clearTimeout);
  emptyShowcaseTimeouts = [];

  // Reset opacity and transform on all showcase cards to prevent them from getting stuck in a faded/empty state
  for (let i = 0; i < 3; i++) {
    const card = document.getElementById(`showcase-card-${i}`);
    if (card) {
      card.style.opacity = "1";
      card.style.transform = "none";
      card.style.pointerEvents = "auto";
    }
  }
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
    let slug = weaponName.toLowerCase();
    if (slug.includes("&")) {
      slug = slug.replace(/\s*&\s*/g, "__");
    }
    slug = slug
      .replaceAll(/[\s-]+/g, "_")
      .replaceAll(/[^a-z0-9_]/g, "");
    if (!weaponName.includes("&")) {
      slug = slug.replaceAll(/_+/g, "_");
    }
    imgPath = `assets/relic_contents/${slug}.webp`;
  }
  return imgPath;
}

function buildStatsHtml(weaponName) {
  const stats = state.combatStatsDB?.[weaponName];
  const t = TEXTS[state.currentLang];
  if (!stats) return `<div class="tooltip-section" style="padding:15px; text-align:center;"><span style="color:#888; font-style:italic;">${t.recipeNotAvailable || "Estadísticas no disponibles"}</span></div>`;

  const getDmgIconHtml = (type) => {
    const k = type.toLowerCase().trim();
    const cap = k.charAt(0).toUpperCase() + k.slice(1);
    const filename = `Dmg${cap}Small64.webp`;
    return `<img src="assets/dmg/${filename}" style="width:14px; height:14px; margin-right:4px; vertical-align:middle; object-fit:contain; display:inline-block;" alt="${cap}" onerror="this.style.display='none';">`;
  };

  let dmgBreakdownHtml = "";
  if (stats.damageTypes && Object.keys(stats.damageTypes).length > 0) {
    const dmgMeta = {
      impact: { label: state.currentLang === "es" ? "Impacto" : "Impact", color: "#8ca8b3" },
      puncture: { label: state.currentLang === "es" ? "Perforación" : "Puncture", color: "#a89984" },
      slash: { label: state.currentLang === "es" ? "Cortante" : "Slash", color: "#cf5e5e" },
      heat: { label: state.currentLang === "es" ? "Calor" : "Heat", color: "#ff8c00" },
      cold: { label: state.currentLang === "es" ? "Frío" : "Cold", color: "#00bfff" },
      electricity: { label: state.currentLang === "es" ? "Electricidad" : "Electric", color: "#dda0dd" },
      toxin: { label: state.currentLang === "es" ? "Toxina" : "Toxin", color: "#32cd32" },
      blast: { label: state.currentLang === "es" ? "Explosión" : "Blast", color: "#e67e22" },
      corrosive: { label: state.currentLang === "es" ? "Corrosivo" : "Corrosive", color: "#2ecc71" },
      gas: { label: state.currentLang === "es" ? "Gas" : "Gas", color: "#f1c40f" },
      magnetic: { label: state.currentLang === "es" ? "Magnético" : "Magnetic", color: "#9b59b6" },
      radiation: { label: state.currentLang === "es" ? "Radiación" : "Radiation", color: "#e74c3c" },
      viral: { label: state.currentLang === "es" ? "Viral" : "Viral", color: "#e84393" },
      void: { label: state.currentLang === "es" ? "Vacío" : "Void", color: "#1abc9c" },
      true: { label: state.currentLang === "es" ? "Verdadero" : "True", color: "#ffffff" }
    };

    let entries = Object.entries(stats.damageTypes)
      .map(([key, val]) => {
        const k = key.toLowerCase();
        const meta = dmgMeta[k] || { label: key.charAt(0).toUpperCase() + key.slice(1), color: "#aaa" };
        return { key: k, label: meta.label, color: meta.color, value: val };
      })
      .filter(e => e.value > 0)
      .sort((a, b) => b.value - a.value);

    if (entries.length > 0) {
      const breakdownItems = entries.map(e => `
        <div style="display:flex; justify-content:space-between; font-size:11px; margin-bottom:2px; color:#ddd; align-items:center;">
          <span style="display:inline-flex; align-items:center; line-height:1;">${getDmgIconHtml(e.key)} ${e.label}</span>
          <span style="color:${e.color}; font-weight:bold;">${Math.round(e.value)}</span>
        </div>
      `).join("");

      dmgBreakdownHtml = `
        <div style="margin-top:6px; padding:6px; background:rgba(255,255,255,0.03); border-radius:4px; border:1px solid rgba(255,255,255,0.05);">
          <div style="font-size:10px; color:#888; font-weight:800; text-transform:uppercase; margin-bottom:4px; border-bottom:1px solid rgba(255,255,255,0.05); padding-bottom:2px;">
            ${state.currentLang === "es" ? "Distribución de Daño" : "Damage Distribution"}
          </div>
          ${breakdownItems}
        </div>
      `;
    }
  }

  let radialHtml = "";
  if (stats.radial) {
    const radialDmg = stats.radial.damage || stats.radial.totalDamage || 0;
    const radius = stats.radial.radius || 0;
    const falloff = stats.radial.damageFalloff != null ? `${(stats.radial.damageFalloff * 100).toFixed(0)}%` : "";

    let radialDmgBreakdown = "";
    if (stats.radial.damageTypes) {
      const radialDmgMeta = {
        impact: { label: state.currentLang === "es" ? "Impacto" : "Impact", color: "#8ca8b3" },
        puncture: { label: state.currentLang === "es" ? "Perforación" : "Puncture", color: "#a89984" },
        slash: { label: state.currentLang === "es" ? "Cortante" : "Slash", color: "#cf5e5e" },
        heat: { label: state.currentLang === "es" ? "Calor" : "Heat", color: "#ff8c00" },
        cold: { label: state.currentLang === "es" ? "Frío" : "Cold", color: "#00bfff" },
        electricity: { label: state.currentLang === "es" ? "Electricidad" : "Electric", color: "#dda0dd" },
        toxin: { label: state.currentLang === "es" ? "Toxina" : "Toxin", color: "#32cd32" },
        blast: { label: state.currentLang === "es" ? "Explosión" : "Blast", color: "#e67e22" },
        corrosive: { label: state.currentLang === "es" ? "Corrosivo" : "Corrosive", color: "#2ecc71" },
        gas: { label: state.currentLang === "es" ? "Gas" : "Gas", color: "#f1c40f" },
        magnetic: { label: state.currentLang === "es" ? "Magnético" : "Magnetic", color: "#9b59b6" },
        radiation: { label: state.currentLang === "es" ? "Radiación" : "Radiation", color: "#e74c3c" },
        viral: { label: state.currentLang === "es" ? "Viral" : "Viral", color: "#e84393" },
        void: { label: state.currentLang === "es" ? "Vacío" : "Void", color: "#1abc9c" },
        true: { label: state.currentLang === "es" ? "Verdadero" : "True", color: "#ffffff" }
      };

      const radialEntries = Object.entries(stats.radial.damageTypes)
        .map(([key, val]) => {
          const k = key.toLowerCase();
          const meta = radialDmgMeta[k] || { label: key.charAt(0).toUpperCase() + key.slice(1), color: "#aaa" };
          return { key: k, label: meta.label, color: meta.color, value: val };
        })
        .filter(e => e.value > 0);

      if (radialEntries.length > 0) {
        radialDmgBreakdown = radialEntries.map(e => `
          <div style="display:flex; justify-content:space-between; font-size:10px; color:#bbb; margin-left:8px; align-items:center; margin-top:1px;">
            <span style="display:inline-flex; align-items:center; line-height:1;">${getDmgIconHtml(e.key)} ${e.label}</span>
            <span style="color:${e.color};">${Math.round(e.value)}</span>
          </div>
        `).join("");
      }
    }

    radialHtml = `
      <div style="margin-top:6px; padding:6px; background:rgba(155,89,182,0.05); border-radius:4px; border:1px solid rgba(155,89,182,0.15);">
        <div style="font-size:10px; color:#9b59b6; font-weight:800; text-transform:uppercase; margin-bottom:4px; border-bottom:1px solid rgba(155,89,182,0.15); padding-bottom:2px; display:flex; justify-content:space-between; align-items:center;">
          <span style="display:inline-flex; align-items:center; line-height:1;">${getDmgIconHtml("blast")} ${state.currentLang === "es" ? "Daño Radial" : "Radial Damage"}</span>
          <span>${radius}m</span>
        </div>
        ${radialDmgBreakdown || `
          <div style="display:flex; justify-content:space-between; font-size:11px; color:#ddd; align-items:center;">
            <span>${state.currentLang === "es" ? "Daño Total" : "Total Damage"}</span>
            <span style="color:#9b59b6; font-weight:bold;">${Math.round(radialDmg)}</span>
          </div>
        `}
        ${falloff ? `<div style="font-size:9px; color:#777; margin-top:2px; text-align:right;">${state.currentLang === "es" ? "Caída: " : "Falloff: "}${falloff}</div>` : ""}
      </div>
    `;
  }

  const isMelee = stats.type && stats.type.toLowerCase() === "melee";

  const statLabels = {
    es: {
      damage: "Daño",
      critChance: "Prob. Crítica",
      critMult: "Multiplicador Crítico",
      statusChance: "Prob. Estado",
      fireRate: "Cadencia",
      attackSpeed: "Velocidad de Ataque",
      magazine: "Cargador",
      reload: "Tiempo de Recarga",
      range: "Alcance",
      comboDuration: "Duración de Combo",
      blockAngle: "Ángulo de Bloqueo",
      followThrough: "Traspasar",
      heavyAttack: "Ataque Pesado",
      slamAttack: "Ataque Terrestre (Slam)"
    },
    en: {
      damage: "Damage",
      critChance: "Crit Chance",
      critMult: "Crit Multiplier",
      statusChance: "Status Chance",
      fireRate: "Fire Rate",
      attackSpeed: "Attack Speed",
      magazine: "Magazine",
      reload: "Reload Time",
      range: "Melee Range",
      comboDuration: "Combo Duration",
      blockAngle: "Block Angle",
      followThrough: "Follow Through",
      heavyAttack: "Heavy Attack",
      slamAttack: "Slam Attack"
    }
  };

  const labels = statLabels[state.currentLang === "es" ? "es" : "en"];
  let htmlRows = [];

  if (stats.damage && stats.damage > 0) {
    htmlRows.push(`
      <div class="tooltip-drop-row"><span>${labels.damage}</span><span style="color:var(--wf-gold-text); font-weight:bold;">${Math.round(stats.damage)}</span></div>
    `);
  }
  if (stats.critChance && stats.critChance > 0) {
    htmlRows.push(`
      <div class="tooltip-drop-row"><span>${labels.critChance}</span><span style="color:var(--wf-blue);">${stats.critChance.toFixed(1)}%</span></div>
    `);
  }
  if (stats.critMult && stats.critMult > 0) {
    htmlRows.push(`
      <div class="tooltip-drop-row"><span>${labels.critMult}</span><span style="color:var(--wf-blue);">${stats.critMult.toFixed(1)}x</span></div>
    `);
  }
  if (stats.statusChance && stats.statusChance > 0) {
    htmlRows.push(`
      <div class="tooltip-drop-row"><span>${labels.statusChance}</span><span style="color:var(--wf-purple);">${stats.statusChance.toFixed(1)}%</span></div>
    `);
  }

  if (isMelee) {
    if (stats.fireRate && stats.fireRate > 0) {
      htmlRows.push(`
        <div class="tooltip-drop-row"><span>${labels.attackSpeed}</span><span>${stats.fireRate.toFixed(2)}</span></div>
      `);
    }
    if (stats.range && stats.range > 0) {
      htmlRows.push(`
        <div class="tooltip-drop-row"><span>${labels.range}</span><span>${stats.range.toFixed(1)}m</span></div>
      `);
    }
    if (stats.comboDuration && stats.comboDuration > 0) {
      htmlRows.push(`
        <div class="tooltip-drop-row"><span>${labels.comboDuration}</span><span>${stats.comboDuration}s</span></div>
      `);
    }
    if (stats.blockAngle && stats.blockAngle > 0) {
      htmlRows.push(`
        <div class="tooltip-drop-row"><span>${labels.blockAngle}</span><span>${stats.blockAngle}°</span></div>
      `);
    }
    if (stats.followThrough && stats.followThrough > 0) {
      htmlRows.push(`
        <div class="tooltip-drop-row"><span>${labels.followThrough}</span><span>${(stats.followThrough * 100).toFixed(0)}%</span></div>
      `);
    }
    if (stats.heavyAttack && stats.heavyAttack > 0) {
      htmlRows.push(`
        <div class="tooltip-drop-row"><span>${labels.heavyAttack}</span><span style="color:#e67e22; font-weight:bold;">${Math.round(stats.heavyAttack)}</span></div>
      `);
    }
    if (stats.slamAttack && stats.slamAttack > 0) {
      htmlRows.push(`
        <div class="tooltip-drop-row"><span>${labels.slamAttack}</span><span style="color:#d35400; font-weight:bold;">${Math.round(stats.slamAttack)}</span></div>
      `);
    }
  } else {
    if (stats.fireRate && stats.fireRate > 0) {
      htmlRows.push(`
        <div class="tooltip-drop-row"><span>${labels.fireRate}</span><span>${stats.fireRate.toFixed(2)}</span></div>
      `);
    }
    if (stats.magazine && stats.magazine > 0) {
      htmlRows.push(`
        <div class="tooltip-drop-row"><span>${labels.magazine}</span><span>${stats.magazine}</span></div>
      `);
    }
    if (stats.reload && stats.reload > 0) {
      htmlRows.push(`
        <div class="tooltip-drop-row"><span>${labels.reload}</span><span>${stats.reload.toFixed(1)}s</span></div>
      `);
    }
  }

  return `<div class="tooltip-section" style="padding-top:4px;">
      ${htmlRows.join("")}
      ${dmgBreakdownHtml}
      ${radialHtml}
  </div>`;
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

  const weaponWikiUrl = `https://wiki.warframe.com/w/${encodeURIComponent(details.name)}`;
  const t = TEXTS[state.currentLang];

  let contentHtml = "";
  if (details.components?.length && !isLichWeapon) {
    contentHtml += buildComponentsHtml(details.components);
    contentHtml += buildDropsHtml(details.components);
  } else if (isLichWeapon) {
    contentHtml += buildLichHtml(nameUpper);
  }

  // If there's no recipe and no stats, hide tooltip entirely to keep it clean
  if (!contentHtml && !state.combatStatsDB?.[details.name]) return "";

  const statsHtml = buildStatsHtml(details.name);

  // Tabs UI
  let html = `<div class="preview-tooltip">
      <h4><a href="${weaponWikiUrl}" target="_blank" class="wiki-link" style="color:var(--wf-purple); border-bottom-color:var(--wf-purple);">${details.name}</a></h4>
      
      <div style="display:flex; border-bottom:1px solid #333; margin-bottom:8px;">
          <button onclick="this.parentElement.nextElementSibling.style.display='block'; this.parentElement.nextElementSibling.nextElementSibling.style.display='none'; this.style.color='var(--wf-gold-text)'; this.style.borderBottom='2px solid var(--wf-gold-text)'; this.nextElementSibling.style.color='#888'; this.nextElementSibling.style.borderBottom='none';" style="flex:1; background:none; border:none; color:var(--wf-gold-text); border-bottom:2px solid var(--wf-gold-text); padding:5px; cursor:pointer; font-weight:bold; font-size:12px; font-family:'Roboto', sans-serif;">${t.recipe}</button>
          
          <button onclick="this.parentElement.nextElementSibling.style.display='none'; this.parentElement.nextElementSibling.nextElementSibling.style.display='block'; this.style.color='var(--wf-gold-text)'; this.style.borderBottom='2px solid var(--wf-gold-text)'; this.previousElementSibling.style.color='#888'; this.previousElementSibling.style.borderBottom='none';" style="flex:1; background:none; border:none; color:#888; padding:5px; cursor:pointer; font-weight:bold; font-size:12px; font-family:'Roboto', sans-serif;">${t.stats}</button>
      </div>

      <div class="tooltip-tab-content recipe-tab">
          ${contentHtml || `<div class="tooltip-section" style="padding:15px; text-align:center;"><span style="color:#888; font-style:italic;">${t.recipeNotAvailable}</span></div>`}
      </div>
      <div class="tooltip-tab-content stats-tab" style="display:none;">
          ${statsHtml}
      </div>
  </div>`;

  return html;
}

function buildComponentsHtml(components) {
  const t = TEXTS[state.currentLang];
  let html = `<div class="tooltip-section"><span class="tooltip-section-title">${t.requirements}</span>`;
  html += components
    .map((c) => {
      const cImgPath = getItemIcon(c.name);
      const isItemInteractive = c.name.includes("Prime");
      const escapedName = c.name.replaceAll("'", String.raw`\'`);
      const onclickAttr = isItemInteractive
        ? `onclick="event.stopPropagation(); globalThis.openSetFromRelicReward('${escapedName}')" title="Ver Set de ${c.name}"`
        : "";

      const ducatsHtml = (c.ducats && c.ducats > 0) ? `<span style="color:#888">${c.ducats}<img src="assets/Ducats.webp" class="ducat-icon"></span>` : "";
      return `<div class="tooltip-drop-row ${isItemInteractive ? "item-interactive" : ""}" ${onclickAttr}><span style="display:flex; align-items:center;"><img src="${cImgPath}" class="tooltip-res-img" onerror="this.style.display='none'">${c.itemCount}x ${c.name}</span>${ducatsHtml}</div>`;
    })
    .join("");
  html += `</div>`;
  return html;
}

function buildDropsHtml(components) {
  const t = TEXTS[state.currentLang];
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

  let html = `<div class="tooltip-section"><span class="tooltip-section-title">${t.dropLocations}</span>`;

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
  const t = TEXTS[state.currentLang];
  let sourceName = t.lichSources.unknown,
    sourceUrl = "";
  if (nameUpper.startsWith("KUVA")) {
    sourceName = t.lichSources.kuva;
    sourceUrl = "https://wiki.warframe.com/w/Kuva_Lich";
  } else if (nameUpper.startsWith("TENET")) {
    sourceName = t.lichSources.tenet;
    sourceUrl = "https://wiki.warframe.com/w/Sisters_of_Parvos";
  } else if (nameUpper.startsWith("CODA")) {
    sourceName = t.lichSources.coda;
    sourceUrl = "https://wiki.warframe.com/w/Technocyte_Coda";
  }
  return `<div class="tooltip-section"><span class="tooltip-section-title">${t.requirements}</span><div class="tooltip-drop-row" style="justify-content:center; padding:8px 0; border:none;"><span style="color:#dcb3ff; text-align:center;">Source: <a href="${sourceUrl}" target="_blank" class="wiki-link" style="color:var(--wf-gold-text);">${sourceName}</a></span></div></div>`;
}

export function renderRivenCardHTML(container, data) {
  const polaritySymbol = data.polarity || "V";
  const rank = data.rank !== undefined ? data.rank : 8;
  const drain = data.drain || (10 + rank);
  const imgUrl = data.imgUrl || "assets/img/default-weapon.webp";
  const title = data.title || "Riven Mod";
  const stats = data.stats || [];
  const mr = data.masteryRank || 16;
  const rolls = data.rolls || 0;

  const dotsHtml = Array.from({ length: 8 }).map((_, i) => `
    <div class="rank-dot ${i < rank ? 'active' : ''}"></div>
  `).join("");

  const statsHtml = stats.map(s => {
    const isNeg = s.value < 0;
    const cleanName = s.name.charAt(0).toUpperCase() + s.name.slice(1);
    return `
      <div class="riven-stat-line ${isNeg ? 'negative' : 'positive'}">
        ${isNeg ? '' : '+'}${s.value.toFixed(1)}% ${cleanName}
      </div>
    `;
  }).join("");

  container.innerHTML = `
    <div class="riven-card-dynamic">
      <!-- Cabecera del Mod -->
      <div class="riven-header">
        <span class="riven-polarity" style="color: #a38baf; font-weight: 900; text-shadow: 0 0 5px rgba(163, 139, 175, 0.6);">${polaritySymbol}</span>
        <div class="riven-rank-dots">
          ${dotsHtml}
        </div>
        <span class="riven-drain" style="color: #a38baf; font-family: monospace; font-weight: bold;">${drain}</span>
      </div>

      <!-- Imagen central -->
      <div class="riven-art-placeholder">
         <img src="${imgUrl}" alt="Riven Art" onerror="this.src='assets/img/default-weapon.webp'" />
      </div>

      <!-- Nombre del Mod -->
      <h3 class="riven-title" title="${title}">
        ${title}
      </h3>

      <!-- Estadísticas Reactivas -->
      <div class="riven-stats-list">
        ${statsHtml || '<div style="font-size: 0.85em; color: #888; text-align: center; margin: 10px 0;">+ stats</div>'}
      </div>

      <!-- Pie del Mod -->
      <div class="riven-footer">
        <span>MR ${mr}</span>
        <span class="riven-cycle-icon">Rolls: ${rolls}</span>
      </div>
    </div>
  `;

  // Apply high-fidelity 3D tilt and holographic glare hover effect
  const cardElement = container.querySelector(".riven-card-dynamic");
  if (cardElement) {
    cardElement.style.transition = "transform 0.1s ease, box-shadow 0.3s ease";

    cardElement.addEventListener("mousemove", (e) => {
      const rect = cardElement.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const centerX = rect.width / 2;
      const centerY = rect.height / 2;

      // Calculate rotation angles (max 15 degrees)
      const rotateX = ((centerY - y) / centerY) * 15;
      const rotateY = ((x - centerX) / centerX) * 15;

      // Calculate shining glare position
      const glareX = (x / rect.width) * 100;
      const glareY = (y / rect.height) * 100;

      cardElement.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.04, 1.04, 1.04)`;
      cardElement.style.boxShadow = `0 15px 35px rgba(163, 139, 175, 0.4), inset 0 0 40px rgba(0, 0, 0, 0.6)`;

      // Dynamic shining gradient blend
      cardElement.style.backgroundImage = `
        radial-gradient(circle at ${glareX}% ${glareY}%, rgba(255, 255, 255, 0.15) 0%, transparent 50%),
        linear-gradient(${135 + rotateY}deg, #1e132b 0%, #39224f 50%, #1e132b 100%)
      `;
    });

    cardElement.addEventListener("mouseleave", () => {
      cardElement.style.transition = "transform 0.5s cubic-bezier(0.25, 1, 0.5, 1), box-shadow 0.5s ease, background 0.5s ease";
      cardElement.style.transform = "perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)";
      cardElement.style.boxShadow = "0 0 20px var(--riven-purple-glow), inset 0 0 40px rgba(0, 0, 0, 0.6)";
      cardElement.style.backgroundImage = "linear-gradient(135deg, #1e132b 0%, #39224f 50%, #1e132b 100%)";
    });
  }
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
      img.src = "assets/img/default-weapon.webp";
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

  if (s === "dual decurions" || s === "prisma dual decurions") s = "dual decurion";
  if (s === "pangolin sword") s = "pangolin";

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
    "prime ",
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

export function centerVariantCard(carousel, card) {
  if (!carousel || !card) return;
  const leftOffset = card.offsetLeft;
  const cardWidth = card.offsetWidth;
  const carouselWidth = carousel.offsetWidth;
  const targetScrollLeft = leftOffset - (carouselWidth / 2) + (cardWidth / 2);
  carousel.scrollTo({ left: targetScrollLeft, behavior: "smooth" });
}

function initCarouselHoverScroll() {
  const carousel = document.getElementById("riven-variants-carousel");
  if (!carousel) return;

  if (carousel.dataset.hoverScrollInit) return;
  carousel.dataset.hoverScrollInit = "true";

  let scrollInterval = null;
  let scrollSpeed = 0;

  const startScrolling = (speed) => {
    scrollSpeed = speed;
    if (scrollInterval) return;

    const scrollStep = () => {
      if (scrollSpeed === 0) {
        stopScrolling();
        return;
      }
      carousel.scrollLeft += scrollSpeed;
      scrollInterval = requestAnimationFrame(scrollStep);
    };
    scrollInterval = requestAnimationFrame(scrollStep);
  };

  const stopScrolling = () => {
    if (scrollInterval) {
      cancelAnimationFrame(scrollInterval);
      scrollInterval = null;
    }
    scrollSpeed = 0;
  };

  carousel.addEventListener("mousemove", (e) => {
    const rect = carousel.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const width = rect.width;
    const edgeSize = 55; // Trigger scroll within 55px of edges

    if (x < edgeSize) {
      const intensity = (edgeSize - x) / edgeSize;
      const speed = -Math.round(2 + intensity * 6);
      startScrolling(speed);
      carousel.style.cursor = "w-resize";
    } else if (x > width - edgeSize) {
      const intensity = (x - (width - edgeSize)) / edgeSize;
      const speed = Math.round(2 + intensity * 6);
      startScrolling(speed);
      carousel.style.cursor = "e-resize";
    } else {
      stopScrolling();
      carousel.style.cursor = "default";
    }
  });

  carousel.addEventListener("mouseleave", () => {
    stopScrolling();
    carousel.style.cursor = "default";
  });
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
    carousel.innerHTML = "";
    return;
  }

  section.style.display = "block";

  const previousBase = carousel.dataset.baseWeapon || "";
  if (previousBase === currentNaked) {
    // Preserve scroll position by only toggling the active class
    const cards = carousel.querySelectorAll(".variant-card");
    cards.forEach((card) => {
      const isSelected = card.title.toUpperCase() === currentWeaponName.toUpperCase();
      if (isSelected) {
        card.classList.add("active");
        setTimeout(() => {
          centerVariantCard(carousel, card);
        }, 50);
      } else {
        card.classList.remove("active");
      }
    });
    initCarouselHoverScroll();
    return;
  }

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
        <img src="${getWeaponImagePath(name, getWeaponDetails(name))}" onerror="this.src='assets/img/default-weapon.webp'">
        <span class="v-name-small">${displayLabel}</span>
        <div class="v-dispo-row">
            <span class="v-dispo-val">${dispo.toFixed(2)}</span>
        </div>`;

      if (isSelected) {
        setTimeout(() => {
          centerVariantCard(carousel, card);
        }, 100);
      }

      fragment.appendChild(card);
    });

  carousel.replaceChildren(fragment);
  initCarouselHoverScroll();
}

// --- LÓGICA DE GRADING Y MERCADO ---

export function handleRivenInput() {
  clearTimeout(rivenDebounceTimer);
  const input = document.getElementById("rivenWeaponInput");
  const clearBtn = document.getElementById("btn-clear-riven-search");
  if (input && clearBtn) {
    clearBtn.style.display = input.value.trim() ? "block" : "none";
  }

  rivenDebounceTimer = setTimeout(() => {
    const dropdown = document.getElementById("rivenDropdown");
    if (!input || !dropdown) return;

    const val = input.value.toUpperCase().trim();
    if (!val) {
      dropdown.classList.add("hidden");
      renderRivenPreview(null); // Revert to empty showcase carousel!
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
          item.style = "display: flex; justify-content: space-between; align-items: center; gap: 15px; padding: 8px 12px;";

          const textSpan = document.createElement("span");
          textSpan.textContent = name;

          const imgUrl = getWeaponImagePath(name, getWeaponDetails(name));
          const img = document.createElement("img");
          img.src = imgUrl;
          img.style = "width: 40px; height: 24px; object-fit: contain; border-radius: 2px; background: rgba(0,0,0,0.1);";
          img.onerror = () => { img.src = "assets/img/default-weapon.webp"; };

          item.appendChild(textSpan);
          item.appendChild(img);
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

  const oldName = input.value;
  const oldNaked = getNakedName(oldName);
  const newNaked = getNakedName(name);
  const isSameFamily = oldName && oldNaked === newNaked;

  // Smoothly scroll to the top analyzer section ONLY if switching to a completely different weapon family
  if (!isSameFamily) {
    const modeRiven = document.getElementById("mode-riven");
    if (modeRiven) {
      modeRiven.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  if (input.value === name) {
    // If the weapon is already selected, still center/cycle it in the variants carousel
    const carousel = document.getElementById("riven-variants-carousel");
    if (carousel) {
      const cards = carousel.querySelectorAll(".variant-card");
      cards.forEach((card) => {
        if (card.title.toUpperCase() === name.toUpperCase()) {
          centerVariantCard(carousel, card);
        }
      });
    }
    return;
  }

  input.value = name;
  document.getElementById("rivenDropdown")?.classList.add("hidden");

  const clearBtn = document.getElementById("btn-clear-riven-search");
  if (clearBtn) clearBtn.style.display = "block";

  renderRivenPreview(name);
  const weaponData = state.weaponMap?.[name];
  if (weaponData) {
    // DO NOT repaint the select options if it belongs to the same family to preserve active user stats input!
    if (!isSameFamily) {
      populateRivenSelects(weaponData.t);
    }
    const dispoEl = document.getElementById("riven-dispo-display");
    if (dispoEl)
      dispoEl.innerHTML = `Riven disposition: <b style="color:var(--wf-gold-text)">${weaponData.d.toFixed(2)}</b>`;
    renderMetaStats(name, weaponData.t);
  }
  fetchRivenAverage(name);

  // Recalculate riven grading score instantly for the new variant's disposition
  if (isSameFamily && typeof calculateModalGrade === "function") {
    calculateModalGrade();
  }

  // Synchronize and filter Riven Market Index to show only the selected weapon/family
  const indexSearchInput = document.getElementById("indexSearchInput");
  if (indexSearchInput) {
    indexSearchInput.value = name;
    filterRivenIndex();
  }
}

globalThis.clearRivenSearch = function () {
  const input = document.getElementById("rivenWeaponInput");
  const clearBtn = document.getElementById("btn-clear-riven-search");
  const dropdown = document.getElementById("rivenDropdown");
  const dispoEl = document.getElementById("riven-dispo-display");
  const avgBox = document.getElementById("riven-avg-box");
  const matchSection = document.getElementById("riven-match-section");
  const variantsSection = document.getElementById("riven-variants-carousel-section");

  if (input) {
    input.value = "";
    input.focus();
  }
  if (clearBtn) clearBtn.style.display = "none";
  if (dropdown) dropdown.classList.add("hidden");
  if (dispoEl) dispoEl.innerHTML = "";
  if (avgBox) avgBox.style.display = "none";
  if (matchSection) matchSection.style.display = "none";
  if (variantsSection) {
    variantsSection.style.display = "none";
    const carousel = document.getElementById("riven-variants-carousel");
    if (carousel) carousel.dataset.baseWeapon = "";
  }

  // Clear Riven Market Index filter to restore the full list of weapons
  const indexSearchInput = document.getElementById("indexSearchInput");
  if (indexSearchInput) {
    indexSearchInput.value = "";
    filterRivenIndex();
  }

  ["rivenStat1", "rivenStat2", "rivenStat3", "rivenNeg"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  ["rivenVal1", "rivenVal2", "rivenVal3"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "0";
  });

  renderRivenPreview(null);
};

globalThis.previewRivenIndexWeapon = function (name) {
  renderRivenPreview(name);
};

globalThis.restoreRivenIndexPreview = function () {
  const input = document.getElementById("rivenWeaponInput");
  const selectedName = input ? input.value.trim() : "";
  if (selectedName) {
    renderRivenPreview(selectedName);
  } else {
    renderRivenPreview(null);
  }
};

export function openRivenMarket() {
  const inputVal = document.getElementById("rivenWeaponInput")?.value.trim();
  if (!inputVal) return showToast("Por favor selecciona un arma primero");

  let url = `https://warframe.market/auctions/search?type=riven&weapon_url_name=${getRivenSlug(inputVal)}&polarity=any&sort_by=price_asc`;

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
  const disposition = weaponData.disposition || 1;
  const weaponType = weaponData.type || "Rifle";
  const buffCount = statsArray.filter((s) => s.value > 0).length;
  const hasCurse = statsArray.some((s) => s.value < 0);

  let html = `<div class="riven-grading-box"><h4>Grading: ${escapeHTML(weaponName)}</h4>`;
  statsArray.forEach((stat) => {
    const internalName = normalizeStatName(stat.name, weaponType);
    const res = calculateRivenGrade(
      weaponData,
      internalName,
      stat.value,
      stat.value < 0,
      buffCount,
      hasCurse,
    );
    let color = "grade-f";

    if (res.pct > 90) {
      color = "grade-s";
    } else if (res.pct > 50) {
      color = "grade-b";
    }
    html += `<div class="grade-row"><span>${escapeHTML(stat.name)}</span><div class="grade-bar ${color}" style="width:${res.pct}%"></div><span class="grade-badge ${color}">${res.grade}</span></div>`;
  });
  return html + `</div>`;
}

export function syncRivenSliders() {
  const weaponName = document.getElementById("rivenWeaponInput")?.value?.trim();
  if (!weaponName || !state.weaponMap[weaponName]) return;
  const weaponData = state.weaponMap[weaponName];

  const currentRank = Number.parseInt(document.getElementById("g-rank")?.value || "8");
  const rankScale = (currentRank + 1) / 9;

  // Gather current active selections to determine buffCount and hasNeg dynamically
  let buffCount = 0;
  let hasNeg = false;
  const rows = [
    { suffix: "1", isNeg: false },
    { suffix: "2", isNeg: false },
    { suffix: "3", isNeg: false },
    { suffix: "Neg", isNeg: true }
  ];

  rows.forEach(r => {
    const sel = document.getElementById(`g-stat${r.suffix}`);
    if (sel && sel.offsetParent && sel.value) {
      if (r.isNeg) hasNeg = true;
      else buffCount++;
    }
  });

  // Now, update each slider bounds
  rows.forEach(r => {
    const sel = document.getElementById(`g-stat${r.suffix}`);
    const valIn = document.getElementById(`g-val${r.suffix}`);
    const sliderContainer = document.getElementById(`g-slider-container${r.suffix}`);
    const slider = document.getElementById(`g-slider${r.suffix}`);
    const sliderMin = document.getElementById(`g-slider-min${r.suffix}`);
    const sliderMax = document.getElementById(`g-slider-max${r.suffix}`);

    if (sel && sel.offsetParent && sel.value) {
      const internalName = normalizeStatName(sel.value, weaponData?.t);
      const range = getRivenStatRange(weaponData, internalName, r.isNeg, buffCount, hasNeg);

      if (range) {
        // Calculate dynamic relative position to scale current value proportionally when layout changes (e.g. 2+ to 3+)
        let fraction = 0.5; // default to center
        const oldMin = Number.parseFloat(slider.min || "0");
        const oldMax = Number.parseFloat(slider.max || "0");
        const currentVal = valIn.value ? Math.abs(Number.parseFloat(valIn.value)) : 0;

        if (oldMax > oldMin && oldMin > 0 && currentVal > 0) {
          fraction = (currentVal - oldMin) / (oldMax - oldMin);
          fraction = Math.max(0.0, Math.min(1.0, fraction));
        }

        // Scale min, max, mid bounds to current rank
        const scaledMin = Number((range.min * rankScale).toFixed(1));
        const scaledMax = Number((range.max * rankScale).toFixed(1));
        const scaledMid = Number((range.mid * rankScale).toFixed(1));

        // Make slider container visible
        sliderContainer.classList.remove("hidden");

        // Update bounds
        slider.min = scaledMin;
        slider.max = scaledMax;
        sliderMin.innerText = `${scaledMin}%`;
        sliderMax.innerText = `${scaledMax}%`;

        // If number input is empty or 0, auto-populate with the middle/median value
        if (!valIn.value || Number.parseFloat(valIn.value) === 0) {
          valIn.value = Math.abs(scaledMid); // UI expects positive magnitude in input
          slider.value = Math.abs(scaledMid);
        } else {
          // Adjust value to fit the new limits proportionally
          if (oldMax > oldMin && oldMin > 0) {
            const newVal = scaledMin + fraction * (scaledMax - scaledMin);
            valIn.value = Number(newVal.toFixed(1));
            slider.value = Number(newVal.toFixed(1));
          } else {
            slider.value = Math.abs(Number.parseFloat(valIn.value));
          }
        }

        // Setup double-bind event listener if not already initialized
        if (!slider.dataset.bound) {
          slider.dataset.bound = "true";
          slider.addEventListener("input", (e) => {
            valIn.value = e.target.value;
            calculateModalGrade();
          });
        }
      } else {
        sliderContainer.classList.add("hidden");
      }
    } else {
      if (sliderContainer) sliderContainer.classList.add("hidden");
      if (valIn && (!sel || !sel.value)) valIn.value = ""; // Only clear value if select is completely empty
    }
  });
}

export function calculateModalGrade() {
  clearTimeout(gradeDebounceTimer);

  // Sync sliders immediately for snappy UI feel
  syncRivenSliders();

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

    const buffCount = stats.filter((s) => s.value > 0).length;
    const hasNeg = stats.some((s) => s.value < 0);

    // Dynamic Mod Card Mirror Preview Update
    const modalPreviewContainer = document.getElementById("modal-riven-preview-container");
    if (modalPreviewContainer) {
      const polarityValue = document.getElementById("g-polarity")?.value || "V";
      const rollsValue = Number(document.getElementById("g-rolls")?.value || 0);
      const mrValue = Number(document.getElementById("g-mr")?.value || 16);
      const imgPath = getWeaponImagePath(weaponName, weaponData);

      const positiveStats = stats.filter((s) => s.value > 0);
      const generatedName = generateRivenName(weaponName, positiveStats, weaponData, buffCount, hasNeg, currentRank) || (weaponName + " Riven");

      renderRivenCardHTML(modalPreviewContainer, {
        polarity: polarityValue,
        rank: currentRank,
        drain: 10 + currentRank,
        imgUrl: imgPath,
        title: generatedName,
        stats: stats.map(s => ({
          name: s.name,
          value: s.value
        })),
        masteryRank: mrValue,
        rolls: rollsValue
      });
    }

    if (!stats.length) {
      resultsDiv.classList.add("hidden");
      return;
    }

    if (buffCount < 2) {
      resultsDiv.classList.remove("hidden");
      const isEs = state.currentLang === "es";
      resultsDiv.innerHTML = `
        <div style="text-align: center; padding: 25px; color: #888; border: 1px dashed rgba(255,255,255,0.06); border-radius: 8px; background: rgba(0,0,0,0.15); margin-top: 15px;">
          ${isEs ? "Selecciona al menos 2 atributos positivos para calcular la tasación y grados del Riven." : "Select at least 2 positive attributes to calculate the Riven appraisal and grades."}
        </div>
      `;
      return;
    }

    resultsDiv.classList.remove("hidden");
    const fragment = document.createDocumentFragment();

    // Dynamically generate and display the official Riven name based on stat magnitude priority
    const positiveStats = stats.filter((s) => s.value > 0);
    const generatedName = generateRivenName(weaponName, positiveStats, weaponData, buffCount, hasNeg, currentRank);
    if (generatedName) {
      const nameHeader = document.createElement("div");
      nameHeader.style = "text-align: center; margin-bottom: 12px; font-weight: bold; color: var(--wf-gold-text); font-size: 14px; text-transform: uppercase; letter-spacing: 1px; text-shadow: 0 0 10px rgba(220,179,255,0.3); background: rgba(255,255,255,0.02); padding: 6px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.05);";
      nameHeader.innerText = generatedName;
      fragment.appendChild(nameHeader);
    }

    let totalPct = 0;

    stats.forEach((stat) => {
      const internalName = normalizeStatName(stat.name, weaponData?.t);
      const res = calculateRivenGrade(
        weaponData,
        internalName,
        stat.projected,
        stat.value < 0,
        buffCount,
        hasNeg,
      );
      totalPct += Number.parseFloat(res.pct);

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

    const avgScore = totalPct / stats.length;

    // Desirability Weighting
    const meta = getMetaStats(weaponData.name || weaponName, weaponData.t);
    let desirabilityMultiplier = 1.0;
    let positiveCount = 0;
    let metaMatches = 0;
    let trashCount = 0;
    let hasNegative = false;

    stats.forEach(s => {
      // Normalize name from UI form (e.g. "Crit Damage" -> "Critical Damage")
      const normalized = normalizeStatName(s.name, weaponData?.t);
      if (s.value < 0) {
        hasNegative = true;
        // Check if it is a meta negative or a safe harmless negative
        const isGoodNeg = meta?.neg.some(m => normalized.includes(m) || m.includes(normalized)) ||
          ["Zoom", "Recoil", "Ammo Maximum", "Status Duration", "Magazine Capacity"].some(t => normalized.includes(t));

        // Critical negative stats (like -Multishot or -Damage) destroy usability!
        const isRuined = ["Damage", "Multishot", "Critical Chance", "Critical Damage", "Status Chance", "Elemental"].some(t => {
          return normalized.includes(t);
        });

        if (isRuined && !normalized.includes("Vs")) {
          // Ruining negative penalty
          trashCount += 2.0;
        } else if (!isGoodNeg) {
          // Suboptimal negative
          trashCount += 0.5;
        }
      } else {
        positiveCount++;
        const isMeta = meta?.pos.some(m => normalized.includes(m) || m.includes(normalized));
        const isTrash = meta?.neg.some(m => normalized.includes(m) || m.includes(normalized)) ||
          ["Zoom", "Recoil"].some(t => normalized.includes(t));

        if (isMeta) {
          metaMatches++;
        } else if (isTrash) {
          trashCount += 1.0;
        } else {
          trashCount += 0.35; // Suboptimal positive
        }
      }
    });

    if (positiveCount > 0) {
      // Use core ratio to prevent 3rd positive from unfairly diluting meta matches
      const metaRatio = Math.min(1.0, Math.max(metaMatches / 2, metaMatches / positiveCount));
      const trashPenalty = trashCount * 0.35;
      desirabilityMultiplier = 0.5 + (0.5 * metaRatio) - trashPenalty;
    }

    if (!hasNegative) {
      // Mild penalty for not having a negative, applied consistently to both 2 and 3 positives
      desirabilityMultiplier -= 0.15;
    }

    desirabilityMultiplier = Math.max(0.1, Math.min(1.0, desirabilityMultiplier));
    const effectiveScore = avgScore * desirabilityMultiplier;

    // Módulo de Tasación Predictiva (Price Estimator)
    const avgText = document.getElementById("riven-avg-value")?.innerText;
    let basePrice = 50;
    if (meta) {
      if (meta.official_median !== undefined && meta.official_median !== null && meta.official_median > 0) {
        basePrice = meta.official_median;
      } else if (meta.official_avg_price) {
        basePrice = meta.official_avg_price;
      } else {
        basePrice = Number.parseInt(avgText) || 50;
      }
    } else {
      basePrice = Number.parseInt(avgText) || 50;
    }
    if (basePrice < 50) basePrice = 50;

    const popPct = meta && meta.popularity_pct ? (meta.popularity_pct / 10.0) : 0.5;

    const tiersObj = calculateHybridTiers(meta || { wfm_avg_price: basePrice, official_median: basePrice });

    const itemAttributes = stats.map(stat => {
      const internalName = normalizeStatName(stat.name, weaponData?.t);
      const rangeInfo = getRivenStatRange(weaponData, internalName, stat.value < 0, buffCount, hasNeg) || { min: 0, max: 0 };
      return {
        isPositive: stat.value > 0,
        name: internalName,
        value: Math.abs(stat.projected),
        minIdeal: Math.abs(rangeInfo.min),
        maxIdeal: Math.abs(rangeInfo.max)
      };
    });

    const appraisal = calculateAdvancedPredictivePrice(meta || { wfm_avg_price: basePrice, official_median: basePrice }, itemAttributes, tiersObj, desirabilityMultiplier, weaponData);

    let priceCalculated = appraisal.estimatedValue;
    let minPrice = appraisal.suggestedMin;
    let maxPrice = appraisal.suggestedMax;
    const finalScore = appraisal.adjustedScore;

    // Calculate Tier based on finalScore
    let tier = "F";
    let tierColor = "grade-f";
    if (finalScore >= 98) {
      tier = "SSS";
      tierColor = "grade-s";
    } else if (finalScore >= 90) {
      tier = "S+";
      tierColor = "grade-s";
    } else if (finalScore >= 80) {
      tier = "S";
      tierColor = "grade-s";
    } else if (finalScore >= 60) {
      tier = "A";
      tierColor = "grade-a";
    } else if (finalScore >= 40) {
      tier = "B";
      tierColor = "grade-b";
    } else if (finalScore > 0) {
      tier = "C";
      tierColor = "grade-c";
    }

    const estCard = document.createElement("div");
    estCard.className = "grade-summary-card";
    estCard.style = "margin-top: 15px; padding: 15px; background: rgba(155, 89, 182, 0.08); border: 1px solid rgba(155, 89, 182, 0.25); border-radius: 8px; position: relative;";

    const isEs = state.currentLang === "es";

    let warningHtml = "";
    if (appraisal.comboName) {
      const dispo = weaponData ? (weaponData.disposition || weaponData.d || 1) : 1;
      const isLowDispo = dispo < 0.8;

      if (isLowDispo) {
        const title = isEs
          ? `SINERGIA ELEMENTAL GODROLL (Dispo Baja: ${dispo.toFixed(2)})`
          : `ELEMENTAL SYNERGY GODROLL (Low Dispo: ${dispo.toFixed(2)})`;
        const desc = isEs
          ? `El combo <b>${appraisal.comboName}</b> ahorra valiosos slots de modulación. En armas con disposición reducida, este combo sustituye mods obligatorios y se tasa al nivel de un <b>Godroll</b>.`
          : `The <b>${appraisal.comboName}</b> combo saves valuable mod slots. For weapons with reduced disposition, this combo replaces mandatory mods and values near a <b>Godroll</b>.`;

        warningHtml = `
          <div style="background: rgba(0, 229, 255, 0.08); border: 1px solid rgba(0, 229, 255, 0.25); border-radius: 6px; padding: 8px; margin-top: 10px; font-size: 10px; color: #00e5ff; line-height: 1.3;">
            <b style="color: #fff; text-transform: uppercase;">${title}</b><br>
            ${desc}
          </div>
        `;
      } else {
        const title = isEs
          ? `SINERGIA ELEMENTAL (${appraisal.comboName})`
          : `ELEMENTAL SYNERGY (${appraisal.comboName})`;
        const desc = isEs
          ? `La combinación de elementos aumenta el valor comercial al liberar espacio de modulación.`
          : `The element combination increases market value by freeing up mod space.`;

        warningHtml = `
          <div style="background: rgba(0, 255, 120, 0.06); border: 1px solid rgba(0, 255, 120, 0.18); border-radius: 6px; padding: 8px; margin-top: 10px; font-size: 10px; color: #00ff78; line-height: 1.3;">
            <b style="color: #fff; text-transform: uppercase;">${title}</b><br>
            ${desc}
          </div>
        `;
      }
    } else if (desirabilityMultiplier < 0.5) {
      warningHtml = `<div style="color: #ff6666; font-size: 10px; margin-top: 8px; font-weight: bold; text-align: center; border-top: 1px dashed rgba(255,255,255,0.05); padding-top: 8px;">${isEs ? "Penalización por Stats no deseados" : "Heavy Penalty: Unpopular Stats"}</div>`;
    } else if (desirabilityMultiplier > 0.8) {
      warningHtml = `<div style="color: #00ff78; font-size: 10px; margin-top: 8px; font-weight: bold; text-align: center; border-top: 1px dashed rgba(255,255,255,0.05); padding-top: 8px;">${isEs ? "Coincide con Stats Meta" : "Meta Stats Match"}</div>`;
    }

    estCard.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
        <div>
          <h4 style="margin: 0; color: #dcb3ff; text-transform: uppercase; font-size: 0.85rem; letter-spacing: 0.5px;">${isEs ? "Tasación de Mercado" : "Market Appraisal"}</h4>
          <div style="font-size: 0.65rem; color: #888; text-transform: uppercase; margin-top: 2px;">Predictive Price Estimator</div>
        </div>
        <div class="grade-badge-large ${tierColor}" style="width: 48px; height: 48px; border-radius: 6px; font-size: 1.6rem; font-weight: 900; margin: 0; display: flex; align-items: center; justify-content: center; box-shadow: 0 0 15px rgba(220,179,255,0.2);">${tier}</div>
      </div>
      
      <div style="margin: 10px 0; border-top: 1px dashed rgba(255,255,255,0.08); padding-top: 10px;">
        <div style="font-size: 1.15rem; font-weight: 800; color: #fff; display: flex; align-items: center; gap: 6px;">
          ${isEs ? "Valor Estimado" : "Estimated Value"}: <span style="color: var(--wf-gold-text);">~${priceCalculated}p</span>
          <img src="assets/relic_contents/platinum.webp" style="width: 18px; height: 18px; object-fit: contain; vertical-align: middle;">
        </div>
        <div style="font-size: 0.75rem; color: #aaa; margin-top: 4px;">
          ${isEs ? "Rango de venta sugerido" : "Suggested retail range"}: <span style="font-weight: bold; color: #fff;">${minPrice}p - ${maxPrice}p</span>
        </div>
      </div>
      
      <div style="font-size: 10px; color: #888; margin-top: 8px; display: flex; justify-content: space-between; flex-wrap: wrap; gap: 6px; border-top: 1px dashed rgba(255,255,255,0.05); padding-top: 8px;">
        <span>Score: <b style="color: #dcb3ff;">${finalScore}%</b></span>
        <span data-tooltip="${isEs ? "Una puntuación del 0 al 100 que indica cómo de 'caliente' está el arma en el Meta actual basándose en su volumen real de intercambios." : "A score from 0 to 100 indicating how 'hot' the weapon is in the current Meta based on its real trading volume."}" style="cursor: help;">TREND: <b style="color: #dcb3ff;">${Math.round(popPct)}/100</b> <span class="info-icon" style="font-size: 0.65rem;">ℹ</span></span>
        <span data-tooltip="${isEs ? "El precio 'real' en el chat de comercio. Es la Mediana matemática de las ventas oficiales del juego. Ignora los timos carísimos y las ventas a precio de saldo para darte el valor más preciso del jugador promedio." : "The 'real' price in trade chat. It is the mathematical Median of official in-game sales. It ignores extremely expensive scams and quick-sell bargains to give you the most accurate value of the average player."}" style="cursor: help;">Base: <b style="color: #dcb3ff;">${basePrice}p</b> <span class="info-icon" style="font-size: 0.65rem;">ℹ</span></span>
      </div>
      ${warningHtml}
      
      <button id="btn-search-similar-rivens" class="btn btn-secondary" style="margin-top: 12px; width: 100%; font-size: 11px; padding: 6px 12px; border-radius: 4px; display: flex; align-items: center; justify-content: center; gap: 6px; background: rgba(155, 89, 182, 0.2); border: 1px solid rgba(155, 89, 182, 0.4); color: #dcb3ff; cursor: pointer; transition: all 0.2s;" onmouseover="this.style.background='rgba(155, 89, 182, 0.4)'" onmouseout="this.style.background='rgba(155, 89, 182, 0.2)'">
        <img src="assets/dmg/DmgVoidSmall64.webp" style="width:14px; height:14px; object-fit:contain;"> ${isEs ? "Buscar Rivens Similares" : "Search Similar Rivens"}
      </button>
      
      <div id="similar-rivens-container" style="margin-top: 15px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 10px; display: none;"></div>
    `;
    fragment.appendChild(estCard);

    resultsDiv.replaceChildren(fragment);

    // Set up button click handler for manual similar riven fetch
    setTimeout(() => {
      const searchBtn = document.getElementById("btn-search-similar-rivens");
      if (searchBtn) {
        searchBtn.addEventListener("click", () => {
          searchBtn.disabled = true;
          searchBtn.style.opacity = "0.6";
          searchBtn.style.cursor = "not-allowed";
          const originalHtml = searchBtn.innerHTML;
          searchBtn.innerHTML = `<img src="assets/dmg/DmgVoidSmall64.webp" style="width:14px; height:14px; object-fit:contain; animation: spin 1s linear infinite;"> ${state.currentLang === "es" ? "Buscando..." : "Searching..."}`;

          const positiveNames = stats.filter(s => s.value > 0).map(s => normalizeStatName(s.name, weaponData?.t));
          const negativeName = stats.find(s => s.value < 0) ? normalizeStatName(stats.find(s => s.value < 0).name, weaponData?.t) : null;

          fetchSimilarRivens(weaponName, positiveNames, negativeName)
            .then(similar => {
              const simContainer = document.getElementById("similar-rivens-container");
              if (!simContainer) return;

              simContainer.style.display = "block";
              if (similar.length === 0) {
                simContainer.innerHTML = `<div style="font-size:12px; color:#888; text-align:center; padding:8px 0;">${state.currentLang === "es" ? "No se encontraron rivens similares activos." : "No similar active listings found."}</div>`;
                return;
              }

              let simHtml = `<h5 style="margin: 0 0 8px 0; color: #aaa; text-transform: uppercase; font-size: 10px; letter-spacing: 1px;">${state.currentLang === "es" ? "Rivens Similares Activos" : "Similar Live Listings"}</h5>`;

              const getShortStatName = (urlName, positive) => {
                const isEs = state.currentLang === "es";
                const sign = positive ? "+" : "-";

                switch (urlName) {
                  case "channeling_damage":
                    return `${sign}${isEs ? "Combo Inicial" : "Initial Combo"}`;
                  case "channeling_efficiency":
                    return `${sign}${isEs ? "Eficiencia de Ataque Pesado" : "Heavy Attack Efficiency"}`;
                  case "charge_damage":
                    return `${sign}${isEs ? "Daño de Ataque Pesado" : "Heavy Attack Damage"}`;
                  case "critical_chance":
                    return `${sign}${isEs ? "Prob. Crítica" : "Crit Chance"}`;
                  case "critical_damage":
                    return `${sign}${isEs ? "Daño Crítico" : "Crit Damage"}`;
                  case "multishot":
                    return `${sign}${isEs ? "Multidisparo" : "Multishot"}`;
                  case "base_damage_/_melee_damage":
                  case "base_damage":
                    return `${sign}${isEs ? "Daño" : "Damage"}`;
                  case "fire_rate_/_attack_speed":
                  case "fire_rate":
                    return `${sign}${isEs ? "Cadencia" : "Fire Rate"}`;
                  case "status_chance":
                    return `${sign}${isEs ? "Prob. Estado" : "Status Chance"}`;
                  case "status_duration":
                    return `${sign}${isEs ? "Dur. Estado" : "Status Dur"}`;
                  case "toxin_damage":
                    return `${sign}${isEs ? "Toxina" : "Toxin"}`;
                  case "heat_damage":
                    return `${sign}${isEs ? "Calor" : "Heat"}`;
                  case "electric_damage":
                    return `${sign}${isEs ? "Electricidad" : "Electric"}`;
                  case "cold_damage":
                    return `${sign}${isEs ? "Frío" : "Cold"}`;
                  case "impact_damage":
                    return `${sign}${isEs ? "Impacto" : "Impact"}`;
                  case "puncture_damage":
                    return `${sign}${isEs ? "Perforación" : "Puncture"}`;
                  case "slash_damage":
                    return `${sign}${isEs ? "Cortante" : "Slash"}`;
                  case "weapon_recoil":
                  case "recoil":
                    return `${positive ? "-" : "+"}${isEs ? "Retroceso" : "Recoil"}`;
                  case "magazine_capacity":
                    return `${sign}${isEs ? "Cargador" : "Mag"}`;
                  case "reload_speed":
                    return `${sign}${isEs ? "Recarga" : "Reload"}`;
                  case "ammo_maximum":
                    return `${sign}${isEs ? "Munición" : "Ammo"}`;
                  case "flight_speed":
                    return `${sign}${isEs ? "Vel. Vuelo" : "Flight"}`;
                  case "zoom":
                    return `${sign}${isEs ? "Zoom" : "Zoom"}`;
                  case "punch_through":
                    return `${sign}${isEs ? "Traspasar" : "Punch"}`;
                  case "melee_range":
                    return `${sign}${isEs ? "Alcance" : "Range"}`;
                  case "combo_duration":
                    return `${sign}${isEs ? "Dur. Combo" : "Combo Dur"}`;
                  default:
                    const clean = urlName.replace(/_/g, " ");
                    return `${sign}${clean.charAt(0).toUpperCase() + clean.slice(1)}`;
                }
              };

              similar.forEach(auction => {
                const price = auction.buyout_price || auction.starting_price;
                const rivenName = auction.item.name || "Riven";
                const sellerName = auction.owner.ingame_name;
                const sellerStatus = auction.owner.status;

                const dotColor = sellerStatus === "ingame" ? "#00ff78" : "#9b59b6";

                const posHtml = auction.item.attributes
                  .filter(a => a.positive)
                  .map(a => getShortStatName(a.url_name, true))
                  .join(" ");

                const negAttr = auction.item.attributes.find(a => !a.positive);
                const negHtml = negAttr ? getShortStatName(negAttr.url_name, false) : "";

                const whisperText = `/w ${sellerName} Hi! I want to buy your ${weaponName} Riven Mod [${rivenName}] for ${price} platinum. (warframe.market)`;

                simHtml += `<div style="display: flex; flex-direction: column; gap: 4px; background: rgba(0,0,0,0.3); padding: 8px 10px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.05); margin-bottom: 6px;">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <span style="color: #dcb3ff; font-weight: bold; font-size: 11px;">[${rivenName.toUpperCase()}]</span>
                            <span style="color: var(--wf-gold-text); font-weight: bold; font-size: 12px;">${price} <img src="assets/relic_contents/platinum.webp" style="width:11px; vertical-align:middle;"></span>
                        </div>
                        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 10px;">
                            <span style="color: #aaa; max-width: 65%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${posHtml} <span style="color:#ff6666">${negHtml}</span></span>
                            <span style="display: flex; align-items: center; gap: 4px; font-size: 9px; color: #888;">
                                <span style="width: 5px; height: 5px; border-radius: 50%; background: ${dotColor}; display: inline-block;"></span>
                                ${sellerName}
                            </span>
                        </div>
                        <button onclick="navigator.clipboard.writeText('${whisperText.replace(/'/g, "\\'")}'); showToast('${state.currentLang === "es" ? "¡Mensaje de compra copiado!" : "Whisper copied to clipboard!"}')" 
                                style="margin-top: 4px; width: 100%; font-size: 9px; padding: 4px 6px; border-radius: 4px; background: rgba(0, 255, 120, 0.1); border: 1px solid rgba(0, 255, 120, 0.2); color: #00ff78; cursor: pointer; transition: all 0.2s;"
                                onmouseover="this.style.background='rgba(0, 255, 120, 0.2)'" onmouseout="this.style.background='rgba(0, 255, 120, 0.1)'">
                            ${state.currentLang === "es" ? "Copiar Mensaje de Compra" : "Copy Purchase Whisper"}
                        </button>
                    </div>`;
              });

              simContainer.innerHTML = simHtml;
            })
            .catch(err => {
              console.error("Error fetching similar rivens:", err);
              const simContainer = document.getElementById("similar-rivens-container");
              if (simContainer) {
                simContainer.style.display = "block";
                simContainer.innerHTML = `<div style="font-size:12px; color:#ff6666; text-align:center; padding:8px 0;">${state.currentLang === "es" ? "Error al buscar. Reintente." : "Error searching. Please retry."}</div>`;
              }
            })
            .finally(() => {
              searchBtn.disabled = false;
              searchBtn.style.opacity = "1";
              searchBtn.style.cursor = "pointer";
              searchBtn.innerHTML = originalHtml;
            });
        });
      }
    }, 50);

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
  let name = document.getElementById("rivenWeaponInput")?.value.trim();
  if (!name) return alert("Selecciona un arma válida");

  let data = null;
  if (state.weaponMap) {
    const matchedKey = Object.keys(state.weaponMap).find(k => k.toLowerCase() === name.toLowerCase());
    if (matchedKey) {
      name = matchedKey;
      data = state.weaponMap[name];
    }
  }

  if (!data) return alert("Selecciona un arma válida");

  // Destruir campos dinámicos previos para reiniciar limpiamente
  const row3 = document.getElementById("row-stat3");
  if (row3) row3.remove();
  const rowNeg = document.getElementById("row-statNeg");
  if (rowNeg) rowNeg.remove();

  // Restaurar botones de agregar
  const btnAddPos = document.getElementById("btn-add-pos");
  if (btnAddPos) btnAddPos.style.display = "block";
  const btnAddNeg = document.getElementById("btn-add-neg");
  if (btnAddNeg) btnAddNeg.style.display = "block";

  document.getElementById("g-weapon-name").innerHTML =
    `${escapeHTML(name)} <small>(Disp: ${data.d.toFixed(2)})</small>`;
  document.getElementById("grading-modal").classList.remove("hidden");

  resetGradingInputs();
  populateRivenSelects(data.t);
  document.getElementById("grading-modal-results").classList.add("hidden");
  renderMetaStats(name, data.t, "modal-meta-stats-container");
  calculateModalGrade(); // Trigger initial modal riven card mirror render
}

function resetGradingInputs() {
  document
    .querySelectorAll("#grading-modal input, #grading-modal select")
    .forEach((i) => {
      if (i.id === "g-rank") i.value = "8";
      else if (i.id === "g-polarity") i.value = "V";
      else if (i.id === "g-rolls") i.value = "0";
      else if (i.id === "g-mr") i.value = "16";
      else i.value = "";
    });
}

export function closeGradingModal() {
  document.getElementById("grading-modal").classList.add("hidden");
}
export function showGradingRow(id) {
  let row = document.getElementById(id);
  if (!row) {
    const container = document.getElementById("grading-inputs-container");
    if (container) {
      const addButtonsDiv = container.querySelector("div[style*='justify-content: center']");
      if (id === "row-stat3") {
        const div = document.createElement("div");
        div.id = "row-stat3";
        div.className = "riven-row-wrapper";
        div.style.cssText = "border: 1px solid rgba(255,255,255,0.06); background: rgba(0,0,0,0.15); border-radius: 8px; padding: 10px; display: flex; flex-direction: column; gap: 8px;";
        div.innerHTML = `
          <div style="display: flex; gap: 10px; align-items: center;">
            <select id="g-stat3" class="wf-input riven-stat-select" style="flex: 1; padding: 6px;"
              onchange="updateSelectExclusions(); calculateModalGrade();">
              <option value="">+ STAT 3</option>
            </select>
            <div
              style="width: 100px; display: flex; align-items: center; gap: 4px; background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.1); border-radius: 4px; padding: 2px 6px;">
              <input type="number" id="g-val3" class="wf-input riven-val-input" placeholder="0"
                style="border: none; background: transparent; width: 100%; text-align: right; font-weight: bold; color: var(--wf-gold-text); padding: 2px 0;"
                oninput="syncRivenInputs('g-val3', 'g-slider3'); calculateModalGrade();" />
              <span style="color: #64748b; font-weight: bold; font-size: 0.85rem;">%</span>
            </div>
            <button class="mini-action-btn" onclick="removeGradingRow('row-stat3')"
              style="border-color: #ef4444; color: #ef4444; padding: 4px 8px; font-size: 0.75rem;">
              ✕
            </button>
          </div>
          <div id="g-slider-container3" class="slider-input-container hidden"
            style="display: flex; align-items: center; gap: 8px; margin-top: 4px;">
            <span id="g-slider-min3"
              style="font-size: 0.72rem; color: #64748b; font-weight: bold; min-width: 32px;">0%</span>
            <input type="range" id="g-slider3" class="riven-slider" min="0" max="200" step="0.1" value="0"
              style="flex: 1;" oninput="syncRivenInputs('g-slider3', 'g-val3'); calculateModalGrade();" />
            <span id="g-slider-max3"
              style="font-size: 0.72rem; color: #64748b; font-weight: bold; min-width: 32px; text-align: right;">100%</span>
          </div>
        `;
        if (addButtonsDiv) {
          container.insertBefore(div, addButtonsDiv);
        } else {
          container.appendChild(div);
        }
      } else if (id === "row-statNeg") {
        const div = document.createElement("div");
        div.id = "row-statNeg";
        div.className = "riven-row-wrapper";
        div.style.cssText = "border: 1px solid rgba(239,68,68,0.15); background: rgba(239,68,68,0.02); border-radius: 8px; padding: 10px; display: flex; flex-direction: column; gap: 8px;";
        div.innerHTML = `
          <div style="display: flex; gap: 10px; align-items: center;">
            <select id="g-statNeg" class="wf-input riven-stat-select negative"
              style="flex: 1; padding: 6px; border-color: rgba(239,68,68,0.3);"
              onchange="updateSelectExclusions(); calculateModalGrade();">
              <option value="">- Negativa</option>
            </select>
            <div
              style="width: 100px; display: flex; align-items: center; gap: 4px; background: rgba(0,0,0,0.25); border: 1px solid rgba(239,68,68,0.3); border-radius: 4px; padding: 2px 6px;">
              <input type="number" id="g-valNeg" class="wf-input riven-val-input" placeholder="0"
                style="border: none; background: transparent; width: 100%; text-align: right; font-weight: bold; color: #ef4444; padding: 2px 0;"
                oninput="syncRivenInputs('g-valNeg', 'g-sliderNeg'); calculateModalGrade();" />
              <span style="color: #ef4444; font-weight: bold; font-size: 0.85rem;">%</span>
            </div>
            <button class="mini-action-btn" onclick="removeGradingRow('row-statNeg')"
              style="border-color: #ef4444; color: #ef4444; padding: 4px 8px; font-size: 0.75rem;">
              ✕
            </button>
          </div>
          <div id="g-slider-containerNeg" class="slider-input-container hidden"
            style="display: flex; align-items: center; gap: 8px; margin-top: 4px;">
            <span id="g-slider-minNeg"
              style="font-size: 0.72rem; color: #ef4444; font-weight: bold; min-width: 32px;">0%</span>
            <input type="range" id="g-sliderNeg" class="riven-slider" min="-200" max="0" step="0.1" value="0"
              style="flex: 1;" oninput="syncRivenInputs('g-sliderNeg', 'g-valNeg'); calculateModalGrade();" />
            <span id="g-slider-maxNeg"
              style="font-size: 0.72rem; color: #ef4444; font-weight: bold; min-width: 32px; text-align: right;">0%</span>
          </div>
        `;
        if (addButtonsDiv) {
          container.insertBefore(div, addButtonsDiv);
        } else {
          container.appendChild(div);
        }
      }
    }
    row = document.getElementById(id);

    // Populate options for the new select element
    const weaponName = document.getElementById("rivenWeaponInput")?.value.trim();
    const weaponData = state.weaponMap?.[weaponName];
    populateRivenSelects(weaponData ? weaponData.t : "Rifle");
  }

  if (row) {
    row.classList.remove("hidden");
  }

  document.getElementById(
    id === "row-stat3" ? "btn-add-pos" : "btn-add-neg",
  ).style.display = "none";
}
export function removeGradingRow(id) {
  const row = document.getElementById(id);
  if (row) {
    row.remove(); // Completely destroy the DOM node!
  }
  document.getElementById(
    id === "row-stat3" ? "btn-add-pos" : "btn-add-neg",
  ).style.display = "block";
  calculateModalGrade();
}

function renderMetaStats(weaponName, weaponType, targetId = "meta-stats-container") {
  const container = document.getElementById(targetId);
  if (!container) return;

  const meta = getMetaStats(weaponName, weaponType);
  console.log(`[renderMetaStats] render for ${weaponName}:`, meta);
  if (!meta) {
    container.style.display = "none";
    return;
  }

  const isEs = state.currentLang === "es";

  // Build beautiful positive and negative guides (best & worst)
  const bestPosHtml = meta.pos.map(s => `
    <span style="background: rgba(0, 255, 120, 0.08); border: 1px solid rgba(0, 255, 120, 0.18); color: #00ff78; padding: 2px 6px; border-radius: 4px; font-size: 11px; margin-right: 4px; display: inline-block; margin-bottom: 4px; font-weight: 500;">
      + ${getLocalizedStatName(s)}
    </span>
  `).join("");

  const worstPos = meta.rawPos?.worst || [];
  const worstPosHtml = worstPos.length > 0 ? worstPos.map(s => `
    <span style="background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.18); color: #ef4444; padding: 2px 6px; border-radius: 4px; font-size: 11px; margin-right: 4px; display: inline-block; margin-bottom: 4px; font-weight: 500;">
      + ${getLocalizedStatName(s)}
    </span>
  `).join("") : "";

  const bestNegHtml = meta.neg.map(s => `
    <span style="background: rgba(0, 229, 255, 0.08); border: 1px solid rgba(0, 229, 255, 0.18); color: #00e5ff; padding: 2px 6px; border-radius: 4px; font-size: 11px; margin-right: 4px; display: inline-block; margin-bottom: 4px; font-weight: 500;">
      - ${getLocalizedStatName(s)}
    </span>
  `).join("");

  const worstNeg = meta.rawNeg?.worst || [];
  const worstNegHtml = worstNeg.length > 0 ? worstNeg.map(s => `
    <span style="background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.18); color: #ef4444; padding: 2px 6px; border-radius: 4px; font-size: 11px; margin-right: 4px; display: inline-block; margin-bottom: 4px; font-weight: 500;">
      - ${getLocalizedStatName(s)}
    </span>
  `).join("") : "";

  let extraHtml = "";
  const hasOfficial = (meta.official_median !== undefined && meta.official_median !== null && meta.official_median > 0) ||
    (meta.official_avg_price !== undefined && meta.official_avg_price !== null && meta.official_avg_price > 0);

  if (hasOfficial || meta.wfm_avg_price || meta.popularity_pct) {
    const basePrice = meta.official_median !== undefined && meta.official_median !== null && meta.official_median > 0
      ? meta.official_median
      : (meta.official_avg_price || 0);

    const officialPrice = hasOfficial ? `${basePrice}p` : "N/A";
    const wfmPrice = meta.wfm_avg_price ? `${meta.wfm_avg_price}p` : "N/A";
    const pop = (meta.popularity_pct !== undefined && meta.popularity_pct !== null)
      ? `${Math.round(meta.popularity_pct)}/100`
      : "0/100";
    const sample = meta.wfm_market_sample ? `${meta.wfm_market_sample} trades` : "N/A";

    const stddevVal = meta.official_stddev || 0;
    let riskHtml = "";
    if (hasOfficial) {
      const ratio = basePrice > 0 ? stddevVal / basePrice : 0;
      let riskLabel = "";
      let riskColor = "";
      let riskTooltip = "";

      if (!stddevVal) {
        riskLabel = isEs ? "ESTABLE" : "STABLE";
        riskColor = "#00ff78";
        riskTooltip = isEs
          ? "El precio de este Riven es predecible y seguro. Casi todo el mundo lo compra y vende por la misma cantidad de platino."
          : "The price of this Riven is predictable and safe. Almost everyone buys and sells it for the same amount of platinum.";
      } else if (ratio < 0.5) {
        riskLabel = isEs ? "ESTABLE" : "STABLE";
        riskColor = "#00ff78";
        riskTooltip = isEs
          ? "El precio de este Riven es predecible y seguro. Casi todo el mundo lo compra y vende por la misma cantidad de platino."
          : "The price of this Riven is predictable and safe. Almost everyone buys and sells it for the same amount of platinum.";
      } else if (ratio <= 1.2) {
        riskLabel = isEs ? "MODERADO" : "MODERATE";
        riskColor = "#ffb300";
        riskTooltip = isEs
          ? "El precio fluctúa bastante. Dependiendo de las estadísticas o del comprador, puedes ganar o perder mucho margen de platino."
          : "The price fluctuates quite a bit. Depending on the stats or the buyer, you can gain or lose a lot of platinum margin.";
      } else {
        riskLabel = isEs ? "EXTREMO" : "EXTREME";
        riskColor = "#ff4444";
        riskTooltip = isEs
          ? "No hay un precio fijo. Algunos jugadores pagan auténticas fortunas por él, mientras que otros lo malvenden. Entra bajo tu propio riesgo."
          : " There is no fixed price. Some players pay absolute fortunes for it, while others quick-sell it. Enter at your own risk.";
      }
      riskHtml = ` | ${isEs ? "RIESGO" : "RISK"}: <b style="color:${riskColor}; text-shadow: 0 0 5px ${riskColor}33; cursor: help;" data-tooltip="${riskTooltip}">${riskLabel} (σ:${stddevVal}p) <span class="info-icon" style="font-size:0.65rem;">ℹ</span></b>`;
    }

    const trendTooltip = getRivenTooltip("trend", isEs);

    const baseTooltip = !hasOfficial
      ? (isEs
        ? "No hay transacciones registradas oficialmente por Digital Extremes para este arma esta semana debido a su bajo volumen de comercio en el juego."
        : "No official transactions recorded by Digital Extremes for this weapon this week due to low in-game trading volume.")
      : getRivenTooltip("unrolled", isEs);

    const premiumTooltip = getRivenTooltip("wfm", isEs);

    extraHtml = `
      <div style="margin-top:8px; padding-top:8px; border-top:1px dashed rgba(255,255,255,0.1); font-size:11px; color:#aaa; display:flex; gap:12px; justify-content:space-between; flex-wrap:wrap;">
        <span data-tooltip="${trendTooltip}" style="cursor: help;">TREND: <b style="color:var(--wf-gold-text)">${pop}</b> <span class="info-icon" style="font-size:0.65rem;">ℹ</span></span>
        <span data-tooltip="${baseTooltip}" style="cursor: help;">${isEs ? "Mediana" : "Median"}: <b style="color:var(--wf-gold-text)">${officialPrice}</b> <span class="info-icon" style="font-size:0.65rem;">ℹ</span>${riskHtml}</span>
        <span data-tooltip="${premiumTooltip}" style="cursor: help;">WFM Avg: <b style="color:var(--wf-gold-text)">${wfmPrice} (${sample})</b> <span class="info-icon" style="font-size:0.65rem;">ℹ</span></span>
      </div>
    `;

    let tierEstimatesHtml = "";
    if (basePrice > 0 || meta.wfm_avg_price > 0) {
      const tiers = calculateHybridTiers(meta);

      tierEstimatesHtml = `
        <div style="margin-top:12px; padding-top:10px; border-top:1px dashed rgba(255,255,255,0.15);">
          <div style="font-size:10px; color:#888; margin-bottom:6px; text-transform:uppercase; font-weight:800; letter-spacing:0.05em;">${isEs ? "VALOR ESTIMADO POR CALIDAD" : "ESTIMATED VALUE BY QUALITY TIER"}</div>
          <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:6px;">
            <div style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.06); border-radius:4px; padding:6px; text-align:center;">
              <div style="font-size:9px; color:#8e8e93; text-transform:uppercase; font-weight:bold;">${isEs ? "BASURA / BASE" : "TRASH / BASE"}</div>
              <div style="display:inline-flex; align-items:center; gap:3px; justify-content:center; font-size:14px; color:#f2f2f7; font-weight:bold; margin-top:2px; width:100%;">
                <span>${tiers.trash}</span><img src="assets/relic_contents/platinum.webp" style="width:14px; height:14px; object-fit:contain; vertical-align:middle;">
              </div>
            </div>
            <div style="background:rgba(0,229,255,0.03); border:1px solid rgba(0,229,255,0.12); border-radius:4px; padding:6px; text-align:center;">
              <div style="font-size:9px; color:#00e5ff; text-transform:uppercase; font-weight:bold;">${isEs ? "BUEN REROLL" : "GOOD REROLL"}</div>
              <div style="display:inline-flex; align-items:center; gap:3px; justify-content:center; font-size:14px; color:#00e5ff; font-weight:bold; margin-top:2px; width:100%;">
                <span>${tiers.goodReroll}</span><img src="assets/relic_contents/platinum.webp" style="width:14px; height:14px; object-fit:contain; vertical-align:middle;">
              </div>
            </div>
            <div style="background:rgba(255,215,0,0.03); border:1px solid rgba(255,215,0,0.15); border-radius:4px; padding:6px; text-align:center; box-shadow:inset 0 0 10px rgba(255,215,0,0.02);">
              <div style="font-size:9px; color:#ffd700; text-transform:uppercase; font-weight:bold;">GODROLL</div>
              <div style="display:inline-flex; align-items:center; gap:3px; justify-content:center; font-size:14px; color:#ffd700; font-weight:bold; margin-top:2px; text-shadow:0 0 4px rgba(255,215,0,0.2); width:100%;">
                <span>${tiers.godroll}</span><img src="assets/relic_contents/platinum.webp" style="width:14px; height:14px; object-fit:contain; vertical-align:middle;">
              </div>
            </div>
          </div>
        </div>
      `;
    }

    container.innerHTML = `
      <div style="background: rgba(255,255,255,0.015); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 12px; box-shadow: inset 0 0 15px rgba(0,0,0,0.2);">
          <div style="font-size: 10px; color: #94a3b8; margin-bottom: 10px; text-transform: uppercase; font-weight: 800; letter-spacing: 0.05em; border-bottom: 1px dashed rgba(255,255,255,0.08); padding-bottom: 6px;">
            ${isEs ? "Guía de Atributos del Arma" : "Weapon Attributes Guide"}
          </div>
          
          <!-- Positives Section -->
          <div style="margin-bottom: 10px;">
            <div style="font-size: 9px; color: #00ff78; font-weight: 700; text-transform: uppercase; margin-bottom: 4px; display: flex; align-items: center; gap: 4px;">
              <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #00ff78;"></span>
              ${isEs ? "MEJORES POSITIVOS (BUSCADOS)" : "BEST POSITIVES (WANTED)"}
            </div>
            <div>${bestPosHtml}</div>
            
            ${worstPosHtml ? `
              <div style="font-size: 9px; color: #ef4444; font-weight: 700; text-transform: uppercase; margin-top: 6px; margin-bottom: 4px; display: flex; align-items: center; gap: 4px;">
                <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #ef4444;"></span>
                ${isEs ? "PEORES POSITIVOS (EVITAR)" : "WORST POSITIVES (AVOID)"}
              </div>
              <div>${worstPosHtml}</div>
            ` : ""}
          </div>
          
          <!-- Negatives Section -->
          <div style="margin-bottom: 10px;">
            <div style="font-size: 9px; color: #00e5ff; font-weight: 700; text-transform: uppercase; margin-bottom: 4px; display: flex; align-items: center; gap: 4px;">
              <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #00e5ff;"></span>
              ${isEs ? "MEJORES NEGATIVOS (INOFENSIVOS)" : "BEST NEGATIVES (HARMLESS)"}
            </div>
            <div>${bestNegHtml}</div>
            
            ${worstNegHtml ? `
              <div style="font-size: 9px; color: #ef4444; font-weight: 700; text-transform: uppercase; margin-top: 6px; margin-bottom: 4px; display: flex; align-items: center; gap: 4px;">
                <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #ef4444;"></span>
                ${isEs ? "PEORES NEGATIVOS (¡EVITAR - PENALIZAN PRECIO!)" : "WORST NEGATIVES (AVOID - RUINS VALUE!)"}
              </div>
              <div>${worstNegHtml}</div>
            ` : ""}
          </div>
          
          ${extraHtml}
          ${tierEstimatesHtml}
      </div>
    `;
  }
  container.style.display = "block";
}

export function refreshCurrentRivenMetaStats() {
  let name = document.getElementById("rivenWeaponInput")?.value.trim();
  if (name && state.weaponMap) {
    const matchedKey = Object.keys(state.weaponMap).find(k => k.toLowerCase() === name.toLowerCase());
    if (matchedKey) {
      name = matchedKey;
      const data = state.weaponMap[name];
      renderMetaStats(name, data.t);
      renderMetaStats(name, data.t, "modal-meta-stats-container");
    }
  }
}

// Riven Market Index (Tendencias Globales) Variables
let isIndexLoading = false;
const expandedWeapons = new Set();

const LOCALIZED_STAT_NAMES_MAP = {
  "Critical Damage": "Daño Crítico",
  "Critical Chance": "Prob. Crítica",
  "Multishot": "Multidisparo",
  "Damage": "Daño",
  "Base Damage / Melee Damage": "Daño Base",
  "Zoom": "Zoom",
  "Impact Damage": "Daño de Impacto",
  "Puncture Damage": "Daño de Perforación",
  "Slash Damage": "Daño de Cortante",
  "Fire Rate / Attack Speed": "Cadencia / Vel. Ataque",
  "Reload Speed": "Vel. Recarga",
  "Ammo Maximum": "Munición Máxima",
  "Status Duration": "Duración de Estado",
  "Status Chance": "Prob. Estado",
  "Punch Through": "Atravesar",
  "Range": "Alcance",
  "Recoil": "Retroceso",
  "Weapon Recoil": "Retroceso",
  "Magazine Capacity": "Capacidad de Cargador",
  "Toxin Damage": "Daño de Toxina",
  "Heat Damage": "Daño de Calor",
  "Electric Damage": "Daño de Electricidad",
  "Cold Damage": "Daño de Frío",
  "Damage Vs Corpus": "Daño vs Corpus",
  "Damage Vs Grineer": "Daño vs Grineer",
  "Damage Vs Infested": "Daño vs Infestados",
  "Critical Chance On Slide Attack": "CC en Deslizamiento",
  "Finisher Damage": "Daño de Remate",
  "Combo Duration": "Duración de Combo",
  "Initial Combo": "Combo Inicial",
  "Heavy Attack Efficiency": "Eficiencia de Ataque Pesado",
  "Heavy Attack Damage": "Daño de Ataque Pesado",
  "Channeling Damage": "Combo Inicial",
  "Channeling Efficiency": "Eficiencia de Ataque Pesado"
};

export function calculateRealPotential(val) {
  if (!val) return 0;
  const popularity = val.popularity_pct || 0;
  const realVolume = (val.de_unrolled?.pop || 0) + (val.de_rerolled?.pop || 0);
  const isUnpopular = popularity < 8.0 || realVolume < 3;

  let unrolledMedian = (val.de_unrolled && val.de_unrolled.median !== undefined && val.de_unrolled.median !== null && val.de_unrolled.median > 0)
    ? val.de_unrolled.median
    : (val.official_median || val.official_avg_price || 30);

  let rerollMedian = (val.de_rerolled && val.de_rerolled.median !== undefined && val.de_rerolled.median > 0)
    ? val.de_rerolled.median
    : (val.official_median || unrolledMedian);

  let maxRerolledPrice = (val.de_rerolled && val.de_rerolled.max_price !== undefined) ? val.de_rerolled.max_price : 0;
  let maxUnrolledPrice = (val.de_unrolled && val.de_unrolled.max_price !== undefined) ? val.de_unrolled.max_price : 0;
  let maxCeiling = Math.max(maxRerolledPrice, maxUnrolledPrice);

  // Outlier / Abnormally high price handling for unpopular/off-meta weapons
  if (isUnpopular) {
    if (unrolledMedian > 150) {
      unrolledMedian = 150 + (unrolledMedian - 150) * 0.15;
    }
    if (rerollMedian > 300) {
      rerollMedian = 300 + (rerollMedian - 300) * 0.15;
    }
    if (maxCeiling > 1500) {
      maxCeiling = 1500 + (maxCeiling - 1500) * 0.10;
    }
  }

  if (unrolledMedian <= 0) return 0;

  const realMarkup = Math.max(1.0, rerollMedian / unrolledMedian);
  const unrolledStd = (val.de_unrolled && val.de_unrolled.stddev !== undefined) ? val.de_unrolled.stddev : (val.official_stddev || 0);
  const rerollStd = (val.de_rerolled && val.de_rerolled.stddev !== undefined) ? val.de_rerolled.stddev : (val.official_stddev || 0);

  const unrolledCV = unrolledStd / unrolledMedian;
  const rerollCV = rerollStd / rerollMedian;
  const volatilityFactor = 1.0 + Math.max(unrolledCV, rerollCV);

  const godrollFactor = maxCeiling > 0 ? Math.min(1.0 + (maxCeiling / 800), 5.0) : 1.0;
  const popFactor = 1.0 + (popularity / 20);

  const potential = realMarkup * Math.sqrt(volatilityFactor) * Math.sqrt(godrollFactor) * Math.sqrt(popFactor);
  return Number(potential.toFixed(2));
}

export function calculateWebPotential(val) {
  if (!val) return 0;
  const popularity = val.popularity_pct || 0;
  const realVolume = (val.de_unrolled?.pop || 0) + (val.de_rerolled?.pop || 0);
  const isUnpopular = popularity < 8.0 || realVolume < 3;

  let unrolledMedian = (val.de_unrolled && val.de_unrolled.median !== undefined && val.de_unrolled.median !== null && val.de_unrolled.median > 0)
    ? val.de_unrolled.median
    : (val.official_median || val.official_avg_price || 30);

  let wfmAvg = val.wfm_avg_price || 0;

  // Outlier / Abnormally high price handling for unpopular/off-meta weapons
  if (isUnpopular) {
    if (unrolledMedian > 150) {
      unrolledMedian = 150 + (unrolledMedian - 150) * 0.15;
    }
    if (wfmAvg > 400) {
      wfmAvg = 400 + (wfmAvg - 400) * 0.20;
    }
  }

  if (unrolledMedian <= 0) return 0;

  const wfmMarkup = wfmAvg > 0 ? Math.max(1.0, wfmAvg / unrolledMedian) : 1.0;
  const wfmSample = val.wfm_market_sample || 0;
  const sampleFactor = 1.0 + Math.min(wfmSample / 15, 2.0);
  const popFactor = 1.0 + (popularity / 20);

  const potential = wfmMarkup * Math.sqrt(sampleFactor) * Math.sqrt(popFactor);
  return Number(potential.toFixed(2));
}

export function calculateRivenPotential(val) {
  return calculateRealPotential(val);
}

const calculateAdvancedPredictivePrice = (weapon, itemAttributes, tiers, desirabilityMultiplier = 1.0, weaponData = null) => {
  const bestPositives = Array.isArray(weapon.pos) ? weapon.pos : (weapon.pos?.best || []);

  let positiveCount = 0;
  let totalMetaScore = 0;
  let totalRollQuality = 0;

  // Detect elements among active positive attributes
  const positiveStats = itemAttributes.filter(a => a.isPositive);
  let hasToxin = false;
  let hasCold = false;
  let hasElectric = false;
  let hasHeat = false;

  positiveStats.forEach(attr => {
    const nameLower = attr.name.toLowerCase();
    if (nameLower.includes("toxin")) hasToxin = true;
    if (nameLower.includes("cold")) hasCold = true;
    if (nameLower.includes("electric")) hasElectric = true;
    if (nameLower.includes("heat")) hasHeat = true;
  });

  let elementComboBonus = 0;
  let comboName = "";
  if (hasToxin && hasCold) {
    elementComboBonus = 0.25; // Viral!
    comboName = "Viral";
  } else if (hasToxin && hasElectric) {
    elementComboBonus = 0.25; // Corrosive!
    comboName = "Corrosive";
  } else if (hasHeat && hasElectric) {
    elementComboBonus = 0.15; // Radiation
    comboName = "Radiation";
  } else if (hasToxin && hasHeat) {
    elementComboBonus = 0.15; // Gas
    comboName = "Gas";
  } else if (hasCold && hasElectric) {
    elementComboBonus = 0.10; // Magnetic
    comboName = "Magnetic";
  } else if (hasHeat && hasCold) {
    elementComboBonus = 0.10; // Blast
    comboName = "Blast";
  }

  const dispo = weaponData ? (weaponData.disposition || weaponData.d || 1) : 1;
  // If low disposition, the combined elements have exponentially more value because they save invaluable mod space
  if (dispo < 0.8 && elementComboBonus > 0) {
    elementComboBonus *= 1.6; // Amplify elemental synergy by 60% for low-dispo weapons!
  }

  // 1. CLASIFICADOR DE ARQUETIPO DE ARMA
  const isMeleeWeapon = itemAttributes.some(attr => {
    const name = attr.name.toLowerCase();
    return name.includes("melee") || name.includes("range") || name.includes("combo") || name.includes("efficiency");
  });

  // 2. MATRICES DE SALVAGUARDA UNIVERSAL (Evitan falsos negativos en el meta)
  const universalGodStats = isMeleeWeapon
    ? ["melee damage", "critical chance", "critical damage", "range", "attack speed"]
    : ["multishot", "critical chance", "critical damage", "damage"];

  const universalTier2Stats = isMeleeWeapon
    ? ["initial combo", "toxin", "heat", "combo duration"]
    : ["fire rate", "toxin", "heat", "elemental"];

  const positiveWeights = [];
  itemAttributes.forEach(attr => {
    if (attr.isPositive) {
      positiveCount++;
      const nameLower = attr.name.toLowerCase();

      // Cálculo del peso del atributo según su importancia real en el mercado
      let attributeWeight = 0;

      const isDynamicMeta = bestPositives.some(p => p.toLowerCase() === nameLower);
      const isUniversalGod = universalGodStats.some(u => nameLower.includes(u));
      const isUniversalTier2 = universalTier2Stats.some(t => nameLower.includes(t));

      if (isDynamicMeta) {
        attributeWeight = 1.0;
      } else if (isUniversalGod) {
        attributeWeight = 0.90; // Protege estadísticas críticas fuera del top semanal
      } else if (isUniversalTier2) {
        attributeWeight = 0.65; // Otorga valor ponderado a velocidad de disparo y elementos
      }

      // Calidad del número del roll dentro de su rango ideal
      const range = attr.maxIdeal - attr.minIdeal;
      const quality = range > 0 ? (attr.value - attr.minIdeal) / range : 0.5;
      const clampedQuality = Math.max(0, Math.min(1, quality));
      totalRollQuality += clampedQuality;

      // If this stat has exceptional roll quality (e.g. >80% max roll) and is a high-tier stat (like Universal God),
      // we value it slightly more to reward the superior roll over a lower-quality top-ranked stat.
      if (clampedQuality > 0.8 && (isUniversalGod || isDynamicMeta)) {
        attributeWeight += (1.0 - attributeWeight) * 0.25; // Boost weight towards 1.0 based on exceptional quality
      }

      totalMetaScore += attributeWeight;
      positiveWeights.push(attributeWeight);
    }
  });

  // Apply the dynamic element combo bonus to elements if found
  if (elementComboBonus > 0) {
    let elementsFound = 0;
    itemAttributes.forEach((attr, idx) => {
      if (attr.isPositive) {
        const nameLower = attr.name.toLowerCase();
        if (nameLower.includes("toxin") || nameLower.includes("cold") || nameLower.includes("electric") || nameLower.includes("heat")) {
          if (positiveWeights[elementsFound] !== undefined) {
            positiveWeights[elementsFound] += elementComboBonus / 2;
          }
          elementsFound++;
        }
      }
    });
  }

  const avgRollQuality = positiveCount > 0 ? totalRollQuality / positiveCount : 0.5;

  // Evaluate combination meta ratio based on core stats to prevent dilution by 3rd positive
  const sortedWeights = positiveWeights.sort((a, b) => b - a);
  let finalMetaRatio = 0;
  if (positiveCount === 1) {
    finalMetaRatio = sortedWeights[0];
  } else if (positiveCount === 2) {
    finalMetaRatio = (sortedWeights[0] + sortedWeights[1]) / 2;
  } else if (positiveCount >= 3) {
    const coreRatio = (sortedWeights[0] + sortedWeights[1]) / 2;
    // Core combination strength is preserved; 3rd positive cannot drag the tier down
    finalMetaRatio = Math.max(coreRatio, (sortedWeights[0] + sortedWeights[1] + sortedWeights[2]) / 3);
  }

  // 3. CURVA AJUSTADA DE VALORACIÓN COMERCIAL (La presencia del stat dicta el tier de precio, la calidad sólo ajusta un ±20%)
  let finalPrice = 0;

  if (finalMetaRatio >= 0.80) {
    // Combinación Godroll (Estadísticas meta presentes; la calidad tiene un peso menor e incremental del 20%)
    finalPrice = tiers.godroll * (0.8 + avgRollQuality * 0.2);
  } else if (finalMetaRatio >= 0.50) {
    // Combinación de Utilidad Alta / Reroll Competitivo
    finalPrice = tiers.goodReroll * (0.8 + avgRollQuality * 0.2);
  } else {
    // Combinación sin sinergia comercial (Trash tier)
    finalPrice = tiers.trash * (0.9 + avgRollQuality * 0.1);
  }

  // 4. PENALIZADOR DINÁMICO DE NEGATIVAS CRÍTICAS (-dmg, status duration, cc, cd, etc. penalizan fuertemente)
  const universalCriticalNegs = [
    "critical chance", "critical damage", "damage", "multishot",
    "fire rate", "attack speed", "melee damage", "range", "status duration"
  ];

  // Negativas mitigables (moderadas) que penalizan levemente en lugar de destruir el precio
  const mitigableNegs = [
    "ammo maximum", "magazine capacity", "reload speed", "impact", "puncture", "status chance", "projectile speed", "recoil"
  ];

  const bestNegatives = Array.isArray(weapon.neg) ? weapon.neg : (weapon.neg?.best || []);

  itemAttributes.forEach(attr => {
    if (!attr.isPositive) {
      const negName = attr.name.toLowerCase();
      const isUniversalBad = universalCriticalNegs.some(n => negName.includes(n));
      const isGoodNegative = bestNegatives.some(b => b.toLowerCase().includes(negName) || negName.includes(b.toLowerCase()));
      const isMitigable = mitigableNegs.some(m => negName.includes(m));

      if (isUniversalBad && !isGoodNegative) {
        // Negativa nefasta (como -daño, -duración estado, -cc o -cd) destruye el valor comercial
        finalPrice *= (finalMetaRatio >= 0.80) ? 0.25 : 0.10;
      } else if (isGoodNegative) {
        // Negativa inofensiva o buscada (ej: zoom en Cyngas) otorga un multiplicador positivo
        finalPrice *= 1.20;
      } else if (isMitigable) {
        // Negativa mitigable / moderada (ej: -ammo max, -reload, +retroceso) penaliza levemente (15%)
        finalPrice *= 0.85;
      } else {
        // Negativa neutra/inofensiva genérica
        finalPrice *= 1.10;
      }
    }
  });

  // Apply desirability multiplier directly to scale estimated price and grade based on trash positives/negatives
  const penalizedPrice = Math.round(finalPrice * desirabilityMultiplier);
  const rawScore = Math.round(((finalMetaRatio * 0.7) + (avgRollQuality * 0.3)) * 100);
  const adjustedScore = Math.max(10, Math.min(100, Math.round(rawScore * desirabilityMultiplier)));

  return {
    estimatedValue: penalizedPrice,
    suggestedMin: Math.round(penalizedPrice * 0.85),
    suggestedMax: Math.round(penalizedPrice * 1.15),
    adjustedScore: adjustedScore,
    comboName: comboName,
    elementComboBonus: elementComboBonus
  };
};

function calculateHybridTiers(weapon) {
  const popularity = weapon.popularity_pct || 0;
  const realVolume = (weapon.de_unrolled?.pop || 0) + (weapon.de_rerolled?.pop || 0);
  const isUnpopular = popularity < 8.0 || realVolume < 3;

  let wfmAvg = weapon.wfm_avg_price || 0;
  let offMedian = weapon.official_median || 0; // Base unrolled median
  let offStdDev = weapon.official_stddev || 0;
  let reMedian = (weapon.de_rerolled && weapon.de_rerolled.median !== undefined) ? weapon.de_rerolled.median : 0;

  // Dampen outliers if unpopular/low pop weapon
  if (isUnpopular) {
    if (offMedian > 150) {
      offMedian = 150 + (offMedian - 150) * 0.15;
    }
    if (reMedian > 300) {
      reMedian = 300 + (reMedian - 300) * 0.15;
    }
    if (wfmAvg > 400) {
      wfmAvg = 400 + (wfmAvg - 400) * 0.20;
    }
    if (offStdDev > 200) {
      offStdDev = 200 + (offStdDev - 200) * 0.10;
    }
  }

  // 1. Trash/Base tier: siempre respeta el official_median (transacciones reales) como suelo
  const trash = offMedian > 0 ? offMedian : Math.round(wfmAvg * 0.15);

  // 2. Good Reroll tier: basado en el DE rerolled median real para evitar la inflación artificial de ofertas inactivas/exageradas de WFM
  let goodReroll = 0;
  if (reMedian > 0) {
    goodReroll = Math.round(reMedian * 1.6 + Math.min(wfmAvg * 0.15, reMedian * 2));
  } else {
    goodReroll = wfmAvg > 0
      ? Math.round(wfmAvg * 0.3)
      : Math.round(trash * 2.5);
  }

  // 3. Godroll tier: ajusta de forma realista en base a desviación típica real para evitar multiplicadores desbocados en armas con precios base bajos
  let godroll = 0;
  if (offMedian > 0) {
    const stdDevScale = offStdDev > 0 ? (offStdDev / offMedian) : 1.0;
    const baseRef = reMedian > 0 ? reMedian : offMedian;
    godroll = Math.round(baseRef * (3.0 + Math.min(stdDevScale * 5.0, 15.0)));

    // Suavizamos con el promedio de WFM limitando su impacto máximo
    if (wfmAvg > 0) {
      godroll = Math.round(godroll * 0.6 + Math.min(wfmAvg * 0.8, baseRef * 20) * 0.4);
    }
  } else {
    godroll = wfmAvg > 0
      ? Math.round(wfmAvg * 1.2)
      : Math.round(trash * 6);
  }

  // Garantías de límites coherentes entre tiers
  if (goodReroll <= trash) {
    goodReroll = Math.round(trash * 1.8);
  }
  if (godroll <= goodReroll) {
    godroll = Math.round(godroll * 3.0);
  }

  return { trash, goodReroll, godroll };
}

function getLocalizedStatName(nameEn) {
  if (!nameEn) return "";
  let normName = nameEn;
  if (normName === "Channeling Damage") {
    normName = "Initial Combo";
  } else if (normName === "Channeling Efficiency") {
    normName = "Heavy Attack Efficiency";
  } else if (normName === "Charge Damage") {
    normName = "Heavy Attack Damage";
  }
  if (state.currentLang !== "es") return normName;
  return LOCALIZED_STAT_NAMES_MAP[normName] || normName;
}

export function updateSortHelpTooltip() {
  const isEs = state.currentLang === "es";
  const sortBy = document.getElementById("indexSortSelect")?.value || "popularity";
  const helpIcon = document.getElementById("indexSortHelpIcon");
  if (!helpIcon) return;

  const tooltips = {
    popularity: {
      es: "Popularidad: Ordena según el volumen real de intercambio y demanda en el Meta actual (0-100).",
      en: "Popularity: Sort by real trading volume and meta demand in the current Meta (0-100)."
    },
    "price-official": {
      es: "Mediana del Juego: Ordena por el precio mediano real de transacciones oficiales completadas (Unrolled).",
      en: "Game Median: Sort by official completed real trade median price (Unrolled)."
    },
    "price-wfm": {
      es: "Precio Premium: Ordena por el precio promedio de ofertas de escaparate publicadas en Warframe.Market.",
      en: "Premium Price: Sort by average active storefront listing price on Warframe.Market."
    },
    "potential-real": {
      es: "Potencial Real (DE): Ordena por el potencial basado exclusivamente en transacciones reales en el juego (ciclos, techo godroll, volatilidad).",
      en: "Real Potential (DE): Sort by potential index based purely on real in-game completed trade transactions (cycles, godroll ceiling, volatility)."
    },
    "potential-web": {
      es: "Potencial Web (WFM): Ordena por el potencial especulativo basado en ofertas activas en Warframe.Market y la liquidez online.",
      en: "Web Potential (WFM): Sort by speculative potential index based on active Warframe.Market storefront listings markup and online liquidity."
    },
    arbitrage: {
      es: "Oportunidad de Arbitraje: Ordena por el margen neto de beneficio estimado en Platino (Precio Web WFM menos Mediana Real del Juego).",
      en: "Arbitrage Opportunity: Sort by estimated net Platinum profit margin (Web WFM Price minus Real In-Game Median)."
    },
    kuva: {
      es: "Inversión de Kuva: Ordena según el mejor retorno de inversión al ciclar. Combina alta popularidad en el Meta (demanda líquida) con elevado potencial de multiplicador.",
      en: "Kuva Investment: Sort by the best return on investment when cycling. Combines high Meta popularity (liquid demand) with high price multiplier potential."
    }
  };

  const tip = tooltips[sortBy] ? (isEs ? tooltips[sortBy].es : tooltips[sortBy].en) : "";
  helpIcon.setAttribute("data-tooltip", tip);
}

export function updateIndexTranslations() {
  const isEs = state.currentLang === "es";

  const title = document.getElementById("lbl-index-title");
  if (title) title.innerText = isEs ? "TENDENCIAS GLOBALES DE RIVEN" : "RIVEN MARKET INDEX";

  const searchInput = document.getElementById("indexSearchInput");
  if (searchInput) searchInput.placeholder = isEs ? "Buscar arma..." : "Search weapon...";

  const optPop = document.getElementById("opt-sort-pop");
  if (optPop) optPop.innerText = isEs ? "Popularidad" : "Popularity";
  const optCustomPop = document.getElementById("opt-custom-pop");
  if (optCustomPop) optCustomPop.innerText = isEs ? "Popularidad" : "Popularity";

  const optOfficial = document.getElementById("opt-sort-official");
  if (optOfficial) optOfficial.innerText = isEs ? "Mediana del Juego" : "Game Median";
  const optCustomOfficial = document.getElementById("opt-custom-official");
  if (optCustomOfficial) optCustomOfficial.innerText = isEs ? "Mediana del Juego" : "Game Median";

  const optWfm = document.getElementById("opt-sort-wfm");
  if (optWfm) optWfm.innerText = isEs ? "Precio Premium" : "Premium Price";
  const optCustomWfm = document.getElementById("opt-custom-wfm");
  if (optCustomWfm) optCustomWfm.innerText = isEs ? "Precio Premium" : "Premium Price";

  const optPotentialReal = document.getElementById("opt-sort-potential-real");
  if (optPotentialReal) optPotentialReal.innerText = isEs ? "Potencial Real (DE)" : "Real Potential (DE)";
  const optCustomPotentialReal = document.getElementById("opt-custom-potential-real");
  if (optCustomPotentialReal) optCustomPotentialReal.innerText = isEs ? "Potencial Real (DE)" : "Real Potential (DE)";

  const optPotentialWeb = document.getElementById("opt-sort-potential-web");
  if (optPotentialWeb) optPotentialWeb.innerText = isEs ? "Potencial Web (WFM)" : "Web Potential (WFM)";
  const optCustomPotentialWeb = document.getElementById("opt-custom-potential-web");
  if (optCustomPotentialWeb) optCustomPotentialWeb.innerText = isEs ? "Potencial Web (WFM)" : "Web Potential (WFM)";

  const optArbitrage = document.getElementById("opt-sort-arbitrage");
  if (optArbitrage) optArbitrage.innerText = isEs ? "Oportunidad de Arbitraje" : "Arbitrage Opportunity";
  const optCustomArbitrage = document.getElementById("opt-custom-arbitrage");
  if (optCustomArbitrage) optCustomArbitrage.innerText = isEs ? "Oportunidad de Arbitraje" : "Arbitrage Opportunity";

  const optKuva = document.getElementById("opt-sort-kuva");
  if (optKuva) optKuva.innerText = isEs ? "Inversión de Kuva" : "Kuva Investment";
  const optCustomKuva = document.getElementById("opt-custom-kuva");
  if (optCustomKuva) optCustomKuva.innerText = isEs ? "Inversión de Kuva" : "Kuva Investment";

  const triggerText = document.getElementById("indexSortTriggerText");
  if (triggerText) {
    const val = document.getElementById("indexSortSelect")?.value || "popularity";
    if (val === "popularity") triggerText.innerText = isEs ? "Popularidad" : "Popularity";
    else if (val === "price-official") triggerText.innerText = isEs ? "Mediana del Juego" : "Game Median";
    else if (val === "price-wfm") triggerText.innerText = isEs ? "Precio Premium" : "Premium Price";
    else if (val === "potential" || val === "potential-real") triggerText.innerText = isEs ? "Potencial Real (DE)" : "Real Potential (DE)";
    else if (val === "potential-web") triggerText.innerText = isEs ? "Potencial Web (WFM)" : "Web Potential (WFM)";
    else if (val === "arbitrage") triggerText.innerText = isEs ? "Oportunidad de Arbitraje" : "Arbitrage Opportunity";
    else if (val === "kuva") triggerText.innerText = isEs ? "Inversión de Kuva" : "Kuva Investment";
  }

  const loadingText = document.getElementById("lbl-index-loading");
  if (loadingText) loadingText.innerText = isEs ? "Cargando tendencias del mercado..." : "Loading market trends...";

  // Dynamic help tooltip update
  updateSortHelpTooltip();
}

let indexRenderLimit = 30;
let searchDebounceTimeout = null;
let currentIndexItems = [];

globalThis.loadMoreRivenIndex = function () {
  indexRenderLimit += 30;
  filterRivenIndex(false);
};

export async function initRivenMarketIndex() {
  updateIndexTranslations();

  // If no weapon is currently entered/selected, render the empty showcase carousel!
  const currentWeapon = document.getElementById("rivenWeaponInput")?.value?.trim();
  if (!currentWeapon) {
    renderRivenPreview(null);
  }

  // Wire search and sort inputs unconditionally every time init is called
  const searchInput = document.getElementById("indexSearchInput");
  const sortSelect = document.getElementById("indexSortSelect");
  const btnSortDir = document.getElementById("btn-index-sort-dir");

  if (searchInput && !searchInput._wired) {
    searchInput.addEventListener("input", () => {
      clearTimeout(searchDebounceTimeout);
      searchDebounceTimeout = setTimeout(() => filterRivenIndex(true), 150);
    });
    searchInput._wired = true;
  }

  // Custom UI sort selector trigger & options wiring
  const sortTrigger = document.getElementById("indexSortTrigger");
  const sortOptions = document.getElementById("indexSortOptions");
  const sortArrow = document.getElementById("indexSortTriggerArrow");

  if (sortTrigger && sortOptions && !sortTrigger._wired) {
    sortTrigger.addEventListener("click", (e) => {
      e.stopPropagation();
      const isHidden = sortOptions.classList.contains("hidden");

      // Close other open custom dropdowns (like weapon autocomplete)
      document.querySelectorAll(".custom-dropdown").forEach(d => {
        if (d !== sortOptions) d.classList.add("hidden");
      });

      if (isHidden) {
        sortOptions.classList.remove("hidden");
        if (sortArrow) sortArrow.style.transform = "translateY(-50%) rotate(180deg)";
      } else {
        sortOptions.classList.add("hidden");
        if (sortArrow) sortArrow.style.transform = "translateY(-50%)";
      }
    });

    const optItems = sortOptions.querySelectorAll(".dropdown-item");
    optItems.forEach(item => {
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        const val = item.getAttribute("data-value");
        const select = document.getElementById("indexSortSelect");
        if (select) {
          select.value = val;
          select.dispatchEvent(new Event("change"));
        }

        // Update trigger text
        const triggerText = document.getElementById("indexSortTriggerText");
        if (triggerText) triggerText.innerText = item.innerText;

        // Update active class
        optItems.forEach(opt => opt.classList.remove("active-sort-item"));
        item.classList.add("active-sort-item");

        // Close dropdown
        sortOptions.classList.add("hidden");
        if (sortArrow) sortArrow.style.transform = "translateY(-50%)";
      });
    });

    // Close on clicking outside
    document.addEventListener("click", () => {
      sortOptions.classList.add("hidden");
      if (sortArrow) sortArrow.style.transform = "translateY(-50%)";
    });

    sortTrigger._wired = true;
  }

  if (sortSelect && !sortSelect._wired) {
    sortSelect.addEventListener("change", () => {
      updateSortHelpTooltip();
      filterRivenIndex(true);
    });
    sortSelect._wired = true;
  }
  if (btnSortDir && !btnSortDir._wired) {
    btnSortDir.addEventListener("click", () => {
      const currentDir = btnSortDir.getAttribute("data-dir") || "desc";
      const newDir = currentDir === "desc" ? "asc" : "desc";
      btnSortDir.setAttribute("data-dir", newDir);

      const arrowSvg = document.getElementById("svg-sort-dir-arrow");
      if (arrowSvg) {
        arrowSvg.style.transform = newDir === "asc" ? "rotate(180deg)" : "none";
      }

      filterRivenIndex(true);
    });
    btnSortDir._wired = true;
  }

  if (state.rivenIndexData) {
    filterRivenIndex(true);
    return;
  }

  if (isIndexLoading) return;
  isIndexLoading = true;

  const loadingDiv = document.getElementById("index-loading-state");
  const resultsDiv = document.getElementById("index-results-container");

  if (loadingDiv) loadingDiv.classList.remove("hidden");
  if (resultsDiv) resultsDiv.classList.add("hidden");

  try {
    // 1. Try reusing loaded dynamicMetaStats if they are already active
    if (globalThis.dynamicMetaStats && Object.keys(globalThis.dynamicMetaStats).length > 10) {
      state.rivenIndexData = globalThis.dynamicMetaStats;
      console.log("Reused globalThis.dynamicMetaStats for Riven Market Index!");
    } else {
      // 2. Fetch directly from the updated worker endpoint
      try {
        const res = await fetch("https://soft-mountain-28fe.edelamf0.workers.dev/api/rivens");
        if (res.ok) {
          let data = await res.json();
          if (data && data.data && typeof data.data === "object" && !Array.isArray(data.data)) {
            data = data.data;
          }
          if (data && !data.error && Object.keys(data).length > 0) {
            state.rivenIndexData = data;
            console.log("Loaded Riven Market Index directly from Worker!");
          }
        }
      } catch (apiErr) {
        console.warn("Direct API fetch failed, falling back to local asset", apiErr);
      }

      // 3. Fallback to local metastats.json asset if direct fetch failed
      if (!state.rivenIndexData) {
        const res = await fetch("metastats.json");
        if (!res.ok) throw new Error("Failed to fetch metastats.json");
        const data = await res.json();
        state.rivenIndexData = data;
        console.log("Loaded Riven Market Index from local fallback!");
      }
    }

    if (loadingDiv) loadingDiv.classList.add("hidden");
    if (resultsDiv) resultsDiv.classList.remove("hidden");

    filterRivenIndex();
  } catch (err) {
    console.error("Error loading Riven Market Index:", err);
    if (loadingDiv) {
      loadingDiv.innerHTML = `<span style="color:#ff6666;">${state.currentLang === "es" ? "Error al cargar las tendencias del mercado." : "Error loading market trends."}</span>`;
    }
  } finally {
    isIndexLoading = false;
  }
}

export function filterRivenIndex(resetPagination = true) {
  if (resetPagination) {
    indexRenderLimit = 30;
  }
  const data = state.rivenIndexData;
  if (!data) return;

  const query = document.getElementById("indexSearchInput")?.value?.trim()?.toLowerCase() || "";
  const sortBy = document.getElementById("indexSortSelect")?.value || "popularity";
  const sortDir = document.getElementById("btn-index-sort-dir")?.getAttribute("data-dir") || "desc";
  const isAsc = sortDir === "asc";

  const excludedComponents = new Set([
    // Zaw Grips
    "JAYAP", "KORB", "KROOSTRA", "KWATH", "LAKA", "PEYE", "SEEKALLA", "SHTUNG", "PLAGUE AKWIN", "PLAGUE BOKWIN",
    // Zaw Links
    "JAI", "RUHANG", "JAI II", "RUHANG II", "VARGEET JAI", "VARGEET RUHANG", "EKWANA JAI", "EKWANA RUHANG",
    "VARGEET II JAI", "VARGEET II RUHANG", "EKWANA II JAI", "EKWANA II RUHANG", "VARGEET JAI II", "VARGEET RUHANG II",
    "EKWANA JAI II", "EKWANA RUHANG II"
  ]);

  const siblingsMap = getNakedToSiblingsMap();
  const prefixesList = ["kuva", "tenet", "coda", "carmine", "rakta", "synoid", "sancti", "vaykor", "telos", "secura", "mk1", "prisma", "mara", "dex"];
  const suffixesList = ["prime", "vandal", "wraith", "prisma", "coda"];
  const isBaseWeapon = (wName) => {
    const lower = wName.toLowerCase().trim();
    const hasPrefix = prefixesList.some(p => lower.startsWith(p + " ") || lower.startsWith(p + "-"));
    const hasSuffix = suffixesList.some(s => lower.endsWith(" " + s));
    return !hasPrefix && !hasSuffix;
  };

  let items = Object.entries(data).filter(([name]) => {
    if (excludedComponents.has(name.toUpperCase())) return false;

    // Deduplicate: If a weapon sibling has an original base version (e.g. Grattler), only show the base card in the index.
    const naked = getNakedName(name);
    const siblings = siblingsMap[naked] || [name];
    const baseSibling = siblings.find(sib => isBaseWeapon(sib));

    if (baseSibling && baseSibling.toUpperCase() !== name.toUpperCase()) {
      return false;
    }
    return true;
  });

  if (query) {
    items = items.filter(([name]) => {
      // Match if the main name contains query OR if any of its sibling variants contains the query
      const naked = getNakedName(name);
      const siblings = siblingsMap[naked] || [name];
      return siblings.some(sib => sib.toLowerCase().includes(query));
    });
  }

  const getUnrolledMedian = (data) => {
    if (data.de_unrolled && data.de_unrolled.median !== undefined && data.de_unrolled.median !== null && data.de_unrolled.median > 0) {
      return data.de_unrolled.median;
    }
    if (data.official_median !== undefined && data.official_median !== null && data.official_median > 0) {
      return data.official_median;
    }
    return data.official_avg_price || 0;
  };

  items.sort((a, b) => {
    const dataA = a[1];
    const dataB = b[1];

    let scoreA = 0;
    let scoreB = 0;

    if (sortBy === "popularity") {
      scoreA = dataA.popularity_pct || 0;
      scoreB = dataB.popularity_pct || 0;
    } else if (sortBy === "price-official") {
      scoreA = getUnrolledMedian(dataA);
      scoreB = getUnrolledMedian(dataB);
    } else if (sortBy === "price-wfm") {
      scoreA = dataA.wfm_avg_price || 0;
      scoreB = dataB.wfm_avg_price || 0;
    } else if (sortBy === "potential" || sortBy === "potential-real") {
      scoreA = calculateRealPotential(dataA);
      scoreB = calculateRealPotential(dataB);
    } else if (sortBy === "potential-web") {
      scoreA = calculateWebPotential(dataA);
      scoreB = calculateWebPotential(dataB);
    } else if (sortBy === "arbitrage") {
      const medA = getUnrolledMedian(dataA);
      const medB = getUnrolledMedian(dataB);
      scoreA = medA > 0 ? Math.max((dataA.wfm_avg_price || 0) - medA, 0) : 0;
      scoreB = medB > 0 ? Math.max((dataB.wfm_avg_price || 0) - medB, 0) : 0;
    } else if (sortBy === "kuva") {
      // Calculate real official trade volume (completed unrolled + rerolled DE trades)
      const realVolumeA = (dataA.de_unrolled?.pop || 0) + (dataA.de_rerolled?.pop || 0);
      const realVolumeB = (dataB.de_unrolled?.pop || 0) + (dataB.de_rerolled?.pop || 0);

      // Penalize dead/low-liquidity markets to protect Kuva investment ROI
      const volMultiplierA = realVolumeA >= 3 ? 1.0 : (realVolumeA > 0 ? 0.4 : 0.05);
      const volMultiplierB = realVolumeB >= 3 ? 1.0 : (realVolumeB > 0 ? 0.4 : 0.05);

      scoreA = calculateRealPotential(dataA) * (dataA.popularity_pct || 0.1) * volMultiplierA;
      scoreB = calculateRealPotential(dataB) * (dataB.popularity_pct || 0.1) * volMultiplierB;
    }

    if (scoreA !== scoreB) {
      return isAsc ? scoreA - scoreB : scoreB - scoreA;
    }
    return a[0].localeCompare(b[0]);
  });

  renderRivenIndexList(items);
}

// Sibling variants pre-computation map for O(1) rendering speed
let nakedToSiblingsMap = null;
let lastSiblingsListLength = 0;

function getNakedToSiblingsMap() {
  const currentLength = state.allRivenNames ? state.allRivenNames.length : 0;
  if (nakedToSiblingsMap && currentLength === lastSiblingsListLength) {
    return nakedToSiblingsMap;
  }

  nakedToSiblingsMap = {};
  lastSiblingsListLength = currentLength;
  if (state.allRivenNames && state.allRivenNames.length > 0) {
    state.allRivenNames.forEach(name => {
      const naked = getNakedName(name);
      if (!nakedToSiblingsMap[naked]) {
        nakedToSiblingsMap[naked] = [];
      }
      nakedToSiblingsMap[naked].push(name);
    });
    for (const naked in nakedToSiblingsMap) {
      nakedToSiblingsMap[naked].sort((a, b) => a.localeCompare(b));
    }
  }
  return nakedToSiblingsMap;
}

export function renderRivenIndexList(items) {
  const container = document.getElementById("index-results-container");
  if (!container) return;

  if (items.length === 0) {
    container.innerHTML = `<div style="text-align: center; padding: 20px; color: #888;">${state.currentLang === "es" ? "No se encontraron armas" : "No weapons found"}</div>`;
    container.classList.remove("hidden");
    return;
  }

  const isEs = state.currentLang === "es";
  const siblingsMap = getNakedToSiblingsMap(); // O(1) cached outside loop!

  const renderedItems = items.slice(0, indexRenderLimit);

  const cardsHtml = renderedItems.map(([name, originalVal]) => {
    const isExpanded = expandedWeapons.has(name);

    // Optimized variant retrieval (O(1) Map lookup vs O(N) Array filter)
    const currentNaked = getNakedName(name);
    const siblings = siblingsMap[currentNaked] || [name];

    // Determine if this family currently has a selected variant in the search input
    const activeSelectedInputName = document.getElementById("rivenWeaponInput")?.value || "";
    const isCurrentFamilySelected = siblings.some(sib => sib.toUpperCase() === activeSelectedInputName.toUpperCase());
    const activeRenderingName = isCurrentFamilySelected ? activeSelectedInputName : name;

    // Fallback to base weapon pricing stats if missing/empty in the current variant
    let val = (state.rivenIndexData && state.rivenIndexData[activeRenderingName]) || originalVal || {};
    const hasUnrolled = val.de_unrolled && val.de_unrolled.median > 0;
    const hasOfficial = val.official_median > 0;

    if (!hasUnrolled && !hasOfficial) {
      // Find the base naked sibling that has stats in state.rivenIndexData
      // A base weapon is preferred if it has no prefixes and no suffixes.
      const prefixesList = ["kuva", "tenet", "coda", "carmine", "rakta", "synoid", "sancti", "vaykor", "telos", "secura", "mk1", "prisma", "mara", "dex"];
      const suffixesList = ["prime", "vandal", "wraith", "prisma", "coda"];

      const baseSibling = siblings.find(sib => {
        const lowerSib = sib.toLowerCase().trim();
        if (lowerSib === currentNaked) return true;
        const hasPrefix = prefixesList.some(p => lowerSib.startsWith(p + " ") || lowerSib.startsWith(p + "-"));
        const hasSuffix = suffixesList.some(s => lowerSib.endsWith(" " + s));
        return !hasPrefix && !hasSuffix;
      });

      if (baseSibling && baseSibling !== activeRenderingName && state.rivenIndexData && state.rivenIndexData[baseSibling]) {
        const baseVal = state.rivenIndexData[baseSibling];

        // Deep clone the base stats as starting point, then override with any valid variant-specific stats
        const mergedVal = JSON.parse(JSON.stringify(baseVal));

        // Helper to override if variant has a valid value
        const overrideIfValid = (key) => {
          if (val[key] !== undefined && val[key] !== null) {
            if (typeof val[key] === 'object') {
              if (Object.keys(val[key]).length > 0) {
                // Ensure sub-properties are also valid
                const hasValidProps = Object.values(val[key]).some(v => v !== null && v !== undefined && v !== 0);
                if (hasValidProps) {
                  mergedVal[key] = { ...mergedVal[key], ...val[key] };
                }
              }
            } else if (val[key] !== 0 && val[key] !== "") {
              mergedVal[key] = val[key];
            }
          }
        };

        // Specific fields to check and merge
        const fields = [
          "de_unrolled", "de_rerolled", "pos", "neg", "top_positive", "top_negative",
          "official_median", "official_avg_price", "official_stddev", "popularity_pct",
          "wfm_avg_price", "wfm_market_sample", "trend_7d_pct"
        ];

        fields.forEach(overrideIfValid);
        val = mergedVal;
      }
    }

    const siblingCount = siblings.length;
    const hoverWidth = siblingCount > 1 ? (58 * siblingCount + 6 * (siblingCount - 1)) : 58;

    const sortedSiblings = [...siblings].sort((a, b) => {
      const aName = a.toLowerCase();
      const bName = b.toLowerCase();
      const aIsBase = aName === currentNaked.toLowerCase();
      const bIsBase = bName === currentNaked.toLowerCase();
      if (aIsBase && !bIsBase) return -1;
      if (!aIsBase && bIsBase) return 1;
      return 0;
    });

    const variantsHtml = sortedSiblings.map(sib => {
      const isMain = sib.toUpperCase() === activeRenderingName.toUpperCase();
      const sibDetails = getWeaponDetails(sib);
      const sibImg = getWeaponImagePath(sib, sibDetails);
      return `<div class="variant-hover-item ${isMain ? "active-variant" : ""}" 
                   title="${escapeHTML(sib)}" 
                   onclick="event.stopPropagation(); selectRivenWeapon('${escapeHTML(sib)}');">
                <img src="${sibImg}" onerror="this.src='assets/img/default-weapon.webp';" />
              </div>`;
    }).join("");

    const popVal = (val.popularity_pct !== undefined && val.popularity_pct !== null) ? `${Math.round(val.popularity_pct)}/100` : "0/100";

    const hasWfm = val.wfm_avg_price !== undefined && val.wfm_avg_price !== null && val.wfm_avg_price > 0;
    const wfmMarketSample = val.wfm_market_sample || 0;

    // Dual-market prices extraction with fallback
    const unrolledMedian = (val.de_unrolled && val.de_unrolled.median !== undefined && val.de_unrolled.median !== null && val.de_unrolled.median > 0)
      ? val.de_unrolled.median
      : (val.official_median !== undefined && val.official_median !== null && val.official_median > 0)
        ? val.official_median
        : (val.official_avg_price || 0);

    const rerolledMedian = (val.de_rerolled && val.de_rerolled.median !== undefined && val.de_rerolled.median !== null && val.de_rerolled.median > 0)
      ? val.de_rerolled.median
      : 0;

    const rerolledMax = (val.de_rerolled && val.de_rerolled.max_price !== undefined && val.de_rerolled.max_price !== null && val.de_rerolled.max_price > 0)
      ? val.de_rerolled.max_price
      : 0;

    const platImgHtml = `<img src="assets/relic_contents/platinum.webp" style="width:12px; height:12px; object-fit:contain; vertical-align:middle; margin-left:2px; margin-right:2px;">`;

    const unrolledPriceText = unrolledMedian > 0 ? `${unrolledMedian}${platImgHtml}` : "N/A";
    const unrolledPriceColor = unrolledMedian > 0 ? "display:inline-flex; align-items:center;" : "color: #777; font-style: italic;";

    const rerolledPriceText = rerolledMedian > 0 ? `${rerolledMedian}${platImgHtml}` : "N/A";
    const rerolledPriceColor = rerolledMedian > 0 ? "display:inline-flex; align-items:center;" : "color: #777; font-style: italic;";

    const maxPriceText = rerolledMax > 0 ? `${rerolledMax}${platImgHtml}` : "N/A";
    const maxPriceColor = rerolledMax > 0 ? "display:inline-flex; align-items:center;" : "color: #777; font-style: italic;";

    const wfmPriceText = hasWfm
      ? (wfmMarketSample > 0
        ? `${val.wfm_avg_price}${platImgHtml}<span style="font-size:0.65rem; font-weight:normal; opacity:0.8; margin-left:2px;">(${wfmMarketSample} ${isEs ? (wfmMarketSample === 1 ? "orden" : "órdenes") : (wfmMarketSample === 1 ? "order" : "orders")})</span>`
        : `${val.wfm_avg_price}${platImgHtml}`)
      : (isEs ? "Mercado inactivo" : "Inactive Market");
    const wfmPriceColor = hasWfm ? "display:inline-flex; align-items:center;" : "color: #ff9800; font-style: italic; font-size: 0.75rem; font-weight: normal;";

    // Dynamic, premium, dark tooltips
    const unrolledTooltip = getRivenTooltip("unrolled", isEs);
    const rerolledTooltip = getRivenTooltip("rerolled", isEs);
    const maxTooltip = getRivenTooltip("max", isEs);
    const wfmTooltip = getRivenTooltip("wfm", isEs);

    let potentialHtml = "";
    if (unrolledMedian > 0) {
      // 1. Real Potential (DE)
      const realMultVal = calculateRealPotential(val);
      const realMult = realMultVal.toFixed(1);
      let realBadgeStyle = "";
      if (realMultVal < 2.0) {
        realBadgeStyle = "color: #a0a0a5; background: rgba(160, 160, 165, 0.08); border: 1px solid rgba(160, 160, 165, 0.2);";
      } else if (realMultVal >= 4.0) {
        realBadgeStyle = "color: #ffd700; background: rgba(255, 215, 0, 0.08); border: 1px solid rgba(255, 215, 0, 0.25); text-shadow: 0 0 5px rgba(255, 215, 0, 0.3); font-weight: bold;";
      } else {
        realBadgeStyle = "color: #00e5ff; background: rgba(0, 229, 255, 0.08); border: 1px solid rgba(0, 229, 255, 0.2);";
      }

      const realLabel = isEs ? "POTENCIAL REAL" : "REAL POTENTIAL";
      const realTooltip = isEs
        ? "Potencial de Intercambio Real (DE): Muestra cuánto se puede revalorizar este Riven basándose únicamente en transacciones oficiales en el juego (incremento por ciclos, techo godroll y volatilidad)."
        : "Real Trade Potential (DE): Shows how much this Riven can revalue using pure official in-game trade transactions (Reroll markup, godroll ceiling, volatility).";
      const realBadgeHtml = `<span class="index-price-diff" style="${realBadgeStyle}; cursor: help;" data-tooltip="${realTooltip}">${realLabel}: x${realMult} <span class="info-icon" style="font-size: 0.65rem; margin-left: 2px;">ℹ</span></span>`;

      // 2. Web Potential (WFM)
      const webMultVal = calculateWebPotential(val);
      const webMult = webMultVal.toFixed(1);
      let webBadgeStyle = "";
      if (webMultVal < 2.0) {
        webBadgeStyle = "color: #a0a0a5; background: rgba(160, 160, 165, 0.08); border: 1px solid rgba(160, 160, 165, 0.2);";
      } else if (webMultVal >= 4.0) {
        webBadgeStyle = "color: #ffd700; background: rgba(255, 215, 0, 0.08); border: 1px solid rgba(255, 215, 0, 0.25); text-shadow: 0 0 5px rgba(255, 215, 0, 0.3); font-weight: bold;";
      } else {
        webBadgeStyle = "color: #00e5ff; background: rgba(0, 229, 255, 0.08); border: 1px solid rgba(0, 229, 255, 0.2);";
      }

      const webLabel = isEs ? "POTENCIAL WEB" : "WEB POTENTIAL";
      const webTooltip = isEs
        ? "Potencial de Escaparate Web (WFM): Muestra el índice de revalorización especulativa basándose en el margen de ofertas activas en Warframe.Market y la liquidez online."
        : "Web Listings Potential (WFM): Shows the speculative revaluation index based on active Warframe.Market listings markup and active online liquidity.";
      const webBadgeHtml = `<span class="index-price-diff" style="${webBadgeStyle}; cursor: help;" data-tooltip="${webTooltip}">${webLabel}: x${webMult} <span class="info-icon" style="font-size: 0.65rem; margin-left: 2px;">ℹ</span></span>`;

      potentialHtml = `<span class="potential-badges-row" style="display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; vertical-align: middle;">${realBadgeHtml}${webBadgeHtml}</span>`;
    } else {
      const label = isEs ? "POTENCIAL" : "POTENTIAL";
      const potentialTooltip = isEs
        ? "No se puede calcular el potencial porque no hay datos de precio base para esta variante."
        : "Cannot calculate potential because there are no base pricing statistics for this variant.";
      potentialHtml = `<span class="index-price-diff" style="color: #a0a0a5; background: rgba(160, 160, 165, 0.04); border: 1px solid rgba(160, 160, 165, 0.15); cursor: help;" data-tooltip="${potentialTooltip}">${label}: N/A <span class="info-icon" style="font-size: 0.65rem; margin-left: 2px;">ℹ</span></span>`;
    }

    let volatilityHtml = "";
    const stddevVal = (val.de_unrolled && val.de_unrolled.stddev !== undefined) ? val.de_unrolled.stddev : (val.official_stddev || 0);
    const hasVolatility = stddevVal > 0 || unrolledMedian > 0;
    if (hasVolatility) {
      const ratio = unrolledMedian > 0 ? stddevVal / unrolledMedian : 0;
      let riskLabel = "";
      let riskColor = "";
      let glowColor = "";
      let riskTooltip = "";

      if (!stddevVal) {
        riskLabel = isEs ? "ESTABLE" : "STABLE";
        riskColor = "#00ff78";
        glowColor = "rgba(0, 255, 120, 0.2)";
        riskTooltip = isEs
          ? "El precio de este Riven es predecible y seguro. Casi todo el mundo lo compra y vende por la misma cantidad de platino."
          : "The price of this Riven is predictable and safe. Almost everyone buys and sells it for the same amount of platinum.";
      } else if (ratio < 0.5) {
        riskLabel = isEs ? "ESTABLE" : "STABLE";
        riskColor = "#00ff78";
        glowColor = "rgba(0, 255, 120, 0.2)";
        riskTooltip = isEs
          ? "El precio de este Riven es predecible y seguro. Casi todo el mundo lo compra y vende por la misma cantidad de platino."
          : "The price of this Riven is predictable and safe. Almost everyone buys and sells it for the same amount of platinum.";
      } else if (ratio <= 1.2) {
        riskLabel = isEs ? "MODERADO" : "MODERATE";
        riskColor = "#ffb300";
        glowColor = "rgba(255, 179, 0, 0.2)";
        riskTooltip = isEs
          ? "El precio fluctúa bastante. Dependiendo de las estadísticas o del comprador, puedes ganar o perder mucho margen de platino."
          : "The price fluctuates quite a bit. Depending on the stats or the buyer, you can gain or lose a lot of platinum margin.";
      } else {
        riskLabel = isEs ? "EXTREMO" : "EXTREME";
        riskColor = "#ff4444";
        glowColor = "rgba(255, 68, 68, 0.2)";
        riskTooltip = isEs
          ? "No hay un precio fijo. Algunos jugadores pagan auténticas fortunas por él, mientras que otros lo malvenden. Entra bajo tu propio riesgo."
          : "There is no fixed price. Some players pay absolute fortunes for it, while others quick-sell it. Enter at your own risk.";
      }

      volatilityHtml = `
        <span class="index-card-price-span" data-tooltip="${riskTooltip}" style="cursor: help;">
          <span class="price-label-small">${isEs ? "RIESGO:" : "RISK:"}</span>
          <span class="price-value-small" style="color: ${riskColor}; font-weight: bold; text-shadow: 0 0 5px ${glowColor}; display: inline-flex; align-items: center; gap: 2px;">
            ${riskLabel} 
            <span style="font-size:0.65rem; opacity:0.8; font-weight:normal; display: inline-flex; align-items: center;">
              (σ:${Math.round(stddevVal)}<img src="assets/relic_contents/platinum.webp" style="width:10px; height:10px; object-fit:contain; vertical-align:middle; margin-left:1px;">)
            </span> 
            <span class="info-icon" style="font-size: 0.65rem; margin-left: 2px;">ℹ</span>
          </span>
        </span>
      `;
    }

    let topPos = val.top_positive;
    if (!topPos) {
      if (Array.isArray(val.pos)) topPos = val.pos[0];
      else if (val.pos && Array.isArray(val.pos.best)) topPos = val.pos.best[0];
    }

    let topNeg = val.top_negative;
    if (!topNeg) {
      if (Array.isArray(val.neg)) topNeg = val.neg[0];
      else if (val.neg && Array.isArray(val.neg.best)) topNeg = val.neg.best[0];
    }

    // Defensive fallback: If topPos or topNeg is still empty, resolve using getMetaStats
    if (!topPos || !topNeg) {
      const fallbackMeta = getMetaStats(name, state.weaponMap[name]?.t);
      if (fallbackMeta) {
        if (!topPos) {
          topPos = fallbackMeta.top_positive;
          if (!topPos) {
            if (Array.isArray(fallbackMeta.pos)) topPos = fallbackMeta.pos[0];
            else if (fallbackMeta.pos && Array.isArray(fallbackMeta.pos.best)) topPos = fallbackMeta.pos.best[0];
          }
        }
        if (!topNeg) {
          topNeg = fallbackMeta.top_negative;
          if (!topNeg) {
            if (Array.isArray(fallbackMeta.neg)) topNeg = fallbackMeta.neg[0];
            else if (fallbackMeta.neg && Array.isArray(fallbackMeta.neg.best)) topNeg = fallbackMeta.neg.best[0];
          }
        }
      }
    }

    const posTagHtml = topPos ? `<span class="index-quick-tag positive">+ ${escapeHTML(getLocalizedStatName(topPos))}</span>` : "";
    const negTagHtml = topNeg ? `<span class="index-quick-tag negative">- ${escapeHTML(getLocalizedStatName(topNeg))}</span>` : "";

    // Rule 2: 7-Day Trend Badge rendering
    let trendHtml = "";
    const trendVal = val.trend_7d_pct;
    if (trendVal !== undefined && trendVal !== null) {
      const isPositive = trendVal > 0;
      const isNegative = trendVal < 0;

      let trendColor = "#a0a0a5";
      let trendBg = "rgba(160, 160, 165, 0.08)";
      let trendBorder = "rgba(160, 160, 165, 0.2)";
      let trendGlow = "none";
      let trendIcon = "•";
      let trendPrefix = "";

      if (isPositive) {
        trendColor = "#00ff78";
        trendBg = "rgba(0, 255, 120, 0.08)";
        trendBorder = "rgba(0, 255, 120, 0.2)";
        trendGlow = "0 0 5px rgba(0, 255, 120, 0.2)";
        trendIcon = "▲";
        trendPrefix = "+";
      } else if (isNegative) {
        trendColor = "#ff4444";
        trendBg = "rgba(255, 68, 68, 0.08)";
        trendBorder = "rgba(255, 68, 68, 0.2)";
        trendGlow = "0 0 5px rgba(255, 68, 68, 0.2)";
        trendIcon = "▼";
      }

      const trendTooltip = isEs
        ? `Variación estimada del precio oficial en los últimos 7 días.`
        : `Estimated official price variation in the last 7 days.`;

      trendHtml = `
        <span class="index-badge-trend" data-tooltip="${trendTooltip}" style="cursor: help; color: ${trendColor}; background: ${trendBg}; border: 1px solid ${trendBorder}; text-shadow: ${trendGlow}; padding: 2px 6px; border-radius: 4px; font-size: 0.7rem; font-weight: bold; display: inline-flex; align-items: center; gap: 4px;">
          <span>${trendIcon}</span>
          <span>${trendPrefix}${trendVal.toFixed(1)}%</span>
        </span>
      `;
    }

    let detailsHtml = "";
    if (isExpanded) {
      let bestPos = [];
      let worstPos = [];
      let bestNeg = [];
      let worstNeg = [];

      if (Array.isArray(val.pos)) {
        bestPos = val.pos;
      } else if (val.pos) {
        bestPos = val.pos.best || [];
        worstPos = val.pos.worst || [];
      }

      if (Array.isArray(val.neg)) {
        bestNeg = val.neg;
      } else if (val.neg) {
        bestNeg = val.neg.best || [];
        worstNeg = val.neg.worst || [];
      }

      // Robust fallback using getMetaStats for missing recommendations (e.g. Sydon or empty variant entries)
      if (bestPos.length === 0 || bestNeg.length === 0) {
        const fallbackMeta = getMetaStats(name, state.weaponMap[name]?.t);
        if (fallbackMeta) {
          if (bestPos.length === 0 && fallbackMeta.pos) {
            bestPos = Array.isArray(fallbackMeta.pos) ? fallbackMeta.pos : (fallbackMeta.pos.best || []);
            worstPos = Array.isArray(fallbackMeta.pos) ? [] : (fallbackMeta.pos.worst || []);
          }
          if (bestNeg.length === 0 && fallbackMeta.neg) {
            bestNeg = Array.isArray(fallbackMeta.neg) ? fallbackMeta.neg : (fallbackMeta.neg.best || []);
            worstNeg = Array.isArray(fallbackMeta.neg) ? [] : (fallbackMeta.neg.worst || []);
          }
        }
      }

      const renderPills = (list, pillClass) => {
        if (!list || list.length === 0) return `<span style="font-size: 0.75rem; color: #555;">N/A</span>`;
        return list.map(item => `<span class="index-detail-pill ${pillClass}">${escapeHTML(getLocalizedStatName(item))}</span>`).join("");
      };

      detailsHtml = `
        <div class="index-item-details">
          <div class="index-detail-section">
            <span class="index-detail-title">${isEs ? "Mejores Positivos" : "Best Positives"}</span>
            <div class="index-detail-tags">${renderPills(bestPos, "pos-best")}</div>
          </div>
          ${worstPos.length > 0 ? `
          <div class="index-detail-section">
            <span class="index-detail-title">${isEs ? "Peores Positivos" : "Worst Positives"}</span>
            <div class="index-detail-tags">${renderPills(worstPos, "pos-worst")}</div>
          </div>` : ""}
          <div class="index-detail-section">
            <span class="index-detail-title">${isEs ? "Mejores Negativos" : "Best Negatives (Harmless)"}</span>
            <div class="index-detail-tags">${renderPills(bestNeg, "neg-best")}</div>
          </div>
          ${worstNeg.length > 0 ? `
          <div class="index-detail-section">
            <span class="index-detail-title">${isEs ? "Peores Negativos" : "Worst Negatives (Critical)"}</span>
            <div class="index-detail-tags">${renderPills(worstNeg, "neg-worst")}</div>
          </div>` : ""}
        </div>
      `;
    }

    return `
      <div class="index-item-card ${isExpanded ? "expanded" : ""}">
        <div class="index-card-header" onclick="toggleRivenIndexDetails('${escapeHTML(name)}')">
          
          <!-- Area Izquierda: Wrapper anti-reflows y anti-flickers -->
          <div class="ic-icon-wrapper" style="width: 58px; height: 58px; position: relative; flex-shrink: 0; margin-right: 12px;">
            <div class="ic-icon-col ${siblingCount > 1 ? 'has-variants' : ''}" style="position: absolute; left: 0; top: 0; z-index: 10; --hover-width: ${hoverWidth}px;" onclick="event.stopPropagation(); selectRivenWeapon('${escapeHTML(activeRenderingName)}');">
              <div class="ic-variants-inline-row">
                ${variantsHtml}
              </div>
            </div>
          </div>
          
          <!-- Area Central: Título, Popularidad y Precios Consolidados -->
          <div class="index-card-info-area">
            <div class="index-card-top-line">
              <span class="index-card-weapon-name">${escapeHTML(name)}</span>
              ${popVal ? `<span class="index-badge-popularity" data-tooltip="${getRivenTooltip("trend", isEs)}" style="cursor: help;">TREND: ${popVal} <span class="info-icon" style="font-size: 0.65rem; margin-left: 2px;">ℹ</span></span>` : ""}
              ${trendHtml}
              ${potentialHtml}
            </div>
            
            <div class="index-card-price-groups" style="display: flex; gap: 10px; flex-wrap: wrap; margin-top: 6px; padding-top: 6px; border-top: 1px dashed rgba(255,255,255,0.06); width: 100%;">
              
              <!-- Group 1: REAL DATA (DE OFFICIAL TRADES) -->
              <div class="price-group-section de-official">
                <div style="font-size: 8px; color: var(--wf-gold-text); font-weight: 900; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid rgba(212, 175, 55, 0.15); padding-bottom: 2px; margin-bottom: 2px; display: flex; align-items: center; gap: 4px;">
                  <span>${isEs ? "DATOS REALES (DE)" : "REAL DATA (DE)"}</span>
                </div>
                <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center;">
                  <span class="index-card-price-span" data-tooltip="${unrolledTooltip}" style="cursor: help; display: inline-flex; align-items: center; gap: 4px;">
                    <span class="price-label-small" style="color: #aaa;">${isEs ? "Base/Unrolled:" : "Base/Unrolled:"}</span>
                    <span class="price-value-small" style="${unrolledPriceColor} font-weight: bold;">${unrolledPriceText}</span>
                  </span>
                  <span style="color: rgba(255,255,255,0.08); font-size: 10px;">|</span>
                  <span class="index-card-price-span" data-tooltip="${rerolledTooltip}" style="cursor: help; display: inline-flex; align-items: center; gap: 4px;">
                    <span class="price-label-small" style="color: #aaa;">${isEs ? "Rerolled:" : "Rerolled:"}</span>
                    <span class="price-value-small" style="${rerolledPriceColor} font-weight: bold;">${rerolledPriceText}</span>
                  </span>
                  <span style="color: rgba(255,255,255,0.08); font-size: 10px;">|</span>
                  <span class="index-card-price-span" data-tooltip="${maxTooltip}" style="cursor: help; display: inline-flex; align-items: center; gap: 4px;">
                    <span class="price-label-small" style="color: #ef4444; font-weight: bold;">${isEs ? "Máx:" : "Max:"}</span>
                    <span class="price-value-small" style="${maxPriceColor} font-weight: bold;">${maxPriceText}</span>
                  </span>
                </div>
              </div>

              <!-- Group 2: WEB DATA (WFM ACTIVE SHOWCASE) -->
              <div class="price-group-section wfm-web">
                <div style="font-size: 8px; color: var(--wf-blue); font-weight: 900; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid rgba(0, 229, 255, 0.15); padding-bottom: 2px; margin-bottom: 2px;">
                  ${isEs ? "DATOS WEB (WFM)" : "WEB DATA (WFM)"}
                </div>
                <span class="index-card-price-span" data-tooltip="${wfmTooltip}" style="cursor: help; display: inline-flex; align-items: center; gap: 4px; height: 100%;">
                  <span class="price-label-small" style="color: #aaa;">${isEs ? "Media Web:" : "Web Avg:"}</span>
                  <span class="price-value-small highlight-wfm" style="${wfmPriceColor} font-weight: bold;">${wfmPriceText}</span>
                </span>
              </div>

              <!-- Group 3: MARKET VOLATILITY / RISK -->
              ${volatilityHtml ? `
              <div class="price-group-section market-risk">
                <div style="font-size: 8px; color: #a0a0a5; font-weight: 900; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid rgba(255, 255, 255, 0.08); padding-bottom: 2px; margin-bottom: 2px;">
                  ${isEs ? "RIESGO DE MERCADO" : "MARKET RISK"}
                </div>
                <div style="display: inline-flex; align-items: center; height: 100%;">
                  ${volatilityHtml}
                </div>
              </div>
              ` : ""}

            </div>
          </div>
          
          <!-- Area Derecha: Expansión limpia y centrada -->
          <div class="index-card-right-area" style="align-self: center;">
            <span class="index-card-expand-indicator">&gt;</span>
          </div>
          
        </div>
        ${detailsHtml}
      </div>
    `;
  });

  let html = cardsHtml.join("");

  if (items.length > indexRenderLimit) {
    const remaining = items.length - indexRenderLimit;
    const btnText = isEs
      ? `Mostrar más (${remaining} más)`
      : `Show more (${remaining} more)`;
    html += `
      <div style="text-align: center; margin-top: 25px; margin-bottom: 10px; width: 100%;">
        <button onclick="globalThis.loadMoreRivenIndex();" class="wf-btn" style="padding: 10px 30px; font-size: 0.9rem; font-weight: bold; background: rgba(155, 89, 182, 0.15); border: 1px solid rgba(155, 89, 182, 0.4); color: #c59afc; border-radius: 6px; cursor: pointer; transition: all 0.3s;" onmouseover="this.style.background='rgba(155, 89, 182, 0.25)'; this.style.borderColor='rgba(155, 89, 182, 0.6)';" onmouseout="this.style.background='rgba(155, 89, 182, 0.15)'; this.style.borderColor='rgba(155, 89, 182, 0.4)';">
          ${btnText}
        </button>
      </div>
    `;
  }

  container.innerHTML = html;
  container.classList.remove("hidden");
}

export function toggleRivenIndexDetails(weaponName) {
  if (expandedWeapons.has(weaponName)) {
    expandedWeapons.delete(weaponName);
  } else {
    expandedWeapons.add(weaponName);
    selectRivenWeapon(weaponName);
  }
  filterRivenIndex();
}

export function syncRivenInputs(sourceId, targetId) {
  const source = document.getElementById(sourceId);
  const target = document.getElementById(targetId);
  if (source && target) {
    target.value = source.value;
  }
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
  refreshCurrentRivenMetaStats,
  initRivenMarketIndex,
  filterRivenIndex,
  toggleRivenIndexDetails,
  updateIndexTranslations,
  syncRivenInputs,
});
