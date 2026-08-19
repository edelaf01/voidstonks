import { getItemIcon } from "../ui_utils.js";

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
    // mode variants ("Vinquibus (Melee)", exalted) reuse the base weapon image
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
