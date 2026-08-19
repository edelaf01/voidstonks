import { state } from "../../state.js";
import { getItemIcon, getRequiredCount } from "../../utils/ui_utils.js";
import { getSlug } from "../../utils/slugs.utils.js";
import { buildFarmRoutes } from "../../utils/inventory/relic_route.js";
import { getRelicCounts } from "../../utils/inventory/relic_counts.js";
import { getSetsBridgePrefs, saveSetsBridgePrefs } from "../../services/inventory/farm_routes.service.js";
import { normalizeQuery, erasOf, RELIC_ERAS } from "../../services/inventory/set_recommendations.service.js";
import { BRIDGE_TEXTS } from "../../assets/sets_bridge_texts.js";

/**
 * Puente entre buscar un set y farmearlo: la lista de los que tienes a medias.
 *
 * La pestaña Set responde "cuánto vale y de qué reliquias sale", pero solo de lo que ya has
 * escrito — si no sabes qué buscar, no hay nada. Esto lo pone delante: vas a mirar Paris y de
 * paso ves que a Nikana le falta una pieza. Pulsar una entrada rellena el buscador, que es lo
 * que convierte el descubrimiento en la búsqueda siguiente.
 *
 * Es una TIRA de chips y no el panel de rutas: el plan completo (reliquia, fisura, runs,
 * plat/hora) vive en la pestaña Reliquia. Aquí solo hace falta el gancho —qué set, cuánto le
 * queda y cuánto paga—; repetir el panel sería mantener lo mismo dos veces.
 */

const texts = () => BRIDGE_TEXTS[state.currentLang === "es" ? "es" : "en"];

// Cuántos chips se ven plegada. Seis llenan dos filas en el ancho de la card; el resto sale con
// "Ver los N". Antes era un tope duro y con seis sets a una pieza no había forma de ver el
// séptimo: la tira parecía decir "tienes seis" cuando tenías veintitrés.
const COLLAPSED_CHIPS = 6;

/**
 * Sets EMPEZADOS y sin cerrar, ya ordenados.
 *
 * `buildFarmRoutes` devuelve TODOS desde que se le quitó la puerta, así que el filtro es lo que
 * hace que esto sea un puente y no el catálogo — sugerir un set intacto es justo lo que ya hace
 * el carrusel de sets populares de debajo.
 */
function rutasCercanas(sort) {
    if (!state.setsDatabase || !state.itemsDatabase) return [];
    return buildFarmRoutes({
        setsDatabase: state.setsDatabase,
        primeInventory: state.primeInventory,
        itemsDatabase: state.itemsDatabase,
        relicSources: state.relicSourcesDatabase,
        relicCounts: getRelicCounts(state.inventory),
        // Sin fisuras: esta tira no dice a dónde ir, solo cuánto te falta. Pedirlas ataría el
        // pintado a la red para un dato que no usa.
        fissures: [],
        getRequiredCount,
        // Lectura SÍNCRONA de la caché que ya llenó el inventario. getPriceValue() devuelve una
        // Promise y aquí no sirve: pasarla dejaba `gain` a null siempre, sin romper nada — o sea
        // sin avisar. Lo que no esté cacheado se queda sin etiqueta de platino, no desaparece.
        getPrice: (name) => {
            const raw = globalThis.MEMORY_CACHE?.get(getSlug(name));
            return raw ? (Number.parseInt(raw, 10) || 0) : 0;
        },
        sortBy: sort === "gain" ? "gain" : "near",
    }, Number.MAX_SAFE_INTEGER)
        .filter((r) => r.missingCount < r.totalParts);
}

/**
 * Filtros de la tira. Son SUYOS y no la búsqueda de arriba: el descubrimiento "de rebote"
 * depende justo de que la tira no se estreche con lo que estás buscando — si al escribir
 * "saryn" solo quedara Saryn, la tira dejaría de enseñarte lo que no ibas a mirar.
 *
 * Con 155 sets a medias los dos hacen falta: sin ellos, "ver todos" son 155 chips.
 */
