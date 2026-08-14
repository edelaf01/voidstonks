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
  potential: {
    es: "Cuánto margen de revalorización tiene este riven: cruza el hueco con los precios pedidos, el premium por ciclar y el techo de godroll del arma.",
    en: "How much revaluation headroom this riven has: combines the gap to asking prices, the reroll premium and the weapon godroll ceiling."
  },
  potentialNA: {
    es: "No se puede calcular el potencial: Digital Extremes no publica ventas de esta variante, así que no hay precio base con el que comparar.",
    en: "Potential cannot be calculated: Digital Extremes publishes no sales for this variant, so there is no base price to compare against."
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
