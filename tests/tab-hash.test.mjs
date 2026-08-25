import test from "node:test";
import assert from "node:assert/strict";
import { tabFromHash } from "../deploy/js/utils/tab_hash.js";

const TABS = ["relic", "set", "riven", "lfg", "bounties", "vosfor", "ducat", "eelog", "orders"];

test("tabFromHash reconoce una pestaña con y sin almohadilla", () => {
    assert.equal(tabFromHash("#riven", TABS), "riven");
    assert.equal(tabFromHash("riven", TABS), "riven");
});

test("tabFromHash tolera mayúsculas y espacios: el hash lo escribe una persona", () => {
    assert.equal(tabFromHash("#RIVEN", TABS), "riven");
    assert.equal(tabFromHash("  #vosfor  ", TABS), "vosfor");
});

test("un hash que no es una pestaña devuelve null, no la app en blanco", () => {
    // Con una pestaña inventada switchTab escondería todos los #mode-* y no mostraría
    // ninguno: el mismo fallo que ya se cerró para el save de localStorage.
    assert.equal(tabFromHash("#loquesea", TABS), null);
    assert.equal(tabFromHash("#", TABS), null);
    assert.equal(tabFromHash("", TABS), null);
});

test("tabFromHash no rompe sin hash ni sin lista", () => {
    assert.equal(tabFromHash(null, TABS), null);
    assert.equal(tabFromHash(undefined, TABS), null);
    assert.equal(tabFromHash("#relic", undefined), null);
});
