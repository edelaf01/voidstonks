import { state } from "../../state.js";
import { TEXTS } from "../../config.js";
import { escapeHTML } from "../../utils/escape_html.js";
import { getSlug } from "../../utils/slugs.utils.js";
import { tendenciaDeSets, cicloVault, finVarzia, momentoSets } from "../../services/inventory/inventory.service.js";
import { momentoPildoraHtml, momentoSparkHtml, textoMotivo, textoFase, tipSetsDe } from "./ui_momento.js";

const DIA_MS = 86400000;
const ORDEN_ESTADO = { vender: 0, comprar: 1, esperar: 2 };
const FILTROS = [
    ["all", "cardFiltroTodos", "all", "cardTipFiltroAll"],
    ["vender", "cardFiltroVender", "vender", "cardTipFiltroVender"],
    ["comprar", "cardFiltroComprar", "comprar", "cardTipFiltroComprar"],
    ["esperar", "cardFiltroEsperar", "esperar", "cardTipFiltroEsperar"],
    ["own", "cardFiltroTuyos", "own", "cardTipFiltroOwn"],
];
const VAULT_SIG = { resurgence_proxima: "vender", resurgence_actual: "comprar", vault: "esperar" };
const VAULT_TITULO = { resurgence_proxima: "cardVaultProxima", resurgence_actual: "cardVaultActual", vault: "cardVaultVault" };
const EVENTO_KEY = { unvault: "momentoEventoUnvault", varzia: "momentoEventoVarzia" };
const TRACKER_SVG = '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="5.5"/><circle cx="8" cy="8" r="1.5" fill="currentColor" stroke="none"/><path d="M8 1v2.5M8 12.5V15M1 8h2.5M12.5 8H15"/></svg>';

let tab = "sets";
let filtro = "all";
let dias = 2;
let limite = "5";

function fmt(tpl, vars) {
    return (tpl || "").replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ""));
}

function cap(s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
}

function fechaCorta(v) {
    const ms = Date.parse(v || "");
    if (!Number.isFinite(ms)) return "";
    const opts = { day: "numeric", month: "short" };
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) opts.timeZone = "UTC";
    return new Date(ms).toLocaleDateString(state.currentLang === "es" ? "es-ES" : "en-GB", opts);
}

function diffDias(v, ahora) {
    const ms = Date.parse(v || "");
    if (!Number.isFinite(ms)) return null;
    const hoyUtc = Math.floor(ahora / DIA_MS);
    const fechaUtc = Math.floor(ms / DIA_MS);
    return fechaUtc - hoyUtc;
}

function cambioDe(f, trMap, d) {
    const tr = trMap.get(f.nombre);
    if (tr) return { antes: tr.antes, actual: f.precio > 0 ? Math.round(f.precio) : tr.actual, pct: tr.pct };
    if (d === 7 && f.p7 > 0 && f.precio > 0) {
        return { antes: Math.round(f.p7), actual: Math.round(f.precio), pct: Math.round(((f.precio - f.p7) / f.p7) * 100) };
    }
    if (d === 7 && f.serie?.length >= 2) {
        const antes = Math.round(f.serie[f.serie.length - 2].p);
        const actual = Math.round(f.precio > 0 ? f.precio : f.serie[f.serie.length - 1].p);
        if (antes > 0 && actual > 0) return { antes, actual, pct: Math.round(((actual - antes) / antes) * 100) };
    }
    return { antes: 0, actual: f.precio > 0 ? Math.round(f.precio) : 0, pct: null };
}

function pctTxt(v) {
    if (v === null) return "–";
    if (v === 0) return "0%";
    return `${v > 0 ? "+" : "−"}${Math.abs(v)}%`;
}

function pctCls(v) {
    if (v === null || v === 0) return "inv-flat";
    return v > 0 ? "inv-up" : "inv-down";
}

function motivoSet(t, f) {
    const m = textoMotivo(t, f);
    if (m) return cap(m);
    if (f.evento) return textoFase(t, f);
    return cap(t.momentoFaseSinEvento);
}

