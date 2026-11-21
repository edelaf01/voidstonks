import { state } from "../../state.js";
import { TEXTS } from "../../config.js";
import { escapeHTML } from "../../utils/escape_html.js";

const CLAVE = "voidstonks_historial_sets_v3";
const DIA_MS = 86400000;
const W = 600, H = 170, M = { l: 40, r: 12, t: 22, b: 22 };
const EXTRA = 0.15 / 0.85;
let instancias = 0;
let carga = null;
let eventosCarga = null;

function eventos() {
    eventosCarga ??= fetch("assets/json/eventos_prime.json")
        .then((r) => (r.ok ? r.json() : {}))
        .catch(() => { eventosCarga = null; return {}; });
    return eventosCarga;
}

function deCache() {
    try {
        const c = JSON.parse(localStorage.getItem(CLAVE));
        return c && Date.now() - c.ts < DIA_MS ? c.datos : null;
    } catch { return null; }
}

function datos() {
    const c = deCache();
    if (c) return Promise.resolve(c);
    carga ??= Promise.all([
        fetch("assets/json/historial_sets.json").then((r) => (r.ok ? r.json() : null)),
        eventos(),
    ]).then(([h, e]) => {
        const d = { h, e: e || {} };
        if (h && Object.keys(d.e).length) try { localStorage.setItem(CLAVE, JSON.stringify({ ts: Date.now(), datos: d })); } catch {}
        return d;
    }).finally(() => { carga = null; });
    return carga;
}

function pasoBonito(rango, n) {
    const bruto = rango / n, base = 10 ** Math.floor(Math.log10(bruto)), f = bruto / base;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * base;
}

function curva(p) {
    const n = p.length, dx = [], s = [], m = [];
    for (let i = 0; i < n - 1; i++) {
        dx[i] = p[i + 1][0] - p[i][0];
        s[i] = (p[i + 1][1] - p[i][1]) / dx[i];
    }
    m[0] = s[0];
    m[n - 1] = s[n - 2];
    for (let i = 1; i < n - 1; i++) {
        m[i] = s[i - 1] * s[i] <= 0 ? 0 : (3 * (dx[i - 1] + dx[i])) / ((2 * dx[i] + dx[i - 1]) / s[i - 1] + (dx[i] + 2 * dx[i - 1]) / s[i]);
    }
    const f = (v) => v.toFixed(1);
    let d = `M${f(p[0][0])},${f(p[0][1])}`;
    for (let i = 0; i < n - 1; i++) {
        const h = dx[i] / 3;
        d += `C${f(p[i][0] + h)},${f(p[i][1] + m[i] * h)} ${f(p[i + 1][0] - h)},${f(p[i + 1][1] - m[i + 1] * h)} ${f(p[i + 1][0])},${f(p[i + 1][1])}`;
    }
    return d;
}

function precioEn(puntos, x, maxDist) {
    let mejor = null;
    for (const p of puntos) if (p[0] <= x) mejor = p;
    return mejor && x - mejor[0] <= maxDist ? mejor[1] : null;
}

function chip(clase, etiqueta, valor) {
    return `<span class="set-history-chip${clase}"><span class="set-history-chip-k">${escapeHTML(etiqueta)}</span>${escapeHTML(valor)}</span>`;
}

function chipCambio(etiqueta, desde, hasta) {
    if (!desde) return "";
    const pct = ((hasta - desde) / desde) * 100, r = Math.round(pct);
    return chip(r > 0 ? " up" : r < 0 ? " down" : " flat", etiqueta, `${r > 0 ? "+" : ""}${r}%`);
}

