import { state } from "../../state.js";
import { escapeHTML } from "../../utils/escape_html.js";
import { tendenciaDeSets } from "../../services/inventory/inventory.service.js";

let dias = 2;

const tx = (es, en) => (state.currentLang === "es" ? es : en);

function fila(t, tope) {
    const clase = t.pct > 0 ? "sube" : t.pct < 0 ? "baja" : "igual";
    return `<div class="set-trend-row ${clase}">
      <span class="set-trend-name">${escapeHTML(t.clave)}</span>
      <span class="set-trend-price">${t.pct ? `${t.antes} → ` : ""}${t.actual} <span class="plat-icon-inline"></span></span>
      <span class="set-trend-pct" style="--barra:${Math.round((Math.abs(t.pct) / tope) * 100)}%">${t.pct > 0 ? "+" : ""}${t.pct}%</span>
    </div>`;
}

export function setTrendHtml(filas = tendenciaDeSets(dias)) {
    const suben = filas.filter((t) => t.pct > 0), bajan = filas.filter((t) => t.pct < 0).reverse();
    const orden = [...suben, ...bajan, ...filas.filter((t) => !t.pct)];
    const tope = Math.max(1, ...filas.map((t) => Math.abs(t.pct)));
    const boton = (n) => `<button type="button" class="set-trend-btn" aria-pressed="${n === dias}" data-dias="${n}">${tx(`${n} DÍAS`, `${n} DAYS`)}</button>`;
    const cuerpo = filas.length
        ? `<div class="set-trend-list">${orden.map((t) => fila(t, tope)).join("")}</div>`
        : `<div class="set-trend-empty">${tx(
            `Se guarda un precio al día de los sets de los que tienes piezas. Vuelve dentro de ${dias} días para ver cuáles se han movido.`,
            `One price per day is saved for the sets you own parts of. Come back in ${dias} days to see which ones moved.`)}</div>`;
    const resumen = filas.length ? `<span class="set-trend-sum"><b class="sube">▲${suben.length}</b><b class="baja">▼${bajan.length}</b></span>` : "";
    return `<div class="set-trend">
      <div class="set-trend-head">
        <span class="set-trend-title">${tx("TUS SETS: SUBEN Y BAJAN", "YOUR SETS: RISING AND FALLING")}</span>
        ${resumen}${boton(2)}${boton(7)}
      </div>
      ${cuerpo}
    </div>`;
}

export function wireSetTrend(list) {
    list.querySelector(".set-trend")?.addEventListener("click", (e) => {
        const n = Number(e.target.closest("[data-dias]")?.dataset.dias);
        if (!n || n === dias) return;
        dias = n;
        e.currentTarget.outerHTML = setTrendHtml();
        wireSetTrend(list);
    });
}