function diasVentana(f, ahora) {
    const ini = Date.parse(f.evento?.inicio || "");
    if (!Number.isFinite(ini)) return null;
    if (f.fase === "anuncio") return Math.max(0, Math.ceil((ini - ahora) / DIA_MS));
    if (f.fase === "semana1") return Math.max(0, Math.ceil((ini + 7 * DIA_MS - ahora) / DIA_MS));
    return null;
}

function recorta(lista) {
    return limite === "all" ? lista : lista.slice(0, Number(limite));
}

function siguienteLimite() {
    return limite === "5" ? "10" : "all";
}

function safeSetIdDe(nombre) {
    return String(nombre || "").replaceAll(/[^a-zA-Z0-9]/g, "");
}

function marketUrlDe(f, nombre) {
    const slug = f?.slug || getSlug(`${nombre} Set`);
    return `https://warframe.market/items/${encodeURIComponent(slug)}`;
}

function priceTipDe(t, ch) {
    if (ch.antes > 0) return fmt(t.cardTipPrecioAntes, { d: dias, a: ch.antes, b: ch.actual });
    if (ch.actual > 0) return fmt(t.cardTipPrecio, { p: ch.actual });
    return "";
}

function pctTipDe(t, ch) {
    if (ch.pct === null) return fmt(t.cardTipCambioSin, { d: dias });
    if (ch.antes > 0) return fmt(t.cardTipCambioDetalle, { d: dias, a: ch.antes, b: ch.actual, pct: pctTxt(ch.pct) });
    return fmt(t.cardTipCambio, { d: dias, pct: pctTxt(ch.pct) });
}

function sellTipDe(t, f, d) {
    if (d === null) return "";
    const evento = t[EVENTO_KEY[f.evento?.tipo]] || t.momentoEventoVarzia;
    if (f.fase === "anuncio") return d === 0 ? fmt(t.cardTipVentanaAnuncioHoy, { evento }) : fmt(t.cardTipVentanaAnuncio, { d, evento });
    if (f.fase === "semana1") return d === 0 ? fmt(t.cardTipVentanaSemana1Hoy, { evento }) : fmt(t.cardTipVentanaSemana1, { d, evento });
    return d === 0 ? t.cardVaultHoy : fmt(t.cardDiasFinAria, { d });
}

function setNameBtnHtml(t, nombre, propio) {
    const tip = propio ? t.cardTipIrInv : t.cardTipIrSet;
    const aria = propio ? fmt(t.cardTipIrInvSet, { set: nombre }) : fmt(t.cardTipTrackerSet, { set: nombre });
    return `<button type="button" class="inv-card-btn inv-card-name" data-k="goto" data-set="${escapeHTML(nombre)}" data-tooltip="${escapeHTML(tip)}" aria-label="${escapeHTML(aria)}">${escapeHTML(nombre)}</button>`;
}

function setActsHtml(t, nombre, url) {
    return `<span class="inv-card-acts"><button type="button" class="inv-card-btn inv-card-act" data-k="tracker" data-set="${escapeHTML(nombre)}" data-tooltip="${escapeHTML(t.cardTipTracker)}" aria-label="${escapeHTML(fmt(t.cardTipTrackerSet, { set: nombre }))}">${TRACKER_SVG}</button><a class="inv-card-act" href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer" data-tooltip="${escapeHTML(t.cardTipMarket)}" aria-label="${escapeHTML(fmt(t.cardTipMarketSet, { set: nombre }))}">↗</a></span>`;
}

function segHtml(k, opts, cur, aria) {
    return `<div class="inv-card-seg" role="group" aria-label="${escapeHTML(aria)}">${opts.map(([v, l, tip]) => `<button type="button" class="inv-card-btn inv-card-seg-btn" data-k="${k}" data-v="${v}" aria-pressed="${String(v) === String(cur)}"${tip ? ` data-tooltip="${escapeHTML(tip)}"` : ""}>${escapeHTML(l)}</button>`).join("")}</div>`;
}

function nSegHtml(t) {
    return segHtml("n", [
        ["5", "5", fmt(t.cardTipMostrarN, { n: 5 })],
        ["10", "10", fmt(t.cardTipMostrarN, { n: 10 })],
        ["all", t.cardMostrarTodos, t.cardTipMostrarTodos],
    ], limite, t.cardMostrarAria);
}

