// La grabadora de depuración: guarda imagen + resultado por lectura, acotada, y lo exporta en un
// ZIP con una carpeta por lectura. Lo que se fija: no graba apagada, el anillo no crece sin fin,
// y el paquete lleva exactamente frame/overlay/meta/log por lectura más el índice. Con OPFS los
// blobs van al disco y en memoria queda solo el índice; sin él (Node no lo tiene) todo en memoria.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DebugRecorder } from "../deploy/js/services/scanner/debug_recorder.service.js";
import { OPFSRepository } from "../deploy/js/repositories/opfs.repository.js";

/** Un canvas falso cuyo toBlob devuelve `n` bytes: basta para medir tamaños y rutas. */
const lienzo = (n, w = 8, h = 4) => ({ width: w, height: h, toBlob: (cb, tipo) => cb(new Blob([new Uint8Array(n)], { type: tipo })) });
/** Igual pero con un contenido reconocible, para comprobar que lo que sale del disco es lo que entró. */
const lienzoCon = (texto) => ({ width: 8, height: 4, toBlob: (cb, tipo) => cb(new Blob([texto], { type: tipo })) });

/** Un disco en memoria con la API de repositories/opfs.repository.js. */
const discoFalso = (escribeOk = true) => ({
  ficheros: new Map(),
  async abrir() { return true; },
  async escribe(nombre, blob) { if (escribeOk) this.ficheros.set(nombre, new Uint8Array(await blob.arrayBuffer())); return escribeOk; },
  async lee(nombre) { return this.ficheros.get(nombre) ?? null; },
  async borra(nombre) { return this.ficheros.delete(nombre); },
  async vacia() { this.ficheros.clear(); return true; },
});
const usaDisco = (disco) => { DebugRecorder.disco = disco; DebugRecorder._discoP = null; };

/** Nombres de fichero del ZIP, leyendo su directorio central. */
function nombres(zip) {
  const dv = new DataView(zip.buffer, zip.byteOffset);
  const eocd = zip.length - 22;
  let p = dv.getUint32(eocd + 16, true);
  const out = [];
  for (let i = 0; i < dv.getUint16(eocd + 10, true); i++) {
    const len = dv.getUint16(p + 28, true);
    out.push(new TextDecoder().decode(zip.subarray(p + 46, p + 46 + len)));
    p += 46 + len;
  }
  return out;
}

test("apagada no graba nada; encendida guarda imagen, overlay, meta y log", async () => {
  DebugRecorder.clear(); DebugRecorder.enabled = false;
  await DebugRecorder.record({ kind: "inventario", image: lienzo(10) });
  assert.equal(DebugRecorder.size, 0);

  DebugRecorder.enabled = true;
  await DebugRecorder.record({ kind: "inventario", image: lienzo(10), overlay: lienzo(3), meta: { resumen: "18/18" }, log: ["[r0c0] OCR: X"] });
  await DebugRecorder.record({ kind: "fin-mision", image: lienzo(20), meta: { lecturas: [] } });
  assert.equal(DebugRecorder.size, 2);
  const zip = await DebugRecorder.export();
  assert.deepEqual(nombres(zip), [
    "README.txt", "sesion.json",
    "001-inventario/frame.png", "001-inventario/overlay.jpg", "001-inventario/meta.json", "001-inventario/log.txt",
    "002-fin-mision/frame.png", "002-fin-mision/meta.json",
  ]);
  DebugRecorder.enabled = false;
});

test("no se tira ninguna lectura: la grabadora no tiene tope", async () => {
  DebugRecorder.clear(); DebugRecorder.enabled = true;
  let avisos = 0;
  DebugRecorder.onChange = () => avisos++;
  for (let i = 0; i < 20; i++) await DebugRecorder.record({ kind: "cabecera", image: lienzo(1) });
  assert.equal(DebugRecorder.size, 20, "estaba en 16 por el anillo; ahora se guardan todas");
  assert.equal(DebugRecorder.entradas[0].id, 1, "la primera sigue ahí");
  assert.equal(avisos, 20);
  DebugRecorder.onChange = null; DebugRecorder.enabled = false; DebugRecorder.clear();
});

// El botón ZIP muestra los MB porque, sin tope, es lo único que avisa de cuánto se acumula.
test("los MB acumulados se pueden consultar y el vaciado los resetea", async () => {
  DebugRecorder.clear(); DebugRecorder.enabled = true;
  for (let i = 0; i < 3; i++) await DebugRecorder.record({ kind: "inventario", image: lienzo(30 * 1024 * 1024) });
  assert.equal(DebugRecorder.size, 3, "tres de 30 MB ya no echan a nadie");
  assert.equal(Math.round(DebugRecorder.mb), 90);
  DebugRecorder.clear();
  assert.equal(DebugRecorder.mb, 0);
  DebugRecorder.enabled = false;
});

