/**
 * @file ui_vosfor.js
 * @description Módulo de Interfaz y Simulador de Vosfor (Loid Packs).
 * 
 * GUÍA DE MANTENIMIENTO:
 * 1. Para añadir nuevas colecciones de Loid:
 *    - Re-ejecuta `scripts-actu/generar_arcanos_vosfor.py` (regenera
 *      `deploy/assets/json/arcanes_vosfor.json` y descubre packs nuevos solo).
 *    - Registra el sindicato en `PACK_SYNDICATES` más abajo.
 * 2. Para añadir nuevos arcanos sueltos (eventos / fuera de Loid):
 *    - El generador los mete en `arcanes_vosfor.json` -> `others`.
 *    - Añádelos a `CATHEDRALE_ARCANES` o `JADE_CONSTELLATIONS_ARCANES` si aplican.
 * 3. Ver documentación completa en `MAINTENANCE_VOSFOR.md`.
 */

import { state } from "../state.js";
import { TEXTS } from "../config.js";
import { escapeHTML } from "./ui_components.js";
import { JADE_SHADOWS_IMG } from "../assets/jade_custom_img.js";
import {
    loadVosforData,
    requestPackStats,
    requestAllPacks,
    onArcaneStats,
    computePackEV,
    bestPackRate,
    bestBalancedPackRate,
    arcaneVerdict,
    liquidityIndex,
    othersPack,
    calculateVosforInvestment,
    ARC_STATS,
    fetchLiveArcanePrice,
    clearArcaneCacheIDB
} from "../services/vosfor.service.js?v=2.4";

const PLAT = `<img src="assets/relic_contents/platinum.webp" style="width:13px;height:13px;vertical-align:middle;margin-left:2px;">`;

// Caché de resolución de imágenes: guarda la URL que funcionó (evento load) Y también los
// fallos definitivos (evento error con la cadena de fallbacks agotada -> pixel transparente).
// Sin cachear los fallos, cada re-render (slider, goteo de precios) relanzaba las cascadas
// de peticiones de imágenes rotas una y otra vez.
const IMG_SRC_CACHE = new Map();
const IMG_FAIL_PLACEHOLDER = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";

if (typeof window !== "undefined") {
    // Captura (load/error no burbujean): funciona para cualquier <img data-imgkey> insertada vía innerHTML
    document.addEventListener("load", (e) => {
        const el = e.target;
        if (el?.tagName === "IMG" && el.dataset?.imgkey && !IMG_SRC_CACHE.has(el.dataset.imgkey)) {
            IMG_SRC_CACHE.set(el.dataset.imgkey, el.getAttribute("src"));
        }
    }, true);
    document.addEventListener("error", (e) => {
        const el = e.target;
        // onerror === null => la cadena inline ya agotó sus fallbacks: no reintentar nunca más
        if (el?.tagName === "IMG" && el.dataset?.imgkey && el.onerror === null && !IMG_SRC_CACHE.has(el.dataset.imgkey)) {
            IMG_SRC_CACHE.set(el.dataset.imgkey, IMG_FAIL_PLACEHOLDER);
            el.src = IMG_FAIL_PLACEHOLDER;
        }
    }, true);
}

function vosforIcon(size = 15) {
    const style = `width:${size}px;height:${size}px;object-fit:contain;vertical-align:middle;margin-left:2px;filter:drop-shadow(0 1px 3px rgba(0,0,0,0.5));`;
    const cached = IMG_SRC_CACHE.get("vosfor");
    if (cached) return `<img src="${cached}" style="${style}" alt="Vosfor" />`;
    // Asset local primero (descargado de la wiki); externos solo como fallback
    return `<img src="assets/relic_contents/vosfor.webp" data-imgkey="vosfor" onerror="this.onerror=null; this.src='https://warframe.market/static/assets/icons/en/thumbs/vosfor.png';" style="${style}" alt="Vosfor" />`;
}

function salesUnit() {
    return state.currentLang === "es" ? "ventas" : "sales";
}

function creditsIcon(size = 13) {
    const style = `width:${size}px;height:${size}px;object-fit:contain;vertical-align:middle;margin-left:2px;`;
    const cached = IMG_SRC_CACHE.get("credits");
    if (cached) return `<img src="${cached}" style="${style}" alt="cr" />`;
    return `<img src="assets/relic_contents/credits.webp" data-imgkey="credits" onerror="this.onerror=null; this.src='https://wiki.warframe.com/w/Special:FilePath/Credits.png';" style="${style}" alt="cr" />`;
}

// Chip de velocidad de venta de un pack: la métrica de liquidez traducida a lenguaje llano
function sellSpeedChip(avgVolume) {
    const t = vosT();
    const es = state.currentLang === "es";
    let label, css;
    if (avgVolume >= 15) {
        label = t.sellFast || "Venta rápida";
        css = "color:#42f56c;border-color:rgba(66,245,108,0.4);background:rgba(66,245,108,0.08);";
    } else if (avgVolume >= 5) {
        label = t.sellMed || "Venta media";
        css = "color:#e0b040;border-color:rgba(224,176,64,0.4);background:rgba(224,176,64,0.08);";
    } else {
        label = t.sellSlow || "Venta lenta";
        css = "color:#ff8866;border-color:rgba(255,136,102,0.35);background:rgba(255,136,102,0.08);";
    }
    const tip = es
        ? `${avgVolume} ventas/día de media por arcano de esta colección`
        : `${avgVolume} avg daily sales per arcane in this collection`;
    return `<span title="${escapeHTML(tip)}" style="font-size:0.68rem;font-weight:700;border:1px solid;border-radius:4px;padding:1px 6px;${css}">${escapeHTML(label)}</span>`;
}

let vosData = null;
let expandedPack = null;
let expandAllPacks = false;
let unsubscribe = null;
let rerenderTimer = null;
let packSort = "balanced"; // price | rarity | vosfor | liq | balanced
let userVosfor = 600;
let searchQuery = "";
let showGuide = false;
let activeRankTab = "packs"; // "packs" | "sell" | "dissolve" | "liq"
let activeRankSubToggle = "r0"; // "r0" | "rmax"
let rankLimit = 5; // 5 | 10 | 20 | 9999

// Calculator Collection Filter State
let calcSelectedPackId = "auto";

// Target Arcane Simulator State
let targetPackId = "albrechts_laboratories";
let targetArcSlug = "";
let targetCopies = 21;
let targetCustomPacks = null;

// Manual Sell Calculator State
let sellArcSlug = "";
let sellRank = "max"; // "r0" | "max"
let sellQty = 1;
let sellRatePackId = "auto"; // dónde se gastaría el Vosfor: auto (mejor pack) o una colección

const RARITY_ORDER = { LEGENDARY: 3, RARE: 2, UNCOMMON: 1, COMMON: 0 };

const PACK_SYNDICATES = {
    albrechts_laboratories: {
        id: "cavia",
        es: "Cavia (Laboratorios de Albrecht)",
        en: "Cavia (Albrecht's Labs)",
        icon: "pack_albrechts_laboratories.webp",
        wikiIcon: "CaviaArcaneCollection",
    },
    cetus: {
        id: "ostron",
        es: "Ostron (Cetus)",
        en: "Ostron (Cetus)",
        icon: "pack_cetus.webp",
        wikiIcon: "OstronArcaneCollection",
    },
    duviri: {
        id: "duviri",
        es: "Acritis (Duviri)",
        en: "Acritis (Duviri)",
        icon: "pack_duviri.webp",
        wikiIcon: "DuviriArcaneCollection",
    },
    fortuna: {
        id: "solaris",
        es: "Solaris United (Fortuna)",
        en: "Solaris United (Fortuna)",
        icon: "pack_fortuna.webp",
        wikiIcon: "SolarisArcaneCollection",
    },
    hollvania: {
        id: "hex",
        es: "Los Hex (La Cathédrale, Höllvania 1999)",
        en: "The Hex (La Cathédrale, Höllvania 1999)",
        icon: "pack_hollvania.webp",
        wikiIcon: "HöllvaniaArcaneCollection",
    },
    mars_and_deimos: {
        id: "entrati",
        es: "Entrati (Necralisk / Deimos)",
        en: "Entrati (Necralisk / Deimos)",
        icon: "pack_mars_and_deimos.webp",
        wikiIcon: "NecraliskArcaneCollection",
    },
    plains_of_eidolon: {
        id: "quills",
        es: "Los Quills & Eidolons (Llanuras)",
        en: "The Quills & Eidolons (Plains)",
        icon: "pack_plains_of_eidolon.webp",
        wikiIcon: "EidolonArcaneCollection",
    },
    steel_path_and_arbitrations: {
        id: "steel_path",
        es: "Teshin (Camino de Acero & Arbitrajes)",
        en: "Teshin (Steel Path & Arbitrations)",
        icon: "pack_steel_path_and_arbitrations.webp",
        wikiIcon: "SteelArcaneCollection",
    },
    zariman_and_lua: {
        id: "holdfasts",
        es: "Inquebrantables (Zariman)",
        en: "Holdfasts (Zariman)",
        icon: "pack_zariman_and_lua.webp",
        wikiIcon: "HoldfastsArcaneCollection",
    },
    others: {
        id: "others",
        es: "Sindicatos Especiales",
        en: "Special Syndicates",
        icon: "syn_lotus.webp",
        wikiIcon: "Lotus",
    },
};

// Mapeo preciso de arcanos de "Otros" según su fuente exacta
const CATHEDRALE_ARCANES = new Set([
    "primary_bulwark",
    "primary_debilitate",
    "primary_overcharge",
    "arcane_concentration",
    "arcane_expertise",
    "arcane_persistence",
    "arcane_circumvent",
    "melee_careen",
    "secondary_irradiate",
]);

const JADE_CONSTELLATIONS_ARCANES = new Set([
    "primary_compression",
    "arcane_sculptor",
    "secondary_cryogenic",
    "melee_assimilation",
]);

// Arcanos del Artefacto Tektolisto (Marie Leroux, La Cathédrale — quest The Old Peace).
// Fuente propia, no un pack de Loid: van en "others" con su sindicato propio.
const TEKTOLYST_ARCANES = new Set([
    "zid-an-asheir",
    "zid-an-haras",
    "zid-an-sek-eel",
    "zid-an-uskos",
    "zid-an-osbok",
]);

const OTHERS_SYNDICATE_MAP = {
    tektolyst: {
        es: "Artefacto Tektolisto (La Cathédrale)",
        en: "Tektolyst Artifact (La Cathédrale)",
        icon: "pack_tektolyst.webp",
        wikiIcon: "TektolystArtifact", // clave de grupo única (icono real via `icon`)
    },
    cathedrale: {
        es: "La Cathédrale (Höllvania 1999 - Descendencia)",
        en: "La Cathédrale (Höllvania 1999 - Descent)",
        icon: "pack_hollvania.webp",
        wikiIcon: "HöllvaniaArcaneCollection",
    },
    jade_constellations: {
        es: "Sombras de Jade (Constelaciones)",
        en: "Jade Shadows Constellations",
        icon: "jade_shadows.png",
        wikiIcon: "JadeShadowsCustom",
    },
    default: {
        es: "Fuentes Especiales / Eventos",
        en: "Special Sources / Events",
        icon: "syn_lotus.webp",
        wikiIcon: "Lotus",
    },
};

function getArcaneOtherSyndicate(slug) {
    if (TEKTOLYST_ARCANES.has(slug)) return OTHERS_SYNDICATE_MAP.tektolyst;
    if (CATHEDRALE_ARCANES.has(slug)) return OTHERS_SYNDICATE_MAP.cathedrale;
    if (JADE_CONSTELLATIONS_ARCANES.has(slug)) return OTHERS_SYNDICATE_MAP.jade_constellations;
    return OTHERS_SYNDICATE_MAP.default;
}

function syndicateIconHtml(wikiIcon, fallbackImg) {
    if ((fallbackImg && fallbackImg.includes("jade_shadows")) || (wikiIcon && wikiIcon.includes("JadeShadows"))) {
        return `<img src="${JADE_SHADOWS_IMG}" class="vosfor-syndicate-img vosfor-jade-img" alt="Sombras de Jade" />`;
    }
    const key = `syn_${wikiIcon}`;
    const cached = IMG_SRC_CACHE.get(key);
    if (cached) return `<img src="${cached}" class="vosfor-syndicate-img" alt="" />`;
    const local = fallbackImg.includes(".")
        ? `assets/relic_contents/${fallbackImg}`
        : `assets/relic_contents/${fallbackImg}.webp`;

    return `<img src="${local}" data-imgkey="${key}" onerror="this.onerror=null; this.src='assets/relic_contents/forma.webp';" class="vosfor-syndicate-img" alt="" />`;
}

function packIconPath(packId) {
    const syn = PACK_SYNDICATES[packId] || PACK_SYNDICATES.others;
    return `assets/relic_contents/${syn.icon}.webp`;
}

function arcaneImgHtml(slug, name) {
    const key = `arc_${slug}`;
    const cached = IMG_SRC_CACHE.get(key);
    if (cached) return `<img src="${cached}" class="vosfor-arc-img" alt="" loading="lazy" />`;
    const local1 = `assets/relic_contents/${slug}.webp`;
    return `<img src="${local1}" data-imgkey="${key}" onerror="this.onerror=null; this.src='assets/relic_contents/blueprint.webp';" class="vosfor-arc-img" alt="${escapeHTML(name || '')}" loading="lazy" />`;
}

function sortedPackItems(pack) {
    let items = [...pack.items];
    if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        items = items.filter((s) => {
            const meta = vosData.arcanes[s];
            if (!meta) return false;
            const nameEs = (meta.es || "").toLowerCase();
            const nameEn = (meta.en || "").toLowerCase();
            return s.includes(q) || nameEs.includes(q) || nameEn.includes(q);
        });
    }

    const price = (s) => ARC_STATS.get(s)?.pe || 0;
    const vol = (s) => {
        const st = ARC_STATS.get(s);
        return st ? (st.v || 0) + (st.vm || 0) : -1;
    };
    const rar = (s) => RARITY_ORDER[vosData.arcanes[s]?.rarity] ?? -1;
    const vf = (s) => vosData.arcanes[s]?.vosfor || 0;

    if (packSort === "rarity") items.sort((a, b) => rar(b) - rar(a) || price(b) - price(a));
    else if (packSort === "vosfor") items.sort((a, b) => vf(b) - vf(a) || price(b) - price(a));
    else if (packSort === "liq") items.sort((a, b) => vol(b) - vol(a));
    else if (packSort === "balanced") items.sort((a, b) => (price(b) * Math.max(0.5, vol(b))) - (price(a) * Math.max(0.5, vol(a))));
    else items.sort((a, b) => price(b) - price(a) || rar(b) - rar(a));
    return items;
}

function vosT() {
    return (TEXTS[state.currentLang] || {}).vosfor || TEXTS.es.vosfor || {};
}

function packName(pack) {
    return state.currentLang === "es" ? pack.es : pack.en;
}

function arcName(meta) {
    return state.currentLang === "es" ? meta.es : meta.en;
}

const RARITY_STYLE = {
    LEGENDARY: "color:#ffd76e;border-color:rgba(255,215,110,0.45);background:rgba(255,215,110,0.1);",
    RARE: "color:#e8c88a;border-color:rgba(232,200,138,0.4);background:rgba(232,200,138,0.08);",
    UNCOMMON: "color:#dcdcdc;border-color:rgba(220,220,220,0.35);background:rgba(220,220,220,0.08);",
    COMMON: "color:#b8946c;border-color:rgba(184,148,108,0.4);background:rgba(184,148,108,0.08);",
};

function rarityChip(rarity) {
    const t = vosT();
    const lbl = (t.rarities || {})[rarity] || rarity;
    return `<span style="font-size:0.7rem;font-weight:600;border:1px solid;border-radius:4px;padding:1px 5px;${RARITY_STYLE[rarity] || ""}">${escapeHTML(lbl)}</span>`;
}

