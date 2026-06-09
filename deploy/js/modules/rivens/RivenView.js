/**
 * RivenView.js
 * Capa de presentación (Vanilla JS) encargada de inyectar y manipular el DOM
 * para el analizador de Rivens.
 */

import { calculatePotentialScore } from './RivenValuationService.js';
import { TEXTS } from '../../config.js';
import { weaponNameToSlug, fetchWeaponHistory } from './RivenRepository.js';
import { state } from '../../state.js';

/**
 * Dibuja la estructura base del analizador en un contenedor padre.
 * @param {HTMLElement} container - Contenedor principal.
 */
export function renderRivenAnalyzerLayout(container) {
  container.innerHTML = `
    <div class="riven-analyzer-layout">
      <!-- SECCIÓN SUPERIOR: Visor e Información -->
      <div class="analyzer-top-section">
        
        <!-- Izquierda: Info de Precio y Grading -->
        <div class="analyzer-col left-col">
          <h2>Análisis Predictivo</h2>
          <div id="valuation-results-container">
            <div class="empty-state">Selecciona un arma del índice.</div>
          </div>
        </div>

        <!-- Centro: Controles del Mod -->
        <div class="analyzer-col center-col" id="mod-config-container">
           <h3>Configurar Riven</h3>
           <div class="config-placeholder">
             <p>Ajustes de estadísticas dinámicas</p>
             <!-- Los controles se renderizarían aquí -->
           </div>
        </div>

        <!-- Derecha: Preview Interactivo -->
        <div class="analyzer-col right-col" id="mod-preview-container">
          <!-- Renderizado dinámico de la RivenCard -->
        </div>

      </div>

      <!-- SECCIÓN INFERIOR: Índice de Mercado -->
      <div class="analyzer-bottom-section">
        <h2>Índice del Mercado</h2>
        <div class="index-controls">
          <input type="text" id="riven-search-input" placeholder="Buscar arma o familia..." class="riven-search-input" />
        </div>
        <div id="riven-market-grid" class="index-grid"></div>
      </div>
    </div>
  `;
}

/**
 * Dibuja dinámicamente la tarjeta estética in-game del Riven.
 * @param {HTMLElement} container - Elemento donde se inyectará la tarjeta.
 * @param {Object} props - Datos del Riven.
 */
export function renderRivenCardPreview(container, { title, imgUrl, rank, polarity, stats, masteryRank, rolls }) {
  const dotsHtml = Array.from({ length: 8 }).map((_, i) => 
    `<span class="rank-dot ${i < rank ? 'active' : ''}"></span>`
  ).join('');

  const statsHtml = stats.map(stat => {
    const isPositive = stat.value > 0;
    const sign = isPositive ? '+' : '';
    const colorClass = isPositive ? 'stat-positive' : 'stat-negative';
    return `<div class="riven-stat-line ${colorClass}">${sign}${stat.value}% ${stat.name}</div>`;
  }).join('');

  const imgHtml = imgUrl ? `<img src="${imgUrl}" alt="${title}" class="riven-weapon-img" />` : '';

  container.innerHTML = `
    <div class="riven-preview-container">
      <div class="riven-card-dynamic">
        <div class="riven-header">
          <span class="riven-polarity">${polarity}</span>
          <div class="riven-rank-dots">${dotsHtml}</div>
        </div>
        
        <div class="riven-body">
          <div class="riven-title">${title.toUpperCase()}</div>
          ${imgHtml}
          <div class="riven-stats-list">${statsHtml}</div>
        </div>

        <div class="riven-footer">
          <div class="riven-mr">MR ${masteryRank}</div>
          <div class="riven-rolls">Rolls: ${rolls}</div>
        </div>
      </div>
    </div>
  `;
}

/**
 * Renderiza los resultados de la tasación (ValuationResults) en su contenedor.
 */
export function renderValuationResults(container, selectedVariantName, valuation, historyData) {
  if (!valuation) return;

  container.innerHTML = `
    <div class="valuation-results">
      <div class="val-row">
        <span>Variante:</span> <strong>${selectedVariantName}</strong>
      </div>
      <div class="val-row price-est">
        <span>Valor Estimado:</span> 
        <span class="plat-text">~${valuation.estimatedValue}p</span>
      </div>
      <div class="val-row">
        <span>Rango Sugerido:</span> 
        <span>${valuation.suggestedMin}p - ${valuation.suggestedMax}p</span>
      </div>
      <div class="val-row">
        <span>Score del Roll:</span> 
        <span class="score-text">${valuation.adjustedScore}/100</span>
      </div>
      
      <div class="chart-container-mini">
        <canvas id="riven-history-chart"></canvas>
      </div>
    </div>
  `;

  if (historyData && historyData.length > 0) {
    initHistoryChart(document.getElementById('riven-history-chart'), historyData);
  }
}

