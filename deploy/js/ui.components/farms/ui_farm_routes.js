import { state } from "../../state.js";
import { FARM_ROUTES_TEXTS } from "../../assets/farm_routes_texts.js";
import { buildFarmRoutes } from "../../utils/inventory/relic_route.js";
import { rankRelicPicks } from "../../utils/inventory/relic_picks.js";
import { renderRelicPicks } from "./ui_relic_picks.js";
import { refinementValue } from "../../utils/inventory/refinement_value.js";
import { getRequiredCount, getSetName } from "../../utils/ui_utils.js";
import {
    calculatePartExpectedRuns, getPlayerOdds, runsForDrop, REFINEMENT_LABELS,
} from "../../utils/inventory/relic_drop_odds.utils.js";
import { getRelicCounts } from "../../utils/inventory/relic_counts.js";
import { getSlug } from "../../utils/slugs.utils.js";
import { getPartShortName } from "../inventory/ui_set_tracker.js";
import { fetchAllFissures, fissuresUnavailable } from "../../services/farms/fissures.service.js";
import { getFarmRoutesPrefs, saveFarmRoutesPrefs } from "../../services/inventory/farm_routes.service.js";
import {
    attachSetPrices, filterSetRecommendations, getSetRecsPrefs, saveSetRecsPrefs, RELIC_ERAS,
} from "../../services/inventory/set_recommendations.service.js";
import { TEXTS, DROP_CHANCES } from "../../config.js";
import { escapeHTML } from "../ui_components.js";
import { exposeGlobals } from "../../utils/global_registry.js";

const texts = () => FARM_ROUTES_TEXTS[state.currentLang === "es" ? "es" : "en"];

const REF_LABEL = (t, key) => ({
    intact: t.refIntact, exceptional: t.refExceptional, flawless: t.refFlawless, radiant: t.refRadiant,
}[key] || key);

const STATES = {
    ready: { cls: "ready", label: (t) => t.now, help: (t) => t.legendReady },
    wait: { cls: "wait", label: (t) => t.waiting, help: (t) => t.legendWait },
    need: { cls: "need", label: (t) => t.need, help: (t) => t.legendNeed },
};

function partState(best) {
    if (!best) return "need";
    if (best.owned > 0 && best.fissures.length > 0) return "ready";
    return best.owned > 0 ? "wait" : "need";
}

function relicPickerHtml(relic, label, extraClass = "") {
    return `<button type="button" class="fr-go ${extraClass}"`
        + ` data-action="select-relic-from-inv" data-relic="${escapeHTML(`${relic} Relic`)}"`
        + ` title="${escapeHTML(relic)}">${escapeHTML(label)}</button>`;
}

function runsHtml(best, t) {
    if (!Number.isFinite(best.runs)) return "";
    return `<span class="fr-runs" data-tooltip="${escapeHTML(t.runsTitle)}">`
        + `${t.approx}${best.runs.toFixed(1)} ${escapeHTML(t.runsShort)}</span>`;
}

