import { fetchCurrentRivens, fetchWeaponHistory } from './RivenRepository.js';
import { calculateHybridTiers, calculateAdvancedPredictivePrice } from './RivenValuationService.js';
import { renderMarketIndex, renderValuationResults } from './RivenView.js';

let rivensData = {};
let currentSelectedFamily = null;

export async function initRivenModule() {
  rivensData = await fetchCurrentRivens();

  const gridContainer = document.getElementById('riven-market-grid');
  const searchInput = document.getElementById('riven-search-input');
  
  if (gridContainer) {
    const updateGrid = () => {
      const filterText = searchInput ? searchInput.value : '';
      renderMarketIndex(gridContainer, rivensData, filterText, handleSelectFamily);
    };

    if (searchInput) {
      searchInput.addEventListener('input', updateGrid);
    }
    
    updateGrid();
  }
}

async function handleSelectFamily(familyName, familyData) {
  currentSelectedFamily = familyData;
  
  const defaultVariant = familyData.variants[familyName] ? familyName : Object.keys(familyData.variants)[0];
  
  await handleSelectVariant(defaultVariant);
}

async function handleSelectVariant(variantName) {
  const searchInput = document.getElementById('rivenWeaponInput');
  if (searchInput) {
      searchInput.value = variantName;
      searchInput.dispatchEvent(new Event('keyup'));
  }

  const variantData = currentSelectedFamily.variants[variantName];

  const historyData = await fetchWeaponHistory(variantName);
  const tiers = calculateHybridTiers(variantData);
  
  const fakeStats = [
    { name: "Critical Chance", value: 100, isPositive: true, minIdeal: 100, maxIdeal: 150 }
  ];
  const valuation = calculateAdvancedPredictivePrice(variantData, fakeStats, tiers);

  const resultsContainer = document.getElementById('valuation-results-container');
  if (resultsContainer) {
      renderValuationResults(resultsContainer, variantName, valuation, historyData);
  }
}

document.addEventListener('DOMContentLoaded', () => {
    const btnRiven = document.getElementById('btn-riven');
    if (btnRiven) {
        btnRiven.addEventListener('click', () => {
            if (Object.keys(rivensData).length === 0) {
                 initRivenModule();
            }
        });
    }
});
