import { escapeHTML } from "./ui_components.js";
import { exposeGlobals } from "../utils/global_registry.js";

const abiertos = new Set();

function toggleVosforSindicato(id, abierto) {
    if (abierto) abiertos.add(id);
    else abiertos.delete(id);
}

const uno = (n) => (n > 0 ? n.toLocaleString(undefined, { maximumFractionDigits: 1, minimumFractionDigits: n < 10 ? 1 : 0 }) : "–");
const miles = (n) => n.toLocaleString();

function celda(valor, detalleHtml, gana) {
    const estilo = gana ? "color:#00ff78;font-weight:800;" : "color:#ddd;";
    return `<td style="text-align:right;padding:3px 6px;${estilo}">${uno(valor)}<div style="font-size:0.66rem;color:#888;font-weight:400;">${detalleHtml}</div></td>`;
}

function bloqueSindicato(s, { es, nombreDe, plat }) {
    const mejor = s.filas.find((f) => f.renta > 0);
    const resumen = mejor
        ? `${escapeHTML(nombreDe(mejor.slug))} · ${mejor.mejor === "set" ? `R${mejor.rangoMax}` : "R0"} · ${uno(mejor.renta)}${plat}/1000`
        : escapeHTML(es ? "Cargando precios…" : "Loading prices…");
    const filas = s.filas.map((f) => `
        <tr style="border-top:1px solid rgba(255,255,255,0.06);">
          <td style="padding:3px 6px;color:#fff;">${escapeHTML(nombreDe(f.slug))}<div style="font-size:0.66rem;color:#888;">${miles(f.standing)} ${escapeHTML(es ? "rep." : "standing")}${f.rango ? ` · ${escapeHTML(es ? "rango" : "rank")} ${f.rango}` : ""}</div></td>
          ${celda(f.porMilSuelto, f.suelto > 0 ? `${Math.round(f.suelto)}${plat}` : "", f.mejor === "suelto" && f.renta > 0)}
          ${celda(f.porMilSet, f.max > 0 ? `${Math.round(f.max)}${plat} · ${f.copias}×` : "", f.mejor === "set" && f.renta > 0)}
        </tr>`).join("");
    return `
      <details class="vos-sindicato" style="margin-bottom:6px;" ${abiertos.has(s.id) ? "open" : ""} ontoggle="toggleVosforSindicato('${escapeHTML(s.id)}', this.open)">
        <summary style="cursor:pointer;display:flex;justify-content:space-between;gap:8px;padding:4px 2px;">
          <span style="font-weight:700;color:#e8c88a;">${escapeHTML(es ? s.es : s.en)}</span>
          <span style="font-size:0.78rem;color:#ccc;">${resumen}</span>
        </summary>
        <table style="width:100%;border-collapse:collapse;font-size:0.8rem;">
          <thead><tr style="color:#999;font-size:0.7rem;">
            <th style="text-align:left;padding:2px 6px;">${escapeHTML(es ? "Arcano" : "Arcane")}</th>
            <th style="text-align:right;padding:2px 6px;">${escapeHTML(es ? "Suelto (R0)" : "Single (R0)")} ${plat}/1000</th>
            <th style="text-align:right;padding:2px 6px;">${escapeHTML(es ? "Set al máximo" : "Maxed set")} ${plat}/1000</th>
          </tr></thead>
          <tbody>${filas}</tbody>
        </table>
      </details>`;
}

export function sindicatosCard(sindicatos, { es, nombreDe, plat }) {
    if (!sindicatos.length) return "";
    return `
      <div class="vosfor-sindicatos-widget">
        <div style="font-size:0.72rem;color:#bbb;margin-bottom:8px;">${escapeHTML(es
        ? "Platino por cada 1.000 de reputación. Suelto: vender cada copia sin subir. Set al máximo: comprar las copias que hacen falta (21 para R5, 10 para R3) y vender el arcano subido. Precio de venta realizable, no el anuncio a pelo."
        : "Platinum per 1,000 standing. Single: sell each copy unranked. Maxed set: buy the copies it takes (21 for R5, 10 for R3) and sell the maxed arcane. Realizable sale price, not the raw listing.")}</div>
        ${sindicatos.map((s) => bloqueSindicato(s, { es, nombreDe, plat })).join("")}
      </div>`;
}

exposeGlobals({ toggleVosforSindicato }, "ui.components/ui_vosfor_sindicatos.js");
