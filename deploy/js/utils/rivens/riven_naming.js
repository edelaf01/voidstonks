import { RIVEN_STATS } from "../../config.js";
import { getRivenStatRange } from "./riven_logic.js";

export const RIVEN_NAMING_DICT = {
    "critical_chance": { prefix: "Crita", suffix: "cron" },
    "critical_damage": { prefix: "Acri", suffix: "tis" },
    "multishot": { prefix: "Sati", suffix: "can" },
    "base_damage_/_melee_damage": { prefix: "Visi", suffix: "ata" },
    "fire_rate_/_attack_speed": { prefix: "Croni", suffix: "dra" },
    "status_chance": { prefix: "Hexa", suffix: "dex" },
    "status_duration": { prefix: "Deci", suffix: "des" },
    "toxin_damage": { prefix: "Toxi", suffix: "tox" },
    "heat_damage": { prefix: "Igni", suffix: "pha" },
    "electric_damage": { prefix: "Vexi", suffix: "tio" },
    "cold_damage": { prefix: "Geli", suffix: "do" },
    "impact_damage": { prefix: "Magna", suffix: "ton" },
    "puncture_damage": { prefix: "Insi", suffix: "cak" },
    "slash_damage": { prefix: "Sci", suffix: "sus" },
    "weapon_recoil": { prefix: "Zeti", suffix: "mag" },
    "magazine_capacity": { prefix: "Arma", suffix: "tin" },
    "reload_speed": { prefix: "Feva", suffix: "tak" },
    "ammo_maximum": { prefix: "Ampi", suffix: "bin" },
    "projectile_flight_speed": { prefix: "Conci", suffix: "nak" },
    "zoom": { prefix: "Hera", suffix: "lis" },
    "punch_through": { prefix: "Lexi", suffix: "nok" },
    "range": { prefix: "Locta", suffix: "tox" },
    "combo_duration": { prefix: "Tempa", suffix: "tis" },
    "critical_chance_on_slide_attack": { prefix: "Pleci", suffix: "ment" },
    "chance_to_gain_extra_combo_count": { prefix: "Pram", suffix: "co" },
    "damage_vs_corpus": { prefix: "Manti", suffix: "tron" },
    "damage_vs_grineer": { prefix: "Argi", suffix: "con" },
    "damage_vs_infested": { prefix: "Pura", suffix: "ada" },
};

export const normalizeStatName = (name, weaponType = "Rifle") => {
    if (!name) return "";
    const clean = name
        .replaceAll(/\bCrit\b/g, "Critical")
        .replaceAll(/\bDmg\b/g, "Damage")
        .replaceAll(/\bStats\b/g, "Status")
        .trim();

    if (clean === "Fire Rate / Attack Speed") {
        return weaponType === "Melee" ? "Attack Speed" : "Fire Rate";
    }
    return clean;
};

export function generateRivenName(weaponName, positiveStats, weaponData, buffCount, hasNeg, currentRank) {
    if (!positiveStats || positiveStats.length === 0 || !weaponData) return "";

    const statsWithStrength = positiveStats.map((s) => {
        const internalName = normalizeStatName(s.name, weaponData.t);
        const range = getRivenStatRange(weaponData, internalName, false, buffCount, hasNeg);
        if (!range) return null;

        const rankScale = (currentRank + 1) / 9;
        const scaledMid = range.mid * rankScale;
        const strength = Math.abs(s.value) / (scaledMid || 1.0);

        const statDef = RIVEN_STATS.find(
            (r) => normalizeStatName(r.name_en) === internalName || normalizeStatName(r.name_es) === internalName,
        );
        const naming = statDef ? RIVEN_NAMING_DICT[statDef.slug] : null;

        return naming ? { naming, strength } : null;
    }).filter(Boolean);

    if (statsWithStrength.length === 0) return "";

    statsWithStrength.sort((a, b) => b.strength - a.strength);
    const parts = statsWithStrength.map((x) => x.naming);

    let rollName = "";
    if (parts.length === 1) {
        rollName = parts[0].prefix + parts[0].suffix.toLowerCase();
    } else if (parts.length === 2) {
        rollName = parts[0].prefix + parts[1].suffix.toLowerCase();
    } else if (parts.length === 3) {
        rollName = parts[0].prefix + "-" + parts[1].prefix.toLowerCase() + parts[2].suffix.toLowerCase();
    }

    if (!rollName) return "";
    return `${weaponName} ${rollName.charAt(0).toUpperCase() + rollName.slice(1)}`;
}

// values are left out: OCR misreads them most, and two frames of the same riven must match
export function rivenFingerprint(parsed) {
    if (!parsed) return "null";
    const stats = parsed.stats.map((st) => `${st.isPositive ? "+" : "-"}${st.name}`).sort().join(",");
    return `${parsed.weaponName || "?"}|${stats}`;
}
