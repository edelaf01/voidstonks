// Selección de los dígitos del badge anclando en el checkmark.
//
// Sustituye a una cascada de filtros (brillo, forma, fila, banda) que juzgaba cada componente
// por sus propiedades AISLADAS y era inestable: medido, la misma captura a 2531x1412 y
// reescalada a 2560x1440 —un 1,1% de diferencia, con binarizaciones idénticas a simple vista—
// se quedaba con los dos "1" del badge en un caso y con un borrón de arte en el otro.
// Aquí se fijan las reglas geométricas puras; el efecto end-to-end (86/96 -> 94/96 sobre seis
// resoluciones) está en tests/scanner-reescalado.test.mjs y tests/badge-extract.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { digitosPorAncla } from "../deploy/js/utils/vision/badge_anchor.js";

const W = 190, H = 88;
// Geometría medida en la captura real: el checkmark ocupa ~0,34 del alto de la ventana y los
// dígitos comparten su centro vertical.
const caja = (minX, minY, w, h) => ({ minX, maxX: minX + w - 1, minY, maxY: minY + h - 1, width: w, height: h, area: w * h });
const CHECK = caja(10, 25, 30, 30);      // círculo: ancho ≈ alto
const DIGITO = caja(50, 27, 14, 26);     // a su derecha, mismo centro
const DIGITO2 = caja(68, 27, 14, 26);    // segundo dígito, pegado

test("elige el dígito que está a la derecha del checkmark", () => {
    assert.deepEqual(digitosPorAncla([CHECK, DIGITO], W, H), [1]);
});

test("no devuelve el propio checkmark", () => {
    // Leerlo como dígito es lo que producía "93" por un 3: el círculo puntúa ~0.48 contra "9".
    assert.ok(!digitosPorAncla([CHECK, DIGITO], W, H).includes(0));
});

test("encadena los dígitos contiguos de un número de dos cifras", () => {
    assert.deepEqual(digitosPorAncla([CHECK, DIGITO, DIGITO2], W, H), [1, 2]);
});

test("corta el número en el primer hueco grande", () => {
    // El arte del plano cae en la misma banda pero separado. Antes se pegaba al número
    // ("31" por un 3, medido en Ballistica Prime Blueprint).
    const arte = caja(140, 27, 6, 26);
    assert.deepEqual(digitosPorAncla([CHECK, DIGITO, arte], W, H), [1]);
});

test("descarta lo que está en otra banda vertical aunque tenga forma de dígito", () => {
    // Un trazo vertical del esquema del plano, con la firma de un "1", pero fuera de la fila
    // del badge. Con la banda a 0,55 se colaba y "5" se leía "58".
    const fuera = caja(50, 70, 8, 26);
    assert.deepEqual(digitosPorAncla([CHECK, fuera], W, H), []);
});

test("descarta lo que está a la IZQUIERDA del checkmark", () => {
    assert.deepEqual(digitosPorAncla([caja(2, 27, 6, 26), CHECK, DIGITO], W, H), [2]);
});

test("sin checkmark no hay badge", () => {
    // Una celda de un ítem no repetido no tiene badge: no debe inventarse una cantidad.
    assert.deepEqual(digitosPorAncla([DIGITO, DIGITO2], W, H), []);
    assert.deepEqual(digitosPorAncla([], W, H), []);
});

test("con checkmark pero nada a su derecha, tampoco", () => {
    assert.deepEqual(digitosPorAncla([CHECK], W, H), []);
});

test("el ancla es el cuadrado de MAYOR área, no el primero por la izquierda", () => {
    // A baja resolución el arte deja motas cuadradas a la izquierda del checkmark, y en OTRA
    // banda vertical: si se toma la primera como ancla, el número queda fuera de su banda y se
    // pierde el badge entero. Medido antes de la regla: el alto del ancla bailaba entre 0,20 y
    // 0,36 de la ventana a 1280x720, cuando el checkmark real está clavado en 0,34.
    const mota = caja(3, 55, 24, 24);
    assert.deepEqual(digitosPorAncla([mota, CHECK, DIGITO], W, H), [2]);
});

test("un componente demasiado bajo para ser dígito no entra", () => {
    // Menos del 40% del alto del checkmark: es un punto de arte, no una cifra.
    assert.deepEqual(digitosPorAncla([CHECK, caja(50, 34, 8, 10)], W, H), []);
});
