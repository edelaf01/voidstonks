// TESTS ADVERSARIOS DE LA TASACIÓN. No miden precisión (para eso está el MAPE del entrenamiento):
// comprueban PROPIEDADES que deben cumplirse siempre, con casos construidos para pillar al tasador
// en una contradicción lógica. Un fallo aquí es un bug, no un error de estimación.
//
// Las cuatro propiedades:
//   1. INVARIANCIA AL ORDEN  — permutar los stats no cambia el precio. Hoy se cumple porque las
//      features son dummies de presencia (`(pos1==s)|(pos2==s)|(pos3==s)` en ML_local.py), no
//      posicionales; el test lo fija para que nadie lo rompa al tocar el vector de features.
//   2. MONOTONICIDAD        — añadir un positivo bueno no puede BAJAR el precio.
//   3. MALDICIÓN            — una negativa que ataca un stat top debe bajarlo.
//   4. DOMINANCIA           — godroll > roll medio > trash de la misma arma.
//
// Se usan armas REALES de cache_datos_api.json: con armas inventadas se puede "aprobar" un tasador
// roto porque los pesos por arma y el macro de DE son justo lo que decide el resultado.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { optionalSource } from "./_helpers/optional-source.mjs";

globalThis.localStorage = { getItem: () => null, setItem: () => {} };
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ML_ROOT = path.resolve(__dirname, "../deploy/assets/ml");
globalThis.fetch = async (url) => {
  const f = path.join(ML_ROOT, path.basename(String(url).split("?")[0]));
  if (!fs.existsSync(f)) throw new Error(`File not found: ${f}`);
  return { ok: true, json: async () => JSON.parse(fs.readFileSync(f, "utf8")) };
};

const { state } = await import("../deploy/js/state.js");
const { calculateAdvancedPredictivePrice, calculateHybridTiers } =
  await import("../deploy/js/utils/rivens/riven_logic.js");
state.currentLang = "es";

const API_CACHE = path.resolve(__dirname, "../scripts-actu/ML-rivenvaluation/cache_datos_api.json");
const WEAPONS = path.resolve(__dirname, "../deploy/assets/json/cleaned_weapons.json");

// El cache está en .gitignore: en un clon no existe y estos tests salen en skip.
const { src: apiCacheSrc, missing: sinCache, test } = optionalSource(pathToFileURL(API_CACHE));
const apiMap = sinCache ? {} : JSON.parse(apiCacheSrc).api_map;
const catalogo = JSON.parse(fs.readFileSync(WEAPONS, "utf8"));
const dispoDe = new Map(catalogo.map(w => [String(w.name || "").toLowerCase(),
  Number(w.omegaAttenuation) || 1.0]));
const tipoDe = new Map(catalogo.map(w => [String(w.name || "").toLowerCase(), w.type || "Rifle"]));

const S = (n, v, pos = true) => ({ name: n, value: v, isPositive: pos, minIdeal: 50, maxIdeal: 150 });

function tasar(nombre, stats) {
  const w = { name: nombre, ...apiMap[nombre] };
  const tiers = calculateHybridTiers(w, null);
  const wd = { name: nombre, t: tipoDe.get(nombre.toLowerCase()) || "Rifle",
    disposition: dispoDe.get(nombre.toLowerCase()) || 1.0,
    dynamic_weights: w.dynamic_weights };
  return calculateAdvancedPredictivePrice(w, stats, tiers, 1.0, wd, null);
}

// Armas con datos suficientes para que la tasación no caiga a defaults globales.
const CANDIDATAS = Object.keys(apiMap).filter(n => {
  const w = apiMap[n];
  const re = w.de_rerolled || {};
  return (re.median > 0) && (re.pop || 0) >= 3 && (w.official_median > 0);
});

test("hay armas reales con datos suficientes para los adversarios", () => {
  assert.ok(CANDIDATAS.length >= 50,
    `se esperaban >=50 armas con macro fiable; hay ${CANDIDATAS.length}`);
});

// ---------------------------------------------------------------- 1. INVARIANCIA AL ORDEN
test("permutar el orden de los positivos NO cambia el precio", () => {
  const trio = [S("Critical Chance", 120), S("Critical Damage", 90), S("Multishot", 80)];
  const permutaciones = [
    [0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0],
  ];
  const fallos = [];
  for (const nombre of CANDIDATAS.slice(0, 60)) {
    const vistos = permutaciones.map(p => tasar(nombre, p.map(i => trio[i])).estimatedValue);
    const min = Math.min(...vistos), max = Math.max(...vistos);
    if (max !== min) fallos.push(`${nombre}: ${min}..${max}`);
  }
  assert.equal(fallos.length, 0,
    `el precio debe ser idéntico en las 6 permutaciones. Discrepan: ${fallos.slice(0, 5).join(" | ")}`);
});

