/**
 * Familia de un arma: de "Kuva Bramma" a "Bramma".
 *
 * Estaba dentro de riven.repository.js, que es la capa de I/O — aquí no hay ni una petición:
 * son tablas y manipulación de cadenas. Al sacarlo, ui_rivens.js dejó de tener motivo para
 * importar del repositorio y esa violación de capa desapareció con él.
 *
 * OJO: NO es lo mismo que `getBaseWeaponName` de riven_market.service.js, aunque compartan la
 * tabla de overrides. Esta AGRUPA hacia el arma base a propósito (es el fallback de
 * "Prisma Obex no está en stat_weights.json pero Obex sí"); la otra resuelve las stats de ESA
 * arma y despellejar de más le daría las del arma equivocada. Ver
 * tests/riven-family-name-drift.test.mjs antes de tocar cualquiera de las dos listas.
 */
/**
 * Extracts base family name from a weapon.
 * E.g., "Soma Prime" -> "Soma", "Kuva Bramma" -> "Bramma"
 */
// Prefijos y sufijos que marcan una VARIANTE del mismo arma base. Se exportan porque la misma
// lista hacía falta en dos sitios con propósitos distintos —resolver datos de familia y agrupar el
// buscador— y estaban duplicadas: al añadir 'Ceti' en una, Ceti Lacera seguía saliendo suelta en el
// buscador porque la otra copia no se tocó.
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