/**
 * Renderiza el índice inferior de tarjetas buscando familias.
 * @param {HTMLElement} container - Contenedor del grid.
 * @param {Object} rivensData - Datos procesados de familias.
 * @param {string} filterText - Texto a filtrar.
 * @param {Function} onSelect - Callback cuando se clickea una tarjeta.
 */
export function renderMarketIndex(container, rivensData, filterText, onSelect) {
  container.innerHTML = '';
  
  const entries = Object.entries(rivensData).filter(([familyName]) => {
    const upper = familyName.toUpperCase();
    if (upper === "NOTE" || upper === "STATUS" || upper === "VERSION" || upper === "TTL" || upper === "DATA" || upper === "ERROR") return false;
    return familyName.toLowerCase().includes(filterText.toLowerCase());
  });

  const fragment = document.createDocumentFragment();

  entries.forEach(([familyName, familyData]) => {
    const cardEl = createAdvancedCardElement(familyName, familyData, onSelect);
    fragment.appendChild(cardEl);
  });

  container.appendChild(fragment);
}

function createAdvancedCardElement(familyName, familyData, onSelect) {
  const card = document.createElement('div');
  card.className = 'index-card-advanced';

  const variantEntries = Object.entries(familyData.variants || {});
  if (variantEntries.length === 0) return card;

  let activeVariantIndex = 0;
  let expanded = false;

  const updateCardUI = () => {
    const lang = globalThis.state?.currentLang || 'en';
    const t = TEXTS[lang]?.rivenIndex || TEXTS['en'].rivenIndex;

    const [activeWeaponName, activeWeapon] = variantEntries[activeVariantIndex];
    if (!activeWeapon) return;

    const score      = calculatePotentialScore(activeWeapon);
    const iconName   = weaponNameToSlug(activeWeaponName);

    // Prices (Robust object checks to fix [object Object] displaying when de_unrolled/de_rerolled are empty objects)
    const unrolledMed  = (activeWeapon.de_unrolled && typeof activeWeapon.de_unrolled === 'object') ? (activeWeapon.de_unrolled.median ?? 0) : (activeWeapon.de_unrolled ?? 0);
    const rerolledMed  = (activeWeapon.de_rerolled && typeof activeWeapon.de_rerolled === 'object') ? (activeWeapon.de_rerolled.median ?? 0) : (activeWeapon.de_rerolled ?? 0);
    const maxUnrolled  = (activeWeapon.de_unrolled && typeof activeWeapon.de_unrolled === 'object') ? (activeWeapon.de_unrolled.max_price ?? 0) : 0;
    const maxRerolled  = (activeWeapon.de_rerolled && typeof activeWeapon.de_rerolled === 'object') ? (activeWeapon.de_rerolled.max_price ?? 0) : 0;
    const maxPrice     = Math.max(maxUnrolled, maxRerolled, activeWeapon.max_price ?? 0);
    const avgPrice     = activeWeapon.wfm_avg_price ?? 0;
    const marketSample = activeWeapon.wfm_market_sample ?? 0;
    const trendPct     = (activeWeapon.trend_7d_pct ?? 0).toFixed(1);
    
    // Fetch precise disposition from weapon database (state.weaponMap) with fallback
    const dbWeapon     = (state.weaponMap && state.weaponMap[activeWeaponName]) || null;
    const dbDispo      = dbWeapon ? dbWeapon.d : null;
    const disposition  = (dbDispo ?? activeWeapon.disposition ?? 1.0).toFixed(2);

    const stdDev       = activeWeapon.wfm_std_dev ?? activeWeapon.wfm_stddev ?? null;

    // Risk
    let riskLabel = 'NORMAL', riskClass = 'risk-normal';
    if (stdDev !== null) {
      if      (stdDev > 800) { riskLabel = 'EXTREME';  riskClass = 'risk-extreme'; }
      else if (stdDev > 400) { riskLabel = 'HIGH';     riskClass = 'risk-high'; }
      else if (stdDev > 150) { riskLabel = 'MODERATE'; riskClass = 'risk-moderate'; }
    }

    // Trend
    const trendNum   = parseFloat(trendPct);
    const trendColor = trendNum > 0 ? '#4ade80' : trendNum < 0 ? '#f87171' : '#aaa';
    const trendArrow = trendNum > 0 ? '↑' : trendNum < 0 ? '↓' : '';

    // Pill helper
    const pills = (items) => {
      if (!items || items.length === 0) return '<span class="stat-pill muted">—</span>';
      return items.map(s => `<span class="stat-pill">${s}</span>`).join('');
    };

    // Ensure base weapon is first in rendering order so it is always visible at rest
    const sortedVariantEntries = [...variantEntries].sort((a, b) => {
      const aName = a[0].toLowerCase();
      const bName = b[0].toLowerCase();
      const aIsBase = aName === familyName.toLowerCase();
      const bIsBase = bName === familyName.toLowerCase();
      if (aIsBase && !bIsBase) return -1;
      if (!aIsBase && bIsBase) return 1;
      return 0;
    });

    // Variant hover dropdown HTML (No text labels, just clean webp image carousel)
    const variantDropdownHtml = sortedVariantEntries.map(([vName, vStats], idx) => {
      // Find original index from variantEntries to preserve data-idx selection correctly
      const originalIdx = variantEntries.findIndex(e => e[0] === vName);
      const isActive    = originalIdx === activeVariantIndex;
      const vIconName   = weaponNameToSlug(vName);
      return `
        <div class="variant-hover-item ${isActive ? 'active-variant' : ''}" data-idx="${originalIdx}">
          <img src="assets/relic_contents/${vIconName}.webp" onerror="this.onerror=null;" />
        </div>`;
    }).join('');

    const siblingCount = variantEntries.length;
    const hoverWidth = siblingCount > 1 ? (58 * siblingCount + 6 * (siblingCount - 1)) : 58;

    // Risk inline span
    const riskHtml = stdDev !== null
      ? `<span class="ic-price-sep">|</span>
         <span class="ic-price-item">
           <span class="ic-price-label">RISK:</span>
           <span class="${riskClass}">${riskLabel}</span>
           <small class="ic-price-meta">(σ:${Math.round(stdDev)}p)</small>
         </span>`
      : '';

    card.innerHTML = `
      <!-- HEADER ROW (always visible) -->
      <div class="ic-summary">
        <div class="ic-icon-col ${siblingCount > 1 ? 'has-variants' : ''}" style="--hover-width: ${hoverWidth}px;">
          <div class="ic-variants-inline-row">
            ${variantDropdownHtml}
          </div>
        </div>

        <div class="ic-content-col">
          <div class="ic-header">
            <span class="ic-title">${familyName}</span>
            <span class="ic-trend" style="color:${trendColor}">${trendArrow} ${trendPct}%</span>
          </div>
          <div class="ic-prices">
            <span class="ic-price-item">
              <span class="ic-price-label">${t.medianUnrolled}:</span>
              <span class="ic-price-val">↓ ${unrolledMed}p</span>
            </span>
            <span class="ic-price-sep">|</span>
            <span class="ic-price-item">
              <span class="ic-price-label">${t.medianRerolled}:</span>
              <span class="ic-price-val">↓ ${rerolledMed}p</span>
            </span>
            <span class="ic-price-sep">|</span>
            <span class="ic-price-item">
              <span class="ic-price-label">${t.maxRecorded}:</span>
              <span class="ic-price-val ic-price-max">↓ ${maxPrice}p</span>
            </span>
            <span class="ic-price-sep">|</span>
            <span class="ic-price-item">
              <span class="ic-price-label">${t.wfmAverage}:</span>
              <span class="ic-price-val">↓ ${avgPrice}p</span>
              <small class="ic-price-meta">(${marketSample} ${t.ords}.)</small>
            </span>
            ${riskHtml}
          </div>
        </div>

        <div class="ic-right-col">
          <span class="ic-potential-badge">POTENTIAL: x${score} ℹ</span>
          <span class="ic-dispo-badge">DISPO: ${disposition}</span>
                    <span class="ic-expand-arrow ${expanded ? 'expanded' : ''}">›</span>
          <span class="ic-liquidity-badge">LIQ: ${activeWeapon.liquidity_score ?? 0}</span>
          <span class="ic-volatility-badge">VOL: ${activeWeapon.volatility_index ?? 0}</span>
          <span class="ic-reroll-ratio-badge">RR: ${activeWeapon.rerolled_premium_ratio ?? 0}</span>
        </div>
      </div>

      <!-- DETAIL PANEL (collapsed by default) -->
      <div class="ic-detail-panel ${expanded ? 'open' : ''}">
        <!-- Stats pills 2x2 -->
        <div class="ic-stats-row">
          <div class="ic-stat-card ic-pos-best-card">
            <span class="ic-stat-label ic-pos-best">${t.bestPositives}</span>
            <div class="ic-pills">${pills(activeWeapon.pos?.best)}</div>
          </div>
          <div class="ic-stat-card ic-pos-worst-card">
            <span class="ic-stat-label ic-pos-worst">${t.worstPositives}</span>
            <div class="ic-pills">${pills(activeWeapon.pos?.worst)}</div>
          </div>
          <div class="ic-stat-card ic-neg-best-card">
            <span class="ic-stat-label ic-neg-best">${t.bestNegatives}</span>
            <div class="ic-pills">${pills(activeWeapon.neg?.best)}</div>
          </div>
          <div class="ic-stat-card ic-neg-worst-card">
            <span class="ic-stat-label ic-neg-worst">${t.worstNegatives}</span>
            <div class="ic-pills">${pills(activeWeapon.neg?.worst)}</div>
          </div>
        </div>

        <!-- Asynchronous price history chart -->
        <div class="ic-chart-row" style="margin-top: 14px; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 12px; display: none;">
          <span style="font-size: 0.7rem; color: #94a3b8; font-weight: 700; margin-bottom: 8px; display: block; text-transform: uppercase; letter-spacing: 0.05em;">HISTORIAL DE PRECIOS (7D)</span>
          <div style="height: 120px; position: relative; width: 100%;">
            <canvas class="ic-history-chart" style="width: 100%; height: 100%;"></canvas>
          </div>
        </div>
      </div>
    `;

    // Asynchronous loader for history chart
    const triggerHistoryChartLoad = async () => {
      const chartRow = card.querySelector('.ic-chart-row');
      if (!chartRow) return;
      chartRow.style.display = 'block';
      const canvas = chartRow.querySelector('.ic-history-chart');
      try {
        const historyData = await fetchWeaponHistory(activeWeaponName);
        if (historyData && historyData.length > 0) {
          initHistoryChart(canvas, historyData);
        } else {
          chartRow.querySelector('div').innerHTML = '<div style="color: #64748b; font-size: 0.72rem; text-align: center; padding: 10px;">No hay historial de precios disponible</div>';
        }
      } catch (err) {
        console.error("Error drawing chart for " + activeWeaponName, err);
      }
    };

    // Toggle expand on summary click
    card.querySelector('.ic-summary').addEventListener('click', (e) => {
      expanded = !expanded;
      card.querySelector('.ic-detail-panel').classList.toggle('open', expanded);
      card.querySelector('.ic-expand-arrow').classList.toggle('expanded', expanded);
      if (expanded) {
        triggerHistoryChartLoad();
      }
    });

    // Stop propagation when clicking on icon-col so variant selection does not trigger fold
    card.querySelector('.ic-icon-col').addEventListener('click', (e) => {
      e.stopPropagation();
      const currentActiveName = variantEntries[activeVariantIndex][0];
      if (globalThis.selectRivenWeapon) {
        globalThis.selectRivenWeapon(currentActiveName);
      }
    });

    // Variant card clicks (inside hover panel)
    card.querySelectorAll('.variant-hover-item').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        activeVariantIndex = parseInt(el.getAttribute('data-idx'), 10);
        updateCardUI();
        const clickedName = variantEntries[activeVariantIndex][0];
        if (globalThis.selectRivenWeapon) {
          globalThis.selectRivenWeapon(clickedName);
        }
      });
    });

    // If already expanded (e.g. activeVariantIndex changed), reload chart immediately
    if (expanded) {
      setTimeout(triggerHistoryChartLoad, 50);
    }
  };

  updateCardUI();
  return card;
}

