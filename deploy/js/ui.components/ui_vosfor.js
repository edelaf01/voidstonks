// vosfor tab and Loid pack simulator

import { state } from "../state.js";
import { TEXTS } from "../config.js";
import { escapeHTML } from "./ui_components.js";
import { exposeGlobals } from "../utils/global_registry.js";
import { JADE_SHADOWS_IMG } from "../assets/jade_custom_img.js";
import { initJadeCosmicEasterEgg } from "./ui_vosfor_jade.js";
import {
    sindicatosCard,
    sindicatosResultadosHtml,
    ordenSindicatos,
    setOrdenSindicatos,
    filtroSindicatos,
    setFiltroSindicatos,
} from "./ui_vosfor_sindicatos.js";
import { rentaSindicatos, slugsDeSindicatos } from "../utils/vosfor_sindicatos.js";
import { targetSimProbabilities, copiesForMaxRank } from "../utils/vosfor_math.js";
import {
    loadVosforData,
    requestPackStats,
    requestAllPacks,
    onArcaneStats,
    computePackEV,
    bestPackRate,
    arcaneVerdict,
    sellSimVerdict,
    dissolveEdge,
    vosforPerPlat,
    liquidityIndex,
    othersPack,
    ARC_STATS,
    FAILED_STATS,
    retryArcaneStats,
    pixRank,
    HEX_ARCANES,
    realizableR0,
    realizableMax,
    PACK_COST,
    arcaneUnitValue,
    fetchArcanePricesUpdated
} from "../services/vosfor.service.js?v=2.7";

const platIcon = (size = 13) => `<img src="assets/relic_contents/platinum.webp" class="vos-icon vos-icon--${size}" alt="pl">`;
const PLAT = platIcon();

// stores loaded URLs and final failures or re-renders restart broken image cascades
const IMG_SRC_CACHE = new Map();
const IMG_FAIL_PLACEHOLDER = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";

if (typeof window !== "undefined") {
    // capture phase because load and error do not bubble on img inserted via innerHTML
    document.addEventListener("load", (e) => {
        const el = e.target;
        if (el?.tagName === "IMG" && el.dataset?.imgkey && !IMG_SRC_CACHE.has(el.dataset.imgkey)) {
            IMG_SRC_CACHE.set(el.dataset.imgkey, el.getAttribute("src"));
        }
    }, true);
    document.addEventListener("error", (e) => {
        const el = e.target;
        if (el?.tagName === "IMG" && el.dataset?.imgkey && el.onerror === null && !IMG_SRC_CACHE.has(el.dataset.imgkey)) {
            IMG_SRC_CACHE.set(el.dataset.imgkey, IMG_FAIL_PLACEHOLDER);
            el.src = IMG_FAIL_PLACEHOLDER;
        }
    }, true);
}

function vosforIcon(size = 15) {
    const cls = `vos-icon vos-icon--vosfor vos-icon--${size}`;
    const cached = IMG_SRC_CACHE.get("vosfor");
    if (cached) return `<img src="${cached}" class="${cls}" alt="Vosfor" />`;
    return `<img src="assets/relic_contents/vosfor.webp" data-imgkey="vosfor" onerror="this.onerror=null; this.src='https://warframe.market/static/assets/icons/en/thumbs/vosfor.png';" class="${cls}" alt="Vosfor" />`;
}

function salesUnit() {
    return vosT().salesUnit;
}

function creditsIcon(size = 13) {
    const cls = `vos-icon vos-icon--${size}`;
    const cached = IMG_SRC_CACHE.get("credits");
    if (cached) return `<img src="${cached}" class="${cls}" alt="cr" />`;
    return `<img src="assets/relic_contents/credits.webp" data-imgkey="credits" onerror="this.onerror=null; this.src='https://wiki.warframe.com/w/Special:FilePath/Credits.png';" class="${cls}" alt="cr" />`;
}

function sellSpeedChip(avgVolume) {
    const t = vosT();
    let label, cls;
    if (avgVolume >= 15) {
        label = t.sellFast;
        cls = "vos-speed--fast";
    } else if (avgVolume >= 5) {
        label = t.sellMed;
        cls = "vos-speed--med";
    } else {
        label = t.sellSlow;
        cls = "vos-speed--slow";
    }
    const tip = (t.sellSpeedTip || "").replace("{vol}", avgVolume);
    return `<span title="${escapeHTML(tip)}" class="vos-speed-chip ${cls}">${escapeHTML(label)}</span>`;
}

let vosData = null;
let arcanePricesUpdated = null;
let arcanePricesReq = null;
let expandedPack = null;
let expandAllPacks = false;
let unsubscribe = null;
let rerenderTimer = null;
let packSort = "balanced";
let searchQuery = "";

const VOS_TABS = ["packs", "calc", "rank"];
const VOS_SUBS = { calc: ["sell", "target"], rank: ["ranking", "pix", "sindicatos"] };

function loadVosPref(key, allowed, fallback) {
    try {
        const v = localStorage.getItem(key);
        return allowed.includes(v) ? v : fallback;
    } catch {
        return fallback;
    }
}

function saveVosPref(key, value) {
    try { localStorage.setItem(key, value); } catch {}
}

let activeTab = loadVosPref("vosfor_tab", VOS_TABS, "packs");
const activeSub = {
    calc: loadVosPref("vosfor_sub_calc", VOS_SUBS.calc, "sell"),
    rank: loadVosPref("vosfor_sub_rank", VOS_SUBS.rank, "ranking")
};

let activeRankTab = "packs";
let activeRankSubToggle = "r0";
let rankLimit = 5;

let targetPackId = "albrechts_laboratories";
let targetArcSlug = "";
let targetCopies = 21;
let targetCustomPacks = null;

let sellArcSlug = "";
let sellRank = "max";
let sellQty = 1;
let sellRatePackId = "auto";

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
        es: "Solaris Unida (Fortuna)",
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
        wikiIcon: "TektolystArtifact",
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
        return `<img src="${JADE_SHADOWS_IMG}" class="vosfor-syndicate-img vosfor-jade-img" alt="${escapeHTML(vosT().jadeAlt)}" />`;
    }
    const key = `syn_${wikiIcon}`;
    const cached = IMG_SRC_CACHE.get(key);
    if (cached) return `<img src="${cached}" class="vosfor-syndicate-img" alt="" />`;
    const local = fallbackImg.includes(".")
        ? `assets/relic_contents/${fallbackImg}`
        : `assets/relic_contents/${fallbackImg}.webp`;

    return `<img src="${local}" data-imgkey="${key}" onerror="this.onerror=null; this.src='assets/relic_contents/forma.webp';" class="vosfor-syndicate-img" alt="" />`;
}

const SINDICATO_ICONOS = {
    CetusSyndicate: { icon: "pack_cetus.webp", wikiIcon: "OstronArcaneCollection" },
    EntratiLabSyndicate: { icon: "pack_albrechts_laboratories.webp", wikiIcon: "CaviaArcaneCollection" },
    EventSyndicate: { icon: "syn_lotus.webp", wikiIcon: "Lotus" },
    HexSyndicate: { icon: "syn_hex.webp", wikiIcon: "HexSyndicate" },
    QuillsSyndicate: { icon: "pack_plains_of_eidolon.webp", wikiIcon: "EidolonArcaneCollection" },
    SolarisSyndicate: { icon: "pack_fortuna.webp", wikiIcon: "SolarisArcaneCollection" },
    VoxSyndicate: { icon: "syn_vox.webp", wikiIcon: "VoxSolarisArcaneCollection" },
    ZarimanSyndicate: { icon: "pack_zariman_and_lua.webp", wikiIcon: "HoldfastsArcaneCollection" },
};

