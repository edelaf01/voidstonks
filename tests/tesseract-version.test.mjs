// pinned tesseract.js version vs reality
// by default tesseract.js builds its worker URL from an internal version string inside the minified
// bundle, so updating deploy/js/tesseract.min.js silently changed the downloaded worker
// a worker version mismatch against our core is the silent failure this pins
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";

const repo = readFileSync(new URL("../deploy/js/repositories/ocr.repository.js", import.meta.url), "utf8");
const bundle = readFileSync(new URL("../deploy/js/tesseract.min.js", import.meta.url), "utf8");

const fijada = /const TESSERACT_VERSION = "([\d.]+)"/.exec(repo)?.[1];
// minified key name changes across releases (i8 in 5, rE in 7), so it matches the PATTERN xx:"1.2.3"
// instead of the key
const delBundle = [...bundle.matchAll(/[A-Za-z_$]{1,4}:"(\d+\.\d+\.\d+)"/g)].map((m) => m[1]);

test("el repositorio fija una versión concreta", () => {
  assert.match(fijada || "", /^\d+\.\d+\.\d+$/, "TESSERACT_VERSION tiene que ser una versión exacta");
});

test("la versión fijada es la del bundle vendorizado", () => {
  assert.ok(delBundle.length, "no se encuentra ninguna versión dentro de deploy/js/tesseract.min.js");
  assert.ok(delBundle.includes(fijada),
    `el bundle declara ${delBundle.join(", ")} y se fija ${fijada}: actualiza TESSERACT_VERSION`);
});

// worker and core are self-hosted: by default tesseract.js fetches them from jsdelivr on boot, where
// package compromise would run arbitrary code; hashes match official 5.1.1 npm release
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
  // the library selects the file in corePath based on SIMD and oem: non-1 oem would request legacy variants
  // that are NOT self-hosted, leaving the scanner without a core
  assert.match(repo, /createWorker\("eng", 1,/);
});

test("no se cuela una versión suelta escrita a mano", () => {
  // two hardcoded version locations diverge: only one is allowed
  const sueltas = repo.match(/tesseract\.js(-core)?@v\d/g) || [];
  assert.deepEqual(sueltas, [], `versión escrita a mano en la URL: ${sueltas.join(", ")}`);
});

test("los cores se sirven como inmutables", () => {
  const headers = readFileSync(new URL("../deploy/_headers", import.meta.url), "utf8");
  const iTess = headers.indexOf("/js/tesseract/*");
  const iJs = headers.indexOf("\n/js/*");
  assert.ok(iTess !== -1, "falta la regla de caché para /js/tesseract/*");
  assert.ok(iTess < iJs, "la regla tiene que ir ANTES de /js/*: Pages aplica la primera que casa");
  assert.match(headers.slice(iTess, iJs), /max-age=31536000, immutable/);
});
