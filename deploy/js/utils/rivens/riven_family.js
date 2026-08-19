/**
 * Weapon family: from "Kuva Bramma" to "Bramma".
 *
 * Not the same as `getBaseWeaponName` in riven_market.service.js, though they share the overrides
 * table: this one groups toward the base weapon on purpose (fallback for "Prisma Obex is not in
 * stat_weights.json but Obex is"); the other resolves the stats of THAT weapon. See
 * tests/riven-family-name-drift.test.mjs before touching either list.
 */
// prefixes and suffixes that mark a VARIANT of the same base weapon; exported because the search
// groups by the same list
export const VARIANT_PREFIXES = [
  'Kuva ', 'Tenet ', 'Prisma ', 'Dex ', 'Mara ', 'Mk1-', 'Mk1 ', 'Ceti ',
  'Mutalist ', 'Sancti ', 'Secura ', 'Rakta ', 'Telos ',
  'Synoid ', 'Vaykor ', 'Coda ', 'Carmine ', 'Shadow ',
];

export const VARIANT_SUFFIXES = [
  ' Prime', ' Wraith', ' Vandal', ' Prisma', ' Dex',
  ' Blueprint', ' Umbra', ' Coda',
];

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

  const prefixes = VARIANT_PREFIXES;
  const suffixes = VARIANT_SUFFIXES;

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
