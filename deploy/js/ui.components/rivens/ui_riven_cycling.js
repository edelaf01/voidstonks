import { RIVEN_STATS } from "../../config.js";
import { escapeHTML } from "../../utils/escape_html.js";
import { opcionesDeCartas } from "../../utils/rivens/riven_objetivo_fusion.js";
import {
    claveStat, consejoDeCiclo, probPorCiclo, poolDeStats, kuvaEsperada, costeCiclo, tipoDeArma,
    recetasDelTipo, combinacionesDe, evaluarCombinaciones, planesDeFusion, UMBRAL_COMBINAR,
    RECETAS_COMBINAR, posiblesFusiones, planDeReceta, esFusionado
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

/** "~19 ciclos" y no "1 de cada 19": trae la cuenta hecha. */
export function textoCiclos(p, isEs) {
    if (!(p > 0)) return tx(isEs, "nunca sale", "never happens");
    const n = Math.max(1, Math.round(1 / p));
    return tx(isEs, `~${n} ${n === 1 ? "ciclo" : "ciclos"}`, `~${n} ${n === 1 ? "cycle" : "cycles"}`);
}

function textoObjetivo(obj, typeIdx, isEs) {
    const neg = obj.negOk.length ? lista(obj.negOk, typeIdx, isEs) : tx(isEs, "ninguno", "none");
    return tx(isEs,
        `Objetivo: ${obj.k} de ${lista(obj.buscados, typeIdx, isEs)} en positivo y, si sale negativo, uno de ${neg}.`,
        `Goal: ${obj.k} of ${lista(obj.buscados, typeIdx, isEs)} as positives and, if a negative rolls, one of ${neg}.`);
}

function envolverCombinar(filas, isEs, intro, extraAviso = "") {
    if (!filas) return "";
    let aviso = tx(isEs,
        "Recetas oficiales de DE (Update 44.1). Un Riven Splicer funde dos stats en uno nuevo que se queda al ciclar, y entra otro stat al azar (negativo si alguno de los dos lo era).",
        "Official DE recipes (Update 44.1). A Riven Splicer fuses two stats into a new one that stays when cycling, and another random stat comes in (negative if either source was).");
    if (extraAviso) aviso += " " + extraAviso;
    return `
      <div class="riven-ciclo-combinar">
        <div class="riven-ciclo-sub" data-tooltip="${escapeHTML(aviso)}">${tx(isEs, "COMBINAR STATS", "SPLICE STATS")} ℹ</div>
        <div class="riven-ciclo-intro">${escapeHTML(intro)}</div>
        ${filas}
      </div>`;
}

function combinarHtml(recetas, typeIdx, isEs, intro, destacar = () => false) {
    if (!recetas.length) return "";
    const filas = [...recetas].sort((a, b) => destacar(b) - destacar(a)).map((r) => `
        <div class="riven-ciclo-receta${destacar(r) ? " destacada" : ""}">
          ${escapeHTML(nombreStat(r.a, typeIdx, isEs))} + ${escapeHTML(nombreStat(r.b, typeIdx, isEs))}
          → <strong>${escapeHTML(nombreStat(r.resultado, typeIdx, isEs))}</strong>
        </div>`).join("");
    return envolverCombinar(filas, isEs, intro);
}

function combinarEvaluadoHtml(evaluaciones, typeIdx, isEs) {
    if (!evaluaciones.length) return "";
    const filas = evaluaciones.map((e) => {
        let veredicto;
        if (e.delta >= UMBRAL_COMBINAR) veredicto = tx(isEs, "mejora la tirada", "improves the roll");
        else if (e.delta <= -UMBRAL_COMBINAR) veredicto = tx(isEs, "empeora la tirada", "worsens the roll");
        else veredicto = tx(isEs, "la deja parecida", "about the same");
        let riesgo;
        if (e.quitaNegativo) {
            const pct = Math.round(e.probPeor * 100);
            const n = nombreStat(e.quitaNegativo, typeIdx, isEs);
            riesgo = tx(isEs, `quita el -${n}; ${pct}% de sacar un negativo peor`, `removes the -${n}; ${pct}% chance of a worse negative`);
        } else {
            const pct = Math.round(e.probBuscado * 100);
            riesgo = tx(isEs, `${pct}% de que el stat nuevo sea uno buscado`, `${pct}% chance the new stat is a wanted one`);
        }
        const a = escapeHTML(nombreStat(e.receta.a, typeIdx, isEs));
        const b = escapeHTML(nombreStat(e.receta.b, typeIdx, isEs));
        const r = escapeHTML(nombreStat(e.receta.resultado, typeIdx, isEs));
        return `<div class="riven-ciclo-receta${e.delta >= UMBRAL_COMBINAR ? " destacada" : ""}">${a} + ${b} → <strong>${r}</strong> · ${veredicto}<small>${escapeHTML(riesgo)}</small></div>`;
    }).join("");
    const intro = tx(isEs, "Si combinas, de media:", "If you splice, on average:");
    const extraAviso = tx(isEs, "Los pesos son los de este arma; el stat fundido vale la media de los dos de origen hasta que haya datos de mercado.", "Weights are this weapon's; the spliced stat is worth the mean of its two sources until there is market data.");
    return envolverCombinar(filas, isEs, intro, extraAviso);
}

function planesHtml(planes, typeIdx, isEs) {
    if (!planes.length) return "";
    const n = (c) => escapeHTML(nombreStat(c, typeIdx, isEs));
    const signo = (negativo) => (negativo ? "-" : "+");
    const cuanto = (o) => `${textoCiclos(o.p, isEs)} · ${textoKuva(o.kuva, isEs)} kuva`;
    const filas = planes.slice(0, 2).map(({ receta: r, fuentes: f, cumple, despues: d, total, sinCombinar, compensa }) => {
        const lineas = [f
            ? tx(isEs, `Bloquea ${signo(f.negativo)}${n(f.bloquea)} hasta que salga ${n(f.falta)}: ${cuanto(f)}`,
                `Lock ${signo(f.negativo)}${n(f.bloquea)} until ${n(f.falta)} rolls: ${cuanto(f)}`)
            : tx(isEs, `Ya tienes ${n(r.a)} y ${n(r.b)}: combínalos.`, `You already have ${n(r.a)} and ${n(r.b)}: splice them.`)];
        if (cumple) lineas.push(tx(isEs, "Al combinar ya cumple el objetivo.", "Once spliced it meets the goal."));
        else if (d.bloquea) {
            lineas.push(tx(isEs, `Luego ${n(r.resultado)} se queda; bloquea además ${signo(d.negativo)}${n(d.bloquea)}: ${cuanto(d)}`,
                `Then ${n(r.resultado)} stays; also lock ${signo(d.negativo)}${n(d.bloquea)}: ${cuanto(d)}`));
        } else {
            lineas.push(tx(isEs, `Luego ${n(r.resultado)} se queda al ciclar: ${cuanto(d)}; si sale un stat buscado, bloquéalo.`,
                `Then ${n(r.resultado)} stays when cycling: ${cuanto(d)}; lock a wanted stat when one rolls.`));
        }
        const veredicto = compensa
            ? tx(isEs, `${textoKuva(total, isEs)} kuva, menos que sin combinar (${textoKuva(sinCombinar, isEs)})`,
                `${textoKuva(total, isEs)} kuva, less than without splicing (${textoKuva(sinCombinar, isEs)})`)
            : tx(isEs, `${textoKuva(total, isEs)} kuva; sin combinar, ${textoKuva(sinCombinar, isEs)}`,
                `${textoKuva(total, isEs)} kuva; without splicing, ${textoKuva(sinCombinar, isEs)}`);
        return `<div class="riven-ciclo-receta${compensa ? " destacada" : ""}">${n(r.a)} + ${n(r.b)} → <strong>${n(r.resultado)}</strong> · ${veredicto}${lineas.map((l) => `<small>${l}</small>`).join("")}</div>`;
    }).join("");
    const aviso = tx(isEs,
        "Solo combinados que valen al menos como el stat buscado más flojo de esta arma. El combinado se queda al ciclar sin doblar la kuva, y aun así puedes bloquear otro stat. El stat al azar que entra al combinar no se cuenta.",
        "Only spliced stats worth at least as much as this weapon's weakest wanted stat. The spliced stat stays when cycling without doubling kuva, and you can still lock another stat. The random stat that comes in when splicing is not counted.");
    return `
      <div class="riven-ciclo-combinar">
        <div class="riven-ciclo-sub" data-tooltip="${escapeHTML(aviso)}">${tx(isEs, "APUNTAR A UN STAT COMBINADO", "AIM FOR A SPLICED STAT")} ℹ</div>
        ${filas}
      </div>`;
}

function combinarDelRoll({ stats, typeIdx, pesos, buscados, negOk, isEs, ciclosHechos }) {
    const evaluaciones = evaluarCombinaciones({ stats, typeIdx, pesos, buscados, negOk });
    const planes = planesHtml(planesDeFusion({ stats, typeIdx, pesos, buscados, negOk, ciclosHechos }), typeIdx, isEs);
    if (evaluaciones.length) return combinarEvaluadoHtml(evaluaciones, typeIdx, isEs) + planes;
    return combinarHtml(combinacionesDe(stats, typeIdx), typeIdx, isEs, tx(isEs, "Este riven puede fundir:", "This riven can fuse:")) + planes;
}

function pasoDelObjetivo(plan, receta, n, signo, isEs) {
    if (plan.estado === "fusionado") {
        return [plan.fusionado === receta.resultado
            ? { texto: tx(isEs, "conseguido", "done"), tono: "verde" }
            : { texto: tx(isEs, `ya tiene ${n(plan.fusionado)}`, `already has ${n(plan.fusionado)}`), tono: "naranja" }];
    }
    const paso = plan.estado === "falta"
        ? tx(isEs, `Bloquea ${signo(plan.negativo)}${n(plan.bloquea)} hasta ${n(plan.falta)}`, `Lock ${signo(plan.negativo)}${n(plan.bloquea)} until ${n(plan.falta)}`)
        : tx(isEs, `Cicla hasta ${n(receta.a)} + ${n(receta.b)}`, `Cycle until ${n(receta.a)} + ${n(receta.b)}`);
    return [{ texto: paso, tono: "blanco" }, { texto: textoCiclos(plan.p, isEs), tono: "gris" }, { texto: `${textoKuva(plan.kuva, isEs)} kuva`, tono: "gris" }];
}

export function combinarOverlay({ stats, rolls, tipo, buscados, negOk, pesos = null, isEs, objetivo = null }) {
    const typeIdx = tipoDeArma(tipo);
    const n = (c) => nombreStat(c, typeIdx, isEs);
    const signo = (negativo) => (negativo ? "-" : "+");
    const ciclosHechos = Number.isFinite(rolls) ? rolls : CICLOS_SI_NO_SE_SABE;
    const delTipo = recetasDelTipo(typeIdx);
    const receta = delTipo.includes(RECETAS_COMBINAR[objetivo]) ? RECETAS_COMBINAR[objetivo] : null;
    const planes = planesDeFusion({ stats, typeIdx, pesos, buscados, negOk, ciclosHechos });
    const evaluadas = evaluarCombinaciones({ stats, typeIdx, pesos, buscados, negOk });
    const directos = planes.filter((p) => !p.fuentes);
    const texto = (r) => `${n(r.resultado)} = ${n(r.a)} + ${n(r.b)}`;
    const listas = combinacionesDe(stats, typeIdx).map((r) => {
        const plan = directos.find((p) => p.receta === r);
        const delta = evaluadas.find((e) => e.receta === r)?.delta;
        let veredicto = null;
        if (r === receta) veredicto = { texto: tx(isEs, "tu objetivo", "your goal"), tono: "verde" };
        else if (plan?.cumple) veredicto = { texto: tx(isEs, "cumple la meta", "meets the goal"), tono: "verde" };
        else if (delta >= UMBRAL_COMBINAR) veredicto = { texto: tx(isEs, "mejora", "better"), tono: "verde" };
        else if (delta <= -UMBRAL_COMBINAR) veredicto = { texto: tx(isEs, "empeora", "worse"), tono: "naranja" };
        else if (plan?.compensa) veredicto = { texto: tx(isEs, "ahorra kuva", "saves kuva"), tono: "verde" };
        return { indice: RECETAS_COMBINAR.indexOf(r), texto: texto(r), veredicto };
    });
    const alcance = new Map(posiblesFusiones(stats, typeIdx).map((x) => [x.indice, x.faltan]));
    const recomendada = planes.find((p) => p.fuentes)?.receta;
    const opciones = delTipo.map((r) => {
        const indice = RECETAS_COMBINAR.indexOf(r);
        const faltan = alcance.get(indice);
        const estado = !faltan ? "otra" : faltan.length ? "falta" : "lista";
        return { indice, nombre: n(r.resultado), texto: texto(r), estado, falta: faltan?.length ? n(faltan[0]) : null, recomendada: r === recomendada };
    });
    const plan = receta && !listas.some((l) => l.indice === objetivo) ? planDeReceta({ stats, typeIdx, receta, ciclosHechos }) : null;
    const mejor = opciones.find((o) => o.recomendada);
    const fusionado = stats.find((s) => esFusionado(s.name, typeIdx));
    const aUnStat = [...new Set(opciones.filter((o) => o.estado === "falta").map((o) => o.nombre))].join(", ");
    return {
        rotulo: tx(isEs, "PUEDES COMBINAR", "YOU CAN SPLICE"),
        rotuloElige: tx(isEs, "Toca un combinado para buscarlo", "Tap a splice to aim for it"),
        titulo: receta ? tx(isEs, `Buscas: ${n(receta.resultado)}`, `Aiming for: ${n(receta.resultado)}`) : null,
        objetivo: receta ? objetivo : null,
        listas, opciones,
        paso: plan ? pasoDelObjetivo(plan, receta, n, signo, isEs) : null,
        cerca: fusionado ? [{ texto: tx(isEs, `Ya tiene ${n(claveStat(fusionado.name, typeIdx))}`, `Already has ${n(claveStat(fusionado.name, typeIdx))}`), tono: "gris" }]
            : mejor ? [{ texto: `★ ${mejor.texto}`, tono: "blanco" }, { texto: tx(isEs, `falta ${mejor.falta}`, `needs ${mejor.falta}`), tono: "gris" }]
            : aUnStat ? [{ texto: tx(isEs, `Nada listo · a un stat: ${aUnStat}`, `Nothing ready · one stat away: ${aUnStat}`), tono: "gris" }]
            : [{ texto: tx(isEs, "Nada que combinar", "Nothing to splice"), tono: "gris" }],
    };
}

const TONO_WEB = { verde: "ok", naranja: "mal", gris: "tenue" };
const claseTono = (tono) => (TONO_WEB[tono] ? ` class="${TONO_WEB[tono]}"` : "");

const filaPasoHtml = (fila) => {
    const resto = fila.slice(1).map((c) => c.texto).join(" · ");
    return `<div class="riven-combinar-paso"><span${claseTono(fila[0].tono)}>${escapeHTML(fila[0].texto)}</span>${resto ? `<strong>${escapeHTML(resto)}</strong>` : ""}</div>`;
};

export function combinarCartaHtml(combinar) {
    if (!combinar) return "";
    const listas = combinar.listas.map((l) => `<div class="riven-combinar-lista"><span>${escapeHTML(l.texto)}</span>${l.veredicto
        ? `<strong${claseTono(l.veredicto.tono)}>${escapeHTML(l.veredicto.texto)}</strong>` : ""}</div>`).join("");
    const paso = combinar.paso ? filaPasoHtml(combinar.paso) : "";
    const cerca = !listas && !paso && combinar.cerca ? filaPasoHtml(combinar.cerca) : "";
    return listas || paso || cerca ? `<div class="riven-combinar-carta">${listas}${paso}${cerca}</div>` : "";
}

export function objetivoFusionHtml(combinados, isEs) {
    const cartas = (Array.isArray(combinados) ? combinados : [combinados]).filter((c) => c?.opciones?.length);
    if (!cartas.length) return "";
    const opciones = opcionesDeCartas(cartas);
    const grupos = [
        ["lista", tx(isEs, "YA PUEDES COMBINAR", "READY TO SPLICE")],
        ["falta", tx(isEs, "TE FALTA UN STAT", "ONE STAT AWAY")],
        ["otra", tx(isEs, "RESTO", "OTHERS")],
    ];
    const opcion = (o) => {
        const extra = [o.recomendada ? tx(isEs, "recomendado", "recommended") : "", o.falta ? tx(isEs, `falta ${o.falta}`, `needs ${o.falta}`) : ""].filter(Boolean).join(", ");
        return `<option class="${o.estado}" value="${o.indice}"${o.activo ? " selected" : ""}>${o.estado === "lista" ? "✓ " : ""}${escapeHTML(o.texto)}${extra ? ` · ${escapeHTML(extra)}` : ""}</option>`;
    };
    const html = grupos.map(([estado, rotulo]) => {
        const del = opciones.filter((o) => o.estado === estado);
        return del.length ? `<optgroup label="${rotulo}">${del.map(opcion).join("")}</optgroup>` : "";
    }).join("");
    return `
      <div class="riven-ciclo riven-ciclo-objetivo">
        <div class="riven-ciclo-sub">${tx(isEs, "STAT COMBINADO QUE BUSCAS", "SPLICED STAT YOU WANT")}</div>
        <select class="riven-ciclo-select" onchange="globalThis.RivenScannerHUD.fijaFusion(this.value)">
          <option value="">${tx(isEs, "Ninguno", "None")}</option>${html}
        </select>
      </div>`;
}

export function objetivoDelArma(meta, tipo, { best, mid, pesos }) {
    const typeIdx = tipoDeArma(tipo);
    const m = meta || {};
    const queridos = new Set([...best, ...mid, ...(m.pos || []), ...(m.midPos || [])].map((s) => claveStat(s, typeIdx)));
    const negOk = [...(m.neg || []), ...NEG_INOFENSIVOS].filter((s) => !queridos.has(claveStat(s, typeIdx)));
    return { buscados: best, negOk, pesos };
}

export function cicloRivenHtml({ stats, meta, tipo, deseados, rolls, isEs }) {
    if (!stats?.length) return "";
    const conSigno = stats.map((s) => ({ ...s, isPositive: s.isPositive ?? s.value > 0 }));
    return consejoCicloHtml({ stats: conSigno, rolls, tipo, isEs, ...objetivoDelArma(meta, tipo, deseados) });
}

export function consejoCicloHtml({ stats, rolls, tipo, buscados, negOk, isEs, rotulo = "", pesos = null, conCombinar = true }) {
    const typeIdx = tipoDeArma(tipo);
    const ciclosHechos = Number.isFinite(rolls) ? rolls : CICLOS_SI_NO_SE_SABE;
    const c = consejoDeCiclo({ stats, typeIdx, buscados, negOk, ciclosHechos, pesos });
    const combinar = conCombinar ? combinarDelRoll({ stats, typeIdx, pesos, buscados, negOk, isEs, ciclosHechos }) : "";
    if (!c) return combinar ? `<div class="riven-ciclo">${combinar}</div>` : "";

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
            <strong>${textoCiclos(o.p, isEs)} · ${textoKuva(o.kuva, isEs)} kuva</strong></div>`;
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
        const queda = c.fusionado ? tx(isEs, ` (${nombreStat(c.fusionado, typeIdx, true)} se queda)`, ` (${nombreStat(c.fusionado, typeIdx, false)} stays)`) : "";
        cuerpo = `<div class="riven-ciclo-intro">${tx(isEs, "Hasta sacar un buen riven, de media", "To get a good riven, on average")}${escapeHTML(queda)}:</div>`
            + fila(tx(isEs, "Sin bloquear", "No lock"), c.sinBloqueo, !c.conviene, false)
            + (b ? fila(tx(isEs, `Bloqueando ${escapeHTML(nombreBloqueo)}`, `Locking ${escapeHTML(nombreBloqueo)}`), b, c.conviene, true) : "")
            + `<div class="riven-ciclo-veredicto${c.conviene ? " ok" : ""}">${escapeHTML(veredicto)}</div>`;
    }

    return `
      <div class="riven-ciclo">
        <div class="riven-ciclo-titulo" data-tooltip="${escapeHTML(tipObjetivo)}">${tx(isEs, "¿BLOQUEAR UN STAT?", "LOCK A STAT?")}${rotulo ? ` · ${escapeHTML(rotulo)}` : ""} ℹ</div>
        ${cuerpo}
        ${combinar}
      </div>`;
}

const FILAS_CONFIG = [
    [{ pos: 2, neg: false }, ["2 positivos", "2 positives"]],
    [{ pos: 2, neg: true }, ["2 positivos y 1 negativo", "2 positives + 1 negative"]],
    [{ pos: 3, neg: false }, ["3 positivos", "3 positives"]],
    [{ pos: 3, neg: true }, ["3 positivos y 1 negativo", "3 positives + 1 negative"]],
];

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

    const opcion = (que, p, bloqueado) => ({ que, p, kuva: kuvaEsperada(p, ciclos, bloqueado) });
    const sin = opcion(["No bloquees", "Don't lock"], probPorCiclo(base), false);
    const cuanto = (o) => `${textoCiclos(o.p, isEs)} (${textoKuva(o.kuva, isEs)} kuva)`;
    // Una recomendación por fila (lo más barato, o no bloquear), no una tabla de opciones a comparar.
    const filas = FILAS_CONFIG.map(([config, nombre]) => {
        const opciones = [opcion(["Bloquea un stat bueno", "Lock a good stat"],
            probPorCiclo({ ...base, config, bloqueado: { stat: busc[0], negativo: false } }), true)];
        if (config.neg && ok.length) {
            opciones.push(opcion(["Bloquea el negativo", "Lock the negative"],
                probPorCiclo({ ...base, config, bloqueado: { stat: ok[0], negativo: true } }), true));
        }
        const mejor = opciones.reduce((a, b) => (b.kuva < a.kuva ? b : a));
        const o = mejor.kuva < sin.kuva ? mejor : sin;
        return `<tr class="${o === sin ? "" : "mejor"}"><th>${nombre[isEs ? 0 : 1]}</th><td>${o.que[isEs ? 0 : 1]}: ${cuanto(o)}</td></tr>`;
    }).join("");

    const tip = `${textoObjetivo({ buscados: busc, negOk: ok, k }, typeIdx, isEs)} ${tx(isEs,
        "Bloquear supone que tu riven ya tiene un stat bueno (o un negativo inofensivo). Con un stat bloqueado cada ciclo cuesta el doble (7.000 en vez de 3.500), pero ese stat se queda y hacen falta menos ciclos.",
        "Locking assumes your riven already has a good stat (or a harmless negative). With a stat locked each cycle costs double (7,000 instead of 3,500), but that stat stays so fewer cycles are needed.")}`;
    const buscanSplice = (r) => busc.includes(r.a) && busc.includes(r.b);
    // Un buscado con otro buscado, o con un negativo inofensivo que puede acompañarlo en la carta.
    const utiles = new Set([...busc, ...ok]);
    const recetas = recetasDelTipo(typeIdx).filter((r) => (busc.includes(r.a) || busc.includes(r.b))
        && utiles.has(r.a) && utiles.has(r.b));

    return `
      <div class="riven-ciclo ficha">
        <div class="riven-ciclo-titulo" data-tooltip="${escapeHTML(tip)}">${tx(isEs, "¿BLOQUEO UN STAT AL CICLAR?", "SHOULD I LOCK A STAT?")} ℹ</div>
        <div class="riven-ciclo-intro">${tx(isEs,
            `Sin bloquear nada tardas ${cuanto(sin)} en sacar un buen riven.`,
            `Without locking, a good riven takes ${cuanto(sin)}.`)}</div>
        <table class="riven-ciclo-tabla">
          <thead><tr><th>${tx(isEs, "Si tu riven tiene", "If your riven has")}</th><th>${tx(isEs, "Haz esto", "Do this")}</th></tr></thead>
          <tbody>${filas}</tbody>
        </table>
        ${combinarHtml(recetas, typeIdx, isEs,
        tx(isEs, "Con esta arma puedes fundir:", "On this weapon you can fuse:"), buscanSplice)}
      </div>`;
}
