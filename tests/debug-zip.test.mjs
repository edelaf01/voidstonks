// El ZIP del paquete de depuración se escribe a mano (store, sin librería): aquí se comprueba
// contra el CRC de zlib y leyendo el directorio central, que es lo que un descompresor mira.
import { test } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { buildZip, crc32 } from "../deploy/js/utils/debug_zip.js";

const bytes = (s) => new TextEncoder().encode(s);
const u32 = (b, o) => new DataView(b.buffer, b.byteOffset).getUint32(o, true);
const u16 = (b, o) => new DataView(b.buffer, b.byteOffset).getUint16(o, true);

test("crc32 coincide con el de zlib", () => {
  for (const s of ["", "a", "voidstonks", "x".repeat(5000)]) assert.equal(crc32(bytes(s)), zlib.crc32(bytes(s)));
});

test("el zip lleva cada fichero entero, con su CRC y su nombre, y un directorio central que los encuentra", () => {
  const files = [{ name: "sesion.json", data: bytes('{"a":1}') }, { name: "001-inventario/meta.json", data: bytes("{}") }];
  const zip = buildZip(files, new Date(2026, 8, 14, 10, 30, 0));

  // Fin del directorio central: número de entradas y dónde empieza.
  const eocd = zip.length - 22;
  assert.equal(u32(zip, eocd), 0x06054b50);
  assert.equal(u16(zip, eocd + 10), 2);
  let p = u32(zip, eocd + 16);
  for (const f of files) {
    assert.equal(u32(zip, p), 0x02014b50);
    assert.equal(u32(zip, p + 16), crc32(f.data));
    assert.equal(u32(zip, p + 20), f.data.length, "tamaño comprimido = original (store)");
    const nameLen = u16(zip, p + 28);
    assert.equal(new TextDecoder().decode(zip.subarray(p + 46, p + 46 + nameLen)), f.name);
    // La entrada apunta a la cabecera local, y tras ella van los datos tal cual.
    const local = u32(zip, p + 42);
    assert.equal(u32(zip, local), 0x04034b50);
    const datos = local + 30 + u16(zip, local + 26);
    assert.deepEqual(zip.subarray(datos, datos + f.data.length), f.data);
    p += 46 + nameLen;
  }
});

test("un zip vacío sigue siendo un zip válido", () => {
  const zip = buildZip([]);
  assert.equal(zip.length, 22);
  assert.equal(u32(zip, 0), 0x06054b50);
});