test("permutar también es invariante con negativa presente", () => {
  const fallos = [];
  for (const nombre of CANDIDATAS.slice(0, 60)) {
    const a = tasar(nombre, [S("Critical Chance", 120), S("Multishot", 80), S("Zoom", 40, false)]);
    const b = tasar(nombre, [S("Multishot", 80), S("Critical Chance", 120), S("Zoom", 40, false)]);
    if (a.estimatedValue !== b.estimatedValue) {
      fallos.push(`${nombre}: ${a.estimatedValue} vs ${b.estimatedValue}`);
    }
  }
  assert.equal(fallos.length, 0,
    `la negativa no debe volver el precio sensible al orden. Discrepan: ${fallos.slice(0, 5).join(" | ")}`);
});

// ---------------------------------------------------------------- 2. MONOTONICIDAD
test("añadir un tercer positivo bueno Y BIEN ROLADO no baja el precio", () => {
  // OJO con la formulación: comparar "2 pos" contra "3 pos" a magnitudes distintas NO es un test de
  // monotonicidad. El score reparte 55% meta / 45% MAGNITUD y promedia por stat, así que un tercer
  // stat de tipo top pero rolado flojo BAJA la calidad media y con ella el precio — que es
  // justamente el comportamiento que se buscó al pasar el score de 85/15 a 55/45.
  // La propiedad real: con el tercer positivo rolado ALTO (no arrastra la media), no puede bajar.
  // Y el tercer stat debe ser útil EN ESA ARMA: Multishot no existe en melee (pesa 0.01 en Bo,
  // Karyst, Balla...), así que meterlo ahí es un stat inútil y el desplome es correcto. Se toma el
  // 3.º mejor positivo según los pesos del propio arma.
  const fallos = [];
  let evaluadas = 0;
  for (const nombre of CANDIDATAS.slice(0, 80)) {
    const dw = apiMap[nombre].dynamic_weights || {};
    const top = Object.entries(dw).map(([k, v]) => [k, parseFloat(v)])
      .filter(([, v]) => Number.isFinite(v)).sort((a, b) => b[1] - a[1]).slice(0, 3);
    if (top.length < 3 || top[2][1] < 0.5) continue;   // el 3.º debe ser realmente bueno
    evaluadas++;
    const dos = tasar(nombre, [S(top[0][0], 140), S(top[1][0], 140)]);
    const tres = tasar(nombre, [S(top[0][0], 140), S(top[1][0], 140), S(top[2][0], 140)]);
    if (tres.estimatedValue < dos.estimatedValue) {
      fallos.push(`${nombre}: 2pos=${dos.estimatedValue} > 3pos=${tres.estimatedValue}`);
    }
  }
  assert.ok(evaluadas >= 20, `hacen falta armas con 3 positivos buenos; hubo ${evaluadas}`);
  assert.equal(fallos.length, 0,
    `añadir el 3.º mejor stat del arma bien rolado no puede bajar el valor. ` +
    `Violan: ${fallos.slice(0, 6).join(" | ")}`);
});

test("subir la magnitud de un positivo no baja el precio", () => {
  const fallos = [];
  for (const nombre of CANDIDATAS.slice(0, 80)) {
    const flojo = tasar(nombre, [S("Critical Chance", 60), S("Critical Damage", 50)]);
    const fuerte = tasar(nombre, [S("Critical Chance", 160), S("Critical Damage", 140)]);
    if (fuerte.estimatedValue < flojo.estimatedValue) {
      fallos.push(`${nombre}: flojo=${flojo.estimatedValue} > fuerte=${fuerte.estimatedValue}`);
    }
  }
  assert.equal(fallos.length, 0,
    `más magnitud no puede valer menos. Violan: ${fallos.slice(0, 6).join(" | ")}`);
});

