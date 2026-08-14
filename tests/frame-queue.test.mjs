import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeDocument } from "./_helpers/fake-canvas.mjs";

installFakeDocument();
const { createFrameQueue } = await import("../deploy/js/utils/vision/frame_queue.js");

/** Fuente de 4x4 con un color plano, para comprobar que el recorte llega entero. */
function source(w, h, v) {
    const data = new Uint8ClampedArray(w * h * 4).fill(v);
    return { width: w, height: h, data };
}

const defer = () => new Promise(r => setTimeout(r, 0));

test("frame queue: procesa en orden de llegada", async () => {
    const seen = [];
    const q = createFrameQueue({ max: 3, process: async (job) => { seen.push(job.meta); } });
    for (const n of [1, 2, 3]) q.enqueue(source(4, 4, n), 0, 0, 4, 4, n);
    await defer();
    assert.deepEqual(seen, [1, 2, 3]);
});

test("frame queue: llena rechaza en vez de descartar lo viejo", async () => {
    let release;
    const gate = new Promise(r => { release = r; });
    const seen = [];
    const q = createFrameQueue({ max: 2, process: async (job) => { await gate; seen.push(job.meta); } });

    assert.equal(q.enqueue(source(4, 4, 1), 0, 0, 4, 4, "a"), true);
    assert.equal(q.enqueue(source(4, 4, 2), 0, 0, 4, 4, "b"), true);
    // La primera ya salió de la cola (se está procesando), así que aún cabe una.
    assert.equal(q.enqueue(source(4, 4, 3), 0, 0, 4, 4, "c"), true);
    assert.equal(q.enqueue(source(4, 4, 4), 0, 0, 4, 4, "d"), false, "la 4ª debe rechazarse");

    release();
    await defer();
    // Ninguna de las aceptadas se pierde por el camino.
    assert.deepEqual(seen, ["a", "b", "c"]);
});

test("frame queue: reutiliza los canvas en vez de crear uno por foto", async () => {
    const used = new Set();
    const q = createFrameQueue({ max: 2, process: async (job) => { used.add(job.cvs); } });
    for (let i = 0; i < 6; i++) {
        q.enqueue(source(4, 4, i + 1), 0, 0, 4, 4, i);
        await defer();
    }
    assert.equal(used.size, 1, `6 fotos secuenciales deberían reusar 1 canvas, usaron ${used.size}`);
});

test("frame queue: un frame que revienta no para la cola", async () => {
    const seen = [];
    const q = createFrameQueue({
        max: 3,
        process: async (job) => {
            if (job.meta === "malo") throw new Error("boom");
            seen.push(job.meta);
        },
    });
    q.enqueue(source(4, 4, 1), 0, 0, 4, 4, "malo");
    q.enqueue(source(4, 4, 2), 0, 0, 4, 4, "bueno");
    await defer();
    assert.deepEqual(seen, ["bueno"]);
});

test("frame queue: el recorte que llega al consumidor es la región pedida", async () => {
    const src = source(8, 8, 0);
    // Marca solo el cuadrante inferior derecho.
    for (let y = 4; y < 8; y++) {
        for (let x = 4; x < 8; x++) {
            const i = (y * 8 + x) * 4;
            src.data[i] = src.data[i + 1] = src.data[i + 2] = src.data[i + 3] = 255;
        }
    }
    let got = null;
    const q = createFrameQueue({ max: 1, process: async (job) => { got = job.cvs; } });
    q.enqueue(src, 4, 4, 4, 4);
    await defer();
    assert.equal(got.width, 4);
    assert.equal(got.height, 4);
    const px = got.getContext("2d").getImageData(0, 0, 4, 4).data;
    assert.ok([...px].every(v => v === 255), "el recorte no trae la región pedida");
});

test("frame queue: clear devuelve lo pendiente sin procesarlo", async () => {
    let release;
    const gate = new Promise(r => { release = r; });
    const seen = [];
    const q = createFrameQueue({ max: 3, process: async (job) => { await gate; seen.push(job.meta); } });
    q.enqueue(source(4, 4, 1), 0, 0, 4, 4, "en-curso");
    q.enqueue(source(4, 4, 2), 0, 0, 4, 4, "pendiente");
    q.clear();
    assert.equal(q.size, 0);
    release();
    await defer();
    assert.deepEqual(seen, ["en-curso"]);
});