function iconoSindicatoHtml(id) {
    const m = SINDICATO_ICONOS[id] || SINDICATO_ICONOS.EventSyndicate;
    return syndicateIconHtml(m.wikiIcon, m.icon);
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

function vosT(key) {
    const t = (TEXTS[state.currentLang] || {}).vosfor || TEXTS.es.vosfor || {};
    return key ? (t[key] ?? "") : t;
}

function vosSkeleton(rows = 3, label, kind) {
    const aria = escapeHTML(label || vosT("loadingAria"));
    const mod = kind === "cards" || kind === "list" || kind === "page" ? ` vos-skel--${kind}` : "";
    const rowCls = kind === "cards" ? "vos-skel-row vos-skel-card" : kind === "list" ? "vos-skel-row vos-skel-item" : "vos-skel-row";
    const extra = kind === "cards" ? `<span class="vos-skel-row vos-skel-line" aria-hidden="true"></span>` : "";
    const items = `<span class="${rowCls}" aria-hidden="true"></span>`.repeat(Math.min(rows, 20)) + extra;
    return `<div class="vos-skel${mod}" role="status" aria-live="polite" aria-label="${aria}">${items}</div>`;
}

function vosState(kind, opts = {}) {
    const { msg, hint, actionLabel, action } = opts;
    const isErr = kind === "error";
    const hintHtml = hint ? `<p class="vos-state-hint">${escapeHTML(hint)}</p>` : "";
    const actHtml = action && actionLabel
        ? `<button type="button" class="vos-btn" onclick="${action}">${escapeHTML(actionLabel)}</button>`
        : "";
    return `<div class="vos-state is-${isErr ? "error" : "empty"}" role="${isErr ? "alert" : "status"}"><p class="vos-state-msg">${escapeHTML(msg)}</p>${hintHtml}${actHtml}</div>`;
}

function packName(pack) {
    return state.currentLang === "es" ? pack.es : pack.en;
}

function arcName(meta) {
    return state.currentLang === "es" ? meta.es : meta.en;
}

const RARITY_STYLE = {
    LEGENDARY: "vos-bd--legendary",
    RARE: "vos-bd--rare",
    UNCOMMON: "vos-bd--uncommon",
    COMMON: "vos-bd--common",
};

function rarityChip(rarity) {
    const t = vosT();
    const lbl = (t.rarities || {})[rarity] || rarity;
    return `<span class="vos-bd ${RARITY_STYLE[rarity] || ""}">${escapeHTML(lbl)}</span>`;
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

    const titleMsg = (vosT().dropProbTip || "")
        .replace("{single}", singlePct)
        .replace("{pack}", packPct)
        .replace("{name}", packName(pack));

    return `<span title="${escapeHTML(titleMsg)}" class="vos-prob-badge">Prob: ${packPct}%/pack</span>`;
}

function liqBadge(slug) {
    const t = vosT();
    const liq = liquidityIndex(slug);
    if (liq.level === "loading") return `<span class="vos-liq-loading">…</span>`;
    const classes = {
        high: "vos-liq--high",
        med: "vos-liq--med",
        low: "vos-liq--low",
        none: "vos-liq--none",
    };
    const labels = { high: t.liqHigh, med: t.liqMed, low: t.liqLow, none: t.liqNone };
    const tipParts = [`${liq.volume} ${t.salesPerDay}`];
    if (liq.maxRank > 0) tipParts.push(`R0: ${liq.volumeR0}/d · R${liq.maxRank}: ${liq.volumeMax}/d`);
    if (liq.demand) tipParts.push(t.demandTip);
    const demandDot = liq.demand ? ` <span class="vos-demand-dot">●</span>` : "";
    return `<span title="${escapeHTML(tipParts.join(" · "))}" class="vos-bd vos-liq ${classes[liq.level] || ""}">${escapeHTML(labels[liq.level] || "")} · ${liq.volume}/d${demandDot}</span>`;
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
    const pName = state.currentLang === "es" ? v.bestPackEs : v.bestPackEn;
    const template = t.dissolveSpentTip || "";
    return template
        .replace("{vosfor}", meta?.vosfor ?? "")
        .replace("{plat}", v.dissolvePlat.toFixed(1))
        .replace("{pack}", pName || t.theBestPack);
}



function rankingLeaderboardCard(spend) {
    const t = vosT();
    if (!vosData) return "";

    const tabBtn = (id, lbl) => {
        const on = activeRankTab === id;
        return `<button type="button" class="vos-seg-btn" aria-pressed="${on}" onclick="setVosforRankTab('${id}')">${escapeHTML(lbl)}</button>`;
    };

    const limitBtn = (num, lbl) => {
        const on = rankLimit === num;
        return `<button type="button" class="vos-seg-btn" aria-pressed="${on}" onclick="setVosforRankLimit(${num})">${escapeHTML(lbl)}</button>`;
    };

    const nav = `
      <div class="vos-seg vos-seg--wrap" role="group" aria-label="${escapeHTML(t.subRankAria)}">
        ${tabBtn("packs", t.rankTabPacks)}
        ${tabBtn("sell", t.rankTabSell)}
        ${tabBtn("dissolve", t.rankTabDissolve)}
        ${tabBtn("buy", t.rankTabBuy)}
        ${tabBtn("liq", t.rankTabLiq)}
      </div>`;

    const subToggleBtn = (id, lbl) => {
        const on = activeRankSubToggle === id;
        return `<button type="button" class="vos-seg-btn" aria-pressed="${on}" onclick="setVosforRankSubToggle('${id}')">${escapeHTML(lbl)}</button>`;
    };

    let subToggleHtml = "";
    if (activeRankTab === "sell") {
        subToggleHtml = `
          <div class="vos-seg-row">
            <span class="vos-mode-label">${escapeHTML(t.rankModeLabel)}</span>
            ${subToggleBtn("r0", t.rankSubR0)}
            ${subToggleBtn("rmax", t.rankSubRmax)}
          </div>
        `;
    }

    const limitNav = `
      ${subToggleHtml}
      <div class="vos-seg">
        ${limitBtn(5, t.rankShowTop5)}
        ${limitBtn(10, t.rankShowTop10)}
        ${limitBtn(20, t.rankShowTop20)}
        ${limitBtn(9999, t.rankShowAll)}
      </div>`;

    let rowsHtml = "";

    if (activeRankTab === "packs") {
        const sortedPacks = [...vosData.packs]
            .map((p) => ({ pack: p, ev: computePackEV(p, vosData.arcanes) }))
            .filter((p) => p.ev.ready)
            .sort((a, b) => b.ev.rate - a.ev.rate)
            .slice(0, rankLimit);

        rowsHtml = sortedPacks.map(({ pack, ev }, idx) => {
            const syn = PACK_SYNDICATES[pack.id] || PACK_SYNDICATES.others;
            return `
              <button type="button" class="vosfor-ranking-row" onclick="toggleVosforPack('${pack.id}')">
                ${rankingMedal(idx)}
                <span class="vosfor-rank-icon">${syndicateIconHtml(syn.wikiIcon, syn.icon)}</span>
                <div class="vosfor-rank-info">
                  <div class="vosfor-rank-name">${escapeHTML(packName(pack))}</div>
                </div>
                <div class="vosfor-rank-stat">
                  <div class="vosfor-rank-val">${fmtRate(ev.rate)} <span class="vos-rank-unit">${PLAT} / ${vosforIcon()}</span></div>
                </div>
              </button>`;
        }).join("");

    } else {
        const dissolveRate = spend?.rate || 0;

        const loadedArcanes = Object.keys(vosData.arcanes)
            .filter((slug) => ARC_STATS.has(slug))
            .map((slug) => {
                const meta = vosData.arcanes[slug];
                const st = ARC_STATS.get(slug);
                const v = arcaneVerdict(slug, vosData.arcanes, spend);
                const liq = liquidityIndex(slug);
                const de = dissolveEdge(meta, st, dissolveRate);
                const vpp = vosforPerPlat(meta, st);
                return { slug, meta, st, v, liq, de, vpp, vosfor: meta.vosfor || 0 };
            })
            .filter((item) => {
                if (activeRankTab === "sell") {
                    return activeRankSubToggle === "rmax" ? item.v.sellR5 > 0 : item.v.sell > 0;
                }
                if (activeRankTab === "dissolve") return !!item.de;
                if (activeRankTab === "buy") return !!item.vpp;
                return true;
            });

        const rarities = ["LEGENDARY", "RARE", "UNCOMMON", "COMMON"];
        const rarityHeaderKey = {
            LEGENDARY: "rarityHdrLegendary",
            RARE: "rarityHdrRare",
            UNCOMMON: "rarityHdrUncommon",
            COMMON: "rarityHdrCommon",
        };
        const rarityHeaderClass = {
            LEGENDARY: "vos-rarity-hdr--legendary",
            RARE: "vos-rarity-hdr--rare",
            UNCOMMON: "vos-rarity-hdr--uncommon",
            COMMON: "vos-rarity-hdr--common",
        };

        rowsHtml = "";

        const groups = (activeRankTab === "dissolve" || activeRankTab === "buy")
            ? [{ items: loadedArcanes, header: "" }]
            : rarities.map((rarity) => ({
                items: loadedArcanes.filter((item) => item.meta.rarity === rarity),
                header: `
              <div class="vosfor-rarity-header ${rarityHeaderClass[rarity] || ""}">
                ${escapeHTML(t[rarityHeaderKey[rarity]] || "")}
              </div>
            `,
            }));

        // subtracting Infinity gives NaN: compare by a finite key
        const edgeKey = (x) => (Number.isFinite(x.de?.edge) ? x.de.edge : Number.MAX_SAFE_INTEGER);

        for (const group of groups) {
            const sorted = [...group.items];
            if (sorted.length === 0) continue;

            sorted.sort((a, b) => {
                if (activeRankTab === "sell") {
                    if (activeRankSubToggle === "rmax") return b.v.sellR5 - a.v.sellR5;
                    return b.v.sell - a.v.sell;
                }
                if (activeRankTab === "dissolve") {
                    return (edgeKey(b) - edgeKey(a)) || (b.de.dissolveValue - a.de.dissolveValue);
                }
                if (activeRankTab === "buy") {
                    return (b.vpp.ratio - a.vpp.ratio) || ((b.vpp.sellers ?? 0) - (a.vpp.sellers ?? 0)) || (b.liq.volume - a.liq.volume);
                }
                if (activeRankTab === "liq") return b.liq.volume - a.liq.volume;
                return 0;
            });

            const limitedList = sorted.slice(0, rankLimit);
            if (limitedList.length === 0) continue;

            rowsHtml += group.header;

            rowsHtml += limitedList.map(({ slug, meta, st, v, liq, de, vpp, vosfor }, idx) => {
                let subText = "";
                let mainVal = "";
                let mainValClass = "";
                let extraNameHtml = "";

                if (activeRankTab === "sell") {
                    const askNote = (ask, realizable) => (ask > 0 && ask !== realizable
                        ? ` · ${(t.rankAsking || "").replace("{pl}", `${ask}${PLAT}`)}`
                        : "");
                    const realLbl = t.rankRealizable;
                    if (activeRankSubToggle === "rmax") {
                        const maxR = v.maxRank;
                        const copiesMax = v.copiesMax;
                        const atR = (t.rankAtR || "").replace("{r}", maxR);
                        const bonusText = v.r5RankBonus > 0
                            ? ` (+${v.r5RankBonus}% ${atR})`
                            : (v.r5RankBonus < 0 ? ` (${v.r5RankBonus}% ${atR})` : "");
                        subText = (t.rankSellRmaxSub || "")
                            .replace("{r0}", `${v.sell}${PLAT}`)
                            .replace("{copies}", copiesMax)
                            .replace("{r0batch}", `${v.sell21R0}${PLAT}`)
                            + bonusText
                            + askNote(st.pem, v.sellR5);
                        mainVal = `${v.sellR5}${PLAT} <span class="vos-rank-tag">(R${maxR} · ${escapeHTML(realLbl)})</span>`;
                    } else {
                        const maxR = v.maxRank;
                        const bonusText = v.r5RankBonus > 0
                            ? (t.rankBonusBetter || "").replace("{r}", maxR).replace("{pct}", v.r5RankBonus)
                            : (v.r5RankBonus < 0 ? (t.rankBonusWarn || "").replace("{r}", maxR).replace("{pct}", Math.abs(v.r5RankBonus)) : "");
                        subText = (t.rankSellR0Sub || "").replace("{vol}", liq.volume)
                            + bonusText
                            + askNote(st.pe, v.sell);
                        mainVal = `${v.sell}${PLAT} <span class="vos-rank-tag">(R0 · ${escapeHTML(realLbl)})</span>`;
                    }
                } else if (activeRankTab === "dissolve") {
                    const copiesMax = de.copiesMax;
                    const r0Txt = st.pe > 0
                        ? `R0 ${st.pe}${PLAT}`
                        : escapeHTML(t.noMarket);
                    const rmaxTxt = st.pem > 0 && st.rm > 0 ? ` · R${st.rm} ${st.pem}${PLAT}` : "";
                    const batchEq = (de.dissolveValue * copiesMax).toFixed(1);
                    subText = `${r0Txt}${rmaxTxt} · ${liq.volume}/${escapeHTML(t.dayUnit)}`
                        + ` · ${copiesMax}x = ${vosfor * copiesMax}${vosforIcon(12)} ≈ ${batchEq}${PLAT}`;

                    extraNameHtml = (liq.level === "low" || liq.level === "none")
                        ? ` <span class="vos-low-tag">${escapeHTML(t.lowLiquidityTag)}</span>`
                        : "";

                    mainVal = Number.isFinite(de.edge)
                        ? `${de.edge.toFixed(1)}x <span class="vos-rank-note">${escapeHTML(t.vsSelling)}</span>`
                        : `<span class="vos-rank-nothing">${escapeHTML(t.nothingToLose)}</span>`;
                    mainValClass = "vos-rank-val--accent";
                } else if (activeRankTab === "buy") {
                    const sellersTxt = vpp.sellers == null ? ""
                        : ` · ${vpp.sellers} ${escapeHTML(vpp.sellers === 1 ? t.sellerOne : t.sellerMany)}`;
                    subText = `R0 ${vpp.buyPrice}${PLAT}${sellersTxt} · ${liq.volume}/${escapeHTML(t.dayUnit)}`
                        + ` · ${PACK_COST}${vosforIcon(12)} ≈ ${Math.round(vpp.platPerPack)}${PLAT}`;

                    extraNameHtml = (vpp.sellers == null ? liq.volume < 1 : vpp.sellers <= 2)
                        ? ` <span class="vos-low-tag">${escapeHTML(t.lowSupplyTag)}</span>`
                        : "";

                    mainVal = `${vpp.ratio.toFixed(1)}${vosforIcon()}<span class="vos-rank-note">/${PLAT}</span>`;
                    mainValClass = "vos-rank-val--accent";
                } else if (activeRankTab === "liq") {
                    const rankSplit = liq.maxRank > 0
                        ? `R0: ${liq.volumeR0}/d · R${liq.maxRank}: ${liq.volumeMax}/d`
                        : `R0: ${liq.volumeR0}/d`;
                    subText = `${rankSplit}`;

                    const valText = (t.salesPerDayShort || "").replace("{vol}", liq.volume);
                    mainVal = escapeHTML(valText);
                    mainValClass = "vos-rank-val--liquid";
                }

                return `
                  <div class="vosfor-ranking-row" role="button" tabindex="0" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();(this.querySelector('a')||this).click();}">
                    ${rankingMedal(idx)}
                    ${arcaneImgHtml(slug, arcName(meta))}
                    <div class="vosfor-rank-info">
                      <div class="vosfor-rank-name">
                        <a href="https://warframe.market/items/${escapeHTML(slug)}" target="_blank" rel="noopener noreferrer" class="vos-wfm-link" title="${escapeHTML(t.viewOnWfm)}">${escapeHTML(arcName(meta))}</a>${extraNameHtml}
                      </div>
                      <div class="vosfor-rank-sub">${subText}</div>
                    </div>
                    <div class="vosfor-rank-stat">
                      <div class="vosfor-rank-val ${mainValClass}">${mainVal}</div>
                    </div>
                  </div>`;
            }).join("");
        }
    }

    return `
    <div class="vosfor-ranking-section">
      <div class="vosfor-ranking-header">
        ${nav}
        ${limitNav}
      </div>
      <div class="vosfor-ranking-grid">${rowsHtml || vosSkeleton(rankLimit, t.rankingLoading, "list")}</div>
    </div>`;
}

function sortedPacksByRate() {
    if (!vosData || !vosData.packs) return [];
    return [...vosData.packs].sort((a, b) => {
        const ea = computePackEV(a, vosData.arcanes);
        const eb = computePackEV(b, vosData.arcanes);
        return (eb.ready ? eb.rate : -1) - (ea.ready ? ea.rate : -1);
    });
}

function targetProbHtml(packsNeeded, rollProb, sameRarityCount, t) {
    const probs = targetSimProbabilities(packsNeeded, rollProb, sameRarityCount, targetCopies);
    const expectedCopies = ((packsNeeded * 3) * (rollProb / Math.max(1, sameRarityCount))).toFixed(1);

    const targetPctCls = parseFloat(probs.pTargetPct) >= 50 ? "vos-text-best" : "vos-text-err-soft";

    return `
      <div class="vos-prob-avg">
        ${(t.probAvgCopies || "").replace("{n}", expectedCopies)}
      </div>
      <div class="vos-prob-card">
        <div class="vos-prob-title">${escapeHTML(t.probBreakdownTitle)}</div>
        <ul class="vos-prob-list">
          <li>${(t.probAtLeastOne || "").replace("{pct}", probs.pAtLeastOnePct)}</li>
          <li>${(t.probReachTarget || "").replace("{cls}", targetPctCls).replace("{pct}", probs.pTargetPct).replace("{qty}", targetCopies)}</li>
        </ul>
        <div class="vos-prob-note">${escapeHTML(t.probIndepNote)}</div>
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
        targetCopies = copiesForMaxRank(vosData.arcanes[targetArcSlug]);
    }

    const targetMeta = vosData.arcanes[targetArcSlug];
    const targetRarity = targetMeta?.rarity || "COMMON";

    const sameRarityItems = curPack.items.filter((s) => vosData.arcanes[s]?.rarity === targetRarity);
    const rollProb = curPack.rolls && curPack.rolls[0] ? (curPack.rolls[0][targetRarity] || 0.05) : 0.05;

    const copiesPerPack = (3 * rollProb) / Math.max(1, sameRarityItems.length);
    const defaultPacksNeeded = Math.ceil(targetCopies / Math.max(0.0001, copiesPerPack));
    const packsNeeded = targetCustomPacks !== null ? targetCustomPacks : defaultPacksNeeded;
    const pullsNeeded = packsNeeded * 3;
    const vosforNeeded = packsNeeded * (curPack.cost?.vosfor || PACK_COST);
    const creditsNeeded = packsNeeded * (curPack.cost?.credits || 50000);

    const targetArcName = targetMeta ? arcName(targetMeta) : "";
    const copyUnit = targetCopies === 1 ? t.targetSimCopy : t.targetSimCopies;
    const copiesMax = copiesForMaxRank(targetMeta);
    const rankLabel = targetCopies === copiesMax ? `(${t.targetSimRank5})` : targetCopies === 1 ? `(${t.targetSimRank0})` : "";
    const rarityLabel = (t.rarities || {})[targetRarity] || targetRarity;
    const st = ARC_STATS.get(targetArcSlug);
    const platOut = st ? Math.round(targetCopies * arcaneUnitValue(targetMeta, st)) : null;

    const explainRaw = targetCustomPacks !== null
        ? t.targetSimCustomExplanation
        : t.targetSimExplanation;

    const explainText = (explainRaw || "")
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

    const valVosforNum = document.getElementById("target-val-vosfor-num");
    if (valVosforNum) valVosforNum.textContent = vosforNeeded.toLocaleString();

    const pullsInput = document.getElementById("target-pulls-input");
    if (pullsInput && document.activeElement !== pullsInput) pullsInput.value = packsNeeded;

    const valPulls = document.getElementById("target-val-pulls");
    if (valPulls) valPulls.textContent = pullsNeeded.toLocaleString();

    const valCreditsNum = document.getElementById("target-val-credits-num");
    if (valCreditsNum) valCreditsNum.textContent = `${(creditsNeeded / 1000000).toFixed(2)}M`;

    const valPlatNum = document.getElementById("target-val-plat-num");
    if (valPlatNum) valPlatNum.textContent = platOut !== null ? platOut.toLocaleString() : "…";

    const explainBox = document.getElementById("target-explain-box");
    if (explainBox) explainBox.innerHTML = `${explainText} ${escapeHTML(t.targetSimProbNote || "")}.`;

    const probBox = document.getElementById("target-prob-box");
    if (probBox) probBox.innerHTML = targetProbHtml(packsNeeded, rollProb, sameRarityItems.length, t);

    container.querySelectorAll(".vosfor-target-preset-btn").forEach((btn) => {
        const val = parseInt(btn.getAttribute("data-preset"), 10);
        btn.classList.toggle("active", val === targetCopies);
        btn.setAttribute("aria-pressed", String(val === targetCopies));
    });
}

function buildTargetDropdownItems(el) {
    if (!vosData || !vosData.packs || el.dataset.built) return;
    const items = [];
    for (const p of sortedPacksByRate()) {
        for (const slug of p.items) {
            const meta = vosData.arcanes[slug];
            if (!meta) continue;
            const active = slug === targetArcSlug ? "active-sort-item" : "";
            items.push(`
              <div class="dropdown-item ${active}" data-slug="${slug}" data-pack="${p.id}" data-search="${escapeHTML((arcName(meta) + " " + packName(p)).toLowerCase())}" onclick="globalThis.selectTargetArcane('${slug}', '${p.id}')">
                ${arcaneImgHtml(slug, arcName(meta))}
                <div class="vos-dd-body">
                  <div class="vos-dd-title">${escapeHTML(arcName(meta))}</div>
                  <div class="vos-dd-sub">${escapeHTML(packName(p))} · ${rarityChip(meta.rarity)}</div>
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
    targetCopies = copiesForMaxRank(vosData?.arcanes?.[slug]);
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
                targetCopies = copiesForMaxRank(meta);
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
        targetCopies = copiesForMaxRank(vosData.arcanes[targetArcSlug]);
    }

    const targetMeta = vosData.arcanes[targetArcSlug];
    const targetRarity = targetMeta?.rarity || "COMMON";

    const sameRarityItems = curPack.items.filter((s) => vosData.arcanes[s]?.rarity === targetRarity);
    const rollProb = curPack.rolls && curPack.rolls[0] ? (curPack.rolls[0][targetRarity] || 0.05) : 0.05;

    const copiesPerPack = (3 * rollProb) / Math.max(1, sameRarityItems.length);
    const defaultPacksNeeded = Math.ceil(targetCopies / Math.max(0.0001, copiesPerPack));
    const packsNeeded = targetCustomPacks !== null ? targetCustomPacks : defaultPacksNeeded;
    const pullsNeeded = packsNeeded * 3;
    const vosforNeeded = packsNeeded * (curPack.cost?.vosfor || PACK_COST);
    const creditsNeeded = packsNeeded * (curPack.cost?.credits || 50000);

    const packOptions = sortedPacksByRate().map((p) => {
        const sel = p.id === curPack.id ? "selected" : "";
        return `<option value="${p.id}" ${sel}>${escapeHTML(packName(p))}</option>`;
    }).join("");

    const btnPreset = (num, lbl) => {
        const on = targetCopies === num;
        return `<button type="button" class="vos-chip vosfor-target-preset-btn ${on ? "active" : ""}" aria-pressed="${on}" data-preset="${num}" onclick="setTargetCopiesPreset(${num})">${escapeHTML(lbl)}</button>`;
    };

    const maxR = targetMeta ? (targetMeta.maxRank ?? 5) : 5;
    const copiesMax = copiesForMaxRank(targetMeta);
    const st = ARC_STATS.get(targetArcSlug);
    const platOut = st ? Math.round(targetCopies * arcaneUnitValue(targetMeta, st)) : null;

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

    const copyUnit = targetCopies === 1 ? t.targetSimCopy : t.targetSimCopies;
    const rankLabel = targetCopies === copiesMax ? `(${t.targetSimRank5})` : targetCopies === 1 ? `(${t.targetSimRank0})` : "";
    const rarityLabel = (t.rarities || {})[targetRarity] || targetRarity;

    const explainRaw = t.targetSimExplanation || "";

    const wfmLink = targetArcSlug ? `<a href="https://warframe.market/items/${escapeHTML(targetArcSlug)}" target="_blank" rel="noopener noreferrer" class="vos-wfm-link--underline" title="${escapeHTML(t.viewOnWfm)}">${escapeHTML(targetArcName)}</a>` : escapeHTML(targetArcName);

    const explainText = explainRaw
        .replace("{qty}", targetCopies)
        .replace("{arcane}", wfmLink)
        .replace("{rarity}", escapeHTML(rarityLabel))
        .replace("{pack}", escapeHTML(packName(curPack)))
        .replace("{packs}", packsNeeded.toLocaleString())
        .replace("{pulls}", (packsNeeded * 3).toLocaleString());

    return `
    <div id="vosfor-target-widget" class="vosfor-target-widget">
      <div class="vosfor-target-controls">
        <div>
          <label class="vos-ctl-label">${escapeHTML(t.targetSimPackLabel)}</label>
          <select class="wf-input vosfor-select" onchange="onTargetPackChange(this.value)">${packOptions}</select>
        </div>
        <div class="vos-rel">
          <label class="vos-ctl-label">${escapeHTML(t.targetSimArcLabel)}</label>
          <div class="custom-dropdown-container vos-dd-wrap">
            <input type="text" id="targetArcInput" class="wf-input vosfor-search-input vos-input-pr" placeholder="${escapeHTML(t.searchArcanePlaceholder)}" autocomplete="off" value="${escapeHTML(targetArcName)}" onfocus="globalThis.showTargetArcDropdown()" oninput="globalThis.filterTargetArcDropdown(this.value)">
            <div id="targetArcDropdown" class="custom-dropdown vos-dropdown-menu hidden">
            </div>
          </div>
        </div>
        <div class="vos-col-span-1">
          <label class="vos-ctl-label vos-ctl-label--tight">${escapeHTML(t.targetSimQtyLabel)}</label>
          <div class="vos-qty-badge-row">
            <span id="target-qty-badge" class="vos-qty-badge">${targetCopies} ${escapeHTML(copyUnit)} ${escapeHTML(rankLabel)}</span>
          </div>
          <input id="target-copies-slider" type="range" class="vosfor-slider" min="1" max="${Math.max(copiesMax * 2, targetCopies * 2, 42)}" step="1" value="${targetCopies}" oninput="onTargetCopiesChange(this.value)">
          <div class="vosfor-preset-group vos-preset-group--spread">
            ${presetsHtml}
          </div>
        </div>
      </div>
      <div class="vosfor-stat-cards">
        <div class="vosfor-stat-card">
          <div class="vosfor-stat-card-label">${escapeHTML(t.targetSimVosforNeed)}</div>
          <div id="target-val-vosfor" class="vosfor-stat-card-val"><span id="target-val-vosfor-num">${vosforNeeded.toLocaleString()}</span> ${vosforIcon()}</div>
        </div>
        <div class="vosfor-stat-card">
          <div class="vosfor-stat-card-label vos-stat-label-row">
            <span>${escapeHTML(t.targetSimPullsNeed)}</span>
            <span class="vos-editable-tag">${escapeHTML(t.editable)}</span>
          </div>
          <div class="vos-pulls-row">
            <input id="target-pulls-input" type="number" class="vosfor-calc-input vos-pulls-input" min="1" max="999999" value="${packsNeeded}" oninput="onTargetPacksChange(this.value)" title="${escapeHTML((t.targetSimPullsTip || "").replace("{cost}", PACK_COST))}">
            <span class="vos-pulls-count">(<span id="target-val-pulls">${pullsNeeded.toLocaleString()}</span> ${escapeHTML(t.arcanes)})</span>
          </div>
        </div>
        <div class="vosfor-stat-card">
          <div class="vosfor-stat-card-label">${escapeHTML(t.targetSimCreditsNeed)}</div>
          <div id="target-val-credits" class="vosfor-stat-card-val vos-text-gold"><span id="target-val-credits-num">${(creditsNeeded / 1000000).toFixed(2)}M</span> ${creditsIcon(15)}</div>
        </div>
        <div class="vosfor-stat-card">
          <div class="vosfor-stat-card-label">${escapeHTML(t.targetSimPlatNeed)}</div>
          <div id="target-val-plat" class="vosfor-stat-card-val vos-text-best"><span id="target-val-plat-num">${platOut !== null ? platOut.toLocaleString() : "…"}</span>${PLAT}</div>
        </div>
      </div>
      <div id="target-explain-box" class="vos-target-explain">
        ${explainText} ${escapeHTML(t.targetSimProbNote || "")}.
      </div>
      <div id="target-prob-box" class="vos-target-prob">
        ${targetProbHtml(packsNeeded, rollProb, sameRarityItems.length, t)}
      </div>
    </div>`;
}

