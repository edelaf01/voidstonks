import { state, saveAppState } from "../../state.js";
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
import { fetchAllFissures } from "../../services/farms/fissures.service.js";
import { getFarmRoutesPrefs, saveFarmRoutesPrefs } from "../../services/inventory/farm_routes.service.js";
import {
    attachSetPrices, filterSetRecommendations, getSetRecsPrefs, saveSetRecsPrefs, RELIC_ERAS,
} from "../../services/inventory/set_recommendations.service.js";
import { TEXTS, DROP_CHANCES } from "../../config.js";
import { escapeHTML } from "../ui_components.js";
import { exposeGlobals } from "../../utils/global_registry.js";

/**
 * "Rutas aconsejadas": qué abrir y dónde, para los sets que tienes a medias.
 *
 * La regla de diseño es que se lea como un plan y no como un volcado: por cada pieza que
 * falta se enseña UNA reliquia, la mejor. Enseñar las 6 reliquias de cada pieza de cada set
 * es exactamente el muro de datos que hace que nadie use esto.
 *
 * Lo demás que hay aquí —subtítulo, guía plegable, punto de estado por pieza— existe porque
 * el panel se leía como jerga: tres colores sin explicar, y "ganas 45p · 120 p/h · ~22 min"
 * sin decir de dónde salen ni cuál manda en el orden.
 */

const texts = () => FARM_ROUTES_TEXTS[state.currentLang === "es" ? "es" : "en"];

/** Nombre legible de un refinamiento. En una función porque lo usan el filtro, la tarjeta y el
 *  mensaje de vacío, y tres copias acabarían diciendo cosas distintas. */
const REF_LABEL = (t, key) => ({
    intact: t.refIntact, exceptional: t.refExceptional, flawless: t.refFlawless, radiant: t.refRadiant,
}[key] || key);

/**
 * Los tres estados en los que puede estar una pieza. Es el ÚNICO sitio donde se decide:
 * el punto de color, la clase del selector de reliquia y la fila de la leyenda salen todos
 * de aquí, así que la leyenda no puede acabar describiendo colores que ya no se pintan.
 */
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

/**
 * Selector de la reliquia: abre su ficha en la pestaña de Reliquias.
 *
 * Reutiliza `data-action="select-relic-from-inv"`, que ya escucha la delegación de
 * ui_inventory.js a nivel de document — no hace falta enganchar nada nuevo. Va en
 * <button> y no en <div> porque en táctil el click sobre un div se pierde (utils/tap.js).
 * El nombre viaja con el sufijo " Relic", que es la forma que usa el resto de la app.
 */
function relicPickerHtml(relic, label, extraClass = "") {
    return `<button type="button" class="fr-go ${extraClass}"`
        + ` data-action="select-relic-from-inv" data-relic="${escapeHTML(`${relic} Relic`)}"`
        + ` title="${escapeHTML(relic)}">${escapeHTML(label)}</button>`;
}

/**
 * Runs medias con la reliquia elegida. Es el número que ahora decide cuál se recomienda, así
 * que se enseña: sin él, dos reliquias distintas para la misma pieza se ven igual de buenas.
 */
function runsHtml(best, t) {
    if (!Number.isFinite(best.runs)) return "";
    return `<span class="fr-runs" data-tooltip="${escapeHTML(t.runsTitle)}">`
        + `${t.approx}${best.runs.toFixed(1)} ${escapeHTML(t.runsShort)}</span>`;
}

