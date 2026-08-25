import { state } from "../../state.js";
import { escapeHTML } from "../ui_components.js";
import { getIndexFilterPrefs, saveIndexFilterPrefs } from "../../services/rivens/riven_index.service.js";
import {
    INDEX_FILTER_DEFAULTS, observedTypes, whyIndexEmpty,
} from "../../utils/rivens/riven_index_filter.js";

/**
 * Barra de filtros del índice de rivens.
 *
 * En módulo aparte porque `ui_rivens.js` está en las 4.332 líneas que architecture.test le
 * congeló: puede encoger, no crecer. Aquí solo va el DOM — los predicados son puros y viven
 * en utils/rivens/riven_index_filter.js, con su test.
 */

const T = {
    es: {
        anyType: "Cualquier arma", anyDispo: "Cualquier disposición",
        dispoHigh: "Disposición alta (≥1,15)", dispoLow: "Disposición baja (≤0,85)",
        maxPrice: "Precio máx.", withData: "Solo con mercado", reset: "Quitar filtros",
        showing: "{n} de {total}",
        emptyType: "Ninguna arma de ese tipo pasa el resto de filtros",
        emptyDispo: "Ninguna con esa disposición pasa el resto de filtros",
        emptyMaxPrice: "Ninguna por debajo de ese precio",
        emptyWithData: "Ninguna de las que quedan tiene mercado observado",
        emptyHint: "Sin ese filtro saldrían {n}.",
        emptyPlain: "Nada encaja con estos filtros",
        emptyPlainHint: "Quítalos con «Quitar filtros» y prueba de uno en uno.",
        priceHelp: "Sobre el precio que se PAGA de verdad (ventas cerradas), no el que se pide en WFM.",
        dataHelp: "El índice lista todas las armas para poder buscarlas, y las que aún no tienen mercado salen a cero.",
    },
    en: {
        anyType: "Any weapon", anyDispo: "Any disposition",
        dispoHigh: "High disposition (≥1.15)", dispoLow: "Low disposition (≤0.85)",
        maxPrice: "Max price", withData: "With market only", reset: "Clear filters",
        showing: "{n} of {total}",
        emptyType: "No weapon of that type passes the other filters",
        emptyDispo: "None with that disposition passes the other filters",
        emptyMaxPrice: "None below that price",
        emptyWithData: "None of the remaining ones has observed market data",
        emptyHint: "Without that filter there would be {n}.",
        emptyPlain: "Nothing matches these filters",
        emptyPlainHint: "Use «Clear filters» and add them back one at a time.",
        priceHelp: "Against the price actually PAID (closed sales), not the one asked on WFM.",
        dataHelp: "The index lists every weapon so you can search it; those without market data yet show as zero.",
    },
};

const texts = () => T[state.currentLang === "es" ? "es" : "en"];

/** Los tipos del desplegable salen de los datos de esta pasada, no de una lista fija. */
let tiposVistos = [];

function optionsHtml(pairs, selected) {
    return pairs.map(([v, label]) =>
        `<option value="${escapeHTML(String(v))}"${String(v) === String(selected) ? " selected" : ""}>${escapeHTML(label)}</option>`,
    ).join("");
}

/**
 * Pinta la barra dentro de `host` y devuelve las preferencias vigentes.
 * @param {(prefs: object) => void} onChange se llama tras guardar, para repintar la lista.
 */
