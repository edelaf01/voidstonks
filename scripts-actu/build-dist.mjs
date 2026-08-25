// Build de producción: copia deploy/ -> dist/ y MINIFICA cada .js con esbuild (parser
// real, no regex). Así deploy/ conserva los comentarios/documentación donde se edita y
// lo que se publica va sin comentarios y más ligero. Se ejecuta en CI antes de wrangler.
//
// Reglas:
//  - NO se hace bundling: la app usa módulos ES con imports relativos en runtime, así que
//    cada archivo se minifica POR SEPARADO (esbuild transform), preservando import/export.
//  - Se saltan los vendored/ya-minificados (tesseract, opencv, *.min.js, *.wasm.js): ni se
//    tocan ni se re-minifican (romperían o no ganan nada).
//  - El HTML NO se toca (tiene <script> inline; minificarlo con regex es frágil). El grueso
//    de los comentarios está en el JS, que es lo que sí se limpia.
//
// Uso: node scripts-actu/build-dist.mjs  (requiere esbuild disponible vía npx/instalado)

import { readdir, readFile, writeFile, rm, mkdir, cp, stat } from "node:fs/promises";
import { join, extname } from "node:path";
import { transform } from "esbuild";

const SRC = "deploy";
const OUT = "dist";

/**
 * Lo que NO se copia a dist/, y por tanto no se publica.
 *
 * `deploy/` es a la vez fuente y carpeta publicada, así que la documentación que vive junto al
 * código acababa servida en voidstonks.com: `MAINTENANCE_VOSFOR.md` y
 * `js/utils/native_bridge.contract.md` respondían 200 con `text/markdown`, y el propio
 * `.assetsignore` publicaba la lista de lo que se pretendía esconder. Ese fichero no vale aquí:
 * lo entiende Workers Assets, no `wrangler pages deploy`, que es lo que usa el workflow.
 */
const NO_PUBLICAR = (ruta) => {
    const nombre = ruta.split("/").pop();
    return nombre.endsWith(".md")
        || nombre === ".assetsignore"
        || nombre.endsWith(".pem")
        || nombre.endsWith(".crt")
        || nombre.endsWith(".bak")
        || ruta.includes("/.wrangler");
};

const SKIP = (name, path) =>
    name.endsWith(".min.js") ||
    name.endsWith(".wasm.js") ||
    name.startsWith("tesseract") ||
    path.includes("opencv");

/**
 * Sello de versión del build. En CI viene el SHA del commit; en local, la fecha, para que
 * dos builds seguidos no colisionen.
 */
const BUILD_ID = (process.env.GITHUB_SHA || "").slice(0, 8) || `dev${Date.now().toString(36)}`;

/**
 * Reescribe TODOS los ?v=… a un mismo sello por build, y añade uno a los imports que no lo
 * llevan.
 *
 * El versionado manual venía fallando de dos maneras a la vez: unos imports llevaban ?v= y
 * otros no (ui_vosfor.js?v=2.9 sí, ui_bounties.js no), y el que lo llevaba había que acordarse
 * de subirlo. Cuando se olvidaba, Cloudflare seguía sirviendo el módulo anterior durante horas
 * y el resultado era HTML nuevo ejecutando JS viejo: contadores parados, estilos a medias.
 *
 * Con un sello único por commit basta con que el HTML esté fresco (lo garantiza _headers) para
 * que TODA la cadena de módulos se invalide de golpe.
 */
function stampVersions(code) {
    return code
        // Rutas ya versionadas: se unifican al sello del build.
        .replace(/(["'])([^"']+\.(?:js|css))\?v=[^"']*\1/g, `$1$2?v=${BUILD_ID}$1`)
        // Imports estáticos relativos sin versión (los que se quedaban cacheados).
        .replace(/(from\s*|import\s*)(["'])(\.{1,2}\/[^"']+\.js)\2/g,
            `$1$2$3?v=${BUILD_ID}$2`)
        // import() dinámico: lo usan el scanner, los servicios de riven y el vigilante de
        // precios. Se cargan en caliente, así que sin sello son justo los que más tiempo
        // pueden quedarse en una versión vieja dentro de una sesión ya abierta.
        .replace(/(import\s*\(\s*)(["'])(\.{1,2}\/[^"']+\.js)\2/g,
            `$1$2$3?v=${BUILD_ID}$2`)
        // <script src> y <link href> locales sin versión.
        .replace(/((?:src|href)=)(["'])((?!https?:|\/\/)[^"']+\.(?:js|css))\2/g,
            `$1$2$3?v=${BUILD_ID}$2`);
}

async function walk(dir) {
    const out = [];
    for (const ent of await readdir(dir, { withFileTypes: true })) {
        const p = join(dir, ent.name);
        if (ent.isDirectory()) out.push(...(await walk(p)));
        else out.push(p);
    }
    return out;
}

async function main() {
    await rm(OUT, { recursive: true, force: true });
    await mkdir(OUT, { recursive: true });
    await cp(SRC, OUT, {
        recursive: true,
        // El filtro se aplica también a los directorios: devolver false en uno se lleva todo
        // lo que cuelga (ver .wrangler).
        filter: (origen) => !NO_PUBLICAR(origen),
    });

    const files = await walk(OUT);
    let minified = 0, skipped = 0, stamped = 0;
    for (const f of files) {
        if (extname(f) !== ".js") continue;
        const name = f.split("/").pop();
        if (SKIP(name, f)) { skipped++; continue; }

        const code = await readFile(f, "utf8");
        const res = await transform(code, {
            minify: true,
            // Los archivos son módulos ES cargados por <script type="module">; esto evita
            // que esbuild los trate como script clásico y preserva import/export.
            format: "esm",
            legalComments: "none",
        });
        // El sello va DESPUÉS de minificar: esbuild reescribe los literales de import y
        // borraría un ?v= puesto antes.
        await writeFile(f, stampVersions(res.code), "utf8");
        minified++;
        stamped++;
    }

    // El HTML no se minifica (ver cabecera), pero sí se sella: es la raíz de la cadena.
    for (const f of files) {
        if (extname(f) !== ".html") continue;
        await writeFile(f, stampVersions(await readFile(f, "utf8")), "utf8");
        stamped++;
    }

    console.log(`[build-dist] Minificados ${minified} JS, saltados ${skipped} (vendored).`);
    console.log(`[build-dist] Sello de versión ?v=${BUILD_ID} en ${stamped} archivos. Salida en ${OUT}/`);

    // Verificación básica: dist debe existir y contener index.html.
    await stat(join(OUT, "index.html"));

    // Guarda: si el HTML publicado se quedara sin sellar, los usuarios volverían a arrastrar
    // módulos viejos y el síntoma sería difícil de atribuir. Mejor romper el deploy aquí.
    const html = await readFile(join(OUT, "index.html"), "utf8");
    if (!html.includes(`?v=${BUILD_ID}`)) {
        throw new Error("index.html quedó sin sello de versión: revisa stampVersions()");
    }
}

main().catch((e) => { console.error("[build-dist] FALLO:", e); process.exit(1); });
