import { test } from "node:test";
import assert from "node:assert/strict";
import { unidadTipografica } from "../deploy/js/utils/vision/ancla_rejilla.js";

const ZONA = { w: 1600, h: 900 };
const check = (x, y, lado = 30) => ({ x, y, w: lado, h: lado, area: Math.round(lado * lado * 0.35) });
const rejilla = (cols, filas, paso = 240, lado = 30, x0 = 100, y0 = 100) => {
    const out = [];
    for (let f = 0; f < filas; f++) for (let c = 0; c < cols; c++) out.push(check(x0 + c * paso, y0 + f * paso, lado));
    return out;
};

test("mide el lado y el paso de una rejilla de anclas", () => {
    const u = unidadTipografica(rejilla(5, 3), ZONA);
    assert.equal(Math.round(u.lado), 30);
    assert.equal(u.paso, 240);
    assert.equal(u.cols, 5);
});

test("el tamaño sale del frame, no de una fracción del alto", () => {
    const u = unidadTipografica(rejilla(5, 3, 163, 20), ZONA);
    assert.equal(Math.round(u.lado), 20);
    assert.equal(u.paso, 163);
});

test("el ruido de fondo que se repite pero no se alinea no vale", () => {
    const ruido = [];
    let s = 12345;
    for (let i = 0; i < 12; i++) {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        const x = 40 + (s % 1400);
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        ruido.push(check(x, 40 + (s % 800), 18));
    }
    assert.equal(unidadTipografica(ruido, ZONA), null);
});

test("una casilla no mide cuarenta anclas de ancho", () => {
    assert.equal(unidadTipografica(rejilla(4, 2, 900, 20), ZONA), null, "paso/lado = 45");
    assert.ok(unidadTipografica(rejilla(4, 2, 280, 20), ZONA), "paso/lado = 14 sí vale");
});

test("ni dos anclas de ancho", () => {
    assert.equal(unidadTipografica(rejilla(4, 2, 40, 20), ZONA), null, "paso/lado = 2");
});

test("solo se mira el tamaño DOMINANTE, no todos los que haya", () => {
    const dominante = rejilla(5, 3, 240, 30);
    const minoria = rejilla(3, 1, 60, 12, 50, 50);
    const u = unidadTipografica([...dominante, ...minoria], ZONA);
    assert.equal(Math.round(u.lado), 30, "gana el dominante, no la minoría alineada");
});

test("lo que no es un anillo no es un ancla", () => {
    const solidos = rejilla(5, 3).map((c) => ({ ...c, area: c.w * c.h }));
    assert.equal(unidadTipografica(solidos, ZONA), null);
});

test("con menos de tres anclas no se inventa nada", () => {
    assert.equal(unidadTipografica([check(10, 10), check(250, 10)], ZONA), null);
    assert.equal(unidadTipografica([], ZONA), null);
});
