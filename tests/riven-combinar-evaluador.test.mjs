import test from "node:test";
import assert from "node:assert/strict";

globalThis.localStorage = {
    getItem() { return null; },
    setItem() { }
};
globalThis.window = { localStorage: globalThis.localStorage };
globalThis.addEventListener = () => { };
globalThis.document = { querySelector() { return null; } };

const { evaluarCombinaciones, UMBRAL_COMBINAR } = await import("../deploy/js/utils/rivens/riven_cycling.js");
const { consejoCicloHtml } = await import("../deploy/js/ui.components/rivens/ui_riven_cycling.js");

const typeIdx = 0;

test("sin pesos no evalúa nada", () => {
    assert.deepEqual(evaluarCombinaciones({ stats: [], typeIdx, pesos: null }), []);
});

test("con pesos de stats desconocidos no evalúa nada", () => {
    assert.deepEqual(evaluarCombinaciones({ stats: [], typeIdx, pesos: { "Fake Stat": 1 } }), []);
});

test("quitar un negativo malo fundiéndolo con un positivo mejora la tirada", () => {
    const stats = [
        { name: "Critical Chance", value: -120, isPositive: false },
        { name: "Multishot", value: 120, isPositive: true },
        { name: "Fire Rate", value: 120, isPositive: true }
    ];
    const pesos = { "Critical Chance": 0.9, "Multishot": 0.8, "Fire Rate": 0.6, "Zoom": 0 };
    const res = evaluarCombinaciones({ stats, typeIdx, pesos, negOk: [] });
    const item = res.find((r) => r.receta.resultado === "Weak Point Critical Chance");
    assert.ok(item);
    assert.equal(item.quitaNegativo, "Critical Chance");
    assert.ok(item.delta > UMBRAL_COMBINAR);
    assert.equal(item.probPeor, 0);
});

test("fundir dos positivos fuertes empeora la tirada", () => {
    const stats = [
        { name: "Toxin", value: 90, isPositive: true },
        { name: "Heat", value: 90, isPositive: true },
        { name: "Fire Rate", value: 90, isPositive: true }
    ];
    const pesos = { "Toxin": 1.0, "Heat": 1.0, "Fire Rate": 0.1 };
    const res = evaluarCombinaciones({ stats, typeIdx, pesos });
    const item = res.find((r) => r.receta.resultado === "Gas");
    assert.ok(item);
    assert.ok(item.delta < 0);
    assert.equal(item.quitaNegativo, null);
});

test("las recetas salen de mejor a peor", () => {
    const stats = [
        { name: "Damage", value: 100, isPositive: true },
        { name: "Multishot", value: 100, isPositive: true },
        { name: "Status Chance", value: 100, isPositive: true }
    ];
    const pesos = { "Damage": 0.9, "Multishot": 0.5, "Status Chance": 0.1 };
    const res = evaluarCombinaciones({ stats, typeIdx, pesos });
    assert.ok(res.length >= 2);
    for (let i = 0; i < res.length - 1; i++) {
        assert.ok(res[i].delta >= res[i+1].delta);
    }
});

test("un riven que ya tiene un stat fundido no puede combinar", () => {
    const stats = [
        { name: "Gas", value: 100, isPositive: true },
        { name: "Toxin", value: 90, isPositive: true },
        { name: "Heat", value: 90, isPositive: true }
    ];
    const pesos = { "Toxin": 1.0, "Heat": 1.0, "Gas": 1.0 };
    const res = evaluarCombinaciones({ stats, typeIdx, pesos });
    assert.deepEqual(res, []);
});

test("el consejo de ciclo enseña las probabilidades si hay pesos y la lista si no", () => {
    const stats = [
        { name: "Critical Chance", value: -120, isPositive: false },
        { name: "Multishot", value: 120, isPositive: true },
        { name: "Fire Rate", value: 120, isPositive: true },
        { name: "Damage", value: 100, isPositive: true }
    ];
    const pesos = { "Critical Chance": 0.9, "Multishot": 0.8, "Fire Rate": 0.6, "Zoom": 0, "Damage": 0.7 };
    const args = { stats, rolls: 0, tipo: "Rifle", buscados: ["Critical Chance", "Multishot"], negOk: [], isEs: true, pesos };
    const html1 = consejoCicloHtml(args);
    assert.ok(html1.includes("Si combinas:"));
    assert.match(html1, /\d+% de /);
    assert.ok(!/mejora la tirada|empeora la tirada/.test(html1));
    
    args.pesos = null;
    const html2 = consejoCicloHtml(args);
    assert.ok(html2.includes("Este riven puede fundir:"));
});

test("fundir un negativo inofensivo con un positivo bueno empeora la tirada", () => {
    const stats = [
        { name: "Damage", value: 150, isPositive: true },
        { name: "Zoom", value: -40, isPositive: false },
        { name: "Fire Rate", value: 80, isPositive: true }
    ];
    const pesos = { "Damage": 0.9, "Zoom": 0.05, "Fire Rate": 0.6, "Critical Chance": 0.9, "Status Chance": 0.8 };
    const item = evaluarCombinaciones({ stats, typeIdx, pesos }).find((r) => r.receta.resultado === "Weak Point Damage");
    assert.ok(item);
    assert.equal(item.quitaNegativo, "Zoom");
    assert.ok(item.delta <= -UMBRAL_COMBINAR);
    assert.ok(item.probPeor > 0);
    assert.ok(item.despues < (0.9 + 0.05) / 2);
});