/**
 * Inicializa Chart.js en un elemento canvas. (Requiere cargar script de Chart.js)
 */
export function initHistoryChart(canvasEl, data) {
  if (!window.Chart) {
    console.warn("Chart.js no está cargado. No se puede dibujar el gráfico.");
    return;
  }

  const labels = data.map(d => d.date);
  const wfmPrices = data.map(d => d.wfm_avg_price);
  const dePrices = data.map(d => d.official_median);

  new window.Chart(canvasEl, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Market Avg (WFM)',
          data: wfmPrices,
          borderColor: '#d4af37',
          yAxisID: 'y',
          tension: 0.2
        },
        {
          label: 'Official Median (DE)',
          data: dePrices,
          borderColor: '#00e5ff',
          yAxisID: 'y1',
          tension: 0.2
        }
      ]
    },
    options: {
      responsive: true,
      interaction: {
        mode: 'index',
        intersect: false,
      },
      scales: {
        y: {
          type: 'linear',
          display: true,
          position: 'left',
          grid: { color: '#333' }
        },
        y1: {
          type: 'linear',
          display: true,
          position: 'right',
          grid: { drawOnChartArea: false }
        }
      },
      plugins: {
        legend: {
          labels: { color: '#fff' }
        }
      }
    }
  });
}