// Las miniaturas son el material del clasificador de pantalla: una por segundo como mucho y solo
// si el frame cambió, con la etiqueta que decidió el escáner al lado.
test("la miniatura se guarda al cambiar el frame, no más de una por segundo, y sale etiquetada", async () => {
  const { FakeCanvas } = await import("./_helpers/fake-canvas.mjs");
  globalThis.document ??= { createElement: () => new FakeCanvas() };
  const W = 320, H = 180;
  const frame = (v) => {
    const data = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < data.length; i += 4) { data[i] = data[i + 1] = data[i + 2] = ((i / 4 / W | 0) * 7 + v) % 256; data[i + 3] = 255; }
    return { videoWidth: W, videoHeight: H, width: W, height: H, data };
  };
  DebugRecorder.clear(); DebugRecorder.enabled = false;
  assert.equal(DebugRecorder.miniatura(frame(0), { contexto: "UNKNOWN" }, 1000), false, "apagada no graba");

  DebugRecorder.enabled = true;
  assert.equal(DebugRecorder.miniatura(frame(0), { contexto: "UNKNOWN", pasadas: 3 }, 1000), true);
  assert.equal(DebugRecorder.miniatura(frame(90), { contexto: "INVENTORY" }, 1800), false, "cambió, pero no ha pasado un segundo");
  assert.equal(DebugRecorder.miniatura(frame(0), { contexto: "UNKNOWN" }, 2500), false, "la misma pantalla no se repite");
  assert.equal(DebugRecorder.miniatura(frame(90), { contexto: "INVENTORY", pasadas: 1 }, 3600), true);
  assert.equal(DebugRecorder.miniaturas.length, 2);

  await new Promise((r) => setTimeout(r, 0)); // los JPEG se codifican fuera del hilo
  assert.ok(DebugRecorder.mb > 0, "cuentan en el tamaño del paquete");
  const zip = await DebugRecorder.export();
  const lista = nombres(zip);
  assert.deepEqual(lista.filter((n) => n.startsWith("miniaturas")), ["miniaturas/00001.jpg", "miniaturas/00002.jpg", "miniaturas.jsonl"]);
  const texto = new TextDecoder().decode(zip);
  assert.match(texto, /"file":"miniaturas\/00001\.jpg".*"contexto":"UNKNOWN","pasadas":3/);
  assert.match(texto, /"file":"miniaturas\/00002\.jpg".*"contexto":"INVENTORY","pasadas":1/);
  DebugRecorder.enabled = false; DebugRecorder.clear();
  assert.equal(DebugRecorder.miniaturas.length, 0);
});

// Una hora de inventario eran ~2 GB de PNG en RAM: los blobs van al disco según llegan y el
// paquete se monta leyéndolos de vuelta. El índice (kind, meta, log, bytes) sigue en memoria.
test("con OPFS el blob no se queda en memoria, va al disco y el ZIP sale igual", async () => {
  const { FakeCanvas } = await import("./_helpers/fake-canvas.mjs");
  globalThis.document ??= { createElement: () => new FakeCanvas() };
  const disco = discoFalso();
  disco.ficheros.set("9-frame.png", new Uint8Array(5)); // resto de una sesión anterior sin exportar
  usaDisco(disco);
  DebugRecorder.clear(); DebugRecorder.enabled = true;

  await DebugRecorder.record({ kind: "inventario", image: lienzoCon("PNGFALSO"), overlay: lienzo(3), meta: { resumen: "18/18" }, log: ["[r0c0] OCR: X"] });
  await DebugRecorder.record({ kind: "fin-mision", image: lienzo(20) });
  const [a, b] = DebugRecorder.entradas;
  assert.equal(a.png, null, "el PNG no se retiene en memoria");
  assert.equal(a.overlay, null, "el overlay tampoco");
  assert.equal(b.png, null);
  assert.deepEqual([...disco.ficheros.keys()].sort(), ["1-frame.png", "1-overlay.jpg", "2-frame.png"], "en disco y sin el resto viejo");
  assert.equal(Math.round(DebugRecorder.mb * 1024 * 1024), 8 + 3 + 20, "los MB cuentan lo escrito en disco");

  const W = 320, H = 180;
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < data.length; i += 4) { data[i] = data[i + 1] = data[i + 2] = (i / 4 / W | 0) % 256; data[i + 3] = 255; }
  assert.equal(DebugRecorder.miniatura({ videoWidth: W, videoHeight: H, width: W, height: H, data }, { contexto: "INVENTORY" }, 5000), true);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(DebugRecorder.miniaturas[0].jpg, null, "la miniatura tampoco se queda en memoria");
  assert.ok(disco.ficheros.has("m1.jpg"));

  const zip = await DebugRecorder.export();
  assert.deepEqual(nombres(zip), [
    "README.txt", "sesion.json",
    "001-inventario/frame.png", "001-inventario/overlay.jpg", "001-inventario/meta.json", "001-inventario/log.txt",
    "002-fin-mision/frame.png", "002-fin-mision/meta.json",
    "miniaturas/00001.jpg", "miniaturas.jsonl",
  ]);
  assert.match(new TextDecoder().decode(zip), /PNGFALSO/, "el frame del ZIP es el que se escribió en disco");

  await DebugRecorder.clear();
  assert.equal(disco.ficheros.size, 0, "vaciar borra también el disco");
  DebugRecorder.enabled = false;
  usaDisco(OPFSRepository);
});

