import test from "node:test";
import assert from "node:assert/strict";

const {
  posicionTirada,
  calidadStatEnArma,
  posicionEnBanda,
  nivelConfianza,
  tierDeScore,
  calculationBase,
  precioBaseDeArma,
  demandaDeArma,
  precioJusto,
} = await import("../deploy/js/utils/rivens/riven_tasacion_visual.js");

const {
  STAT_TIER_TOP,
  STAT_TIER_MID,
} = await import("../deploy/js/utils/rivens/riven_logic.js");

const {
  valorDelStat,
  textoDelStat,
} = await import("../deploy/js/utils/rivens/riven_stat_display.js");

test("posicionTirada devuelve null cuando valor, min o max son NaN o undefined, o cuando max es menor o igual a min", () => {
  assert.equal(posicionTirada({ valor: NaN, min: 0, max: 100 }), null);
  assert.equal(posicionTirada({ valor: 50, min: NaN, max: 100 }), null);
  assert.equal(posicionTirada({ valor: 50, min: 0, max: NaN }), null);
  assert.equal(posicionTirada({ valor: undefined, min: 0, max: 100 }), null);
  assert.equal(posicionTirada({ valor: 50, min: undefined, max: 100 }), null);
  assert.equal(posicionTirada({ valor: 50, min: 0, max: undefined }), null);
  assert.equal(posicionTirada({ valor: 50, min: 100, max: 100 }), null);
  assert.equal(posicionTirada({ valor: 50, min: 100, max: 50 }), null);
});

test("posicionTirada calcula u en extremos y limita valores fuera de rango", () => {
  assert.equal(posicionTirada({ valor: 100, min: 100, max: 200 }).u, 0);
  assert.equal(posicionTirada({ valor: 200, min: 100, max: 200 }).u, 1);
  assert.equal(posicionTirada({ valor: 50, min: 100, max: 200 }).u, 0);
  assert.equal(posicionTirada({ valor: 250, min: 100, max: 200 }).u, 1);
});

test("posicionTirada clasifica tramos en frontera 0 a 300 con cortes en un tercio y dos tercios", () => {
  assert.equal(posicionTirada({ valor: 99, min: 0, max: 300 }).nivel, "baja");
  assert.equal(posicionTirada({ valor: 100, min: 0, max: 300 }).nivel, "media");
  assert.equal(posicionTirada({ valor: 200, min: 0, max: 300 }).nivel, "alta");
  assert.equal(posicionTirada({ valor: 201, min: 0, max: 300 }).nivel, "alta");
});

test("posicionTirada invierte bondad en stats negativos donde magnitud minima es alta y maxima es baja", () => {
  const intermedio = posicionTirada({ valor: 50, min: 0, max: 100, isNeg: true });
  assert.equal(intermedio.bondad, 0.5);

  const minimo = posicionTirada({ valor: 0, min: 0, max: 100, isNeg: true });
  assert.equal(minimo.bondad, 1);
  assert.equal(minimo.nivel, "alta");

  const maximo = posicionTirada({ valor: 100, min: 0, max: 100, isNeg: true });
  assert.equal(maximo.bondad, 0);
  assert.equal(maximo.nivel, "baja");
});

test("posicionTirada aplica cortes especificos para fusionados positivos", () => {
  const f = posicionTirada({ valor: 50, min: 0, max: 100, fusionado: true });
  assert.deepEqual(f.cortes, [0.693, 0.874]);
  assert.equal(posicionTirada({ valor: 50, min: 0, max: 100, fusionado: true }).nivel, "baja");
  assert.equal(posicionTirada({ valor: 80, min: 0, max: 100, fusionado: true }).nivel, "media");
  assert.equal(posicionTirada({ valor: 90, min: 0, max: 100, fusionado: true }).nivel, "alta");
});

test("posicionTirada conserva cortes clasicos en fusionados negativos", () => {
  const fn = posicionTirada({ valor: 50, min: 0, max: 100, isNeg: true, fusionado: true });
  assert.deepEqual(fn.cortes, [1 / 3, 2 / 3]);
});

