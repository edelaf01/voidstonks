import { state } from "../../state.js";
import { ORDERS_TEXTS as T } from "../../assets/orders_texts.js";

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

    const text = el("p", "orders-wip-text", t.wipText);
    text.title = t.wipTooltip;
    box.appendChild(text);

    box.appendChild(el("p", "orders-about-what", t.tabWhat));
    const caps = el("ul", "orders-about-caps");
    for (const c of [t.tabCanSell, t.tabCanEdit, t.tabCanClose, t.tabCanWatch]) {
        caps.appendChild(el("li", null, c));
    }
    box.appendChild(caps);

    root.appendChild(box);
}