function sellRateInfo() {
    if (!vosData) return null;
    if (sellRatePackId !== "auto") {
        const pack = vosData.packs.find((p) => p.id === sellRatePackId);
        if (pack) {
            const ev = computePackEV(pack, vosData.arcanes);
            if (ev.ready && ev.rate > 0) {
                return { rate: ev.rate, pack, custom: true };
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
    const isMax = sellRank === "max";
    const maxRank = Math.min(meta.maxRank ?? 5, 5);
    const bestRate = sellRateInfo();

    const unitPrice = st ? (isMax ? (st.pem || 0) : (st.pe || 0)) : null;
    const sim = sellSimVerdict(meta, st, { isMax, qty: sellQty, liqRate: bestRate?.rate || 0 });

    const liq = liquidityIndex(sellArcSlug);
    const bestBuy = st ? (isMax ? (st.bbm || 0) : (st.bb || 0)) : 0;
    const volume = st ? (isMax ? Math.round(st.vm || 0) : Math.round(st.v || 0)) : 0;

    return { meta, st, maxRank, isMax, unitPrice, bestRate, sim, liq, bestBuy, volume };
}

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
        const on = btn.getAttribute("data-rank") === sellRank;
        btn.classList.toggle("active", on);
        btn.setAttribute("aria-pressed", String(on));
        if (btn.getAttribute("data-rank") === "max" && m) {
            btn.textContent = `R${m.maxRank} (max)`;
        }
    });

    const isFailed = m && !m.st && FAILED_STATS.has(sellArcSlug);
    const signature = m && m.st
        ? [sellArcSlug, sellRank, sellQty, sellRatePackId, m.sim.verdict, m.bestRate ? fmtRate(m.bestRate.rate) : "-", m.unitPrice > 0 ? 1 : 0, state.currentLang].join("|")
        : m ? (isFailed ? `failed|${sellArcSlug}|${state.currentLang}` : `loading|${state.currentLang}`) : "empty";

    if (signature !== lastSellSignature || !box.firstElementChild) {
        lastSellSignature = signature;

        if (!m) {
            box.innerHTML = `<div class="vos-sell-msg">${escapeHTML(t.sellSimPick)}</div>`;
            return;
        }
        if (!m.st) {
            if (isFailed) {
                box.innerHTML = `<div class="state-error"><span>${escapeHTML(t.noMarketPrice)}</span><button type="button" class="state-retry">${escapeHTML(t.retry)}</button></div>`;
                box.querySelector(".state-retry")?.addEventListener("click", () => retryArcaneStats(sellArcSlug));
                return;
            }
            box.innerHTML = vosSkeleton(3, t.loadingPrices, "cards");
            return;
        }

        const noMarket = `<span class="vos-sell-nomarket">${escapeHTML(t.noMarket)}</span>`;

        const ratePackName = m.bestRate ? packName(m.bestRate.pack) : "";
        const rateNote = m.bestRate
            ? (m.bestRate.custom
                ? (t.sellSimSpendCustom || "").replace("{pack}", ratePackName)
                : (t.sellSimSpendBest || "").replace("{pack}", ratePackName))
            : t.sellSimWaitPacks;

        const verdictMap = {
            sell_r0: { txt: t.verdictSellR0, css: "verdict-sell" },
            sell_max: { txt: `${t.verdictSell} R${m.maxRank}`, css: "verdict-sell" },
            dissolve: { txt: t.verdictDissolve, css: "verdict-dissolve" },
            even: { txt: t.verdictEven, css: "verdict-even" },
            nodata: { txt: t.verdictNoData, css: "verdict-even" },
            pending: { txt: "…", css: "verdict-even" },
        };
        const vd = verdictMap[m.sim.verdict] || verdictMap.pending;

        const optMergeLabel = (t.sellSimOptMerge || "")
            .replace("{rank}", m.maxRank)
            .replace("{copies}", m.sim.copiesMax);

        const fullSets = Math.floor(m.sim.totalCopies / m.sim.copiesMax);
        const remCopies = m.sim.totalCopies % m.sim.copiesMax;
        const mergeDetail = fullSets > 0
            ? (remCopies > 0 ? `${fullSets}× R${m.maxRank} + ${remCopies}× R0` : `${fullSets}× R${m.maxRank}`)
            : `${m.sim.totalCopies}/${m.sim.copiesMax} R0`;

        const unitNote = (t.sellSimUnitNote || "")
            .replace("{rank}", m.maxRank)
            .replace("{copies}", m.sim.copiesMax)
            .replace("{vosfor}", m.meta.vosfor);

        box.innerHTML = `
          <div class="vosfor-stat-cards">
            <div class="vosfor-stat-card">
              <div class="vosfor-stat-card-label">${escapeHTML(t.sellSimOptR0)} (<span data-f="r0qty">${m.sim.totalCopies}× R0</span>)</div>
              <div class="vosfor-stat-card-val vos-text-best">${m.sim.sellR0Value > 0 ? `<span data-f="saler0">${Math.round(m.sim.sellR0Value)}</span>${PLAT}` : noMarket}</div>
            </div>
            <div class="vosfor-stat-card">
              <div class="vosfor-stat-card-label">${escapeHTML(optMergeLabel)}</div>
              <div class="vosfor-stat-card-val vos-text-best">${m.sim.mergeValue !== null && m.sim.mergeValue > 0 ? `<span data-f="salemerge">${Math.round(m.sim.mergeValue)}</span>${PLAT}` : noMarket}</div>
              <div data-f="mergedetail" class="vos-sell-sub">${escapeHTML(mergeDetail)}</div>
            </div>
            <div class="vosfor-stat-card">
              <div class="vosfor-stat-card-label">${escapeHTML(t.sellSimOptDissolve)}</div>
              <div class="vosfor-stat-card-val vos-text-accent"><span data-f="equiv">${m.sim.dissolveValue !== null ? m.sim.dissolveValue.toFixed(1) : "…"}</span>${m.sim.dissolveValue !== null ? PLAT : ""}</div>
              <div class="vos-sell-sub--accent"><span data-f="tvos">${m.sim.totalVosfor.toLocaleString()}</span>${vosforIcon(12)}</div>
            </div>
          </div>
          <div class="vos-sell-verdict-row">
            <span class="verdict-tag ${vd.css} vos-verdict-tag--lg">${escapeHTML(vd.txt)}</span>
            <span class="vos-sell-verdict-note">${escapeHTML(t.sellVsDissolve)} ${escapeHTML(rateNote)}</span>
          </div>
          <div class="vos-sell-liq-row"><span data-f="liq"></span>${PLAT}</div>
          <div class="vos-sell-unit-note">${escapeHTML(unitNote)}</div>`;
    }

    if (!m || !m.st) return;

    const set = (f, txt) => {
        const el = box.querySelector(`[data-f="${f}"]`);
        if (el) el.textContent = txt;
    };
    const rankLbl = m.isMax ? `R${m.maxRank}` : "R0";
    set("r0qty", `${m.sim.totalCopies}× R0`);
    set("saler0", Math.round(m.sim.sellR0Value));
    if (m.sim.mergeValue !== null) set("salemerge", Math.round(m.sim.mergeValue));
    set("tvos", m.sim.totalVosfor.toLocaleString());
    set("equiv", m.sim.dissolveValue !== null ? m.sim.dissolveValue.toFixed(1) : "…");
    set("liq", (t.sellSimLiqLine || "")
        .replace("{rank}", rankLbl)
        .replace("{vol}", m.volume)
        .replace("{buy}", m.bestBuy));
}