test("posicionTirada detecta valores fuera de rango segun escala y porcentaje de maximo", () => {
  assert.equal(posicionTirada({ valor: 0.941, min: 1, max: 2, escala: 1 }).fuera, null);
  assert.equal(posicionTirada({ valor: 0.939, min: 1, max: 2, escala: 1 }).fuera, "bajo");
  assert.equal(posicionTirada({ valor: 2.059, min: 1, max: 2, escala: 1 }).fuera, null);
  assert.equal(posicionTirada({ valor: 2.061, min: 1, max: 2, escala: 1 }).fuera, "alto");

  assert.equal(posicionTirada({ valor: 0.461, min: 1, max: 2, escala: 9 }).fuera, null);
  assert.equal(posicionTirada({ valor: 0.459, min: 1, max: 2, escala: 9 }).fuera, "bajo");
  assert.equal(posicionTirada({ valor: 2.539, min: 1, max: 2, escala: 9 }).fuera, null);
  assert.equal(posicionTirada({ valor: 2.541, min: 1, max: 2, escala: 9 }).fuera, "alto");

  assert.equal(posicionTirada({ valor: -9.9, min: 0, max: 1000, escala: 1 }).fuera, null);
  assert.equal(posicionTirada({ valor: -10.1, min: 0, max: 1000, escala: 1 }).fuera, "bajo");
  assert.equal(posicionTirada({ valor: 1009.9, min: 0, max: 1000, escala: 1 }).fuera, null);
  assert.equal(posicionTirada({ valor: 1010.1, min: 0, max: 1000, escala: 1 }).fuera, "alto");
});

test("calidadStatEnArma devuelve sindato cuando niveles es null o undefined pero preserva estimada", () => {
  assert.deepEqual(
    calidadStatEnArma({ nombre: "Critical Chance", isPositive: true, typeIdx: 0, niveles: null, generico: false }),
    { nivel: "sindato", estimada: false }
  );
  assert.deepEqual(
    calidadStatEnArma({ nombre: "Critical Chance", isPositive: true, typeIdx: 0, niveles: undefined, generico: true }),
    { nivel: "sindato", estimada: true }
  );
});

test("calidadStatEnArma clasifica positivos en listas de tiers como top, medio y flojo", () => {
  const niveles = { best: ["Critical Chance"], mid: ["Multishot"], meh: ["Zoom"] };
  assert.equal(calidadStatEnArma({ nombre: "Critical Chance", isPositive: true, typeIdx: 0, niveles }).nivel, "top");
  assert.equal(calidadStatEnArma({ nombre: "Multishot", isPositive: true, typeIdx: 0, niveles }).nivel, "medio");
  assert.equal(calidadStatEnArma({ nombre: "Zoom", isPositive: true, typeIdx: 0, niveles }).nivel, "flojo");
});

test("calidadStatEnArma clasifica positivos fuera de listas segun pesos y exclusion sinDato", () => {
  const sinDato = new Set(["impact damage"]);
  assert.equal(
    calidadStatEnArma({ nombre: "Impact Damage", isPositive: true, typeIdx: 0, niveles: {}, pesos: { "Impact Damage": 0.2 }, sinDato }).nivel,
    "sindato"
  );
  assert.equal(
    calidadStatEnArma({ nombre: "Impact Damage", isPositive: true, typeIdx: 0, niveles: {}, pesos: { "Impact Damage": STAT_TIER_MID - 0.05 } }).nivel,
    "flojo"
  );
  assert.equal(
    calidadStatEnArma({ nombre: "Impact Damage", isPositive: true, typeIdx: 0, niveles: {}, pesos: { "Impact Damage": STAT_TIER_TOP + 0.1 } }).nivel,
    "sindato"
  );
  assert.equal(
    calidadStatEnArma({ nombre: "Impact Damage", isPositive: true, typeIdx: 0, niveles: {}, pesos: {} }).nivel,
    "sindato"
  );
});

test("calidadStatEnArma clasifica negativos en listas de tiers como inofensiva, ruinosa y media", () => {
  const niveles = { bestNeg: ["Zoom"], worstNeg: ["Damage"], midNeg: ["Cold Damage"] };
  assert.equal(calidadStatEnArma({ nombre: "Zoom", isPositive: false, typeIdx: 0, niveles }).nivel, "inofensiva");
  assert.equal(calidadStatEnArma({ nombre: "Damage", isPositive: false, typeIdx: 0, niveles }).nivel, "ruinosa");
  assert.equal(calidadStatEnArma({ nombre: "Cold Damage", isPositive: false, typeIdx: 0, niveles }).nivel, "media");
});

