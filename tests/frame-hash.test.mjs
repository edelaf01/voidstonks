import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeDocument, FakeCanvas } from "./_helpers/fake-canvas.mjs";

installFakeDocument();
const { videoRegionHash, smallCanvasHash, compareHashes, canvasRegionHash, fraccionCambiada, miniaturaLuma, regionLuma,
    firmaTexto, mismoTexto } = await import("../deploy/js/utils/vision/frame_hash.js");

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

test("canvasRegionHash hashea el rectángulo en píxeles que se le pide", () => {
    const v = new FakeCanvas();
    v.width = 64; v.height = 36;
    for (let y = 0; y < 36; y++) {
        for (let x = 0; x < 64; x++) {
            const i = (y * 64 + x) * 4;
            const val = y < 18 ? 20 : 220;
            v._data[i] = v._data[i + 1] = v._data[i + 2] = val;
            v._data[i + 3] = 255;
        }
    }
    const arriba = canvasRegionHash(v, { x: 0, y: 0, w: 64, h: 18 });
    const abajo = canvasRegionHash(v, { x: 0, y: 18, w: 64, h: 18 });
    assert.equal(arriba, canvasRegionHash(v, { x: 0, y: 0, w: 64, h: 18 }));
    assert.equal(compareHashes(arriba, abajo, 8), false);
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

// El disparador del auto-scan: la suma de brillo no distingue una página de reliquias de otra
// (mismas cards, otro texto), y contar muestras cambiadas sí.
test("fraccionCambiada: solo cuenta las muestras que se mueven de verdad", () => {
  const a = new Uint8Array(1000).fill(100);
  assert.equal(fraccionCambiada(a, a), 0);

  const ruido = Uint8Array.from(a, (v, i) => v + (i % 3 === 0 ? 20 : 0));
  assert.equal(fraccionCambiada(a, ruido), 0, "20 de luma es ruido de vídeo, no cambio");

  const texto = Uint8Array.from(a, (v, i) => (i < 30 ? 230 : v));
  assert.equal(fraccionCambiada(a, texto), 0.03, "una franja de texto sí cuenta");

  assert.equal(fraccionCambiada(a, null), 1, "sin referencia, se asume cambiada");
  assert.equal(fraccionCambiada(a, new Uint8Array(10)), 1, "otra longitud, otra región");
});

test("miniaturaLuma reduce el vídeo entero al tamaño pedido y da la luma por píxel", () => {
    const v = new FakeCanvas();
    v.width = 64; v.height = 36;
    for (let y = 0; y < 36; y++) {
        for (let x = 0; x < 64; x++) {
            const i = (y * 64 + x) * 4;
            v._data[i] = v._data[i + 1] = v._data[i + 2] = x < 32 ? 20 : 220;
            v._data[i + 3] = 255;
        }
    }
    v.videoWidth = 64; v.videoHeight = 36;
    const { cvs, luma } = miniaturaLuma(v, 16, 9);
    assert.equal(cvs.width, 16); assert.equal(cvs.height, 9);
    assert.equal(luma.length, 16 * 9);
    assert.equal(luma[0], 20, "mitad izquierda oscura");
    assert.equal(luma[15], 220, "mitad derecha clara");
    assert.equal(miniaturaLuma(v, 16, 9).cvs, cvs, "el canvas se reutiliza");
});

test("regionLuma recorta la región pedida del origen y la muestrea al tamaño pedido", () => {
    const v = new FakeCanvas();
    v.width = 64; v.height = 36;
    for (let y = 0; y < 36; y++) {
        for (let x = 0; x < 64; x++) {
            const i = (y * 64 + x) * 4;
            v._data[i] = x < 32 ? 20 : 200; v._data[i + 1] = x < 32 ? 20 : 200; v._data[i + 2] = x < 32 ? 20 : 200;
            v._data[i + 3] = 255;
        }
    }
    const derecha = regionLuma(v, { x: 0.5, y: 0, w: 0.5, h: 1, cols: 8, filas: 4 });
    assert.equal(derecha.length, 32);
    assert.ok(derecha.every((l) => l >= 195), "solo la mitad clara");
    const izquierda = regionLuma(v, { x: 0, y: 0, w: 0.5, h: 1, cols: 8, filas: 4 });
    assert.ok(izquierda.every((l) => l <= 25));
    v._data.fill(0); for (let i = 0; i < v._data.length; i += 4) { v._data[i] = 255; v._data[i + 3] = 255; }
    assert.equal(regionLuma(v, { x: 0, y: 0, w: 1, h: 1, cols: 2, filas: 2 })[0], 76, "luma 0.299/0.587/0.114");
});

// La carta de riven: fondo oscuro y "líneas de texto" claras. Cambiar una línea es cambiar un stat.
function carta({ linea = 30, ruido = 0 } = {}) {
    const W = 640, H = 360, data = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const texto = y >= 260 && y < 266 && x >= 250 && x < 250 + linea * 4;
        data[i] = data[i + 1] = data[i + 2] = (texto ? 210 : 25) + ruido;
        data[i + 3] = 255;
    }
    return { videoWidth: W, videoHeight: H, width: W, height: H, data };
}
const ZONA = { x: 0.13, y: 0.5, w: 0.74, h: 0.4 };

test("firma de texto: otro stat en la carta es otra pantalla, aunque el hash de 16x9 no lo vea", () => {
    const a = carta(), b = carta({ linea: 60 });
    assert.equal(compareHashes(videoRegionHash(a, ZONA), videoRegionHash(b, ZONA)), true,
        "el hash grueso da por igual la carta con otro texto: era lo que dejaba sin leer las tiradas nuevas");
    assert.equal(mismoTexto(firmaTexto(a, ZONA), firmaTexto(b, ZONA)), false);
});

test("firma de texto: la misma carta con algo de ruido del vídeo sigue siendo la misma", () => {
    assert.equal(mismoTexto(firmaTexto(carta(), ZONA), firmaTexto(carta({ ruido: 6 }), ZONA)), true);
    assert.equal(firmaTexto(carta(), ZONA).length, 96 * 36);
    assert.equal(mismoTexto(firmaTexto(carta(), ZONA), null), false, "sin firma previa no hay nada que saltarse");
});

test("firma de texto por zonas: una huella por carta, y otro número de cartas es otra pantalla", () => {
    const zonaA = { x: 0.3, y: 0.6, w: 0.2, h: 0.2 }, zonaB = { x: 0.6, y: 0.6, w: 0.2, h: 0.2 };
    const dos = firmaTexto(carta(), [zonaA, zonaB]);
    assert.equal(dos.length, 2 * 96 * 36);
    assert.deepEqual([...dos.subarray(0, 96 * 36)], [...firmaTexto(carta(), zonaA)]);
    assert.equal(mismoTexto(dos, firmaTexto(carta(), [zonaA])), false);
});