function ensureSellArcSlug() {
    if (!vosData?.arcanes) return "";
    if (!sellArcSlug || !vosData.arcanes[sellArcSlug]) {
        sellArcSlug = Object.keys(vosData.arcanes).sort()[0] || "";
    }
    return sellArcSlug;
}

function sellSimulatorCard() {
    const t = vosT();
    if (!vosData || !vosData.arcanes) return "";

    ensureSellArcSlug();
    const meta = vosData.arcanes[sellArcSlug];
    const maxRank = Math.min(meta?.maxRank ?? 5, 5);
    const selName = meta ? arcName(meta) : "";

    const rankBtn = (r, lbl) => `
      <button type="button" class="vos-seg-btn vosfor-sell-rank-btn ${sellRank === r ? "active" : ""}" aria-pressed="${sellRank === r}" data-rank="${r}" onclick="setSellRank('${r}')">${escapeHTML(lbl)}</button>`;

    return `
    <div id="vosfor-sell-widget" class="vosfor-target-widget vos-sell-widget">
      <div class="vosfor-target-controls">
        <div class="vos-rel">
          <label class="vos-ctl-label">${escapeHTML(t.sellSimArcLabel)}</label>
          <div class="custom-dropdown-container vos-dd-wrap">
            <input type="text" id="sellArcInput" class="wf-input vosfor-search-input vos-input-pr" placeholder="${escapeHTML(t.searchArcanePlaceholder)}" autocomplete="off" value="${escapeHTML(selName)}" onfocus="globalThis.showSellArcDropdown()" oninput="globalThis.filterSellArcDropdown(this.value)">
            <div id="sellArcDropdown" class="custom-dropdown vos-dropdown-menu vos-dropdown-menu--sell hidden"></div>
          </div>
        </div>
        <div>
          <label class="vos-ctl-label">${escapeHTML(t.sellSimRankLabel)}</label>
          <div class="vos-seg vos-seg--fill" role="group" aria-label="${escapeHTML(t.sellSimRankLabel)}">
            ${rankBtn("r0", "R0")}
            ${rankBtn("max", `R${maxRank} (max)`)}
          </div>
        </div>
        <div>
          <label class="vos-ctl-label vos-ctl-label--mb2">${escapeHTML(t.sellSimQtyLabel)} <span id="sell-qty-badge" class="vos-sell-qty-badge">x${sellQty}</span></label>
          <div class="vos-sell-qty-row">
            <input id="sell-qty-slider" type="range" class="vosfor-slider vos-flex-1" min="1" max="${Math.max(50, sellQty * 2)}" step="1" value="${sellQty}" oninput="onSellQtyChange(this.value)">
            <input id="sell-qty-input" type="number" class="vosfor-calc-input vos-sell-qty-input" min="1" max="99999" value="${sellQty}" oninput="onSellQtyChange(this.value)">
          </div>
        </div>
        <div>
          <label class="vos-ctl-label">${escapeHTML(t.sellSimRatePackLabel)}</label>
          <select class="wf-input vosfor-select" onchange="globalThis.onSellRatePackChange(this.value)">
            <option value="auto" ${sellRatePackId === "auto" ? "selected" : ""}>${escapeHTML(t.sellSimRatePackAuto)}</option>
            ${sortedPacksByRate().map((p) => `<option value="${p.id}" ${p.id === sellRatePackId ? "selected" : ""}>${escapeHTML(packName(p))}</option>`).join("")}
          </select>
        </div>
      </div>
      <div id="sell-sim-results" class="vos-mt-8"></div>
    </div>`;
}

