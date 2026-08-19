import { state } from "../../state.js";
import { TEXTS } from "../../config.js";
import { escapeHTML } from "../../utils/escape_html.js";
import { getRivenTooltip } from "../../utils/rivens/riven_tooltips.js";
import { getLocalizedStatName, CANT_BE_NEGATIVE } from "../../utils/rivens/riven_stat_display.js";
import { extractFamilyName } from "../../utils/rivens/riven_family.js";
import {
  calculateHybridTiers,
  gradeWeaponStats,
  STAT_TIER_TOP,
  STAT_TIER_MID,
} from "../../utils/rivens/riven_logic.js";
import { getMetaStats } from "../../services/rivens/riven_market.service.js?v=1.9";
import {
  metaConPesosDeFamilia,
  pesosFinosDeArma,
  statsSinDatoPropio,
  isStatAllowedForWeaponType,
} from "../../services/rivens/riven_weights.service.js";
import { renderCuriosidadesArma } from "./ui_riven_curiosidades.js";

// Ficha de meta-stats de un arma: qué stats busca la gente, cuáles son maldiciones aceptables
// y qué dice el mercado. Es la pantalla que más fuentes cruza (tiers del oráculo, pesos de
// familia, precios) y por eso vivía enredada en ui_rivens.js.

export function renderMetaStats(weaponName, weaponType, targetId = "meta-stats-container") {
  const container = document.getElementById(targetId);
  if (!container) return;

  const metaRaw = getMetaStats(weaponName, weaponType);
  if (!metaRaw) {
    container.style.display = "none";
    return;
  }
  // La guía se construye sobre la FAMILIA: el riven es el mismo para todas las variantes, así que
  // Obex y Prisma Obex deben mostrar exactamente los mismos stats buenos y malos. Se sigue mutando
  // `meta` más abajo (pos/midPos/_genericRecs), pero ahora sobre la copia normalizada, no sobre el
  // objeto cacheado de la variante — así una variante no contamina la guía de su hermana.
  const meta = metaConPesosDeFamilia(metaRaw, weaponName);
  renderCuriosidadesArma(weaponName);   // se autooculta si esta arma no tuvo movimientos

  // Generic fallback for weapons with no curated riven recommendations (e.g. kitguns, whose
  // pos/neg arrays come empty from the metastats source). Without this the guide renders blank.
  // We seed type-appropriate universally-good stats and flag them as estimated so they are not
  // mistaken for the curated meta.
  const _typeStr = String(weaponType || meta.t || "").toLowerCase();
  const _isMeleeType = _typeStr.includes("melee") || _typeStr.includes("zaw") || _typeStr.includes("glaive");
  // Listas medidas sobre el dataset (ratio = precio mediano CON el stat / SIN él, calculado dentro
  // de cada arma para no confundirlo con "esta arma es cara"; 163 armas melee, 252 de fuego):
  //   MELEE  +CritDmg 4.81 +CritChance 3.33 +AttackSpeed 2.49 +MeleeDmg 2.02 +Range 2.00 | +Electric 1.10
  //   FUEGO  +CritDmg 3.33 +Multishot 3.16 +CritChance 2.80 | +BaseDmg 1.67 +Toxin 1.15 +FireRate 1.10
  // Correcciones frente a la lista anterior, todas por dato:
  //   - Attack Speed FALTABA en melee y es el 3.º mejor (2.49×), por encima de Melee Damage y Range.
  //   - Combo Duration estaba como MID en melee y mide 0.46×: es de los que más RESTAN, no medio.
  //   - Heat/Toxin como MID en melee miden 0.67× y 0.83× (por debajo de 1 = quitan valor). En fuego
  //     Toxin sí llega a 1.15× y se queda; Heat (0.83×) sale también de la lista de fuego.
  // Se usan los nombres CANÓNICOS ("Base Damage / Melee Damage", no "Melee Damage"): son los únicos
  // que getLocalizedStatName sabe traducir, así que los cortos que había antes se quedaban en inglés
  // aunque la app estuviera en español.
  // PRIMERO los pesos del ML de ESTA arma. Las listas curadas llegan vacías en 556 de 620 armas, así
  // que sin esto el 90% del catálogo mostraba la misma lista genérica aunque el ML publique pesos
  // propios para 608. Y la diferencia es real: en Bo, Critical Chance es 0.48 (medio, no top); en
  // Kuva Bramma, Toxin Damage llega a 1.00. Los cortes y el guard de pesos saturados los pone
  // gradeWeaponStats, compartido con la tasación para que el panel no contradiga al precio.
  const _grado = gradeWeaponStats(meta,
    state.rivenStatBaseline?.stat_weights ?? state.rivenStatPrior ?? null);
  if (_grado && _grado.best.length) {
    meta.pos = _grado.best;
    meta.midPos = _grado.mid;
    // Se ASIGNA, no se acumula: `meta` es el objeto cacheado de metastats y se muta en cada render.
    // El primer render ocurre antes de que cargue el bundle de ML, así que cae en la rama genérica y
    // deja _genericRecs = true; sin reasignarlo aquí, el aviso "· estimado" se quedaba pegado para
    // siempre aunque el repintado posterior ya graduara con los pesos reales del arma.
    meta._genericRecs = _grado.fuente !== "arma";
  } else if (!(meta.pos && meta.pos.length) && !(meta.midPos && meta.midPos.length)) {
    meta.pos = _isMeleeType
      ? ["Critical Damage", "Critical Chance", "Fire Rate / Attack Speed",
        "Base Damage / Melee Damage", "Range"]
      : ["Critical Damage", "Multishot", "Critical Chance", "Base Damage / Melee Damage"];
    meta.midPos = _isMeleeType
      ? ["Electric Damage"]
      : ["Toxin Damage", "Fire Rate / Attack Speed"];
    meta._genericRecs = true;
  }
  if (!(meta.neg && meta.neg.length)) {
    // Negativas medidas como INOCUAS (>1 = el riven vale MÁS con ellas que con otra maldición):
    //   MELEE  -Impact 3.62 -Puncture 3.00 -FinisherDmg 2.69 -HeavyAtkEff 2.12 -Slash 1.80 -Combo 1.51
    //   FUEGO  -Zoom 3.00 -Impact 3.00 -Puncture 2.67 -Recoil 2.00 -Slash 1.54 -AmmoMax 1.50
    meta.neg = _isMeleeType
      ? ["Finisher Damage", "Heavy Attack Efficiency", "Combo Duration"]
      : ["Zoom", "Recoil", "Ammo Maximum"];
    meta._genericRecs = true;
  }

  // El guard de re-render va DESPUÉS de resolver meta y a propósito incluye la procedencia de las
  // recomendaciones. loadDynamicMetaStats() es asíncrono y se dispara al importar el módulo: si el
  // usuario ya tenía un arma puesta, el primer render ocurre sin datos y pinta los BEST POSITIVES
  // genéricos ("estimado"). Cuando los metastats terminan de cargar, refreshCurrentRivenMetaStats()
  // repinta con el mismo arma/tipo/idioma; con la clave antigua eso daba la MISMA cacheKey y salía
  // por el return, dejando los estimados hasta un refresco completo de la página.
  // La clave incluye si los pesos FINOS del bundle ya están cargados: son los que desempatan dentro
  // de BEST/inocuas para marcar los TOP. loadRivenML() es asíncrono, así que el primer render no los
  // tiene y sin este trozo de clave el repintado posterior salía por el return y nunca se marcaba nada.
  const _finos = state.rivenStatWeights ? "f" : "nf";
  // La clave va por FAMILIA, no por variante: la guía es idéntica para Obex y Prisma Obex (mismo
  // riven), así que alternar entre ellas repintaba un contenido igual y eso era el parpadeo.
  const _fam = extractFamilyName(String(weaponName || "")) || weaponName;
  const cacheKey = `${_fam}_${weaponType}_${state.currentLang}_${meta._genericRecs ? "gen" : "real"}_${_finos}`;
  if (container.dataset.lastRenderedKey === cacheKey) return;

  const isEs = state.currentLang === "es";

  const getWeightText = (stat, fallbackVal) => {
    if (meta.dynamic_weights && meta.dynamic_weights[stat] !== undefined) {
      return ` (${Number(meta.dynamic_weights[stat]).toFixed(2)})`;
    }
    return fallbackVal !== undefined ? ` (${fallbackVal.toFixed(2)})` : "";
  };

  // Build beautiful positive and negative guides (best, mid & worst)
  // Filtramos stats que no aplican al tipo de arma (p. ej. Heavy Attack Efficiency en no-melee)
  // `allow` filtra por tipo de arma (un melee no rola Multishot) Y por evidencia: los stats cuyo peso
  // viene del prior en vez de las subastas del arma no se RECOMIENDAN, aunque sí se siguen usando
  // para tasar. Guarda: si ocultarlos dejaría la lista de BEST vacía (12 de 415 armas) se muestran
  // igual, porque una guía en blanco es peor que una basada en el prior.
  const _sinDato = statsSinDatoPropio(weaponName);
  const _tipoOk = (s) => isStatAllowedForWeaponType(s, weaponType);
  const _bestConDato = (meta.pos || []).filter(s => _tipoOk(s) && !_sinDato.has(String(s).toLowerCase()));
  const _ocultarSinDato = _bestConDato.length > 0;
  const allow = (s) => _tipoOk(s)
    && !(_ocultarSinDato && _sinDato.has(String(s).toLowerCase()));
  // Las listas de NEGATIVAS se filtran con la confianza del lado negativo, no con la de los
  // positivos: son evidencias distintas (ver statsSinDatoPropio).
  const _sinDatoNeg = statsSinDatoPropio(weaponName, "neg");
  const _ocultarSinDatoNeg = _sinDatoNeg.size > 0
    && (meta.neg || []).some(s => _tipoOk(s) && !_sinDatoNeg.has(String(s).toLowerCase()));
  const allowNeg = (s) => _tipoOk(s)
    && !(_ocultarSinDatoNeg && _sinDatoNeg.has(String(s).toLowerCase()));

  // DENTRO de BEST hay jerarquía: en la mayoría de armas 1 o 2 stats son los realmente decisivos y el
  // resto acompañan. Se marcan con "TOP" los que están a >=95% del peso máximo del arma, con tope de
  // 2 para que el énfasis siga significando algo (si 4 salieran marcados, no destaca ninguno).
  // Cuando los pesos empatan (armas de poco volumen saturan a 1.00) no se marca nada: no hay
  // jerarquía real que mostrar y marcar todo equivaldría a no marcar.
  // Los finos primero: dynamic_weights empata los mejores a 1.00 y no dejaría marcar ninguno.
  // Ese empate viene de la escala min-max vieja del pipeline; con la escala fija (ML_local.py)
  // solo quedan empatados los del grupo líder que se promueve al tier alto, así que la guarda
  // de abajo sigue haciendo falta pero se dispara mucho menos.
  // NO se vuelve a encoger hacia el prior aquí: ML_local._mezclar ya lo hace al exportar, con
  // shrinkage bayesiano por tamaño de muestra (K_PRIOR=8: b = (n·local + 8·global)/(n+8)). Repetirlo
  // en el front sería aplicar el prior dos veces y aplanar de más las armas con datos propios buenos.
  const _pesosPos = pesosFinosDeArma(weaponName, "pos") || meta.dynamic_weights || {};
  const _pesosNeg = pesosFinosDeArma(weaponName, "neg") || {};
  // El filtro va como parámetro: las listas de negativas se criban con allowNeg, no con allow.
  const _destacar = (lista, pesos, filtro = allow) => {
    const conPeso = (lista || []).filter(filtro)
      .map(s => [s, parseFloat(pesos[s])])
      .filter(([, v]) => Number.isFinite(v))
      .sort((a, b) => b[1] - a[1]);
    if (conPeso.length < 2) return new Set();
    const max = conPeso[0][1];
    const cerca = conPeso.filter(([, v]) => v >= max * 0.95);
    if (cerca.length > 2 || cerca.length === conPeso.length) return new Set();
    return new Set(cerca.map(([s]) => s));
  };
  const _mejores = _destacar(meta.pos, _pesosPos);
  const _tipTop = isEs
    ? "El stat con más peso de esta arma: es el que decide el precio, más que los otros del grupo."
    : "This weapon's highest-weighted stat: it drives the price more than the others in the group.";
  const _tipTopNeg = isEs
    ? "La maldición menos dañina de esta arma: es la que menos resta al precio de todo el grupo."
    : "This weapon's least harmful curse: it costs less value than any other in the group.";

  const bestPosHtml = (meta.pos || []).filter(allow).map(s => `
    <span ${_mejores.has(s) ? `data-tooltip="${_tipTop}" style="cursor:help; ` : "style=\""}background: rgba(0, 255, 120, ${_mejores.has(s) ? "0.28" : "0.15"}); border: 1px solid rgba(0, 255, 120, ${_mejores.has(s) ? "0.85" : "0.45"}); color: #00ff78; text-shadow: 0 0 6px rgba(0, 255, 120, 0.5); box-shadow: 0 0 ${_mejores.has(s) ? "12px rgba(0,255,120,0.4)" : "8px rgba(0, 255, 120, 0.15)"}; padding: 2px 6px; border-radius: 4px; font-size: 11px; margin-right: 4px; display: inline-block; margin-bottom: 4px; font-weight: bold;">
      <span style="font-size: 9px; background: #00ff78; color: #000; padding: 1px 4px; border-radius: 3px; margin-right: 5px; font-weight: 900; text-transform: uppercase;">${_mejores.has(s) ? "TOP" : "BEST"}</span>+ ${getLocalizedStatName(s)}
    </span>
  `).join("");

  const midPos = (meta.midPos || []).filter(allow);
  const midPosHtml = midPos.length > 0 ? midPos.map(s => `
    <span style="background: rgba(234, 179, 8, 0.08); border: 1px solid rgba(234, 179, 8, 0.18); color: #eab308; padding: 2px 6px; border-radius: 4px; font-size: 11px; margin-right: 4px; display: inline-block; margin-bottom: 4px; font-weight: 500;">
      <span style="font-size: 9px; background: rgba(234, 179, 8, 0.18); color: #eab308; padding: 1px 4px; border-radius: 3px; margin-right: 5px; font-weight: 700; text-transform: uppercase;">MID</span>+ ${getLocalizedStatName(s)}
    </span>
  `).join("") : "";

  const worstPos = (meta.pos_tier?.trash || meta.pos?.worst || meta.rawPos?.worst || []).filter(allow);
  const worstPosHtml = worstPos.length > 0 ? worstPos.map(s => `
    <span style="background: rgba(148, 163, 184, 0.08); border: 1px solid rgba(148, 163, 184, 0.18); color: #94a3b8; padding: 2px 6px; border-radius: 4px; font-size: 11px; margin-right: 4px; display: inline-block; margin-bottom: 4px; font-weight: 500;">
      + ${getLocalizedStatName(s)}
    </span>
  `).join("") : "";

  // Negativas INOFENSIVAS (data-driven por arma): la lista curada del endpoint (meta.neg) + negativas
  // universalmente inofensivas/mitigables, EXCLUYENDO las que el arma QUIERE como positivo (esas serían
  // ruinosas) y las que no pueden rolear negativas (elementos). Antes solo salían las de meta.neg (2-3).
  // Facción NO va aquí: es "meh" (se prefiere sin negativa de facción) -> va a MID, con Infested primero.
  // Ratios medidos (precio con ESTA negativa / con otra negativa, intra-arma). Los de melee solo
  // aparecen en melee porque `allow` filtra por tipo de arma.
  //   FUEGO  Zoom 3.00 · Impact 3.00 · Puncture 2.67 · Recoil 2.00 · Slash 1.54 · AmmoMax 1.50
  //          Magazine 1.25 · Projectile 1.21 · Reload 1.20
  //   MELEE  Impact 3.62 · Puncture 3.00 · FinisherDmg 2.69 · HeavyAtkEff 2.12 · Slash 1.80
  // Slash faltaba y mide por encima de Ammo Maximum y Magazine Capacity, que sí estaban.
  const HARMLESS_NEG_CANDIDATES = ["Zoom", "Recoil", "Impact Damage", "Puncture Damage",
    "Ammo Maximum", "Magazine Capacity", "Reload Speed", "Projectile Speed", "Slash Damage",
    "Finisher Damage", "Heavy Attack Efficiency"];
  // PRIORIDAD AL RANKING DE DATOS: un stat que los pesos por arma (dynamic_weights) marcan valioso
  // NO puede ser harmless/mid aunque esté en mis listas hardcodeadas -> manda el dato.
  const _dw = meta.dynamic_weights || {};
  const _dataWantedNames = Object.keys(_dw).filter(k => parseFloat(_dw[k]) >= 0.5);
  // Ranking CONTINUO del daño de un negativo = cuánto quiere el arma ese stat como positivo:
  //   peso >=0.7 (stat TOP) -> perderlo ARRUINA (WORST);  0.4-0.7 (stat medio) -> daño MEDIO (MID).
  // Antes cualquier stat "querido" (incl. mid-positivos como Fire Rate) caía en WORST por igual.
  // Mismos cortes que gradúan los positivos (STAT_TIER_TOP/MID en riven_logic.js): si divergieran,
  // un stat podría salir como BEST positivo y a la vez su negativa como "daño medio".
  const _dataWorst = Object.keys(_dw).filter(k => parseFloat(_dw[k]) >= STAT_TIER_TOP);
  const _dataMid = Object.keys(_dw).filter(k => {
    const v = parseFloat(_dw[k]); return v >= STAT_TIER_MID && v < STAT_TIER_TOP;
  });
  const _worstSet = new Set([...(meta.pos || []), ..._dataWorst].map(x => String(x).toLowerCase()));
  const _wantedSet = new Set([...(meta.pos || []), ...(meta.midPos || []), ..._dataWantedNames].map(x => String(x).toLowerCase()));
  const _curatedNeg = new Set((meta.neg || []).map(x => String(x).toLowerCase()));
  const harmlessAll = [...new Set([...(meta.neg || []), ...HARMLESS_NEG_CANDIDATES])]
    .filter(allowNeg)
    .filter(s => !_wantedSet.has(String(s).toLowerCase()) && !CANT_BE_NEGATIVE.test(s));
  const harmlessSet = new Set(harmlessAll.map(x => String(x).toLowerCase()));
  // Mismo criterio que en los positivos: la maldición MENOS dañina del arma se marca TOP. En `neg` el
  // peso alto es "inocua", así que sigue siendo "más alto = mejor" (Obex: Puncture 1.000 > Impact 0.947).
  const _mejoresNeg = _destacar(harmlessAll, _pesosNeg, allowNeg);
  const bestNegHtml = harmlessAll.map(s => {
    const isTop = _mejoresNeg.has(s);
    const isCurated = _curatedNeg.has(String(s).toLowerCase());
    const fuerte = isTop || isCurated;
    const badge = fuerte
      ? `<span style="font-size: 9px; background: #00e5ff; color: #000; padding: 1px 4px; border-radius: 3px; margin-right: 5px; font-weight: 900; text-transform: uppercase;">${isTop ? "TOP" : "BEST"}</span>`
      : "";
    const tip = isTop ? ` data-tooltip="${_tipTopNeg}"` : "";
    return `<span${tip} style="${isTop ? "cursor:help; " : ""}background: rgba(0, 229, 255, ${isTop ? "0.28" : isCurated ? "0.15" : "0.07"}); border: 1px solid rgba(0, 229, 255, ${isTop ? "0.85" : isCurated ? "0.45" : "0.22"}); color: #00e5ff; ${fuerte ? `text-shadow: 0 0 6px rgba(0,229,255,0.5); box-shadow: 0 0 ${isTop ? "12px rgba(0,229,255,0.4)" : "8px rgba(0,229,255,0.15)"}; font-weight: bold;` : "font-weight: 500;"} padding: 2px 6px; border-radius: 4px; font-size: 11px; margin-right: 4px; display: inline-block; margin-bottom: 4px;">${badge}- ${getLocalizedStatName(s)}</span>`;
  }).join("");

  // MID negativas = las del endpoint + las de FACCIÓN. Van a MID y no a "inocuas" porque su ratio
  // medido se queda corto: -Infested 1.38× · -Corpus 1.20× · -Grineer 1.00× (frente a -Zoom 3.00× o
  // -Impact 3.00×). El orden es el del dato, de la menos mala a la más mala; antes Grineer y Corpus
  // estaban al revés.
  const FACTION_NEGS = ["Damage Vs Infested", "Damage Vs Corpus", "Damage Vs Grineer"];
  // MID negativas = facciones + las MID-positivas del arma (perder un stat medio duele pero NO
  // arruina) + stats con peso de datos 0.4-0.7. Excluye harmless y las WORST (stats top).
  const midNeg = [...new Set([...(meta.midNeg || []), ...FACTION_NEGS, ...(meta.midPos || []), ..._dataMid])]
    .filter(allowNeg)
    .filter(s => !_worstSet.has(String(s).toLowerCase()) && !harmlessSet.has(String(s).toLowerCase()) && !CANT_BE_NEGATIVE.test(s));
  const midNegHtml = midNeg.length > 0 ? midNeg.map(s => `
    <span style="background: rgba(234, 179, 8, 0.08); border: 1px solid rgba(234, 179, 8, 0.18); color: #eab308; padding: 2px 6px; border-radius: 4px; font-size: 11px; margin-right: 4px; display: inline-block; margin-bottom: 4px; font-weight: 500;">
      <span style="font-size: 9px; background: rgba(234, 179, 8, 0.18); color: #eab308; padding: 1px 4px; border-radius: 3px; margin-right: 5px; font-weight: 700; text-transform: uppercase;">MID</span>- ${getLocalizedStatName(s)}
    </span>
  `).join("") : "";

  // A "worst negative" = rolling a NEGATIVE on a stat the weapon wants (its positives) — that
  // ruins value. Excluded: stats that are good/neutral as a curse (the weapon's desirable
  // negatives) and elemental damage (Heat/Cold/Electric/Toxin), which can NEVER roll negative
  // on a riven. This avoids junk like "Zoom" or "Heat" appearing here.
  const goodNegSet = new Set([...(meta.neg || []), ...midNeg, ...harmlessAll].map(x => String(x).toLowerCase()));
  // Peores negativas = inverso de los mejores positivos (bricks) + las peores que devuelve el endpoint
  // (neg_tier.curse en armas normales, negWorst en kitguns), deduplicadas.
  // WORST = negativo sobre un stat TOP del arma (best positives o peso de datos >=0.7): arruina.
  // Las MID-positivas (p.ej. Fire Rate en un arma de crit) YA NO caen aquí -> van a MID.
  const worstNeg = [...new Set([
    ...(meta.pos || []), ..._dataWorst,
    ...(meta.negWorst || []), ...(meta.neg_tier?.curse || []), ...(meta.rawNeg?.worst || [])
  ])]
    .filter(allow)
    .filter(s => !goodNegSet.has(String(s).toLowerCase()) && !harmlessSet.has(String(s).toLowerCase()) && !CANT_BE_NEGATIVE.test(s));
  const worstNegHtml = worstNeg.length > 0 ? worstNeg.map(s => `
    <span style="background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.18); color: #ef4444; padding: 2px 6px; border-radius: 4px; font-size: 11px; margin-right: 4px; display: inline-block; margin-bottom: 4px; font-weight: 500;">
      - ${getLocalizedStatName(s)}
    </span>
  `).join("") : "";

  let extraHtml = "";
  const hasOfficial = (meta.official_median !== undefined && meta.official_median !== null && meta.official_median > 0) ||
    (meta.official_avg_price !== undefined && meta.official_avg_price !== null && meta.official_avg_price > 0);

  const wfmAvgVal = meta.wfm_avg_price || meta.wfm_avg || 0;
  if (hasOfficial || wfmAvgVal || meta.popularity_pct) {
    const basePrice = meta.official_median !== undefined && meta.official_median !== null && meta.official_median > 0
      ? meta.official_median
      : (meta.official_avg_price || 0);

    const officialPrice = hasOfficial ? `${basePrice}p` : "N/A";
    const wfmPrice = wfmAvgVal ? `${wfmAvgVal}p` : "N/A";
    const pop = (meta.popularity_pct !== undefined && meta.popularity_pct !== null)
      ? `${Math.round(meta.popularity_pct)}/100`
      : "0/100";
    // "trades" era falso: wfm_market_sample cuenta OFERTAS activas muestreadas en WFM, no ventas
    // cerradas. Las ventas reales solo las publica DE (de_unrolled / de_rerolled).
    const sample = meta.wfm_market_sample
      ? `${meta.wfm_market_sample} ${isEs ? "ofertas" : "listings"}`
      : "N/A";

    const stddevVal = meta.official_stddev || 0;
    let riskLabel = "", riskColor = "", riskTooltip = "";
    if (hasOfficial) {
      const ratio = basePrice > 0 ? stddevVal / basePrice : 0;
      if (!stddevVal || ratio < 0.5) {
        riskLabel = isEs ? "ESTABLE" : "STABLE";
        riskColor = "#00ff78";
        riskTooltip = isEs
          ? "El precio de este Riven es predecible y seguro. Casi todo el mundo lo compra y vende por la misma cantidad de platino."
          : "The price of this Riven is predictable and safe. Almost everyone buys and sells it for the same amount of platinum.";
      } else if (ratio <= 1.2) {
        riskLabel = isEs ? "MODERADO" : "MODERATE";
        riskColor = "#ffb300";
        riskTooltip = isEs
          ? "El precio fluctúa bastante. Dependiendo de las estadísticas o del comprador, puedes ganar o perder mucho margen de platino."
          : "The price fluctuates quite a bit. Depending on the stats or the buyer, you can gain or lose a lot of platinum margin.";
      } else {
        riskLabel = isEs ? "EXTREMO" : "EXTREME";
        riskColor = "#ff4444";
        riskTooltip = isEs
          ? "No hay un precio fijo. Algunos jugadores pagan auténticas fortunas por él, mientras que otros lo malvenden. Entra bajo tu propio riesgo."
          : "There is no fixed price. Some players pay absolute fortunes for it, while others quick-sell it. Enter at your own risk.";
      }
    }

    const trendTooltip = getRivenTooltip("trend", isEs);

    const baseTooltip = !hasOfficial
      ? (isEs
        ? "No hay transacciones registradas oficialmente por Digital Extremes para este arma esta semana debido a su bajo volumen de comercio en el juego."
        : "No official transactions recorded by Digital Extremes for this weapon this week due to low in-game trading volume.")
      : getRivenTooltip("unrolled", isEs);

    const premiumTooltip = getRivenTooltip("wfm", isEs);

    const webMinVal = meta.web_min !== undefined ? meta.web_min : Math.round(wfmAvgVal * 0.25);
    const webMaxVal = meta.web_max !== undefined ? meta.web_max : 0;
    const rangeText = (webMinVal > 0 || webMaxVal > 0) ? `${webMinVal}–${webMaxVal}p` : "";

    // Word-rate the raw decimals so the numbers read at a glance.
    const volNum = (typeof meta.volatility_index === "number" ? meta.volatility_index : 0);
    const volWord = volNum < 0.3 ? (isEs ? "BAJA" : "LOW") : volNum < 0.7 ? (isEs ? "MEDIA" : "MEDIUM") : (isEs ? "ALTA" : "HIGH");
    const volColor = volNum < 0.3 ? "#00ff78" : volNum < 0.7 ? "#eab308" : "#ff4444";
    const liqVal = meta.liquidity_score ?? 0;
    const rerollPct = Math.round((typeof meta.rerolled_premium_ratio === "number" ? meta.rerolled_premium_ratio : 0) * 100);

    const liqTooltip = isEs
      ? "De 0 a 100: lo rápido que se encuentra comprador para esta arma. Por debajo de 30 tendrás que bajar el precio o esperar semanas; por encima de 70 se coloca en días."
      : "From 0 to 100: how quickly a buyer turns up for this weapon. Below 30 you will have to cut the price or wait weeks; above 70 it moves in days.";
    const volTooltip = isEs
      ? "Cuánto baila el precio de un día para otro. ALTA significa que dos vendedores piden cifras muy distintas por rivens parecidos: hay margen para negociar, pero también para equivocarse."
      : "How much the price swings from day to day. HIGH means two sellers ask very different amounts for similar rivens: room to haggle, but also room to get it wrong.";
    const rerollTooltip = isEs
      ? "Cuánto más se paga por un riven ya ciclado que por uno recién sacado. Si es alto, merece la pena rolar antes de vender; si es bajo, véndelo tal cual."
      : "How much more a rolled riven fetches versus a fresh one. If it is high, rolling before selling pays off; if it is low, sell it as is.";

    const plat = `<img src="assets/relic_contents/platinum.webp" style="width:11px;height:11px;object-fit:contain;vertical-align:-1px;">`;
    const info = `<span class="info-icon" style="font-size:0.6rem;opacity:0.7;">ℹ</span>`;
    // One "label …… value" row inside a group.
    // `kind` marca el ORIGEN del número y es lo único que cambia el color, a propósito: un precio
    // pedido y una venta real se leían idénticos (mismo dorado, misma tipografía) aunque difieran
    // ~13×, y esa es justo la confusión que hace que alguien liste a 5000p y no venda nunca.
    //   "real" = venta cerrada (datos de DE)  -> dorado, el dato en el que confiar
    //   "ask"  = lo que piden en WFM          -> gris azulado y en cursiva, dato de referencia
    const row = (label, value, tip, kind = "") => {
      const valStyle = kind === "ask"
        ? "color:#8fa3bf; font-weight:600; font-style:italic; white-space:nowrap;"
        : "color:var(--wf-gold-text); font-weight:700; white-space:nowrap;";
      return `<div style="display:flex; justify-content:space-between; align-items:center; gap:10px; padding:3px 0; ${tip ? "cursor:help;" : ""}" ${tip ? `data-tooltip="${tip}"` : ""}>
         <span style="color:#8a8a93;">${label} ${tip ? info : ""}</span>
         <span style="${valStyle}">${value}</span>
       </div>`;
    };
    const groupHeader = (txt) =>
      `<div style="font-size:10.5px; color:#8b93a1; text-transform:uppercase; font-weight:800; letter-spacing:0.06em; margin:10px 0 4px;">${txt}</div>`;

    // Los nombres dicen de dónde sale cada número, porque mezclarlos es el error caro: official_median
    // es la mediana de rivens SIN CICLAR (verificado: coincide con de_unrolled.median en 608/608
    // armas), así que "Precio típico" hacía creer que era la referencia de un riven ya rolado. Y lo
    // de WFM son precios PEDIDOS, ~13× las ventas reales: si no lo pone, se lee como valor de mercado.
    const priceRows =
      row(isEs ? "Venta real · sin ciclar" : "Real sale · unrolled", officialPrice, baseTooltip, "real") +
      row(isEs ? "Piden en WFM" : "Asking on WFM", `${wfmPrice}${sample !== "N/A" ? ` · ${sample}` : ""}`, premiumTooltip, "ask") +
      (rangeText ? row(isEs ? "Rango de lo que piden" : "Asking range", rangeText, premiumTooltip, "ask") : "") +
      (riskLabel ? row(isEs ? "Estabilidad" : "Stability", `<span style="color:${riskColor}">${riskLabel}</span> <span style="color:#666;font-weight:400;">σ${stddevVal}p</span>`, riskTooltip) : "");

    const demandRows =
      row(isEs ? "Volumen de intercambio" : "Trade volume", pop, trendTooltip) +
      row(isEs ? "Rapidez de venta" : "Sale speed", `${liqVal}/100`, liqTooltip);

    const rerollRows =
      row(isEs ? "Extra por ciclar" : "Reroll markup", `+${rerollPct}%`, rerollTooltip) +
      row(isEs ? "Volatilidad" : "Volatility", `<span style="color:${volColor}">${volWord}</span>`, volTooltip);

    extraHtml = `
      <div style="margin-top:8px; padding-top:8px; border-top:1px dashed rgba(255,255,255,0.1); font-size:12.5px; line-height:1.5;">
        ${groupHeader(isEs ? "PRECIOS DEL ARMA (plat)" : "WEAPON PRICES (plat)")}
        ${priceRows}
        ${groupHeader(isEs ? "¿SE VENDE FÁCIL?" : "DOES IT SELL?")}
        ${demandRows}
        ${groupHeader(isEs ? "¿MERECE LA PENA ROLARLO?" : "WORTH ROLLING?")}
        ${rerollRows}
      </div>
    `;

    let tierEstimatesHtml = "";
    const wfmAvgValForTiers = meta.wfm_avg_price || meta.wfm_avg || 0;
    if (basePrice > 0 || wfmAvgValForTiers > 0) {
      const tiers = calculateHybridTiers(meta, state.currentWeaponHistory);
      const tierTip = isEs
        ? "Valor estimado en platino según la calidad del roll: Basura (sin tocar/malo), Buen reroll (estadísticas decentes) y Godroll (combinación ideal)."
        : "Estimated platinum value by roll quality: Trash (unrolled/bad), Good reroll (decent stats) and Godroll (ideal combo).";

      const tierCard = (label, value, color, bg) =>
        `<div style="background:${bg}; border:1px solid ${color}22; border-radius:4px; padding:6px; text-align:center;">
           <div style="font-size:9px; color:${color}; text-transform:uppercase; font-weight:bold;">${label}</div>
           <div style="display:inline-flex; align-items:center; gap:3px; justify-content:center; font-size:15px; color:${color}; font-weight:bold; margin-top:2px;">
             <span>${value}</span>${plat}
           </div>
         </div>`;

      tierEstimatesHtml = `
        <div style="margin-top:12px; padding-top:10px; border-top:1px dashed rgba(255,255,255,0.15);">
          <div style="font-size:10px; color:#888; margin-bottom:6px; text-transform:uppercase; font-weight:800; letter-spacing:0.05em; cursor:help;" data-tooltip="${tierTip}">${isEs ? "VALOR ESTIMADO (plat)" : "ESTIMATED VALUE (plat)"} ${info}</div>
          <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:6px;">
            ${tierCard(isEs ? "BASURA" : "TRASH", tiers.trash, "#f2f2f7", "rgba(255,255,255,0.03)")}
            ${tierCard(isEs ? "BUEN REROLL" : "GOOD REROLL", tiers.goodReroll, "#00e5ff", "rgba(0,229,255,0.03)")}
            ${tierCard("GODROLL", tiers.godroll, "#ffd700", "rgba(255,215,0,0.03)")}
          </div>
        </div>
      `;
    }

    container.innerHTML = `
      <div style="background: rgba(255,255,255,0.015); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 12px; box-shadow: inset 0 0 15px rgba(0,0,0,0.2);">
          <div style="font-size: 10px; color: #94a3b8; margin-bottom: 10px; text-transform: uppercase; font-weight: 800; letter-spacing: 0.05em; border-bottom: 1px dashed rgba(255,255,255,0.08); padding-bottom: 6px;">
            ${isEs ? "Guía de Atributos del Arma" : "Weapon Attributes Guide"}
            ${meta._genericRecs ? `<span style="color:#eab308; font-weight:700; margin-left:6px;" title="${isEs ? "Recomendación genérica por tipo de arma; no hay datos meta específicos para este arma." : "Generic recommendation by weapon type; no curated meta data for this weapon."}">${isEs ? "· estimado" : "· estimated"}</span>` : ""}
          </div>
          
          <!-- Positives Section -->
          <div style="margin-bottom: 10px;">
            <div style="font-size: 9px; color: #00ff78; font-weight: 700; text-transform: uppercase; margin-bottom: 4px; display: flex; align-items: center; gap: 4px;">
              <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #00ff78;"></span>
              ${isEs ? "MEJORES POSITIVOS (BUSCADOS)" : "BEST POSITIVES (WANTED)"}
            </div>
            <div>${bestPosHtml}</div>
            
            ${midPosHtml ? `
              <div style="font-size: 9px; color: #eab308; font-weight: 700; text-transform: uppercase; margin-top: 6px; margin-bottom: 4px; display: flex; align-items: center; gap: 4px;">
                <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #eab308;"></span>
                ${isEs ? "POSITIVOS MEDIOS" : "MID POSITIVES"}
              </div>
              <div>${midPosHtml}</div>
            ` : ""}
            
            ${worstPosHtml ? `
              <details class="guia-plegable">
                <summary><span class="guia-punto" style="background:#94a3b8;"></span>${isEs ? "POSITIVOS MEH (REGULARES)" : "MEH POSITIVES"}<span class="guia-n">${(meta.pos_meh_n || 0) || ""}</span></summary>
                <div>${worstPosHtml}</div>
              </details>
            ` : ""}
          </div>
          
          <!-- Negatives Section -->
          <div style="margin-bottom: 10px;">
            <div style="font-size: 9px; color: #00e5ff; font-weight: 700; text-transform: uppercase; margin-bottom: 4px; display: flex; align-items: center; gap: 4px;">
              <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #00e5ff;"></span>
              ${isEs ? "MEJORES NEGATIVOS (INOFENSIVOS)" : "BEST NEGATIVES (HARMLESS)"}
            </div>
            <div>${bestNegHtml}</div>

            ${midNegHtml ? `
              <details class="guia-plegable">
                <summary><span class="guia-punto" style="background:#eab308;"></span>${isEs ? "NEGATIVOS MEDIOS" : "MID NEGATIVES"}</summary>
                <div>${midNegHtml}</div>
              </details>
            ` : ""}
            
            ${worstNegHtml ? `
              <div style="font-size: 9px; color: #ef4444; font-weight: 700; text-transform: uppercase; margin-top: 6px; margin-bottom: 4px; display: flex; align-items: center; gap: 4px;">
                <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #ef4444;"></span>
                ${isEs ? "PEORES NEGATIVOS (¡EVITAR - PENALIZAN PRECIO!)" : "WORST NEGATIVES (AVOID - RUINS VALUE!)"}
              </div>
              <div>${worstNegHtml}</div>
            ` : ""}
          </div>
          
          ${extraHtml}
          ${tierEstimatesHtml}
      </div>
    `;
  }
  container.style.display = "block";
  container.dataset.lastRenderedKey = cacheKey;
}

export function refreshCurrentRivenMetaStats() {
  let name = document.getElementById("rivenWeaponInput")?.value.trim();
  if (name && state.weaponMap) {
    const matchedKey = Object.keys(state.weaponMap).find(k => k.toLowerCase() === name.toLowerCase());
    if (matchedKey) {
      name = matchedKey;
      const data = state.weaponMap[name];
      renderMetaStats(name, data.t);
      renderMetaStats(name, data.t, "modal-meta-stats-container");
    }
  }
}

// Riven Market Index (Tendencias Globales) Variables