function partLineHtml(m, t) {
    const best = m.relics[0];
    if (!best) return `<li class="fr-part"><span class="fr-name">${escapeHTML(m.part)}</span></li>`;

    const key = partState(best);
    const st = STATES[key];
    const runs = runsHtml(best, t);

    let action;
    if (key === "ready") {
        const f = m.fissure || best.fissures[0];
        action = relicPickerHtml(best.relic, best.relic, st.cls)
            + `<span class="fr-dim">×${best.owned}</span>${runs}`
            + `<span class="fr-where">${escapeHTML(f.type)} · ${escapeHTML(f.node)}${f.eta ? ` · ${escapeHTML(f.eta)}` : ""}</span>`;
    } else if (key === "wait") {
        action = relicPickerHtml(best.relic, best.relic, st.cls)
            + `<span class="fr-dim">×${best.owned}${m.someReady ? ` · ${t.noFissure}` : ""}</span>${runs}`;
    } else {
        const src = best.sources[0];
        action = relicPickerHtml(best.relic, best.relic, st.cls) + runs
            + (src
                ? `<span class="fr-where">${t.farmIn} ${escapeHTML(src.location)}${src.rotation ? ` · ${t.rot} ${escapeHTML(src.rotation)}` : ""}</span>`
                : `<span class="fr-dim">${t.need}</span>`);
    }

    const compra = m.betterToBuy
        ? `<span class="fr-buy" data-tooltip="${escapeHTML(t.buyHelp)}">${escapeHTML(t.buy)}`
          + ` ${Math.round(m.buyPricePlat)}<span class="plat-icon-inline"></span></span>`
        : "";

    const refinar = m.refValue?.worth
        ? `<span class="fr-refine" data-tooltip="${escapeHTML((t.refineHelp || "")
              .replace("{ref}", REF_LABEL(t, m.refValue.best))
              .replace("{gain}", m.refValue.gain.toFixed(1))
              .replace("{traces}", String(m.refValue.traces))
              .replace("{perTrace}", m.refValue.perTrace.toFixed(2)))}">`
          + `${escapeHTML((t.refineTag || "{ref} +{gain}").replace("{ref}", REF_LABEL(t, m.refValue.best))
              .replace("{gain}", String(Math.round(m.refValue.gain))))}<span class="plat-icon-inline"></span></span>`
        : "";

    const label = escapeHTML(st.label(t));
    const dot = `<span class="fr-state ${st.cls}" role="img" aria-label="${label}" data-tooltip="${label}"></span>`;

    const cantidad = m.needed > 1
        ? `<span class="fr-need" data-tooltip="${escapeHTML(
            (t.needQtyTitle || "").replace("{n}", m.needed).replace("{sets}", m.setsUnlocked ?? ""))}">`
          + `${escapeHTML((t.needQty || "×{n}").replace("{n}", m.needed))}</span>`
        : "";

    return `<li class="fr-part ${st.cls}">${dot}`
        + `<span class="fr-name">${escapeHTML(getPartShortName(m.part, m.setName))}</span>${cantidad}${action}${compra}${refinar}</li>`;
}



function routeHtml(route, t) {
    const done = route.totalParts - route.missingCount;
    const nth = route.built > 0 ? ` <span class="fr-dim">${t.nth} ${route.built + 1}º ${t.set}</span>` : "";
    const refino = route.bestRefinement
        ? `<span class="fr-bestref${route.bestRefinement === "intact" ? " is-cheap" : ""}"`
          + ` data-tooltip="${escapeHTML(t.bestForTitle || "")}">`
          + `${escapeHTML((t.bestForTag || "{ref}").replace("{ref}", REF_LABEL(t, route.bestRefinement)))}</span>`
        : "";
    const multi = route.setsUnlocked > 1
        ? `<span class="fr-multi" data-tooltip="${escapeHTML((t.unlocksTitle || "").replace("{n}", route.setsUnlocked))}">`
          + `${escapeHTML((t.unlocks || "").replace("{n}", route.setsUnlocked))}</span>`
        : "";
    const value = route.gain > 0
        ? `<span class="fr-value" data-tooltip="${escapeHTML(t.readGain)}">${t.gain} ${route.gain}<span class="plat-icon-inline"></span>`
          + (route.platPerHour ? ` · <span data-tooltip="${escapeHTML(t.readPerHour)}">${route.platPerHour} ${t.perHour}</span>` : "")
          + (route.minutes ? ` · <span data-tooltip="${escapeHTML(t.readMins)}">${t.approx}${route.minutes} ${t.mins}</span>` : "")
          + "</span>"
        : "";
    return `<div class="fr-set">
      <div class="fr-set-head">
        <span class="fr-set-name">${escapeHTML(route.setName)}</span>
        <span class="fr-set-prog" data-tooltip="${escapeHTML(t.readProg)}">${done}/${route.totalParts}${nth}</span>
        ${refino}
        ${multi}
        ${route.readyCount > 0
        ? `<span class="fr-badge" data-tooltip="${escapeHTML(t.legendReady)}">${t.now}: ${route.readyCount}</span>`
        : `<span class="fr-waiting" data-tooltip="${escapeHTML(t.legendWait)}">${t.waiting}</span>`}
        ${value}
      </div>
      <ul class="fr-parts">${route.missing
        .map((m) => partLineHtml({
            ...m, setName: route.setName, someReady: route.readyCount > 0,
            setsUnlocked: route.setsUnlocked,
        }, t))
        .join("")}</ul>
    </div>`;
}

