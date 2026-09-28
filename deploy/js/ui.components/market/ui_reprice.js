import { state } from "../../state.js";
import { ORDERS_TEXTS as T } from "../../assets/orders_texts.js";
import { getScope } from "../../services/market/wfm_auth.service.js";
import { editOrder, mercadoDeTodos } from "../../services/market/wfm_orders.service.js";
import { revisaPrecios } from "../../utils/market/precio_reciente.js";

/** Revisión de los precios de venta frente a lo vendido en las últimas 48 h, y su actualización en bloque. */

const txt = () => T[state.currentLang === "es" ? "es" : "en"];
const esVenta = (o) => (o.type || "").toLowerCase() === "sell";
// warframe.market admite 3 peticiones por segundo.
const PAUSA_MS = 350;

function el(tag, className, text) {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
}

export function botonRevisarPrecios(ordenes, alTerminar) {
    const b = el("button", "orders-btn-ghost orders-reprice", txt().repriceBtn);
    b.type = "button";
    b.hidden = getScope() !== "full" || !ordenes.some(esVenta);
    b.addEventListener("click", () => abreRevision(ordenes, alTerminar));
    return b;
}

function motivo(d, t) {
    if (d.base === "dia") return `${t.repriceDay} ${d.mediana}${d.ventas ? ` · ${d.ventas} ${t.repriceSales}` : ""}`;
    return `${t.repriceLast} ${d.ultima} (${t.repriceAgo.replace("{n}", Math.round(d.horas))}) · ${t.repriceMedian} ${d.mediana} · ${d.ventas} ${t.repriceSales}`;
}

function fila(d, t) {
    const nodo = el("div", "reprice-row");
    const marca = el("input");
    marca.type = "checkbox";
    marca.checked = true;
    const info = el("span", "reprice-info");
    const rango = Number.isInteger(d.orden.rank) ? ` R${d.orden.rank}` : "";
    info.append(el("span", "reprice-name", `${d.orden.itemName || d.orden.itemSlug}${rango}`), el("span", "reprice-why", motivo(d, t)));
    if (d.orden.visible === false) info.firstChild.appendChild(el("span", "order-hidden-tag", t.hidden));
    const ahora = el("span", `reprice-now ${d.dif > 0 ? "caro" : "barato"}`, `${d.orden.platinum} (${d.pct > 0 ? "+" : ""}${d.pct}%)`);
    const precio = el("input", "orders-input reprice-price");
    precio.type = "number";
    precio.min = "1";
    precio.value = String(d.precio);
    nodo.append(marca, info, ahora, el("span", "reprice-arrow", "→"), precio);
    return { nodo, orden: d.orden, marcada: () => marca.checked, precio: () => Math.max(1, Math.round(Number(precio.value) || d.precio)) };
}

async function abreRevision(ordenes, alTerminar) {
    if (document.querySelector(".reprice-modal")) return;
    const t = txt();
    const backdrop = el("div", "orders-modal-backdrop");
    const modal = el("div", "orders-modal reprice-modal");
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    let aplicando = false;
    const cierra = () => {
        if (aplicando) return;
        backdrop.remove();
        document.removeEventListener("keydown", tecla);
    };
    const tecla = (e) => { if (e.key === "Escape") cierra(); };
    document.addEventListener("keydown", tecla);
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) cierra(); });

    const head = el("div", "orders-modal-head");
    const x = el("button", "orders-modal-x", "×");
    x.type = "button";
    x.setAttribute("aria-label", t.close);
    x.addEventListener("click", cierra);
    head.append(el("h3", "orders-modal-title", t.repriceTitle), x);
    const cuerpo = el("div", "reprice-body");
    const estado = el("p", "orders-state-text", t.repriceLoading);
    cuerpo.appendChild(estado);
    modal.append(head, cuerpo);
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);

    const ventas = ordenes.filter(esVenta);
    const mercados = await mercadoDeTodos(ventas.map((o) => o.itemSlug), {
        fresco: true,
        onProgreso: ({ hechos, total }) => { estado.textContent = `${t.repriceLoading} ${hechos}/${total}`; },
    });
    if (!backdrop.isConnected) return;

    const { desfasadas, alDia, sinDatos } = revisaPrecios(ventas, mercados);
    const resumen = `${desfasadas.length} ${t.repriceOutdated} · ${alDia} ${t.repriceOk}${sinDatos ? ` · ${sinDatos} ${t.repriceNoData}` : ""}`;
    cuerpo.replaceChildren(el("p", "reprice-resumen", resumen));
    if (!desfasadas.length) {
        cuerpo.appendChild(el("p", "orders-state-text", t.repriceAllGood));
        return;
    }
    cuerpo.appendChild(el("p", "orders-inv-hint", t.repriceHint));
    const filas = desfasadas.map((d) => fila(d, t));
    const lista = el("div", "reprice-list");
    lista.append(...filas.map((f) => f.nodo));
    cuerpo.appendChild(lista);

    const pie = el("div", "orders-modal-foot");
    const cancelar = el("button", "orders-btn-ghost", t.cancel);
    cancelar.type = "button";
    cancelar.addEventListener("click", cierra);
    const aplicar = el("button", "orders-btn");
    aplicar.type = "button";
    const cuenta = () => {
        const n = filas.filter((f) => f.marcada()).length;
        aplicar.textContent = `${t.repriceApply} (${n})`;
        aplicar.disabled = !n;
    };
    lista.addEventListener("change", cuenta);
    cuenta();
    aplicar.addEventListener("click", async () => {
        aplicando = true;
        aplicar.disabled = cancelar.disabled = true;
        const elegidas = filas.filter((f) => f.marcada());
        let hechas = 0, fallos = 0;
        for (const f of elegidas) {
            aplicar.textContent = `${t.repriceApplying} ${hechas + fallos + 1}/${elegidas.length}`;
            const res = await editOrder(f.orden.id, "update", { platinum: f.precio() });
            f.nodo.classList.add(res.ok ? "is-done" : "is-failed");
            if (res.ok) hechas++;
            else fallos++;
            await new Promise((ok) => setTimeout(ok, PAUSA_MS));
        }
        aplicando = false;
        globalThis.showToast?.(`${t.repriceDone}: ${hechas}${fallos ? ` · ${t.repriceFailed}: ${fallos}` : ""}`);
        cierra();
        if (hechas) alTerminar?.();
    });
    pie.append(cancelar, aplicar);
    modal.appendChild(pie);
}
