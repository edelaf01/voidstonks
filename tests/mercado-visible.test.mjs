// Mercado de las tarjetas de órdenes según entran en pantalla (ui.components/market/ui_mercado_visible.js).
import { test } from "node:test";
import assert from "node:assert/strict";

const observadores = [];
class FakeIO {
    constructor(cb) { this.cb = cb; this.vistos = new Set(); observadores.push(this); }
    observe(t) { this.vistos.add(t); }
    unobserve(t) { this.vistos.delete(t); }
    disconnect() { this.vistos.clear(); }
    entra(...ts) { this.cb(ts.map((target) => ({ target, isIntersecting: true }))); }
}
const tarjeta = (slug) => ({ dataset: slug ? { slug } : {} });
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

const { mercadoAlVerse } = await import("../deploy/js/ui.components/market/ui_mercado_visible.js");

function conIO(fn) {
    return async () => {
        globalThis.IntersectionObserver = FakeIO;
        try { await fn(); } finally { delete globalThis.IntersectionObserver; }
    };
}

test("solo se pide lo que entra en pantalla, en una tanda por ráfaga", conIO(async () => {
    const tandas = [];
    const vigia = mercadoAlVerse(async (slugs) => { tandas.push(slugs); }, { esperaMs: 5 });
    const [a, b, c] = ["a", "b", "c"].map(tarjeta);
    vigia.observa([a, b, c, tarjeta(null)]);
    const io = observadores.at(-1);
    assert.equal(io.vistos.size, 3, "una tarjeta sin slug no se vigila");
    io.entra(a, b);
    await espera(20);
    assert.deepEqual(tandas, [["a", "b"]]);
    assert.ok(!io.vistos.has(a), "lo ya pedido deja de vigilarse");
    io.entra(c);
    await espera(20);
    assert.deepEqual(tandas, [["a", "b"], ["c"]]);
}));

// Dos tandas a la vez pueden caer en instancias distintas del worker, cada una con su propio límite hacia warframe.market.
test("las tandas van de una en una, y una que falla no corta las siguientes", conIO(async () => {
    const log = [];
    let suelta;
    const vigia = mercadoAlVerse(async (slugs) => {
        log.push(`empieza ${slugs}`);
        if (slugs[0] === "a") await new Promise((r) => { suelta = r; });
        if (slugs[0] === "b") throw new Error("red");
        log.push(`acaba ${slugs}`);
    }, { esperaMs: 1 });
    const [a, b, c] = ["a", "b", "c"].map(tarjeta);
    vigia.observa([a, b, c]);
    const io = observadores.at(-1);
    io.entra(a);
    await espera(10);
    io.entra(b);
    await espera(10);
    assert.deepEqual(log, ["empieza a"]);
    suelta();
    await espera(10);
    io.entra(c);
    await espera(10);
    assert.deepEqual(log, ["empieza a", "acaba a", "empieza b", "empieza c", "acaba c"]);
}));

test("repintar vigila solo las tarjetas nuevas; sin IntersectionObserver se pide todo", async () => {
    await conIO(async () => {
        const vigia = mercadoAlVerse(async () => {}, { esperaMs: 1 });
        vigia.observa([tarjeta("a")]);
        const io = observadores.at(-1);
        const nueva = tarjeta("b");
        vigia.observa([nueva]);
        assert.deepEqual([...io.vistos], [nueva]);
    })();

    const tandas = [];
    const sinIO = mercadoAlVerse(async (slugs) => { tandas.push(slugs); }, { esperaMs: 1 });
    sinIO.observa(["x", "y"].map(tarjeta));
    await espera(10);
    assert.deepEqual(tandas, [["x", "y"]]);
});