function aplicarFiltros(rutas, prefs) {
    let out = rutas;
    const q = normalizeQuery(prefs.query);
    if (q) out = out.filter((r) => normalizeQuery(r.setName).includes(q));
    if (prefs.maxMissing > 0) out = out.filter((r) => r.missingCount <= prefs.maxMissing);
    // erasOf del service, no una copia local: el panel de rutas filtra por era con la misma
    // función. Dos implementaciones acabarían discrepando en qué cuenta como "avanzable con Lith".
    if (prefs.era) out = out.filter((r) => erasOf(r, (x) => x.missing).has(prefs.era));
    return out;
}

function chipHtml(r, t) {
    // <button> y no <div>: en táctil el click sobre un div se pierde (utils/tap.js).
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "sets-bridge-chip";
    chip.dataset.set = r.setName;
    chip.title = t.chipTitle.replace("{set}", r.setName);

    // El icono del set, igual que en las tarjetas de resultados: reconocer un warframe por su
    // silueta es más rápido que leer 20 nombres, que es justo lo que hay que hacer aquí.
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
    // "te falta 1" y "te faltan 2 de 4" dicen cosas distintas: a una pieza del final es el
    // gancho, y sin el total un "faltan 2" no distingue un set casi hecho de uno de dos piezas.
    left.textContent = r.missingCount === 1
        ? t.oneLeft
        : t.someLeft.replace("{n}", String(r.missingCount)).replace("{total}", String(r.totalParts));
    if (r.missingCount === 1) left.classList.add("is-close");
    chip.appendChild(left);

    // Solo si se pudo valorar: un "+0" por falta de precio en caché se leería como "no vale nada".
    if (r.gain > 0) {
        const gain = document.createElement("span");
        gain.className = "sets-bridge-gain";
        gain.textContent = t.gainTag.replace("{n}", String(r.gain));
        gain.title = t.gainTitle;
        chip.appendChild(gain);
    }
    return chip;
}

/**
 * Pinta la tira dentro de `container`. No hace nada si no tienes ningún set a medias: sin sets
 * empezados esto sería una lista de sugerencias al azar.
 */
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

    // Rótulo y contador juntos en su renglón; el buscador y los selectores van debajo.
    const headline = document.createElement("div");
    headline.className = "sets-bridge-headline";
    head.appendChild(headline);

    const title = document.createElement("span");
    title.className = "sets-bridge-title";
    title.textContent = t.title;
    headline.appendChild(title);

    const count = document.createElement("span");
    count.className = "sets-bridge-count";
    // Con filtros puestos hace falta el total: "12 de 155" distingue tener doce a medias de
    // estar escondiendo 143 tras un filtro que quizá pusiste hace semanas.
    count.textContent = rutas.length === todas.length
        ? t.count.replace("{n}", String(todas.length))
        : t.countFiltered.replace("{n}", String(rutas.length)).replace("{total}", String(todas.length));
    headline.appendChild(count);

    // Los controles solo se ofrecen si hay entre qué elegir: con dos sets a medias son ruido.
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
        // `input` y no `keyup`: en móvil keyup solo dispara al pulsar Enter. Con debounce porque
        // cada pasada persiste las prefs y reconstruye la tira entera.
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

        // El buscador en su propia fila y los tres selectores debajo: apretados en una sola,
        // el input se quedaba en un hueco de dos centímetros y no parecía un buscador.
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
        // Sin esto la tira se quedaba sin chips y parecía que ya no tienes nada a medias, cuando
        // lo que pasa es que el filtro los esconde. El contador de arriba dice "0 de 155".
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

/** El texto que hay que meter en el buscador, o null si el clic no fue en un chip. */
export function bridgeTargetFrom(target) {
    return target?.closest?.(".sets-bridge-chip")?.dataset.set || null;
}