function guideHtml(prefs, t) {
    const legend = ["ready", "wait", "need"].map((key) => {
        const st = STATES[key];
        return `<li><span class="fr-state ${st.cls}" aria-hidden="true"></span>`
            + `<b>${escapeHTML(st.label(t))}</b> — ${escapeHTML(st.help(t))}</li>`;
    }).join("");

    const numbers = [
        ["3/4", t.readProg],
        [`${t.approx}5.0 ${t.runsShort}`, t.readRuns],
        [`${t.gain} 45p`, t.readGain],
        [`120 ${t.perHour}`, t.readPerHour],
        [`${t.approx}22 ${t.mins}`, t.readMins],
    ].map(([ejemplo, desc]) =>
        `<li><b>${escapeHTML(ejemplo)}</b> — ${escapeHTML(desc)}</li>`).join("");

    return `<details class="fr-guide" data-fr="guide"${prefs.guideOpen ? " open" : ""}>
      <summary>${escapeHTML(t.guide)}</summary>
      <div class="fr-guide-body">
        <p class="fr-guide-h">${escapeHTML(t.legendTitle)}</p>
        <ul class="fr-legend">${legend}</ul>
        <p class="fr-guide-h">${escapeHTML(t.numbersTitle)}</p>
        <ul class="fr-legend fr-numbers">${numbers}</ul>
        <p class="fr-note">${escapeHTML(t.sortNote)}</p>
        <p class="fr-note">${escapeHTML(t.tipRelic)}</p>
      </div>
    </details>`;
}

function viewSwitchHtml(view, t) {
    const btn = (id, etiqueta) => `<button type="button" class="fr-view-btn${view === id ? " active" : ""}"`
        + ` data-fr-view="${id}" aria-pressed="${view === id}">${escapeHTML(etiqueta)}</button>`;
    return `<div class="fr-views" role="group">${btn("routes", t.viewRoutes)}${btn("picks", t.viewRelics)}</div>`;
}

function headHtml(count, t) {
    return `<button type="button" class="fr-head" data-fr="toggle"
              title="${escapeHTML(t.collapse)}">
      <span class="fr-title">${escapeHTML(t.title)}</span>
      ${count > 0 ? `<span class="fr-count">${count}</span>` : ""}
      <span class="fr-arrow" aria-hidden="true">▼</span>
    </button>`;
}

const MAX_ROUTES = 8;

let _allRoutes = [];
let _allPicks = [];

const _renderTokens = new WeakMap();

function optionsHtml(pares, actual) {
    return pares.map(([valor, etiqueta]) =>
        `<option value="${escapeHTML(String(valor))}"${String(valor) === String(actual) ? " selected" : ""}>`
        + `${escapeHTML(etiqueta)}</option>`).join("");
}

