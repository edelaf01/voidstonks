import test from "node:test";
import assert from "node:assert/strict";
import {
    INDEX_FILTER_DEFAULTS,
    applyIndexFilters,
    hasMarketData,
    isBaseWeapon,
    normalizeIndexFilters,
    observedTypes,
    realPrice,
    whyIndexEmpty,
} from "../deploy/js/utils/rivens/riven_index_filter.js";

/**
 * Filtros del índice de rivens.
 *
 * El índice listaba TODAS las armas conocidas, rellenando de ceros las que no tienen mercado,
 * y solo se podía reordenar. Lo que fijan estos tests es que filtrar no pueda mentir: que un
 * tope de precio no cuele lo que no se sabe cuánto vale, y que un vacío diga qué filtro lo
 * causó en vez de dejar al usuario probando a ciegas.
 */

const WEAPONS = {
    Bramma: { d: 0.75, t: "Bow" },
    Torid: { d: 1.35, t: "Rifle" },
    Kronen: { d: 1.0, t: "Melee" },
    Sydon: { d: 1.2, t: "Melee" },
};

const con = (median, extra = {}) => ({ de_unrolled: { median }, ...extra });

const ENTRIES = [
    ["Bramma", con(400, { liquidity_score: 90 })],
    ["Torid", con(60, { liquidity_score: 40 })],
    ["Kronen", con(120, { liquidity_score: 10 })],
    // Arma sin mercado: entra en el índice para poder buscarla, con todo a cero.
    ["Sydon", { official_median: 0, popularity_pct: 0, wfm_avg_price: 0 }],
];

const nombres = (res) => res.map(([n]) => n);

test("sin filtros no se toca la lista", () => {
    assert.deepEqual(nombres(applyIndexFilters(ENTRIES, INDEX_FILTER_DEFAULTS, WEAPONS)), [
        "Bramma", "Torid", "Kronen", "Sydon",
    ]);
});

test("el tope de precio deja fuera lo que no tiene precio conocido", () => {
    // Sydon no vale "0 p": es que no se sabe. Colarla en "hasta 200 p" es lo contrario de
    // lo que se ha pedido, y era el fallo que tenía el índice al invertir el orden.
    const res = applyIndexFilters(ENTRIES, { ...INDEX_FILTER_DEFAULTS, maxPrice: 200 }, WEAPONS);
    assert.deepEqual(nombres(res), ["Torid", "Kronen"]);
});

test("el precio del filtro es el que se paga, no el que se pide", () => {
    // Un arma con mediana real baja y petición alta en WFM tiene que colarse en "hasta 100 p":
    // el tope habla de lo que te va a costar de verdad.
    assert.equal(realPrice({ de_unrolled: { median: 80 }, wfm_avg_price: 900 }), 80);
    // Sin mediana de ventas cerradas se cae a la media oficial, y solo entonces a avg_price.
    assert.equal(realPrice({ official_median: 50, official_avg_price: 70 }), 50);
    assert.equal(realPrice({ official_avg_price: 70 }), 70);
    assert.equal(realPrice(undefined), 0);
});

test("«solo con datos de mercado» quita las armas rellenas de ceros", () => {
    const res = applyIndexFilters(ENTRIES, { ...INDEX_FILTER_DEFAULTS, withData: true }, WEAPONS);
    assert.deepEqual(nombres(res), ["Bramma", "Torid", "Kronen"]);
    assert.equal(hasMarketData(undefined), false);
    // Basta CUALQUIER señal: liquidez sin precio sigue siendo un mercado observado.
    assert.equal(hasMarketData({ liquidity_score: 5 }), true);
});

test("disposición alta y baja no se solapan", () => {
    const alta = applyIndexFilters(ENTRIES, { ...INDEX_FILTER_DEFAULTS, dispo: "high" }, WEAPONS);
    const baja = applyIndexFilters(ENTRIES, { ...INDEX_FILTER_DEFAULTS, dispo: "low" }, WEAPONS);
    assert.deepEqual(nombres(alta), ["Torid", "Sydon"]);
    assert.deepEqual(nombres(baja), ["Bramma"]);
});

