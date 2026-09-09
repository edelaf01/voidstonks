// La versión de tesseract.js está FIJADA, y aquí se comprueba que no se separe de la realidad.
//
// Por defecto tesseract.js construye la URL de su worker concatenando la versión que lleva dentro
// (`i8`), así que la que de verdad se descargaba del CDN vivía escondida en un bundle minificado:
// sustituir deploy/js/tesseract.min.js cambiaba en silencio qué worker se baja, y un worker de
// otra versión contra este core es exactamente el fallo que nadie relaciona con el cambio.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";

const repo = readFileSync(new URL("../deploy/js/repositories/ocr.repository.js", import.meta.url), "utf8");
const bundle = readFileSync(new URL("../deploy/js/tesseract.min.js", import.meta.url), "utf8");

const fijada = /const TESSERACT_VERSION = "([\d.]+)"/.exec(repo)?.[1];
// La clave que guarda la versión cambia de nombre con cada minificado (i8 en la 5, rE en la 7),
// así que se busca el PATRÓN y no la clave: `xx:"1.2.3"`.
const delBundle = [...bundle.matchAll(/[A-Za-z_$]{1,4}:"(\d+\.\d+\.\d+)"/g)].map((m) => m[1]);

test("el repositorio fija una versión concreta", () => {
  assert.match(fijada || "", /^\d+\.\d+\.\d+$/, "TESSERACT_VERSION tiene que ser una versión exacta");
});

test("la versión fijada es la del bundle vendorizado", () => {
  assert.ok(delBundle.length, "no se encuentra ninguna versión dentro de deploy/js/tesseract.min.js");
  assert.ok(delBundle.includes(fijada),
    `el bundle declara ${delBundle.join(", ")} y se fija ${fijada}: actualiza TESSERACT_VERSION`);
});

// Worker y core los servimos NOSOTROS. Por defecto tesseract.js los baja de jsdelivr en cada
// arranque: un compromiso de ese paquete ejecutaría código arbitrario en la página, y la URL ni
// siquiera se ve en el fuente porque la construye la librería. Las huellas son las del paquete
// oficial 5.1.1 descargado del registro de npm; si un fichero cambia sin querer, esto lo dice.
const HUELLAS = {
  "worker.min.js": "576b7df7e3393e137e51849357c9adb53fe7ac1bb69bfa06cf3d61520f182c6d",
  "tesseract-core-relaxedsimd-lstm.wasm.js": "861a536cf9ef8e63cb644d57bab39c388f37f7d6b6f60024b741c5f6b39a59b3",
  "tesseract-core-simd-lstm.wasm.js": "c58b46a4c796c0b8afccf77591d5b875b6896b45d402bbce8caa6f5362447b38",
  "tesseract-core-lstm.wasm.js": "eef5f8b2f8e20e150680b20adaec4a60babafee3adbe8a94583c81fee46e8680",
};

test("no se carga nada de tesseract desde un CDN", () => {
  assert.doesNotMatch(repo, /cdn\.jsdelivr\.net|unpkg\.com|esm\.sh/,
    "el worker o el core volverían a venir de un tercero");
  assert.match(repo, /js\/tesseract\/\$\{TESSERACT_VERSION\}/, "la versión tiene que ir en la ruta");
  assert.match(repo, /workerPath: `\$\{BASE\}\/worker\.min\.js`/);
  assert.match(repo, /corePath: `\$\{BASE\}\/`/);
});

for (const [archivo, huella] of Object.entries(HUELLAS)) {
  test(`servimos ${archivo} y es el del paquete oficial`, () => {
    const ruta = new URL(`../deploy/js/tesseract/${fijada}/${archivo}`, import.meta.url);
    assert.ok(existsSync(ruta), `falta deploy/js/tesseract/${fijada}/${archivo}: el escáner no arrancaría`);
    assert.equal(createHash("sha256").update(readFileSync(ruta)).digest("hex"), huella,
      `la huella no coincide con la del paquete ${fijada} del registro de npm`);
  });
}

test("con oem=1 solo hacen falta las variantes LSTM", () => {
  // La librería elige el fichero dentro de corePath según SIMD y oem. Con oem distinto de 1
  // pediría las variantes legacy, que NO servimos, y el escáner se quedaría sin core.
  assert.match(repo, /createWorker\("eng", 1,/);
});

test("no se cuela una versión suelta escrita a mano", () => {
  // Dos sitios con la versión escrita divergen; solo puede haber uno.
  const sueltas = repo.match(/tesseract\.js(-core)?@v\d/g) || [];
  assert.deepEqual(sueltas, [], `versión escrita a mano en la URL: ${sueltas.join(", ")}`);
});

test("los cores se sirven como inmutables", () => {
  // Son 3,7 MB cada uno y con el TTL corto de /js/* se revalidarían cada cinco minutos. Es
  // seguro porque la versión va en la RUTA: subir de versión estrena URL y nunca sirve caché
  // vieja, que es justo lo que ese TTL corto venía a evitar.
  const headers = readFileSync(new URL("../deploy/_headers", import.meta.url), "utf8");
  const iTess = headers.indexOf("/js/tesseract/*");
  const iJs = headers.indexOf("\n/js/*");
  assert.ok(iTess !== -1, "falta la regla de caché para /js/tesseract/*");
  assert.ok(iTess < iJs, "la regla tiene que ir ANTES de /js/*: Pages aplica la primera que casa");
  assert.match(headers.slice(iTess, iJs), /max-age=31536000, immutable/);
});