test("si la escritura en disco falla, ese blob se queda en memoria y el paquete no lo pierde", async () => {
  const disco = discoFalso(false);
  usaDisco(disco);
  DebugRecorder.clear(); DebugRecorder.enabled = true;
  await DebugRecorder.record({ kind: "recompensas", image: lienzoCon("ENRAM"), overlay: lienzo(3) });
  const [e] = DebugRecorder.entradas;
  assert.ok(e.png instanceof Blob, "sin disco, el blob sigue en memoria");
  assert.ok(e.overlay instanceof Blob);
  assert.equal(disco.ficheros.size, 0);
  const zip = await DebugRecorder.export();
  assert.deepEqual(nombres(zip), ["README.txt", "sesion.json", "001-recompensas/frame.png", "001-recompensas/overlay.jpg", "001-recompensas/meta.json"]);
  assert.match(new TextDecoder().decode(zip), /ENRAM/);
  await DebugRecorder.clear(); DebugRecorder.enabled = false;
  usaDisco(OPFSRepository);
});

test("las muestras de rendimiento van al paquete como rendimiento.jsonl", async () => {
  DebugRecorder.clear(); DebugRecorder.enabled = true;
  DebugRecorder._muestreador = { tick: (meta) => ({ time: "t", heapMB: 512, retrasoMaxMs: 40, ...meta }), para() {} };
  DebugRecorder.rendimientoTick({ contexto: "INVENTORY", enOCR: true });
  assert.equal(DebugRecorder.rendimiento.length, 1);
  const zip = await DebugRecorder.export();
  assert.ok(nombres(zip).includes("rendimiento.jsonl"));
  assert.match(new TextDecoder().decode(zip), /"heapMB":512,"retrasoMaxMs":40,"contexto":"INVENTORY","enOCR":true/);
  DebugRecorder.enabled = false; DebugRecorder._muestreador = null; DebugRecorder.clear();
  assert.equal(DebugRecorder.rendimiento.length, 0);
});

// Se lee el fuente porque live_scanner.js no tiene arnés (DOM, stream, workers) y esto es una
// guarda de producción: encendida sola escribiría GB en el disco de cada usuario.
test("la grabadora solo arranca sola al depurar (vs_debug_logs), nunca en producción", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../deploy/js/scanner/live_scanner.js", import.meta.url), "utf8");
  assert.doesNotMatch(src, /enciendeGrabadora\(true\)/, "arranque incondicional");
  assert.match(src, /enciendeGrabadora\(DEBUG_ACTIVO\)/);
  const { DEBUG_ACTIVO } = await import("../deploy/js/utils/debug_log.js");
  assert.equal(DEBUG_ACTIVO, false, "sin el flag de localStorage tiene que estar apagada");
});

// Desplegada, la grabadora tiene tope (quien la encienda a mano no se llena el disco sin saberlo);
// al depurar (vs_debug_logs) no lo tiene. Aquí no hay flag: rige el tope de producción.
test("con el tope alcanzado deja de grabar lecturas y miniaturas, y lo dice", async () => {
  const { LIMITE_MB } = await import("../deploy/js/services/scanner/debug_recorder.service.js");
  assert.equal(LIMITE_MB, 300, "en producción, 300 MB");
  DebugRecorder.clear(); DebugRecorder.enabled = true;
  DebugRecorder._bytes = LIMITE_MB * 1048576;
  assert.equal(DebugRecorder.llena, true);
  await DebugRecorder.record({ kind: "inventario", image: lienzo(10) });
  assert.equal(DebugRecorder.size, 0, "no graba más lecturas");
  const { FakeCanvas } = await import("./_helpers/fake-canvas.mjs");
  const v = Object.assign(new FakeCanvas(32, 18), { videoWidth: 32, videoHeight: 18 });
  assert.equal(DebugRecorder.miniatura(v, {}, 5000), false, "ni miniaturas");
  DebugRecorder.enabled = false; DebugRecorder.clear();
  assert.equal(DebugRecorder.llena, false);
});
