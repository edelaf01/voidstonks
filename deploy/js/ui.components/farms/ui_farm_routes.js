import { state } from "../../state.js";
import { getRequiredCount } from "../../utils/ui_utils.js";
import { buildFarmRoutes } from "../../utils/inventory/relic_route.js";
import { fetchAllFissures } from "../../services/farms/fissures.service.js";
import { escapeHTML } from "../ui_components.js";
import { exposeGlobals } from "../../utils/global_registry.js";

/**
 * "Rutas para cerrar sets": qué abrir y dónde, para los sets que tienes a medias.
 *
 * La regla de diseño es que se lea como un plan y no como un volcado: por cada pieza que
 * falta se enseña UNA reliquia — la mejor — y solo se despliega el resto si el usuario lo
 * pide. Enseñar las 6 reliquias de cada pieza de cada set es exactamente el muro de datos
 * que hace que nadie use esto.
 */

const T = {
    es: {
        title: "Rutas para cerrar sets",
        empty: "Nada a medias: no tienes piezas sueltas de ningún set sin cerrar.",
        nth: "para el", set: "set",
        missing: "faltan", of: "de", now: "Puedes ahora", need: "Necesitas la reliquia",
        open: "abre", have: "tienes", farmIn: "se farmea en", rot: "rot.",
        noFissure: "sin fisura de esa era ahora", more: "otras", less: "ocultar",
        loading: "Buscando fisuras…",
    },
    en: {
        title: "Routes to finish sets",
        empty: "Nothing in progress: no spare parts toward an unfinished set.",
        nth: "for", set: "set",
        missing: "missing", of: "of", now: "Ready now", need: "Need the relic",
        open: "open", have: "you have", farmIn: "farm in", rot: "rot.",
        noFissure: "no fissure of that era right now", more: "others", less: "hide",
        loading: "Checking fissures…",
    },
};
const texts = () => T[state.currentLang === "es" ? "es" : "en"];

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

/** Una línea de "esto es lo siguiente que hay que hacer" para una pieza. */
function partLineHtml(m, t) {
    const best = m.relics[0];
    if (!best) return `<li class="fr-part"><span class="fr-name">${escapeHTML(m.part)}</span></li>`;

    let action;
    if (best.owned > 0 && best.fissures.length > 0) {
        const f = best.fissures[0];
        action = relicPickerHtml(best.relic, `${t.open} ${best.relic}`)
            + `<span class="fr-dim">${t.have} ${best.owned}</span>`
            + `<span class="fr-where">${escapeHTML(f.type)} · ${escapeHTML(f.node)}${f.eta ? ` · ${escapeHTML(f.eta)}` : ""}</span>`;
    } else if (best.owned > 0) {
        action = relicPickerHtml(best.relic, best.relic, "wait")
            + `<span class="fr-dim">${t.have} ${best.owned} · ${t.noFissure}</span>`;
    } else {
        const src = best.sources[0];
        action = relicPickerHtml(best.relic, best.relic, "need")
            + (src
                ? `<span class="fr-where">${t.farmIn} ${escapeHTML(src.location)}${src.rotation ? ` · ${t.rot} ${escapeHTML(src.rotation)}` : ""}</span>`
                : `<span class="fr-dim">${t.need}</span>`);
    }
    return `<li class="fr-part ${m.ready ? "ready" : ""}">`
        + `<span class="fr-name">${escapeHTML(m.part)}</span>${action}</li>`;
}

function routeHtml(route, t) {
    const done = route.totalParts - route.missingCount;
    // Con sets ya montados, "2/4" a secas engaña: hay que decir que va por el siguiente.
    const nth = route.built > 0 ? ` <span class="fr-dim">${t.nth} ${route.built + 1}º ${t.set}</span>` : "";
    return `<div class="fr-set">
      <div class="fr-set-head">
        <span class="fr-set-name">${escapeHTML(route.setName)}</span>
        <span class="fr-set-prog">${done}/${route.totalParts}${nth}</span>
        ${route.readyCount > 0 ? `<span class="fr-badge">${t.now}: ${route.readyCount}</span>` : ""}
      </div>
      <ul class="fr-parts">${route.missing.map((m) => partLineHtml(m, t)).join("")}</ul>
    </div>`;
}

export async function renderFarmRoutes() {
    const container = document.getElementById("farm-routes");
    if (!container) return;
    const t = texts();

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

    const relicCounts = {};
    for (const item of state.inventory || []) {
        const name = (typeof item === "string" ? item : item.name).replace(/\s+Relic$/, "").trim();
        relicCounts[name] = (relicCounts[name] || 0) + (typeof item === "string" ? 1 : item.count || 1);
    }

    const routes = buildFarmRoutes({
        setsDatabase: state.setsDatabase,
        primeInventory: state.primeInventory,
        itemsDatabase: state.itemsDatabase,
        relicSources: state.relicSourcesDatabase,
        relicCounts, fissures, getRequiredCount,
    });

    container.style.display = "block";
    container.innerHTML = routes.length === 0
        ? `<div class="fr-title">${t.title}</div><div class="fr-empty">${t.empty}</div>`
        : `<div class="fr-title">${t.title} <span class="fr-count">${routes.length}</span></div>`
          + routes.map((r) => routeHtml(r, t)).join("");
}

exposeGlobals({ renderFarmRoutes }, "ui.components/farms/ui_farm_routes.js");
