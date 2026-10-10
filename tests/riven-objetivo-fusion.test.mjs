import { test } from "node:test";
import assert from "node:assert/strict";

const guardado = new Map();
globalThis.localStorage = {
    getItem: (k) => (guardado.has(k) ? guardado.get(k) : null),
    setItem: (k, v) => guardado.set(k, String(v)),
    removeItem: (k) => guardado.delete(k),
};
const CLAVE = "voidstonks_objetivo_fusion";
const RUTA = "../deploy/js/utils/rivens/riven_objetivo_fusion.js";
const { objetivoFusion, fijaObjetivoFusion, opcionesDeCartas, botonesDeCartas } = await import(RUTA);

test("lo guardado roto o que no es un objeto se trata como vacío", async () => {
    for (const roto of ["{no es json", "[3, 4]", "null"]) {
        guardado.set(CLAVE, roto);
        const modulo = await import(`${RUTA}?${encodeURIComponent(roto)}`);
        assert.equal(modulo.objetivoFusion("Rubico"), null, roto);
    }
    guardado.set(CLAVE, JSON.stringify({ Rubico: 3, Soma: 999, Braton: "3" }));
    const modulo = await import(`${RUTA}?valido`);
    assert.equal(modulo.objetivoFusion("Rubico"), 3);
    assert.equal(modulo.objetivoFusion("Soma"), null, "un índice que no es una receta no vale");
    assert.equal(modulo.objetivoFusion("Braton"), null, "un índice en texto no vale");
    assert.equal(modulo.objetivoFusion(""), null);
    guardado.clear();
});

test("el objetivo se fija por arma, se quita con null y se guarda", () => {
    assert.equal(fijaObjetivoFusion("Rubico", 3), 3);
    assert.equal(objetivoFusion("Rubico"), 3);
    assert.deepEqual(JSON.parse(guardado.get(CLAVE)), { Rubico: 3 });
    assert.equal(fijaObjetivoFusion("Rubico", null), null);
    assert.equal(objetivoFusion("Rubico"), null);
    assert.equal(fijaObjetivoFusion("Rubico", 999), null, "un índice fuera de las recetas lo quita");
    assert.equal(fijaObjetivoFusion("Rubico", "3"), null);
    assert.equal(fijaObjetivoFusion("", 3), null);
    assert.equal(fijaObjetivoFusion(null, 3), null);
    assert.deepEqual(JSON.parse(guardado.get(CLAVE)), {});
});

test("como mucho 60 armas: se olvida la que lleva más tiempo sin tocar", () => {
    for (let i = 0; i < 60; i++) fijaObjetivoFusion(`Arma${i}`, i % 5);
    fijaObjetivoFusion("Arma0", 1);
    fijaObjetivoFusion("Nueva", 2);
    const datos = JSON.parse(guardado.get(CLAVE));
    assert.equal(Object.keys(datos).length, 60);
    assert.equal(datos.Arma1, undefined, "la más vieja sale");
    assert.equal(datos.Arma0, 1, "volver a fijarla la refresca");
    assert.equal(objetivoFusion("Nueva"), 2);
});

test("si no se puede guardar el objetivo sigue fijado en esta sesión", (t) => {
    const setItem = globalThis.localStorage.setItem;
    globalThis.localStorage.setItem = () => { throw new Error("lleno"); };
    t.mock.method(console, "warn", () => {});
    try {
        assert.equal(fijaObjetivoFusion("Kuva Bramma", 4), 4);
        assert.equal(objetivoFusion("Kuva Bramma"), 4);
        assert.equal(console.warn.mock.callCount(), 1);
    } finally {
        globalThis.localStorage.setItem = setItem;
    }
});

const op = (indice, nombre, estado, extra = {}) => ({ indice, nombre, texto: `${nombre} = A + B`, estado, falta: null, recomendada: false, ...extra });

test("con varias cartas cada combinado toma el mejor estado y solo dice qué falta si es lo mismo en todas", () => {
    const actual = { objetivo: 3, opciones: [op(0, "Gas", "falta", { falta: "Heat" }), op(1, "Corrosivo", "lista"), op(3, "Radiación", "falta", { falta: "Heat" }), op(6, "Orokin", "otra")] };
    const nuevo = { objetivo: 3, opciones: [op(0, "Gas", "falta", { falta: "Toxin" }), op(1, "Corrosivo", "otra"), op(3, "Radiación", "falta", { falta: "Heat", recomendada: true }), op(6, "Orokin", "otra")] };
    const juntas = opcionesDeCartas([actual, null, { opciones: [] }, nuevo]);
    assert.deepEqual(juntas.map((o) => [o.indice, o.estado, o.falta, o.activo, o.recomendada]), [
        [0, "falta", null, false, false],
        [1, "lista", null, false, false],
        [3, "falta", "Heat", true, true],
        [6, "otra", null, false, false],
    ]);
    assert.deepEqual(opcionesDeCartas(null), []);
    assert.deepEqual(opcionesDeCartas([null, { opciones: [] }]), []);
});

test("los botones van listos primero, sin los lejanos salvo el elegido y uno por nombre", () => {
    const carta = { objetivo: 9, opciones: [
        op(6, "Orokin", "otra"), op(9, "Daño PD", "otra"), op(10, "Daño PD", "falta"),
        op(2, "Viral", "falta"), op(1, "Corrosivo", "lista"), op(13, "Munición", "falta"), op(14, "Munición", "lista"),
    ] };
    assert.deepEqual(botonesDeCartas([carta]).map((o) => [o.indice, o.activo]), [
        [1, false], [14, false], [2, false], [9, true],
    ]);
    assert.deepEqual(botonesDeCartas([{ ...carta, objetivo: null }]).map((o) => o.indice), [1, 14, 2, 10]);
    assert.deepEqual(botonesDeCartas([]), []);
});
