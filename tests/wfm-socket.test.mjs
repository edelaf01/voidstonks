import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Contrato del socket de WFM.
 *
 * Comprobado contra wss://ws.warframe.market/socket: `subscribe/newOrders` responde
 * ":ok" y emite órdenes SIN token. Antes connect() exigía signIn y devolvía false sin
 * él, así que una sesión pública se quedaba sin precios en vivo por un requisito que
 * WFM no impone. Estos tests evitan que ese acoplamiento vuelva.
 */

const src = readFileSync(
    new URL("../deploy/js/services/market/wfm_socket.service.js", import.meta.url), "utf8");

/** Cuerpo de una función del módulo, por nombre. */
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
    // El patrón que rompía el modo público: cortar por falta de token.
    assert.ok(!/const token = getToken\(\);\s*\n\s*if \(!token\) return false;/.test(body),
        "connect() no debe abortar por no tener token");
});

test("la conexión se da por buena al abrir, no al autenticar", () => {
    const body = fnBody("connect");
    const openIdx = body.indexOf('addEventListener("open"');
    assert.notEqual(openIdx, -1, "debe haber handler de open");

    // done(true) tiene que estar dentro del handler de "open". Si solo apareciera en la
    // rama de signIn:ok, un token inválido dejaría la promesa en false y no habría watch.
    const openBlock = body.slice(openIdx);
    assert.match(openBlock, /done\(true\)/, "abrir el socket ya es éxito");
});

test("un signIn fallido no cancela la suscripción", () => {
    const body = fnBody("connect");
    // signIn:error puede marcar signedIn=false, pero no puede resolver la conexión a false.
    const errIdx = body.indexOf("SIGN_IN_ERR");
    if (errIdx !== -1) {
        const tail = body.slice(errIdx, errIdx + 200);
        assert.ok(!/done\(false\)/.test(tail),
            "el fallo de signIn no debe tumbar la conexión");
    }
});

test("crossplay va desactivado por defecto, al revés que WFM", () => {
    // El defecto de WFM es true. Con crossplay llegan órdenes de consola: un aviso de
    // "te han rebajado" por alguien con quien no puedes comerciar es ruido.
    assert.match(src, /crossplay = false/,
        "el defecto propio debe ser false, no heredar el de WFM");
});

test("el unsubscribe repite el payload exacto del subscribe", () => {
    // Lo exige la doc de WFM: si no coincide, la suscripción no se cancela. Verificado
    // contra el socket real (unsubscribe:ok). Reconstruir el objeto por separado en los
    // dos sitios es justo lo que acaba divergiendo.
    const subs = [...src.matchAll(/payload: (\w+)\s*\n/g)].map(m => m[1]);
    assert.ok(subs.length >= 2, "subscribe y unsubscribe deben mandar payload");
    assert.equal(new Set(subs).size, 1,
        "ambos deben mandar la MISMA variable de payload");
});

test("el socket solo conserva las rutas que se usan", () => {
    // El cambio de estado se retiró: sus rutas y el mapa de peticiones en vuelo se
    // fueron con él. Si vuelven sin usarse, son código muerto.
    for (const dead of ["STATUS_SET", "STATUS_EVENT", "setStatusWS"]) {
        assert.ok(!src.includes(dead), `${dead} debería haberse eliminado`);
    }
});
