import { RIVEN_STATS } from "../../config.js";
import { escapeHTML } from "../../utils/escape_html.js";
import {
    claveStat, consejoDeCiclo, probPorCiclo, poolDeStats, kuvaEsperada, costeCiclo, tipoDeArma,
    recetasDelTipo, combinacionesDe,
} from "../../utils/rivens/riven_cycling.js";

// Mismas negativas "NEG OK" que marca el HUD del escáner junto a cada stat: si el consejo usara
// otra lista, la carta diría "NEG OK" y el objetivo de ciclado no la aceptaría.
export const NEG_INOFENSIVOS = ["Zoom", "Recoil", "Ammo Maximum", "Status Duration", "Magazine Capacity",
    "Finisher Damage", "Impact", "Puncture"];

// Sin el dato de ciclos se cuenta como riven ya ciclado: la mayoría de los que se ciclan pasan
// del décimo, y ahí el precio ya es fijo.
const CICLOS_SI_NO_SE_SABE = 9;

const tx = (isEs, es, en) => (isEs ? es : en);

function nombreStat(clave, typeIdx, isEs) {
    const e = RIVEN_STATS.find((s) => claveStat(s.name_en, typeIdx) === clave);
    return e ? (isEs ? e.name_es : e.name_en) : clave;
}

function lista(claves, typeIdx, isEs) {
    return claves.map((c) => nombreStat(c, typeIdx, isEs)).join(", ");
}

export function textoKuva(kuva, isEs) {
    if (!Number.isFinite(kuva)) return tx(isEs, "imposible", "impossible");
    return kuva >= 10000 ? `~${Math.round(kuva / 1000)}k` : `~${Math.round(kuva).toLocaleString(isEs ? "es-ES" : "en-US", { useGrouping: "always" })}`;
}

export function textoProb(p, isEs) {
    if (!(p > 0)) return tx(isEs, "nunca", "never");
    return tx(isEs, `1 de cada ${Math.max(1, Math.round(1 / p))}`, `1 in ${Math.max(1, Math.round(1 / p))}`);
}

function textoObjetivo(obj, typeIdx, isEs) {
    const neg = obj.negOk.length ? lista(obj.negOk, typeIdx, isEs) : tx(isEs, "ninguno", "none");
    return tx(isEs,
        `Objetivo: ${obj.k} de ${lista(obj.buscados, typeIdx, isEs)} en positivo y, si sale negativo, uno de ${neg}.`,
        `Goal: ${obj.k} of ${lista(obj.buscados, typeIdx, isEs)} as positives and, if a negative rolls, one of ${neg}.`);
}

function combinarHtml(recetas, typeIdx, isEs, destacar = () => false) {
    if (!recetas.length) return "";
    const filas = [...recetas].sort((a, b) => destacar(b) - destacar(a)).map((r) => `
        <div class="riven-ciclo-receta${destacar(r) ? " destacada" : ""}">
          ${escapeHTML(nombreStat(r.a, typeIdx, isEs))} + ${escapeHTML(nombreStat(r.b, typeIdx, isEs))}
          → <strong>${escapeHTML(r.resultado[isEs ? 0 : 1])}</strong>
        </div>`).join("");
    const aviso = tx(isEs,
        "Llega con Glacial Defiance. Recetas de guías de jugadores, no de DE: pueden cambiar. Funde dos stats en uno nuevo que queda bloqueado.",
        "Arrives with Glacial Defiance. Recipes from player guides, not from DE: they may change. Fuses two stats into a new one that stays locked.");
    return `
      <div class="riven-ciclo-combinar">
        <div class="riven-ciclo-sub" data-tooltip="${escapeHTML(aviso)}">${tx(isEs, "COMBINAR STATS · PROVISIONAL", "SPLICE STATS · PROVISIONAL")} ℹ</div>
        ${filas}
      </div>`;
}

/**
 * Bloque del HUD del escáner para la pantalla de ciclar: qué bloquear y cuánta kuva cuesta de media
 * llegar al objetivo con y sin bloqueo.
 * @param stats [{ name, isPositive, calidad? }] con la calidad de la tirada (0-100) si se conoce.
 */