export function onSellRatePackChange(packId) {
    sellRatePackId = packId || "auto";
    if (sellRatePackId !== "auto" && vosData) {
        const pack = vosData.packs.find((p) => p.id === sellRatePackId);
        if (pack) requestPackStats(pack, true).catch(console.error);
    }
    updateSellSimDOM();
}

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
            <div class="vos-dd-body">
              <div class="vos-dd-title">${escapeHTML(arcName(am))}</div>
              <div class="vos-dd-sub">${rarityChip(am.rarity)} · ${am.vosfor}${vosforIcon()}</div>
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

function bestActionBadge(v, slug) {
    if (!v || v.bestAction === "pending" || v.bestAction === undefined) {
        return `<span class="vos-pending-dots">…</span>`;
    }
    const t = vosT();
    const map = {
        sell_r0: t.verdictSellR0,
        sell_max: `${t.verdictSell} R${v.maxRank}`,
        dissolve: t.verdictDissolve,
        even: t.verdictEven,
        nodata: t.verdictNoData,
    };
    const txt = map[v.bestAction] || map.even;
    const level = liquidityIndex(slug).level;
    const lvl = level === "high" ? "high" : level === "med" ? "med" : "low";
    let tip;
    if (v.bestAction === "nodata") {
        tip = t.verdictNoDataTip || "";
    } else {
        const dissolveVal = (v.netDissolveAdj ?? v.dissolvePlat21 ?? 0).toFixed(1);
        tip = (t.verdictBatchTip || "")
            .replaceAll("{copies}", v.copiesMax)
            .replace("{rank}", v.maxRank)
            .replace("{r5}", v.sellR5)
            .replace("{r0}", v.sell)
            .replace("{dissolve}", dissolveVal);
    }
    let warn = "";
    if (v.gambleWarning) {
        const wtip = (t.gambleTip || "").replace("{plat}", v.guaranteedBest);
        warn = ` <span class="vos-gamble" data-tooltip="${escapeHTML(wtip)}">${escapeHTML(t.gambleTag)}</span>`;
    }
    return `<span class="vos-verdict vos-verdict--${lvl} vos-help" tabindex="0" data-tooltip="${escapeHTML(tip)}">${escapeHTML(txt)}</span>${warn}`;
}

function arcaneSigClass(v) {
    if (!v) return "sig-even";
    if (v.bestAction === "sell_r0" || v.bestAction === "sell_max") return "sig-sell";
    if (v.bestAction === "dissolve") return "sig-dissolve";
    return "sig-even";
}

