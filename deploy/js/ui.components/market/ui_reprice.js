import { state } from "../../state.js";
import { ORDERS_TEXTS as T } from "../../assets/orders_texts.js";
import { getScope } from "../../services/market/wfm_auth.service.js";
import { estado, suscribe, enEspera, revisa, aplica, marcaVistas } from "../../services/market/reprice_lento.service.js";

const txt = () => T[state.currentLang === "es" ? "es" : "en"];
const esVenta = (o) => (o.type || "").toLowerCase() === "sell";

function el(tag, className, text) {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
}

const datosBoton = new WeakMap();
let suscrito = false;

function pintaBoton(b) {
    const t = txt();
    const est = estado();
    if (est.fase === "revisando") {
        b.textContent = t.repriceChecking
            .replace("{n}", est.hechos)
            .replace("{total}", est.total);
        b.disabled = true;
    } else if (est.fase === "aplicando") {
        b.textContent = t.repriceApplyingBg
            .replace("{n}", est.hechos)
            .replace("{total}", est.total);
        b.disabled = true;
    } else {
        b.disabled = false;
        if (est.pendientes > 0) {
            b.textContent = t.repriceBtnPending.replace("{n}", est.pendientes);
        } else {
            b.textContent = t.repriceBtn;
        }
    }
}

function aseguraSuscripcion() {
    if (suscrito) return;
    suscrito = true;
    suscribe(() => {
        for (const b of document.querySelectorAll(".orders-reprice")) {
            pintaBoton(b);
        }
    });
}

export function botonRevisarPrecios(ordenes, alTerminar) {
    aseguraSuscripcion();
    const b = el("button", "orders-btn-ghost orders-reprice");
    b.type = "button";
    b.hidden = getScope() !== "full" || !ordenes.some(esVenta);
    datosBoton.set(b, { ordenes, alTerminar });
    pintaBoton(b);
    b.addEventListener("click", () => {
        if (estado().fase !== "libre") return;
        const info = datosBoton.get(b);
        if (!info) return;
        const r = enEspera(info.ordenes);
        if (r.faltan.length === 0 || (estado().pendientes > 0 && r.desfasadas.length > 0)) {
            abreRevision(info.ordenes, info.alTerminar, r);
        } else {
            revisa(info.ordenes).then((res) => {
                if (!res || res.ocupado) return;
                const t = txt();
                const n = res.desfasadas?.length || 0;
                const partes = [];
                if (n > 0) partes.push(t.repriceToast.replace("{n}", n));
                else if (!res.sinRevisar) partes.push(t.repriceAllGood);
                if (res.frenado) partes.push(t.repriceRate);
                else if (res.sinRevisar) partes.push(t.repriceUnchecked.replace("{n}", res.sinRevisar));
                globalThis.showToast?.(partes.join(" "));
            });
        }
    });
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

function abreRevision(ordenes, alTerminar, r) {
    if (document.querySelector(".reprice-modal")) return;
    const t = txt();
    const backdrop = el("div", "orders-modal-backdrop");
    const modal = el("div", "orders-modal reprice-modal");
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");

    const cierra = () => {
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
    modal.append(head, cuerpo);
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);

    marcaVistas();
    const datosRevision = r || enEspera(ordenes);
    const { desfasadas, alDia, sinDatos, enEspera: nEspera } = datosRevision;

    let resumen = `${desfasadas.length} ${t.repriceOutdated} · ${alDia} ${t.repriceOk}${sinDatos ? ` · ${sinDatos} ${t.repriceNoData}` : ""}`;
    if (nEspera > 0) {
        resumen += ` · ${nEspera} ${t.repriceWaiting}`;
    }
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

    aplicar.addEventListener("click", () => {
        const elegidas = filas
            .filter((f) => f.marcada())
            .map((f) => ({ orden: f.orden, precio: f.precio() }));
        cierra();
        if (!elegidas.length) return;
        aplica(elegidas).then(({ hechas, fallos, frenado, ocupado }) => {
            if (ocupado) return;
            const tTermina = txt();
            globalThis.showToast?.(`${tTermina.repriceDone}: ${hechas}${fallos ? ` · ${tTermina.repriceFailed}: ${fallos}` : ""}${frenado ? ` ${tTermina.repriceRate}` : ""}`);
            if (!frenado && (hechas > 0 || fallos > 0)) {
                alTerminar?.();
            }
        });
    });

    pie.append(cancelar, aplicar);
    modal.appendChild(pie);
}