/**
 * Renderiza el carrusel horizontal de variantes
 */
export function renderVariantCarousel(container, variants, onVariantSelect, activeVariantName) {
  container.innerHTML = '';
  const fragment = document.createDocumentFragment();

  for (const variantName of Object.keys(variants)) {
      const btn = document.createElement('button');
      btn.className = `variant-btn ${variantName === activeVariantName ? 'active' : ''}`;
      btn.textContent = variantName;
      
      // Estilos inline temporales, se moverán al CSS
      btn.style.padding = '8px 16px';
      btn.style.border = '1px solid #444';
      btn.style.borderRadius = '20px';
      btn.style.background = variantName === activeVariantName ? 'var(--wf-gold-text)' : 'rgba(255, 255, 255, 0.05)';
      btn.style.color = variantName === activeVariantName ? '#000' : '#fff';
      btn.style.cursor = 'pointer';
      btn.style.fontWeight = variantName === activeVariantName ? 'bold' : 'normal';
      btn.style.whiteSpace = 'nowrap';
      btn.style.transition = 'all 0.2s';

      btn.addEventListener('click', () => {
          onVariantSelect(variantName);
      });

      fragment.appendChild(btn);
  }

  container.appendChild(fragment);
}

/**
 * Renderiza la cuadrícula de estadísticas (Best/Worst Pos/Neg)
 */