export function consejoCicloHtml({ stats, rolls, tipo, buscados, negOk, isEs, rotulo = "" }) {
    const typeIdx = tipoDeArma(tipo);
    const ciclosHechos = Number.isFinite(rolls) ? rolls : CICLOS_SI_NO_SE_SABE;
    const c = consejoDeCiclo({ stats, typeIdx, buscados, negOk, ciclosHechos });
    if (!c) return "";

    const tipObjetivo = `${textoObjetivo(c.objetivo, typeIdx, isEs)} ${tx(isEs,
        `Kuva contando los ${ciclosHechos} ciclos que ya lleva${Number.isFinite(rolls) ? "" : " (supuestos: no se leyó el número)"}; bloqueando, cada ciclo cuesta el doble, hasta 7.000.`,
        `Kuva counting the ${ciclosHechos} cycles it already has${Number.isFinite(rolls) ? "" : " (assumed: the count was not read)"}; with a lock each cycle costs double, up to 7,000.`)}`;

    let cuerpo;
    if (c.cumple) {
        cuerpo = `<div class="riven-ciclo-veredicto ok">${tx(isEs,
            "Ya cumple el objetivo: cicla solo si buscas mejores valores.",
            "It already meets the goal: cycle only if you want better values.")}</div>`;
    } else {
        const fila = (etiqueta, o, mejor, bloqueado) => `<div class="riven-ciclo-fila${mejor ? " mejor" : ""}">
            <span>${etiqueta} <small>(${costeCiclo(ciclosHechos, bloqueado).toLocaleString(isEs ? "es-ES" : "en-US", { useGrouping: "always" })}/${tx(isEs, "ciclo", "cycle")})</small></span>
            <strong>${textoProb(o.p, isEs)} · ${textoKuva(o.kuva, isEs)} kuva</strong></div>`;
        const b = c.bloqueo;
        const nombreBloqueo = b ? `${b.negativo ? "-" : "+"}${nombreStat(b.stat, typeIdx, isEs)}` : "";
        const veredicto = !b
            ? tx(isEs, "Nada que bloquear: ningún stat de este riven entra en el objetivo.",
                "Nothing to lock: no stat on this riven is part of the goal.")
            : c.conviene
                ? tx(isEs, `Bloquea ${nombreBloqueo}: ahorras ${textoKuva(c.sinBloqueo.kuva - b.kuva, isEs)} kuva de media.`,
                    `Lock ${nombreBloqueo}: saves ${textoKuva(c.sinBloqueo.kuva - b.kuva, isEs)} kuva on average.`)
                : tx(isEs, "No compensa bloquear: el doble de kuva por ciclo no se recupera.",
                    "Locking does not pay off: double kuva per cycle is not made back.");
        cuerpo = fila(tx(isEs, "Sin bloquear", "No lock"), c.sinBloqueo, !c.conviene, false)
            + (b ? fila(tx(isEs, `Bloqueando ${escapeHTML(nombreBloqueo)}`, `Locking ${escapeHTML(nombreBloqueo)}`), b, c.conviene, true) : "")
            + `<div class="riven-ciclo-veredicto${c.conviene ? " ok" : ""}">${escapeHTML(veredicto)}</div>`;
    }

    return `
      <div class="riven-ciclo">
        <div class="riven-ciclo-titulo" data-tooltip="${escapeHTML(tipObjetivo)}">${tx(isEs, "CICLAR", "CYCLING")}${rotulo ? ` · ${escapeHTML(rotulo)}` : ""} ℹ</div>
        ${cuerpo}
        ${combinarHtml(combinacionesDe(stats, typeIdx), typeIdx, isEs)}
      </div>`;
}

const FILAS_CONFIG = [
    [{ pos: 2, neg: false }, ["2 positivos", "2 positives"]],
    [{ pos: 2, neg: true }, ["2 + negativo", "2 + negative"]],
    [{ pos: 3, neg: false }, ["3 positivos", "3 positives"]],
    [{ pos: 3, neg: true }, ["3 + negativo", "3 + negative"]],
];

