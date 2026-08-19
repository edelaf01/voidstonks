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
 * Siguen sin nombre tres stats que sí existen en RIVEN_STATS: `initial_combo`,
 * `heavy_attack_efficiency` y `finisher_damage`. No se inventan: un fragmento equivocado hace
 * que el escáner "corrija" el OCR hacia un nombre que no existe. Un riven con esos stats se
 * nombra hoy con los demás.
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
    "range": { prefix: "Locta", suffix: "tox" },
    "combo_duration": { prefix: "Tempa", suffix: "tis" },
    "critical_chance_on_slide_attack": { prefix: "Pleci", suffix: "ment" },
    "chance_to_gain_extra_combo_count": { prefix: "Pram", suffix: "co" },
    "damage_vs_corpus": { prefix: "Manti", suffix: "tron" },
    "damage_vs_grineer": { prefix: "Argi", suffix: "con" },
    "damage_vs_infested": { prefix: "Pura", suffix: "ada" },
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