function arcaneDropProbBadge(slug, parentPack) {
    if (!vosData || !vosData.packs) return "";
    const pack = parentPack || vosData.packs.find((p) => p.items.includes(slug));
    if (!pack || !pack.rolls || !pack.rolls[0]) return "";

    const meta = vosData.arcanes[slug];
    if (!meta) return "";

    const rarity = meta.rarity;
    const sameRarityItems = pack.items.filter((s) => vosData.arcanes[s]?.rarity === rarity);
    const rollProb = pack.rolls[0][rarity] || 0.05;

    const singleProb = rollProb / Math.max(1, sameRarityItems.length);
    const packProb = 1 - Math.pow(1 - singleProb, 3);

    const singlePct = (singleProb * 100).toFixed(1);
    const packPct = (packProb * 100).toFixed(1);

    const titleMsg = state.currentLang === "es"
        ? `Probabilidad: ${singlePct}% por tirada ind. (${packPct}% por pack de 3 arcanos en ${packName(pack)})`
        : `Drop Rate: ${singlePct}% per pull (${packPct}% per Loid pack of 3 in ${packName(pack)})`;

    return `<span title="${escapeHTML(titleMsg)}" style="font-size:0.7rem;font-weight:700;color:#7ecbff;border:1px solid rgba(126,203,255,0.35);border-radius:4px;padding:1px 5px;background:rgba(126,203,255,0.08);cursor:help;">Prob: ${packPct}%/pack</span>`;
}

function liqBadge(slug) {
    const t = vosT();
    const liq = liquidityIndex(slug);
    if (liq.level === "loading") return `<span style="font-size:0.72rem;color:#777;">…</span>`;
    const styles = {
        high: "color:#42f56c;border-color:rgba(66,245,108,0.4);background:rgba(66,245,108,0.1);",
        med: "color:#e0b040;border-color:rgba(224,176,64,0.4);background:rgba(224,176,64,0.1);",
        low: "color:#ff8866;border-color:rgba(255,136,102,0.35);background:rgba(255,136,102,0.08);",
        none: "color:#888;border-color:rgba(130,130,130,0.3);background:rgba(130,130,130,0.08);",
    };
    const labels = { high: t.liqHigh, med: t.liqMed, low: t.liqLow, none: t.liqNone };
    // Un solo chip: nivel + ventas/día. El detalle (desglose por rango y demanda de
    // compradores) va al tooltip en vez de sumar más badges a la fila.
    const es = state.currentLang === "es";
    const tipParts = [`${liq.volume} ${t.salesPerDay || "ventas/día"}`];
    if (liq.maxRank > 0) tipParts.push(`R0: ${liq.volumeR0}/d · R${liq.maxRank}: ${liq.volumeMax}/d`);
    if (liq.demand) tipParts.push(t.demandTip || (es ? "Hay compradores activos pagando cerca del precio de venta" : "Active buyers paying close to the sell price"));
    const demandDot = liq.demand ? ` <span style="color:#7ecbff;">●</span>` : "";
    return `<span title="${escapeHTML(tipParts.join(" · "))}" style="cursor:help;font-size:0.72rem;font-weight:600;border:1px solid;border-radius:4px;padding:1px 5px;${styles[liq.level]}">${escapeHTML(labels[liq.level] || "")} · ${liq.volume}/d${demandDot}</span>`;
}

function verdictBadge(v) {
    const t = vosT();
    if (v.verdict === "loading" || v.verdict === "pending") {
        return `<span style="font-size:0.72rem;color:#888;">…</span>`;
    }
    const map = {
        sell: { txt: t.verdictSell || "VENDER", css: "verdict-sell" },
        dissolve: { txt: t.verdictDissolve || "DISOLVER", css: "verdict-dissolve" },
        even: { txt: t.verdictEven || "PAREJO", css: "verdict-even" },
    };
    const m = map[v.verdict] || map.even;
    return `<span class="verdict-tag ${m.css}">${escapeHTML(m.txt)}</span>`;
}

function verdictR5Badge(vR5) {
    const t = vosT();
    if (vR5 === "loading" || vR5 === "pending") return `<span style="font-size:0.72rem;color:#888;">…</span>`;
    const map = {
        sell_r5: { txt: t.verdictSellR5 || "VENDER R5", css: "verdict-sell" },
        sell_r0: { txt: t.verdictSellR0 || "VENDER R0", css: "verdict-sell" },
        dissolve: { txt: t.verdictDissolve || "DISOLVER 21", css: "verdict-dissolve" },
        even: { txt: t.verdictEven || "PAREJO", css: "verdict-even" },
    };
    const m = map[vR5] || map.even;
    return `<span class="verdict-tag ${m.css}">${escapeHTML(m.txt)}</span>`;
}

function fmtRate(rate) {
    return rate >= 0.1 ? rate.toFixed(2) : rate.toFixed(3);
}

function rankingMedal(index) {
    if (index === 0) return `<span class="vosfor-rank-medal vosfor-rank-gold">#1</span>`;
    if (index === 1) return `<span class="vosfor-rank-medal vosfor-rank-silver">#2</span>`;
    if (index === 2) return `<span class="vosfor-rank-medal vosfor-rank-bronze">#3</span>`;
    return `<span class="vosfor-rank-medal vosfor-rank-num">#${index + 1}</span>`;
}

function getDissolveTip(v, t, meta) {
    if (!v || v.dissolvePlat === undefined || v.dissolvePlat === null) return "";
    const packName = state.currentLang === "es" ? v.bestPackEs : v.bestPackEn;
    const template = t.dissolveSpentTip || (state.currentLang === "es"
        ? "Disolver destruye el arcano y te da {vosfor} Vosfor. Gastado en packs de {pack} rinde de media ~{plat} pl, pero es una apuesta."
        : "Dissolving destroys the arcane and gives you {vosfor} Vosfor. Spent on {pack} packs it averages ~{plat} pl, but it's a gamble.");
    return template
        .replace("{vosfor}", meta?.vosfor ?? "")
        .replace("{plat}", v.dissolvePlat.toFixed(1))
        .replace("{pack}", packName || (state.currentLang === "es" ? "el mejor pack" : "the best pack"));
}

function binomialGe(n, kNeeded, p) {
    if (n < kNeeded) return 0;
    let sumBelow = 0;
    let term = Math.pow(1 - p, n);
    sumBelow += term;
    for (let i = 1; i < kNeeded; i++) {
        term = term * ((n - i + 1) / i) * (p / Math.max(1e-9, 1 - p));
        sumBelow += term;
    }
    const prob = Math.max(0, 1 - sumBelow);
    return Math.min(1, prob);
}

function calculateR5Realism(vosforAmount, pack, data) {
    if (!vosforAmount || vosforAmount < 200 || !pack || !data) return null;
    const pulls = Math.floor(vosforAmount / (pack.cost?.vosfor || 200));
    const totalRolls = pulls * 3;

    const rollsMap = pack.rolls && pack.rolls[0] ? pack.rolls[0] : { LEGENDARY: 0.05, RARE: 0.15, UNCOMMON: 0.30, COMMON: 0.50 };

    const results = {};
    for (const rarity of ["LEGENDARY", "RARE", "UNCOMMON", "COMMON"]) {
        const sameRarityItems = pack.items.filter((s) => data.arcanes[s]?.rarity === rarity);
        if (sameRarityItems.length === 0) {
            results[rarity] = {
                expected: "0.0",
                probPct: "0.0",
                probRaw: 0,
                itemCount: 0,
            };
            continue;
        }

        const count = sameRarityItems.length;
        const rarityRollProb = (rollsMap[rarity] !== undefined && rollsMap[rarity] !== null) ? rollsMap[rarity] : 0.05;
        const singleProb = rarityRollProb / count;

        const expectedCopies = totalRolls * singleProb;
        const probR5 = binomialGe(totalRolls, 21, singleProb);

        let probPctFormatted = "0.0";
        if (probR5 >= 1) probPctFormatted = "100.0";
        else if (probR5 <= 0) probPctFormatted = "0.0";
        else {
            const pct = probR5 * 100;
            if (pct >= 99.95) probPctFormatted = ">99.9";
            else if (pct <= 0.05) probPctFormatted = "<0.1";
            else probPctFormatted = pct.toFixed(1);
        }

        results[rarity] = {
            expected: expectedCopies.toFixed(1),
            probPct: probPctFormatted,
            probRaw: probR5,
            itemCount: count,
        };
    }

    return { pulls, totalRolls, results };
}

function rankingLeaderboardCard(bestRate) {
    const t = vosT();
    if (!vosData) return "";

    const tabBtn = (id, lbl) => {
        const on = activeRankTab === id;
        return `<button class="vosfor-ranking-nav-btn ${on ? "active" : ""}" onclick="setVosforRankTab('${id}')">${escapeHTML(lbl)}</button>`;
    };

    const limitBtn = (num, lbl) => {
        const on = rankLimit === num;
        return `<button class="vosfor-ranking-nav-btn ${on ? "active" : ""}" style="padding:2px 8px;font-size:0.72rem;" onclick="setVosforRankLimit(${num})">${escapeHTML(lbl)}</button>`;
    };

    const nav = `
      <div class="vosfor-ranking-nav">
        ${tabBtn("packs", t.rankTabPacks || "Colecciones de Loid")}
        ${tabBtn("sell", state.currentLang === "es" ? "Venta en Platino" : "Platinum Sales")}
        ${tabBtn("dissolve", t.rankTabDissolve || "Rinden al Disolver")}
        ${tabBtn("liq", t.rankTabLiq || "Los Más Vendidos")}
      </div>`;

    const subToggleBtn = (id, lbl) => {
        const on = activeRankSubToggle === id;
        return `<button class="vosfor-ranking-nav-btn ${on ? "active" : ""}" style="padding:2px 8px;font-size:0.75rem;border-radius:4px;" onclick="setVosforRankSubToggle('${id}')">${escapeHTML(lbl)}</button>`;
    };

    let subToggleHtml = "";
    if (activeRankTab === "sell") {
        subToggleHtml = `
          <div class="vosfor-ranking-nav" style="margin-top:6px;gap:4px;justify-content:center;">
            <span style="font-size:0.75rem;color:#aaa;margin-right:4px;">${state.currentLang === "es" ? "Modo:" : "Mode:"}</span>
            ${subToggleBtn("r0", state.currentLang === "es" ? "Copia Suelta (R0)" : "Single Copy (R0)")}
            ${subToggleBtn("rmax", state.currentLang === "es" ? "Rango Máximo" : "Max Rank")}
          </div>
        `;
    }

    const limitNav = `
      ${subToggleHtml}
      <div class="vosfor-ranking-nav" style="margin-left:auto;margin-top:6px;">
        ${limitBtn(5, t.rankShowTop5 || "TOP 5")}
        ${limitBtn(10, t.rankShowTop10 || "TOP 10")}
        ${limitBtn(20, t.rankShowTop20 || "TOP 20")}
        ${limitBtn(9999, t.rankShowAll || "Ver Todos")}
      </div>`;

    let rowsHtml = "";

    if (activeRankTab === "packs") {
        const sortedPacks = [...vosData.packs]
            .map((p) => ({ pack: p, ev: computePackEV(p, vosData.arcanes) }))
            .filter((p) => p.ev.ready)
            .sort((a, b) => b.ev.platPerVosfor - a.ev.platPerVosfor)
            .slice(0, rankLimit);

        rowsHtml = sortedPacks.map(({ pack, ev }, idx) => {
            const syn = PACK_SYNDICATES[pack.id] || PACK_SYNDICATES.others;
            const subText = state.currentLang === "es"
                ? `Ganas ~${ev.evPlat}${PLAT} por pack (200${vosforIcon(12)}) · ${ev.avgVolume} ventas/día`
                : `Earn ~${ev.evPlat}${PLAT} per pack (200${vosforIcon(12)}) · ${ev.avgVolume} sales/day`;
            return `
              <div class="vosfor-ranking-row" onclick="toggleVosforPack('${pack.id}')" style="cursor:pointer;">
                ${rankingMedal(idx)}
                ${syndicateIconHtml(syn.wikiIcon, syn.icon)}
                <div class="vosfor-rank-info">
                  <div class="vosfor-rank-name">${escapeHTML(packName(pack))}</div>
                  <div class="vosfor-rank-sub">${subText}</div>
                </div>
                <div class="vosfor-rank-stat">
                  <div class="vosfor-rank-val">${fmtRate(ev.platPerVosfor)} <span style="font-size:0.75rem;font-weight:normal;color:#aaa;">${PLAT} / ${vosforIcon()}</span></div>
                </div>
              </div>`;
        }).join("");

    } else {
        // activeRankTab is "sell", "dissolve", or "liq"
        const es = state.currentLang === "es";

        const loadedArcanes = Object.keys(vosData.arcanes)
            .filter((slug) => ARC_STATS.has(slug))
            .map((slug) => {
                const meta = vosData.arcanes[slug];
                const st = ARC_STATS.get(slug);
                const v = arcaneVerdict(slug, vosData.arcanes, bestRate);
                const liq = liquidityIndex(slug);
                return { slug, meta, st, v, liq, vosfor: meta.vosfor || 0 };
            })
            .filter((item) => {
                if (activeRankTab === "sell") {
                    return activeRankSubToggle === "rmax" ? item.v.sellR5 > 0 : item.v.sell > 0;
                }
                return true; // dissolve and liq allow all valid stats
            });

        const rarities = ["LEGENDARY", "RARE", "UNCOMMON", "COMMON"];
        const rarityNamesEs = { LEGENDARY: "Legendarios", RARE: "Raros", UNCOMMON: "Poco Comunes", COMMON: "Comunes" };
        const rarityNamesEn = { LEGENDARY: "Legendaries", RARE: "Rares", UNCOMMON: "Uncommons", COMMON: "Commons" };
        const rarityColors = { LEGENDARY: "#d4af37", RARE: "#c59afc", UNCOMMON: "#aaccff", COMMON: "#cdcdcd" };

        rowsHtml = "";

        for (const rarity of rarities) {
            const filteredByRarity = loadedArcanes.filter(item => item.meta.rarity === rarity);
            if (filteredByRarity.length === 0) continue;

            filteredByRarity.sort((a, b) => {
                if (activeRankTab === "sell") {
                    if (activeRankSubToggle === "rmax") return b.v.sellR5 - a.v.sellR5;
                    return b.v.sell - a.v.sell;
                }
                if (activeRankTab === "dissolve") return b.vosfor - a.vosfor;
                if (activeRankTab === "liq") return b.liq.volume - a.liq.volume;
                return 0;
            });

            const limitedList = filteredByRarity.slice(0, rankLimit);
            if (limitedList.length === 0) continue;

            const catName = es ? rarityNamesEs[rarity] : rarityNamesEn[rarity];
            const catColor = rarityColors[rarity];

            rowsHtml += `
              <div class="vosfor-rarity-header" style="color:${catColor}; border-bottom:1px solid ${catColor}40; padding-bottom:4px; margin-top:12px; margin-bottom:8px; font-weight:bold; font-size:0.9rem; text-transform:uppercase; letter-spacing:1px; text-shadow: 0 1px 2px rgba(0,0,0,0.8);">
                ${catName}
              </div>
            `;

            rowsHtml += limitedList.map(({ slug, meta, st, v, liq, vosfor }, idx) => {
                let subText = "";
                let mainVal = "";
                let mainValStyle = "";
                let extraNameHtml = "";

                if (activeRankTab === "sell") {
                    if (activeRankSubToggle === "rmax") {
                        const maxR = v.maxRank;
                        const copiesMax = v.copiesMax;
                        const bonusText = v.r5RankBonus > 0
                            ? (es ? ` (+${v.r5RankBonus}% en R${maxR})` : ` (+${v.r5RankBonus}% at R${maxR})`)
                            : (v.r5RankBonus < 0 ? (es ? ` (${v.r5RankBonus}% en R${maxR})` : ` (${v.r5RankBonus}% at R${maxR})`) : "");
                        subText = es
                            ? `Copia suelta R0: ${v.sell}${PLAT} · ${copiesMax} copias R0: ${v.sell21R0}${PLAT}${bonusText}`
                            : `Single copy R0: ${v.sell}${PLAT} · ${copiesMax} copies R0: ${v.sell21R0}${PLAT}${bonusText}`;
                        mainVal = `${v.sellR5}${PLAT} <span style="font-size:0.72rem;color:#aaa;">(R${maxR})</span>`;
                    } else {
                        const maxR = v.maxRank;
                        const bonusText = v.r5RankBonus > 0
                            ? (es ? ` (Rinde más en R${maxR}: +${v.r5RankBonus}%)` : ` (Better at R${maxR}: +${v.r5RankBonus}%)`)
                            : (v.r5RankBonus < 0 ? (es ? ` (Cuidado: pierdes ${Math.abs(v.r5RankBonus)}% al subir a R${maxR})` : ` (Warning: lose ${Math.abs(v.r5RankBonus)}% when upgrading to R${maxR})`) : "");
                        subText = es
                            ? `Volumen: ${v.volume || v.st?.pe_vol || 0} ventas/día${bonusText}`
                            : `Volume: ${v.volume || v.st?.pe_vol || 0} sales/day${bonusText}`;
                        mainVal = `${v.sell}${PLAT} <span style="font-size:0.72rem;color:#aaa;">(R0)</span>`;
                    }
                } else if (activeRankTab === "dissolve") {
                    const maxRank = Math.min(meta.maxRank ?? 5, 5);
                    const copiesMax = v.copiesMax || (((maxRank + 1) * (maxRank + 2)) / 2);
                    const price = st?.pe || 0;

                    const priceTxt = st
                        ? (price > 0
                            ? `R0: ${price}${PLAT}`
                            : escapeHTML(t.noMarket || "sin mercado"))
                        : "…";
                    const liqTxt = st
                        ? `${liq.volume}/${es ? "día" : "day"}`
                        : "…";
                    const equivTxt = v.dissolvePlat !== null && v.dissolvePlat !== undefined
                        ? ` · ≈ ${v.dissolvePlat.toFixed(1)}${PLAT}`
                        : "";
                    subText = `${priceTxt} · ${es ? "liquidez" : "liquidity"}: ${liqTxt} · R${maxRank} max (${copiesMax}x = ${vosfor * copiesMax}${vosforIcon(12)})${equivTxt}`;

                    const liqWarn = st && liq.level === "low" || (st && liq.level === "none")
                        ? ` <span style="font-size:0.62rem;color:#ff8866;border:1px solid rgba(255,136,102,0.35);border-radius:3px;padding:0 4px;">${es ? "POCA LIQUIDEZ" : "LOW LIQUIDITY"}</span>`
                        : "";

                    extraNameHtml = liqWarn;
                    mainVal = `${vosfor}${vosforIcon()}`;
                    mainValStyle = "color:#c59afc;";
                } else if (activeRankTab === "liq") {
                    const rankSplit = liq.maxRank > 0
                        ? `R0: ${liq.volumeR0}/d · R${liq.maxRank}: ${liq.volumeMax}/d`
                        : `R0: ${liq.volumeR0}/d`;
                    subText = `${rankSplit}`;

                    const valText = es
                        ? `${liq.volume} ventas/día`
                        : `${liq.volume} sales/day`;
                    mainVal = escapeHTML(valText);
                    mainValStyle = "color:#7ecbff;";
                }

                return `
                  <div class="vosfor-ranking-row">
                    ${rankingMedal(idx)}
                    ${arcaneImgHtml(slug, arcName(meta))}
                    <div class="vosfor-rank-info">
                      <div class="vosfor-rank-name">
                        <a href="https://warframe.market/items/${escapeHTML(slug)}" target="_blank" rel="noopener noreferrer" style="color:inherit;text-decoration:none;" title="${es ? "Ver en Warframe Market" : "View on Warframe Market"}" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">${escapeHTML(arcName(meta))}</a>${extraNameHtml}
                      </div>
                      <div class="vosfor-rank-sub">${subText}</div>
                    </div>
                    <div class="vosfor-rank-stat">
                      <div class="vosfor-rank-val" style="${mainValStyle}">${mainVal}</div>
                    </div>
                  </div>`;
            }).join("");
        }
    }

    return `
    <div class="vosfor-ranking-section">
      <div class="vosfor-ranking-header">
        <div class="vosfor-ranking-title">${escapeHTML(t.rankingTitle || "Ranking de Rentabilidad")}</div>
        ${nav}
        ${limitNav}
      </div>
      <div class="vosfor-ranking-grid">${rowsHtml || `<div style="padding:10px;color:#888;font-size:0.84rem;">${state.currentLang === "es" ? "Cargando datos de ranking…" : "Loading ranking data…"}</div>`}</div>
    </div>`;
}

