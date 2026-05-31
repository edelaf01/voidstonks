export const RIVEN_API_BASE = "https://soft-mountain-28fe.edelamf0.workers.dev/api";

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

export function extractFamilyName(weaponName) {
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

  const prefixes = [
    'Kuva ', 'Tenet ', 'Prisma ', 'Dex ', 'Mara ', 'Mk1-',
    'Mutalist ', 'Sancti ', 'Secura ', 'Rakta ', 'Telos ',
    'Synoid ', 'Vaykor ', 'Coda ', 'Carmine ', 'Shadow ',
  ];

  const suffixes = [
    ' Prime', ' Wraith', ' Vandal', ' Prisma', ' Dex',
    ' Blueprint', ' Umbra',
  ];

  let name = weaponName.trim();

  for (const prefix of prefixes) {
    if (name.toLowerCase().startsWith(prefix.toLowerCase())) {
      name = name.substring(prefix.length).trim();
      break;
    }
  }

  for (const suffix of suffixes) {
    if (name.toLowerCase().endsWith(suffix.toLowerCase())) {
      name = name.substring(0, name.length - suffix.length).trim();
      break;
    }
  }

  return name;
}

function processAndGroupFamilies(rawData) {
  const groupedData = {};

  for (const [weaponName, stats] of Object.entries(rawData)) {
    const familyName = extractFamilyName(weaponName);

    if (!groupedData[familyName]) {
      groupedData[familyName] = {
        familyName,
        variants: {},
        baseStats: stats,
      };
    }

    groupedData[familyName].variants[weaponName] = stats;

    if (weaponName === familyName) {
      groupedData[familyName].baseStats = stats;
    }
  }

  return groupedData;
}
