import { state } from "../state.js";

const iconPathCache = new Map();

export function getSetName(fullName) {
  if (!fullName) return "Otros";
  const match = fullName.match(/(.*?) (Prime|Vandal|Wraith)/);
  return match ? match[0].trim() : "Otros";
}

export function getRequiredCount(setName, partName) {
  const manifest = state.primeManifest || [];
  const weapons = state.weaponDetailsDB || [];
  const item =
    manifest.find((i) => i.name === setName) ||
    weapons.find((i) => i.name === setName);
  if (!item || !item.components) return 1;

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
}

export function generateDotsHtml(owned, required) {
  if (required <= 1) return "";
  const isComplete = owned >= required;
  let html = `<div class="tracker-dots ${isComplete ? "complete" : ""}" style="display: flex; gap: 3px; margin-left: 8px;">`;
  for (let i = 0; i < required; i++) {
    html += `<span class="tracker-dot ${i < owned ? "filled" : ""}"></span>`;
  }
  return html + `</div>`;
}

export function getItemIcon(itemName) {
  if (!itemName) return null;
  if (iconPathCache.has(itemName)) return iconPathCache.get(itemName);
  let originalName = itemName
    .toLowerCase()
    .trim()
    .replace(/^\d+x\s+/, "");
  if (originalName === "forma blueprint")
    return "assets/relic_contents/forma.webp";

  const baseSlug = originalName
    .replace(" set", "")
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/_+/g, "_");
  const pPrefix = originalName.includes("prime") ? "prime_" : "";
  const basePath = `assets/relic_contents/${pPrefix}`;

  if (originalName.includes("systems")) {
    const archwings = ["amesha", "odonata", "elytron", "itzal"];
    const isArchwing = archwings.some((aw) => originalName.includes(aw));
    return `${basePath}systems${isArchwing ? "_archwing" : ""}.webp`;
  }
  if (
    originalName.includes("grip") ||
    /limb(?!o)/.test(originalName) ||
    originalName.includes("string")
  )
    return `${basePath}grip.webp`;

  const partMappings = [
    ["neuroptics", ["neuroptics"]],
    ["chassis", ["chassis"]],
    ["barrel", ["barrel"]],
    ["receiver", ["receiver"]],
    ["stock", ["stock", "motor"]],
    ["link", ["link"]],
    ["hilt", ["hilt", "blade"]],
    ["blueprint", ["blueprint", "bp"]],
  ];
  const match = partMappings.find(([_, keywords]) =>
    keywords.some((k) => originalName.includes(k)),
  );
  const result = match
    ? `${basePath}${match[0]}.webp`
    : `assets/relic_contents/${baseSlug.replace(/(_blueprint|_bp)$/, "")}.webp`;
  iconPathCache.set(itemName, result);
  return result;
}