function arcaneRow(slug, spend, parentPack) {
    const t = vosT();
    const meta = vosData.arcanes[slug];
    if (!meta) return "";
    const st = ARC_STATS.get(slug);
    const v = arcaneVerdict(slug, vosData.arcanes, spend);

    let priceCell = `<span class="vos-price-loading">…</span>`;
    if (st) {
        const r0 = st.pe || 0;
        const rmax = st.pem || 0;
        const parts = [];
        parts.push(r0 > 0
            ? `R0 <b>${r0}</b>${PLAT}`
            : `<span class="vos-nomarket">${escapeHTML(t.noMarket)}</span>`);
        if (rmax > 0 && st.rm > 0) parts.push(`R${st.rm} <b>${rmax}</b>${PLAT}`);
        priceCell = `<span class="vos-col-price">${parts.join(" · ")}</span>`;
    }

    const dissolveTip = getDissolveTip(v, t, meta);
    const dissolveCell = v.dissolvePlat !== null && v.dissolvePlat !== undefined && st
        ? `<span data-tooltip="${escapeHTML(dissolveTip)}" class="vos-col-dissolve vos-help">${meta.vosfor}${vosforIcon()} ≈ ${v.dissolvePlat.toFixed(1)}${PLAT}</span>`
        : `<span class="vos-col-dissolve">${meta.vosfor}${vosforIcon()}</span>`;

    const nm = escapeHTML(arcName(meta));
    const href = `https://warframe.market/items/${escapeHTML(slug)}`;

    return `
    <div class="vos-arc ${arcaneSigClass(v)}">
      <div class="vos-arc-img">${arcaneImgHtml(slug, arcName(meta))}</div>
      <div class="vos-arc-nm">
        <a class="vos-arc-link" href="${href}" target="_blank" rel="noopener">${nm}</a>
        <div class="vos-arc-meta">
          ${rarityChip(meta.rarity)}${liqBadge(slug)}
          <span class="vos-arc-acts">
            <button type="button" class="vos-arc-act" title="${escapeHTML(t.simulateTip)}" onclick="simulateArcane('${escapeHTML(slug)}')">${escapeHTML(t.simulate)}</button>
          </span>
        </div>
      </div>
      <div class="vos-arc-pr">${priceCell}</div>
      <div class="vos-arc-ds">${dissolveCell}</div>
      <div class="vos-arc-vd">${bestActionBadge(v, slug)}</div>
    </div>`;
}

