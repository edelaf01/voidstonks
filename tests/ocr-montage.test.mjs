// Apilar recortes en un canvas para leerlos de una sola pasada de OCR.
//
// Lo que hay que proteger es la CORRESPONDENCIA: si el montaje coloca una tira donde no toca,
// o el reparto asigna una línea al tramo equivocado, el escáner sigue leyendo bien pero mete
// cada nombre en la celda de al lado — un fallo que no se ve en el texto leído, solo en el
// inventario resultante.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeDocument, fakeCanvas } from "./_helpers/fake-canvas.mjs";

installFakeDocument();
const { montaTiras, repartePorTramos } = await import("../deploy/js/utils/vision/ocr_montage.js");

// Fuente con una franja de color distinta por fila: así se puede comprobar de qué parte del
// frame salió cada tira mirando un píxel.
const FILAS = [[200, 0, 0], [0, 200, 0], [0, 0, 200]];
const fuente = fakeCanvas(40, 60, (_x, y) => FILAS[Math.floor(y / 20)]);
const tresTiras = [
    { clave: "a", sx: 0, sy: 0, sw: 40, sh: 20 },
    { clave: "b", sx: 0, sy: 20, sw: 40, sh: 20 },
    { clave: "c", sx: 0, sy: 40, sw: 40, sh: 20 },
];

test("montaTiras apila en orden, con hueco y a escala", () => {
    const [m] = montaTiras(fuente, tresTiras, { escala: 2, hueco: 10 });
    assert.equal(m.canvas.width, 80);
    // 3 tiras de 40px de alto (20 x escala 2) + 2 huecos de 10.
    assert.equal(m.canvas.height, 3 * 40 + 2 * 10);
    assert.deepEqual(m.tramos, [
        { clave: "a", y: 0, h: 40 },
        { clave: "b", y: 50, h: 40 },
        { clave: "c", y: 100, h: 40 },
    ]);
});

test("montaTiras dibuja cada tira desde su sitio del frame", () => {
    const [m] = montaTiras(fuente, tresTiras, { escala: 2, hueco: 10 });
    assert.deepEqual(m.canvas.px(20, 20).slice(0, 3), [200, 0, 0], "la tira 'a' es la fila roja");
    assert.deepEqual(m.canvas.px(20, 70).slice(0, 3), [0, 200, 0], "la tira 'b' es la fila verde");
    assert.deepEqual(m.canvas.px(20, 120).slice(0, 3), [0, 0, 200], "la tira 'c' es la fila azul");
});

test("montaTiras pinta el hueco del color de fondo, no en blanco", () => {
    // Un salto a blanco entre tiras es un borde durísimo y la red de detección lo persigue.
    const [m] = montaTiras(fuente, tresTiras, { escala: 2, hueco: 10, fondo: "#0a0e16" });
    assert.deepEqual(m.canvas.px(20, 45).slice(0, 3), [10, 14, 22]);
});

test("montaTiras parte en varios montajes al pasarse de alto", () => {
    // 40 tiras de 200px reales x escala 2 = 400px cada una: 6000px de techo -> 15 por montaje.
    const muchas = Array.from({ length: 40 }, (_, i) =>
        ({ clave: `t${i}`, sx: 0, sy: 0, sw: 10, sh: 200 }));
    const montajes = montaTiras(fuente, muchas, { escala: 2, hueco: 0 });
    assert.equal(montajes.length, 3);
    assert.deepEqual(montajes.map((m) => m.tramos.length), [15, 15, 10]);
    for (const m of montajes) assert.ok(m.canvas.height <= 6000, `alto ${m.canvas.height}`);
    // Ninguna tira se pierde por el camino y el orden se respeta.
    assert.deepEqual(montajes.flatMap((m) => m.tramos.map((t) => t.clave)), muchas.map((t) => t.clave));
});

test("montaTiras sin tiras no crea ningún canvas", () => {
    assert.deepEqual(montaTiras(fuente, []), []);
    assert.deepEqual(montaTiras(fuente, null), []);
});

const tramos = [{ clave: "a", y: 0, h: 40 }, { clave: "b", y: 50, h: 40 }, { clave: "c", y: 100, h: 40 }];
const linea = (text, y, height = 12) => ({ text, box: { x: 0, y, width: 30, height } });

test("repartePorTramos asigna cada línea por el centro de su caja", () => {
    const reparto = repartePorTramos([linea("UNO", 4), linea("DOS", 60), linea("TRES", 110)], tramos);
    assert.deepEqual(reparto.get("a").map((l) => l.text), ["UNO"]);
    assert.deepEqual(reparto.get("b").map((l) => l.text), ["DOS"]);
    assert.deepEqual(reparto.get("c").map((l) => l.text), ["TRES"]);
});

test("repartePorTramos junta las dos líneas de un nombre partido", () => {
    const reparto = repartePorTramos([linea("ATLAS PRIME", 4), linea("BLUEPRINT", 22)], tramos);
    assert.deepEqual(reparto.get("a").map((l) => l.text), ["ATLAS PRIME", "BLUEPRINT"]);
    assert.deepEqual(reparto.get("b"), []);
});

test("repartePorTramos las devuelve ordenadas por Y aunque lleguen al revés", () => {
    const reparto = repartePorTramos([linea("BLUEPRINT", 22), linea("ATLAS PRIME", 4)], tramos);
    assert.deepEqual(reparto.get("a").map((l) => l.text), ["ATLAS PRIME", "BLUEPRINT"]);
});

test("repartePorTramos rescata la línea que cae en el hueco", () => {
    // La detección ensancha un poco sus cajas, así que la última línea de una tira asoma por
    // el borde: aquí 38-46, con el centro (42) ya dentro del hueco. Se va a la tira más
    // cercana ('a', a 2px) en vez de perderse.
    const reparto = repartePorTramos([linea("RECEIVER", 38, 8)], tramos);
    assert.deepEqual(reparto.get("a").map((l) => l.text), ["RECEIVER"]);
    assert.deepEqual(reparto.get("b"), []);
});

test("repartePorTramos deja vacíos los tramos sin texto", () => {
    const reparto = repartePorTramos([], tramos);
    assert.deepEqual([...reparto.keys()], ["a", "b", "c"]);
    assert.deepEqual([...reparto.values()], [[], [], []]);
});