// ---------------------------------------------------------------- 3. MALDICIÓN
test("una negativa KILLER vale menos que una inocua", () => {
  // NO se comprueba "con negativa < sin negativa": en Warframe eso es FALSO y a propósito. Un riven
  // 3pos+maldición pertenece a un segmento más caro que uno 3pos limpio (medianas medidas 666p vs
  // 100p) porque implica menos rerolls gastados, así que añadir una negativa inocua SUBE el precio
  // (Corvas: 237 -> 285 con -Zoom, que pesa 0.01 en esa arma). Eso es mercado, no bug.
  // La propiedad que sí debe cumplirse: entre dos rivens del MISMO segmento, el que tiene la
  // negativa que ataca un stat TOP del arma debe valer menos que el de la negativa irrelevante.
  const fallos = [];
  let evaluadas = 0;
  for (const nombre of CANDIDATAS.slice(0, 80)) {
    const dw = apiMap[nombre].dynamic_weights || {};
    const orden = Object.entries(dw).map(([k, v]) => [k, parseFloat(v)])
      .filter(([, v]) => Number.isFinite(v)).sort((a, b) => b[1] - a[1]);
    if (orden.length < 8) continue;
    // negativa killer = el stat de mayor peso que NO esté entre los positivos del roll.
    const base = [S("Critical Chance", 120), S("Critical Damage", 90), S("Multishot", 80)];
    const usados = new Set(base.map(s => s.name.toLowerCase()));
    const killer = orden.find(([k, v]) => v >= 0.8 && !usados.has(k.toLowerCase()));
    const inocua = orden.slice().reverse().find(([k]) => !usados.has(k.toLowerCase()));
    if (!killer || !inocua || killer[0] === inocua[0]) continue;
    evaluadas++;
    const conKiller = tasar(nombre, [...base, S(killer[0], 60, false)]).estimatedValue;
    const conInocua = tasar(nombre, [...base, S(inocua[0], 60, false)]).estimatedValue;
    if (conKiller > conInocua) {
      fallos.push(`${nombre}: killer(${killer[0]})=${conKiller} > inocua(${inocua[0]})=${conInocua}`);
    }
  }
  assert.ok(evaluadas >= 20, `hacen falta armas evaluables; hubo ${evaluadas}`);
  assert.equal(fallos.length, 0,
    `la negativa que ataca un stat top debe penalizar más. Violan: ${fallos.slice(0, 6).join(" | ")}`);
});

// ---------------------------------------------------------------- 4. DOMINANCIA
test("godroll > roll medio > trash en la misma arma", () => {
  const fallos = [];
  for (const nombre of CANDIDATAS.slice(0, 80)) {
    const w = apiMap[nombre];
    const dw = w.dynamic_weights || {};
    // Los 3 mejores positivos del arma según SU peso, y los 2 peores como trash.
    const orden = Object.entries(dw)
      .map(([k, v]) => [k, parseFloat(v)])
      .filter(([, v]) => Number.isFinite(v))
      .sort((a, b) => b[1] - a[1]);
    if (orden.length < 8) continue;
    const top = orden.slice(0, 3).map(([k]) => k);
    const peor = orden.slice(-2).map(([k]) => k);

    const god = tasar(nombre, top.map(s => S(s, 155))).estimatedValue;
    const medio = tasar(nombre, [S(top[0], 90), S(peor[0], 60)]).estimatedValue;
    const trash = tasar(nombre, peor.map(s => S(s, 40))).estimatedValue;

    if (!(god >= medio && medio >= trash)) {
      fallos.push(`${nombre}: god=${god} medio=${medio} trash=${trash}`);
    }
  }
  assert.equal(fallos.length, 0,
    `debe cumplirse god>=medio>=trash. Violan: ${fallos.slice(0, 6).join(" | ")}`);
});

test("un godroll vale claramente más que un trash, no lo mismo", () => {
  // Un tasador que devuelve la mediana del arma para todo pasaría los tests de orden anteriores.
  // Este comprueba que la banda no está COLAPSADA: debe discriminar de verdad.
  let colapsadas = 0, evaluadas = 0;
  for (const nombre of CANDIDATAS.slice(0, 80)) {
    const w = apiMap[nombre];
    const orden = Object.entries(w.dynamic_weights || {})
      .map(([k, v]) => [k, parseFloat(v)])
      .filter(([, v]) => Number.isFinite(v))
      .sort((a, b) => b[1] - a[1]);
    if (orden.length < 8) continue;
    evaluadas++;
    const god = tasar(nombre, orden.slice(0, 3).map(([k]) => S(k, 155))).estimatedValue;
    const trash = tasar(nombre, orden.slice(-2).map(([k]) => S(k, 40))).estimatedValue;
    if (god < trash * 1.3) colapsadas++;
  }
  assert.ok(evaluadas >= 20, `hacen falta armas evaluables; hubo ${evaluadas}`);
  // Se tolera alguna: en armas con macro muy plano el clamp puede juntar los extremos.
  assert.ok(colapsadas <= evaluadas * 0.15,
    `la banda está colapsada en ${colapsadas}/${evaluadas} armas (godroll < 1.3× trash)`);
});
