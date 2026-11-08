import { state } from "../../state.js";
import { escapeHTML } from "../../utils/escape_html.js";
import { normalizeStatName } from "../../utils/rivens/riven_naming.js";
import { getRivenStatRange } from "../../utils/rivens/riven_logic.js";
import { tipoDeArma, esFusionado } from "../../utils/rivens/riven_cycling.js";
import { textoDelStat } from "../../utils/rivens/riven_stat_display.js";
import { posicionTirada, calidadStatEnArma } from "../../utils/rivens/riven_tasacion_visual.js";
import { statsSinDatoPropio } from "../../services/rivens/riven_weights.service.js";
import { nivelesDelArma, etiquetaDeCalidad, textoNivelTirada } from "./ui_riven_appraisal.js";

const TONO_CALIDAD = { top: "gradoS", medio: "cian", flojo: "gris", inofensiva: "verde", media: "oro", ruinosa: "gradoF" };
const TONO_NIVEL = { alta: "verde", media: "oro", baja: "gradoF", fuera: "gradoF", nula: "apagado" };
const pct = (x) => `${(x * 100).toFixed(1)}%`;

export function filasTasacion(riven, meta, isEs) {
    const stats = riven?.stats || [];
    const tipo = meta?.t || state.weaponMap?.[riven?.weaponName]?.t;
    const typeIdx = tipoDeArma(tipo);
    const { niveles, pesos, generico } = nivelesDelArma(meta, riven?.weaponName, tipo, typeIdx);
    const sinDato = { pos: statsSinDatoPropio(riven?.weaponName, "pos"), neg: statsSinDatoPropio(riven?.weaponName, "neg") };
    const posCount = stats.filter((x) => x.isPositive).length;
    const hasNeg = stats.some((x) => !x.isPositive);
    return stats.map((s) => {
        const isNeg = !s.isPositive;
        const nombre = normalizeStatName(s.name, tipo);
        const fusionado = esFusionado(nombre, typeIdx);
        const rango = tipo ? getRivenStatRange({ t: tipo }, nombre, isNeg, posCount, hasNeg) : null;
        const a = Math.abs(rango?.min), b = Math.abs(rango?.max);
        const pos = rango ? posicionTirada({ valor: Math.abs(s.value), min: Math.min(a, b), max: Math.max(a, b), isNeg, fusionado }) : null;
        const calidad = calidadStatEnArma({ nombre, isPositive: !isNeg, typeIdx, niveles, pesos, sinDato: isNeg ? sinDato.neg : sinDato.pos, generico });
        const largo = textoNivelTirada(pos, isNeg, calidad.nivel, fusionado, isEs);
        const atenuado = isNeg && calidad.nivel === "inofensiva" && pos !== null && !pos.fuera;
        const corto = !pos ? "—" : pos.fuera ? (isEs ? "fuera" : "out") : atenuado ? (isEs ? "da igual" : "fine") : `${fusionado ? "~" : ""}${Math.round(pos.bondad * 100)}%`;
        return {
            texto: textoDelStat(s, typeIdx),
            positivo: !isNeg,
            nivelCalidad: calidad.nivel,
            calidad: `${calidad.estimada && calidad.nivel !== "sindato" ? "~" : ""}${etiquetaDeCalidad(calidad.nivel, isEs)}`,
            pos,
            claseNivel: pos?.fuera ? "fuera" : (pos?.nivel || "nula"),
            nivel: pos?.fuera ? (isEs ? "FUERA DE RANGO" : "OUT OF RANGE") : largo,
            nivelLargo: largo,
            corto,
            atenuado,
        };
    });
}

export function filaStatHtml(f) {
    const medidor = f.pos
        ? `<span class="hud-medidor" style="--pos:${pct(f.pos.bondad)};--c1:${pct(f.pos.cortes[0])};--c2:${pct(f.pos.cortes[1])}"><span class="hud-relleno"></span><span class="hud-corte"></span><span class="hud-corte hud-corte-2"></span><span class="hud-marca"></span></span>`
        : '<span class="hud-medidor" style="visibility:hidden"></span>';
    return `<div class="hud-fila ${f.positivo ? "pos" : "neg"} tas-cal-${f.nivelCalidad} tas-nivel-${f.claseNivel}${f.atenuado ? " tas-atenuado" : ""}">`
        + `<div class="hud-fila-cab"><span class="hud-texto" title="${escapeHTML(f.texto)}">${escapeHTML(f.texto)}</span><span class="hud-calidad">${escapeHTML(f.calidad)}</span></div>`
        + `<div class="hud-fila-pie">${medidor}<span class="hud-nivel" title="${escapeHTML(f.nivelLargo)}">${escapeHTML(f.nivel)}</span></div>`
        + `</div>`;
}

export function statOverlay(f) {
    return {
        texto: f.texto,
        positivo: f.positivo,
        ...(f.nivelCalidad === "sindato" ? {} : { calidad: { texto: f.calidad, tono: TONO_CALIDAD[f.nivelCalidad] || "gris" } }),
        tirada: {
            texto: f.corto,
            tono: f.atenuado ? "gris" : (TONO_NIVEL[f.claseNivel] || "gris"),
            medidor: f.pos ? { pos: Math.round(f.pos.bondad * 100), nivel: f.claseNivel, atenuado: f.atenuado } : { pos: 0, nivel: "nula" },
        },
    };
}