test("calidadStatEnArma clasifica negativos fuera de listas por rangos de peso", () => {
  assert.equal(
    calidadStatEnArma({ nombre: "Recoil", isPositive: false, typeIdx: 0, niveles: {}, pesos: { "Recoil": STAT_TIER_TOP } }).nivel,
    "ruinosa"
  );
  assert.equal(
    calidadStatEnArma({ nombre: "Recoil", isPositive: false, typeIdx: 0, niveles: {}, pesos: { "Recoil": STAT_TIER_MID } }).nivel,
    "media"
  );
  assert.equal(
    calidadStatEnArma({ nombre: "Recoil", isPositive: false, typeIdx: 0, niveles: {}, pesos: { "Recoil": STAT_TIER_MID - 0.05 } }).nivel,
    "inofensiva"
  );
  assert.equal(
    calidadStatEnArma({ nombre: "Recoil", isPositive: false, typeIdx: 0, niveles: {}, pesos: {} }).nivel,
    "sindato"
  );
  assert.equal(
    calidadStatEnArma({ nombre: "Recoil", isPositive: false, typeIdx: 0, niveles: {}, pesos: { "Recoil": 0.1 }, sinDato: new Set(["recoil"]) }).nivel,
    "sindato"
  );
});

test("calidadStatEnArma da prioridad a las listas sobre los pesos tanto en positivos como en negativos", () => {
  assert.equal(
    calidadStatEnArma({ nombre: "Critical Chance", isPositive: true, typeIdx: 0, niveles: { best: ["Critical Chance"] }, pesos: { "Critical Chance": 0.01 } }).nivel,
    "top"
  );
  assert.equal(
    calidadStatEnArma({ nombre: "Zoom", isPositive: false, typeIdx: 0, niveles: { bestNeg: ["Zoom"] }, pesos: { "Zoom": 0.99 } }).nivel,
    "inofensiva"
  );
});

test("calidadStatEnArma normaliza nombres con guiones bajos para casar con nombres canonicos", () => {
  assert.equal(
    calidadStatEnArma({ nombre: "critical_chance", isPositive: true, typeIdx: 0, niveles: { best: ["Critical Chance"] } }).nivel,
    "top"
  );
});

test("calidadStatEnArma marca estimada cuando es generico o fusionado", () => {
  assert.equal(
    calidadStatEnArma({ nombre: "Critical Chance", isPositive: true, typeIdx: 0, niveles: {}, generico: true }).estimada,
    true
  );
  assert.equal(
    calidadStatEnArma({ nombre: "Gas", isPositive: true, typeIdx: 0, niveles: {}, generico: false }).estimada,
    true
  );
  assert.equal(
    calidadStatEnArma({ nombre: "Critical Chance", isPositive: true, typeIdx: 0, niveles: {}, generico: false }).estimada,
    false
  );
});

test("posicionEnBanda interpola logaritmicamente el precio justo dentro de la banda", () => {
  assert.equal(posicionEnBanda({ low: 100, fair: 200, high: 400 }), 0.5);
  assert.equal(posicionEnBanda({ low: 100, fair: 100, high: 400 }), 0);
  assert.equal(posicionEnBanda({ low: 100, fair: 400, high: 400 }), 1);
  assert.equal(posicionEnBanda({ low: 100, fair: 50, high: 400 }), 0);
  assert.equal(posicionEnBanda({ low: 100, fair: 800, high: 400 }), 1);
});

test("posicionEnBanda devuelve null ante valores invalidos no finitos o negativos", () => {
  assert.equal(posicionEnBanda({ low: NaN, fair: 200, high: 400 }), null);
  assert.equal(posicionEnBanda({ low: 100, fair: Infinity, high: 400 }), null);
  assert.equal(posicionEnBanda({ low: 100, fair: 200, high: NaN }), null);
  assert.equal(posicionEnBanda({ low: 0, fair: 200, high: 400 }), null);
  assert.equal(posicionEnBanda({ low: 100, fair: 0, high: 400 }), null);
  assert.equal(posicionEnBanda({ low: 100, fair: 200, high: 0 }), null);
  assert.equal(posicionEnBanda({ low: -10, fair: 200, high: 400 }), null);
  assert.equal(posicionEnBanda({ low: 400, fair: 200, high: 100 }), null);
  assert.equal(posicionEnBanda({ low: 200, fair: 200, high: 200 }), null);
});

