// Explicaciones de las cifras de la ficha de un arma (tendencia, precio sin ciclar, techo…).
// Las lee tanto la ficha de meta-stats como el índice.

export const RIVEN_TOOLTIPS = {
  trend: {
    es: "Cuánto se mueve esta arma en el mercado, de 0 a 100. Se calcula con el volumen real de intercambios, no con las ofertas publicadas. Alto = hay gente comprando y vendiendo; bajo = arma olvidada, te costará colocarla.",
    en: "How much this weapon actually moves, from 0 to 100. Based on real trade volume, not on posted listings. High = people are buying and selling; low = forgotten weapon, hard to offload."
  },
  unrolled: {
    es: "Lo que se paga por un riven de esta arma SIN CICLAR (0 rerolls), según ventas reales registradas por Digital Extremes. Es el precio de entrada: lo que costaría comprarlo para rolarlo tú.",
    en: "What an UNROLLED riven for this weapon sells for (0 rerolls), from real sales recorded by Digital Extremes. This is the entry price: what it would cost you to buy one and roll it yourself."
  },
  rerolled: {
    es: "Precio mediano de ventas REALES de rivens ya ciclados de esta arma. Ojo: la mediana mezcla basura y godrolls, así que un roll bueno vale bastante más que este número y uno malo bastante menos.",
    en: "Median price of REAL completed sales for rolled rivens of this weapon. Note: the median mixes trash and godrolls, so a good roll is worth well above this number and a bad one well below."
  },
  max: {
    es: "Datos reales de Digital Extremes: el precio más alto que se ha pagado de verdad por un riven de esta arma. Es el techo de un godroll perfecto, no un precio al que puedas aspirar con un roll normal.",
    en: "Real Digital Extremes data: the highest price actually paid for a riven of this weapon. It is the ceiling for a perfect godroll, not a price you can expect for an average roll."
  },
  wfm: {
    es: "Media de lo que los vendedores PIDEN en Warframe.Market. No es lo que se paga: los precios pedidos están un orden de magnitud por encima de las ventas reales que publica Digital Extremes. Úsalo para ver la competencia, nunca para fijar tu precio.",
    en: "Average of what sellers ASK on Warframe.Market. It is not what gets paid: asking prices run an order of magnitude above the real sales Digital Extremes publishes. Use it to size up the competition, never to set your price."
  },
  potentialReal: {
    es: "Puntuación para comparar armas, no un precio: 1 = rolarla no gana nada. Sube con lo que se paga de más por un riven ya ciclado, con lo que varían las ventas, con el techo pagado por un godroll y con la popularidad. Solo usa ventas reales de Digital Extremes.",
    en: "A score to compare weapons, not a price: 1 = rolling gains nothing. It rises with the extra paid for a rolled riven, how much sales vary, the top price paid for a godroll and popularity. Uses real Digital Extremes sales only."
  },
  potentialWeb: {
    es: "La misma puntuación con lo que PIDEN en Warframe.Market: parte de cuántas veces el precio sin ciclar piden de media y pesa más cuantas más ofertas y popularidad tenga. Sale muy por encima de la real porque nadie paga el escaparate: dice hasta dónde aspira la gente, no lo que vas a cobrar.",
    en: "The same score from what sellers ASK on Warframe.Market: it starts from how many times the unrolled price they ask on average and weighs more with more listings and popularity. It runs far above the real one because nobody pays shop-window prices: it shows what people aim for, not what you will get."
  },
  potentialNA: {
    es: "No se puede calcular el potencial: Digital Extremes no publica ventas de esta variante, así que no hay precio base con el que comparar.",
    en: "Potential cannot be calculated: Digital Extremes publishes no sales for this variant, so there is no base price to compare against."
  },
  liquidity: {
    es: "De 0 a 100: lo rápido que se encuentra comprador para esta arma. Por debajo de 30 tendrás que bajar el precio o esperar semanas; por encima de 70 se coloca en días.",
    en: "From 0 to 100: how quickly a buyer turns up for this weapon. Below 30 you will have to cut the price or wait weeks; above 70 it moves in days."
  },
  reroll: {
    es: "Cuánto más se paga por un riven ya ciclado que por uno recién sacado. Si es alto, merece la pena rolar antes de vender; si es bajo, véndelo tal cual.",
    en: "How much more a rolled riven fetches versus a fresh one. If it is high, rolling before selling pays off; if it is low, sell it as is."
  },
  variation: {
    es: "Cuánto ha subido o bajado el precio oficial en los últimos 7 días.",
    en: "How much the official price has moved up or down over the last 7 days."
  }
};

export function getRivenTooltip(key, isEs) {
  const t = RIVEN_TOOLTIPS[key];
  return t ? (isEs ? t.es : t.en) : "";
}

// Cada métrica se llamaba distinto en el índice y en la ficha (Liquidez / Rapidez de venta,
// Reroll / Extra por ciclar, Volatilidad / Estabilidad para la misma medida).
const RIVEN_METRIC_NAMES = {
  trend: ["Popularidad", "Popularity"],
  liquidity: ["Rapidez de venta", "Sale speed"],
  reroll: ["Extra por ciclar", "Reroll markup"],
  risk: ["Riesgo", "Risk"],
  potentialReal: ["Potencial real", "Real potential"],
  potentialWeb: ["Potencial en WFM", "WFM potential"],
};

export function getRivenMetricName(key, isEs) {
  return RIVEN_METRIC_NAMES[key]?.[isEs ? 0 : 1] ?? "";
}
