import { state } from "../../state.js";
import { TEXTS } from "../../config.js";
import { escapeHTML } from "../../utils/escape_html.js";
import { momentoSets } from "../../services/inventory/inventory.service.js";

const FLECHA = { vender: "▼", comprar: "▲", esperar: "–" };
const ETIQUETA = { vender: "momentoVender", comprar: "momentoComprar", esperar: "momentoEsperar" };
const TIP = { vender: "momentoTipVender", comprar: "momentoTipComprar", esperar: "momentoTipEsperar" };
const CONFIANZA = { alta: "momentoConfianzaAlta", media: "momentoConfianzaMedia", baja: "momentoConfianzaBaja" };
const FASE = { anuncio: "momentoFaseAnuncio", semana1: "momentoFaseSemana1", espera: "momentoFaseEspera", compra: "momentoFaseCompra", sinEvento: "momentoFaseSinEvento" };
const EVENTO = { unvault: "momentoEventoUnvault", varzia: "momentoEventoVarzia" };
const ESTADOS = ["vender", "comprar", "esperar"];

export function textoFase(t, f) {
    return t.momentoMotivoVentana.replace("{evento}", t[EVENTO[f.evento?.tipo]] || "").replace("{fase}", t[FASE[f.fase]] || "").trim();
}

export function textoMotivo(t, f) {
    if (f.motivo === "ventana") return textoFase(t, f);
    if (f.motivo === "caida") return t.momentoMotivoCaida.replace("{pct}", f.pct);
    if (f.motivo === "bajoPrevio") return t.momentoMotivoBajoPrevio.replace("{pct}", f.pct);
    return "";
}

export function tipSetsDe(t, f) {
    const sets = f.sets || 0;
    const piezas = f.piezas || 0;
    if (sets === 0) return t.cardTipSinSet.replace("{n}", piezas);
    if (sets === 1) return t.cardTipSet;
    return t.cardTipSets.replace("{n}", sets);
}

function lineasTooltip(t, f) {
    const lineas = [t[TIP[f.estado]].replace("{motivo}", textoMotivo(t, f))];
    if (f.estado === "vender") lineas.push(`${t.momentoConfianza}: ${t[CONFIANZA[f.confianza]]}`);
    lineas.push(f.propio ? tipSetsDe(t, f) : t.momentoNoTienes);
    return lineas;
}

export function momentoPildoraHtml(f) {
    const t = TEXTS[state.currentLang].inventory;
    const lineas = lineasTooltip(t, f);
    const etiqueta = t[ETIQUETA[f.estado]];
    const aria = `${t.momentoTitle}: ${etiqueta}. ${lineas.join(". ")}`;
    return `<span class="momento-pill conf-${f.confianza || "baja"}${f.propio ? " es-propio" : ""}" tabindex="0" role="img" aria-label="${escapeHTML(aria)}" data-tooltip="${escapeHTML(lineas.join("\n"))}"><span class="momento-flecha" aria-hidden="true">${FLECHA[f.estado]}</span><span class="momento-txt" aria-hidden="true">${escapeHTML(etiqueta)}</span></span>`;
}

export function momentoSparkHtml(f) {
    const serie = f.serie || [];
    if (serie.length < 2) return "";
    const t = TEXTS[state.currentLang].inventory;
    const W = 100, H = 24, M = 3;
    const precios = serie.map((x) => x.p);
    const min = Math.min(...precios);
    const rango = Math.max(...precios) - min;
    const pts = serie.map((x, i) => {
        const px = M + (i / (serie.length - 1)) * (W - 2 * M);
        const py = rango > 0 ? H - M - ((x.p - min) / rango) * (H - 2 * M) : H / 2;
        return [px.toFixed(1), py.toFixed(1)];
    });
    const ultimo = pts[pts.length - 1];
    const ini = Math.round(precios[0]);
    const fin = Math.round(precios[precios.length - 1]);
    const dIni = Date.parse(serie[0].d || "");
    const dFin = Date.parse(serie[serie.length - 1].d || "");
    const sem = Number.isFinite(dIni) && Number.isFinite(dFin) && dFin > dIni
        ? Math.max(1, Math.round((dFin - dIni) / (7 * 86400000)))
        : null;
    const tip = sem
        ? (t.momentoSerieSem || "").replace("{n}", sem).replace("{a}", ini).replace("{b}", fin)
        : (t.momentoSerieRango || `${t.momentoSerie}: ${ini} → ${fin}`).replace("{a}", ini).replace("{b}", fin);
    return `<svg class="momento-spark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" tabindex="0" role="img" aria-label="${escapeHTML(tip)}" data-tooltip="${escapeHTML(tip)}"><polyline class="momento-linea" points="${pts.map((p) => p.join(",")).join(" ")}"/><circle class="momento-punto" cx="${ultimo[0]}" cy="${ultimo[1]}" r="2.4"/></svg>`;
}

export function momentoSlotsHtml() {
    return { slot: `<span class="momento-slot"></span>`, spark: `<div class="header-spark"></div>`, fase: `<div class="header-fase" hidden></div>` };
}

function pinta(grupo, filas) {
    const f = filas.get(grupo.dataset.set);
    ESTADOS.forEach((e) => grupo.classList.remove(`sig-${e}`));
    const slot = grupo.querySelector(".momento-slot");
    const spark = grupo.querySelector(".header-spark");
    const fase = grupo.querySelector(".header-fase");
    if (!f) {
        if (slot) slot.innerHTML = "";
        if (spark) spark.innerHTML = "";
        if (fase) fase.hidden = true;
        return;
    }
    grupo.classList.add(`sig-${f.estado}`);
    if (slot) slot.innerHTML = momentoPildoraHtml(f);
    if (spark) spark.innerHTML = momentoSparkHtml(f);
    if (fase) {
        const texto = f.evento ? textoFase(TEXTS[state.currentLang].inventory, f) : "";
        fase.textContent = texto;
        fase.hidden = !texto;
    }
}

export function iniciaMomento(list, vigente, promesa = momentoSets()) {
    let filas = null;
    promesa
        .then((r) => {
            filas = new Map(r.map((f) => [f.nombre, f]));
            if (vigente()) list.querySelectorAll(".inv-set-group[data-set]").forEach((g) => pinta(g, filas));
        })
        .catch(() => {});
    return (grupo) => {
        if (filas) pinta(grupo, filas);
    };
}