function dSegHtml(t) {
    return segHtml("d", [
        [2, t.cardPeriodo2, fmt(t.cardTipPeriodo, { d: 2 })],
        [7, t.cardPeriodo7, fmt(t.cardTipPeriodo, { d: 7 })],
    ], dias, t.cardPeriodoAria);
}

function moreBtnHtml(t, mostrados, total, pasoFijo) {
    const rest = total - mostrados;
    if (rest <= 0) return "";
    const n = pasoFijo && limite === "5" ? Math.min(rest, 5) : rest;
    return `<button type="button" class="inv-card-btn inv-card-more" data-k="n" data-v="${siguienteLimite()}">${escapeHTML(fmt(t.cardMas, { n }))}<span class="inv-card-hint">${escapeHTML(fmt(t.cardMostrando, { a: mostrados, b: total }))}</span></button>`;
}

function cuentaSets(filas, trMap) {
    const c = { all: filas.length, vender: 0, comprar: 0, esperar: 0, own: 0, up: 0, dn: 0 };
    for (const f of filas) {
        if (f.estado in c) c[f.estado]++;
        if (f.propio) c.own++;
        const { pct } = cambioDe(f, trMap, dias);
        if (pct !== null && pct > 0) c.up++;
        else if (pct !== null && pct < 0) c.dn++;
    }
    return c;
}

function setsBodyHtml(t, momento, trMap, c) {
    const filtrados = momento.filter((f) => filtro === "all" || (filtro === "own" ? f.propio : f.estado === filtro));
    const ordenados = [...filtrados].sort((a, b) => {
        const pa = cambioDe(a, trMap, dias).pct;
        const pb = cambioDe(b, trMap, dias).pct;
        const absDiff = Math.abs(pb ?? -1) - Math.abs(pa ?? -1);
        if (absDiff !== 0) return absDiff;
        return (ORDEN_ESTADO[a.estado] - ORDEN_ESTADO[b.estado]) || (b.propio - a.propio) || a.nombre.localeCompare(b.nombre);
    });
    const visibles = recorta(ordenados);
    const chips = FILTROS.map(([k, key, tone, tipKey]) => `<button type="button" class="inv-card-btn inv-card-chip is-tone-${tone}" data-k="f" data-v="${k}" aria-pressed="${filtro === k}" data-tooltip="${escapeHTML(fmt(t[tipKey], { n: c[k] }))}">${k === "all" ? "" : '<span class="inv-card-dot" aria-hidden="true"></span>'}${escapeHTML(t[key])}<span class="inv-card-n">${c[k]}</span></button>`).join("");
    const rows = visibles.map((f) => {
        const ch = cambioDe(f, trMap, dias);
        const ownTip = f.propio ? tipSetsDe(t, f) : "";
        const own = f.propio ? `<em class="inv-card-own" tabindex="0" data-tooltip="${escapeHTML(ownTip)}" aria-label="${escapeHTML(ownTip)}">×${f.sets || 0}</em>` : "";
        const pTip = priceTipDe(t, ch);
        const pAttrs = pTip ? ` tabindex="0" data-tooltip="${escapeHTML(pTip)}" aria-label="${escapeHTML(pTip)}"` : "";
        const price = ch.antes > 0
            ? `<span class="inv-card-was">${ch.antes}</span><span class="inv-card-ar" aria-hidden="true">→</span><b>${ch.actual}</b><span class="plat-icon-inline" aria-hidden="true"></span>`
            : ch.actual > 0
                ? `<b>${ch.actual}</b><span class="plat-icon-inline" aria-hidden="true"></span>`
                : `<span class="inv-flat">–</span>`;
        const cTip = pctTipDe(t, ch);
        const acts = setActsHtml(t, f.nombre, marketUrlDe(f, f.nombre));
        return `<div class="inv-card-row sig-${f.estado}"><div class="inv-card-nm"><span class="inv-card-nm-top">${setNameBtnHtml(t, f.nombre, f.propio)}${own}${acts}</span><small>${escapeHTML(motivoSet(t, f))}</small></div><div class="inv-card-pl">${momentoPildoraHtml(f)}</div><div class="inv-card-sp">${momentoSparkHtml(f)}</div><div class="inv-card-pr"${pAttrs}>${price}</div><div class="inv-card-pc ${pctCls(ch.pct)}" tabindex="0" data-tooltip="${escapeHTML(cTip)}" aria-label="${escapeHTML(cTip)}">${pctTxt(ch.pct)}</div></div>`;
    }).join("");
    const cntTip = fmt(t.cardTipContadores, { d: dias, up: c.up, dn: c.dn });
    const emptyMsg = momento.length ? t.cardVacioFiltro : t.cardVacioSets;
    const head = visibles.length ? `<div class="inv-card-head"><span>${escapeHTML(t.cardColSet)}</span><span class="is-c">${escapeHTML(t.cardColSenal)}</span><span class="is-c">${escapeHTML(t.cardColTendencia)}</span><span class="is-r">${escapeHTML(t.cardColAntesAhora)}</span><span class="is-r">${escapeHTML(t.cardColCambio)}</span></div>` : "";
    return `<div class="inv-card-filters" role="group" aria-label="${escapeHTML(t.cardFiltros)}">${chips}</div>
      <div class="inv-card-ctl">
        <div class="inv-card-counts" tabindex="0" data-tooltip="${escapeHTML(cntTip)}" aria-label="${escapeHTML(cntTip)}"><span class="inv-up">▲ ${c.up} ${escapeHTML(t.cardSubiendo)}</span><span class="inv-down">▼ ${c.dn} ${escapeHTML(t.cardBajando)}</span></div>
        <div class="inv-card-group"><span class="inv-card-ctrl"><span class="inv-card-lab">${escapeHTML(t.cardPeriodo)}</span>${dSegHtml(t)}</span><span class="inv-card-ctrl"><span class="inv-card-lab">${escapeHTML(t.cardMostrar)}</span>${nSegHtml(t)}</span></div>
      </div>
      ${head}${rows || `<div class="inv-card-empty">${escapeHTML(emptyMsg)}</div>`}${moreBtnHtml(t, visibles.length, ordenados.length, true)}`;
}

