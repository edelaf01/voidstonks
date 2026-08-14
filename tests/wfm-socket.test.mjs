import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * WFM socket contract: verified against wss://ws.warframe.market/socket
 * subscribe/newOrders replies ":ok" and emits orders WITHOUT a token; previously connect() required signIn
 * and returned false without it
 * public sessions lost live prices due to an unneeded requirement; these tests prevent that coupling from
 * returning
 */

const src = readFileSync(
    new URL("../deploy/js/services/market/wfm_socket.service.js", import.meta.url), "utf8");

/** body of a module function by name */
function fnBody(name) {
    const start = src.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `falta ${name}`);
    let depth = 0, i = src.indexOf("{", start), j = i;
    while (j < src.length) {
        if (src[j] === "{") depth++;
        else if (src[j] === "}" && --depth === 0) break;
        j++;
    }
    return src.slice(i, j);
}

test("conectar no exige token: el mercado se escucha sin sesión", () => {
    const body = fnBody("connect");
    // the pattern that broke public mode: aborting on missing token
    assert.ok(!/const token = getToken\(\);\s*\n\s*if \(!token\) return false;/.test(body),
        "connect() no debe abortar por no tener token");
});

test("la conexión se da por buena al abrir, no al autenticar", () => {
    const body = fnBody("connect");
    const openIdx = body.indexOf('addEventListener("open"');
    assert.notEqual(openIdx, -1, "debe haber handler de open");

    // done(true) must be inside the "open" handler: if only in signIn:ok, an invalid token would leave the
    // promise at false and prevent watching
    const openBlock = body.slice(openIdx);
    assert.match(openBlock, /done\(true\)/, "abrir el socket ya es éxito");
});

test("un signIn fallido no cancela la suscripción", () => {
    const body = fnBody("connect");
    // signIn:error can set signedIn=false, but cannot resolve connection to false
    const errIdx = body.indexOf("SIGN_IN_ERR");
    if (errIdx !== -1) {
        const tail = body.slice(errIdx, errIdx + 200);
        assert.ok(!/done\(false\)/.test(tail),
            "el fallo de signIn no debe tumbar la conexión");
    }
});

test("crossplay va desactivado por defecto, al revés que WFM", () => {
    // WFM default is true; with crossplay console orders arrive: an undercut alert from someone you cannot
    // trade with is noise
    assert.match(src, /crossplay = false/,
        "el defecto propio debe ser false, no heredar el de WFM");
});

test("el unsubscribe repite el payload exacto del subscribe", () => {
    // required by WFM docs: if it does not match, subscription is not cancelled; verified against real socket
    // (unsubscribe:ok); rebuilding the object in two places causes divergence
    const subs = [...src.matchAll(/payload: (\w+)\s*\n/g)].map(m => m[1]);
    assert.ok(subs.length >= 2, "subscribe y unsubscribe deben mandar payload");
    assert.equal(new Set(subs).size, 1,
        "ambos deben mandar la MISMA variable de payload");
});

test("el socket solo conserva las rutas que se usan", () => {
    // status change was removed along with its routes and in-flight request map: returning unused would be
    // dead code
    for (const dead of ["STATUS_SET", "STATUS_EVENT", "setStatusWS"]) {
        assert.ok(!src.includes(dead), `${dead} debería haberse eliminado`);
    }
});
