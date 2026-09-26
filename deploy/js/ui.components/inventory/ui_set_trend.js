import { state } from "../../state.js";
import { escapeHTML } from "../../utils/escape_html.js";
import { tendenciaDeSets } from "../../services/inventory/inventory.service.js";

const POR_LADO = 3;
let dias = 2;

const tx = (es, en) => (state.currentLang === "es" ? es : en);

function fila(t) {
    const signo = t.pct > 0 ? "+" : "";
    return `<div class="set-trend-row ${t.pct > 0 ? "sube" : "baja"}">
      <span class="set-trend-name">${escapeHTML(t.clave)}</span>
      <span class="set-trend-price">${t.antes} → ${t.actual} <span class="plat-icon-inline"></span></span>
      <span class="set-trend-pct">${signo}${t.pct}%</span>
    </div>`;
}

export function setTrendHtml(filas = tendenciaDeSets(dias)) {
    const suben = filas.filter((t) => t.pct > 0).slice(0, POR_LADO);
    const bajan = filas.filter((t) => t.pct < 0).slice(-POR_LADO).reverse();
    const boton = (n) => `<button type="button" class="set-trend-btn" aria-pressed="${n === dias}" data-dias="${n}">${tx(`${n} DÍAS`, `${n} DAYS`)}</button>`;
    let cuerpo;
    if (!filas.length) {
        cuerpo = `<div class="set-trend-empty">${tx(
            `Se guarda un precio al día de los sets de los que tienes piezas. Vuelve dentro de ${dias} días para ver cuáles se han movido.`,
            `One price per day is saved for the sets you own parts of. Come back in ${dias} days to see which ones moved.`)}</div>`;
    } else if (!suben.length && !bajan.length) {
        cuerpo = `<div class="set-trend-empty">${tx("Ningún set tuyo ha cambiado de precio.", "None of your sets changed price.")}</div>`;
    } else {
        cuerpo = [...suben, ...bajan].map(fila).join("");
    }
    return `<div class="set-trend">
      <div class="set-trend-head">
        <span class="set-trend-title">${tx("TUS SETS: SUBEN Y BAJAN", "YOUR SETS: RISING AND FALLING")}</span>
        ${boton(2)}${boton(7)}
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