export function renderIndexFilters(host, names, weaponMap, onChange) {
    if (!host) return INDEX_FILTER_DEFAULTS;
    const t = texts();
    tiposVistos = observedTypes(names, weaponMap);
    const prefs = getIndexFilterPrefs(tiposVistos);
    const activos = Object.keys(INDEX_FILTER_DEFAULTS)
        .filter((k) => prefs[k] !== INDEX_FILTER_DEFAULTS[k]).length;

    // Se construye UNA vez por idioma y juego de tipos. filterRivenIndex pasa por aquí en
    // cada pasada —incluidas las que dispara este mismo panel—, y rehacer el innerHTML
    // destruía el <input> del precio mientras se teclea: el campo perdía el foco a media
    // cifra. En las pasadas siguientes solo se refresca lo que puede haber cambiado.
    const firma = `${state.currentLang}|${tiposVistos.join(",")}`;
    if (host.dataset.rifBuilt === firma) {
        host.querySelector('[data-rif="reset"]')?.classList.toggle("hidden", !activos);
        return prefs;
    }
    host.dataset.rifBuilt = firma;

    host.innerHTML = `
      <select data-rif="type" class="wf-input riven-index-filter" aria-label="${escapeHTML(t.anyType)}">
        ${optionsHtml([["", t.anyType], ...tiposVistos.map((x) => [x, x])], prefs.type)}
      </select>
      <select data-rif="dispo" class="wf-input riven-index-filter" aria-label="${escapeHTML(t.anyDispo)}">
        ${optionsHtml([["", t.anyDispo], ["high", t.dispoHigh], ["low", t.dispoLow]], prefs.dispo)}
      </select>
      <input type="number" data-rif="maxPrice" class="wf-input riven-index-filter riven-index-price"
             min="0" step="10" inputmode="numeric" value="${prefs.maxPrice || ""}"
             placeholder="${escapeHTML(t.maxPrice)}" aria-label="${escapeHTML(t.maxPrice)}"
             data-tooltip="${escapeHTML(t.priceHelp)}" />
      <label class="riven-index-check" data-tooltip="${escapeHTML(t.dataHelp)}">
        <input type="checkbox" data-rif="withData"${prefs.withData ? " checked" : ""} />
        <span>${escapeHTML(t.withData)}</span>
      </label>
      <button type="button" data-rif="reset" class="riven-index-reset${activos ? "" : " hidden"}">${escapeHTML(t.reset)}</button>`;

    const guardar = () => {
        const leer = (sel) => host.querySelector(`[data-rif="${sel}"]`);
        saveIndexFilterPrefs({
            type: leer("type")?.value || "",
            dispo: leer("dispo")?.value || "",
            maxPrice: Number.parseInt(leer("maxPrice")?.value, 10) || 0,
            withData: !!leer("withData")?.checked,
        });
        onChange?.(getIndexFilterPrefs(tiposVistos));
    };

    host.addEventListener("change", (e) => {
        if (e.target.closest("[data-rif]")) guardar();
    });
    // El precio se teclea: con `change` a secas no se aplicaría hasta salir del campo, y
    // parecería que el filtro no hace nada. Debounce porque cada pasada repinta la lista.
    let debounce;
    host.querySelector('[data-rif="maxPrice"]')?.addEventListener("input", () => {
        clearTimeout(debounce);
        debounce = setTimeout(guardar, 250);
    });
    host.querySelector('[data-rif="reset"]')?.addEventListener("click", () => {
        saveIndexFilterPrefs({ ...INDEX_FILTER_DEFAULTS });
        onChange?.({ ...INDEX_FILTER_DEFAULTS });
    });

    return prefs;
}

/** Cuántas se enseñan de cuántas hay. Sin esto, una lista corta no se distingue de un índice
 *  corto: es la misma señal que el contador de fisuras escondidas. */
export function indexCountHtml(shown, total) {
    if (shown === total) return "";
    return `<span class="riven-index-count">${escapeHTML(
        texts().showing.replace("{n}", String(shown)).replace("{total}", String(total)))}</span>`;
}

/**
 * Estado vacío que NOMBRA al filtro culpable. "Sin resultados" manda a probar a ciegas; decir
 * cuál sobra y cuántas hay detrás se puede deshacer de un vistazo. Copiado del panel de rutas,
 * que es donde este patrón ya funciona.
 */
export function indexEmptyHtml(entries, prefs, weaponMap) {
    const t = texts();
    const motivo = whyIndexEmpty(entries, prefs, weaponMap);
    const titulo = motivo ? t[`empty${motivo.key[0].toUpperCase()}${motivo.key.slice(1)}`] : t.emptyPlain;
    const pista = motivo
        ? t.emptyHint.replace("{n}", String(motivo.count))
        : t.emptyPlainHint;
    return `<div class="riven-index-empty">${escapeHTML(titulo || t.emptyPlain)}`
        + `<span class="riven-index-empty-hint">${escapeHTML(pista)}</span></div>`;
}
