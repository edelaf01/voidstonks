import { state } from "../../state.js";
import { getItemIcon, getRequiredCount } from "../../utils/ui_utils.js";
import { getSlug } from "../../utils/slugs.utils.js";
import { buildFarmRoutes } from "../../utils/inventory/relic_route.js";
import { getRelicCounts } from "../../utils/inventory/relic_counts.js";
import { getSetsBridgePrefs, saveSetsBridgePrefs } from "../../services/inventory/farm_routes.service.js";
import { normalizeQuery, erasOf, RELIC_ERAS } from "../../services/inventory/set_recommendations.service.js";
import { BRIDGE_TEXTS } from "../../assets/sets_bridge_texts.js";

const texts = () => BRIDGE_TEXTS[state.currentLang === "es" ? "es" : "en"];

const COLLAPSED_CHIPS = 6;

function rutasCercanas(sort) {
    if (!state.setsDatabase || !state.itemsDatabase) return [];
    return buildFarmRoutes({
        setsDatabase: state.setsDatabase,
        primeInventory: state.primeInventory,
        itemsDatabase: state.itemsDatabase,
        relicSources: state.relicSourcesDatabase,
        relicCounts: getRelicCounts(state.inventory),
        fissures: [],
        getRequiredCount,
        getPrice: (name) => {
            const raw = globalThis.MEMORY_CACHE?.get(getSlug(name));
            return raw ? (Number.parseInt(raw, 10) || 0) : 0;
        },
        sortBy: sort === "gain" ? "gain" : "near",
    }, Number.MAX_SAFE_INTEGER)
        .filter((r) => r.missingCount < r.totalParts);
}

function aplicarFiltros(rutas, prefs) {
    let out = rutas;
    const q = normalizeQuery(prefs.query);
    if (q) out = out.filter((r) => normalizeQuery(r.setName).includes(q));
    if (prefs.maxMissing > 0) out = out.filter((r) => r.missingCount <= prefs.maxMissing);
    if (prefs.era) out = out.filter((r) => erasOf(r, (x) => x.missing).has(prefs.era));
    return out;
}

function chipHtml(r, t) {
    // <button>, not <div>: a tap on a div gets lost on touch
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "sets-bridge-chip";
    chip.dataset.set = r.setName;
    chip.title = t.chipTitle.replace("{set}", r.setName);

    const icono = getItemIcon(r.setName);
    if (icono) {
        const img = document.createElement("img");
        img.src = icono;
        img.alt = "";
        img.loading = "lazy";
        img.className = "sets-bridge-icon";
        img.addEventListener("error", () => img.remove());
        chip.appendChild(img);
    }

    const name = document.createElement("span");
    name.className = "sets-bridge-name";
    name.textContent = r.setName;
    chip.appendChild(name);

    const left = document.createElement("span");
    left.className = "sets-bridge-left";
    left.textContent = r.missingCount === 1
        ? t.oneLeft
        : t.someLeft.replace("{n}", String(r.missingCount)).replace("{total}", String(r.totalParts));
    if (r.missingCount === 1) left.classList.add("is-close");
    chip.appendChild(left);

    if (r.gain > 0) {
        const gain = document.createElement("span");
        gain.className = "sets-bridge-gain";
        gain.textContent = t.gainTag.replace("{n}", String(r.gain));
        gain.title = t.gainTitle;
        chip.appendChild(gain);
    }
    return chip;
}

