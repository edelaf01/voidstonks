/**
 * RivenRepository.js
 * Capa de datos para la obtención y manipulación inicial de información de Rivens en Vanilla JS.
 */

export const RIVEN_API_BASE = "https://soft-mountain-28fe.edelamf0.workers.dev/api";

/**
 * Obtiene el listado completo de datos de Rivens desde el worker de Cloudflare.
 * @returns {Promise<Object>} Promesa que resuelve con el mapa de metadatos de Rivens.
 */
export async function fetchCurrentRivens() {
  try {
    const response = await fetch(`${RIVEN_API_BASE}/rivens`);
    if (!response.ok) {
      throw new Error(`Error HTTP: ${response.status}`);
    }
    const data = await response.json();
    return processAndGroupFamilies(data);
  } catch (error) {
    console.error("RivenRepository - Error al obtener Rivens:", error);
    return {};
  }
}

/**
 * Obtiene el historial de precios para una familia de armas específica.
 * @param {string} weaponName - Nombre base del arma.
 * @returns {Promise<Array>} Promesa que resuelve con el array histórico.
 */
export async function fetchWeaponHistory(weaponName) {
  try {
    const encodedName = encodeURIComponent(weaponName);
    const response = await fetch(`${RIVEN_API_BASE}/history?weapon=${encodedName}`);
    if (!response.ok) {
      throw new Error(`Error HTTP al obtener historial para ${weaponName}`);
    }
    return await response.json();
  } catch (error) {
    console.error(`RivenRepository - Error obteniendo historial de ${weaponName}:`, error);
    return [];
  }
}

/**
 * Convierte un nombre de arma al slug de imagen (.webp).
 * Reemplaza espacios y guiones por _, y & por and.
 */
export function weaponNameToSlug(name) {
  let slug = name.toLowerCase();
  if (slug.includes('&')) {
    slug = slug.replace(/\s*&\s*/g, '__');
  }
  slug = slug
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
  if (!name.includes('&')) {
    slug = slug.replace(/_+/g, '_');
  }
  return slug;
}

/**
 * Extrae el nombre base de un arma eliminando prefijos Y sufijos de variante.
 * Ejemplos:
 *   "Soma Prime"   → "Soma"
 *   "Kuva Bramma"  → "Bramma"
 *   "Tenet Diplos" → "Diplos"
 *   "Nikana Prime" → "Nikana"
 *   "Strun Wraith" → "Strun"
 */
export function extractFamilyName(weaponName) {
  // Specific custom overrides for family mappings
  const overrides = {
    "prisma dual decurions": "Dual Decurion",
    "dual decurions": "Dual Decurion",
    "prisma dual decurion": "Dual Decurion",
    "dex furis": "Afuris",
    "dex afuris": "Afuris",
    "pangolin prime": "Pangolin Sword",
    "prime laser rifle": "Laser Rifle",
    "prime burst laser": "Burst Laser",
    "prime robo-deth": "Robo-Deth",
    "prime deth machine rifle": "Deth Machine Rifle",
    "vaykor marelok": "Marelok",
    "vaykor hek": "Hek"
  };

  const lowerName = weaponName.trim().toLowerCase();
  if (overrides[lowerName]) {
    return overrides[lowerName];
  }

  // Prefijos que van ANTES del nombre base
  const prefixes = [
    'Kuva ', 'Tenet ', 'Prisma ', 'Dex ', 'Mara ', 'Mk1-',
    'Mutalist ', 'Sancti ', 'Secura ', 'Rakta ', 'Telos ',
    'Synoid ', 'Vaykor ', 'Coda ', 'Carmine ', 'Shadow ',
  ];

  // Sufijos que van DESPUÉS del nombre base
  const suffixes = [
    ' Prime', ' Wraith', ' Vandal', ' Prisma', ' Dex',
    ' Blueprint', ' Umbra',
  ];

  let name = weaponName.trim();

  // 1. Strip prefix
  for (const prefix of prefixes) {
    if (name.toLowerCase().startsWith(prefix.toLowerCase())) {
      name = name.substring(prefix.length).trim();
      break;
    }
  }

  // 2. Strip suffix
  for (const suffix of suffixes) {
    if (name.toLowerCase().endsWith(suffix.toLowerCase())) {
      name = name.substring(0, name.length - suffix.length).trim();
      break;
    }
  }

  return name;
}

/**
 * Procesa la respuesta cruda agrupando variantes bajo la misma "familia".
 * Maneja tanto prefijos (Kuva X, Tenet X) como sufijos (X Prime, X Wraith).
 */
function processAndGroupFamilies(rawData) {
  const groupedData = {};

  for (const [weaponName, stats] of Object.entries(rawData)) {
    const familyName = extractFamilyName(weaponName);

    if (stats) {
      if (stats.liquidity_score === undefined) stats.liquidity_score = 0;
      if (stats.volatility_index === undefined) stats.volatility_index = 0;
      if (stats.rerolled_premium_ratio === undefined) stats.rerolled_premium_ratio = 0;
    }

    if (!groupedData[familyName]) {
      groupedData[familyName] = {
        familyName,
        variants: {},
        baseStats: stats,
      };
    }

    groupedData[familyName].variants[weaponName] = stats;

    // Si el arma coincide exactamente con el nombre base, es el base verdadero
    if (weaponName === familyName) {
      groupedData[familyName].baseStats = stats;
    }
  }

  return groupedData;
}