function filtersHtml(prefs, t, ft, odds) {
    const refs = [["radiant", t.refRadiant], ["flawless", t.refFlawless],
        ["exceptional", t.refExceptional], ["intact", t.refIntact]];
    const squads = [[4, t.squad4], [3, t.squad3], [2, t.squad2], [1, t.squad1]];
    const sorts = [["near", t.sortNear], ["perHour", t.sortPerHour], ["gain", t.sortGain]];
    const eras = [["", t.anyEra], ...RELIC_ERAS.map((e) => [e, e])];

    return `<div class="set-rec-filters">
      <div class="set-rec-filter-row">
        <input type="text" data-fr="filter-query" class="wf-input set-rec-filter-input"
               autocomplete="off" data-tooltip="${escapeHTML(ft.queryHelp || "")}"
               value="${escapeHTML(prefs.query || "")}"
               placeholder="${escapeHTML(ft.queryPlaceholder || "Set o pieza…")}"
               aria-label="${escapeHTML(ft.queryLabel || "Buscar")}" />
        <select data-fr="filter-era" class="alarm-select" aria-label="${escapeHTML(t.era)}"
                data-tooltip="${escapeHTML(t.eraHelp)}">
          ${optionsHtml(eras, prefs.era)}
        </select>
        <select data-fr="filter-missing" class="alarm-select"
                aria-label="${escapeHTML(ft.maxMissing || "Máx. piezas restantes")}"
                data-tooltip="${escapeHTML(ft.maxMissingHelp || "")}">
          <option value="0" ${prefs.maxMissing === 0 ? "selected" : ""}>${escapeHTML(ft.anyMissing || "Cualquiera")}</option>
          <option value="1" ${prefs.maxMissing === 1 ? "selected" : ""}>1</option>
          <option value="2" ${prefs.maxMissing === 2 ? "selected" : ""}>&le; 2</option>
          <option value="3" ${prefs.maxMissing === 3 ? "selected" : ""}>&le; 3</option>
        </select>
      </div>

      <div class="set-rec-filter-row fr-sim-row">
        <select data-fr="sim-refinement" class="alarm-select" aria-label="${escapeHTML(t.simRefinement)}"
                data-tooltip="${escapeHTML(t.simRefinementHelp)}">
          ${optionsHtml(refs.map(([k, v]) => [k, `${t.simRefinement}: ${v}`]), odds.refinement)}
        </select>
        <select data-fr="sim-squad" class="alarm-select" aria-label="${escapeHTML(t.simSquad)}"
                data-tooltip="${escapeHTML(t.simSquadHelp)}">
          ${optionsHtml(squads.map(([k, v]) => [k, `${t.simSquad}: ${v}`]), odds.squadSize)}
        </select>
      </div>

      <div class="set-rec-filter-row">
        <select data-fr="sort" class="alarm-select" aria-label="${escapeHTML(t.sortBy)}"
                data-tooltip="${escapeHTML(`${t.sortHelp} ${t.sortNote}`)}">
          ${optionsHtml(sorts, prefs.sortBy)}
        </select>
        <input type="number" data-fr="min-perhour" class="wf-input fr-num" min="0" step="10"
               data-tooltip="${escapeHTML(t.minPerHourHelp)}"
               value="${prefs.minPerHour || ""}" placeholder="${escapeHTML(t.minPerHour)}"
               aria-label="${escapeHTML(t.minPerHour)}" />
        <input type="number" data-fr="min-gain" class="wf-input fr-num" min="0" step="10"
               data-tooltip="${escapeHTML(t.minGainHelp)}"
               value="${prefs.minGain || ""}" placeholder="${escapeHTML(t.minGain)}"
               aria-label="${escapeHTML(t.minGain)}" />
      </div>

      <label class="lfg-checkbox-wrapper" data-tooltip="${escapeHTML(t.bestForTitle)}">
        <input type="checkbox" data-fr="filter-bestfor" ${prefs.bestFor ? "checked" : ""}>
        <span class="lfg-label">${escapeHTML(t.bestForOnly)}</span>
      </label>
      <label class="lfg-checkbox-wrapper" data-tooltip="${escapeHTML(ft.buyOnlyHelp || "")}">
        <input type="checkbox" data-fr="filter-buy" ${prefs.buyOnly ? "checked" : ""}>
        <span class="lfg-label">${escapeHTML(ft.buyOnlyFilter || "Solo donde sale a cuenta comprar")}</span>
      </label>
    </div>`;
}

