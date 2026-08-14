import { state } from "../state.js";
import { TEXTS } from "../config.js";
import { getSlug } from "./slugs.utils.js";

const iconPathCache = new Map();
const setNameCache = new Map();
const requiredCountCache = new Map();

export function getSetName(fullName) {
  if (!fullName) return (state.currentLang === "es" ? "Otros" : "Others");
  if (setNameCache.has(fullName)) return setNameCache.get(fullName);
  const match = fullName.match(/(.*?) (Prime|Vandal|Wraith)/);
  const res = match ? match[0].trim() : (state.currentLang === "es" ? "Otros" : "Others");
  setNameCache.set(fullName, res);
  return res;
}

export function getRequiredCount(setName, partName) {
  const cacheKey = `${setName}::${partName}`;
  if (requiredCountCache.has(cacheKey)) return requiredCountCache.get(cacheKey);

  const resolveCount = () => {
    const manifest = state.primeManifest || [];
    const weapons = state.weaponDetailsDB || [];
    const item =
      manifest.find((i) => i.name === setName) ||
      weapons.find((i) => i.name === setName);
    if (!item?.components) return 1;

    let cleanPart =
      partName === setName ? "Blueprint" : partName.replace(setName, "").trim();
    if (cleanPart.endsWith(" Blueprint"))
      cleanPart = cleanPart.replace(" Blueprint", "").trim();

    const comp = item.components.find(
      (c) =>
        c.name === cleanPart ||
        c.name + " Blueprint" === cleanPart ||
        setName + " " + c.name === partName,
    );
    return comp ? comp.itemCount : 1;
  };

  const res = resolveCount();
  requiredCountCache.set(cacheKey, res);
  return res;
}

export function calculateTotalFullSets(setName) {
  if (!setName || setName === "Otros") return 0;

  let allParts = [];
  if (state.setsDatabase?.[setName]) {
    allParts = state.setsDatabase[setName];
  } else {
    if (!globalThis.setPartsCache) globalThis.setPartsCache = new Map();
    if (!globalThis.setPartsCache.has(setName) || globalThis.setPartsCache.get(setName).length === 0) {
      const parts = Object.keys(state.itemsDatabase || {}).filter(
        (name) =>
          (name === setName || name.startsWith(setName + " ")) &&
          !name.endsWith(" Set")
      );
      globalThis.setPartsCache.set(setName, parts);
    }
    allParts = globalThis.setPartsCache.get(setName);
  }


  let possibleSets = Infinity;
  allParts.forEach((partName) => {
    const requiredCount = getRequiredCount(setName, partName);
    const owned = state.primeInventory[partName] || 0;
    const safeReq = requiredCount > 0 ? requiredCount : 1;
    const sets = Math.floor(owned / safeReq);
    if (!Number.isNaN(sets) && sets < possibleSets) {
      possibleSets = sets;
    }
  });
  if (possibleSets === Infinity || Number.isNaN(possibleSets)) {
    possibleSets = 0;
  }

  const setItemOwned = state.primeInventory[setName + " Set"] || 0;
  return possibleSets + setItemOwned;
}

export function getItemIcon(itemName) {
  if (!itemName) return null;
  if (iconPathCache.has(itemName)) return iconPathCache.get(itemName);

  const resolveIcon = () => {
    let originalName = itemName
        .toLowerCase()
        .trim()
        .replace(/^\d+x\s+/, "");

    if (originalName === "forma blueprint") {
      return "assets/relic_contents/forma.webp";
    }

    if (originalName === "silva & aegis prime") return "assets/relic_contents/silva__aegis_prime.webp";
    if (originalName === "kavasa prime" || originalName === "kavasa prime collar") return "assets/relic_contents/kavasa_prime_kubrow_collar.webp";

    const baseSlug = originalName
        .replace(" set", "")
        .replaceAll(/\s+&\s+/g, "__")
        .replaceAll(/[\s-]+/g, "_")
        .replaceAll(/[^a-z0-9_]/g, "");

    const pPrefix = originalName.includes("prime") ? "prime_" : "";
    const basePath = `assets/relic_contents/${pPrefix}`;

    if (originalName.includes("systems")) {
      const archwings = ["amesha", "odonata", "elytron", "itzal"];
      const isArchwing = archwings.some((aw) => originalName.includes(aw));
      return `${basePath}systems${isArchwing ? "_archwing" : ""}.webp`;
    }

    if (/limb(?!o)/.test(originalName)) {
      return `${basePath}blade.webp`;
    }

    if (originalName.includes("string")) {
      return `${basePath}stock.webp`;
    }

    if (
        originalName.includes("grip") ||
        originalName.includes("pouch") ||
        originalName.includes("band")
    ) {
      return `${basePath}grip.webp`;
    }

    const partMappings = [
      ["neuroptics", ["neuroptics"]],
      ["cerebrum", ["cerebrum"]],
      ["carapace", ["carapace"]],
      ["harness", ["harness"]],
      ["wings", ["wings"]],
      ["barrel", ["barrel"]],
      ["receiver", ["receiver"]],
      ["stock", ["stock", "motor"]],
      ["link", ["link", "chain", "buckle"]],
      ["blade", ["blade", "stars"]],
      ["hilt", ["hilt", "handle", "ornament", "tip", "guard"]],
      ["disc", ["disc"]],
      ["boot", ["boot"]],
      ["gauntlet", ["gauntlet"]],
      ["head", ["head"]],
      ["chassis", ["chassis"]],
    ];

    const match = partMappings.find(([_, keywords]) =>
        keywords.some((k) => originalName.includes(k)),
    );

    if (match) {
      return `${basePath}${match[0]}.webp`;
    }

    if (originalName.includes("blueprint") || originalName.endsWith(" bp")) {
      const setSlug = baseSlug.replace(/(_blueprint|_bp)$/, "");
      return `assets/relic_contents/${setSlug}.webp`;
    }

    return `assets/relic_contents/${baseSlug}.webp`;
  };

  const result = resolveIcon();
  iconPathCache.set(itemName, result);
  return result;
}

export const DEFAULT_WEAPON_SVG = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="100%" height="100%"><defs><radialGradient id="bgGlow" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="%231a2233" /><stop offset="100%" stop-color="%230c0f17" /></radialGradient><linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="%23ffe082" /><stop offset="100%" stop-color="%23ffb300" /></linearGradient><filter id="glow"><feGaussianBlur stdDeviation="3" result="coloredBlur"/><feMerge><feMergeNode in="coloredBlur"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><rect width="100%" height="100%" fill="url(%23bgGlow)" rx="12" stroke="%2321263d" stroke-width="1.5"/><circle cx="64" cy="64" r="44" stroke="%2321263d" stroke-width="2" fill="none" opacity="0.6"/><circle cx="64" cy="64" r="44" stroke="url(%23goldGrad)" stroke-width="1.5" fill="none" stroke-dasharray="24 16" opacity="0.4"/><g filter="url(%23glow)" stroke="url(%23goldGrad)" stroke-width="3.5" stroke-linecap="round" fill="none" opacity="0.85"><path d="M44 84 L84 44" /><path d="M40 76 L48 84" /><path d="M44 84 L38 90" stroke-width="5" /><path d="M80 40 L88 32 M88 32 L84 32 M88 32 L88 36" stroke-width="2" /></g><path d="M18 18 L24 18 M18 18 L18 24 M110 18 L104 18 M110 18 L110 24 M18 110 L24 110 M18 110 L18 104 M110 110 L104 110 M110 110 L110 104" stroke="%23383f61" stroke-width="1" fill="none" opacity="0.5"/></svg>`;
