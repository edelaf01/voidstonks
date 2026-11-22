import { escapeHTML } from "./ui_components.js";
import { exposeGlobals } from "../utils/global_registry.js";

const abiertos = new Set();
const completos = new Set();
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

function lineaPlatino(s, { t, nombreDe }) {
    const m = s.mejorPl;
    const celdas = m
        ? `<span class="vos-sind-item">${escapeHTML(nombreDe(m.slug))}</span><span class="vos-sind-val">· <b>${uno(m.renta)}</b></span><span></span>`
        : `<span class="vos-sind-vacio">${escapeHTML(t.syndLoading || "Cargando precios…")}</span>`;
    return `<div class="vos-sind-linea"><span class="vos-sind-etiqueta">${escapeHTML(t.syndSortPl || "Platino")}</span>${celdas}</div>`;
}

function lineaVosfor(s, { t, nombreDe }) {
    const m = s.mejorVos;
    let celdas = `<span class="vos-sind-vacio">${escapeHTML(t.syndNoData || "sin dato")}</span>`;
    if (m) {
        const empates = s.empatesVos > 1 ? ` (+${s.empatesVos - 1})` : "";
        const marca = s.disolverRindeMas ? `<span class="vos-sind-marca" title="${escapeHTML(t.syndDissolveBetter || "disolver rinde más")}">▲</span>` : "";
        celdas = `<span class="vos-sind-item">${escapeHTML(nombreDe(m.slug))}${empates}</span><span class="vos-sind-val">· <b>${uno(m.vosPorMil)}</b></span><span>${marca}</span>`;
    }
    return `<div class="vos-sind-linea"><span class="vos-sind-etiqueta">${escapeHTML(t.syndSortVos || "Vosfor")}</span>${celdas}</div>`;
}

const LIMITE_FILAS = 10;

function toggleVosforSindCompleto(id, boton) {
    const caja = boton.closest(".vos-sindicato");
    const completo = caja.classList.toggle("vos-sind-completo");
    if (completo) completos.add(id);
    else completos.delete(id);
    boton.textContent = completo ? boton.dataset.menos : boton.dataset.mas;
}

function bloqueSindicato(s, ctx) {
    const { es, t, nombreDe, plat, vos } = ctx;
    const completo = completos.has(s.id);
    const ocultas = s.filas.length - LIMITE_FILAS;
    const mas = (t.syndShowMore || "Ver más ({n})").replace("{n}", ocultas);
    const menos = t.syndShowLess || "Ver menos";
    const botonMas = ocultas > 0
        ? `<button type="button" class="vosfor-ranking-nav-btn vos-sind-mas" data-mas="${escapeHTML(mas)}" data-menos="${escapeHTML(menos)}" onclick="toggleVosforSindCompleto('${escapeHTML(s.id)}', this)">${escapeHTML(completo ? menos : mas)}</button>`
        : "";
    const filas = s.filas.map((f) => `
        <tr>
          <td class="vos-sind-arcano">${escapeHTML(nombreDe(f.slug))}<div class="vos-sind-detalle">${miles(f.standing)} ${escapeHTML(t.syndStanding || "rep.")}${f.rango ? ` · ${escapeHTML(t.syndRank || "rango")} ${f.rango}` : ""}</div></td>
          ${celda(f.porMilSuelto, f.suelto > 0 ? `${Math.round(f.suelto)}${plat}` : "", f.mejor === "suelto" && f.renta > 0)}
          ${celda(f.porMilSet, f.max > 0 ? `${Math.round(f.max)}${plat} · ${f.copias}×` : "", f.mejor === "set" && f.renta > 0)}
          ${celdaVosfor(f, ctx)}
        </tr>`).join("");
    return `
      <details class="vos-sindicato${completo ? " vos-sind-completo" : ""}" ${abiertos.has(s.id) ? "open" : ""} ontoggle="toggleVosforSindicato('${escapeHTML(s.id)}', this.open)">
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
        ${botonMas}
      </details>`;
}

export function sindicatosCard(sindicatos, ctx) {
    if (!sindicatos.length) return "";
    const { t } = ctx;
    const boton = (id, etiqueta) => `<button class="vosfor-ranking-nav-btn ${orden === id ? "active" : ""}" onclick="setVosforSindOrden('${id}')">${escapeHTML(etiqueta)}</button>`;
    return `
      <div class="vosfor-sindicatos-widget">
        <details class="vos-sind-intro"><summary>ⓘ ${escapeHTML(t.syndMoreInfo || "Más info")}</summary><p>${escapeHTML(t.syndIntro || "")}</p></details>
        <div class="vos-sind-orden">
          <span>${escapeHTML(t.syndSortBy || "Ordenar por")}</span>
          ${boton("pl", t.syndSortPl || "Platino")}${boton("vos", t.syndSortVos || "Vosfor")}
        </div>
        <div class="vos-sind-grid">${sindicatos.map((s) => bloqueSindicato(s, ctx)).join("")}</div>
      </div>`;
}

exposeGlobals({ toggleVosforSindicato, toggleVosforSindCompleto }, "ui.components/ui_vosfor_sindicatos.js");