function searchResultsCard(spend) {
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
        return vosState("noresults", {
            msg: (t.searchNoResults || "").replace("{q}", searchQuery),
            actionLabel: t.searchClear,
            action: "onVosforSearchClear()",
        });
    }

    const rows = matchingSlugs.map((slug) => arcaneRow(slug, spend)).join("");

    return `
    <div class="vosfor-ranking-section vos-search-results">
      <div class="vosfor-ranking-header">
        <div class="vosfor-ranking-title vos-text-accent">
          ${escapeHTML(t.searchResultsTitle)} (${matchingSlugs.length} ${escapeHTML(matchingSlugs.length === 1 ? t.targetSimCopy : t.targetSimCopies)})
        </div>
      </div>
      <div class="vos-rows-box">${rows}</div>
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
        .map((s) => `<span class="vos-nowrap">${name(s)} <b class="vos-text-best">${ARC_STATS.get(s).pe}${PLAT}</b></span>`)
        .join(" · ");

    const byVosforValue = [...loaded]
        .sort((a, b) => (vosData.arcanes[b].vosfor || 0) - (vosData.arcanes[a].vosfor || 0))
        .slice(0, 3)
        .map((s) => `<span class="vos-nowrap">${name(s)} <b class="vos-text-accent">${vosData.arcanes[s].vosfor}${vosforIcon()}</b></span>`)
        .join(" · ");

    return `
    <div class="vosfor-highlights">
      <div><span class="vos-hl-sell">${escapeHTML(t.bestToSell)}</span> ${sellList || "-"}</div>
      <div><span class="vos-hl-dissolve">${escapeHTML(t.bestToDissolve)}</span> ${byVosforValue}</div>
    </div>`;
}


function renderOthersGrouped(pack, spend) {
    const t = vosT();
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
        const rows = g.slugs.map((s) => arcaneRow(s, spend, pack)).join("");
        const isJadeGroup = g.info.wikiIcon && g.info.wikiIcon.includes("JadeShadows");
        const extraClass = isJadeGroup ? "jade-easter-egg-header" : "";
        const easterEggHtml = isJadeGroup
            ? `<canvas id="jade-cosmic-canvas" class="jade-cosmic-canvas"></canvas>`
            : "";
        const hunhowQuoteHtml = isJadeGroup
            ? `<div class="hunhow-meme-quote">"I , am Hunhow.Sirius, Orion, stop fighting... fetch me my remote, Pop Pop wants to watch NASCAR." <span class="hunhow-author">- Hunhow</span></div>`
            : "";
        html += `
          <div class="vosfor-syndicate-group-header ${extraClass}" ${isJadeGroup ? `onclick="globalThis.toggleHunhowMemeQuote(this)" title="${escapeHTML(t.jadeToggle)}"` : ""}>
            ${easterEggHtml}
            ${syndicateIconHtml(g.info.wikiIcon, g.info.icon)}
            <div class="vos-syn-grp-info">
              <span>${escapeHTML(synName)} (${g.slugs.length})</span>
              ${hunhowQuoteHtml}
            </div>
          </div>
          <div class="vos-rows-box vos-rows-box--mb">${rows}</div>`;
    }
    return html || vosState("empty", { msg: t.othersNoResults });
}

export function packBodyHtml(pack, bestRate = bestPackRate(vosData)) {
    if (!vosData) return "";
    const t = vosT();
    const isOthers = pack.id === "others";
    const itemsMatching = sortedPackItems(pack);

    const sortBtn = (v, lbl, short) => {
        const on = packSort === v;
        const label = short
            ? `<span class="vos-lbl-long">${escapeHTML(lbl)}</span><span class="vos-lbl-short" title="${escapeHTML(lbl)}">${escapeHTML(short)}</span>`
            : escapeHTML(lbl);
        return `<button type="button" class="vos-seg-btn" aria-pressed="${on}" onclick="setVosforSort('${v}')">${label}</button>`;
    };
    const sortBar = `
      <div class="vos-sort-bar">
        <span class="vos-sort-label">${escapeHTML(t.sortBy)}</span>
        <div class="vos-seg vos-seg--wrap" role="group" aria-label="${escapeHTML(t.sortAria)}">
          ${sortBtn("balanced", t.sortBalanced)}${sortBtn("price", t.sortPrice)}${sortBtn("rarity", t.sortRarity)}${sortBtn("vosfor", t.sortVosfor)}${sortBtn("liq", t.sortLiq, t.sortLiqShort)}
        </div>
      </div>`;

    const header = `
      <div class="vos-arc-head" aria-hidden="true">
        <span>${escapeHTML(t.hdrArcane)}</span>
        <span>${escapeHTML(t.hdrPrice)}</span>
        <span>${escapeHTML(t.hdrDissolve)}</span>
        <span>${escapeHTML(t.hdrVerdict)}</span>
      </div>`;

    if (isOthers) {
        return `
          <div class="vos-mt-8">
            ${sortBar}
            ${header}
            ${renderOthersGrouped(pack, bestRate)}
          </div>`;
    }
    const rows = itemsMatching.map((s) => arcaneRow(s, bestRate, pack)).join("");
    return `
      <div class="vos-mt-8">
        ${packHighlights(pack, bestRate)}
        ${sortBar}
        ${header}
        <div class="vos-rows-box">${rows}</div>
      </div>`;
}

function packCard(pack, bestRate) {
    const t = vosT();
    const isOthers = pack.id === "others";
    const ev = computePackEV(pack, vosData.arcanes);

    const itemsMatching = sortedPackItems(pack);
    if (searchQuery.trim() && itemsMatching.length === 0) {
        return "";
    }

    const isOpen = expandAllPacks || expandedPack === pack.id || (searchQuery.trim().length > 0);
    const isBestEv = !isOthers && bestRate && bestRate.packId === pack.id;
    const syn = PACK_SYNDICATES[pack.id] || PACK_SYNDICATES.others;
    const cost = pack.cost?.vosfor || PACK_COST;

    let evHtml;
    let topHtml = "";
    if (isOthers) {
        evHtml = ev.ready
            ? ""
            : `<span class="vos-pack-loading">${escapeHTML(t.loadingPrices)} ${ev.loaded}/${ev.total}</span>`;
    } else if (ev.ready) {
        const rateCls = isBestEv ? "vos-rate-val--best" : "vos-rate-val--normal";
        const netPlatTxt = escapeHTML((t.packNetPlat || "")
            .replace("{pl}", Math.round(ev.evPlat))
            .replace("{cost}", cost))
            .replace("{platIcon}", PLAT)
            .replace("{vosIcon}", vosforIcon());
        evHtml = `
          <span class="vos-pack-rate ${rateCls}">
            ${netPlatTxt}
          </span>
          <span class="vos-ev-detail-end">
            ${sellSpeedChip(ev.avgVolume)}
          </span>`;
        if (ev.top && ev.top.packsForMax !== null) {
            const topMeta = vosData.arcanes[ev.top.slug];
            const topName = topMeta ? arcName(topMeta) : ev.top.slug;
            const topRank = Math.min(topMeta?.maxRank ?? 5, 5);
            const topLine = escapeHTML((t.packTopArcane || "")
                .replace("{name}", topName)
                .replace("{rank}", topRank)
                .replace("{packs}", Math.round(ev.top.packsForMax).toLocaleString())
                .replace("{vosfor}", Math.round(ev.top.vosforForMax).toLocaleString())
                .replace("{pl}", Math.round(ev.top.netMax).toLocaleString()))
                .replace("{platIcon}", PLAT)
                .replace("{vosIcon}", vosforIcon(13));
            topHtml = `<span class="vos-pack-sub vos-pack-top">${topLine}</span>`;
        }
    } else {
        evHtml = `<span class="vos-pack-loading">${escapeHTML(t.loadingPrices)} ${ev.loaded}/${ev.total}</span>`;
    }

    const bestEvTag = isBestEv
        ? `<span class="badge-vosfor badge-best-spend">${escapeHTML(t.bestPack)}</span>`
        : "";

    const body = isOpen ? packBodyHtml(pack, bestRate) : "";

    const synName = state.currentLang === "es" ? syn.es : syn.en;

    return `
    <section class="vos-pack${isBestEv ? " is-best" : ""}">
      <button type="button" class="vos-pack-head" aria-expanded="${isOpen ? "true" : "false"}" aria-controls="vosfor-pack-body-${pack.id}" onclick="toggleVosforPack('${pack.id}')">
        ${syndicateIconHtml(syn.wikiIcon, syn.icon)}
        <span class="vos-pack-main">
          <span class="vos-pack-nm">
            ${isOthers ? escapeHTML(t.othersTitle) : escapeHTML(packName(pack))}
            ${bestEvTag}
          </span>
          <span class="vos-pack-sub vos-pack-sub-row">
            <span class="vos-pack-syn-name">${escapeHTML(synName)}</span>
            <span>· ${pack.items.length} ${escapeHTML(t.arcanes)}</span>
            ${isOthers ? "" : `<span>· ${cost}${vosforIcon()} + ${(pack.cost.credits / 1000)}k${creditsIcon()}</span>`}
          </span>
          ${topHtml}
        </span>
        <span class="vos-pack-ev">${evHtml}</span>
        <span class="vos-caret" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg></span>
      </button>
      <div class="vos-pack-body" id="vosfor-pack-body-${pack.id}">${body}</div>
    </section>`;
}

function guideSeen() {
    try {
        return localStorage.getItem("vosfor_guide_seen") !== null;
    } catch (e) {
        return false;
    }
}

function markGuideSeen() {
    try {
        localStorage.setItem("vosfor_guide_seen", "1");
    } catch (e) {
        return;
    }
}

function guideBoxCard() {
    const t = vosT();
    const steps = [1, 2, 3, 4, 5].map((n) => `
          <div class="vos-guide-item">
            <b>${escapeHTML(t[`guideStep${n}Title`] || "")}</b>
            ${escapeHTML(t[`guideStep${n}Desc`] || "")}
          </div>`).join("");
    return `
    <details class="vos-guide"${guideSeen() ? "" : " open"} ontoggle="globalThis.onVosforGuideToggle()">
      <summary class="vos-guide-sum">${escapeHTML(t.guideTitle)}</summary>
      <div class="vos-guide-note">${escapeHTML(t.guideR5Note || "")}</div>
      <div class="vos-guide-grid">${steps}
      </div>
    </details>`;
}

function searchAndControlsBar() {
    const t = vosT();

    return `
    <div class="vosfor-search-bar vos-search-bar-row">
      <input type="text" id="arcaneInput" class="wf-input vosfor-search-input vos-search-input" placeholder="${escapeHTML(t.searchPlaceholder)}" autocomplete="off" value="${escapeHTML(searchQuery)}" oninput="globalThis.onVosforSearchInput(this.value)">
      <button type="button" class="vos-btn vos-expand-all-btn" onclick="toggleVosforExpandAll()">
        ${expandAllPacks ? escapeHTML(t.collapseAll) : escapeHTML(t.expandAll)}
      </button>
    </div>`;
}

function pixCard(bestRate) {
    if (!vosData?.hex_pix) return "";
    const t = vosT();
    const pr = pixRank(vosData, bestRate);

    const rows = pr.rows.map((r, i) => {
        const name = arcName(r.meta);
        const vals = r.ready
            ? `<span class="vosfor-pix-val"><b>${r.platPerPix}</b>${PLAT}/pix</span><span class="vosfor-pix-val vosfor-pix-dim">· R0 ${r.sellR0}${PLAT}</span><span class="vosfor-pix-val vosfor-pix-dim">· ${r.pix} pix</span>`
            : `<span class="vosfor-pix-val vosfor-pix-dim">${escapeHTML(t.loading)}</span><span></span><span></span>`;
        return `<div class="vosfor-pix-row">
            <span class="vosfor-pix-medal">${rankingMedal(i)}</span>
            ${arcaneImgHtml(r.slug, name)}
            <span class="vosfor-pix-name">${escapeHTML(name)}</span>
            ${vals}
        </div>`;
    }).join("");

    const vosforRow = `<div class="vosfor-pix-row vosfor-pix-row--vosfor">
        <span class="vosfor-pix-medal">${vosforIcon(15)}</span>
        <span class="vosfor-pix-icon-slot" aria-hidden="true"></span>
        <span class="vosfor-pix-name">${escapeHTML((t.pixSpendOnVosfor || "").replace("{cost}", PACK_COST))}</span>
        <span class="vosfor-pix-val"><b>${pr.vosforPlatPerPix}</b>${PLAT}/pix</span>
        <span></span>
        <span></span>
    </div>`;

    const verdict = pr.ready
        ? (pr.arcaneBeatsVosfor ? t.pixVerdictArcane : t.pixVerdictVosfor)
        : t.pixLoading;

    return `
      <div class="vosfor-pix-widget">
        <div class="vos-pix-intro">${escapeHTML((t.pixExplain || "").replace("{cost}", PACK_COST))}</div>
        <div class="vosfor-pix-list">
          ${rows}
          ${vosforRow}
        </div>
        <div class="vos-pix-verdict">${escapeHTML(verdict)}</div>
      </div>`;
}

function getPackById(packId) {
    if (!vosData) return null;
    return packId === "others" ? othersPack(vosData) : vosData.packs.find((p) => p.id === packId) || null;
}

function sindicatosDatos(bestRate = bestPackRate(vosData)) {
    if (!vosData) return [];
    return rentaSindicatos(vosData, {
        stats: ARC_STATS,
        precioSuelto: realizableR0,
        precioMax: realizableMax,
        tasaPl: bestRate?.rate || 0,
        orden: ordenSindicatos(),
    });
}

function sindicatosCtx() {
    const t = vosT();
    return {
        es: state.currentLang === "es",
        plat: PLAT,
        vos: vosforIcon(13),
        t,
        nombreDe: (slug) => {
            const m = vosData?.tradables?.[slug];
            return m ? (state.currentLang === "es" ? m[1] : m[0]) : slug;
        },
        nombresDe: (slug) => {
            const m = vosData?.tradables?.[slug];
            return m ? [m[0] || "", m[1] || ""] : [slug, slug];
        },
        imgArcano: arcaneImgHtml,
        iconoSindicato: iconoSindicatoHtml,
        estadoVacio: (q) => vosState("noresults", {
            msg: (t.searchNoResults || "").replace("{q}", q),
            actionLabel: t.searchClear,
            action: "onVosforSindFiltroClear()",
        }),
    };
}

function toolBodyHtml(key, bestRate = bestPackRate(vosData)) {
    if (!vosData) return "";
    if (key === "sell") return sellSimulatorCard();
    if (key === "target") return targetArcaneSimulatorCard();
    if (key === "ranking") return rankingLeaderboardCard(bestRate);
    if (key === "pix") return pixCard(bestRate);
    if (key === "sindicatos") return sindicatosCard(sindicatosDatos(bestRate), sindicatosCtx());
    return "";
}

function loadArcanePricesUpdated() {
    if (arcanePricesReq) return arcanePricesReq;
    arcanePricesReq = fetchArcanePricesUpdated().then((u) => {
        if (!u || !Number.isFinite(Date.parse(u))) return;
        arcanePricesUpdated = u;
        if (document.getElementById("vosfor-packs")) renderVosforPacks();
    });
    return arcanePricesReq;
}

export function ensureArcanePricesUpdated() {
    return loadArcanePricesUpdated();
}

export function getArcanePricesAge() {
    const ts = arcanePricesUpdated ? Date.parse(arcanePricesUpdated) : NaN;
    return Number.isFinite(ts) ? Math.max(0, Date.now() - ts) : null;
}

function staleArcanePricesHtml(t) {
    const ts = arcanePricesUpdated ? Date.parse(arcanePricesUpdated) : NaN;
    const age = Number.isFinite(ts) ? Date.now() - ts : 0;
    if (age <= 172800000) return "";
    const days = Math.floor(age / 86400000);
    return `<div class="vos-data-note vos-data-stale">${escapeHTML((t.staleArcanePrices || "").replace("{n}", String(days)))}</div>`;
}

export function renderVosforPacks() {
    const packsBox = document.getElementById("vosfor-packs");
    if (!packsBox || !vosData) {
        renderVosforTab();
        return;
    }
    loadArcanePricesUpdated();
    const t = vosT();
    const bestRate = bestPackRate(vosData);

    const packsSorted = [...vosData.packs].sort((a, b) => {
        const ea = computePackEV(a, vosData.arcanes);
        const eb = computePackEV(b, vosData.arcanes);
        return (eb.ready ? eb.rate : -1) - (ea.ready ? ea.rate : -1);
    });

    const othersCard = vosData.others?.length ? packCard(othersPack(vosData), bestRate) : "";

    packsBox.innerHTML = `
        ${searchResultsCard(bestRate)}
        <div class="vosfor-explain-text">${escapeHTML(t.explain || "")}</div>
        <div class="vos-packs-list">
          ${packsSorted.map((p) => packCard(p, bestRate)).join("")}
          ${othersCard}
        </div>
        <div class="vos-data-note">${escapeHTML(t.dataNote || "")} ${escapeHTML(vosData.updated || "")}</div>${staleArcanePricesHtml(t)}`;

    initJadeCosmicEasterEgg();
}

function vosTabs() {
    const t = vosT();
    const labels = { packs: t.tabPacks, calc: t.tabCalc, rank: t.tabRank };
    const btns = VOS_TABS.map((k) => {
        const isAct = activeTab === k;
        return `<button type="button" class="vos-tab" role="tab" id="vos-tab-${k}" data-tab="${k}" aria-selected="${isAct ? "true" : "false"}" aria-controls="vos-panel-${k}" tabindex="${isAct ? "0" : "-1"}" onclick="setVosforTab('${k}')">${escapeHTML(labels[k] || "")}</button>`;
    }).join("");
    return `<div class="vos-tabs" role="tablist" aria-label="Vosfor" onkeydown="globalThis.onVosforTabKey(event)">${btns}</div>`;
}

function vosSubPanel(tab, bestRate) {
    const t = vosT();
    const subActivo = activeSub[tab];
    const labels = {
        sell: t.subSell,
        target: t.toolTargetTitle,
        ranking: "🏆 " + t.subRanking,
        pix: "🪙 " + t.toolPixTitle,
        sindicatos: t.toolSyndTitle,
    };
    const descs = {
        sell: t.toolSellSub,
        target: t.toolTargetSub,
        ranking: t.toolRankingSub,
        pix: t.toolPixSub,
        sindicatos: t.toolSyndSub,
    };
    const btns = VOS_SUBS[tab].map((sub) => `<button type="button" class="vos-seg-btn" aria-pressed="${sub === subActivo ? "true" : "false"}" onclick="setVosforSub('${tab}','${sub}')">${escapeHTML(labels[sub] || "")}</button>`).join("");
    return `
      <div class="vos-seg" role="group" aria-label="${escapeHTML(tab === "calc" ? t.subCalcAria : t.subRankAria)}">${btns}</div>
      <p class="vos-sub-desc">${escapeHTML(descs[subActivo] || "")}</p>
      <div class="vos-sub-body" id="vos-sub-body" data-tool="${subActivo}">${toolBodyHtml(subActivo, bestRate)}</div>`;
}

export async function renderVosforTab() {
    const box = document.getElementById("vosfor-content");
    if (!box) return;
    const t = vosT();

    if (!vosData) {
        box.innerHTML = vosSkeleton(4, t.loading, "page");
        try {
            vosData = await loadVosforData();
        } catch {
            box.innerHTML = vosState("error", {
                msg: t.error,
                hint: t.errorHint,
                actionLabel: t.retry,
                action: "retryVosforLoad()",
            });
            return;
        }
    }

    const bestRate = bestPackRate(vosData);
    const panels = VOS_TABS.map((k) => {
        const isAct = activeTab === k;
        const content = !isAct
            ? ""
            : k === "packs"
                ? `${guideBoxCard()}${searchAndControlsBar()}<div id="vosfor-packs"></div>`
                : vosSubPanel(k, bestRate);
        return `<div class="vos-panel" role="tabpanel" id="vos-panel-${k}" aria-labelledby="vos-tab-${k}" tabindex="0"${isAct ? "" : " hidden"}>${content}</div>`;
    }).join("");

    box.innerHTML = `
      <div class="vosfor-container">
        ${vosTabs()}
        ${panels}
      </div>`;

    if (activeTab === "packs") renderVosforPacks();
    updateSellSimDOM();
    initJadeCosmicEasterEgg();
}

function refreshToolBodies() {
    const body = document.getElementById("vos-sub-body");
    if (!body || body.contains(document.activeElement)) return;
    body.innerHTML = toolBodyHtml(body.dataset.tool, bestPackRate(vosData));
}

function scheduleRerender() {
    if (rerenderTimer) return;
    rerenderTimer = setTimeout(() => {
        rerenderTimer = null;
        if (document.querySelector(".vosfor-container") && vosData) {
            refreshToolBodies();
            if (document.getElementById("vosfor-packs")) renderVosforPacks();
            updateSellSimDOM();
        } else {
            renderVosforTab();
        }
    }, 350);
}

let globalRefreshTimer = null;

export async function initVosforTab() {
    if (!unsubscribe) unsubscribe = onArcaneStats(scheduleRerender);
    await renderVosforTab();
    if (!vosData) return;

    requestAllPacks().catch(console.error);
    requestPackStats({ id: "hex", items: HEX_ARCANES }, true).catch(console.error);
    ensureSellArcSlug();
    if (sellArcSlug && !ARC_STATS.has(sellArcSlug)) {
        requestPackStats({ id: `sell_${sellArcSlug}`, items: [sellArcSlug] }, true).catch(console.error);
    }
    requestPackStats({ id: "sindicatos", items: slugsDeSindicatos(vosData) }).catch(console.error);

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

export function setVosforSindOrden(valor) {
    setOrdenSindicatos(valor);
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
    if (pack && pack.items.length) {
        targetArcSlug = pack.items[0];
        targetCopies = copiesForMaxRank(vosData?.arcanes?.[targetArcSlug]);
    }
    targetCustomPacks = null;
    renderVosforTab();
}

export function onTargetArcChange(slug) {
    targetArcSlug = slug;
    targetCopies = copiesForMaxRank(vosData?.arcanes?.[slug]);
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

function renderOpenPackBody(packId = expandedPack) {
    if (!packId || !vosData) return;
    const pack = getPackById(packId);
    const bodyEl = document.getElementById(`vosfor-pack-body-${packId}`);
    if (!pack || !bodyEl) return;
    bodyEl.innerHTML = packBodyHtml(pack, bestPackRate(vosData));
    if (packId === "others") initJadeCosmicEasterEgg();
}

export function toggleVosforPack(packId) {
    const prevPackId = expandedPack;
    expandedPack = expandedPack === packId ? null : packId;

    if (expandAllPacks || searchQuery.trim().length > 0) {
        if (expandedPack && vosData) {
            const pack = getPackById(expandedPack);
            if (pack) requestPackStats(pack, true).catch(console.error);
        }
        renderVosforPacks();
        return;
    }

    if (prevPackId && prevPackId !== expandedPack) {
        const prevBody = document.getElementById(`vosfor-pack-body-${prevPackId}`);
        if (prevBody) {
            prevBody.innerHTML = "";
            const prevCard = prevBody.closest(".vos-pack");
            if (prevCard) {
                const prevHead = prevCard.querySelector(".vos-pack-head");
                if (prevHead) prevHead.setAttribute("aria-expanded", "false");
            }
        }
    }

    if (expandedPack && vosData) {
        const pack = getPackById(expandedPack);
        const bodyEl = document.getElementById(`vosfor-pack-body-${expandedPack}`);
        if (bodyEl && pack) {
            bodyEl.innerHTML = packBodyHtml(pack, bestPackRate(vosData));
            const card = bodyEl.closest(".vos-pack");
            if (card) {
                const head = card.querySelector(".vos-pack-head");
                if (head) head.setAttribute("aria-expanded", "true");
            }
            if (expandedPack === "others") initJadeCosmicEasterEgg();
        }
        if (pack) {
            const currentId = expandedPack;
            requestPackStats(pack, true).then(() => {
                if (expandedPack === currentId && !expandAllPacks && !searchQuery.trim()) {
                    renderOpenPackBody(currentId);
                }
            }).catch(console.error);
        }
    }
}

export function setVosforTab(k) {
    if (!VOS_TABS.includes(k)) return;
    const prev = document.activeElement;
    const keepFocus = !prev || prev === document.body || prev.classList?.contains("vos-tab");
    activeTab = k;
    if (activeTab !== "rank") setFiltroSindicatos("");
    saveVosPref("vosfor_tab", k);
    renderVosforTab();
    if (keepFocus) document.getElementById(`vos-tab-${k}`)?.focus({ preventScroll: true });
}

export function setVosforSub(tab, k) {
    if (!VOS_SUBS[tab]?.includes(k)) return;
    activeSub[tab] = k;
    saveVosPref(`vosfor_sub_${tab}`, k);
    renderVosforTab();
}

export function onVosforTabKey(e) {
    const idx = VOS_TABS.indexOf(activeTab);
    let nextIdx = -1;
    if (e.key === "ArrowRight") nextIdx = (idx + 1) % VOS_TABS.length;
    else if (e.key === "ArrowLeft") nextIdx = (idx - 1 + VOS_TABS.length) % VOS_TABS.length;
    else if (e.key === "Home") nextIdx = 0;
    else if (e.key === "End") nextIdx = VOS_TABS.length - 1;
    else return;
    e.preventDefault();
    const nueva = VOS_TABS[nextIdx];
    setVosforTab(nueva);
    document.getElementById(`vos-tab-${nueva}`)?.focus();
}

export function onVosforGuideToggle() {
    markGuideSeen();
}

export function onVosforSearchClear() {
    searchQuery = "";
    renderVosforTab();
}

export function retryVosforLoad() {
    vosData = null;
    renderVosforTab();
}

export function simulateArcane(slug) {
    activeTab = "calc";
    activeSub.calc = "sell";
    saveVosPref("vosfor_tab", "calc");
    saveVosPref("vosfor_sub_calc", "sell");
    sellArcSlug = slug;
    if (vosData && !ARC_STATS.has(slug)) {
        requestPackStats({ id: `sell_${slug}`, items: [slug] }, true).catch(console.error);
    }
    renderVosforTab();
    document.getElementById("vos-panel-calc")?.scrollIntoView({ block: "start" });
}

export function toggleVosforExpandAll() {
    expandAllPacks = !expandAllPacks;
    renderVosforTab();
}

export function onVosforSearchInput(val) {
    searchQuery = val || "";
    scheduleRerender();
}

function repintarResultadosSindicatos() {
    const box = document.getElementById("vos-sind-resultados");
    if (box && vosData) {
        box.innerHTML = sindicatosResultadosHtml(sindicatosDatos(), sindicatosCtx());
    }
    const btn = document.getElementById("sindFiltroClear");
    if (btn) btn.hidden = !filtroSindicatos();
}

export function onVosforSindFiltro(val) {
    setFiltroSindicatos(val);
    repintarResultadosSindicatos();
}

export function onVosforSindFiltroClear() {
    setFiltroSindicatos("");
    const input = document.getElementById("sindFiltroInput");
    if (input) input.value = "";
    repintarResultadosSindicatos();
    input?.focus();
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


exposeGlobals({
    initVosforTab,
    renderVosforPacks,
    packBodyHtml,
    setVosforTab,
    setVosforSub,
    onVosforTabKey,
    onVosforGuideToggle,
    onVosforSearchClear,
    retryVosforLoad,
    simulateArcane,
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
    setVosforSindOrden,
    toggleVosforExpandAll,
    onVosforSearchInput,
    onVosforSindFiltro,
    onVosforSindFiltroClear,
    onTargetArcQuickSearch,
    showTargetArcDropdown,
    hideTargetArcDropdown,
    filterTargetArcDropdown,
    selectTargetArcane,
    showSellArcDropdown,
    hideSellArcDropdown,
    filterSellArcDropdown,
    selectSellArcane,
    setSellRank,
    onSellQtyChange,
    onSellRatePackChange,
    handleArcaneTyping: onVosforSearchInput,
}, "ui.components/ui_vosfor.js");
