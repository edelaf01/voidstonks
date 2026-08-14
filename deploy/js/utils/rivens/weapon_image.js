import { getItemIcon } from "../ui_utils.js";

/**
 * Ruta del icono de un arma, con tres orígenes en cascada porque ninguno los cubre todos:
 * las Prime salen del catálogo de warframe.market, las demás del `localImage` de la base de
 * armas, y lo que no esté en ninguno se resuelve por convención de nombre de fichero.
 *
 * Siempre devuelve una ruta, nunca `null`: quien la use pone un `onerror` con el SVG por
 * defecto, que es la única forma de saber si el fichero existe de verdad.
 */
export function getWeaponImagePath(weaponName, details) {
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
    // Variantes de modo ("Vinquibus (Melee)", exaltadas, etc.) no tienen imagen propia:
    // reutilizan la del arma base quitando el paréntesis de modo del final del nombre.
    const baseName = weaponName.replace(/\s*\([^)]*\)\s*$/, "").trim();
    let slug = baseName.toLowerCase();
    if (slug.includes("&")) {
      slug = slug.replace(/\s*&\s*/g, "__");
    }
    slug = slug
      .replaceAll(/[\s-]+/g, "_")
      .replaceAll(/[^a-z0-9_]/g, "");
    if (!baseName.includes("&")) {
      slug = slug.replaceAll(/_+/g, "_");
    }
    imgPath = `assets/relic_contents/${slug}.webp`;
  }
  return imgPath;
}