function getTradeFrictionNote(pulls, t) {
    const totalItems = pulls * 3;
    const r5Trades = Math.max(1, Math.round(totalItems / 21));
    const template = t.tradeFrictionNote || (state.currentLang === "es"
        ? "{items} arcanos sueltos consumen {trades} trades diarios si vendes en R0 (ó ~{r5Trades} trade consolidando en R5)."
        : "{items} loose arcanes require {trades} daily trades if sold at R0 (or ~{r5Trades} trade if consolidated to R5).");
    return template
        .replace("{items}", totalItems)
        .replace("{trades}", totalItems)
        .replace("{r5Trades}", r5Trades);
}

function renderR5RealismHtml(pack, userVosfor, t) {
    if (!pack || !vosData) return "";
    const realism = calculateR5Realism(userVosfor, pack, vosData);
    if (!realism) return "";

    const pulls = realism.pulls;
    const noteText = (t.r5RealismNote || "Copias esperadas y probabilidad de completar un R5 con tus {vosfor} Vosfor ({pulls} tiradas):")
        .replace("{vosfor}", userVosfor.toLocaleString())
        .replace("{pulls}", pulls.toLocaleString());

    const isLegendaryUnlikely = realism.results.LEGENDARY && realism.results.LEGENDARY.itemCount > 0 ? realism.results.LEGENDARY.probRaw < 0.1 : false;
    const rName = (r) => (t.rarities || {})[r] || r;
    const r5ProbText = t.r5ProbLabel || "Prob. R5";
    const copyText = t.targetSimCopies || "copias";

    const renderCell = (rarity, color, bg, border) => {
        const res = realism.results[rarity];
        if (!res || res.itemCount === 0) {
            return "";
        }
        return `
        <div style="background:${bg};border:1px solid ${border};border-radius:4px;padding:6px;color:${color};">
          <b>${escapeHTML(rName(rarity))}:</b> ~${res.expected} ${escapeHTML(copyText)}<br/>
          <span style="color:${res.probRaw > 0.5 ? "#42f56c" : "#ff8888"}; font-weight:700;">${escapeHTML(r5ProbText)}: ${res.probPct}%</span>
        </div>`;
    };

    // Detalle avanzado: plegado por defecto (native <details>, sin JS extra) para no
    // saturar la calculadora — la recomendación principal ya está en las tarjetas.
    return `
    <details style="background:rgba(0,0,0,0.4);border:1px solid rgba(255,215,110,0.3);border-radius:6px;padding:8px 12px;margin-top:10px;">
      <summary style="font-weight:700;color:#ffd76e;font-size:0.82rem;cursor:pointer;list-style-position:inside;">
        ${escapeHTML(t.r5RealismTitle || "Realismo de Rango 5 (21 Copias)")}
        ${isLegendaryUnlikely ? `<span style="font-size:0.68rem;color:#ff8888;font-weight:600;margin-left:6px;">${state.currentLang === "es" ? "(R5 legendario inviable con tu Vosfor)" : "(legendary R5 not feasible with your Vosfor)"}</span>` : ""}
      </summary>
      <div style="font-size:0.76rem;color:#ccc;margin:8px 0;">
        ${escapeHTML(noteText)}
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(130px, 1fr));gap:6px;font-size:0.75rem;">
        ${renderCell("LEGENDARY", "#ffd76e", "rgba(255,215,110,0.08)", "rgba(255,215,110,0.25)")}
        ${renderCell("RARE", "#e8c88a", "rgba(232,200,138,0.08)", "rgba(232,200,138,0.25)")}
        ${renderCell("UNCOMMON", "#dcdcdc", "rgba(220,220,220,0.08)", "rgba(220,220,220,0.25)")}
        ${renderCell("COMMON", "#b8946c", "rgba(184,148,108,0.08)", "rgba(184,148,108,0.25)")}
      </div>
      ${isLegendaryUnlikely ? `<div style="font-size:0.74rem;color:#ff8888;margin-top:6px;line-height:1.3;">${escapeHTML(t.r5PracticalAdvice || "Consejo Práctico: Con tu Vosfor actual es matemáticamente casi imposible completar un R5 de alta rareza. Te conviene vender o disolver las copias R0 sueltas.")}</div>` : ""}
    </details>`;
}

// Los sliders disparan esto muchas veces por segundo: SOLO se reconstruye el HTML (con sus
// <img>) cuando cambia la estructura (qué packs se muestran). En el resto de ticks se
// actualizan únicamente los nodos de texto, sin tocar ninguna imagen.
let lastCalcSignature = null;

function calcCardHtml(kind, entry, t) {
    const syn = PACK_SYNDICATES[entry.pack.id] || PACK_SYNDICATES.others;
    const tags = {
        custom: { css: "highlight", color: "#7ecbff", label: state.currentLang === "es" ? "SIMULACIÓN DE COLECCIÓN SELECCIONADA" : "SELECTED COLLECTION SIMULATION" },
        ev: { css: "highlight", color: "#42f56c", label: t.maxPlatTitle || "MÁXIMO PLAT (EV)" },
        liq: { css: "highlight-liquid", color: "#7ecbff", label: t.maxLiquidTitle || "VENTA RÁPIDA (LIQUIDEZ)" },
    };
    const cfg = tags[kind];
    // Los iconos van FUERA de los spans de texto para que el patch (textContent) no los toque
    const subIcon = kind === "custom"
        ? `<span data-f="subA"></span>${creditsIcon()}<span data-f="subB"></span>${vosforIcon()}<span data-f="subC"></span>`
        : kind === "ev"
            ? `<span data-f="subA"></span>${vosforIcon()}<span data-f="subB"></span>`
            : "";
    return `
      <div class="vosfor-calc-card ${cfg.css}" data-card="${kind}">
        <div class="vosfor-calc-card-row">
          ${syndicateIconHtml(syn.wikiIcon, syn.icon)}
          <div class="vosfor-calc-card-body">
            <div class="vosfor-calc-card-tag" style="color:${cfg.color};">${escapeHTML(cfg.label)}</div>
            <div class="vosfor-calc-card-name">${escapeHTML(packName(entry.pack))}</div>
          </div>
        </div>
        <div class="vosfor-calc-card-stat"><span class="vosfor-calc-card-stat-label">${escapeHTML(t.projectedPlat || "Platino Proyectado")}:</span><span data-f="est"></span>${PLAT}</div>
        <div class="vosfor-calc-card-sub">${kind === "liq" ? `<span data-f="subA"></span>` : subIcon}</div>
        <div class="vosfor-calc-card-trade">
          <b>${escapeHTML(t.tradeFrictionLabel || "Fricción de Intercambios")}:</b> <span data-f="trade"></span>
        </div>
      </div>`;
}

function patchCalcCard(box, kind, entry, t) {
    const card = box.querySelector(`[data-card="${kind}"]`);
    if (!card || !entry) return;
    const set = (f, txt) => {
        const el = card.querySelector(`[data-f="${f}"]`);
        if (el) el.textContent = txt;
    };
    const pulls = entry.pulls;
    const creditsK = pulls * 50;
    const crTxt = creditsK >= 1000 ? `${(creditsK / 1000).toFixed(1)}M` : `${creditsK}k`;
    set("est", entry.estPlat.toLocaleString());
    if (kind === "custom") {
        set("subA", `${pulls.toLocaleString()} ${t.pullsUnit || "tiradas"} (${(pulls * 3).toLocaleString()} ${t.arcanes || "arcanos"}) · ${crTxt}`);
        set("subB", ` · ${fmtRate(entry.ev.platPerVosfor)} pl/`);
        set("subC", ` · ${entry.ev.avgVolume}/d ${salesUnit()}`);
    } else if (kind === "ev") {
        set("subA", `${pulls} ${t.pullsUnit || "tiradas"} (${pulls * 3} ${t.arcanes || "arcanos"}) · ${fmtRate(entry.ev.platPerVosfor)} pl/`);
        set("subB", "");
    } else {
        set("subA", `${pulls} ${t.pullsUnit || "tiradas"} (${pulls * 3} ${t.arcanes || "arcanos"}) · ${entry.ev.avgVolume}/d ${salesUnit()}`);
    }
    set("trade", getTradeFrictionNote(pulls, t));
}

function updateCalculatorWidgetDOM() {
    const box = document.getElementById("vosfor-calc-results-box");
    const inputField = document.getElementById("vosfor-input-field");
    const sliderField = document.getElementById("vosfor-calc-slider");

    if (inputField && document.activeElement !== inputField) {
        inputField.value = userVosfor;
    }
    if (sliderField) {
        // Max dinámico: si el usuario teclea más Vosfor del rango, el slider se adapta
        if (userVosfor > parseInt(sliderField.max, 10)) {
            sliderField.max = Math.ceil(userVosfor * 1.5 / 200) * 200;
        }
        if (document.activeElement !== sliderField) sliderField.value = userVosfor;
    }

    if (!box || !vosData) return;

    const t = vosT();
    const calc = calculateVosforInvestment(userVosfor, vosData, calcSelectedPackId);

    const isCustom = calc && calcSelectedPackId !== "auto" && calc.customPack;
    const hasAuto = calc && !isCustom && (calc.bestEvPack || calc.bestLiquidPack);
    const realismPack = isCustom ? calc.customPack.pack : hasAuto ? (calc.bestEvPack || calc.bestLiquidPack).pack : null;

    // Firma estructural: si no cambia, no se reconstruye ni una sola <img>
    const signature = [
        isCustom ? "c:" + calc.customPack.pack.id : "",
        hasAuto && calc.bestEvPack ? "e:" + calc.bestEvPack.pack.id : "",
        hasAuto && calc.bestLiquidPack ? "l:" + calc.bestLiquidPack.pack.id : "",
        state.currentLang,
    ].join("|");

    if (signature !== lastCalcSignature || !box.firstElementChild) {
        lastCalcSignature = signature;
        let html = "";
        if (isCustom) {
            html = calcCardHtml("custom", calc.customPack, t);
        } else if (hasAuto) {
            html = (calc.bestEvPack ? calcCardHtml("ev", calc.bestEvPack, t) : "")
                + (calc.bestLiquidPack ? calcCardHtml("liq", calc.bestLiquidPack, t) : "");
        } else {
            html = `<div style="font-size:0.84rem;color:#888;padding:8px 0;">${escapeHTML(t.summaryLoading || "Cargando precios para simular…")}</div>`;
        }
        // El bloque de realismo R5 no contiene imágenes: puede reconstruirse siempre
        box.innerHTML = html + `<div data-f="realism"></div>`;
    }

    if (isCustom) patchCalcCard(box, "custom", calc.customPack, t);
    if (hasAuto) {
        patchCalcCard(box, "ev", calc.bestEvPack, t);
        patchCalcCard(box, "liq", calc.bestLiquidPack, t);
    }
    const realismBox = box.querySelector(`[data-f="realism"]`);
    if (realismBox) realismBox.innerHTML = realismPack ? renderR5RealismHtml(realismPack, userVosfor, t) : "";
}

export function onVosforCalcPackChange(packId) {
    calcSelectedPackId = packId || "auto";
    updateCalculatorWidgetDOM();
}

// Probabilidades reales (binomial) de conseguir el arcano objetivo en los packs estimados:
// la media lineal dice cuántos packs necesitas "en promedio", esto dice con qué certeza.
function targetSimProbabilities(packsNeeded, rollProb, sameRarityCount, copiesWanted) {
    const singleProb = rollProb / Math.max(1, sameRarityCount);
    const totalRolls = packsNeeded * 3;
    const pAtLeastOne = 1 - Math.pow(1 - singleProb, totalRolls);
    const pTarget = binomialGe(totalRolls, copiesWanted, singleProb);

    const formatPct = (p) => {
        if (p >= 1) return "100.0";
        if (p <= 0) return "0.0";
        const pct = p * 100;
        if (pct >= 99.95) return ">99.9";
        if (pct <= 0.05) return "<0.1";
        return pct.toFixed(1);
    };

    return {
        pAtLeastOnePct: formatPct(pAtLeastOne),
        pTargetPct: formatPct(pTarget),
    };
}