test("nivelConfianza clasifica por mape y solo sin mape usa la confianza baja de la banda", () => {
  assert.equal(nivelConfianza({ mape: 10, confianza: "baja" }), "alta");
  assert.equal(nivelConfianza({ mape: 90, confianza: "alta" }), "baja");
  assert.equal(nivelConfianza({ mape: NaN, confianza: "baja" }), "baja");
  assert.equal(nivelConfianza({ mape: null, confianza: "baja" }), "baja");
  assert.equal(nivelConfianza({ mape: NaN, confianza: "alta" }), null);
  assert.equal(nivelConfianza({ mape: null, confianza: "alta" }), null);
  assert.equal(nivelConfianza({ mape: undefined }), null);
  assert.equal(nivelConfianza({ mape: 34.9 }), "alta");
  assert.equal(nivelConfianza({ mape: 35 }), "media");
  assert.equal(nivelConfianza({ mape: 69.9 }), "media");
  assert.equal(nivelConfianza({ mape: 70 }), "baja");
});

test("tierDeScore mapea cada rango numerico al escalafon y clase visual correspondiente", () => {
  assert.deepEqual(tierDeScore(98), { tier: "SSS", tierColor: "grade-s" });
  assert.deepEqual(tierDeScore(97.9), { tier: "S+", tierColor: "grade-s" });
  assert.deepEqual(tierDeScore(90), { tier: "S+", tierColor: "grade-s" });
  assert.deepEqual(tierDeScore(89.9), { tier: "S", tierColor: "grade-s" });
  assert.deepEqual(tierDeScore(80), { tier: "S", tierColor: "grade-s" });
  assert.deepEqual(tierDeScore(79.9), { tier: "A", tierColor: "grade-a" });
  assert.deepEqual(tierDeScore(60), { tier: "A", tierColor: "grade-a" });
  assert.deepEqual(tierDeScore(59.9), { tier: "B", tierColor: "grade-b" });
  assert.deepEqual(tierDeScore(40), { tier: "B", tierColor: "grade-b" });
  assert.deepEqual(tierDeScore(39.9), { tier: "C", tierColor: "grade-c" });
  assert.deepEqual(tierDeScore(0.1), { tier: "C", tierColor: "grade-c" });
  assert.deepEqual(tierDeScore(0), { tier: "F", tierColor: "grade-f" });
  assert.deepEqual(tierDeScore(-1), { tier: "F", tierColor: "grade-f" });
});

test("precioBaseDeArma prioriza mediana oficial sobre precio medio con suelo de cincuenta", () => {
  assert.deepEqual(
    precioBaseDeArma({ official_median: 250, official_avg_price: 150 }),
    { basePrice: 250, precioTipico: 250 }
  );
  assert.deepEqual(
    precioBaseDeArma({ official_median: 0, official_avg_price: 180 }),
    { basePrice: 180, precioTipico: 180 }
  );
  assert.deepEqual(
    precioBaseDeArma({ official_median: 0, official_avg_price: 0 }),
    { basePrice: 50, precioTipico: null }
  );
  assert.deepEqual(
    precioBaseDeArma(null),
    { basePrice: 50, precioTipico: null }
  );
  assert.deepEqual(
    precioBaseDeArma({ official_median: 30 }),
    { basePrice: 50, precioTipico: 30 }
  );
});

test("demandaDeArma devuelve porcentaje entero acotado entre uno y cien o null ante datos no numericos", () => {
  assert.equal(demandaDeArma(null), null);
  assert.equal(demandaDeArma({ popularity_pct: 0 }), null);
  assert.equal(demandaDeArma({ popularity_pct: -5 }), null);
  assert.equal(demandaDeArma({ popularity_pct: "abc" }), null);
  assert.equal(demandaDeArma({ popularity_pct: 63.6 }), 64);
  assert.equal(demandaDeArma({ popularity_pct: 140 }), 100);
  assert.equal(demandaDeArma({ popularity_pct: "57" }), 57);
});

