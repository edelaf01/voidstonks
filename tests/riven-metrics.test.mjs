// Métricas de mercado de un arma (deploy/js/utils/rivens/riven_metrics.js).
//
// Visto en la auditoría de la pestaña Riven: la misma tarjeta decía "Volatilidad: ALTA" y
// "Riesgo: ESTABLE". Eran la misma medida (desviación / mediana, que el oráculo publica ×10 como
// volatility_index) con dos escalas: la de 0-1 ponía ALTA a 588 de 619 armas, y las 31 BAJA eran
// justo las que no tenían datos. Y sin desviación el riesgo decía "predecible y seguro".
import { test } from "node:test";
import assert from "node:assert/strict";
import { nivelVolatilidad, etiquetaVolatilidad, textoExtraPorCiclar } from "../deploy/js/utils/rivens/riven_metrics.js";

test("volatility_index se lee como 10 veces desviación / mediana", () => {
  assert.equal(nivelVolatilidad({ volatility_index: 4.9 }), "baja");
  assert.equal(nivelVolatilidad({ volatility_index: 5 }), "media");
  assert.equal(nivelVolatilidad({ volatility_index: 12 }), "media");
  assert.equal(nivelVolatilidad({ volatility_index: 18.9 }), "alta", "Braton: σ 90,88 sobre mediana 48");
});

test("sin volatility_index se calcula con la desviación y la mediana", () => {
  assert.equal(nivelVolatilidad({ official_median: 100, official_stddev: 40 }), "baja");
  assert.equal(nivelVolatilidad({ official_median: 48, official_stddev: 90.88 }), "alta");
});

// Una sola venta da desviación 0: no es un precio estable, es que no hay con qué medirlo.
test("sin ventas con las que medirlo no hay nivel, nunca 'estable'", () => {
  assert.equal(nivelVolatilidad({ volatility_index: 0, official_median: 48, official_stddev: 0 }), null);
  assert.equal(nivelVolatilidad({}), null);
  assert.equal(nivelVolatilidad(null), null);
});

test("cada nivel tiene su etiqueta de riesgo en los dos idiomas", () => {
  assert.equal(etiquetaVolatilidad("alta", true).riesgo, "EXTREMO");
  assert.equal(etiquetaVolatilidad("media", true).riesgo, "MODERADO");
  assert.equal(etiquetaVolatilidad("baja", false).riesgo, "STABLE");
  assert.equal(etiquetaVolatilidad("alta", true).color, etiquetaVolatilidad("alta", false).color);
});

test("sin nivel se pinta 'sin datos' en gris y con su propia explicación", () => {
  const es = etiquetaVolatilidad(null, true);
  assert.equal(es.riesgo, "SIN DATOS");
  assert.match(es.tooltip, /No hay ventas suficientes/);
  assert.equal(etiquetaVolatilidad(null, false).riesgo, "NO DATA");
  assert.notEqual(es.color, etiquetaVolatilidad("baja", true).color);
});

test("el extra por ciclar es el ratio ciclado / sin ciclar menos 1", () => {
  assert.equal(textoExtraPorCiclar(1.379, true), "+38%", "Burston: 404p ciclado sobre 293p sin ciclar");
  assert.equal(textoExtraPorCiclar(2.75, false), "+175%");
  assert.equal(textoExtraPorCiclar(1, true), "+0%");
  assert.equal(textoExtraPorCiclar(0.8, true), "-20%", "ciclado más barato que sin ciclar");
});

test("sin ratio el extra por ciclar dice que no hay datos, no +0%", () => {
  assert.equal(textoExtraPorCiclar(undefined, true), "sin datos");
  assert.equal(textoExtraPorCiclar(0, false), "no data");
  assert.equal(textoExtraPorCiclar(null, true), "sin datos");
});