function targetProbHtml(packsNeeded, rollProb, sameRarityCount, t) {
    const probs = targetSimProbabilities(packsNeeded, rollProb, sameRarityCount, targetCopies);
    const expectedCopies = ((packsNeeded * 3) * (rollProb / Math.max(1, sameRarityCount))).toFixed(1);

    const es = state.currentLang === "es";
    const dupNote = es
        ? "Las 3 tiradas de cada pack son independientes (pueden repetirse)."
        : "The 3 rolls per pack are independent (can repeat).";

    return `
      <div style="margin-bottom:8px;font-size:0.8rem;color:#e0e0e0;">
        ${es ? `Obtendrás de media <b style="color:#ffd76e;">~${expectedCopies} copias</b> del arcano objetivo.` : `You will get <b style="color:#ffd76e;">~${expectedCopies} copies</b> on average.`}
      </div>
      <div style="background:rgba(0,0,0,0.25);border:1px solid rgba(255,255,255,0.05);border-radius:6px;padding:8px 10px;">
        <div style="font-weight:700;color:#aaa;margin-bottom:4px;font-size:0.72rem;text-transform:uppercase;">${es ? "Desglose de Probabilidad (Binomial):" : "Probability Breakdown (Binomial):"}</div>
        <ul style="margin:0;padding-left:18px;margin-bottom:6px;color:#ccc;">
          <li>${es ? `<b style="color:#42f56c;">${probs.pAtLeastOnePct}%</b> de sacar al menos 1 copia` : `<b style="color:#42f56c;">${probs.pAtLeastOnePct}%</b> chance of at least 1 copy`}</li>
          <li>${es ? `<b style="color:${parseFloat(probs.pTargetPct) >= 50 ? "#42f56c" : "#ff8888"};">${probs.pTargetPct}%</b> de lograr las ${targetCopies} copias` : `<b style="color:${parseFloat(probs.pTargetPct) >= 50 ? "#42f56c" : "#ff8888"};">${probs.pTargetPct}%</b> chance of reaching ${targetCopies} copies`}</li>
        </ul>
        <div style="font-size:0.7rem;color:#888;">${dupNote}</div>
      </div>
    `;
}

function updateTargetSimDOM() {
    const container = document.getElementById("vosfor-target-widget");
    if (!container || !vosData) {
        renderVosforTab();
        return;
    }

    const t = vosT();
    const curPack = vosData.packs.find((p) => p.id === targetPackId) || vosData.packs[0];
    if (!targetArcSlug || !curPack.items.includes(targetArcSlug)) {
        targetArcSlug = curPack.items[0];
    }

    const targetMeta = vosData.arcanes[targetArcSlug];
    const targetRarity = targetMeta?.rarity || "COMMON";

    const sameRarityItems = curPack.items.filter((s) => vosData.arcanes[s]?.rarity === targetRarity);
    const rollProb = curPack.rolls && curPack.rolls[0] ? (curPack.rolls[0][targetRarity] || 0.05) : 0.05;

    const copiesPerPack = (3 * rollProb) / Math.max(1, sameRarityItems.length);
    const defaultPacksNeeded = Math.ceil(targetCopies / Math.max(0.0001, copiesPerPack));
    const packsNeeded = targetCustomPacks !== null ? targetCustomPacks : defaultPacksNeeded;
    const pullsNeeded = packsNeeded * 3;
    const vosforNeeded = packsNeeded * (curPack.cost?.vosfor || 200);
    const creditsNeeded = packsNeeded * (curPack.cost?.credits || 50000);

    const targetArcName = targetMeta ? arcName(targetMeta) : "";
    const copyUnit = targetCopies === 1 ? (t.targetSimCopy || "copia") : (t.targetSimCopies || "copias");
    const maxR = targetMeta ? (targetMeta.maxRank ?? 5) : 5;
    const copiesMax = ((maxR + 1) * (maxR + 2)) / 2;
    const rankLabel = targetCopies === copiesMax ? `(${t.targetSimRank5 || "Rango " + maxR})` : targetCopies === 1 ? `(${t.targetSimRank0 || "Rango 0"})` : "";
    const rarityLabel = (t.rarities || {})[targetRarity] || targetRarity;

    const explainRaw = targetCustomPacks !== null
        ? (state.currentLang === "es"
            ? "Con <b>{packs} packs de Loid</b> ({pulls} arcanos) en {pack}, tu probabilidad de conseguir <b>{qty}x {arcane}</b> ({rarity}) es:"
            : "With <b>{packs} Loid packs</b> ({pulls} arcanes) in {pack}, your chance to obtain <b>{qty}x {arcane}</b> ({rarity}) is:")
        : (t.targetSimExplanation || (state.currentLang === "es"
            ? "Para conseguir <b>{qty}x {arcane}</b> ({rarity}) en {pack}, necesitas en promedio <b>{packs} packs</b> ({pulls} tiradas)."
            : "To obtain <b>{qty}x {arcane}</b> ({rarity}) in {pack}, you need on average <b>{packs} packs</b> ({pulls} pulls)."));

    const explainText = explainRaw
        .replace("{qty}", targetCopies)
        .replace("{arcane}", escapeHTML(targetArcName))
        .replace("{rarity}", escapeHTML(rarityLabel))
        .replace("{pack}", escapeHTML(packName(curPack)))
        .replace("{packs}", packsNeeded.toLocaleString())
        .replace("{pulls}", pullsNeeded.toLocaleString());

    const qtyBadge = document.getElementById("target-qty-badge");
    if (qtyBadge) qtyBadge.textContent = `${targetCopies} ${copyUnit} ${rankLabel}`;

    const slider = document.getElementById("target-copies-slider");
    if (slider && document.activeElement !== slider) slider.value = targetCopies;

    // Solo texto: la <img> del icono de Vosfor del esqueleto no se toca
    const valVosforNum = document.getElementById("target-val-vosfor-num");
    if (valVosforNum) valVosforNum.textContent = vosforNeeded.toLocaleString();

    const pullsInput = document.getElementById("target-pulls-input");
    if (pullsInput && document.activeElement !== pullsInput) pullsInput.value = packsNeeded;

    const valPulls = document.getElementById("target-val-pulls");
    if (valPulls) valPulls.textContent = pullsNeeded.toLocaleString();

    const valCreditsNum = document.getElementById("target-val-credits-num");
    if (valCreditsNum) valCreditsNum.textContent = `${(creditsNeeded / 1000000).toFixed(2)}M`;

    const explainBox = document.getElementById("target-explain-box");
    if (explainBox) explainBox.innerHTML = `${explainText} ${escapeHTML(t.targetSimProbNote || "")}.`;

    const probBox = document.getElementById("target-prob-box");
    if (probBox) probBox.innerHTML = targetProbHtml(packsNeeded, rollProb, sameRarityItems.length, t);

    container.querySelectorAll(".vosfor-target-preset-btn").forEach((btn) => {
        const val = parseInt(btn.getAttribute("data-preset"), 10);
        if (val === targetCopies) btn.classList.add("active");
        else btn.classList.remove("active");
    });
}

// Construcción perezosa del dropdown de arcano objetivo (146 filas con imagen):
// solo se crea la primera vez que se abre, no en cada re-render de la pestaña
function buildTargetDropdownItems(el) {
    if (!vosData || !vosData.packs || el.dataset.built) return;
    const t = vosT();
    const items = [];
    for (const p of vosData.packs) {
        for (const slug of p.items) {
            const meta = vosData.arcanes[slug];
            if (!meta) continue;
            const active = slug === targetArcSlug ? "active-sort-item" : "";
            items.push(`
              <div class="dropdown-item ${active}" data-slug="${slug}" data-pack="${p.id}" data-search="${escapeHTML((arcName(meta) + " " + packName(p)).toLowerCase())}" onclick="globalThis.selectTargetArcane('${slug}', '${p.id}')">
                ${arcaneImgHtml(slug, arcName(meta))}
                <div style="flex:1;min-width:0;margin-left:8px;">
                  <div style="font-weight:700;font-size:0.88rem;">${escapeHTML(arcName(meta))}</div>
                  <div style="font-size:0.74rem;">${escapeHTML(packName(p))} · ${rarityChip(meta.rarity)}</div>
                </div>
              </div>`);
        }
    }
    el.innerHTML = items.join("");
    el.dataset.built = "1";
}

export function showTargetArcDropdown() {
    const dd = document.getElementById("targetArcDropdown");
    if (dd) buildTargetDropdownItems(dd);
    const el = document.getElementById("targetArcDropdown");
    if (el) el.classList.remove("hidden");
}

export function hideTargetArcDropdown() {
    const el = document.getElementById("targetArcDropdown");
    if (el) el.classList.add("hidden");
}

export function filterTargetArcDropdown(val) {
    showTargetArcDropdown();
    const q = (val || "").toLowerCase().trim();
    const dropdown = document.getElementById("targetArcDropdown");
    if (!dropdown) return;
    dropdown.querySelectorAll(".dropdown-item").forEach((item) => {
        const searchText = item.getAttribute("data-search") || "";
        if (!q || searchText.includes(q)) {
            item.style.display = "flex";
        } else {
            item.style.display = "none";
        }
    });
}

export function selectTargetArcane(slug, packId) {
    targetPackId = packId;
    targetArcSlug = slug;
    targetCustomPacks = null;
    hideTargetArcDropdown();
    renderVosforTab();
}

export function onTargetArcQuickSearch(val) {
    if (!val || !vosData) return;
    const q = val.toLowerCase().trim();
    if (!q) return;

    for (const pack of vosData.packs) {
        for (const slug of pack.items) {
            const meta = vosData.arcanes[slug];
            if (!meta) continue;
            const nameEs = (meta.es || "").toLowerCase();
            const nameEn = (meta.en || "").toLowerCase();
            if (nameEs === q || nameEn === q || slug === q || nameEs.includes(q) || nameEn.includes(q)) {
                targetPackId = pack.id;
                targetArcSlug = slug;
                renderVosforTab();
                return;
            }
        }
    }
}

function targetArcaneSimulatorCard() {
    const t = vosT();
    if (!vosData || !vosData.packs || !vosData.packs.length) return "";

    const curPack = vosData.packs.find((p) => p.id === targetPackId) || vosData.packs[0];
    if (!targetArcSlug || !curPack.items.includes(targetArcSlug)) {
        targetArcSlug = curPack.items[0];
    }

    const targetMeta = vosData.arcanes[targetArcSlug];
    const targetRarity = targetMeta?.rarity || "COMMON";

    const sameRarityItems = curPack.items.filter((s) => vosData.arcanes[s]?.rarity === targetRarity);
    const rollProb = curPack.rolls && curPack.rolls[0] ? (curPack.rolls[0][targetRarity] || 0.05) : 0.05;

    const copiesPerPack = (3 * rollProb) / Math.max(1, sameRarityItems.length);
    const defaultPacksNeeded = Math.ceil(targetCopies / Math.max(0.0001, copiesPerPack));
    const packsNeeded = targetCustomPacks !== null ? targetCustomPacks : defaultPacksNeeded;
    const pullsNeeded = packsNeeded * 3;
    const vosforNeeded = packsNeeded * (curPack.cost?.vosfor || 200);
    const creditsNeeded = packsNeeded * (curPack.cost?.credits || 50000);

    const packOptions = vosData.packs.map((p) => {
        const sel = p.id === curPack.id ? "selected" : "";
        return `<option value="${p.id}" ${sel}>${escapeHTML(packName(p))}</option>`;
    }).join("");

    const arcOptions = curPack.items.map((slug) => {
        const meta = vosData.arcanes[slug];
        if (!meta) return "";
        const sel = slug === targetArcSlug ? "selected" : "";
        const rName = (t.rarities || {})[meta.rarity] || meta.rarity;
        return `<option value="${slug}" ${sel}>${escapeHTML(arcName(meta))} (${escapeHTML(rName)})</option>`;
    }).join("");

    const btnPreset = (num, lbl) => {
        const on = targetCopies === num;
        return `<button class="vosfor-preset-btn vosfor-target-preset-btn ${on ? "active" : ""}" data-preset="${num}" onclick="setTargetCopiesPreset(${num})">${escapeHTML(lbl)}</button>`;
    };

    const maxR = targetMeta ? (targetMeta.maxRank ?? 5) : 5;
    const copiesMax = ((maxR + 1) * (maxR + 2)) / 2; // usually 21 or 10

    let presetsHtml = "";
    if (copiesMax === 10) {
        presetsHtml = `
            ${btnPreset(1, "1 (R0)")}
            ${btnPreset(3, "3")}
            ${btnPreset(6, "6")}
            ${btnPreset(10, `10 (R${maxR})`)}
            ${btnPreset(20, "20")}
        `;
    } else {
        presetsHtml = `
            ${btnPreset(1, "1 (R0)")}
            ${btnPreset(5, "5")}
            ${btnPreset(10, "10")}
            ${btnPreset(15, "15")}
            ${btnPreset(21, `21 (R${maxR})`)}
        `;
    }

    const targetArcName = targetMeta ? arcName(targetMeta) : "";

    const copyUnit = targetCopies === 1 ? (t.targetSimCopy || "copia") : (t.targetSimCopies || "copias");
    const rankLabel = targetCopies === copiesMax ? `(${t.targetSimRank5 || "Rango " + maxR})` : targetCopies === 1 ? `(${t.targetSimRank0 || "Rango 0"})` : "";
    const rarityLabel = (t.rarities || {})[targetRarity] || targetRarity;

    const explainRaw = t.targetSimExplanation || (state.currentLang === "es"
        ? "Para conseguir <b>{qty}x {arcane}</b> ({rarity}) en {pack}, necesitas en promedio <b>{packs} packs</b> ({pulls} tiradas)."
        : "To obtain <b>{qty}x {arcane}</b> ({rarity}) in {pack}, you need on average <b>{packs} packs</b> ({pulls} pulls).");

    const wfmLink = targetArcSlug ? `<a href="https://warframe.market/items/${escapeHTML(targetArcSlug)}" target="_blank" rel="noopener noreferrer" style="color:inherit;text-decoration:underline;" title="${state.currentLang === "es" ? "Ver en Warframe Market" : "View on Warframe Market"}">${escapeHTML(targetArcName)}</a>` : escapeHTML(targetArcName);

    const explainText = explainRaw
        .replace("{qty}", targetCopies)
        .replace("{arcane}", wfmLink)
        .replace("{rarity}", escapeHTML(rarityLabel))
        .replace("{pack}", escapeHTML(packName(curPack)))
        .replace("{packs}", packsNeeded.toLocaleString())
        .replace("{pulls}", (packsNeeded * 3).toLocaleString());

    return `
    <div id="vosfor-target-widget" class="vosfor-target-widget">
      <div class="vosfor-target-title">
        ${vosforIcon(24)}
        ${escapeHTML(t.targetSimTitle || "Simulador de Arcano Objetivo")}
      </div>
      <div class="vosfor-target-controls">
        <div>
          <label style="font-size:0.78rem;color:#aaa;display:block;margin-bottom:4px;">${escapeHTML(t.targetSimPackLabel || "Colección:")}</label>
          <select class="wf-input vosfor-select" onchange="onTargetPackChange(this.value)">${packOptions}</select>
        </div>
        <div style="position:relative;">
          <label style="font-size:0.78rem;color:#aaa;display:block;margin-bottom:4px;">${escapeHTML(t.targetSimArcLabel || "Arcano Objetivo:")}</label>
          <div class="custom-dropdown-container" style="position:relative;width:100%;">
            <input type="text" id="targetArcInput" class="wf-input vosfor-search-input" style="padding-right:30px;" placeholder="${escapeHTML(state.currentLang === "es" ? "Buscar arcano..." : "Search arcane...")}" autocomplete="off" value="${escapeHTML(targetArcName)}" onfocus="globalThis.showTargetArcDropdown()" oninput="globalThis.filterTargetArcDropdown(this.value)">
            <div id="targetArcDropdown" class="custom-dropdown hidden" style="position:absolute;top:100%;left:0;right:0;max-height:260px;overflow-y:auto;background:#111;border:1px solid #7ecbff;z-index:9999;border-radius:0 0 6px 6px;box-shadow:0 6px 20px rgba(0,0,0,0.7);">
            </div>
          </div>
        </div>
        <div style="grid-column: span 1;">
          <label style="font-size:0.78rem;color:#aaa;display:block;margin-bottom:2px;text-align:left;">${escapeHTML(t.targetSimQtyLabel || "Copias que te faltan:")}</label>
          <div style="text-align:left;margin-bottom:6px;">
            <span id="target-qty-badge" style="color:#7ecbff;font-weight:bold;font-size:0.9rem;">${targetCopies} ${escapeHTML(copyUnit)} ${escapeHTML(rankLabel)}</span>
          </div>
          <input id="target-copies-slider" type="range" class="vosfor-slider" min="1" max="${Math.max(copiesMax * 2, targetCopies * 2, 42)}" step="1" value="${targetCopies}" oninput="onTargetCopiesChange(this.value)">
          <div class="vosfor-preset-group" style="margin-top:4px;justify-content:space-between;">
            ${presetsHtml}
          </div>
        </div>
      </div>
      <div class="vosfor-stat-cards">
        <div class="vosfor-stat-card">
          <div class="vosfor-stat-card-label">${escapeHTML(t.targetSimVosforNeed || "Vosfor Necesario")}</div>
          <div id="target-val-vosfor" class="vosfor-stat-card-val"><span id="target-val-vosfor-num">${vosforNeeded.toLocaleString()}</span> ${vosforIcon()}</div>
        </div>
        <div class="vosfor-stat-card">
          <div class="vosfor-stat-card-label" style="display:flex;justify-content:space-between;align-items:center;">
            <span>${escapeHTML(t.targetSimPullsNeed || "Tiradas (Packs Loid)")}</span>
            <span style="font-size:0.65rem;color:#7ecbff;">${state.currentLang === "es" ? "Modificable" : "Editable"}</span>
          </div>
          <div style="display:flex;align-items:center;justify-content:center;gap:6px;margin-top:2px;">
            <input id="target-pulls-input" type="number" class="vosfor-calc-input" style="width:75px;font-size:1.05rem;padding:2px 4px;text-align:center;color:#ffffff;border-color:rgba(126,203,255,0.4);" min="1" max="999999" value="${packsNeeded}" oninput="onTargetPacksChange(this.value)" title="${state.currentLang === "es" ? "Modifica el número de tiradas/packs de Loid (200 Vosfor = 3 arcanos)" : "Modify Loid packs/pulls (200 Vosfor = 3 arcanes)"}">
            <span style="font-size:0.8rem;color:#aaa;">(<span id="target-val-pulls">${pullsNeeded.toLocaleString()}</span> ${state.currentLang === "es" ? "arcanos" : "arcanes"})</span>
          </div>
        </div>
        <div class="vosfor-stat-card">
          <div class="vosfor-stat-card-label">${escapeHTML(t.targetSimCreditsNeed || "Créditos")}</div>
          <div id="target-val-credits" class="vosfor-stat-card-val" style="color:#ffd76e;"><span id="target-val-credits-num">${(creditsNeeded / 1000000).toFixed(2)}M</span> ${creditsIcon(15)}</div>
        </div>
      </div>
      <div id="target-explain-box" style="font-size:0.75rem;color:#888;margin-top:8px;">
        ${explainText} ${escapeHTML(t.targetSimProbNote || "")}.
      </div>
      <div id="target-prob-box" style="font-size:0.75rem;color:#aaa;margin-top:4px;line-height:1.4;">
        ${targetProbHtml(packsNeeded, rollProb, sameRarityItems.length, t)}
      </div>
    </div>`;
}

// --- Calculadora manual de venta: N unidades de un arcano en R0 o rango máximo ---

// Dónde se gastaría el Vosfor al disolver: "auto" = mejor colección, o una concreta
function sellRateInfo() {
    if (!vosData) return null;
    if (sellRatePackId !== "auto") {
        const pack = vosData.packs.find((p) => p.id === sellRatePackId);
        if (pack) {
            const ev = computePackEV(pack, vosData.arcanes);
            if (ev.ready && ev.platPerVosfor > 0) {
                return { rate: ev.platPerVosfor, pack, custom: true };
            }
        }
    }
    const best = bestPackRate(vosData);
    return best ? { rate: best.rate, pack: best.pack, custom: false } : null;
}

function sellSimMath() {
    if (!vosData || !sellArcSlug) return null;
    const meta = vosData.arcanes[sellArcSlug];
    if (!meta) return null;
    const st = ARC_STATS.get(sellArcSlug);
    const v = arcaneVerdict(sellArcSlug, vosData.arcanes, bestPackRate(vosData));

    const maxRank = v.maxRank ?? Math.min(meta.maxRank ?? 5, 5);
    const copiesMax = v.copiesMax || 21;
    const isMax = sellRank === "max";
    const copiesPerUnit = isMax ? copiesMax : 1;

    const unitPrice = st ? (isMax ? (st.pem || 0) : (st.pe || 0)) : null;
    const totalPlat = unitPrice !== null ? sellQty * unitPrice : null;
    const totalVosfor = sellQty * copiesPerUnit * (meta.vosfor || 0);

    const bestRate = sellRateInfo();
    const vosforPlatEquiv = bestRate ? totalVosfor * bestRate.rate : null;
    const sellPlPerVosfor = totalPlat !== null && totalVosfor > 0 ? totalPlat / totalVosfor : null;

    let verdict = "pending";
    if (totalPlat !== null && vosforPlatEquiv !== null) {
        if (totalPlat <= 0) verdict = "dissolve";
        else if (totalPlat > vosforPlatEquiv * 1.15) verdict = "sell";
        else if (totalPlat < vosforPlatEquiv * 0.85) verdict = "dissolve";
        else verdict = "even";
    }

    const liq = liquidityIndex(sellArcSlug);
    const bestBuy = st ? (isMax ? (st.bbm || 0) : (st.bb || 0)) : 0;
    const volume = st ? (isMax ? Math.round(st.vm || 0) : Math.round(st.v || 0)) : 0;

    return {
        meta, st, maxRank, copiesMax, isMax, copiesPerUnit,
        unitPrice, totalPlat, totalVosfor, vosforPlatEquiv, sellPlPerVosfor,
        bestRate, verdict, liq, bestBuy, volume,
    };
}

// Igual que la calculadora de inversión: el esqueleto (con sus <img>) solo se reconstruye
// cuando cambia arcano/rango/estado; los cambios de cantidad solo tocan nodos de texto.
let lastSellSignature = null;

function updateSellSimDOM() {
    const box = document.getElementById("sell-sim-results");
    if (!box) return;
    const t = vosT();
    const m = sellSimMath();

    const qtyBadge = document.getElementById("sell-qty-badge");
    if (qtyBadge) qtyBadge.textContent = `x${sellQty}`;
    const slider = document.getElementById("sell-qty-slider");
    if (slider && document.activeElement !== slider) slider.value = Math.min(sellQty, 50);
    const qtyInput = document.getElementById("sell-qty-input");
    if (qtyInput && document.activeElement !== qtyInput) qtyInput.value = sellQty;

    document.querySelectorAll(".vosfor-sell-rank-btn").forEach((btn) => {
        btn.classList.toggle("active", btn.getAttribute("data-rank") === sellRank);
        if (btn.getAttribute("data-rank") === "max" && m) {
            btn.textContent = `R${m.maxRank} (max)`;
        }
    });

    const es = state.currentLang === "es";
    const signature = m && m.st
        ? [sellArcSlug, sellRank, sellRatePackId, m.verdict, m.bestRate ? fmtRate(m.bestRate.rate) : "-", m.unitPrice > 0 ? 1 : 0, state.currentLang].join("|")
        : m ? "loading" : "empty";

    if (signature !== lastSellSignature || !box.firstElementChild) {
        lastSellSignature = signature;

        if (!m) {
            box.innerHTML = `<div style="font-size:0.82rem;color:#888;padding:8px 0;">${escapeHTML(t.sellSimPick || "Elige un arcano para calcular su venta.")}</div>`;
            return;
        }
        if (!m.st) {
            box.innerHTML = `<div style="font-size:0.82rem;color:#888;padding:8px 0;">${escapeHTML(t.loadingPrices || "Cargando precios")}…</div>`;
            return;
        }

        const rankLbl = m.isMax ? `R${m.maxRank}` : "R0";
        const noMarket = `<span style="color:#888;font-size:0.8rem;">${escapeHTML(t.noMarket || "sin mercado")}</span>`;

        const ratePackName = m.bestRate ? packName(m.bestRate.pack) : "";
        const rateNote = m.bestRate
            ? (m.bestRate.custom
                ? (es ? `gastándolo en ${ratePackName} (${fmtRate(m.bestRate.rate)} pl/vosfor)` : `spending it on ${ratePackName} (${fmtRate(m.bestRate.rate)} pl/vosfor)`)
                : (es ? `a la tasa del mejor pack, ${ratePackName} (${fmtRate(m.bestRate.rate)} pl/vosfor)` : `at the best pack rate, ${ratePackName} (${fmtRate(m.bestRate.rate)} pl/vosfor)`))
            : (es ? "esperando precios de packs…" : "waiting for pack prices…");

        let metricLine = "";
        if (m.sellPlPerVosfor !== null && m.bestRate) {
            const packRef = m.bestRate.custom ? ratePackName : (es ? "el mejor pack de Loid" : "the best Loid pack");
            const cmp = es
                ? `Vendiendo obtienes <b>${m.sellPlPerVosfor.toFixed(3)} pl por Vosfor</b> sacrificado; ${packRef} rinde ${fmtRate(m.bestRate.rate)} pl/vosfor.`
                : `Selling nets <b>${m.sellPlPerVosfor.toFixed(3)} pl per Vosfor</b> sacrificed; ${packRef} yields ${fmtRate(m.bestRate.rate)} pl/vosfor.`;
            metricLine = `<div style="font-size:0.76rem;color:#aaa;margin-top:6px;line-height:1.4;">${cmp}</div>`;
        }

        const verdictMap = {
            sell: { txt: t.verdictSell || "VENDER", css: "verdict-sell" },
            dissolve: { txt: t.verdictDissolve || "DISOLVER", css: "verdict-dissolve" },
            even: { txt: t.verdictEven || "PAREJO", css: "verdict-even" },
            pending: { txt: "…", css: "verdict-even" },
        };
        const vd = verdictMap[m.verdict] || verdictMap.pending;

        box.innerHTML = `
          <div class="vosfor-stat-cards">
            <div class="vosfor-stat-card">
              <div class="vosfor-stat-card-label" style="display:flex;justify-content:space-between;align-items:center;">
                <span>${escapeHTML(t.sellSimUnitPrice || "Precio unidad")} (${rankLbl})</span>
                <button id="live-price-btn" class="vosfor-preset-btn" style="padding:2px 6px;font-size:0.65rem;border-color:rgba(126,203,255,0.4);color:#7ecbff;background:rgba(126,203,255,0.1);" onclick="globalThis.onLivePriceCheck('${sellArcSlug}')" title="${es ? "Consultar precio en vivo (Warframe Market)" : "Check live price (Warframe Market)"}">
                  ${es ? "En vivo" : "Live"}
                </button>
              </div>
              <div class="vosfor-stat-card-val">${m.unitPrice > 0 ? `<span data-f="unit"></span>${PLAT}` : noMarket}</div>
            </div>
            <div class="vosfor-stat-card">
              <div class="vosfor-stat-card-label">${escapeHTML(t.sellSimTotalSale || "Venta total")} (<span data-f="qty"></span>)</div>
              <div class="vosfor-stat-card-val" style="color:#42f56c;">${m.unitPrice > 0 ? `<span data-f="sale"></span>${PLAT}` : noMarket}</div>
            </div>
            <div class="vosfor-stat-card">
              <div class="vosfor-stat-card-label">${escapeHTML(t.sellSimTotalVosfor || "Vosfor al disolver")}</div>
              <div class="vosfor-stat-card-val" style="color:#c59afc;"><span data-f="tvos"></span>${vosforIcon()}</div>
            </div>
            <div class="vosfor-stat-card">
              <div class="vosfor-stat-card-label">${escapeHTML(t.sellSimVosforEquiv || "Ese Vosfor equivale a")}</div>
              <div class="vosfor-stat-card-val" style="color:#7ecbff;"><span data-f="equiv"></span>${m.vosforPlatEquiv !== null ? PLAT : ""}</div>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:10px;margin-top:8px;flex-wrap:wrap;">
            <span class="verdict-tag ${vd.css}" style="font-size:0.85rem;">${escapeHTML(vd.txt)}</span>
            <span style="font-size:0.76rem;color:#999;">${escapeHTML(es ? "Vender vs disolver" : "Sell vs dissolve")} ${escapeHTML(rateNote)}</span>
          </div>
          ${metricLine}
          <div style="font-size:0.74rem;color:#888;margin-top:6px;"><span data-f="liq"></span>${PLAT}</div>
          <div id="live-price-status" style="font-size:0.75rem;margin-top:6px;display:none;padding:4px 8px;border-radius:4px;"></div>
          <div style="font-size:0.72rem;color:#777;margin-top:4px;">${es ? `1 unidad R${m.maxRank} = ${m.copiesMax} copias (${m.meta.vosfor} Vosfor cada una al disolver).` : `1 unit at R${m.maxRank} = ${m.copiesMax} copies (${m.meta.vosfor} Vosfor each when dissolved).`}</div>`;
    }

    if (!m || !m.st) return;

    // Solo texto a partir de aquí
    const set = (f, txt) => {
        const el = box.querySelector(`[data-f="${f}"]`);
        if (el) el.textContent = txt;
    };
    const rankLbl = m.isMax ? `R${m.maxRank}` : "R0";
    set("unit", m.unitPrice);
    set("qty", `x${sellQty}`);
    set("sale", Math.round(m.totalPlat || 0));
    set("tvos", m.totalVosfor.toLocaleString());
    set("equiv", m.vosforPlatEquiv !== null ? m.vosforPlatEquiv.toFixed(1) : "…");
    set("liq", es
        ? `Liquidez ${rankLbl}: ${m.volume} ventas/día · mejor compra activa: ${m.bestBuy}`
        : `${rankLbl} liquidity: ${m.volume} sales/day · best active buy: ${m.bestBuy}`);
}

function sellSimulatorCard() {
    const t = vosT();
    if (!vosData || !vosData.arcanes) return "";

    if (!sellArcSlug || !vosData.arcanes[sellArcSlug]) {
        sellArcSlug = Object.keys(vosData.arcanes).sort()[0] || "";
    }
    const meta = vosData.arcanes[sellArcSlug];
    const maxRank = Math.min(meta?.maxRank ?? 5, 5);
    const selName = meta ? arcName(meta) : "";

    const rankBtn = (r, lbl) => `
      <button class="vosfor-preset-btn vosfor-sell-rank-btn ${sellRank === r ? "active" : ""}" data-rank="${r}" onclick="setSellRank('${r}')">${escapeHTML(lbl)}</button>`;

    return `
    <div id="vosfor-sell-widget" class="vosfor-target-widget" style="border-color:rgba(66,245,108,0.5); box-shadow: 0 4px 20px rgba(66,245,108,0.15);">
      <div class="vosfor-target-title" style="color:#42f56c; font-size:1.15rem; text-shadow: 0 1px 4px rgba(0,0,0,0.8);">
        ${vosforIcon(24)}
        ${escapeHTML(state.currentLang === "es" ? "¿Vender o Disolver en Vosfor?" : "Sell or Dissolve for Vosfor?")}
      </div>
      <div style="font-size:0.82rem; color:#aaa; margin-bottom:12px;">
        ${escapeHTML(state.currentLang === "es" ? "Descubre al instante si te conviene más vender este arcano por platino en el mercado, o disolverlo para comprar packs de Loid." : "Instantly find out if you should sell this arcane for plat on the market, or dissolve it to buy Loid packs.")}
      </div>
      <div class="vosfor-target-controls">
        <div style="position:relative;">
          <label style="font-size:0.78rem;color:#aaa;display:block;margin-bottom:4px;">${escapeHTML(t.sellSimArcLabel || "Arcano:")}</label>
          <div class="custom-dropdown-container" style="position:relative;width:100%;">
            <input type="text" id="sellArcInput" class="wf-input vosfor-search-input" style="padding-right:30px;" placeholder="${escapeHTML(state.currentLang === "es" ? "Buscar arcano..." : "Search arcane...")}" autocomplete="off" value="${escapeHTML(selName)}" onfocus="globalThis.showSellArcDropdown()" oninput="globalThis.filterSellArcDropdown(this.value)">
            <div id="sellArcDropdown" class="custom-dropdown hidden" style="position:absolute;top:100%;left:0;right:0;max-height:260px;overflow-y:auto;background:#111;border:1px solid #42f56c;z-index:9999;border-radius:0 0 6px 6px;box-shadow:0 6px 20px rgba(0,0,0,0.7);"></div>
          </div>
        </div>
        <div>
          <label style="font-size:0.78rem;color:#aaa;display:block;margin-bottom:4px;">${escapeHTML(t.sellSimRankLabel || "Rango:")}</label>
          <div class="vosfor-preset-group">
            ${rankBtn("r0", "R0")}
            ${rankBtn("max", `R${maxRank} (max)`)}
          </div>
        </div>
        <div>
          <label style="font-size:0.78rem;color:#aaa;display:block;margin-bottom:2px;">${escapeHTML(t.sellSimQtyLabel || "Cantidad:")} <span id="sell-qty-badge" style="color:#42f56c;font-weight:bold;">x${sellQty}</span></label>
          <div style="display:flex;align-items:center;gap:8px;">
            <input id="sell-qty-slider" type="range" class="vosfor-slider" min="1" max="${Math.max(50, sellQty * 2)}" step="1" value="${sellQty}" style="flex:1;" oninput="onSellQtyChange(this.value)">
            <input id="sell-qty-input" type="number" class="vosfor-calc-input" style="width:70px;" min="1" max="99999" value="${sellQty}" oninput="onSellQtyChange(this.value)">
          </div>
        </div>
        <div>
          <label style="font-size:0.78rem;color:#aaa;display:block;margin-bottom:4px;">${escapeHTML(t.sellSimRatePackLabel || (state.currentLang === "es" ? "Gastar el Vosfor en:" : "Spend the Vosfor on:"))}</label>
          <select class="wf-input vosfor-select" onchange="globalThis.onSellRatePackChange(this.value)">
            <option value="auto" ${sellRatePackId === "auto" ? "selected" : ""}>${escapeHTML(state.currentLang === "es" ? "Auto (mejor colección)" : "Auto (best collection)")}</option>
            ${vosData.packs.map((p) => `<option value="${p.id}" ${p.id === sellRatePackId ? "selected" : ""}>${escapeHTML(packName(p))}</option>`).join("")}
          </select>
        </div>
      </div>
      <div id="sell-sim-results" style="margin-top:8px;"></div>
    </div>`;
}

export function onSellRatePackChange(packId) {
    sellRatePackId = packId || "auto";
    // Si la colección elegida aún no tiene precios cargados, priorizarla
    if (sellRatePackId !== "auto" && vosData) {
        const pack = vosData.packs.find((p) => p.id === sellRatePackId);
        if (pack) requestPackStats(pack, true).catch(console.error);
    }
    updateSellSimDOM();
}

// Construcción perezosa: 160 filas con imagen solo se crean al abrir el dropdown,
// no en cada re-render de la pestaña (ahorro grande de memoria/DOM)
function buildSellDropdownItems(el) {
    if (!vosData || el.dataset.built) return;
    const allSlugs = Object.keys(vosData.arcanes).sort((a, b) =>
        arcName(vosData.arcanes[a]).localeCompare(arcName(vosData.arcanes[b])));
    el.innerHTML = allSlugs.map((slug) => {
        const am = vosData.arcanes[slug];
        const active = slug === sellArcSlug ? "active-sort-item" : "";
        return `
          <div class="dropdown-item ${active}" data-search="${escapeHTML((arcName(am) + " " + slug).toLowerCase())}" onclick="globalThis.selectSellArcane('${slug}')">
            ${arcaneImgHtml(slug, arcName(am))}
            <div style="flex:1;min-width:0;margin-left:8px;">
              <div style="font-weight:700;font-size:0.88rem;">${escapeHTML(arcName(am))}</div>
              <div style="font-size:0.74rem;">${rarityChip(am.rarity)} · ${am.vosfor}${vosforIcon()}</div>
            </div>
          </div>`;
    }).join("");
    el.dataset.built = "1";
}

export function showSellArcDropdown() {
    const el = document.getElementById("sellArcDropdown");
    if (!el) return;
    buildSellDropdownItems(el);
    el.classList.remove("hidden");
}

export function hideSellArcDropdown() {
    document.getElementById("sellArcDropdown")?.classList.add("hidden");
}

export function filterSellArcDropdown(val) {
    showSellArcDropdown();
    const q = (val || "").toLowerCase().trim();
    const dropdown = document.getElementById("sellArcDropdown");
    if (!dropdown) return;
    dropdown.querySelectorAll(".dropdown-item").forEach((item) => {
        const searchText = item.getAttribute("data-search") || "";
        item.style.display = !q || searchText.includes(q) ? "flex" : "none";
    });
}

export function selectSellArcane(slug) {
    sellArcSlug = slug;
    hideSellArcDropdown();
    const input = document.getElementById("sellArcInput");
    const meta = vosData?.arcanes[slug];
    if (input && meta) input.value = arcName(meta);
    // Carga prioritaria de este arcano si aún no tenemos sus stats
    if (vosData && !ARC_STATS.has(slug)) {
        requestPackStats({ id: `sell_${slug}`, items: [slug] }, true).catch(console.error);
    }
    updateSellSimDOM();
}

export function setSellRank(r) {
    sellRank = r === "r0" ? "r0" : "max";
    updateSellSimDOM();
}

export function onSellQtyChange(val) {
    const num = parseInt(val, 10);
    if (!isNaN(num) && num >= 1) {
        sellQty = Math.min(num, 999);
        updateSellSimDOM();
    }
}

export async function onLivePriceCheck(slug) {
    const btn = document.getElementById("live-price-btn");
    const statusBox = document.getElementById("live-price-status");
    if (!btn || !statusBox || !slug) return;

    const es = state.currentLang === "es";
    btn.disabled = true;
    btn.innerHTML = es ? "Cargando…" : "Loading…";
    btn.style.opacity = "0.6";

    statusBox.style.display = "block";
    statusBox.style.background = "rgba(224,176,64,0.1)";
    statusBox.style.color = "#e8c88a";
    statusBox.style.border = "1px solid rgba(224,176,64,0.3)";
    statusBox.innerHTML = es ? "Consultando Warframe Market..." : "Fetching from Warframe Market...";

    const res = await fetchLiveArcanePrice(slug);

    if (res.ok) {
        statusBox.style.background = "rgba(66,245,108,0.1)";
        statusBox.style.color = "#42f56c";
        statusBox.style.border = "1px solid rgba(66,245,108,0.3)";
        statusBox.innerHTML = es ? "¡Precio actualizado!" : "Price updated!";
        setTimeout(() => {
            if (document.getElementById("live-price-status")) {
                document.getElementById("live-price-status").style.display = "none";
            }
        }, 3000);
    } else {
        statusBox.style.background = "rgba(255,100,100,0.1)";
        statusBox.style.color = "#ff8888";
        statusBox.style.border = "1px solid rgba(255,100,100,0.3)";
        statusBox.innerHTML = res.message;
    }

    btn.disabled = false;
    btn.innerHTML = es ? "En vivo" : "Live";
    btn.style.opacity = "1";
}

// Veredicto único por copia: la única decisión que importa (vender en R0, subir a Rmax
// y vender, o disolver). El razonamiento completo va en el tooltip, no en la fila.
function bestActionBadge(v, meta) {
    if (!v || v.bestAction === "pending" || v.bestAction === undefined) {
        return `<span style="font-size:0.72rem;color:#888;">…</span>`;
    }
    const t = vosT();
    const map = {
        sell_r0: { txt: t.verdictSellR0, css: "verdict-sell" },
        sell_max: { txt: `${t.verdictSell} R${v.maxRank}`, css: "verdict-sell" },
        dissolve: { txt: t.verdictDissolve, css: "verdict-dissolve" },
        even: { txt: t.verdictEven, css: "verdict-even" },
    };
    const m = map[v.bestAction] || map.even;
    const dissolveVal = (v.netDissolveAdj ?? v.dissolvePlat21 ?? 0).toFixed(1);
    const tip = (t.verdictBatchTip || "")
        .replaceAll("{copies}", v.copiesMax)
        .replace("{rank}", v.maxRank)
        .replace("{r5}", v.sellR5)
        .replace("{r0}", v.sell)
        .replace("{dissolve}", dissolveVal);
    // Aviso de apuesta (sin emoji): disolver "gana" en EV pero sacrificas valor garantizado alto.
    let warn = "";
    if (v.gambleWarning) {
        const wtip = (t.gambleTip || "").replace("{plat}", v.guaranteedBest);
        warn = ` <span data-tooltip="${escapeHTML(wtip)}" style="cursor:help;color:#ffb300;font-weight:700;font-size:0.62rem;border:1px solid rgba(255,179,0,0.5);border-radius:3px;padding:0 3px;">${escapeHTML(t.gambleTag || "GAMBLE")}</span>`;
    }
    return `<span class="verdict-tag ${m.css}" data-tooltip="${escapeHTML(tip)}" style="cursor:help;">${escapeHTML(m.txt)}</span>${warn}`;
}

function arcaneRow(slug, bestRate, parentPack) {
    const t = vosT();
    const es = state.currentLang === "es";
    const meta = vosData.arcanes[slug];
    if (!meta) return "";
    const st = ARC_STATS.get(slug);
    const v = arcaneVerdict(slug, vosData.arcanes, bestRate);

    // Una sola línea de números: lo que se vende y por cuánto, y qué da al disolver
    let priceCell = `<span style="color:#777;">…</span>`;
    if (st) {
        const r0 = st.pe || 0;
        const rmax = st.pem || 0;
        const parts = [];
        parts.push(r0 > 0
            ? `R0 <b style="color:#fff;">${r0}</b>${PLAT}`
            : `<span style="color:#888;">${escapeHTML(t.noMarket || "sin mercado")}</span>`);
        if (rmax > 0 && st.rm > 0) parts.push(`R${st.rm} <b style="color:#fff;">${rmax}</b>${PLAT}`);
        priceCell = `<span style="font-size:0.8rem;color:#aaa;">${parts.join(" · ")}</span>`;
    }

    const dissolveTip = getDissolveTip(v, t, meta);
    const dissolveCell = v.dissolvePlat !== null && v.dissolvePlat !== undefined && st
        ? `<span data-tooltip="${escapeHTML(dissolveTip)}" style="color:#c59afc;font-weight:700;cursor:help;font-size:0.8rem;">${meta.vosfor}${vosforIcon()} ≈ ${v.dissolvePlat.toFixed(1)}${PLAT}</span>`
        : `<span style="color:#c59afc;font-weight:700;font-size:0.8rem;">${meta.vosfor}${vosforIcon()}</span>`;

    return `
    <div class="vosfor-arc-row">
      <div class="vosfor-arc-main-line">
        ${arcaneImgHtml(slug, arcName(meta))}
        <div class="vosfor-arc-info">
          <div class="vosfor-arc-name">
            <a href="https://warframe.market/items/${escapeHTML(slug)}" target="_blank">${escapeHTML(arcName(meta))}</a>
          </div>
          <div class="vosfor-arc-chips">${rarityChip(meta.rarity)}${liqBadge(slug)}</div>
        </div>
        <div class="vosfor-arc-price-col">${priceCell}</div>
        <div class="vosfor-arc-dissolve-col">${dissolveCell}</div>
        <div class="vosfor-arc-verdict-col">${bestActionBadge(v, meta)}</div>
      </div>
    </div>`;
}

function searchResultsCard(bestRate) {
    const t = vosT();
    if (!searchQuery.trim() || !vosData || !vosData.arcanes) return "";

    const q = searchQuery.toLowerCase().trim();
    const matchingSlugs = Object.keys(vosData.arcanes).filter((slug) => {
        const meta = vosData.arcanes[slug];
        if (!meta) return false;
        const nameEs = (meta.es || "").toLowerCase();
        const nameEn = (meta.en || "").toLowerCase();
        return slug.includes(q) || nameEs.includes(q) || nameEn.includes(q);
    });

    if (!matchingSlugs.length) {
        return `
        <div class="vosfor-guide-box" style="margin-top:10px;border-color:rgba(255,100,100,0.3);">
          <div style="color:#ff8888;font-size:0.88rem;font-weight:bold;">
            ${escapeHTML(state.currentLang === "es" ? `No se encontraron arcanos para "${searchQuery}"` : `No arcanes found for "${searchQuery}"`)}
          </div>
        </div>`;
    }

    const rows = matchingSlugs.map((slug) => arcaneRow(slug, bestRate)).join("");

    return `
    <div class="vosfor-ranking-section" style="margin-top:10px;border-color:rgba(126,203,255,0.45);background:linear-gradient(135deg, rgba(20,30,50,0.9) 0%, rgba(12,18,30,0.95) 100%);">
      <div class="vosfor-ranking-header">
        <div class="vosfor-ranking-title" style="color:#7ecbff;">
          ${escapeHTML(state.currentLang === "es" ? "Resultados de Búsqueda" : "Search Results")} (${matchingSlugs.length} ${matchingSlugs.length === 1 ? (t.targetSimCopy || "arcano") : (t.targetSimCopies || "arcanos")})
        </div>
      </div>
      <div style="background:rgba(0,0,0,0.3);border-radius:8px;overflow:hidden;border:1px solid rgba(255,255,255,0.05);">${rows}</div>
    </div>`;
}

function packHighlights(pack, bestRate) {
    const t = vosT();
    const loaded = pack.items.filter((s) => ARC_STATS.has(s) && vosData.arcanes[s]);
    if (loaded.length < pack.items.length) return "";

    const bySell = [...loaded].sort((a, b) => (ARC_STATS.get(b).pe || 0) - (ARC_STATS.get(a).pe || 0)).slice(0, 3);
    const name = (s) => escapeHTML(arcName(vosData.arcanes[s]));

    const sellList = bySell
        .filter((s) => (ARC_STATS.get(s).pe || 0) > 0)
        .map((s) => `<span style="white-space:nowrap;">${name(s)} <b style="color:#42f56c;">${ARC_STATS.get(s).pe}${PLAT}</b></span>`)
        .join(" · ");

    const byVosforValue = [...loaded]
        .sort((a, b) => (vosData.arcanes[b].vosfor || 0) - (vosData.arcanes[a].vosfor || 0))
        .slice(0, 3)
        .map((s) => `<span style="white-space:nowrap;">${name(s)} <b style="color:#c59afc;">${vosData.arcanes[s].vosfor}${vosforIcon()}</b></span>`)
        .join(" · ");

    return `
    <div class="vosfor-highlights">
      <div><span style="color:#42f56c;font-weight:bold;">${escapeHTML(t.bestToSell || "Más plat por venta:")}</span> ${sellList || "—"}</div>
      <div><span style="color:#c59afc;font-weight:bold;">${escapeHTML(t.bestToDissolve || "Más Vosfor al disolver:")}</span> ${byVosforValue}</div>
    </div>`;
}

let activeJadeAnimFrame = null;
let activeJadeObserver = null;

export function initJadeCosmicEasterEgg() {
    if (activeJadeAnimFrame) {
        cancelAnimationFrame(activeJadeAnimFrame);
        activeJadeAnimFrame = null;
    }
    if (activeJadeObserver) {
        activeJadeObserver.disconnect();
        activeJadeObserver = null;
    }

    const canvas = document.getElementById("jade-cosmic-canvas");
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;

    const rect = parent.getBoundingClientRect();
    const width = rect.width || 400;
    const height = rect.height || 60;

    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");

    const particles = [];
    const shockwaves = [];
    let t = Math.random() * 100;
    let lastClashTime = 0;
    let isVisible = true;

    function animate() {
        if (!document.contains(canvas) || !isVisible) {
            activeJadeAnimFrame = null;
            return;
        }

        ctx.clearRect(0, 0, width, height);
        t += 0.022;

        const rx = width * 0.42;
        const ry = height * 0.32;
        const cx = width / 2;
        const cy = height / 2;

        const clashCycle = Math.sin(t * 0.75);
        const distMult = 0.15 + 0.85 * Math.pow(Math.abs(clashCycle), 1.6);

        const gx = cx + Math.cos(t) * rx * distMult;
        const gy = cy + Math.sin(t * 1.4) * ry * distMult;

        const rx_pos = cx - Math.cos(t * 1.04) * rx * distMult;
        const ry_pos = cy - Math.sin(t * 1.46) * ry * distMult;

        const dx = gx - rx_pos;
        const dy = gy - ry_pos;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // --- Tormenta Plasma Cósmica Lejana: Arcos de Relámpago entre Nodos ---
        if (dist < 40 && dist > 2) {
            const flicker = Math.random();
            if (flicker > 0.3) {
                ctx.save();
                ctx.strokeStyle = flicker > 0.65 ? "#ffffff" : (Math.random() > 0.5 ? "#42f56c" : "#ff3344");
                ctx.shadowColor = Math.random() > 0.5 ? "#42f56c" : "#ff3344";
                ctx.shadowBlur = 8;
                ctx.lineWidth = 1.2;
                ctx.globalAlpha = (1 - dist / 40) * (0.5 + Math.random() * 0.5);

                const midX = (gx + rx_pos) / 2 + (Math.random() - 0.5) * 14;
                const midY = (gy + ry_pos) / 2 + (Math.random() - 0.5) * 14;

                ctx.beginPath();
                ctx.moveTo(gx, gy);
                ctx.lineTo(midX, midY);
                ctx.lineTo(rx_pos, ry_pos);
                ctx.stroke();
                ctx.restore();
            }
        }

        // Al chocar (< 20px), se engendra la tormenta expansiva de luz en 360°
        if (dist < 20) {
            const impactX = (gx + rx_pos) / 2;
            const impactY = (gy + ry_pos) / 2;
            const now = Date.now();

            if (now - lastClashTime > 600) {
                lastClashTime = now;
                // Registrar onda de tormenta espacial expansiva desde el punto de impacto
                shockwaves.push({
                    x: impactX,
                    y: impactY,
                    radius: 2,
                    maxRadius: Math.max(width, height) * 0.95,
                    life: 1.0,
                    decay: 0.024
                });

                // Chispas de la tormenta emergentes en 360° desde la colisión
                for (let a = 0; a < Math.PI * 2; a += Math.PI / 6) {
                    const spd = 1.5 + Math.random() * 2.8;
                    particles.push({
                        x: impactX,
                        y: impactY,
                        vx: Math.cos(a) * spd,
                        vy: Math.sin(a) * spd,
                        color: Math.random() > 0.5 ? "#42f56c" : "#ff3344",
                        life: 1.0,
                        decay: 0.03 + Math.random() * 0.03,
                        size: 1.4 + Math.random() * 1.2
                    });
                }
            }
        }

        // --- Renderizado de Tormenta de Luz tenue y Ondas Expansivas Espaciales en 360° ---
        for (let i = shockwaves.length - 1; i >= 0; i--) {
            const sw = shockwaves[i];
            sw.radius += 4.5; // Expansión suave por el espacio
            sw.life -= sw.decay;

            if (sw.life <= 0 || sw.radius >= sw.maxRadius) {
                shockwaves.splice(i, 1);
                continue;
            }

            ctx.save();

            // Luz tenue y sutil (opacidad ~0.42)
            const stormPulse = sw.life * (0.85 + 0.15 * Math.sin(sw.radius * 0.4));
            ctx.globalAlpha = stormPulse * 0.42;

            // Nube de plasma expansiva tenue donde destacan los tonos Verde Jade y Rojo Stalker
            const rInner = Math.max(0, sw.radius - 18);
            const rOuter = sw.radius + 20;
            const waveGrad = ctx.createRadialGradient(sw.x, sw.y, rInner, sw.x, sw.y, rOuter);
            waveGrad.addColorStop(0, "rgba(66, 245, 108, 0)");
            waveGrad.addColorStop(0.25, `rgba(66, 245, 108, ${0.52 * sw.life})`);  // Tono verde Jade distintivo
            waveGrad.addColorStop(0.5, `rgba(200, 255, 220, ${0.28 * sw.life})`); // Fusión tenue
            waveGrad.addColorStop(0.75, `rgba(255, 51, 68, ${0.52 * sw.life})`);   // Tono rojo Stalker distintivo
            waveGrad.addColorStop(1, "rgba(255, 51, 68, 0)");

            ctx.fillStyle = waveGrad;
            ctx.beginPath();
            ctx.arc(sw.x, sw.y, rOuter, 0, Math.PI * 2);
            ctx.fill();

            // Anillo expansivo muy fino y tenue
            ctx.strokeStyle = `rgba(180, 255, 200, ${0.35 * sw.life})`;
            ctx.lineWidth = 1.2 * sw.life;
            ctx.beginPath();
            ctx.arc(sw.x, sw.y, sw.radius, 0, Math.PI * 2);
            ctx.stroke();

            ctx.restore();
        }

        // Estelas pequeñas con tiempo de vida (Jade Verde)
        particles.push({
            x: gx,
            y: gy,
            vx: (Math.random() - 0.5) * 0.4,
            vy: (Math.random() - 0.5) * 0.4,
            color: "#42f56c",
            life: 1.0,
            decay: 0.038, // Tiempo de vida de la estela (~26 frames)
            size: 1.8
        });

        // Estelas pequeñas con tiempo de vida (Stalker Rojo)
        particles.push({
            x: rx_pos,
            y: ry_pos,
            vx: (Math.random() - 0.5) * 0.4,
            vy: (Math.random() - 0.5) * 0.4,
            color: "#ff3344",
            life: 1.0,
            decay: 0.038, // Tiempo de vida de la estela (~26 frames)
            size: 1.8
        });

        // Limitar la cantidad máxima de partículas en memoria (máximo 36 partículas)
        while (particles.length > 36) {
            particles.shift();
        }

        // Dibujar partículas con tiempo de vida que se desvanecen
        for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];
            p.x += p.vx;
            p.y += p.vy;
            p.life -= p.decay;

            if (p.life <= 0) {
                particles.splice(i, 1);
                continue;
            }

            ctx.save();
            ctx.globalAlpha = p.life * 0.85;
            ctx.fillStyle = p.color;
            ctx.shadowColor = p.color;
            ctx.shadowBlur = 5 * p.life;

            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }

        // Puntos minúsculos principales de luz distante (2.4px con resplandor nítido)
        // Jade (Verde)
        ctx.save();
        ctx.fillStyle = "#ffffff";
        ctx.shadowColor = "#42f56c";
        ctx.shadowBlur = 11;
        ctx.beginPath();
        ctx.arc(gx, gy, 2.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // Stalker (Rojo)
        ctx.save();
        ctx.fillStyle = "#ffffff";
        ctx.shadowColor = "#ff3344";
        ctx.shadowBlur = 11;
        ctx.beginPath();
        ctx.arc(rx_pos, ry_pos, 2.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        activeJadeAnimFrame = requestAnimationFrame(animate);
    }

    // Pausar automáticamente cuando el elemento se desplaza fuera de pantalla o en otra pestaña (0% CPU / 0 RAM Leak)
    if ("IntersectionObserver" in window) {
        activeJadeObserver = new IntersectionObserver((entries) => {
            const entry = entries[0];
            const nowVisible = entry ? entry.isIntersecting : true;
            if (nowVisible && !isVisible) {
                isVisible = true;
                if (!activeJadeAnimFrame) {
                    activeJadeAnimFrame = requestAnimationFrame(animate);
                }
            } else if (!nowVisible) {
                isVisible = false;
                if (activeJadeAnimFrame) {
                    cancelAnimationFrame(activeJadeAnimFrame);
                    activeJadeAnimFrame = null;
                }
            }
        }, { threshold: 0.05 });
        activeJadeObserver.observe(parent);
    }

    activeJadeAnimFrame = requestAnimationFrame(animate);
}

globalThis.toggleHunhowMemeQuote = function (el) {
    if (!el) return;
    const quote = el.querySelector(".hunhow-meme-quote");
    if (quote) {
        quote.classList.toggle("hidden");
    }
};

function renderOthersGrouped(pack, bestRate) {
    const items = sortedPackItems(pack);
    const groups = {};

    for (const slug of items) {
        const synInfo = getArcaneOtherSyndicate(slug);
        const groupKey = synInfo.wikiIcon;
        if (!groups[groupKey]) {
            groups[groupKey] = { info: synInfo, slugs: [] };
        }
        groups[groupKey].slugs.push(slug);
    }

    let html = "";
    for (const [key, g] of Object.entries(groups)) {
        if (!g.slugs.length) continue;
        const synName = state.currentLang === "es" ? g.info.es : g.info.en;
        const rows = g.slugs.map((s) => arcaneRow(s, bestRate, pack)).join("");
        const isJadeGroup = g.info.wikiIcon && g.info.wikiIcon.includes("JadeShadows");
        const extraClass = isJadeGroup ? "jade-easter-egg-header" : "";
        const easterEggHtml = isJadeGroup
            ? `<canvas id="jade-cosmic-canvas" class="jade-cosmic-canvas"></canvas>`
            : "";
        const hunhowQuoteHtml = isJadeGroup
            ? `<div class="hunhow-meme-quote">"I , am Hunhow.Sirius, Orion, stop fighting... fetch me my remote, Pop Pop wants to watch NASCAR." <span class="hunhow-author">- Hunhow</span></div>`
            : "";
        html += `
          <div class="vosfor-syndicate-group-header ${extraClass}" ${isJadeGroup ? 'onclick="globalThis.toggleHunhowMemeQuote(this)" title="Clic para alternar frase de Hunhow"' : ''}>
            ${easterEggHtml}
            ${syndicateIconHtml(g.info.wikiIcon, g.info.icon)}
            <div style="z-index:2;position:relative;display:flex;flex-direction:column;align-items:flex-start;gap:2px;">
              <span>${escapeHTML(synName)} (${g.slugs.length})</span>
              ${hunhowQuoteHtml}
            </div>
          </div>
          <div style="background:rgba(0,0,0,0.3);border-radius:8px;overflow:hidden;border:1px solid rgba(255,255,255,0.05);margin-bottom:8px;">${rows}</div>`;
    }
    return html || `<div style="padding:12px;color:#888;font-size:0.85rem;">${state.currentLang === "es" ? "No se encontraron arcanos con ese nombre." : "No arcanes found with that name."}</div>`;
}

function packCard(pack, bestRate, bestBalancedRate) {
    const t = vosT();
    const isOthers = pack.id === "others";
    const ev = computePackEV(pack, vosData.arcanes);

    const itemsMatching = sortedPackItems(pack);
    if (searchQuery.trim() && itemsMatching.length === 0) {
        return "";
    }

    const isOpen = expandAllPacks || expandedPack === pack.id || (searchQuery.trim().length > 0);
    const isBestEv = !isOthers && bestRate && bestRate.packId === pack.id;
    const isBestBalanced = !isOthers && bestBalancedRate && bestBalancedRate.packId === pack.id;
    const syn = PACK_SYNDICATES[pack.id] || PACK_SYNDICATES.others;

    let evHtml;
    if (isOthers) {
        evHtml = ev.ready
            ? ""
            : `<span style="font-size:0.78rem;color:#888;">${escapeHTML(t.loadingPrices || "Cargando precios")} ${ev.loaded}/${ev.total}</span>`;
    } else if (ev.ready) {
        // Métricas mínimas a simple vista: cuánto plat te da un pack y lo rápido que se vende.
        // (El coste es fijo de 200 Vosfor, así que "pl por pack" ordena igual que pl/vosfor)
        const rateColor = isBestEv ? "#42f56c" : isBestBalanced ? "#7ecbff" : "#e0e0e0";
        evHtml = `
          <div class="vosfor-rate-val" style="color:${rateColor};">
            ≈ ${ev.evPlat}${PLAT} <span style="font-size:0.72rem;font-weight:normal;opacity:0.85;">/ pack</span>
          </div>
          <div class="vosfor-ev-detail" style="display:flex;justify-content:flex-end;">
            ${sellSpeedChip(ev.avgVolume)}
          </div>`;
    } else {
        evHtml = `<span style="font-size:0.78rem;color:#888;">${escapeHTML(t.loadingPrices || "Cargando precios")} ${ev.loaded}/${ev.total}</span>`;
    }

    const bestEvTag = isBestEv
        ? `<span class="badge-vosfor badge-best-spend">${escapeHTML(t.bestPack || "MEJOR GASTO")}</span>`
        : "";

    const bestLiquidTag = isBestBalanced
        ? `<span class="badge-vosfor badge-high-liquid">${escapeHTML(t.maxLiquidTitle || "VENTA RÁPIDA")}</span>`
        : "";

    let body = "";
    if (isOpen) {
        const sortBtn = (v, lbl) => {
            const on = packSort === v;
            return `<button class="vosfor-sort-btn ${on ? "active" : ""}" onclick="setVosforSort('${v}')">${escapeHTML(lbl)}</button>`;
        };
        const sortBar = `
          <div class="vosfor-sort-bar">
            <span class="vosfor-sort-label">${escapeHTML(t.sortBy || "Ordenar")}</span>
            <div class="vosfor-sort-group">
              ${sortBtn("balanced", t.sortBalanced || "Balanceado")}${sortBtn("price", t.sortPrice || "Venta")}${sortBtn("rarity", t.sortRarity || "Rareza")}${sortBtn("vosfor", t.sortVosfor || "Vosfor")}${sortBtn("liq", t.sortLiq || "Liquidez")}
            </div>
          </div>`;

        const header = `
          <div class="vosfor-table-header">
            <div style="flex:1.5;">${escapeHTML(t.colArcane || "Arcano / liquidez")}</div>
            <div style="flex:1;text-align:right;">${escapeHTML(t.colSell || "Venta R0 / Rmax")}</div>
            <div style="flex:1;text-align:right;">${escapeHTML(t.colDissolve || "Al disolver")}</div>
            <div style="flex:0 0 85px;text-align:right;">${escapeHTML(t.colVerdict || "Veredicto")}</div>
          </div>`;

        if (isOthers) {
            body = `
              <div style="margin-top:8px;">
                ${sortBar}
                ${header}
                ${renderOthersGrouped(pack, bestRate)}
              </div>`;
        } else {
            const rows = itemsMatching.map((s) => arcaneRow(s, bestRate, pack)).join("");
            body = `
              <div style="margin-top:8px;">
                ${packHighlights(pack, bestRate)}
                ${sortBar}
                ${header}
                <div style="background:rgba(0,0,0,0.3);border-radius:8px;overflow:hidden;border:1px solid rgba(255,255,255,0.05);">${rows}</div>
              </div>`;
        }
    }

    const synName = state.currentLang === "es" ? syn.es : syn.en;

    return `
    <div class="vosfor-pack-card ${isOpen ? "expanded" : ""}">
      <div class="vosfor-pack-header" onclick="toggleVosforPack('${pack.id}')">
        ${syndicateIconHtml(syn.wikiIcon, syn.icon)}
        <div style="flex:1;min-width:0;">
          <div class="vosfor-pack-title">
            ${isOthers ? escapeHTML(t.othersTitle || "Otros arcanos") : escapeHTML(packName(pack))}
            ${bestEvTag}
            ${bestLiquidTag}
          </div>
          <div class="vosfor-pack-sub" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
            <span style="color:#c59afc;font-weight:600;">${escapeHTML(synName)}</span>
            <span>· ${pack.items.length} ${escapeHTML(t.arcanes || "arcanos")}</span>
            ${isOthers ? "" : `<span>· ${pack.cost.vosfor}${vosforIcon()} + ${(pack.cost.credits / 1000)}k${creditsIcon()}</span>`}
          </div>
        </div>
        <div class="vosfor-pack-ev">${evHtml}</div>
        <span style="color:#c59afc;font-size:1rem;margin-left:6px;">${isOpen ? "▲" : "▼"}</span>
      </div>
      ${body}
    </div>`;
}

function guideBoxCard() {
    const t = vosT();
    const bodyStyle = showGuide ? "display:block;" : "display:none;";
    const toggleLabel = showGuide ? (t.guideHide || "Ocultar Guía") : (t.guideShow || "Ver Guía");
    return `
    <div class="vosfor-guide-box">
      <div class="vosfor-guide-title" onclick="toggleVosforGuide()" style="cursor:pointer;">
        <span>${escapeHTML(t.guideTitle || "Guía Rápida: ¿Cómo sacarle el máximo partido a tu Vosfor?")}</span>
        <span style="margin-left:auto;font-size:0.85rem;color:#e0b0ff;font-weight:700;">${showGuide ? "▲" : "▼"} ${escapeHTML(toggleLabel)}</span>
      </div>
      <div style="${bodyStyle}">
        <div class="vosfor-guide-grid">
          <div class="vosfor-guide-item">
            <b>${escapeHTML(t.guideStep1Title || "1. Tiradas en Loid")}</b>
            ${escapeHTML(t.guideStep1Desc || "Cada pack cuesta 200 Vosfor + 50k cr y te otorga 3 arcanos aleatorios de la colección.")}
          </div>
          <div class="vosfor-guide-item">
            <b>${escapeHTML(t.guideStep2Title || "2. Vender vs Disolver")}</b>
            ${escapeHTML(t.guideStep2Desc || "El veredicto te indica si ganas más Platinum vendiéndolo o disolviéndolo de nuevo en Loid.")}
          </div>
          <div class="vosfor-guide-item">
            <b>${escapeHTML(t.guideStep3Title || "3. Rango 0 vs Rango 5")}</b>
            ${escapeHTML(t.guideStep3Desc || "Compara si te conviene vender la copia suelta o reunir copias para vender al rango máximo con bonus. Además, vender al máximo nivel ahorra muchos trades diarios.")}
          </div>
          <div class="vosfor-guide-item">
            <b>${escapeHTML(t.guideStep4Title || "4. Liquidez de Mercado")}</b>
            ${escapeHTML(t.guideStep4Desc || "El modo Balanceado evita packs inflados con arcanos raros que tardan semanas en venderse.")}
          </div>
        </div>
      </div>
    </div>`;
}

function calculatorWidgetCard(data) {
    const t = vosT();
    if (!data) return "";

    const autoOptName = state.currentLang === "es"
        ? "Recomendación Automática (Mejor EV & Venta Rápida)"
        : "Auto Recommendation (Max EV & Fast Sale)";

    const packOptions = [
        `<option value="auto" ${calcSelectedPackId === "auto" ? "selected" : ""}>${escapeHTML(autoOptName)}</option>`,
        ...data.packs.map((p) => {
            const sel = p.id === calcSelectedPackId ? "selected" : "";
            return `<option value="${p.id}" ${sel}>${escapeHTML(packName(p))}</option>`;
        })
    ].join("");

    return `
    <div class="vosfor-calc-widget">
      <div class="vosfor-calc-header">
        <div class="vosfor-calc-title">
          ${vosforIcon(26)}
          ${escapeHTML(t.calcTitle || "Calculadora de Vosfor")}
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;width:100%;max-width:280px;flex-shrink:0;">
          <div class="vosfor-calc-input-group" style="width:100%;">
            <label for="vosfor-input-field">${escapeHTML(t.calcLabel || "Tu Vosfor:")}</label>
            <input id="vosfor-input-field" type="number" class="vosfor-calc-input" value="${userVosfor}" step="200" min="0" oninput="onVosforInputChange(this.value)">
            <span style="font-size:0.85rem;color:#c59afc;font-weight:bold;margin-left:2px;">${vosforIcon()}</span>
          </div>
          <input id="vosfor-calc-slider" type="range" class="vosfor-slider" min="200" max="${Math.max(10000, Math.ceil(userVosfor * 1.5 / 200) * 200)}" step="200" value="${userVosfor}" style="width:100%;margin-top:4px;" oninput="onVosforInputChange(this.value)">
          <div class="vosfor-preset-group" style="width:100%;justify-content:space-between;margin-top:2px;">
            <button class="vosfor-preset-btn" onclick="addVosforPreset(200)">+200</button>
            <button class="vosfor-preset-btn" onclick="addVosforPreset(600)">+600</button>
            <button class="vosfor-preset-btn" onclick="addVosforPreset(2000)">+2000</button>
            <button class="vosfor-preset-btn" style="background:rgba(255,100,100,0.15);color:#ff8888;" onclick="resetVosforInput()">Reset</button>
          </div>
        </div>
      </div>
      <div style="margin-bottom:8px;">
        <label style="font-size:0.78rem;color:#aaa;display:block;margin-bottom:4px;">${escapeHTML(state.currentLang === "es" ? "Colección a Simular:" : "Collection to Simulate:")}</label>
        <select class="wf-input vosfor-select" onchange="globalThis.onVosforCalcPackChange(this.value)">${packOptions}</select>
      </div>
      <div style="font-size:0.82rem;color:#aaa;margin-bottom:6px;">${escapeHTML(t.calcSub || "Simula cuántas tiradas puedes hacer y qué colección rinde más:")}</div>
      <div id="vosfor-calc-results-box" class="vosfor-calc-results"></div>
    </div>`;
}

function searchAndControlsBar() {
    const t = vosT();
    const es = state.currentLang === "es";

    // Check if cooldown is active so the button renders in blocked state
    const now = Date.now();
    const lastGlobalRefresh = parseInt(localStorage.getItem("vosfor_last_global_refresh") || "0", 10);
    const GLOBAL_REFRESH_COOLDOWN_MS = 60 * 60 * 1000;
    const cooldownActive = now - lastGlobalRefresh < GLOBAL_REFRESH_COOLDOWN_MS;

    const btnStyle = cooldownActive
        ? "padding:6px 12px;font-size:0.8rem;border-color:rgba(100,100,100,0.5);color:#888;cursor:not-allowed;"
        : "padding:6px 12px;font-size:0.8rem;border-color:rgba(224,176,64,0.5);color:#e8c88a;";

    return `
    <div class="vosfor-search-bar" style="display:flex; flex-wrap:wrap; gap:8px;">
      <input type="text" id="arcaneInput" class="wf-input vosfor-search-input" style="flex:1;min-width:200px;" placeholder="${escapeHTML(t.searchPlaceholder || "Buscar arcano por nombre (ej. Energize, Crescendo)...")}" autocomplete="off" value="${escapeHTML(searchQuery)}" oninput="globalThis.onVosforSearchInput(this.value)">
      <button class="vosfor-preset-btn" style="padding:6px 12px;font-size:0.8rem;" onclick="toggleVosforExpandAll()">
        ${expandAllPacks ? escapeHTML(t.collapseAll || "Contraer Todo") : escapeHTML(t.expandAll || "Desplegar Todo")}
      </button>
      <button id="global-refresh-btn" class="vosfor-preset-btn" style="${btnStyle}" onclick="globalThis.onGlobalRefresh()" ${cooldownActive ? "disabled" : ""}>
        ${es ? "↻ Actualizar Precios" : "↻ Refresh Prices"}
      </button>
    </div>`;
}

export async function renderVosforTab() {
    const box = document.getElementById("vosfor-content");
    if (!box) return;
    const t = vosT();

    if (!vosData) {
        box.innerHTML = `<div style="text-align:center;color:#aaa;font-size:0.95rem;padding:24px;">${escapeHTML(t.loading || "Cargando datos…")}</div>`;
        try {
            vosData = await loadVosforData();
        } catch (e) {
            box.innerHTML = `<div style="text-align:center;color:#ff6666;font-size:0.92rem;padding:24px;">${escapeHTML(t.error || "Error al cargar los datos.")}</div>`;
            return;
        }
    }

    const bestRate = bestPackRate(vosData);
    const bestBalancedRate = bestBalancedPackRate(vosData);

    const packsSorted = [...vosData.packs].sort((a, b) => {
        const ea = computePackEV(a, vosData.arcanes);
        const eb = computePackEV(b, vosData.arcanes);
        if (packSort === "balanced") return (eb.ready ? eb.balancedRate : -1) - (ea.ready ? ea.balancedRate : -1);
        if (packSort === "liq") return (eb.ready ? eb.avgVolume : -1) - (ea.ready ? ea.avgVolume : -1);
        return (eb.ready ? eb.platPerVosfor : -1) - (ea.ready ? ea.platPerVosfor : -1);
    });

    const othersCard = vosData.others?.length ? packCard(othersPack(vosData), bestRate, bestBalancedRate) : "";

    box.innerHTML = `
      <div class="vosfor-container">
        ${guideBoxCard()}
        ${sellSimulatorCard()}
        ${calculatorWidgetCard(vosData)}
        ${targetArcaneSimulatorCard()}
        ${rankingLeaderboardCard(bestRate)}
        ${searchAndControlsBar()}
        ${searchResultsCard(bestRate)}
        <div class="vosfor-explain-text">${escapeHTML(t.explain || "")}</div>
        <div style="display:flex;flex-direction:column;gap:10px;">
          ${packsSorted.map((p) => packCard(p, bestRate, bestBalancedRate)).join("")}
          ${othersCard}
        </div>
        <div style="font-size:0.75rem;color:#777;margin-top:6px;">${escapeHTML(t.dataNote || "")} ${escapeHTML(vosData.updated || "")}</div>
      </div>`;

    updateCalculatorWidgetDOM();
    updateSellSimDOM();
    initJadeCosmicEasterEgg();
}

function scheduleRerender() {
    if (rerenderTimer) return;
    rerenderTimer = setTimeout(() => {
        rerenderTimer = null;
        renderVosforTab();
    }, 350);
}

let globalRefreshTimer = null;

export async function initVosforTab() {
    if (!unsubscribe) unsubscribe = onArcaneStats(scheduleRerender);
    await renderVosforTab();
    if (!vosData) return;

    // Initial fetch
    requestAllPacks().catch(console.error);

    // Background polling every 1 hour
    if (!globalRefreshTimer) {
        globalRefreshTimer = setInterval(() => {
            console.log("Global 1-hour arcane refresh triggered.");
            requestAllPacks().catch(console.error);
        }, 1 * 60 * 60 * 1000);
    }
}

export function setVosforSort(v) {
    packSort = v;
    renderVosforTab();
}

export function setVosforRankTab(tab) {
    activeRankTab = tab;
    renderVosforTab();
}

export function setVosforRankSubToggle(val) {
    activeRankSubToggle = val;
    renderVosforTab();
}

export function setVosforRankLimit(limit) {
    rankLimit = limit;
    renderVosforTab();
}

export function onTargetPackChange(packId) {
    targetPackId = packId;
    const pack = vosData?.packs.find((p) => p.id === packId);
    if (pack && pack.items.length) targetArcSlug = pack.items[0];
    targetCustomPacks = null;
    renderVosforTab();
}

export function onTargetArcChange(slug) {
    targetArcSlug = slug;
    targetCustomPacks = null;
    updateTargetSimDOM();
}

export function onTargetCopiesChange(val) {
    const num = parseInt(val, 10);
    if (!isNaN(num) && num > 0) {
        targetCopies = num;
        targetCustomPacks = null;
        updateTargetSimDOM();
    }
}

export function setTargetCopiesPreset(num) {
    targetCopies = num;
    targetCustomPacks = null;
    updateTargetSimDOM();
}

export function onTargetPacksChange(val) {
    const num = parseInt(val, 10);
    if (!isNaN(num) && num > 0) {
        targetCustomPacks = Math.min(num, 999999);
    } else {
        targetCustomPacks = null;
    }
    updateTargetSimDOM();
}

export function toggleVosforPack(packId) {
    expandedPack = expandedPack === packId ? null : packId;
    if (expandedPack && vosData) {
        const pack = packId === "others" ? othersPack(vosData) : vosData.packs.find((p) => p.id === packId);
        if (pack) requestPackStats(pack, true).catch(console.error);
    }
    renderVosforTab();
}

export function toggleVosforGuide() {
    showGuide = !showGuide;
    renderVosforTab();
}

export function toggleVosforExpandAll() {
    expandAllPacks = !expandAllPacks;
    renderVosforTab();
}

// Debounce del rebuild de las tarjetas de resultado: mover el slider dispara decenas de
// eventos por segundo y reconstruir el innerHTML (con sus <img>) en cada uno es lo que
// generaba peticiones de red y jank. Se reconstruye como mucho ~8 veces/seg.
let calcUpdateTimer = null;
function scheduleCalcUpdate() {
    if (calcUpdateTimer) return;
    calcUpdateTimer = setTimeout(() => {
        calcUpdateTimer = null;
        updateCalculatorWidgetDOM();
    }, 120);
}

export function onVosforInputChange(val) {
    const num = parseInt(val, 10);
    if (!isNaN(num) && num >= 0) {
        userVosfor = num;
        scheduleCalcUpdate();
    }
}

export function addVosforPreset(delta) {
    userVosfor = (userVosfor || 0) + delta;
    updateCalculatorWidgetDOM();
}

export function resetVosforInput() {
    userVosfor = 0;
    updateCalculatorWidgetDOM();
}

export function onVosforSearchInput(val) {
    searchQuery = val || "";
    scheduleRerender();
}

if (typeof window !== "undefined") {
    document.addEventListener("click", (e) => {
        const container = e.target.closest(".custom-dropdown-container");
        if (!container) {
            hideTargetArcDropdown();
            hideSellArcDropdown();
        }
    });
}

let lastGlobalRefresh = parseInt(localStorage.getItem("vosfor_last_global_refresh") || "0", 10);
const GLOBAL_REFRESH_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

export async function onGlobalRefresh() {
    const btn = document.getElementById("global-refresh-btn");
    if (!btn) return;

    const now = Date.now();
    const es = state.currentLang === "es";

    if (now - lastGlobalRefresh < GLOBAL_REFRESH_COOLDOWN_MS) {
        const remainingMinutes = Math.ceil((GLOBAL_REFRESH_COOLDOWN_MS - (now - lastGlobalRefresh)) / 60000);
        alert(es
            ? `Por favor, espera ${remainingMinutes} minutos antes de volver a actualizar todos los precios globales.`
            : `Please wait ${remainingMinutes} minutes before refreshing all global prices again.`);
        return;
    }

    btn.disabled = true;
    btn.innerHTML = es ? "↻ Actualizando..." : "↻ Refreshing...";
    btn.style.opacity = "0.6";

    // Solo vaciamos IndexedDB. NO vaciamos ARC_STATS (memoria).
    // Así la UI no parpadea ni hace "refresh de pantalla". Simplemente los valores
    // se irán pisando con los nuevos que lleguen de requestAllPacks(force=true)
    await clearArcaneCacheIDB();

    try {
        await requestAllPacks(true); // force=true para que ignore que ya están en ARC_STATS
        lastGlobalRefresh = Date.now();
        localStorage.setItem("vosfor_last_global_refresh", lastGlobalRefresh.toString());

        // No hace falta restaurar el botón porque el renderVosforTab() que se
        // disparará con el último notify() pintará el botón con el estado "disabled"
        // gracias a la lógica que hemos añadido en searchAndControlsBar()
    } catch (e) {
        console.error("Global refresh error:", e);
        btn.innerHTML = es ? "⚠ Error" : "⚠ Error";
        btn.style.color = "#ff8888";
        setTimeout(() => {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = es ? "↻ Actualizar Precios" : "↻ Refresh Prices";
                btn.style.opacity = "1";
                btn.style.color = "#e8c88a";
                btn.style.borderColor = "rgba(224,176,64,0.5)";
            }
        }, 4000);
    }
}

Object.assign(globalThis, {
    initVosforTab,
    setVosforRankTab,
    setVosforRankSubToggle,
    setVosforRankLimit,
    onTargetPackChange,
    onTargetArcChange,
    onTargetCopiesChange,
    setTargetCopiesPreset,
    onTargetPacksChange,
    toggleVosforPack,
    setVosforSort,
    onVosforInputChange,
    addVosforPreset,
    resetVosforInput,
    toggleVosforGuide,
    toggleVosforExpandAll,
    onVosforSearchInput,
    onTargetArcQuickSearch,
    showTargetArcDropdown,
    hideTargetArcDropdown,
    filterTargetArcDropdown,
    selectTargetArcane,
    onVosforCalcPackChange,
    showSellArcDropdown,
    hideSellArcDropdown,
    filterSellArcDropdown,
    selectSellArcane,
    setSellRank,
    onSellQtyChange,
    onSellRatePackChange,
    onLivePriceCheck,
    onGlobalRefresh,
    handleArcaneTyping: onVosforSearchInput,
});