function sellBadgeHtml(t, f, ahora) {
    const d = diasVentana(f, ahora);
    if (d === null) return "";
    const tip = sellTipDe(t, f, d);
    const cl = d <= 3 ? "is-soon" : d <= 7 ? "is-mid" : "is-far";
    const txt = d === 0 ? t.cardVaultHoy : fmt(t.cardDiasFin, { d });
    return `<span class="inv-card-cd ${cl}" tabindex="0" data-tooltip="${escapeHTML(tip)}" aria-label="${escapeHTML(tip)}"><b>${escapeHTML(txt)}</b></span>`;
}

function sellLista(momento, ahora) {
    return momento
        .filter((f) => f.estado === "vender" && f.propio)
        .sort((a, b) => {
            const da = diasVentana(a, ahora);
            const db = diasVentana(b, ahora);
            return ((da ?? 999) - (db ?? 999)) || ((b.pct || 0) - (a.pct || 0)) || a.nombre.localeCompare(b.nombre);
        });
}

function sellBodyHtml(t, lista, ahora) {
    const visibles = recorta(lista);
    const rows = visibles.map((f) => {
        const ownTip = f.propio ? tipSetsDe(t, f) : "";
        const own = f.propio ? `<em class="inv-card-own" tabindex="0" data-tooltip="${escapeHTML(ownTip)}" aria-label="${escapeHTML(ownTip)}">×${f.sets || 0}</em>` : "";
        const pNum = Math.round(f.precio || 0);
        const pTip = pNum > 0 ? fmt(t.cardTipPrecio, { p: pNum }) : "";
        const pAttrs = pTip ? ` tabindex="0" data-tooltip="${escapeHTML(pTip)}" aria-label="${escapeHTML(pTip)}"` : "";
        const price = pNum > 0 ? `<b>${pNum}</b><span class="plat-icon-inline" aria-hidden="true"></span>` : `<span class="inv-flat">–</span>`;
        const acts = setActsHtml(t, f.nombre, marketUrlDe(f, f.nombre));
        return `<div class="inv-card-row is-sell sig-vender"><div class="inv-card-nm"><span class="inv-card-nm-top">${setNameBtnHtml(t, f.nombre, f.propio)}${own}${acts}</span><small>${escapeHTML(motivoSet(t, f))}</small></div><div class="inv-card-sp">${momentoSparkHtml(f)}</div><div class="inv-card-pr"${pAttrs}>${price}</div><div class="inv-card-cdw">${sellBadgeHtml(t, f, ahora)}</div></div>`;
    }).join("");
    return `<div class="inv-card-ctl is-flush"><div class="inv-card-note"><i aria-hidden="true"></i>${escapeHTML(t.cardNotaVender)}</div><span class="inv-card-ctrl"><span class="inv-card-lab">${escapeHTML(t.cardMostrar)}</span>${nSegHtml(t)}</span></div>
      ${rows || `<div class="inv-card-empty">${escapeHTML(t.cardVacioVender)}</div>`}${moreBtnHtml(t, visibles.length, lista.length, false)}`;
}

