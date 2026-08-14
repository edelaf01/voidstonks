import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(
    new URL("../deploy/js/services/market/wfm_socket.service.js", import.meta.url), "utf8");

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
    assert.ok(!/const token = getToken\(\);\s*\n\s*if \(!token\) return false;/.test(body),
        "connect() no debe abortar por no tener token");
});

test("la conexión se da por buena al abrir, no al autenticar", () => {
    const body = fnBody("connect");
    const openIdx = body.indexOf('addEventListener("open"');
    assert.notEqual(openIdx, -1, "debe haber handler de open");

    const openBlock = body.slice(openIdx);
    assert.match(openBlock, /done\(true\)/, "abrir el socket ya es éxito");
});

test("un signIn fallido no cancela la suscripción", () => {
    const body = fnBody("connect");
    const errIdx = body.indexOf("SIGN_IN_ERR");
    if (errIdx !== -1) {
        const tail = body.slice(errIdx, errIdx + 200);
        assert.ok(!/done\(false\)/.test(tail),
            "el fallo de signIn no debe tumbar la conexión");
    }
});

test("crossplay va desactivado por defecto, al revés que WFM", () => {
    assert.match(src, /crossplay = false/,
        "el defecto propio debe ser false, no heredar el de WFM");
});

test("el unsubscribe repite el payload exacto del subscribe", () => {
    // wfm requires matching payload or subscription is not cancelled: verified with real socket
    const subs = [...src.matchAll(/payload: (\w+)\s*\n/g)].map(m => m[1]);
    assert.ok(subs.length >= 2, "subscribe y unsubscribe deben mandar payload");
    assert.equal(new Set(subs).size, 1,
        "ambos deben mandar la MISMA variable de payload");
});

test("el socket solo conserva las rutas que se usan", () => {
    for (const dead of ["STATUS_SET", "STATUS_EVENT", "setStatusWS"]) {
        assert.ok(!src.includes(dead), `${dead} debería haberse eliminado`);
    }
});
