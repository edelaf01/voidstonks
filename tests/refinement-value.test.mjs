import test from "node:test";
import assert from "node:assert/strict";
import { refinementValue, TRACE_COST, MIN_PLAT_PER_TRACE } from "../deploy/js/utils/inventory/refinement_value.js";

// a real relic: 1 rare (2 %), 2 uncommon (11 %), 3 common (25.33 %)
const RELIQUIA = [
    { name: "rara", chance: 2 },
    { name: "pc1", chance: 11 }, { name: "pc2", chance: 11 },
    { name: "c1", chance: 25.33 }, { name: "c2", chance: 25.33 }, { name: "c3", chance: 25.33 },
];
const precios = (p) => (d) => p[d.name] ?? 0;
const BARATA = { rara: 6, pc1: 8, pc2: 6, c1: 3, c2: 2, c3: 2 };
const CARA = { ...BARATA, rara: 60 };

test("con la dorada cara, refinar sale a cuenta", () => {
    const v = refinementValue(RELIQUIA, { squadSize: 4, valueOf: precios(CARA) });
    assert.ok(v.worth, "60p a un 2 % contra un 10 % tiene que salir a cuenta");
    assert.notEqual(v.best, "intact");
    assert.ok(v.gain > 0);
    assert.equal(v.traces, TRACE_COST[v.best]);
});

test("con la dorada barata, no", () => {
    const v = refinementValue(RELIQUIA, { squadSize: 4, valueOf: precios(BARATA) });
    assert.equal(v.worth, false, "gastar 100 vestigios por ~1p es ruido de precios");
    assert.ok(v.perTrace < MIN_PLAT_PER_TRACE);
});

test("el veredicto va por platino/vestigio, no por platino bruto", () => {
    const v = refinementValue(RELIQUIA, { squadSize: 4, valueOf: precios(CARA) });
    const esperado = (v.ev[v.best] - v.ev.intact) / TRACE_COST[v.best];
    assert.ok(Math.abs(v.perTrace - esperado) < 1e-9);
    assert.ok(v.ev.radiant > v.ev[v.best] || v.best === "radiant",
        "radiante da el EV más alto y aun así no siempre es el mejor destino de los vestigios");
});

test("el EV sube con el refinamiento cuando lo caro es la rara", () => {
    const { ev } = refinementValue(RELIQUIA, { squadSize: 4, valueOf: precios(CARA) });
    assert.ok(ev.intact < ev.exceptional);
    assert.ok(ev.exceptional < ev.flawless);
    assert.ok(ev.flawless < ev.radiant);
});

test("si lo que vale está en las comunes, refinar PIERDE platino", () => {
    const p = { rara: 1, pc1: 1, pc2: 1, c1: 40, c2: 40, c3: 40 };
    const { ev, worth } = refinementValue(RELIQUIA, { squadSize: 4, valueOf: precios(p) });
    assert.ok(ev.radiant < ev.intact, "25,33 % -> 16,67 % en comunes");
    assert.equal(worth, false);
});

test("sin precios no se inventa un veredicto", () => {
    assert.equal(refinementValue(RELIQUIA, { squadSize: 4 }), null, "sin valueOf");
    assert.equal(refinementValue([], { squadSize: 4, valueOf: () => 5 }), null);
    assert.equal(refinementValue(null, { squadSize: 4, valueOf: () => 5 }), null);
    assert.equal(refinementValue(RELIQUIA, { squadSize: 4, valueOf: () => 0 }), null,
        "catálogo de precios sin cargar: 0p en todo no es 'no compensa refinar', es 'no se sabe'");
});
