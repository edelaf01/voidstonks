import { state } from "../../state.js";
import { escapeHTML } from "../../utils/escape_html.js";
import { TEXTS } from "../../config.js";
import { ventaUrgente, cicloVault } from "../../services/inventory/inventory.service.js";
import { getSetName, getItemIcon, progresoSets, etiquetaProgresoSet } from "../../utils/ui_utils.js";

const MAX_FILAS = 5;

function motivo(t, f) {
    if (f.motivo === "resurgenciaProxima") return t.venderYaResurgenciaProxima;
    const pct = f.p7 > 0 ? Math.round(((f.p7 - f.precio) / f.p7) * 100) : 0;
    return t.venderYaBajando.replace("{pct}", pct);
}

function agrupar(filas, clave) {
    const grupos = [];
    const porClave = new Map();
    for (const f of filas) {
        const k = clave(f);
        if (!porClave.has(k)) {
            const g = { clave: k, filas: [] };
            porClave.set(k, g);
            grupos.push(g);
        }
        porClave.get(k).filas.push(f);
    }
    return grupos;
}

function cabeceraHtml(texto, clase) {
    return `<div class="set-trend-row ${clase}"><span class="set-trend-pct">${escapeHTML(texto)}</span></div>`;
}

function filaHtml(nombre, qty, precio, clase, pista) {
    return `<div class="set-trend-row ${clase}">
        <span class="set-trend-name">${escapeHTML(nombre)}${qty ? ` x${qty}` : ""}</span>
        <span class="set-trend-price">${precio > 0 ? `${Math.round(precio)} <span class="plat-icon-inline"></span>` : ""}</span>${pista ? `
        <span class="set-trend-pct">${escapeHTML(pista)}</span>` : ""}
      </div>`;
}

function porSetHtml(filas, clase, pista) {
    return agrupar(filas, (f) => getSetName(f.name)).map((g) => {
        const icono = getItemIcon(g.clave);
        const total = g.filas.reduce((s, f) => s + (f.precio > 0 ? f.precio * (f.qty || 1) : 0), 0);
        const cuenta = etiquetaProgresoSet(progresoSets([g.clave]));
        return `<details class="vender-ya-grupo"><summary class="set-trend-row ${clase} vender-ya-set">
        <span class="vender-ya-img">${icono ? `<img src="${escapeHTML(icono)}" alt="" loading="lazy" onerror="this.remove()">` : ""}</span>
        <span class="set-trend-name">${escapeHTML(g.clave)}</span>${cuenta ? `
        <span class="vender-ya-cuenta">${escapeHTML(cuenta)}</span>` : ""}
        <span class="set-trend-price">${total > 0 ? `${Math.round(total)} <span class="plat-icon-inline"></span>` : ""}</span>
      </summary>`
        + g.filas.map((f) => filaHtml(f.name.startsWith(`${g.clave} `) ? f.name.slice(g.clave.length + 1) : f.name, f.qty, f.precio, `${clase} vender-ya-pieza`, pista?.(f))).join("") + "</details>";
    }).join("");
}

function fechaCorta(v) {
    const ms = Date.parse(v || "");
    if (!Number.isFinite(ms)) return "";
    const opts = { day: "numeric", month: "short" };
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) opts.timeZone = "UTC";
    return new Date(ms).toLocaleDateString(state.currentLang === "es" ? "es-ES" : "en-GB", opts);
}

let varzia = null;

function datosVarzia() {
    varzia ??= fetch("assets/json/eventos_prime.json")
        .then((r) => (r.ok ? r.json() : null))
        .then((e) => e?._varzia || null)
        .catch(() => { varzia = null; return null; });
    return varzia;
}

async function finVarzia() {
    const v = await datosVarzia();
    return Date.parse(v?.fin || "") > Date.now() ? v.fin : null;
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
    const sets = [...new Set(filas.map((f) => getSetName(f.name)))].slice(0, MAX_FILAS);
    const visibles = filas.filter((f) => sets.includes(getSetName(f.name)));
    caja.innerHTML = `<div class="set-trend-head">
        <span class="set-trend-title">${t.venderYaTitle}</span>
      </div>
      <div class="set-trend-list">${agrupar(visibles, (f) => f.motivo === "resurgenciaProxima" ? motivo(t, f) : "").map((g) => (g.clave ? cabeceraHtml(g.clave, "baja") : "")
        + porSetHtml(g.filas, "baja", g.clave ? null : (f) => motivo(t, f))).join("")}</div>`;
    caja.hidden = false;
}

function pistaCiclo(t, f, finActual) {
    if (f.tipo === "resurgence_proxima") return f.d ? t.cicloProxima.replace("{d}", fechaCorta(f.d) || f.d) : t.venderYaResurgenciaProxima;
    if (f.tipo === "resurgence_actual") {
        const d = fechaCorta(finActual && (!f.h || finActual.slice(0, 10) === f.h) ? finActual : f.h);
        return d ? t.cicloActual.replace("{d}", d) : t.cicloActualSinFecha;
    }
    return f.d ? t.cicloVault.replace("{d}", fechaCorta(f.d) || f.d) : t.cicloVaultSinFecha;
}

const CLAVE_CICLO_PLEGADO = "vs_ciclo_vault_plegado";

export function cicloVaultHtml() {
    return `<div class="set-trend ciclo-vault" hidden></div>`;
}

export async function wireCicloVault(list) {
    const caja = list.querySelector(".ciclo-vault");
    if (!caja) return;
    let filas = [];
    try { filas = await cicloVault(); } catch { filas = []; }
    if (!filas.length || !caja.isConnected) return;
    const finActual = filas.some((f) => f.tipo === "resurgence_actual") ? await finVarzia() : null;
    if (!caja.isConnected) return;
    const t = TEXTS[state.currentLang].inventory;
    const clase = { resurgence_proxima: "baja", resurgence_actual: "sube", vault: "sube" };
    let plegado = false;
    try { plegado = localStorage.getItem(CLAVE_CICLO_PLEGADO) === "1"; } catch {}
    caja.classList.toggle("collapsed", plegado);
    caja.innerHTML = `<button type="button" class="set-trend-head set-trend-toggle" aria-expanded="${plegado ? "false" : "true"}">
        <span class="set-trend-title">${t.cicloTitle}</span>
        <span class="set-trend-arrow" aria-hidden="true">▾</span>
      </button>
      <div class="set-trend-list">${agrupar(filas, (f) => pistaCiclo(t, f, finActual)).map((g) => cabeceraHtml(g.clave, clase[g.filas[0].tipo])
        + g.filas.map((f) => filaHtml(`${f.nombre}${f.propio ? ` (${t.cicloTienes})` : ""}`, 0, f.precio, clase[f.tipo])).join("")).join("")}</div>`;
    caja.querySelector(".set-trend-toggle").addEventListener("click", (e) => {
        const cerrar = !caja.classList.contains("collapsed");
        caja.classList.toggle("collapsed", cerrar);
        e.currentTarget.setAttribute("aria-expanded", String(!cerrar));
        try { localStorage.setItem(CLAVE_CICLO_PLEGADO, cerrar ? "1" : "0"); } catch {}
    });
    caja.hidden = false;
}