async function applyFiltersAndRender(raiz, t) {
    const cards = raiz.querySelector('[data-fr="cards"]');
    if (!cards) return;
    const token = (_renderTokens.get(raiz) || 0) + 1;
    _renderTokens.set(raiz, token);
    const prefs = getSetRecsPrefs();
    const piezas = (r) => r.missing;

    const matched = filterSetRecommendations(_allRoutes, { ...prefs, buyOnly: false }, piezas);
    const page = matched.slice(0, MAX_ROUTES);

    const porQueVacio = () => {
        if (matched.length > 0) {
            return [t.emptyByBuy, (t.emptyByBuyHint || "").replace("{n}", String(matched.length))];
        }
        const sospechosos = [
            [!!prefs.bestFor, { bestFor: "" },
                (t.emptyByBestFor || "").replace("{ref}", REF_LABEL(t, prefs.bestFor)), t.emptyByBestForHint, prefs.bestFor],
            [!!prefs.era, { era: "" }, (t.emptyByEra || "").replace("{era}", prefs.era), t.emptyByEraHint, prefs.era],
            [prefs.minGain > 0, { minGain: 0 }, t.emptyByGain, t.emptyByGainHint, prefs.minGain],
            [prefs.minPerHour > 0, { minPerHour: 0 }, t.emptyByPerHour, t.emptyByPerHourHint, prefs.minPerHour],
            [prefs.maxMissing > 0, { maxMissing: 0 }, t.emptyByMissing, t.emptyByMissingHint, prefs.maxMissing],
        ];
        for (const [activo, sin, titulo, pista, valor] of sospechosos) {
            if (!activo) continue;
            const sueltos = filterSetRecommendations(_allRoutes, { ...prefs, ...sin, buyOnly: false }, piezas);
            if (sueltos.length === 0) continue;
            const cerca = "maxMissing" in sin
                ? ` ${(t.emptyByMissingClosest || "").replace("{n}",
                    String(Math.min(...sueltos.map((r) => r.missingCount))))}`
                : "";
            return [(titulo || "").replace("{n}", String(valor)), `${pista}${cerca}`];
        }
        if (prefs.query) {
            return [(t.emptyByQuery || "").replace("{q}", prefs.query), t.emptyByQueryHint];
        }
        return [t.emptyFiltered, (t.emptyFilteredHint || "").replace("{n}", String(_allRoutes.length))];
    };

    const pintar = (rutas) => {
        if (rutas.length > 0) {
            cards.innerHTML = rutas.map((r) => routeHtml(r, t)).join("");
            return;
        }
        const [titulo, pista] = _allRoutes.length > 0 ? porQueVacio() : [t.empty, t.emptyHint];
        cards.innerHTML = `<div class="fr-empty">${escapeHTML(titulo)}`
            + `<br><span class="fr-dim">${escapeHTML(pista)}</span></div>`;
    };

    if (!prefs.buyOnly) pintar(page);

    await attachSetPrices(page, piezas);
    if (token !== _renderTokens.get(raiz)) return;

    pintar(prefs.buyOnly ? filterSetRecommendations(page, prefs, piezas) : page);
}

export async function renderFarmRoutes() {
    const anfitriones = [...document.querySelectorAll(".farm-routes")];
    if (anfitriones.length === 0) return;
    await Promise.all(anfitriones.map((raiz) => renderRoutesInto(raiz)));
}

