import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * server clock; real bug: "ALL bounties show ROTATING"
 * cause: a failed initial sync cached the resolved promise leaving offset at 0 for the session; with a
 * skewed system clock, all timers showed expired without recovering
 */

const src = readFileSync(new URL("../deploy/js/services/server_clock.service.js", import.meta.url), "utf8");

test("un sync fallido NO se cachea: debe poder reintentar", () => {
    // the old bug: the promise was always cached, even if getServerTime failed; now each error branch resets
    // syncPromise to null to allow retries
    assert.match(src, /if \(syncPromise && synced\) return syncPromise/,
        "solo se reutiliza la promesa cuando ya sincronizó");

    const bad = src.match(/if \(!res\.ok\)[\s\S]*?\}/)[0];
    assert.match(bad, /syncPromise = null/, "un !res.ok debe permitir reintento");

    const cat = src.match(/catch \(e\)[\s\S]*?\}/)[0];
    assert.match(cat, /syncPromise = null/, "un throw debe permitir reintento");
});

test("solo se marca sincronizado tras medir el offset de verdad", () => {
    // synced=true cannot be set before receiving the server value
    const okBlock = src.match(/globalThis\._serverTimeOffset = Date\.now\(\) - body\.now;[\s\S]{0,80}/)[0];
    assert.match(okBlock, /synced = true/, "synced se marca justo tras calcular el offset");
});

test("isClockSynced se exporta para el margen de seguridad", () => {
    // bounties uses it: without a reliable clock, it avoids marking ROTATING on a small negative offset
    assert.match(src, /export function isClockSynced/);
    const bounties = readFileSync(
        new URL("../deploy/js/ui.components/farms/ui_bounties.js", import.meta.url), "utf8");
    assert.match(bounties, /isClockSynced\(\) \? 0 : /,
        "el margen debe ser 0 con reloj sincronizado, amplio sin él");
    assert.match(bounties, /diff <= -margin/, "el margen debe aplicarse al decidir ROTATING");
});

test("avisa por consola de un reloj muy desajustado", () => {
    // so the user can diagnose why everything appeared expired
    assert.match(src, /Math\.abs\(globalThis\._serverTimeOffset\) > 60000/,
        "debe avisar si el desfase supera el minuto");
});
