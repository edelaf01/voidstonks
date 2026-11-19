import { escapeHTML } from "./ui_components.js";
import { exposeGlobals } from "../utils/global_registry.js";

const abiertos = new Set();
let orden = "pl";

function toggleVosforSindicato(id, abierto) {
    if (abierto) abiertos.add(id);
    else abiertos.delete(id);
}

export const ordenSindicatos = () => orden;

export function setOrdenSindicatos(valor) {
    orden = valor === "vos" ? "vos" : "pl";
}

const uno = (n) => (n > 0 ? n.toLocaleString(undefined, { maximumFractionDigits: 1, minimumFractionDigits: n < 10 ? 1 : 0 }) : "–");
const miles = (n) => n.toLocaleString();

function celda(valor, detalleHtml, gana) {
    return `<td class="vos-sind-num${gana ? " vos-sind-gana" : ""}">${uno(valor)}<div class="vos-sind-detalle">${detalleHtml}</div></td>`;
}

function celdaVosfor(f, { t, plat, vos }) {
    if (!f.vosPorMil) return `<td class="vos-sind-num"><span class="vos-sind-detalle">${escapeHTML(t.syndNoDissolve || "no se disuelve")}</span></td>`;
    const detalle = `${f.vosfor}${vos}${f.plEquivalente ? ` · ≈ ${uno(f.plEquivalente)}${plat}` : ""}`;
    return celda(f.vosPorMil, detalle, f.cargado && f.plEquivalente > f.renta);
}

function lineaPlatino(s, { t, nombreDe, plat }) {
    const m = s.mejorPl;
    const valor = m
        ? `${escapeHTML(nombreDe(m.slug))} · ${m.mejor === "set" ? `R${m.rangoMax}` : "R0"} · <b>${uno(m.renta)}</b>${plat}/1000`
        : escapeHTML(t.syndLoading || "Cargando precios…");
    return `<div class="vos-sind-linea"><span class="vos-sind-etiqueta">${escapeHTML(t.syndBestPl || "Mejor para platino")}</span><span>${valor}</span></div>`;
}

function lineaVosfor(s, { t, nombreDe, plat, vos }) {
    const m = s.mejorVos;
    let valor = escapeHTML(t.syndNoData || "sin dato");
    if (m) {
        const empates = s.empatesVos > 1 ? ` ${escapeHTML((t.syndTies || "(y {n} más igual)").replace("{n}", s.empatesVos - 1))}` : "";
        const aprox = m.plEquivalente ? ` ≈ ${uno(m.plEquivalente)}${plat}` : "";
        const marca = s.disolverRindeMas ? ` <span class="vos-sind-marca">${escapeHTML(t.syndDissolveBetter || "disolver rinde más")}</span>` : "";
        valor = `${escapeHTML(nombreDe(m.slug))}${empates} · <b>${uno(m.vosPorMil)}</b>${vos}/1000${aprox}${marca}`;
    }
    return `<div class="vos-sind-linea"><span class="vos-sind-etiqueta">${escapeHTML(t.syndBestVos || "Mejor para Vosfor")}</span><span>${valor}</span></div>`;
}

function bloqueSindicato(s, ctx) {
    const { es, t, nombreDe, plat, vos } = ctx;
    const filas = s.filas.map((f) => `
        <tr>
          <td class="vos-sind-arcano">${escapeHTML(nombreDe(f.slug))}<div class="vos-sind-detalle">${miles(f.standing)} ${escapeHTML(t.syndStanding || "rep.")}${f.rango ? ` · ${escapeHTML(t.syndRank || "rango")} ${f.rango}` : ""}</div></td>
          ${celda(f.porMilSuelto, f.suelto > 0 ? `${Math.round(f.suelto)}${plat}` : "", f.mejor === "suelto" && f.renta > 0)}
          ${celda(f.porMilSet, f.max > 0 ? `${Math.round(f.max)}${plat} · ${f.copias}×` : "", f.mejor === "set" && f.renta > 0)}
          ${celdaVosfor(f, ctx)}
        </tr>`).join("");
    return `
      <details class="vos-sindicato" ${abiertos.has(s.id) ? "open" : ""} ontoggle="toggleVosforSindicato('${escapeHTML(s.id)}', this.open)">
        <summary class="vos-sind-resumen">
          <span class="vos-sind-nombre">${escapeHTML(es ? s.es : s.en)}</span>
          <div class="vos-sind-lineas">${lineaPlatino(s, ctx)}${lineaVosfor(s, ctx)}</div>
        </summary>
        <div class="vos-sind-scroll">
        <table class="vos-sind-tabla">
          <thead><tr>
            <th>${escapeHTML(t.syndColArcane || "Arcano")}</th>
            <th>${escapeHTML(t.syndColSingle || "Suelto (R0)")} ${plat}/1000</th>
            <th>${escapeHTML(t.syndColSet || "Set al máximo")} ${plat}/1000</th>
            <th>${escapeHTML(t.syndColVos || "Disolver")} ${vos}/1000</th>
          </tr></thead>
          <tbody>${filas}</tbody>
        </table>
        </div>
      </details>`;
}

export function sindicatosCard(sindicatos, ctx) {
    if (!sindicatos.length) return "";
    const { t } = ctx;
    const boton = (id, etiqueta) => `<button class="vosfor-ranking-nav-btn ${orden === id ? "active" : ""}" onclick="setVosforSindOrden('${id}')">${escapeHTML(etiqueta)}</button>`;
    return `
      <div class="vosfor-sindicatos-widget">
        <div class="vos-sind-intro">${escapeHTML(t.syndIntro || "")}</div>
        <div class="vos-sind-orden">
          <span>${escapeHTML(t.syndSortBy || "Ordenar por")}</span>
          ${boton("pl", t.syndSortPl || "Platino")}${boton("vos", t.syndSortVos || "Vosfor")}
        </div>
        ${sindicatos.map((s) => bloqueSindicato(s, ctx)).join("")}
      </div>`;
}

exposeGlobals({ toggleVosforSindicato }, "ui.components/ui_vosfor_sindicatos.js");