export function renderSetsBridge(container) {
    if (!container) return;
    const prefs = getSetsBridgePrefs();
    const todas = rutasCercanas(prefs.sort);
    if (todas.length === 0) return;
    const rutas = aplicarFiltros(todas, prefs);

    const t = texts();
    const wrap = document.createElement("div");
    wrap.className = "sets-bridge";

    const head = document.createElement("div");
    head.className = "sets-bridge-head";

    const headline = document.createElement("div");
    headline.className = "sets-bridge-headline";
    head.appendChild(headline);

    const title = document.createElement("span");
    title.className = "sets-bridge-title";
    title.textContent = t.title;
    headline.appendChild(title);

    const count = document.createElement("span");
    count.className = "sets-bridge-count";
    count.textContent = rutas.length === todas.length
        ? t.count.replace("{n}", String(todas.length))
        : t.countFiltered.replace("{n}", String(rutas.length)).replace("{total}", String(todas.length));
    headline.appendChild(count);

    if (todas.length > 1) {
        const sel = document.createElement("select");
        sel.className = "sets-bridge-sort alarm-select";
        sel.setAttribute("aria-label", t.sortLabel);
        for (const [valor, etiqueta] of [["near", t.sortNear], ["gain", t.sortGain]]) {
            const opt = document.createElement("option");
            opt.value = valor;
            opt.textContent = etiqueta;
            if (prefs.sort === valor) opt.selected = true;
            sel.appendChild(opt);
        }
        sel.addEventListener("change", () => {
            saveSetsBridgePrefs({ sort: sel.value });
            globalThis.searchSet?.();
        });

        const max = document.createElement("select");
        max.className = "sets-bridge-max alarm-select";
        max.setAttribute("aria-label", t.maxMissingLabel);
        for (const [valor, etiqueta] of [[0, t.anyMissing], [1, "1"], [2, "≤ 2"], [3, "≤ 3"]]) {
            const opt = document.createElement("option");
            opt.value = String(valor);
            opt.textContent = etiqueta;
            if (prefs.maxMissing === valor) opt.selected = true;
            max.appendChild(opt);
        }
        max.addEventListener("change", () => {
            saveSetsBridgePrefs({ maxMissing: Number.parseInt(max.value, 10) || 0 });
            globalThis.searchSet?.();
        });

        const filtro = document.createElement("input");
        filtro.type = "text";
        filtro.className = "sets-bridge-filter wf-input";
        filtro.value = prefs.query || "";
        filtro.placeholder = t.filterPlaceholder;
        filtro.autocomplete = "off";
        filtro.setAttribute("aria-label", t.filterLabel);
        // input, not keyup: on mobile keyup only fires on Enter
        let debounce;
        filtro.addEventListener("input", () => {
            clearTimeout(debounce);
            debounce = setTimeout(() => {
                saveSetsBridgePrefs({ query: filtro.value });
                globalThis.searchSet?.();
            }, 150);
        });

        const era = document.createElement("select");
        era.className = "sets-bridge-era alarm-select";
        era.setAttribute("aria-label", t.eraLabel);
        for (const valor of ["", ...RELIC_ERAS]) {
            const opt = document.createElement("option");
            opt.value = valor;
            opt.textContent = valor || t.anyEra;
            if (prefs.era === valor) opt.selected = true;
            era.appendChild(opt);
        }
        era.addEventListener("change", () => {
            saveSetsBridgePrefs({ era: era.value });
            globalThis.searchSet?.();
        });

        const fila = document.createElement("div");
        fila.className = "sets-bridge-controls";
        fila.appendChild(era);
        fila.appendChild(max);
        fila.appendChild(sel);

        head.appendChild(filtro);
        head.appendChild(fila);
    }

    wrap.appendChild(head);

    if (rutas.length === 0) {
        const vacio = document.createElement("div");
        vacio.className = "sets-bridge-empty";
        vacio.textContent = t.emptyFiltered;
        wrap.appendChild(vacio);
        container.appendChild(wrap);
        return;
    }

    const row = document.createElement("div");
    row.className = "sets-bridge-row";
    const visibles = prefs.expanded ? rutas : rutas.slice(0, COLLAPSED_CHIPS);
    for (const r of visibles) row.appendChild(chipHtml(r, t));
    wrap.appendChild(row);

    if (rutas.length > COLLAPSED_CHIPS) {
        const more = document.createElement("button");
        more.type = "button";
        more.className = "sets-bridge-more";
        more.textContent = prefs.expanded
            ? t.showLess
            : t.showAll.replace("{n}", String(rutas.length));
        more.addEventListener("click", () => {
            saveSetsBridgePrefs({ expanded: !prefs.expanded });
            globalThis.searchSet?.();
        });
        wrap.appendChild(more);
    }

    container.appendChild(wrap);
}

export function bridgeTargetFrom(target) {
    return target?.closest?.(".sets-bridge-chip")?.dataset.set || null;
}