function agrupaVault(vault, finActual, ahora, t) {
    const porClave = new Map();
    for (const f of vault) {
        const raw = f.tipo === "resurgence_actual"
            ? (finActual && (!f.h || finActual.slice(0, 10) === f.h) ? finActual : (f.h || ""))
            : (f.d || "");
        const key = `${f.tipo}|${raw.slice(0, 10)}`;
        if (!porClave.has(key)) porClave.set(key, { tipo: f.tipo, raw, filas: [] });
        porClave.get(key).filas.push(f);
    }
    const grupos = [...porClave.values()].map((g) => {
        const d = diffDias(g.raw, ahora);
        const corta = fechaCorta(g.raw);
        let hint = "";
        if (g.tipo === "resurgence_proxima") hint = corta ? fmt(t.cicloProxima, { d: corta }) : t.venderYaResurgenciaProxima;
        else if (g.tipo === "resurgence_actual") hint = corta ? fmt(t.cicloActual, { d: corta }) : t.cicloActualSinFecha;
        else hint = corta ? fmt(t.cicloVault, { d: corta }) : t.cicloVaultSinFecha;
        let cuando = "";
        if (d === 0) cuando = t.cardVaultHoy;
        else if (d === -1) cuando = t.cardVaultAyer;
        else if (d > 0) cuando = fmt(t.cardVaultEnDias, { d });
        else if (d !== null && d < -1) cuando = fmt(t.cardVaultHaceDias, { d: -d });
        return { tipo: g.tipo, sig: VAULT_SIG[g.tipo] || "esperar", titulo: t[VAULT_TITULO[g.tipo]] || "", corta: corta || "—", cuando, hint, d, filas: g.filas };
    });
    return grupos.sort((a, b) => {
        const ra = a.d === null ? 1 : a.d >= 0 ? 0 : 2;
        const rb = b.d === null ? 1 : b.d >= 0 ? 0 : 2;
        if (ra !== rb) return ra - rb;
        if (ra === 0) return a.d - b.d;
        if (ra === 2) return b.d - a.d;
        return 0;
    });
}

