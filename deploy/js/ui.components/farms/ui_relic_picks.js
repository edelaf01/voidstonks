import { state, saveAppState } from "../../state.js";
import { filterRelicPicks } from "../../utils/inventory/relic_picks.js";
import { getSetName } from "../../utils/ui_utils.js";
import { getPartShortName } from "../inventory/ui_set_tracker.js";
import { REFINEMENT_LABELS, getPlayerOdds } from "../../utils/inventory/relic_drop_odds.utils.js";
import { getRelicPicksPrefs, saveRelicPicksPrefs } from "../../services/inventory/farm_routes.service.js";
import { escapeHTML } from "../ui_components.js";

/**
 * La cara "por reliquia" del panel de rutas: tienes las reliquias delante y hay que elegir UNA.
 *
 * En módulo aparte de ui_farm_routes.js porque son dos vistas con filtros distintos —allí las
 * filas son sets, aquí reliquias— y juntas pasaban de las 800 líneas que fija architecture.test.
 */

const ERAS = ["Lith", "Meso", "Neo", "Axi", "Requiem"];

function optionsHtml(pairs, selected) {
    return pairs.map(([v, label]) =>
        `<option value="${escapeHTML(String(v))}" ${String(v) === String(selected) ? "selected" : ""}>${escapeHTML(label)}</option>`
    ).join("");
}

function filtersHtml(prefs, t, odds) {
    const refs = [["radiant", t.refRadiant], ["flawless", t.refFlawless],
        ["exceptional", t.refExceptional], ["intact", t.refIntact]];
    const squads = [[4, t.squad4], [3, t.squad3], [2, t.squad2], [1, t.squad1]];
    const sorts = [["useful", t.picksSortUseful], ["odds", t.picksSortOdds],
        ["value", t.picksSortValue], ["minutes", t.picksSortMinutes]];

    return `<div class="set-rec-filters">
      <div class="set-rec-filter-row">
        <input type="text" data-rp="query" class="wf-input set-rec-filter-input" autocomplete="off"
               data-tooltip="${escapeHTML(t.picksQueryHelp)}"
               value="${escapeHTML(prefs.query || "")}"
               placeholder="${escapeHTML(t.picksQueryPlaceholder)}"
               aria-label="${escapeHTML(t.picksQueryPlaceholder)}" />
        <select data-rp="era" class="alarm-select" aria-label="${escapeHTML(t.era)}"
                data-tooltip="${escapeHTML(t.picksEraHelp)}">
          ${optionsHtml([["", t.anyEra], ...ERAS.map((e) => [e, e])], prefs.era)}
        </select>
        <select data-rp="sort" class="alarm-select" aria-label="${escapeHTML(t.sortBy)}"
                data-tooltip="${escapeHTML(t.picksSortHelp)}">
          ${optionsHtml(sorts, prefs.sortBy)}
        </select>
      </div>

      <div class="set-rec-filter-row fr-sim-row">
        <select data-rp="sim-refinement" class="alarm-select" aria-label="${escapeHTML(t.simRefinement)}"
                data-tooltip="${escapeHTML(t.simRefinementHelp)}">
          ${optionsHtml(refs.map(([k, v]) => [k, `${t.simRefinement}: ${v}`]), odds.refinement)}
        </select>
        <select data-rp="sim-squad" class="alarm-select" aria-label="${escapeHTML(t.simSquad)}"
                data-tooltip="${escapeHTML(t.simSquadHelp)}">
          ${optionsHtml(squads.map(([k, v]) => [k, `${t.simSquad}: ${v}`]), odds.squadSize)}
        </select>
      </div>

      <label class="lfg-checkbox-wrapper" data-tooltip="${escapeHTML(t.picksReadyHelp)}">
        <input type="checkbox" data-rp="ready" ${prefs.readyOnly ? "checked" : ""}>
        <span class="lfg-label">${escapeHTML(t.picksReadyOnly)}</span>
      </label>
    </div>`;
}

export function pickHtml(p, t) {
    const utiles = p.useful === 1
        ? t.picksUsefulOne
        : (t.picksUseful || "").replace("{n}", String(p.useful));
    const odds = Math.round(p.odds * 100);
    const estado = p.ready ? "ready" : "wait";

    return `<div class="fr-pick ${estado}">
      <div class="fr-pick-head">
        <button type="button" class="fr-go ${estado}"
                data-action="select-relic-from-inv" data-relic="${escapeHTML(`${p.relic} Relic`)}"
                title="${escapeHTML(p.relic)}">${escapeHTML(p.relic)}</button>
        <span class="fr-dim">${escapeHTML((t.picksCopies || "×{n}").replace("{n}", String(p.owned)))}</span>
        <span class="fr-need" data-tooltip="${escapeHTML(t.picksUsefulTitle || "")}">${escapeHTML(utiles)}</span>
        <span class="fr-runs" data-tooltip="${escapeHTML((t.picksOddsTitle || "").replace("{n}", String(p.owned)))}">${
        escapeHTML((t.picksOdds || "{n}%").replace("{n}", String(odds)))}</span>
        ${p.value ? `<span class="fr-value" data-tooltip="${escapeHTML(t.picksValueTitle || "")}">${
        escapeHTML((t.picksValue || "").replace("{n}", String(p.value)))}<span class="plat-icon-inline"></span></span>` : ""}
        ${p.minutes ? `<span class="fr-dim" data-tooltip="${escapeHTML(t.picksMinsTitle || "")}">${
        escapeHTML((t.picksMins || "").replace("{n}", String(p.minutes)))}</span>` : ""}
        ${p.ready ? "" : `<span class="fr-waiting" data-tooltip="${escapeHTML(t.legendWait)}">${escapeHTML(t.waiting)}</span>`}
      </div>
      ${p.fissure ? `<div class="fr-pick-where"><span class="fr-where">${escapeHTML(p.fissure.type)} · ${
        escapeHTML(p.fissure.node)}${p.fissure.eta ? ` · ${escapeHTML(p.fissure.eta)}` : ""}</span></div>` : ""}
      <div class="fr-pick-parts">${p.parts.map((part) =>
        `<span class="fr-pick-part">${escapeHTML(getPartShortName(part, getSetName(part)))}`
        + `<span class="fr-dim"> · ${escapeHTML(getSetName(part))}</span></span>`).join("")}</div>
    </div>`;
}

