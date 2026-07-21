/**
 * Warframe Kubrow data translations
 * Mapea paths/códigos de Warframe a nombres legibles en ES/EN
 */

export const KUBROW_BREEDS = {
  'Huras': { es: 'Huras', en: 'Huras' },
  'Sunika': { es: 'Sunika', en: 'Sunika' },
  'Raksa': { es: 'Raksa', en: 'Raksa' },
  'Sahasa': { es: 'Sahasa', en: 'Sahasa' },
  'Chesa': { es: 'Chesa', en: 'Chesa' },
  'Adarza': { es: 'Adarza', en: 'Adarza' },
  'Smeeta': { es: 'Smeeta', en: 'Smeeta' },
  'Vasili': { es: 'Vasili', en: 'Vasili' },
  'Khora': { es: 'Khora Deluxe', en: 'Khora Deluxe' },
};

export const KUBROW_PATTERNS = {
  // PatternF = Female patterns
  'F': { es: 'Femenino', en: 'Female' },
  'M': { es: 'Masculino', en: 'Male' },
  'SkinF': { es: 'Piel Femenina', en: 'Female Skin' },
  'SkinM': { es: 'Piel Masculina', en: 'Male Skin' },
  'CardF': { es: 'Tarjeta Femenina', en: 'Female Card' },
  'CardM': { es: 'Tarjeta Masculina', en: 'Male Card' },

  // Specific pattern names
  'PatternA': { es: 'Patrón A', en: 'Pattern A' },
  'PatternB': { es: 'Patrón B', en: 'Pattern B' },
  'PatternC': { es: 'Patrón C', en: 'Pattern C' },
  'PatternD': { es: 'Patrón D', en: 'Pattern D' },
  'PatternE': { es: 'Patrón E', en: 'Pattern E' },
  'PatternF': { es: 'Patrón F', en: 'Pattern F' },
};

export const KUBROW_COLORS = {
  // Color rarities
  'Mundane': { es: 'Común', en: 'Common' },
  'Mid': { es: 'Medio', en: 'Uncommon' },
  'Vibrant': { es: 'Vibrante', en: 'Rare' },

  // Specific color names (from Warframe)
  'Drahk': { es: 'Drahk', en: 'Drahk' },
  'Cephalon': { es: 'Cefalón', en: 'Cephalon' },
  'DuviriWolf': { es: 'Lobo Duviri', en: 'Duviri Wolf' },
  'Nexus': { es: 'Nexo', en: 'Nexus' },
};

export const translatePattern = (pattern, lang = 'es') => {
  if (!pattern) return lang === 'es' ? 'Desconocido' : 'Unknown';

  // Buscar match directo
  const direct = KUBROW_PATTERNS[pattern];
  if (direct) return direct[lang];

  // Buscar por contiene (ej: "PatternF" contiene "F")
  for (const [key, value] of Object.entries(KUBROW_PATTERNS)) {
    if (pattern.includes(key)) {
      return value[lang];
    }
  }

  return pattern; // Fallback: devolver el original si no hay match
};

export const translateBreed = (breed, lang = 'es') => {
  if (!breed || breed === 'Unknown') return lang === 'es' ? 'Desconocida' : 'Unknown';

  // Buscar match directo
  const direct = KUBROW_BREEDS[breed];
  if (direct) return direct[lang];

  return breed; // Fallback
};

export const translateColorRarity = (rarity, lang = 'es') => {
  if (!rarity) return lang === 'es' ? '?' : '?';

  const direct = KUBROW_COLORS[rarity];
  if (direct) return direct[lang];

  return rarity;
};

/**
 * Traduce nombres de archivos asset de Warframe
 * Ej: "/Lotus/Types/Game/KubrowPet/Patterns/KubrowPetPatternF" -> "Patrón F"
 */
export const translateAssetPath = (path, lang = 'es') => {
  if (!path) return lang === 'es' ? 'Desconocido' : 'Unknown';

  // Extraer el último componente del path
  const match = path.match(/([A-Za-z0-9]+)$/);
  if (match) {
    const component = match[1];

    // Patrón
    if (path.includes('Pattern')) {
      return translatePattern(component, lang);
    }

    // Color
    if (path.includes('Color')) {
      return translateColorRarity(component, lang);
    }

    // Raza
    for (const breed of Object.keys(KUBROW_BREEDS)) {
      if (component.includes(breed)) {
        return translateBreed(breed, lang);
      }
    }
  }

  return path;
};

export default {
  translatePattern,
  translateBreed,
  translateColorRarity,
  translateAssetPath,
  KUBROW_BREEDS,
  KUBROW_PATTERNS,
  KUBROW_COLORS,
};