export function renderAdvancedStats(container, variantData) {
  container.innerHTML = '';
  
  if (!variantData) return;

  const createList = (items, emptyMsg) => {
      if (!items || items.length === 0) return `<div style="color: #666; font-style: italic;">${emptyMsg}</div>`;
      return items.map(item => `<div class="stat-badge">${item}</div>`).join('');
  };

  const posBest = variantData.pos?.best || [];
  const posWorst = variantData.pos?.worst || [];
  const negBest = variantData.neg?.best || [];
  const negWorst = variantData.neg?.worst || [];

  container.innerHTML = `
      <div class="stat-card pos-best">
          <h4>Mejores Positivos <span style="font-size: 0.8em; color: #888;">(Buscados)</span></h4>
          <div class="stat-badges-container pos-best-badges">
              ${createList(posBest, 'No data')}
          </div>
      </div>
      <div class="stat-card pos-worst">
          <h4>Peores Positivos <span style="font-size: 0.8em; color: #888;">(A evitar)</span></h4>
          <div class="stat-badges-container pos-worst-badges">
              ${createList(posWorst, 'No data')}
          </div>
      </div>
      <div class="stat-card neg-best">
          <h4>Mejores Negativos <span style="font-size: 0.8em; color: #888;">(Inofensivos)</span></h4>
          <div class="stat-badges-container neg-best-badges">
              ${createList(negBest, 'No data')}
          </div>
      </div>
      <div class="stat-card neg-worst">
          <h4>Peores Negativos <span style="font-size: 0.8em; color: #888;">(Fatales)</span></h4>
          <div class="stat-badges-container neg-worst-badges">
              ${createList(negWorst, 'No data')}
          </div>
      </div>
  `;
}