function vaultBodyHtml(t, grupos, momentoMap, trMap) {
    if (!grupos.length) return `<div class="inv-card-empty">${escapeHTML(t.cardVacioVault)}</div>`;
    const items = grupos.map((g) => {
        const esVarzia = g.tipo === "resurgence_proxima" || g.tipo === "resurgence_actual";
        const heading = esVarzia
            ? `<button type="button" class="inv-card-btn inv-vt-head-link farm-link" data-k="varzia" data-tooltip="${escapeHTML(t.cardTipVarzia)}" aria-label="${escapeHTML(`${g.titulo} — ${t.cardTipVarzia}`)}">${escapeHTML(g.titulo)}</button>`
            : `<b>${escapeHTML(g.titulo)}</b>`;
        const chips = g.filas.map((f) => {
            const nombreBase = f.nombre.replace(/ Set$/, "");
            const m = momentoMap.get(nombreBase);
            const sig = m?.estado || g.sig;
            const ch = m ? cambioDe(m, trMap, dias) : { antes: 0, actual: Math.round(f.precio || 0), pct: null };
            let extra = "";
            if (ch.pct !== null) {
                const cTip = pctTipDe(t, ch);
                extra = `<em class="inv-vt-pct ${pctCls(ch.pct)}" tabindex="0" data-tooltip="${escapeHTML(cTip)}" aria-label="${escapeHTML(cTip)}">${pctTxt(ch.pct)}</em>`;
            } else if (f.precio > 0) {
                const pNum = Math.round(f.precio);
                const pTip = fmt(t.cardTipPrecio, { p: pNum });
                extra = `<em class="inv-vt-price" tabindex="0" data-tooltip="${escapeHTML(pTip)}" aria-label="${escapeHTML(pTip)}">${pNum}<span class="plat-icon-inline" aria-hidden="true"></span></em>`;
            }
            const ownTip = f.propio ? (m ? tipSetsDe(t, m) : t.momentoTienes) : "";
            const own = f.propio ? `<em class="inv-card-own" tabindex="0" data-tooltip="${escapeHTML(ownTip)}" aria-label="${escapeHTML(ownTip)}">${escapeHTML(t.cicloTienes)}</em>` : "";
            const acts = setActsHtml(t, nombreBase, marketUrlDe(f, nombreBase));
            return `<span class="inv-vt-chip sig-${sig}">${setNameBtnHtml(t, nombreBase, Boolean(f.propio))}${own}${extra}${acts}</span>`;
        }).join("");
        return `<li class="inv-vt-item sig-${g.sig}${g.d !== null && g.d < 0 ? " is-past" : ""}"><div class="inv-vt-date"><b>${escapeHTML(g.corta)}</b><span>${escapeHTML(g.cuando)}</span></div><div class="inv-vt-mark" aria-hidden="true"><i></i></div><div class="inv-vt-content">${heading}<p>${escapeHTML(g.hint)}</p><div class="inv-vt-sets">${chips}</div></div></li>`;
    }).join("");
    return `<ol class="inv-vt" aria-label="${escapeHTML(t.cardVaultLista)}">${items}</ol>`;
}

function badgeVaultHtml(t, grupos, totalVault) {
    const prox = grupos.find((g) => g.d !== null && g.d >= 0);
    if (prox) {
        const txt = prox.d === 0 ? t.cardVaultHoy : fmt(t.cardDiasFin, { d: prox.d });
        return `<span class="inv-card-bd is-red">${escapeHTML(txt)}</span>`;
    }
    return `<span class="inv-card-bd">${totalVault}</span>`;
}

function vaultTabTip(t, grupos, totalVault) {
    const prox = grupos.find((g) => g.d !== null && g.d >= 0);
    if (prox) return prox.d === 0 ? t.cardTipTabVaultHoy : fmt(t.cardTipTabVaultProx, { d: prox.d });
    return fmt(t.cardTipTabVaultTotal, { n: totalVault });
}

function reduceMotion() {
    return Boolean(globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
}

function ocultaTooltip() {
    const tip = document.getElementById("global-tooltip");
    if (!tip) return;
    tip.classList.add("hidden");
    tip.classList.remove("mega-mode");
}

function cierraPanelMovil() {
    if (document.documentElement?.dataset.shell !== "desktop") {
        document.getElementById("inventory-container")?.classList.remove("open");
    }
}

function irASet(nombre) {
    if (!nombre) return;
    if (typeof globalThis.navegarA === "function") {
        globalThis.navegarA({ tab: "set", ctx: nombre });
    } else {
        globalThis.switchTab?.("set");
        const input = document.getElementById("setItemInput");
        if (input) {
            input.value = nombre;
            globalThis.searchSet?.();
        }
    }
    cierraPanelMovil();
}

function irAVarzia() {
    if (typeof globalThis.navegarA === "function") {
        globalThis.navegarA({ tab: "bounties", ctx: "traders" });
    } else {
        globalThis.switchTab?.("bounties");
        globalThis.switchFarmsSubview?.("traders");
    }
    cierraPanelMovil();
}

function enfocaSetEnLista(list, nombre) {
    const sid = safeSetIdDe(nombre);
    if (!sid) return false;
    const grp = list.querySelector(`#set-group-${sid}`);
    if (!grp) return false;
    if (grp.classList.contains("collapsed")) globalThis.toggleInvSet?.(sid);
    grp.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "center" });
    grp.classList.remove("inv-set-flash");
    void grp.offsetWidth;
    grp.classList.add("inv-set-flash");
    clearTimeout(grp._flashTimer);
    grp._flashTimer = setTimeout(() => grp.classList.remove("inv-set-flash"), 1400);
    return true;
}

