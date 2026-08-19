import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Capa de plataforma: base para empaquetar la app como escritorio.
 *
 * La regla que estos tests protegen: en la WEB no cambia nada. La capa es un añadido;
 * los módulos actuales siguen usando WORKER_URL. Solo en escritorio (cuando exista el
 * puente nativo) las rutas de credenciales dejan de pasar por el worker.
 */

const P = new URL("../deploy/", import.meta.url);
const src = readFileSync(new URL("js/utils/platform.js", P), "utf8");

// Se evalúa el módulo suelto (importa config.js, que arrastra otras cosas); para los
// tests de lógica pura basta con reimplementar la detección desde el fuente.
const mod = await import(new URL("js/utils/platform.js", P).href).catch(() => null);

test("el módulo carga sin depender del DOM ni de un servidor", async () => {
    assert.ok(mod, "platform.js debe poder importarse en Node");
    for (const fn of ["isDesktop", "platform", "apiCall", "isNativeRoute", "workerBase"]) {
        assert.equal(typeof mod[fn], "function", `debe exportar ${fn}()`);
    }
});

test("sin puente nativo, el entorno es 'web' (comportamiento actual)", () => {
    delete globalThis.__vsNative;
    assert.equal(mod.isDesktop(), false);
    assert.equal(mod.platform(), "web");
});

test("el puente nativo se detecta por su presencia, no por user-agent", () => {
    // El user-agent del WebView cambia entre versiones y plataformas; el puente solo
    // existe si lo inyecta el contenedor. Es la señal fiable.
    assert.ok(!/userAgent|navigator/.test(src), "no debe mirar el user-agent");

    globalThis.__vsNative = { version: "1", call: async () => ({}) };
    assert.equal(mod.isDesktop(), true);
    assert.equal(mod.platform(), "desktop");
    delete globalThis.__vsNative;
});

test("en web, ninguna ruta se desvía del worker", () => {
    delete globalThis.__vsNative;
    for (const t of ["wfm_login", "prices_batch", "fissures", "wfm_order_create"]) {
        assert.equal(mod.isNativeRoute(t), false,
            `en web ${t} debe ir al worker, como hoy`);
    }
});

test("en escritorio solo las credenciales evitan el worker", () => {
    globalThis.__vsNative = { version: "1", call: async () => ({}) };

    // Credenciales -> nativo, para que la contraseña no toque un servidor ajeno.
    for (const t of ["wfm_login", "wfm_logout", "wfm_my_orders", "wfm_order_create", "wfm_order_edit"]) {
        assert.equal(mod.isNativeRoute(t), true, `${t} debe ir por el puente nativo`);
    }
    // Datos públicos -> worker, incluso en escritorio: son compartidos y cacheados.
    for (const t of ["prices_batch", "fissures", "wfm_items", "riven", "prime_items_list"]) {
        assert.equal(mod.isNativeRoute(t), false, `${t} debe seguir yendo al worker`);
    }
    delete globalThis.__vsNative;
});

test("apiCall en web construye la misma URL que el código actual", async () => {
    delete globalThis.__vsNative;
    const calls = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (url, init) => { calls.push({ url, init }); return Promise.resolve({ ok: true }); };

    await mod.apiCall("prices_batch", { params: { q: "ash_prime_set" } });

    globalThis.fetch = realFetch;
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\?type=prices_batch&q=ash_prime_set$/,
        "debe seguir el patrón ?type=X&... del worker");
    assert.match(calls[0].url, /^https:\/\/api\.voidstonks\.com/,
        "en web apunta al worker de producción");
});

test("apiCall en escritorio delega en el puente para credenciales", async () => {
    let received = null;
    globalThis.__vsNative = {
        version: "1",
        call: async (type, opts) => { received = { type, opts }; return { ok: true, status: 200 }; }
    };

    await mod.apiCall("wfm_login", { method: "POST", body: { email: "a", password: "b" } });

    assert.equal(received.type, "wfm_login", "debe llamar al nativo, no al worker");
    assert.equal(received.opts.body.password, "b", "la credencial va al nativo, no a la red");
    delete globalThis.__vsNative;
});

test("no rompe nada existente: es un módulo aislado", () => {
    // La garantía de 'no toques lo que hay': ningún archivo actual importa esto todavía.
    // Se comprueba en un test aparte (import-graph) que el grafo sigue sano; aquí solo
    // se fija que platform.js no reexporta ni pisa WORKER_URL.
    assert.ok(!/export const WORKER_URL/.test(src),
        "no debe redefinir WORKER_URL: lo lee de config.js");
});
