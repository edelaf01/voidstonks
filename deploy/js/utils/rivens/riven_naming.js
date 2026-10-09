import { RIVEN_STATS } from "../../config.js";
import { getRivenStatRange } from "./riven_logic.js";

/**
 * Nombre generado de un riven ("Visi-critacan"): el juego lo compone con un prefijo y un sufijo
 * por cada stat positivo, ordenados por lo fuerte que salió cada tirada.
 *
 * La tabla estaba DUPLICADA en ui_rivens.js y en riven_ocr.service.js, y ya había derivado: la
 * del componente usaba los slugs `melee_range` y `flight_speed`, que NO existen en RIVEN_STATS
 * (los reales son `range` y `projectile_flight_speed`, y solo los tenía la copia del OCR). El
 * efecto: un riven con Alcance o Velocidad de proyectil se nombraba ignorando ese stat, así que
 * el nombre que enseñaba la app no era el del juego.
 *
 * Al extraerla salieron dos claves muertas más, en las DOS copias: `slide_crit_chance` y
 * `combo_count_chance`, que en RIVEN_STATS se llaman `critical_chance_on_slide_attack` y
 * `chance_to_gain_extra_combo_count`. Mismo efecto y mismo arreglo.
 *
 * Por eso el test comprueba que cada clave de aquí exista en RIVEN_STATS: es lo que habría
 * cazado la deriva.
 */
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
    "range": { prefix: "Locti", suffix: "tor" },
    "combo_duration": { prefix: "Tempi", suffix: "nem" },
    "critical_chance_on_slide_attack": { prefix: "Pleci", suffix: "nent" },
    "chance_to_gain_extra_combo_count": { prefix: "Laci", suffix: "nus" },
    "damage_vs_corpus": { prefix: "Manti", suffix: "tron" },
    "damage_vs_grineer": { prefix: "Argi", suffix: "con" },
    "damage_vs_infested": { prefix: "Pura", suffix: "ada" },
    "heavy_attack_efficiency": { prefix: "Forti", suffix: "us" },
    "finisher_damage": { prefix: "Exi", suffix: "cta" },
    "initial_combo": { prefix: "Para", suffix: "um" },
    "weak_point_damage": { prefix: "Eni", suffix: "vo" },
    "weak_point_critical_chance": { prefix: "Exiti", suffix: "eus" },
    "ammo_efficiency": { prefix: "Parci", suffix: "pia" },
    "magazine_reload_when_holstered": { prefix: "Auxi", suffix: "rro" },
    "status_damage": { prefix: "Plaga", suffix: "mna" },
    "gas_damage": { prefix: "Cali", suffix: "fel" },
    "corrosive_damage": { prefix: "Cori", suffix: "or" },
    "viral_damage": { prefix: "Cari", suffix: "sco" },
    "radiation_damage": { prefix: "Radi", suffix: "lo" },
    "blast_damage": { prefix: "Fraga", suffix: "tus" },
    "magnetic_damage": { prefix: "Magni", suffix: "bra" },
    "damage_vs_orokin": { prefix: "Effi", suffix: "tas" },
    "damage_vs_techrot": { prefix: "Muti", suffix: "gia" },
    "damage_vs_scaldra": { prefix: "Exsi", suffix: "llo" },
    "heavy_attack_damage": { prefix: "Robi", suffix: "ndo" },
    "heavy_attack_wind_up_speed": { prefix: "Veri", suffix: "lus" },
    "parry_angle": { prefix: "Defi", suffix: "so" },
    "slam_attack_damage": { prefix: "Proxi", suffix: "lam" },
};

/**
 * Normaliza el nombre de un stat a la forma interna.
 *
 * "Fire Rate / Attack Speed" es un solo stat con dos nombres según el arma: el juego lo llama
 * cadencia en las de fuego y velocidad de ataque en las cuerpo a cuerpo.
 */
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

/**
 * Compone el nombre del riven a partir de sus positivos.
 *
 * Reglas del juego: se ordenan por fuerza de la tirada y según cuántos sean se combinan distinto
 * — con tres, el tercero solo aporta su sufijo y el segundo su prefijo en minúscula.
 *
 * @returns {string} "<arma> <Nombre>", o "" si ningún stat tiene entrada en la tabla.
 */