function grafica(title, d, t) {
    const serie = d.h?.s?.[`${title} Set`] || [];
    const crudos = serie.map((p, i) => [Date.parse(d.h.d[i]), p]);
    const puntos = crudos.filter(([, p]) => p != null);
    if (puntos.length < 2) return { html: `<div class="set-history-empty">${escapeHTML(t.historyEmpty)}</div>` };
    const id = `sh${++instancias}`;
    const u = t.priceUnit || "p";
    const ev = d.e[title] || {};
    const pa = Date.parse(ev.pa);
    const x0 = pa >= Date.parse(d.h.d[0]) && pa < puntos[0][0] ? pa : puntos[0][0], xd = puntos.at(-1)[0];
    const veX = ev.ve && !ev.v ? Date.parse(`${ev.ve}-01`) : NaN;
    const x1 = veX > xd ? Math.min(veX, xd + (xd - x0) * EXTRA) : xd;
    const ps = puntos.map(([, p]) => p), pmax = Math.max(...ps), pmin = Math.min(...ps);
    const paso = pasoBonito(pmax * 1.15 || 1, 4), y0 = 0, y1 = Math.ceil((pmax * 1.15 || 1) / paso) * paso;
    const fx = (x) => M.l + ((x - x0) / (x1 - x0)) * (W - M.l - M.r);
    const fy = (y) => H - M.b - ((y - y0) / (y1 - y0)) * (H - M.t - M.b);
    const anc = (x) => (x < M.l + 60 ? "start" : x > W - M.r - 60 ? "end" : "middle");
    const marcas = [["pa", t.eventPa], ["v", t.eventVault]]
        .filter(([k]) => ev[k] && Date.parse(ev[k]) >= x0 && Date.parse(ev[k]) <= x1)
        .map(([k, nombre]) => {
            const x = fx(Date.parse(ev[k]));
            return `<g class="set-history-ev ev-${k}"><line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${M.t - 6}" y2="${H - M.b}"/><text x="${x.toFixed(1)}" y="${M.t - 9}" text-anchor="${anc(x)}">${escapeHTML(nombre)} ${ev[k].slice(0, 7)}</text></g>`;
        }).join("");
    const enRango = (x) => Math.min(Math.max(x, x0), x1);
    const bandas = (d.e._unvaults?.[title] || [])
        .filter(([ini, fin]) => Date.parse(fin) >= x0 && Date.parse(ini) <= x1)
        .map(([ini, fin]) => {
            const a = fx(enRango(Date.parse(ini))), b = fx(enRango(Date.parse(fin)));
            return `<rect class="set-history-band" x="${a.toFixed(1)}" y="${M.t}" width="${Math.max(b - a, 1.5).toFixed(1)}" height="${H - M.t - M.b}"><title>${escapeHTML(`${t.unvaultLegend} ${ini} - ${fin}`)}</title></rect>`;
        }).join("");
    const estimado = ev.ve && !ev.v ? (() => {
        const x = fx(enRango(veX));
        return `<g class="set-history-ev ev-ve"><line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${M.t - 6}" y2="${H - M.b}"/><text x="${(x - 3).toFixed(1)}" y="${M.t - 9}" text-anchor="end">${escapeHTML(t.eventVaultEst)} ~${escapeHTML(ev.ve)}</text></g>`;
    })() : "";
    const varzia = (d.e._varzia?.n || []).includes(title) && Date.parse(d.e._varzia.fin) > Date.now() ? `<span class="set-history-tag">${escapeHTML(t.varziaTag)}</span>` : "";
    const leyenda = bandas || varzia ? `<div class="set-history-legend">${bandas ? `<span class="set-history-swatch"></span>${escapeHTML(t.unvaultLegend)}` : ""}${varzia}</div>` : "";
    const ejes = [];
    for (let v = 0; v <= y1 + paso / 2; v += paso) {
        const y = fy(v).toFixed(1);
        ejes.push(`<line class="set-history-grid${v ? "" : " base"}" x1="${M.l}" x2="${W - M.r}" y1="${y}" y2="${y}"/><text class="set-history-axis" x="${M.l - 6}" y="${(+y + 4).toFixed(1)}" text-anchor="end">${+v.toFixed(1)}</text>`);
    }
    const anios = [];
    for (let a = new Date(x0).getUTCFullYear() + 1; Date.UTC(a, 0, 1) <= x1; a++) {
        const x = fx(Date.UTC(a, 0, 1));
        if (x > M.l + 14 && x < W - M.r - 14) anios.push(`<line class="set-history-tick" x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${H - M.b}" y2="${H - M.b + 4}"/><text class="set-history-axis" x="${x.toFixed(1)}" y="${H - 6}" text-anchor="middle">${a}</text>`);
    }
    const ejeX = anios.length >= 2 ? anios.join("") : [[x0, "start"], [xd, "end"]]
        .map(([x, a]) => `<text class="set-history-axis" x="${fx(x).toFixed(1)}" y="${H - 6}" text-anchor="${a}">${new Date(x).toISOString().slice(0, 7)}</text>`).join("");
    const tramos = [];
    let tramo = [];
    for (const [x, p] of crudos) {
        if (p == null) { if (tramo.length) tramos.push(tramo); tramo = []; }
        else tramo.push([fx(x), fy(p)]);
    }
    if (tramo.length) tramos.push(tramo);
    const base = fy(0).toFixed(1);
    const area = tramos.filter((s) => s.length > 1).map((s) => `<path d="${curva(s)}L${s.at(-1)[0].toFixed(1)},${base}L${s[0][0].toFixed(1)},${base}Z"/>`).join("");
    const lineas = tramos.map((s) => s.length > 1 ? `<path class="set-history-line" pathLength="1" d="${curva(s)}"/>` : `<circle class="set-history-solo" cx="${s[0][0].toFixed(1)}" cy="${s[0][1].toFixed(1)}" r="2"/>`).join("");
    const extremo = (p, nombre, arriba) => {
        const x = fx(p[0]), y = fy(p[1]);
        return `<g class="set-history-extremo"><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.5"/><text x="${x.toFixed(1)}" y="${(arriba ? y - 6 : y + 13).toFixed(1)}" text-anchor="${anc(x)}">${escapeHTML(nombre)} ${p[1]} ${escapeHTML(u)}</text></g>`;
    };
    const pMax = puntos.find((p) => p[1] === pmax), pMin = puntos.findLast((p) => p[1] === pmin);
    const extremos = pmax > pmin ? extremo(pMax, t.historyMax, true) + (fy(pmin) < H - M.b - 14 ? extremo(pMin, t.historyMin, false) : "") : "";
    const ultimo = puntos.at(-1), ux = fx(ultimo[0]).toFixed(1), uy = fy(ultimo[1]).toFixed(1);
    const vX = Date.parse(ev.v);
    const pv = vX >= puntos[0][0] && vX <= xd ? precioEn(puntos, vX, 21 * DIA_MS) ?? puntos.find((p) => p[0] >= vX)?.[1] : null;
    const chips = `<div class="set-history-chips">${chip("", t.chipNow, `${ultimo[1]} ${u}`)}${pv != null ? chipCambio(t.chipSinceVault, pv, ultimo[1]) : ""}${chipCambio(t.chip4w, precioEn(puntos, xd - 28 * DIA_MS, 14 * DIA_MS), ultimo[1])}</div>`;
    const desc = (t.historyDesc || "").replace("{set}", title).replace("{min}", pmin).replace("{max}", pmax).replace("{now}", ultimo[1]);
    const html = `${chips}<div class="set-history-plot"><svg class="set-history-svg" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="${id}-t ${id}-d">
      <title id="${id}-t">${escapeHTML(t.historyTitle)}</title><desc id="${id}-d">${escapeHTML(desc)}</desc>
      <defs><linearGradient id="${id}-g" x1="0" y1="0" x2="0" y2="1"><stop class="set-history-stop" offset="0" stop-opacity="0.35"/><stop class="set-history-stop" offset="1" stop-opacity="0"/></linearGradient></defs>
      <g aria-hidden="true">${bandas}${ejes.join("")}${ejeX}${marcas}${estimado}
      <g class="set-history-area" fill="url(#${id}-g)">${area}</g>${lineas}${extremos}
      <circle class="set-history-halo" cx="${ux}" cy="${uy}" r="7"/><circle class="set-history-dot" cx="${ux}" cy="${uy}" r="3"/>
      <g class="set-history-cross" visibility="hidden"><line y1="${M.t}" y2="${H - M.b}"/><circle r="4"/></g></g>
    </svg><div class="set-history-tip" hidden></div></div>
    ${leyenda}<div class="set-history-foot">${escapeHTML(t.historySource)}</div>`;
    return { html, puntos: puntos.map(([x, p]) => [x, p, fx(x), fy(p)]), unidad: u };
}

