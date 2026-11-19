import { state } from "../../state.js";
import { escapeHTML } from "../../utils/escape_html.js";
import { TEXTS } from "../../config.js";
import { ventaUrgente, cicloVault } from "../../services/inventory/inventory.service.js";

const MAX_FILAS = 5;

function motivo(t, f) {
    if (f.motivo === "resurgenciaProxima") return t.venderYaResurgenciaProxima;
    const pct = f.p7 > 0 ? Math.round(((f.p7 - f.precio) / f.p7) * 100) : 0;
    return t.venderYaBajando.replace("{pct}", pct);
}

export function venderYaHtml() {
    return `<div class="set-trend vender-ya" hidden></div>`;
}

export async function wireVenderYa(list) {
    const caja = list.querySelector(".vender-ya");
    if (!caja) return;
    let filas = [];
    try { filas = await ventaUrgente(); } catch { filas = []; }
    if (!filas.length || !caja.isConnected) return;
    const t = TEXTS[state.currentLang].inventory;
    caja.innerHTML = `<div class="set-trend-head">
        <span class="set-trend-title">${t.venderYaTitle}</span>
      </div>
      <div class="set-trend-list">${filas.slice(0, MAX_FILAS).map((f) => `<div class="set-trend-row baja">
        <span class="set-trend-name">${escapeHTML(f.name)} x${f.qty}</span>
        <span class="set-trend-price">${Math.round(f.precio)} <span class="plat-icon-inline"></span></span>
        <span class="set-trend-pct">${escapeHTML(motivo(t, f))}</span>
      </div>`).join("")}</div>`;
    caja.hidden = false;
}

function pistaCiclo(t, f) {
    if (f.tipo === "resurgence_proxima") return t.cicloProxima.replace("{d}", f.d || "?");
    if (f.tipo === "resurgence_actual") return t.cicloActual.replace("{d}", f.h || "?");
    return t.cicloVault.replace("{d}", f.d || "?");
}

export function cicloVaultHtml() {
    return `<div class="set-trend ciclo-vault" hidden></div>`;
}

export async function wireCicloVault(list) {
    const caja = list.querySelector(".ciclo-vault");
    if (!caja) return;
    let filas = [];
    try { filas = await cicloVault(); } catch { filas = []; }
    if (!filas.length || !caja.isConnected) return;
    const t = TEXTS[state.currentLang].inventory;
    const clase = { resurgence_proxima: "baja", resurgence_actual: "sube", vault: "sube" };
    caja.innerHTML = `<div class="set-trend-head">
        <span class="set-trend-title">${t.cicloTitle}</span>
      </div>
      <div class="set-trend-list">${filas.map((f) => `<div class="set-trend-row ${clase[f.tipo]}">
        <span class="set-trend-name">${escapeHTML(f.nombre)}${f.propio ? ` (${t.cicloTienes})` : ""}</span>
        <span class="set-trend-price">${f.precio > 0 ? `${Math.round(f.precio)} <span class="plat-icon-inline"></span>` : ""}</span>
        <span class="set-trend-pct">${escapeHTML(pistaCiclo(t, f))}</span>
      </div>`).join("")}</div>`;
    caja.hidden = false;
}