/**
 * Calculadora de la ficha del arma: sin un riven concreto, lo que cuesta llegar al objetivo según
 * cuántos stats tenga el tuyo, sin bloquear o bloqueando un stat buscado o el negativo.
 */
export function tablaCicloHtml({ tipo, buscados, negOk, isEs }) {
    const typeIdx = tipoDeArma(tipo);
    const pool = poolDeStats(typeIdx);
    const busc = [...new Set((buscados || []).map((b) => claveStat(b, typeIdx)))].filter((b) => b && pool.includes(b));
    if (busc.length === 0) return "";
    const ok = [...new Set((negOk || []).map((b) => claveStat(b, typeIdx)))]
        .filter((b) => b && pool.includes(b) && !busc.includes(b));
    const k = Math.min(2, busc.length);
    const base = { pool, buscados: busc, negOk: ok, k, typeIdx };
    const ciclos = CICLOS_SI_NO_SE_SABE;

    const pSin = probPorCiclo(base);
    const kuvaSin = kuvaEsperada(pSin, ciclos);
    const celda = (p, bloqueado) => {
        const kuva = kuvaEsperada(p, ciclos, bloqueado);
        return { p, kuva, html: `${textoProb(p, isEs)}<br><small>${textoKuva(kuva, isEs)} kuva</small>` };
    };
    const filas = FILAS_CONFIG.map(([config, nombre]) => {
        const buscado = celda(probPorCiclo({ ...base, config, bloqueado: { stat: busc[0], negativo: false } }), true);
        const negativo = config.neg && ok.length
            ? celda(probPorCiclo({ ...base, config, bloqueado: { stat: ok[0], negativo: true } }), true)
            : null;
        const td = (o) => (o ? `<td class="${o.kuva < kuvaSin ? "mejor" : ""}">${o.html}</td>` : "<td>—</td>");
        return `<tr><th>${nombre[isEs ? 0 : 1]}</th>${td(buscado)}${td(negativo)}</tr>`;
    }).join("");

    const tip = `${textoObjetivo({ buscados: busc, negOk: ok, k }, typeIdx, isEs)} ${tx(isEs,
        "Con el ciclo a 3.500 kuva, que es lo que cuesta a partir del décimo; bloqueando, 7.000. En verde, lo que sale más barato que ciclar sin bloquear. El stat bloqueado conserva su valor.",
        "With cycles at 3,500 kuva, their price from the tenth on; with a lock, 7,000. In green, whatever comes out cheaper than cycling without a lock. The locked stat keeps its value.")}`;
    const buscanSplice = (r) => busc.includes(r.a) && busc.includes(r.b);
    // Un buscado con otro buscado, o con un negativo inofensivo que puede acompañarlo en la carta.
    const utiles = new Set([...busc, ...ok]);
    const recetas = recetasDelTipo(typeIdx).filter((r) => (busc.includes(r.a) || busc.includes(r.b))
        && utiles.has(r.a) && utiles.has(r.b));

    return `
      <div class="riven-ciclo ficha">
        <div class="riven-ciclo-titulo" data-tooltip="${escapeHTML(tip)}">${tx(isEs, "¿BLOQUEAR UN STAT AL CICLAR?", "LOCK A STAT WHEN CYCLING?")} ℹ</div>
        <div class="riven-ciclo-fila"><span>${tx(isEs, "Sin bloquear", "No lock")}</span><strong>${textoProb(pSin, isEs)} · ${textoKuva(kuvaSin, isEs)} kuva</strong></div>
        <table class="riven-ciclo-tabla">
          <thead><tr><th>${tx(isEs, "Tu riven", "Your riven")}</th><th>${tx(isEs, "Bloqueando uno buscado", "Locking a wanted one")}</th><th>${tx(isEs, "Bloqueando el negativo", "Locking the negative")}</th></tr></thead>
          <tbody>${filas}</tbody>
        </table>
        ${combinarHtml(recetas, typeIdx, isEs, buscanSplice)}
      </div>`;
}
