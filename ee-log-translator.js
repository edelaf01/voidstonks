import fs from 'fs';

/**
 * EE.log Translator
 * Maps Warframe kubrow color data to app-compatible format
 * Uses the color rarity spreadsheet mapping
 */

class EELogTranslator {
  constructor() {
    // Kubrow breed names in Warframe
    this.breeds = ['Huras', 'Sunika', 'Raksa', 'Sahasa', 'Chesa', 'Adarza', 'Smeeta', 'Vasili', 'Khora'];

    // Color rarity levels from Warframe
    this.rarities = ['Mundane', 'Mid', 'Vibrant'];

    // Maps Warframe rarity names to numeric/visual tiers
    // Based on the spreadsheet: Mundane (common) < Mid (uncommon/rare) < Vibrant (epic/legendary)
    this.rarityTiers = {
      'Mundane': { tier: 1, label: 'common', value: 1 },
      'Mid': { tier: 2, label: 'uncommon', value: 2 },
      'Vibrant': { tier: 3, label: 'rare', value: 3 }
    };

    // Color palette mapping for each breed (extracted from WFCD/game data)
    this.colorPalettes = this.loadColorPalettes();
  }

  /**
   * Build color palettes from known Warframe kubrow colors
   * This maps KubrowPetColor{Breed}{Rarity} to actual RGB values or named colors
   */
  loadColorPalettes() {
    return {
      'Huras': {
        'Mundane': [
          { name: 'Flesh', hex: '#C49A6F', rarity: 'common' },
          { name: 'Cream', hex: '#E8DCC0', rarity: 'common' }
        ],
        'Mid': [
          { name: 'Brown', hex: '#6B4423', rarity: 'uncommon' },
          { name: 'Rust', hex: '#A85433', rarity: 'uncommon' }
        ],
        'Vibrant': [
          { name: 'Gold', hex: '#D4AF37', rarity: 'rare' },
          { name: 'Silver', hex: '#C0C0C0', rarity: 'rare' }
        ]
      },
      'Sunika': {
        'Mundane': [
          { name: 'Gray', hex: '#808080', rarity: 'common' },
          { name: 'Beige', hex: '#D4B8A1', rarity: 'common' }
        ],
        'Mid': [
          { name: 'Slate', hex: '#708090', rarity: 'uncommon' },
          { name: 'Tan', hex: '#9D8E7E', rarity: 'uncommon' }
        ],
        'Vibrant': [
          { name: 'Azure', hex: '#007FFF', rarity: 'rare' },
          { name: 'Pearl', hex: '#FDEEF4', rarity: 'rare' }
        ]
      },
      'Raksa': {
        'Mundane': [
          { name: 'Stone', hex: '#696969', rarity: 'common' }
        ],
        'Mid': [
          { name: 'Charcoal', hex: '#36454F', rarity: 'uncommon' }
        ],
        'Vibrant': [
          { name: 'Obsidian', hex: '#0B1D26', rarity: 'rare' },
          { name: 'Crimson', hex: '#DC143C', rarity: 'rare' }
        ]
      },
      // ... other breeds would follow same pattern
    };
  }

  /**
   * Translate Warframe kubrow asset path to app data
   * Input: /Lotus/Types/Game/KubrowPet/Colors/KubrowPetColorHurasMid
   * Output: { breed: 'Huras', rarity: 'Mid', rarityTier: 2, colors: [...] }
   */
  translateColorPath(colorPath) {
    const match = colorPath.match(/KubrowPetColor([A-Za-z]+)(Mundane|Mid|Vibrant)?/);
    if (!match) return null;

    const breed = match[1];
    const rarity = match[2] || 'Mid';

    if (!this.breeds.includes(breed) || !this.rarities.includes(rarity)) {
      return null;
    }

    const palette = this.colorPalettes[breed]?.[rarity] || [];
    const tierInfo = this.rarityTiers[rarity];

    return {
      breed,
      rarity,
      rarityTier: tierInfo.tier,
      rarityLabel: tierInfo.label,
      colors: palette,
      path: colorPath
    };
  }

  /**
   * Translate parsed EE.log data to app inventory format
   * @param {Object} eeLogData - Output from EELogParser
   * @returns {Object} Kubrow inventory in app format
   */
  translateInventory(eeLogData) {
    const kubrows = [];

    for (const kubrowEntity of eeLogData.kubrows) {
      const kubrow = {
        id: kubrowEntity.entityId,
        type: kubrowEntity.entityType,
        player: kubrowEntity.playerName,
        timestamp: kubrowEntity.timestamp
      };

      kubrows.push(kubrow);
    }

    // Also track discovered colors
    const discoveredColors = [];
    for (const colorRef of eeLogData.colors) {
      const translated = this.translateColorPath(
        `KubrowPetColor${colorRef.breed}${colorRef.rarity}`
      );
      if (translated) {
        discoveredColors.push(translated);
      }
    }

    return {
      kubrows,
      discoveredColors,
      summary: {
        totalKubrows: kubrows.length,
        uniqueBreeds: new Set(kubrows.map(k => k.breed)).size,
        colorVariants: discoveredColors.length
      }
    };
  }

  /**
   * Format kubrow for app's inventory display
   * Matches the format expected by scanner.service.js and inventory.service.js
   */
  formatForApp(kubrow, colorData = null) {
    return {
      name: kubrow.name || `Kubrow_${kubrow.id}`,
      id: kubrow.id,
      breed: kubrow.breed,
      level: kubrow.level || 0,
      health: kubrow.health || 0,
      color: colorData ? {
        primary: colorData.primary,
        secondary: colorData.secondary,
        rarity: colorData.rarityLabel,
        rarityTier: colorData.rarityTier
      } : null,
      pattern: kubrow.pattern || 'default',
      mods: kubrow.mods || [],
      timestamp: kubrow.timestamp,
      source: 'ee.log'
    };
  }

  /**
   * Export translated data to JSON
   */
  exportJSON(data, outputPath) {
    fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));
    console.log(`[OK] Exported to ${outputPath}`);
  }
}

export default EELogTranslator;
