import { test } from "node:test";
import assert from "node:assert/strict";
import { digitosPorAncla } from "../deploy/js/utils/vision/badge_anchor.js";

const W = 190, H = 88;
// checkmark is ~0.34 of window height and the digits share its vertical center
const caja = (minX, minY, w, h) => ({ minX, maxX: minX + w - 1, minY, maxY: minY + h - 1, width: w, height: h, area: w * h });
const CHECK = caja(10, 25, 30, 30);
const DIGITO = caja(50, 27, 14, 26);
const DIGITO2 = caja(68, 27, 14, 26);

test("elige el dígito que está a la derecha del checkmark", () => {
    assert.deepEqual(digitosPorAncla([CHECK, DIGITO], W, H), [1]);
});

test("no devuelve el propio checkmark", () => {
    assert.ok(!digitosPorAncla([CHECK, DIGITO], W, H).includes(0));
});

test("encadena los dígitos contiguos de un número de dos cifras", () => {
    assert.deepEqual(digitosPorAncla([CHECK, DIGITO, DIGITO2], W, H), [1, 2]);
});

test("corta el número en el primer hueco grande", () => {
    const arte = caja(140, 27, 6, 26);
    assert.deepEqual(digitosPorAncla([CHECK, DIGITO, arte], W, H), [1]);
});

test("descarta lo que está en otra banda vertical aunque tenga forma de dígito", () => {
    const fuera = caja(50, 70, 8, 26);
    assert.deepEqual(digitosPorAncla([CHECK, fuera], W, H), []);
});

test("descarta lo que está a la IZQUIERDA del checkmark", () => {
    assert.deepEqual(digitosPorAncla([caja(2, 27, 6, 26), CHECK, DIGITO], W, H), [2]);
});

test("sin checkmark no hay badge", () => {
    assert.deepEqual(digitosPorAncla([DIGITO, DIGITO2], W, H), []);
    assert.deepEqual(digitosPorAncla([], W, H), []);
});

test("con checkmark pero nada a su derecha, tampoco", () => {
    assert.deepEqual(digitosPorAncla([CHECK], W, H), []);
});

test("el ancla es el cuadrado de MAYOR área, no el primero por la izquierda", () => {
    const mota = caja(3, 55, 24, 24);
    assert.deepEqual(digitosPorAncla([mota, CHECK, DIGITO], W, H), [2]);
});

test("un componente demasiado bajo para ser dígito no entra", () => {
    assert.deepEqual(digitosPorAncla([CHECK, caja(50, 34, 8, 10)], W, H), []);
});
