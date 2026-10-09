import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installFakeDocument, FakeCanvas } from "./_helpers/fake-canvas.mjs";
import { decodePng } from "./_helpers/png.mjs";

installFakeDocument();
const { firmaDePagina, mismaPagina } = await import("../deploy/js/utils/vision/firma_pagina.js");

const img = decodePng(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "_fixtures/inventory_arcanes_1920x1080.png")));
const W = img.width, H = img.height;
const lienzo = (cambia) => {
    const data = new Uint8ClampedArray(img.data);
    cambia?.(data);
    const cvs = new FakeCanvas(W, H);
    cvs.getContext("2d").putImageData({ width: W, height: H, data }, 0, 0);
    return cvs;
};
const ZONA = { x: 0, y: 0 };
const rejillaA = () => ({ gridX: 70, gridY: 182, cellW: 207, cellH: 222, cols: 6, rows: 4 });
const rejillaB = () => ({ gridX: 70, gridY: 190, cellW: 207, cellH: 222, cols: 6, rows: 4 });
const base = lienzo();
const bajada = lienzo((d) => d.copyWithin(0, 60 * W * 4));

test("sin página vista no hay nada que reconocer", () => {
    assert.equal(mismaPagina(null, firmaDePagina(base, null, rejillaA(), ZONA, W, H), base, null, ZONA, W, H), false);
});

test("sin rejilla o sin zona la firma es la muestra de luma tal cual", () => {
    const m = new Uint8Array(48 * 108);
    const f1 = firmaDePagina(base, m, null, ZONA, W, H);
    assert.equal(f1.rejilla, null);
    assert.equal(f1.datos, m);
    const f2 = firmaDePagina(base, m, rejillaA(), false, W, H);
    assert.equal(f2.rejilla, null);
    assert.equal(f2.datos, m);
});

test("con la misma rejilla, la misma página es la misma y la bajada es otra", () => {
    const r = rejillaA();
    const vista = firmaDePagina(base, null, r, ZONA, W, H);
    assert.equal(mismaPagina(vista, firmaDePagina(base, null, r, ZONA, W, H), base, null, ZONA, W, H), true);
    assert.equal(mismaPagina(vista, firmaDePagina(bajada, null, r, ZONA, W, H), bajada, null, ZONA, W, H), false);
});

test("la rejilla re-detectada sobre la misma página no la hace otra", () => {
    const vista = firmaDePagina(base, null, rejillaA(), ZONA, W, H);
    const rb = rejillaB();
    const actual = firmaDePagina(base, null, rb, ZONA, W, H);
    assert.equal(actual.rejilla, rb);
    assert.equal(mismaPagina(vista, actual, base, null, ZONA, W, H), true);
});

test("con la rejilla re-detectada, una página distinta sigue siendo otra", () => {
    const vista = firmaDePagina(base, null, rejillaA(), ZONA, W, H);
    const actual = firmaDePagina(bajada, null, rejillaB(), ZONA, W, H);
    assert.equal(mismaPagina(vista, actual, bajada, null, ZONA, W, H), false);
});

test("de la muestra de luma a las tiras: misma muestra es la misma página, otra muestra es otra", () => {
    const m1 = new Uint8Array(48 * 108).fill(90);
    const m2 = new Uint8Array(48 * 108).fill(90);
    const m3 = new Uint8Array(48 * 108).fill(200);
    const vista = firmaDePagina(base, m1, null, ZONA, W, H);
    assert.equal(mismaPagina(vista, firmaDePagina(base, m2, rejillaA(), ZONA, W, H), base, m2, ZONA, W, H), true);
    assert.equal(mismaPagina(vista, firmaDePagina(base, m3, rejillaA(), ZONA, W, H), base, m3, ZONA, W, H), false);
});

test("sin zona de rejilla no se reconoce la página y se relee", () => {
    const vista = firmaDePagina(base, null, rejillaA(), ZONA, W, H);
    assert.equal(mismaPagina(vista, firmaDePagina(base, null, null, ZONA, W, H), base, null, false, W, H), false);
});

test("el escáner decide con la firma de página y no con las tiras sueltas", () => {
    const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../deploy/js/services/scanner/scanner.service.js"), "utf-8");
    assert.ok(src.includes("firmaDePagina(video, muestra, esContextoArcanos(contextType) && this._autoCalibCache?.calib, zona, dims.width, dims.height)"));
    assert.ok(src.includes("mismaPagina(this.autoScrollMuestra, muestraPagina, video, muestra, zona, dims.width, dims.height)"));
    assert.ok(src.includes("const hasPageChanged = this.sawScrollSinceScan || (!vista && this.fotosSinScroll < 3);"));
    assert.equal(src.includes("tirasDeNombreArcano("), false);
});
