import { state } from "../../state.js";
import { ORDERS_TEXTS as T } from "../../assets/orders_texts.js";
import {
    credencialesRecordadas,
    loginRecordado,
    olvidarCredenciales
} from "../../services/market/wfm_auth.service.js";

const txt = () => T[state.currentLang === "es" ? "es" : "en"];

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

export function montaRecordar(form, antesDe, alEntrar) {
    const t = txt();
    const fila = el("label", "orders-remember");
    fila.hidden = true;

    const casilla = el("input");
    casilla.type = "checkbox";
    casilla.id = "wfm-remember";

    const texto = el("span", null, t.rememberMe);
    fila.append(casilla, texto);
    fila.title = t.rememberHint;

    form.insertBefore(fila, antesDe);

    credencialesRecordadas().then((c) => {
        if (!c.disponible) return;
        fila.hidden = false;
        if (c.guardadas) {
            casilla.checked = true;
            const caja = el("div", "orders-saved");
            const btnEntrar = el("button", "orders-btn", c.nombre ? t.loginSaved.replace("{name}", c.nombre) : t.loginSavedAnon);
            btnEntrar.type = "button";
            const btnOlvidar = el("button", "orders-btn-ghost danger", t.forgetSaved);
            btnOlvidar.type = "button";

            btnEntrar.addEventListener("click", async () => {
                btnEntrar.disabled = true;
                btnOlvidar.disabled = true;
                btnEntrar.replaceChildren(el("span", "orders-btn-spinner"), el("span", null, t.loggingIn));
                alEntrar(await loginRecordado());
            });

            btnOlvidar.addEventListener("click", async () => {
                btnOlvidar.disabled = true;
                await olvidarCredenciales();
                caja.remove();
                casilla.checked = false;
            });

            caja.append(btnEntrar, btnOlvidar);
            form.insertBefore(caja, form.children[1] || null);
        }
    });

    return {
        marcada: () => (fila.hidden ? undefined : casilla.checked)
    };
}
