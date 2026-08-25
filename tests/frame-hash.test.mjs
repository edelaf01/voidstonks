import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeDocument, FakeCanvas } from "./_helpers/fake-canvas.mjs";

installFakeDocument();
const { videoRegionHash, smallCanvasHash, compareHashes } =
    await import("../deploy/js/utils/vision/frame_hash.js");

/** Canvas plano de un gris dado, que es lo que hashean estas funciones. */
function flat(w, h, v) {
    const cvs = new FakeCanvas();
    cvs.width = w; cvs.height = h;
    cvs._data.fill(255);
    for (let i = 0; i < cvs._data.length; i += 4) {
        cvs._data[i] = cvs._data[i + 1] = cvs._data[i + 2] = v;
    }
    return cvs;
}

test("hash: la misma imagen da el mismo hash", () => {
    assert.equal(smallCanvasHash(flat(64, 36, 100)), smallCanvasHash(flat(64, 36, 100)));
});

test("hash: siempre 16x9 muestras en hex, sea cual sea el tamaño de entrada", () => {
    const h = smallCanvasHash(flat(640, 360, 100));
    assert.equal(h.length, 16 * 9 * 2);
    assert.match(h, /^[0-9a-f]+$/);
    // El tamaño de entrada no puede cambiar la longitud: si cambiara, comparar hashes de
    // dos frames de distinta resolución devolvería false por longitud y el skip no engancharía.
    assert.equal(smallCanvasHash(flat(32, 18, 100)).length, h.length);
});

// Lo que de verdad importa: comparar por DISTANCIA, no por igualdad. Con vídeo comprimido
// dos frames de una pantalla quieta nunca salen idénticos bit a bit.
test("comparar: una diferencia pequeña sigue siendo 'la misma pantalla'", () => {
    assert.equal(compareHashes(smallCanvasHash(flat(64, 36, 100)), smallCanvasHash(flat(64, 36, 110))), true);
});

test("comparar: un cambio grande se detecta", () => {
    assert.equal(compareHashes(smallCanvasHash(flat(64, 36, 20)), smallCanvasHash(flat(64, 36, 200))), false);
});

test("comparar: la tolerancia del header (6) es más estricta que la de pantalla (18)", () => {
    const a = smallCanvasHash(flat(64, 36, 100));
    const b = smallCanvasHash(flat(64, 36, 110));
    assert.equal(compareHashes(a, b, 18), true);
    assert.equal(compareHashes(a, b, 6), false, "con 6 un cambio de 10 ya cuenta como pantalla nueva");
});

test("comparar: sin hash o de distinta longitud nunca es 'igual'", () => {
    assert.equal(compareHashes(null, "aa"), false);
    assert.equal(compareHashes("aa", ""), false);
    assert.equal(compareHashes("aabb", "aa"), false);
});

test("videoRegionHash recorta la región relativa que se le pide", () => {
    // Mitades distintas: hashear una u otra no puede dar lo mismo.
    const v = new FakeCanvas();
    v.width = 64; v.height = 36;
    for (let y = 0; y < 36; y++) {
        for (let x = 0; x < 64; x++) {
            const i = (y * 64 + x) * 4;
            const val = x < 32 ? 20 : 220;
            v._data[i] = v._data[i + 1] = v._data[i + 2] = val;
            v._data[i + 3] = 255;
        }
    }
    v.videoWidth = 64; v.videoHeight = 36;
    const izq = videoRegionHash(v, { x: 0, y: 0, w: 0.5, h: 1 });
    const der = videoRegionHash(v, { x: 0.5, y: 0, w: 0.5, h: 1 });
    assert.notEqual(izq, der);
    assert.equal(compareHashes(izq, der), false);
});

// --- Comparación de hashes de frame ---------------------------------------------------------

// El hash decide si la página ha cambiado (hay que reescanear) o no. Demasiado sensible =
// reescaneo constante; demasiado tolerante = no se entera del scroll.
test("dos hashes iguales son el mismo frame", () => {
  assert.equal(compareHashes("a1b2c3d4", "a1b2c3d4"), true);
});

test("una diferencia pequeña sigue siendo el mismo frame (ruido de vídeo)", () => {
  assert.equal(compareHashes("505050", "525151"), true);
});

test("una diferencia grande es otro frame", () => {
  assert.equal(compareHashes("000000", "ffffff"), false);
});

test("sin hash, o con hashes de distinto tamaño, no se afirma que sean iguales", () => {
  assert.equal(compareHashes(null, "abcd"), false);
  assert.equal(compareHashes("abcd", null), false);
  assert.equal(compareHashes("abcd", "abcdef"), false);
});