function interaccion(cuerpo, g) {
    const svg = cuerpo.querySelector(".set-history-svg"), tip = cuerpo.querySelector(".set-history-tip");
    const cruz = svg?.querySelector(".set-history-cross");
    if (!svg || !tip || !cruz) return;
    const [linea, punto] = cruz.children;
    const fecha = new Intl.DateTimeFormat(state.currentLang, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
    const mostrar = (e) => {
        const r = svg.getBoundingClientRect();
        if (!r.width) return;
        const vx = ((e.clientX - r.left) / r.width) * W;
        let p = g.puntos[0];
        for (const q of g.puntos) if (Math.abs(q[2] - vx) < Math.abs(p[2] - vx)) p = q;
        linea.setAttribute("x1", p[2].toFixed(1));
        linea.setAttribute("x2", p[2].toFixed(1));
        punto.setAttribute("cx", p[2].toFixed(1));
        punto.setAttribute("cy", p[3].toFixed(1));
        cruz.setAttribute("visibility", "visible");
        tip.textContent = `${fecha.format(p[0])} · ${p[1]} ${g.unidad}`;
        tip.hidden = false;
        const px = (p[2] / W) * r.width, py = (p[3] / H) * r.height;
        tip.style.left = `${px}px`;
        tip.style.top = `${py}px`;
        tip.dataset.lado = px < tip.offsetWidth / 2 + 4 ? "izq" : px > r.width - tip.offsetWidth / 2 - 4 ? "der" : "";
    };
    let espera = 0;
    const ocultar = () => { clearTimeout(espera); cruz.setAttribute("visibility", "hidden"); tip.hidden = true; };
    svg.addEventListener("pointermove", mostrar);
    svg.addEventListener("pointerdown", (e) => { clearTimeout(espera); mostrar(e); });
    svg.addEventListener("pointerup", (e) => { if (e.pointerType !== "mouse") espera = setTimeout(ocultar, 1500); });
    svg.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") ocultar(); });
    svg.addEventListener("pointercancel", ocultar);
}

function separarEtiquetas(cuerpo) {
    const ve = cuerpo.querySelector(".set-history-ev.ev-ve text");
    if (!ve?.getBBox) return;
    const otras = [...cuerpo.querySelectorAll(".set-history-ev:not(.ev-ve) text")].map((x) => x.getBBox());
    const choca = () => {
        const b = ve.getBBox();
        return otras.some((o) => b.x < o.x + o.width + 4 && o.x < b.x + b.width + 4);
    };
    if (!choca()) return;
    const txt = ve.textContent;
    ve.textContent = txt.slice(txt.lastIndexOf("~"));
    if (choca()) ve.setAttribute("y", String(M.t + 10));
}

export function setHistoryBlock(title) {
    const t = TEXTS[state.currentLang]?.setTab || {};
    const caja = document.createElement("div");
    caja.className = "set-history";
    caja.innerHTML = `<button type="button" class="set-history-btn" aria-expanded="false">${escapeHTML(t.historyBtn)}</button><div class="set-history-body" hidden></div>`;
    const boton = caja.firstElementChild, cuerpo = caja.lastElementChild;
    boton.addEventListener("click", async () => {
        const abrir = cuerpo.hidden;
        cuerpo.hidden = !abrir;
        boton.setAttribute("aria-expanded", String(abrir));
        if (!abrir || cuerpo.dataset.listo) return;
        cuerpo.innerHTML = `<div class="set-history-empty">${escapeHTML(t.historyLoading)}</div>`;
        try {
            const g = grafica(title, await datos(), t);
            cuerpo.innerHTML = g.html;
            if (g.puntos) { interaccion(cuerpo, g); try { separarEtiquetas(cuerpo); } catch {} }
            cuerpo.dataset.listo = "1";
        } catch {
            cuerpo.innerHTML = `<div class="set-history-empty">${escapeHTML(t.historyEmpty)}</div>`;
        }
    });
    return caja;
}

export async function marcarVarzia(title, raiz) {
    const v = (await eventos())?._varzia;
    if (!v?.n?.includes(title) || !(Date.parse(v.fin) > Date.now())) return;
    const t = TEXTS[state.currentLang]?.setTab || {};
    raiz.querySelectorAll(".status-badge.vaulted").forEach((b) => {
        b.classList.replace("vaulted", "varzia");
        b.textContent = t.varziaTag || "VARZIA";
    });
}