test("un arma sin entrada en weaponMap no se cuela en ningún filtro de arma", () => {
    const entries = [...ENTRIES, ["Desconocida", con(10)]];
    assert.equal(nombres(applyIndexFilters(entries, { ...INDEX_FILTER_DEFAULTS, dispo: "high" }, WEAPONS)).includes("Desconocida"), false);
    assert.equal(nombres(applyIndexFilters(entries, { ...INDEX_FILTER_DEFAULTS, type: "Melee" }, WEAPONS)).includes("Desconocida"), false);
});

test("los filtros se acumulan", () => {
    const res = applyIndexFilters(
        ENTRIES, { ...INDEX_FILTER_DEFAULTS, type: "Melee", maxPrice: 200 }, WEAPONS);
    assert.deepEqual(nombres(res), ["Kronen"]);
});

test("el vacío dice qué filtro lo causó y cuántas hay detrás", () => {
    const prefs = { ...INDEX_FILTER_DEFAULTS, type: "Bow", maxPrice: 50 };
    assert.deepEqual(applyIndexFilters(ENTRIES, prefs, WEAPONS), []);
    const motivo = whyIndexEmpty(ENTRIES, prefs, WEAPONS);
    // Soltando el tope aparece Bramma (400 p), así que el culpable es maxPrice.
    assert.equal(motivo.key, "maxPrice");
    assert.equal(motivo.count, 1);
});

test("si el vacío no lo causa un filtro, no se culpa a ninguno", () => {
    assert.equal(whyIndexEmpty([], INDEX_FILTER_DEFAULTS, WEAPONS), null);
    // Con dos filtros puestos pero ninguno recuperable, tampoco se inventa un culpable.
    const imposible = { ...INDEX_FILTER_DEFAULTS, type: "Bow", dispo: "high" };
    assert.equal(whyIndexEmpty([], imposible, WEAPONS), null);
});

test("las preferencias guardadas se sanean antes de filtrar", () => {
    // Un maxPrice vacío llegaba como NaN: toda comparación daba false y la lista salía vacía
    // sin que nada lo explicase. Es el tropiezo que ya tuvieron las rutas.
    const p = normalizeIndexFilters({ maxPrice: Number.NaN, dispo: "sí", type: "Inventado", withData: "1" }, ["Bow"]);
    assert.deepEqual(p, INDEX_FILTER_DEFAULTS);
    assert.deepEqual(normalizeIndexFilters(null, []), INDEX_FILTER_DEFAULTS);
    assert.equal(normalizeIndexFilters({ maxPrice: -5 }, []).maxPrice, 0);
    assert.equal(normalizeIndexFilters({ type: "Bow" }, ["Bow"]).type, "Bow");
});

test("el desplegable de tipos sale de los datos, no de una lista fija", () => {
    assert.deepEqual(observedTypes(Object.keys(WEAPONS), WEAPONS), ["Bow", "Melee", "Rifle"]);
    // Un arma sin tipo conocido no añade un hueco al desplegable.
    assert.deepEqual(observedTypes(["Fantasma"], WEAPONS), []);
});

test("el arma base de la familia se distingue de sus variantes", () => {
    // El índice enseña UNA tarjeta por familia; sin esto salían Boltor, Boltor Prime y Telos
    // Boltor como tres entradas sueltas.
    assert.equal(isBaseWeapon("Boltor"), true);
    assert.equal(isBaseWeapon("Boltor Prime"), false);
    assert.equal(isBaseWeapon("Telos Boltor"), false);
    // El guion cuenta como separador: "MK1-Braton" es variante, no otra arma.
    assert.equal(isBaseWeapon("MK1-Braton"), false);
    // Un prefijo que solo COINCIDE al principio de otra palabra no convierte en variante:
    // "Dexterity" empieza por "dex" pero no es "Dex <algo>".
    assert.equal(isBaseWeapon("Dexterity"), true);
    assert.equal(isBaseWeapon(""), true);
    assert.equal(isBaseWeapon(undefined), true);
});