async function renderRoutesInto(raiz) {
    const container = raiz;
    if (!container) return;
    const t = texts();
    const ft = TEXTS[state.currentLang]?.fissureSetRecs || {};

    if (!state.setsDatabase || !state.itemsDatabase) {
        container.style.display = "none";
        return;
    }

    let fissures = [];
    try {
        fissures = await fetchAllFissures();
    } catch (e) {
        console.warn("[rutas] sin fisuras activas:", e);
    }
    const sinFisuras = fissuresUnavailable();
    if (sinFisuras) programarReintento();

    const relicCounts = getRelicCounts();
    const { refinement, squadSize } = getPlayerOdds();
    _allRoutes = buildFarmRoutes({
        setsDatabase: state.setsDatabase,
        primeInventory: state.primeInventory,
        itemsDatabase: state.itemsDatabase,
        relicSources: state.relicSourcesDatabase,
        relicCounts, fissures, getRequiredCount,
        // synchronous read of the cache: getPriceValue() returns a Promise and gave null
        getPrice: (name) => {
            const raw = globalThis.MEMORY_CACHE?.get(getSlug(name));
            return raw ? (Number.parseInt(raw, 10) || 0) : 0;
        },
        expectedRuns: (part) => calculatePartExpectedRuns(part, refinement, squadSize),
        relicRuns: (drop) => runsForDrop(drop, refinement, squadSize),
        refinementRuns: (drop, ref) => runsForDrop(drop, ref, squadSize),
        sortBy: getSetRecsPrefs().sortBy,
        preferTier: getSetRecsPrefs().era,
        refinementValueOf: (relicName) => refinementValue(state.relicsDatabase?.[relicName], {
            squadSize,
            valueOf: (d) => {
                const raw = globalThis.MEMORY_CACHE?.get(getSlug(d?.name));
                return raw ? (Number.parseInt(raw, 10) || 0) : 0;
            },
        }),
    }, Number.MAX_SAFE_INTEGER);

    _allPicks = rankRelicPicks({
        relicCounts,
        relicsDatabase: state.relicsDatabase,
        fissures,
        getPrice: (name) => {
            const raw = globalThis.MEMORY_CACHE?.get(getSlug(name));
            return raw ? (Number.parseInt(raw, 10) || 0) : 0;
        },
        setsDatabase: state.setsDatabase,
        primeInventory: state.primeInventory,
        getSetName,
        getRequiredCount,
        dropChances: DROP_CHANCES[state.refinement] || DROP_CHANCES.Rad,
        squadSize,
    }, Number.MAX_SAFE_INTEGER);

    const prefs = getFarmRoutesPrefs();
    const body = raiz.querySelector('[data-fr="body"]');
    const scroll = body ? body.scrollTop : 0;

    container.style.display = "block";
    container.classList.toggle("collapsed", prefs.collapsed);
    const esPicks = prefs.view === "picks";
    container.innerHTML = headHtml(esPicks ? _allPicks.length : _allRoutes.length, t)
        + viewSwitchHtml(prefs.view, t)
        + `<div class="fr-body" data-fr="body">`
        + `<p class="fr-sub">${escapeHTML(esPicks ? t.picksSubtitle : t.subtitle)}</p>`
        + (sinFisuras ? `<p class="fr-nofis">${escapeHTML(t.fissuresDown)}</p>` : "")
        + (esPicks ? "" : guideHtml(prefs, t))
        + (esPicks ? "" : filtersHtml(getSetRecsPrefs(), t, ft, getPlayerOdds()))
        + `<div data-fr="cards"></div>`
        + `</div>`;

    const newBody = raiz.querySelector('[data-fr="body"]');
    if (newBody && scroll) newBody.scrollTop = scroll;

    bindPanelListeners(container, t);
    startRoutesRefresh();

    if (esPicks) {
        renderRelicPicks(container, _allPicks, t,
            () => renderFarmRoutes().catch((e) => console.warn("[rutas] simulación:", e)));
        return;
    }
    await applyFiltersAndRender(container, t);
}

