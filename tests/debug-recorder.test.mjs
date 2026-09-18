// La grabadora de depuración: guarda imagen + resultado por lectura, acotada, y lo exporta en un
// ZIP con una carpeta por lectura. Lo que se fija: no graba apagada, el anillo no crece sin fin,
// y el paquete lleva exactamente frame/overlay/meta/log por lectura más el índice.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DebugRecorder } from "../deploy/js/services/scanner/debug_recorder.service.js";

/** Un canvas falso cuyo toBlob devuelve `n` bytes: basta para medir tamaños y rutas. */
const lienzo = (n, w = 8, h = 4) => ({ width: w, height: h, toBlob: (cb, tipo) => cb(new Blob([new Uint8Array(n)], { type: tipo })) });

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