export function generateRivenName(weaponName, positiveStats, weaponData, buffCount, hasNeg, currentRank) {
    if (!positiveStats || positiveStats.length === 0 || !weaponData) return "";

    const statsWithStrength = positiveStats.map((s) => {
        const internalName = normalizeStatName(s.name, weaponData.t);
        const range = getRivenStatRange(weaponData, internalName, false, buffCount, hasNeg);
        if (!range) return null;

        // La fuerza es el valor relativo al centro del rango PARA ESE RANGO del mod: un 90 % en
        // rango 0 es una tirada mucho mejor que el mismo 90 % en rango 8.
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

    // El más fuerte pone el prefijo; el más débil, el sufijo.
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

/**
 * Firma de identidad de un riven leído: arma + conjunto de stats con su signo.
 *
 * Sirve para el consenso entre frames del escáner: dos lecturas del MISMO riven tienen que
 * dar la misma cadena aunque los VALORES bailen (el OCR de los números es lo que más falla).
 * Por eso van solo los nombres, y ordenados: el orden en que el OCR los saque no importa.
 */
export function rivenFingerprint(parsed) {
    if (!parsed) return "null";
    const stats = parsed.stats.map((st) => `${st.isPositive ? "+" : "-"}${st.name}`).sort().join(",");
    return `${parsed.weaponName || "?"}|${stats}`;
}

// Helper to canonicalize names for matching
export function getCanonicalStatKey(name) {
    if (!name) return "";
    const clean = name.toLowerCase().replaceAll('_', " ").replaceAll('-', " ").trim();
    const fusionado = RIVEN_STATS.find((s) => s.spliced
        && (s.name_en.toLowerCase() === clean || s.slug.replaceAll("_", " ") === clean
            || s.name_en.toLowerCase().replace("weak point", "weakpoint") === clean));
    if (fusionado) return fusionado.slug;
    if (clean.includes("critical chance")) return "critical_chance";
    if (clean.includes("critical damage")) return "critical_damage";
    if (clean.includes("multishot")) return "multishot";
    if (clean.includes("melee range") || clean.includes("range")) return "range";
    if (clean.includes("base damage") || clean.includes("melee damage") || clean === "damage") return "damage";
    if (clean.includes("fire rate") || clean.includes("attack speed") || clean === "speed") return "speed";
    if (clean.includes("status chance")) return "status_chance";
    if (clean.includes("status duration")) return "status_duration";
    if (clean.includes("toxin")) return "toxin";
    if (clean.includes("heat")) return "heat";
    if (clean.includes("electricity") || clean.includes("electric")) return "electricity";
    if (clean.includes("cold")) return "cold";
    if (clean.includes("impact")) return "impact";
    if (clean.includes("puncture")) return "puncture";
    if (clean.includes("slash")) return "slash";
    if (clean.includes("recoil")) return "recoil";
    if (clean.includes("magazine")) return "magazine_capacity";
    if (clean.includes("reload")) return "reload_speed";
    if (clean.includes("ammo")) return "ammo_maximum";
    if (clean.includes("flight") || clean.includes("projectile speed")) return "flight_speed";
    if (clean.includes("zoom")) return "zoom";
    if (clean.includes("punch")) return "punch_through";
    if (clean.includes("combo duration")) return "combo_duration";
    if (clean.includes("slide crit") || clean.includes("slide attack")) return "slide_crit";
    if (clean.includes("extra combo count") || clean.includes("combo count chance") || clean.includes("combo_count_chance")) return "combo_count_chance";
    if (clean.includes("channeling damage") || clean.includes("initial combo")) return "initial_combo";
    if (clean.includes("channeling efficiency") || clean.includes("heavy attack efficiency") || clean.includes("heavy efficiency")) return "heavy_efficiency";
    if (clean.includes("corpus")) return "vs_corpus";
    if (clean.includes("grineer")) return "vs_grineer";
    if (clean.includes("infested")) return "vs_infested";
    return clean;
}