/**
 * Igual que en rutas: "no tienes reliquias útiles" cuando lo que pasa es que un filtro las
 * esconde manda a buscar el fallo al inventario. Se nombra el filtro culpable y cuántas hay
 * detrás, que es lo único que permite deshacerlo sin ir probando.
 */
function porQueVacio(todas, prefs, t) {
    const sinEra = filterRelicPicks(todas, { ...prefs, era: "" });
    if (prefs.era && sinEra.length > 0) {
        return [(t.picksEmptyByEra || "").replace("{era}", prefs.era), t.picksEmptyFilteredHint, sinEra.length];
    }
    const sinReady = filterRelicPicks(todas, { ...prefs, readyOnly: false });
    if (prefs.readyOnly && sinReady.length > 0) {
        return [t.picksEmptyByReady, (t.picksEmptyByReadyHint || "").replace("{n}", String(sinReady.length)), 0];
    }
    if (prefs.query) {
        return [(t.picksEmptyByQuery || "").replace("{q}", prefs.query), t.picksEmptyFilteredHint, todas.length];
    }
    return [t.picksEmptyFiltered, t.picksEmptyFilteredHint, todas.length];
}

function pintarLista(raiz, todas, t) {
    const cards = raiz.querySelector('[data-rp="cards"]');
    if (!cards) return;

    if (todas.length === 0) {
        cards.innerHTML = `<div class="fr-empty">${escapeHTML(t.picksEmpty)}`
            + `<br><span class="fr-dim">${escapeHTML(t.picksEmptyHint)}</span></div>`;
        return;
    }
    const prefs = getRelicPicksPrefs();
    const vistas = filterRelicPicks(todas, prefs);
    if (vistas.length > 0) {
        cards.innerHTML = vistas.map((p) => pickHtml(p, t)).join("");
        return;
    }
    const [titulo, pista, n] = porQueVacio(todas, prefs, t);
    cards.innerHTML = `<div class="fr-empty">${escapeHTML(titulo)}`
        + `<br><span class="fr-dim">${escapeHTML(String(pista || "").replace("{n}", String(n)))}</span></div>`;
}

/**
 * @param onRebuild  se llama cuando cambia refinamiento o escuadra: las probabilidades y los
 *        minutos se calculan al montar cada pick, así que no basta con repintar.
 */
export function renderRelicPicks(raiz, todas, t, onRebuild) {
    const cuerpo = raiz.querySelector('[data-fr="cards"]');
    if (!cuerpo) return;
    cuerpo.innerHTML = filtersHtml(getRelicPicksPrefs(), t, getPlayerOdds())
        + `<div data-rp="cards"></div>`;
    pintarLista(cuerpo, todas, t);

    const query = cuerpo.querySelector('[data-rp="query"]');
    const era = cuerpo.querySelector('[data-rp="era"]');
    const sort = cuerpo.querySelector('[data-rp="sort"]');
    const ready = cuerpo.querySelector('[data-rp="ready"]');
    const simRef = cuerpo.querySelector('[data-rp="sim-refinement"]');
    const simSquad = cuerpo.querySelector('[data-rp="sim-squad"]');

    const aplicar = () => {
        saveRelicPicksPrefs({
            query: query?.value || "",
            era: era?.value || "",
            sortBy: sort?.value || "useful",
            readyOnly: !!ready?.checked,
        });
        pintarLista(cuerpo, todas, t);
    };
    era?.addEventListener("change", aplicar);
    sort?.addEventListener("change", aplicar);
    ready?.addEventListener("change", aplicar);

    // Mismo motivo que en rutas: cada pasada persiste las prefs (escritura síncrona) y rehace
    // las tarjetas, y a una por pulsación se nota al teclear. `input` y no `keyup` porque en
    // móvil keyup solo dispara al pulsar Enter.
    let debounce;
    query?.addEventListener("input", () => {
        clearTimeout(debounce);
        debounce = setTimeout(aplicar, 120);
    });

    simRef?.addEventListener("change", () => {
        state.refinement = REFINEMENT_LABELS[simRef.value] || "Rad";
        saveAppState();
        onRebuild?.();
    });
    simSquad?.addEventListener("change", () => {
        state.squadSize = Math.min(4, Math.max(1, Number.parseInt(simSquad.value, 10) || 4));
        saveAppState();
        onRebuild?.();
    });
}