export function invCardHtml() {
    return `<section class="inv-card" hidden></section>`;
}

export function wireInvCard(list, promesaMomento = momentoSets(), vigente = () => true) {
    const root = list.querySelector(".inv-card");
    if (!root) return;
    let datos = null;

    const render = () => {
        if (!datos || !root.isConnected || !vigente()) return;
        const ahora = Date.now();
        const t = TEXTS[state.currentLang].inventory;
        const trMap = new Map(tendenciaDeSets(dias, ahora).map((x) => [x.clave, x]));
        const momentoMap = new Map(datos.momento.map((f) => [f.nombre, f]));
        const c = cuentaSets(datos.momento, trMap);
        const sells = sellLista(datos.momento, ahora);
        const vGrupos = agrupaVault(datos.vault, datos.finActual, ahora, t);
        const tabs = [
            ["sets", t.cardTabSets, `<span class="inv-card-bd"><span class="inv-up">▲${c.up}</span> <span class="inv-down">▼${c.dn}</span></span>`, fmt(t.cardTipContadores, { d: dias, up: c.up, dn: c.dn })],
            ["sell", t.cardTabVender, `<span class="inv-card-bd is-gold">${sells.length}</span>`, fmt(t.cardTipTabVender, { n: sells.length })],
            ["vault", t.cardTabVault, badgeVaultHtml(t, vGrupos, datos.vault.length), vaultTabTip(t, vGrupos, datos.vault.length)],
        ];
        const body = tab === "sell"
            ? sellBodyHtml(t, sells, ahora)
            : tab === "vault"
                ? vaultBodyHtml(t, vGrupos, momentoMap, trMap)
                : setsBodyHtml(t, datos.momento, trMap, c);
        root.innerHTML = `<div class="inv-card-tabs" role="tablist" aria-label="${escapeHTML(t.cardTablist)}">${tabs.map(([k, label, bd, tip]) => `<button type="button" class="inv-card-btn inv-card-tab" role="tab" id="inv-tab-${k}" aria-controls="inv-panel-${k}" aria-selected="${tab === k}" tabindex="${tab === k ? 0 : -1}" data-k="tab" data-v="${k}" data-tooltip="${escapeHTML(tip)}"><span>${escapeHTML(label)}</span>${bd}</button>`).join("")}</div><div class="inv-card-body" role="tabpanel" id="inv-panel-${tab}" aria-labelledby="inv-tab-${tab}">${body}</div>`;
        root.hidden = false;
    };

    root.addEventListener("click", (e) => {
        const b = e.target.closest("[data-k]");
        if (!b || !root.contains(b)) return;
        e.stopPropagation();
        ocultaTooltip();
        const k = b.dataset.k;
        const v = b.dataset.v;
        if (k === "goto") {
            if (!enfocaSetEnLista(list, b.dataset.set)) irASet(b.dataset.set);
            return;
        }
        if (k === "tracker") {
            irASet(b.dataset.set);
            return;
        }
        if (k === "varzia") {
            irAVarzia();
            return;
        }
        if (k === "tab") tab = v;
        else if (k === "f") filtro = v;
        else if (k === "d") dias = Number(v) === 7 ? 7 : 2;
        else if (k === "n") limite = v;
        render();
    });

    root.addEventListener("keydown", (e) => {
        const cur = e.target.closest('[role="tab"]');
        if (!cur || !root.contains(cur)) return;
        const all = [...root.querySelectorAll('[role="tab"]')];
        const idx = all.indexOf(cur);
        let next = -1;
        if (e.key === "ArrowRight") next = (idx + 1) % all.length;
        else if (e.key === "ArrowLeft") next = (idx - 1 + all.length) % all.length;
        else if (e.key === "Home") next = 0;
        else if (e.key === "End") next = all.length - 1;
        if (next < 0) return;
        e.preventDefault();
        tab = all[next].dataset.v;
        render();
        root.querySelector(`#inv-tab-${tab}`)?.focus();
    });

    Promise.all([
        promesaMomento.catch(() => []),
        cicloVault().catch(() => []),
        finVarzia().catch(() => null),
    ]).then(([momento, vault, finActual]) => {
        if (!root.isConnected || !vigente()) return;
        datos = { momento, vault, finActual };
        render();
    });
}