/** Una línea de "esto es lo siguiente que hay que hacer" para una pieza. */
function partLineHtml(m, t) {
    const best = m.relics[0];
    if (!best) return `<li class="fr-part"><span class="fr-name">${escapeHTML(m.part)}</span></li>`;

    const key = partState(best);
    const st = STATES[key];
    const runs = runsHtml(best, t);

    let action;
    if (key === "ready") {
        // Ya elegida por rapidez y tiempo restante en buildSetRoute, no la primera que caiga.
        const f = m.fissure || best.fissures[0];
        action = relicPickerHtml(best.relic, best.relic, st.cls)
            + `<span class="fr-dim">×${best.owned}</span>${runs}`
            + `<span class="fr-where">${escapeHTML(f.type)} · ${escapeHTML(f.node)}${f.eta ? ` · ${escapeHTML(f.eta)}` : ""}</span>`;
    } else if (key === "wait") {
        // El motivo ("sin fisura de esa era") solo se repite por línea si la ruta tiene alguna
        // otra pieza que SÍ se puede hacer; si no se puede ninguna, lo dice la cabecera y aquí
        // sobra — eran cuatro líneas seguidas diciendo lo mismo.
        action = relicPickerHtml(best.relic, best.relic, st.cls)
            + `<span class="fr-dim">×${best.owned}${m.someReady ? ` · ${t.noFissure}` : ""}</span>${runs}`;
    } else {
        const src = best.sources[0];
        action = relicPickerHtml(best.relic, best.relic, st.cls) + runs
            + (src
                ? `<span class="fr-where">${t.farmIn} ${escapeHTML(src.location)}${src.rotation ? ` · ${t.rot} ${escapeHTML(src.rotation)}` : ""}</span>`
                : `<span class="fr-dim">${t.need}</span>`);
    }

    // "Mejor comprarla": la pieza cuesta <=15% del set entero. Va JUNTO al plan de farmeo y no
    // en un panel aparte, que es donde vivía antes: la decisión es "farmeo esto o lo compro", y
    // para tomarla hay que ver las runs y el precio a la vez.
    const compra = m.betterToBuy
        ? `<span class="fr-buy" data-tooltip="${escapeHTML(t.buyHelp)}">${escapeHTML(t.buy)}`
          + ` ${Math.round(m.buyPricePlat)}<span class="plat-icon-inline"></span></span>`
        : "";

    // El aviso que faltaba: "cierra antes intacta" es cierto y aun así puede salir carísimo si
    // la rara de ESA reliquia vale 60p, porque intacta la tira al 2 % en vez de al 10 %. Se
    // pinta solo cuando refinar renta de verdad (ver MIN_PLAT_PER_TRACE), que si no aparecería
    // en cada línea y dejaría de mirarse.
    const refinar = m.refValue?.worth
        ? `<span class="fr-refine" data-tooltip="${escapeHTML((t.refineHelp || "")
              .replace("{ref}", REF_LABEL(t, m.refValue.best))
              .replace("{gain}", m.refValue.gain.toFixed(1))
              .replace("{traces}", String(m.refValue.traces))
              .replace("{perTrace}", m.refValue.perTrace.toFixed(2)))}">`
          + `${escapeHTML((t.refineTag || "{ref} +{gain}").replace("{ref}", REF_LABEL(t, m.refValue.best))
              .replace("{gain}", String(Math.round(m.refValue.gain))))}<span class="plat-icon-inline"></span></span>`
        : "";

    // El punto repite el estado que ya dice el color del texto, y eso es a propósito: el color
    // solo, sin nada a lo que referirse, no se puede aprender. El punto es lo que aparece
    // igual en la leyenda de la guía.
    const label = escapeHTML(st.label(t));
    const dot = `<span class="fr-state ${st.cls}" role="img" aria-label="${label}" data-tooltip="${label}"></span>`;

    // Solo la parte ("Barrel"), no "Braton Prime Barrel": el set está en la cabecera, justo
    // encima, y el nombre completo se comía el ancho que necesita la acción para caber al lado.
    // Solo si son varias: un "×1" en cada línea es ruido en todas las rutas normales.
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
    // Con sets ya montados, "2/4" a secas engaña: hay que decir que va por el siguiente.
    const nth = route.built > 0 ? ` <span class="fr-dim">${t.nth} ${route.built + 1}º ${t.set}</span>` : "";
    // Que la ruta monte varios sets es la información que justifica pedir 4 copias de algo.
    // El aviso que de verdad cambia una decisión: si sale "mejor intacta", refinar te hace ir
    // más lento Y te cuesta 100 vestigios por reliquia.
    const refino = route.bestRefinement
        ? `<span class="fr-bestref${route.bestRefinement === "intact" ? " is-cheap" : ""}"`
          + ` data-tooltip="${escapeHTML(t.bestForTitle || "")}">`
          + `${escapeHTML((t.bestForTag || "{ref}").replace("{ref}", REF_LABEL(t, route.bestRefinement)))}</span>`
        : "";
    const multi = route.setsUnlocked > 1
        ? `<span class="fr-multi" data-tooltip="${escapeHTML((t.unlocksTitle || "").replace("{n}", route.setsUnlocked))}">`
          + `${escapeHTML((t.unlocks || "").replace("{n}", route.setsUnlocked))}</span>`
        : "";
    // Solo si se pudo valorar: un "0 p" por falta de precio se leería como "no vale nada".
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

/**
 * La guía. Plegada de serie y con el estado guardado: quien ya sabe leer el panel no la ve
 * nunca más, y quien la abre no se la encuentra cerrada al siguiente refresco de fisuras.
 */
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

/** Conmutador entre las dos caras del panel. Va en la cabecera, fuera del cuerpo plegable. */
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

// Cuántas rutas se PINTAN. buildFarmRoutes recorta por su cuenta, y hay que pedirle todas: si
// se recorta antes de filtrar, buscar un set que quede el 9º no devuelve nada y la búsqueda
// parece rota. Es el mismo bug que ya se arregló en el panel de recomendaciones que este
// absorbe, así que el orden filtrar→recortar se conserva tal cual.
const MAX_ROUTES = 8;

// TODAS las rutas de la última pasada, para que los filtros repinten sin volver a pedir
// fisuras ni recalcular.
let _allRoutes = [];
// Reliquias recomendadas de la última pasada, para la vista "por reliquia".
let _allPicks = [];

// Cada repintado se queda con su turno: escribiendo deprisa se solapan varias pasadas —cada una
// espera a los precios— y sin esto pintaba la última en terminar, aunque fuera de una búsqueda
// ya borrada.
// Un turno POR INSTANCIA, no uno de módulo: el panel se pinta en dos sitios y ambos pasan por
// aquí. Con un contador compartido, la segunda instancia se llevaba el turno y la primera se
// salía al volver de los precios — se quedaba sin su repintado final, que es el único que ve el
// filtro "solo donde sale a cuenta comprar". WeakMap para no retener nodos que salgan del DOM.
const _renderTokens = new WeakMap();

/** `<option>`s con el seleccionado marcado, para no repetir el ternario ocho veces. */
function optionsHtml(pares, actual) {
    return pares.map(([valor, etiqueta]) =>
        `<option value="${escapeHTML(String(valor))}"${String(valor) === String(actual) ? " selected" : ""}>`
        + `${escapeHTML(etiqueta)}</option>`).join("");
}

/**
 * Dos bloques con papeles distintos, y por eso van separados en la UI:
 *
 *  - SIMULACIÓN (refinamiento y escuadra): no esconden nada, cambian los números. Escriben en
 *    `state`, que es de donde los lee el resto de la app — así "con qué juego" es un dato
 *    único y no una copia por panel que puede discrepar de la de al lado.
 *  - FILTROS (búsqueda, piezas restantes, umbrales de platino, comprar) y ORDEN: esos sí
 *    deciden qué se ve y en qué posición, y viven en las prefs del panel.
 */
function filtersHtml(prefs, t, ft, odds) {
    const refs = [["radiant", t.refRadiant], ["flawless", t.refFlawless],
        ["exceptional", t.refExceptional], ["intact", t.refIntact]];
    const squads = [[4, t.squad4], [3, t.squad3], [2, t.squad2], [1, t.squad1]];
    const sorts = [["near", t.sortNear], ["perHour", t.sortPerHour], ["gain", t.sortGain]];
    // "" = cualquiera. Contesta "tengo Lith de sobra, ¿qué avanzo con ellas?".
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

/**
 * Filtra sobre la lista ENTERA y recorta al final, y pide precios SOLO de lo que se pinta.
 *
 * Los precios cuestan una consulta por set y por pieza: pedirlos para todas las rutas posibles
 * es lo que revienta el arranque en frío. Y se pinta ANTES de tenerlos, porque esperarlos dejaba
 * la búsqueda sin responder mientras el mercado tardaba —con 429 son varios segundos— y parecía
 * que escribir no hacía nada. La excepción es "solo donde sale a cuenta comprar": ese filtro ES
 * el precio, así que ahí no queda más remedio que esperar.
 */
async function applyFiltersAndRender(raiz, t) {
    const cards = raiz.querySelector('[data-fr="cards"]');
    if (!cards) return;
    const token = (_renderTokens.get(raiz) || 0) + 1;
    _renderTokens.set(raiz, token);
    const prefs = getSetRecsPrefs();
    const piezas = (r) => r.missing;

    // buyOnly va aparte y DESPUÉS: es el único filtro que necesita precios, y los precios solo
    // se piden para la página que se pinta.
    const matched = filterSetRecommendations(_allRoutes, { ...prefs, buyOnly: false }, piezas);
    const page = matched.slice(0, MAX_ROUTES);

    /**
     * Qué filtro dejó la lista vacía. No hace falta adivinarlo: `matched` ya trae aplicados la
     * búsqueda y el máximo de piezas, así que si trae algo y aun así no se pinta nada, el
     * culpable es buyOnly; y si no trae nada, se prueba a soltar cada uno de los otros dos.
     *
     * El aviso que había decía "la búsqueda o el máximo de piezas restantes las esconden" —una
     * disyuntiva que obliga a probar a mano— y ni siquiera mencionaba buyOnly, que es el que
     * más esconde: descarta toda ruta sin una pieza que compense comprar, y con el filtro
     * puesto buscar un set concreto contesta que no existe.
     */
    const porQueVacio = () => {
        if (matched.length > 0) {
            return [t.emptyByBuy, (t.emptyByBuyHint || "").replace("{n}", String(matched.length))];
        }
        // Se suelta un filtro cada vez: el primero que al quitarlo devuelve rutas es el que las
        // estaba escondiendo. En este orden porque es el de "más probable que sea eso": los
        // umbrales son los que más recortan, y encima esconden también las rutas sin precio.
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
            if (sueltos.length > 0) return [(titulo || "").replace("{n}", String(valor)), pista];
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

/**
 * Pinta el panel en TODOS sus anfitriones.
 *
 * Hay dos: la pestaña Reliquia y el panel lateral del inventario Prime. Por eso ni el bloque ni
 * sus controles llevan `id` — dos copias del mismo id es HTML inválido, y getElementById
 * devuelve siempre el primero, así que los filtros del lateral habrían acabado moviendo la
 * lista de la otra pestaña sin que nada lo dijera. Cada instancia se busca lo suyo dentro de su
 * propia raíz con `[data-fr="…"]`.
 *
 * Los filtros SÍ se comparten: viven en las prefs, no en el DOM. Es deliberado — son "qué estoy
 * buscando", no una propiedad del sitio donde miras, y tenerlos separados obligaría a repetir el
 * mismo ajuste en dos paneles que enseñan lo mismo.
 */
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

    // Sin catálogo todavía no hay nada que decir: mejor no pintar el bloque que pintarlo vacío.
    if (!state.setsDatabase || !state.itemsDatabase) {
        container.style.display = "none";
        return;
    }

    // Las fisuras son lo único que puede fallar (red): sin ellas la ruta sigue valiendo,
    // solo que nada sale marcado como "puedes ahora".
    let fissures = [];
    try {
        fissures = await fetchAllFissures();
    } catch (e) {
        console.warn("[rutas] sin fisuras activas:", e);
    }

    const relicCounts = getRelicCounts();
    const { refinement, squadSize } = getPlayerOdds();
    _allRoutes = buildFarmRoutes({
        setsDatabase: state.setsDatabase,
        primeInventory: state.primeInventory,
        itemsDatabase: state.itemsDatabase,
        relicSources: state.relicSourcesDatabase,
        relicCounts, fissures, getRequiredCount,
        // Con estos dos la ruta se ordena por platino por hora; sin ellos, por piezas que faltan.
        // Lectura SÍNCRONA de la caché en memoria, que es la que ya llenó el inventario:
        // getPriceValue() pide (nombre, slug) y devuelve una Promise, así que no sirve aquí
        // —y al pasarla tal cual el valor salía siempre nulo, sin romper nada, o sea sin avisar.
        getPrice: (name) => {
            const raw = globalThis.MEMORY_CACHE?.get(getSlug(name));
            return raw ? (Number.parseInt(raw, 10) || 0) : 0;
        },
        // Con TU refinamiento y TU escuadra, no con "radiante y 4" fijos: en solitario y con
        // intactas la estimación se va al triple, así que el número que se enseñaba no era el
        // del jugador que lo estaba leyendo.
        expectedRuns: (part) => calculatePartExpectedRuns(part, refinement, squadSize),
        relicRuns: (drop) => runsForDrop(drop, refinement, squadSize),
        // Con el refinamiento como PARÁMETRO: es lo que permite comparar los cuatro y
        // decir cuál cierra antes la ruta (bestRefinementFor).
        refinementRuns: (drop, ref) => runsForDrop(drop, ref, squadSize),
        // El orden se decide al construir porque buildFarmRoutes recorta DESPUÉS de
        // ordenar: reordenar la lista ya recortada solo barajaría las 8 de arriba.
        sortBy: getSetRecsPrefs().sortBy,
        // La era del filtro decide qué reliquia se recomienda por pieza: filtrar por Axi y
        // seguir enseñando la Meso hacía que el filtro pareciera roto.
        preferTier: getSetRecsPrefs().era,
        // Se inyecta ya resuelto porque relic_route.js es puro y no importa nada: el catálogo
        // de reliquias y los precios viven aquí.
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
        // Las fisuras enteras, no solo sus eras: de ahí sale la misión concreta a la que ir.
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
    // El refresco de fisuras repinta el panel entero cada 150 s. Sin esto, a quien estuviera
    // leyendo la cuarta ruta se le iba la lista al principio sola.
    const body = raiz.querySelector('[data-fr="body"]');
    const scroll = body ? body.scrollTop : 0;

    container.style.display = "block";
    container.classList.toggle("collapsed", prefs.collapsed);
    // El contador es el total al que se puede buscar, no lo que cabe en pantalla: si dijera 8
    // teniendo 40, buscar el que hace 12 parecería un fallo del filtro.
    const esPicks = prefs.view === "picks";
    // La vista "por reliquia" trae los suyos (ui_relic_picks.js): los de rutas filtran SETS y
    // aquí las filas son reliquias, así que no valen los mismos.
    container.innerHTML = headHtml(esPicks ? _allPicks.length : _allRoutes.length, t)
        + viewSwitchHtml(prefs.view, t)
        + `<div class="fr-body" data-fr="body">`
        + `<p class="fr-sub">${escapeHTML(esPicks ? t.picksSubtitle : t.subtitle)}</p>`
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

/**
 * Plegado y guía. Se reenganchan en cada render porque el innerHTML se reemplaza entero;
 * el estado no se pierde porque vive en las prefs, no en el DOM.
 */
function bindPanelListeners(raiz, t) {
    const container = raiz;
    // Cambiar de vista reconstruye: las dos pintan cosas distintas en el mismo cuerpo.
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
    const aplicar = () => {
        saveSetRecsPrefs({
            maxMissing: Number.parseInt(missing?.value, 10) || 0,
            era: era?.value || "",
            bestFor: bestFor?.checked ? (simRef?.value || "") : "",
            buyOnly: !!buy?.checked,
            query: query?.value || "",
            sortBy: sort?.value || "near",
            minPerHour: numero(minPh),
            minGain: numero(minGain),
        });
        applyFiltersAndRender(raiz, t).catch((e) => console.warn("[rutas] filtro:", e));
    };
    // El desplegable y la casilla son discretos: un cambio, una pasada. Se aplican al momento.
    missing?.addEventListener("change", aplicar);
    era?.addEventListener("change", aplicar);
    bestFor?.addEventListener("change", aplicar);
    buy?.addEventListener("change", aplicar);
    minPh?.addEventListener("change", aplicar);
    minGain?.addEventListener("change", aplicar);

    // El ORDEN no se puede aplicar sobre la lista ya construida: buildFarmRoutes recorta a las
    // 8 primeras DESPUÉS de ordenar, así que reordenar aquí solo barajaría esas ocho. Hay que
    // reconstruir, igual que con refinamiento y escuadra.
    sort?.addEventListener("change", () => {
        saveSetRecsPrefs({ ...getSetRecsPrefs(), sortBy: sort.value });
        renderFarmRoutes().catch((e) => console.warn("[rutas] orden:", e));
    });

    // Simulación: escribe en el estado global —es "con qué juego", no una preferencia de este
    // panel— y reconstruye, porque las runs y los minutos de cada ruta se calculan al montarla.
    simRef?.addEventListener("change", () => {
        // Con la casilla puesta, el filtro es "las mejores con ESTE refinamiento": si el
        // refinamiento cambia y bestFor se queda con el viejo, el panel filtra por uno y
        // calcula con otro.
        if (bestFor?.checked) saveSetRecsPrefs({ ...getSetRecsPrefs(), bestFor: simRef.value });
        state.refinement = REFINEMENT_LABELS[simRef.value] || "Rad";
        saveAppState();
        renderFarmRoutes().catch((e) => console.warn("[rutas] refinamiento:", e));
    });
    simSquad?.addEventListener("change", () => {
        state.squadSize = Math.min(4, Math.max(1, Number.parseInt(simSquad.value, 10) || 4));
        saveAppState();
        renderFarmRoutes().catch((e) => console.warn("[rutas] escuadra:", e));
    });

    // La búsqueda NO. Cada pasada persiste las prefs (escritura síncrona, bloquea el hilo) y
    // reconstruye el innerHTML de las ocho tarjetas enteras; a una por pulsación, escribir
    // "saryn" son cinco y se nota al teclear. Mismo margen que el buscador de la pestaña Set.
    let debounce;
    // `input` y no `keyup`: en móvil keyup solo dispara al pulsar Enter, así que la búsqueda en
    // vivo no funcionaba con el teclado del teléfono.
    query?.addEventListener("input", () => {
        clearTimeout(debounce);
        debounce = setTimeout(aplicar, 120);
    });
}

/**
 * Las fisuras rotan cada pocos minutos y las rutas se pintaban una sola vez, al repintar el
 * inventario: te quedabas mirando "esperando fisura" sobre una era que ya había vuelto, o
 * "puedes ahora" sobre una que acababa de caducar.
 *
 * Mismo patrón que el panel de fisuras (ui_fissures.js): un intervalo global, y solo repinta
 * si el bloque está de verdad en pantalla. `fetchAllFissures` ya cachea 2 min en memoria, así
 * que esto no añade tráfico — solo vuelve a cruzar lo que haya con el inventario.
 */
let routesInterval = null;

function startRoutesRefresh() {
    if (routesInterval) return;
    routesInterval = setInterval(() => {
        // offsetParent null = él o alguno de sus padres está oculto (otra pestaña, panel cerrado).
        // Basta con que UNA instancia esté a la vista: renderFarmRoutes las repinta todas, y las
        // ocultas cuestan ~2 ms cada una.
        const visible = [...document.querySelectorAll(".farm-routes")]
            .some((el) => el.style.display !== "none" && el.offsetParent !== null);
        if (!visible) return;
        renderFarmRoutes().catch((e) => console.warn("[rutas] refresco:", e));
    }, 150 * 1000);
}

exposeGlobals({ renderFarmRoutes }, "ui.components/farms/ui_farm_routes.js");