test("valorDelStat formatea signos porcentajes multiplicadores y unidades segun el tipo de stat", () => {
  assert.equal(valorDelStat({ name: "Critical Chance", value: 120, isPositive: true }, 0), "+120%");
  assert.equal(valorDelStat({ name: "Critical Chance", value: 120, isPositive: false }, 0), "-120%");
  assert.equal(valorDelStat({ name: "Recoil", value: 30, isPositive: true }, 0), "-30%");
  assert.equal(valorDelStat({ name: "Recoil", value: 30, isPositive: false }, 0), "+30%");
  assert.equal(valorDelStat({ name: "Damage to Grineer", value: 59, isPositive: true }, 0), "x1.59");
  assert.equal(valorDelStat({ name: "Damage to Grineer", value: 41, isPositive: false }, 0), "x0.59");
  assert.equal(valorDelStat({ name: "Punch Through", value: 2.5, isPositive: true }, 0), "+2.5m");
  assert.equal(valorDelStat({ name: "Combo Duration", value: 5, isPositive: true }, 3), "+5s");
  assert.equal(valorDelStat({ name: "Initial Combo", value: 20, isPositive: true }, 3), "+20");
  assert.equal(textoDelStat({ name: "Punch Through", value: 2.5, isPositive: true }, 0), "+2.5m Punch Through");
});

test("precioJusto calcula pesoMl segun tramos de mape y asigna valor por defecto ante valores no numericos", () => {
  assert.equal(precioJusto({ heuristico: 100, ml: 100, mape: 29.9 }).pesoMl, 0.75);
  assert.equal(precioJusto({ heuristico: 100, ml: 100, mape: 30 }).pesoMl, 0.6);
  assert.equal(precioJusto({ heuristico: 100, ml: 100, mape: 59.9 }).pesoMl, 0.6);
  assert.equal(precioJusto({ heuristico: 100, ml: 100, mape: 60 }).pesoMl, 0.42);
  assert.equal(precioJusto({ heuristico: 100, ml: 100, mape: 99.9 }).pesoMl, 0.42);
  assert.equal(precioJusto({ heuristico: 100, ml: 100, mape: 100 }).pesoMl, 0.28);
  assert.equal(precioJusto({ heuristico: 100, ml: 100, mape: undefined }).pesoMl, 0.35);
  assert.equal(precioJusto({ heuristico: 100, ml: 100, mape: NaN }).pesoMl, 0.35);
});

test("precioJusto limita pesoMl a treinta centesimas ante confianza baja sin incrementar valores menores", () => {
  assert.equal(precioJusto({ heuristico: 100, ml: 100, mape: 20, confianza: "baja" }).pesoMl, 0.3);
  assert.equal(precioJusto({ heuristico: 100, ml: 100, mape: 100, confianza: "baja" }).pesoMl, 0.28);
});

test("precioJusto calcula media geometrica ponderada entre heuristico y ml con literales exactos", () => {
  const res = precioJusto({ heuristico: 100, ml: 400, mape: 20, puntuacion: 90, tipico: 1000 });
  assert.equal(res.pesoMl, 0.75);
  assert.equal(res.justo, 283);
});

test("precioJusto redondea la estimacion restante cuando heuristico o ml es cero", () => {
  assert.equal(precioJusto({ heuristico: 0, ml: 350.4, mape: 20 }).justo, 350);
  assert.equal(precioJusto({ heuristico: 0, ml: 350.6, mape: 20 }).justo, 351);
  assert.equal(precioJusto({ heuristico: 250.4, ml: 0, mape: 20 }).justo, 250);
  assert.equal(precioJusto({ heuristico: 250.6, ml: 0, mape: 20 }).justo, 251);
});

test("precioJusto aplica topes multiplicadores segun tramos de puntuacion sobre el precio tipico", () => {
  assert.equal(precioJusto({ heuristico: 5000, ml: 5000, tipico: 100, puntuacion: 84.9 }).justo, 220);
  assert.equal(precioJusto({ heuristico: 5000, ml: 5000, tipico: 100, puntuacion: 70 }).justo, 220);
  assert.equal(precioJusto({ heuristico: 5000, ml: 5000, tipico: 100, puntuacion: 69.9 }).justo, 160);
  assert.equal(precioJusto({ heuristico: 5000, ml: 5000, tipico: 100, puntuacion: 55 }).justo, 160);
  assert.equal(precioJusto({ heuristico: 5000, ml: 5000, tipico: 100, puntuacion: 54.9 }).justo, 130);
  assert.equal(precioJusto({ heuristico: 5000, ml: 5000, tipico: 100, puntuacion: 40 }).justo, 130);
  assert.equal(precioJusto({ heuristico: 5000, ml: 5000, tipico: 100, puntuacion: 39.9 }).justo, 115);
  assert.equal(precioJusto({ heuristico: 5000, ml: 5000, tipico: 100, puntuacion: 85 }).justo, 5000);
});

