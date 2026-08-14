import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Reloj del servidor.
 *
 * Bug real: "TODO sale ROTATING" en bounties. Causa -> un primer sync fallido cacheaba
 * la promesa resuelta y el offset quedaba en 0 el resto de la sesión; con el reloj del
 * sistema desajustado, todos los contadores salían caducados sin recuperarse.
 */

const src = readFileSync(new URL("../deploy/js/services/server_clock.service.js", import.meta.url), "utf8");

test("un sync fallido NO se cachea: debe poder reintentar", () => {
    // El fallo antiguo: la promesa se cacheaba siempre, incluso si getServerTime fallaba.
    // Ahora, en cada rama de error, syncPromise vuelve a null para reintentar.
    assert.match(src, /if \(syncPromise && synced\) return syncPromise/,
        "solo se reutiliza la promesa cuando ya sincronizó");

    // Cada camino de fallo debe permitir reintento.
    const bad = src.match(/if \(!res\.ok\)[\s\S]*?\}/)[0];
    assert.match(bad, /syncPromise = null/, "un !res.ok debe permitir reintento");

    const cat = src.match(/catch \(e\)[\s\S]*?\}/)[0];
    assert.match(cat, /syncPromise = null/, "un throw debe permitir reintento");
});

test("solo se marca sincronizado tras medir el offset de verdad", () => {
    // synced=true no puede ponerse antes de tener el número del servidor.
    const okBlock = src.match(/globalThis\._serverTimeOffset = Date\.now\(\) - body\.now;[\s\S]{0,80}/)[0];
    assert.match(okBlock, /synced = true/, "synced se marca justo tras calcular el offset");
});

test("isClockSynced se exporta para el margen de seguridad", () => {
    // Bounties lo usa: sin reloj fiable, no marca ROTATING por un negativo pequeño.
    assert.match(src, /export function isClockSynced/);
    const bounties = readFileSync(
        new URL("../deploy/js/ui.components/farms/ui_bounties.js", import.meta.url), "utf8");
    assert.match(bounties, /isClockSynced\(\) \? 0 : /,
        "el margen debe ser 0 con reloj sincronizado, amplio sin él");
    assert.match(bounties, /diff <= -margin/, "el margen debe aplicarse al decidir ROTATING");
});

test("avisa por consola de un reloj muy desajustado", () => {
    // Para que el usuario pueda diagnosticar por qué veía todo caducado.
    assert.match(src, /Math\.abs\(globalThis\._serverTimeOffset\) > 60000/,
        "debe avisar si el desfase supera el minuto");
});