function bindPanelListeners(raiz, t) {
    const container = raiz;
    raiz.querySelectorAll(".fr-view-btn").forEach((b) => {
        b.addEventListener("click", (e) => {
            e.stopPropagation();
            saveFarmRoutesPrefs({ view: b.dataset.frView });
            renderFarmRoutes().catch((err) => console.warn("[rutas] vista:", err));
        });
    });

    raiz.querySelector('[data-fr="toggle"]')?.addEventListener("click", () => {
        const collapsed = container.classList.toggle("collapsed");
        saveFarmRoutesPrefs({ collapsed });
    });
    raiz.querySelector('[data-fr="guide"]')?.addEventListener("toggle", (e) => {
        saveFarmRoutesPrefs({ guideOpen: e.target.open });
    });

    const query = raiz.querySelector('[data-fr="filter-query"]');
    const missing = raiz.querySelector('[data-fr="filter-missing"]');
    const era = raiz.querySelector('[data-fr="filter-era"]');
    const bestFor = raiz.querySelector('[data-fr="filter-bestfor"]');
    const buy = raiz.querySelector('[data-fr="filter-buy"]');
    const sort = raiz.querySelector('[data-fr="sort"]');
    const minPh = raiz.querySelector('[data-fr="min-perhour"]');
    const minGain = raiz.querySelector('[data-fr="min-gain"]');
    const simRef = raiz.querySelector('[data-fr="sim-refinement"]');
    const simSquad = raiz.querySelector('[data-fr="sim-squad"]');

    const numero = (el) => Math.max(0, Number.parseInt(el?.value, 10) || 0);
    const guardar = () => saveSetRecsPrefs({
        maxMissing: Number.parseInt(missing?.value, 10) || 0,
        era: era?.value || "",
        bestFor: bestFor?.checked ? (simRef?.value || "") : "",
        buyOnly: !!buy?.checked,
        query: query?.value || "",
        sortBy: sort?.value || "near",
        minPerHour: numero(minPh),
        minGain: numero(minGain),
    });
    const aplicar = () => {
        guardar();
        applyFiltersAndRender(raiz, t).catch((e) => console.warn("[rutas] filtro:", e));
    };
    const reconstruir = () => {
        guardar();
        renderFarmRoutes().catch((e) => console.warn("[rutas] filtro:", e));
    };
    missing?.addEventListener("change", aplicar);
    bestFor?.addEventListener("change", aplicar);
    buy?.addEventListener("change", aplicar);
    minPh?.addEventListener("change", aplicar);
    minGain?.addEventListener("change", aplicar);
    era?.addEventListener("change", reconstruir);
    sort?.addEventListener("change", reconstruir);

    simRef?.addEventListener("change", () => {
        if (bestFor?.checked) saveSetRecsPrefs({ ...getSetRecsPrefs(), bestFor: simRef.value });
        globalThis.setRefinement?.(REFINEMENT_LABELS[simRef.value] || "Rad");
    });
    simSquad?.addEventListener("change", () => {
        globalThis.setSquadSize?.(simSquad.value);
    });

    let debounce;
    // input, not keyup: on mobile keyup only fires on Enter
    query?.addEventListener("input", () => {
        clearTimeout(debounce);
        debounce = setTimeout(aplicar, 120);
    });
}

let routesInterval = null;
let retryTimer = null;

function programarReintento() {
    if (retryTimer) return;
    retryTimer = setTimeout(() => {
        retryTimer = null;
        renderFarmRoutes().catch((e) => console.warn("[rutas] reintento:", e));
    }, 12 * 1000);
}

let refreshTimer = null;
export function scheduleFarmRoutesRefresh() {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
        refreshTimer = null;
        renderFarmRoutes().catch((e) => console.warn("[rutas] inventario:", e));
    }, 350);
}

function startRoutesRefresh() {
    if (routesInterval) return;
    routesInterval = setInterval(() => {
        const visible = [...document.querySelectorAll(".farm-routes")]
            .some((el) => el.style.display !== "none" && el.offsetParent !== null);
        if (!visible) return;
        renderFarmRoutes().catch((e) => console.warn("[rutas] refresco:", e));
    }, 150 * 1000);
}

exposeGlobals({ renderFarmRoutes, scheduleFarmRoutesRefresh }, "ui.components/farms/ui_farm_routes.js");