test("precioJusto toma ml como base de tope ante tipico nulo y evita recortar si ml tambien es cero", () => {
  assert.equal(precioJusto({ heuristico: 5000, ml: 100, puntuacion: 70, tipico: 0 }).justo, 220);
  assert.equal(precioJusto({ heuristico: 5000, ml: 100, puntuacion: 70, tipico: null }).justo, 220);
  assert.equal(precioJusto({ heuristico: 5000, ml: 0, puntuacion: 70, tipico: 0 }).justo, 5000);
  assert.equal(precioJusto({ heuristico: 5000, ml: 0, puntuacion: 70, tipico: null }).justo, 5000);
});

test("calculationBase devuelve null ante entradas vacias o medianas en cero", () => {
  assert.equal(calculationBase(null), null);
  assert.equal(calculationBase(undefined), null);
  assert.equal(calculationBase({}), null);
  assert.equal(calculationBase({ de_unrolled: { median: 0 }, official_median: 0 }), null);
});

test("calculationBase prioriza mediana de desrolados sobre mediana oficial", () => {
  assert.equal(
    calculationBase({
      de_unrolled: { median: 500, pop: 5 },
      official_median: 300,
      popularity_pct: 50,
    }),
    500
  );
  assert.equal(
    calculationBase({
      official_median: 300,
      popularity_pct: 50,
      de_unrolled: { pop: 5 },
    }),
    300
  );
});

test("calculationBase respeta mediana sin amortiguar cuando cumple popularidad y volumen minimos", () => {
  assert.equal(
    calculationBase({
      de_unrolled: { median: 1150, pop: 2 },
      de_rerolled: { pop: 1 },
      popularity_pct: 8,
    }),
    1150
  );
});

test("calculationBase amortigua por popularidad insuficiente o por volumen insuficiente", () => {
  assert.equal(
    calculationBase({
      de_unrolled: { median: 1150, pop: 2 },
      de_rerolled: { pop: 1 },
      popularity_pct: 7.9,
    }),
    300
  );
  assert.equal(
    calculationBase({
      de_unrolled: { median: 1150, pop: 2 },
      popularity_pct: 50,
    }),
    300
  );
});

test("calculationBase aplica umbral de ciento cincuenta en armas poco comerciadas", () => {
  assert.equal(
    calculationBase({ official_median: 150, popularity_pct: 0 }),
    150
  );
  assert.equal(
    calculationBase({ official_median: 151, popularity_pct: 0 }),
    150
  );
  assert.equal(
    calculationBase({ official_median: 170, popularity_pct: 0 }),
    153
  );
});

test("calculationBase redondea el resultado al entero mas cercano", () => {
  assert.equal(
    calculationBase({
      official_median: 120.6,
      popularity_pct: 50,
      de_unrolled: { pop: 5 },
    }),
    121
  );
});

test("precioBaseDeArma integra calculationBase cuando no hay medianas ni medias oficiales", () => {
  assert.deepEqual(
    precioBaseDeArma({
      official_median: 0,
      official_avg_price: 0,
      de_unrolled: { median: 400, pop: 1 },
    }),
    { basePrice: 188, precioTipico: 188 }
  );
});

test("precioBaseDeArma prioriza precio medio oficial sobre calculationBase", () => {
  assert.deepEqual(
    precioBaseDeArma({
      official_avg_price: 180,
      de_unrolled: { median: 400, pop: 1 },
    }),
    { basePrice: 180, precioTipico: 180 }
  );
});

test("precioBaseDeArma aplica suelo de cincuenta a basePrice preservando precioTipico menor", () => {
  assert.deepEqual(
    precioBaseDeArma({
      de_unrolled: { median: 30, pop: 5 },
      popularity_pct: 50,
    }),
    { basePrice: 50, precioTipico: 30 }
  );
});
