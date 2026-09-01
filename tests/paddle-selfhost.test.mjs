import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";

// ===========================================================================
// Se lee el FUENTE porque lo que se protege es de DESPLIEGUE, no de comportamiento: cargar el
// motor de verdad pide navegador, WASM y descargar 6 MB. Lo que no puede volver a pasar:
//  - `@latest` en la URL del CDN: el paquete es de un tercero y una publicación suya rompe la
//    app en caliente sin que nadie toque este repo.
//  - que los modelos se pidan a HuggingFace: el escáner dejaba de funcionar si ese host caía.
// ===========================================================================

const REPO = new URL("../", import.meta.url);
const PADDLE = readFileSync(new URL("deploy/js/repositories/paddle.repository.js", REPO), "utf8");

describe("modelos de OCR servidos por nosotros", () => {
    test("la librería se pide con una versión fija, nunca @latest", () => {
        const urls = PADDLE.match(/https:\/\/esm\.sh\/[^"'`]+/g) || [];
        assert.notEqual(urls.length, 0, "ya no se carga desde esm.sh: ¿cambió el mecanismo?");
        for (const url of urls) {
            assert.equal(/@\d+\.\d+\.\d+\//.test(url), true, `sin versión fija: ${url}`);
        }
    });

    test("los modelos apuntan a assets/ locales, no a un host de terceros", () => {
        for (const clave of ["detection", "recognition", "charactersDictionary"]) {
            const m = new RegExp(`${clave}:\\s*"([^"]+)"`).exec(PADDLE);
            assert.notEqual(m, null, `no se declara ${clave}`);
            assert.equal(m[1].startsWith("assets/ocr/"), true, `${clave} no es local: ${m[1]}`);
        }
        assert.equal(/huggingface\.co/.test(PADDLE), false, "sigue habiendo una URL de HuggingFace");
    });

    test("los tres ficheros están en deploy/ y pesan lo que deben", () => {
        // Tamaños de la descarga real; si uno llega a 0 bytes (una copia fallida) el motor
        // arranca y falla en el navegador, no aquí.
        const esperado = {
            "PP-OCRv6_tiny_det.ort": 1_500_000,
            "PP-OCRv6_tiny_rec.ort": 4_000_000,
            "ppocrv6_tiny_dict.txt": 20_000,
        };
        for (const [nombre, minimo] of Object.entries(esperado)) {
            const { size } = statSync(new URL(`deploy/assets/ocr/${nombre}`, REPO));
            assert.equal(size > minimo, true, `${nombre} pesa ${size}, esperaba más de ${minimo}`);
        }
    });

    test("el despliegue los publica y los cachea como inmutables", () => {
        const headers = readFileSync(new URL("deploy/_headers", REPO), "utf8");
        assert.match(headers, /\/assets\/\*\.ort\s*\n\s*Cache-Control: public, max-age=31536000, immutable/);
        const build = readFileSync(new URL("scripts-actu/build-dist.mjs", REPO), "utf8");
        assert.equal(/\.ort/.test(build), false, "el build excluye los .ort del publicado");
    });
});
