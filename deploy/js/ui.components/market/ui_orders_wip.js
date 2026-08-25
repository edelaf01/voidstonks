import { state } from "../../state.js";
import { ORDERS_TEXTS as T } from "../../assets/orders_texts.js";

/**
 * Pantalla de "Mis órdenes" mientras warframe.market no publique su OAuth.
 *
 * Vive fuera de ui_orders.js porque ese fichero ya está por encima del techo de 800 líneas
 * (ARCHITECTURE.md §B: puede encoger, no crecer). Es además lo único que hoy se ve de la
 * pestaña, así que tenerlo suelto ayuda a encontrarlo el día que haya que borrarlo.
 */

const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
};

export function renderOrdersUnderConstruction(root) {
    const t = T[state.currentLang === "es" ? "es" : "en"];
    if (!root) return;
    root.replaceChildren();

    const box = el("div", "orders-wip");
    box.appendChild(el("div", "orders-wip-icon", "🚧"));
    box.appendChild(el("h2", "orders-wip-title", t.wipTitle));

    // El "por qué" va en el tooltip para no llenar la tarjeta de jerga: el usuario común
    // ve un mensaje corto, y quien quiera el detalle lo tiene al pasar el ratón.
    const text = el("p", "orders-wip-text", t.wipText);
    text.title = t.wipTooltip;
    box.appendChild(text);

    // Qué habrá aquí. La pantalla decía solo "en construcción" y el motivo, así que el viaje
    // hasta la pestaña no devolvía nada a cambio: estas cinco cadenas llevaban escritas en los
    // dos idiomas desde el principio y no las pintaba nadie.
    box.appendChild(el("p", "orders-about-what", t.tabWhat));
    const caps = el("ul", "orders-about-caps");
    for (const c of [t.tabCanSell, t.tabCanEdit, t.tabCanClose, t.tabCanWatch]) {
        caps.appendChild(el("li", null, c));
    }
    box.appendChild(caps);

    root.appendChild(box);
}
