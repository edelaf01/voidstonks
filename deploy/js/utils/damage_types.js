// label, color and icon of each damage type

const DAMAGE_TYPES = {
  impact: { es: "Impacto", en: "Impact", color: "#8ca8b3" },
  puncture: { es: "Perforación", en: "Puncture", color: "#a89984" },
  slash: { es: "Cortante", en: "Slash", color: "#cf5e5e" },
  heat: { es: "Calor", en: "Heat", color: "#ff8c00" },
  cold: { es: "Frío", en: "Cold", color: "#00bfff" },
  electricity: { es: "Electricidad", en: "Electric", color: "#dda0dd" },
  toxin: { es: "Toxina", en: "Toxin", color: "#32cd32" },
  blast: { es: "Explosión", en: "Blast", color: "#e67e22" },
  corrosive: { es: "Corrosivo", en: "Corrosive", color: "#2ecc71" },
  gas: { es: "Gas", en: "Gas", color: "#f1c40f" },
  magnetic: { es: "Magnético", en: "Magnetic", color: "#9b59b6" },
  radiation: { es: "Radiación", en: "Radiation", color: "#e74c3c" },
  viral: { es: "Viral", en: "Viral", color: "#e84393" },
  void: { es: "Vacío", en: "Void", color: "#1abc9c" },
  true: { es: "Verdadero", en: "True", color: "#ffffff" },
};

export function damageMeta(type, lang = "en") {
  const key = String(type || "").toLowerCase().trim();
  const entry = DAMAGE_TYPES[key];
  if (!entry) return { label: key.charAt(0).toUpperCase() + key.slice(1), color: "#aaa" };
  return { label: lang === "es" ? entry.es : entry.en, color: entry.color };
}

export function damageIconHtml(type, size = 14) {
  const key = String(type || "").toLowerCase().replaceAll(/[^a-z]/g, "");
  const cap = key.charAt(0).toUpperCase() + key.slice(1);
  return `<img src="assets/dmg/Dmg${cap}Small64.webp" alt="${cap}" class="dmg-type-icon" style="width:${size}px; height:${size}px;" onerror="this.style.display='none';">`;
}
