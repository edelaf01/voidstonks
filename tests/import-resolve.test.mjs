// every `import { X } from "./y.js"` has to find an exported `X` in `y.js`
// nothing else in the repo catches it: lint does not resolve modules, `node --check` only checks syntax
// the suite does not import ui.components and import-graph.test.mjs looks at who imports whom, not what
// it only shows on reload and takes the whole app down: Uncaught SyntaxError: The requested module
// './ui_ducanator.js' does not provide an export named 'getPartDucats'
// with a DYNAMIC `import()` there is not even a SyntaxError: the module loads, the destructuring gives
// `undefined` and the call blows up when the user clicks

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { modules } from "./_helpers/architecture-rules.mjs";

/** names a module exports; `reexporta` flags `export * from`, which is not followed */
function exportsDe(ruta) {
  const src = readFileSync(ruta, "utf8");
  const nombres = new Set();

  for (const m of src.matchAll(/^export\s+(?:async\s+)?(?:function|class|const|let|var)\s+(\w+)/gm)) {
    nombres.add(m[1]);
  }
  // export { a, b as c } [from "..."]
  for (const m of src.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const parte of m[1].split(",")) {
      const n = parte.trim();
      if (n) nombres.add(n.includes(" as ") ? n.split(" as ").pop().trim() : n);
    }
  }
  if (/^export\s+default/m.test(src)) nombres.add("default");

  return { nombres, reexporta: /^export\s*\*/m.test(src) };
}

const cache = new Map();
const exportsCache = (ruta) => {
  if (!cache.has(ruta)) cache.set(ruta, exportsDe(ruta));
  return cache.get(ruta);
};

/**
 * every braced import of a source, static and dynamic
 * the `?v=1.9` cache buster is cut off: it is for Cloudflare Pages, not the file
 */
function importsDe(src) {
  const out = [];
  const guarda = (nombres, destino, dinamico) => {
    if (!destino.startsWith(".")) return;
    for (const parte of nombres.replaceAll("\n", " ").split(",")) {
      const n = parte.trim().split(" as ")[0].trim();
      if (n) out.push({ nombre: n, destino: destino.split("?")[0], dinamico });
    }
  };

  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)) {
    guarda(m[1], m[2], false);
  }
  // const { a, b } = await import("./x.js")
  // `[^{}]` is required: with `[^}]` the capture ate back to the last brace and half a function counted as
  // imported names
  for (const m of src.matchAll(/(?:const|let|var)\s*\{([^{}]*)\}\s*=\s*await\s+import\(\s*["']([^"']+)["']/g)) {
    guarda(m[1], m[2], true);
  }
  return out;
}

const MODS = modules();

test("cada import con nombre existe en el módulo que lo exporta", () => {
  const rotos = [];

  for (const mod of MODS) {
    for (const imp of importsDe(mod.src)) {
      const destino = resolve(dirname(mod.abs), imp.destino);
      if (!existsSync(destino)) {
        rotos.push(`${mod.rel} importa de "${imp.destino}", que no existe`);
        continue;
      }
      const info = exportsCache(destino);
      // with `export * from` it cannot be known without following the chain; taken as good
      if (info.reexporta) continue;
      if (!info.nombres.has(imp.nombre)) {
        rotos.push(
          `${mod.rel}: ${imp.dinamico ? "import() dinámico de" : "importa"} ` +
            `'${imp.nombre}' desde "${imp.destino}", que no lo exporta`,
        );
      }
    }
  }

  assert.deepEqual(
    rotos,
    [],
    "Imports que el navegador no puede resolver (la página entera se queda en blanco, o la\n" +
      "función sale undefined si el import es dinámico):\n  " + rotos.join("\n  ") + "\n",
  );
});

// the detector only counts if it really walks the repo: if `modules()` or the regexes ended up looking at
// zero imports, the test above would always pass
test("el detector está mirando de verdad todo el repo", () => {
  let total = 0;
  for (const mod of MODS) total += importsDe(mod.src).length;

  assert.ok(MODS.length > 50, `solo encontró ${MODS.length} módulos`);
  assert.ok(total > 200, `solo encontró ${total} imports con nombre`);
});

test("el detector reconoce las formas de exportar que usa el repo", () => {
  const casos = [
    ["export function a() {}", "a"],
    ["export const b = 1;", "b"],
    ["export class C {}", "C"],
    ["export async function d() {}", "d"],
    ["export { e };", "e"],
    ["export { f as g };", "g"],
    ['export { h } from "./x.js";', "h"],
    ["export let i = 1;", "i"],
  ];
  for (const [src, esperado] of casos) {
    const { nombres } = { nombres: new Set() };
    for (const m of src.matchAll(/^export\s+(?:async\s+)?(?:function|class|const|let|var)\s+(\w+)/gm)) nombres.add(m[1]);
    for (const m of src.matchAll(/^export\s*\{([^}]*)\}/gm)) {
      for (const parte of m[1].split(",")) {
        const n = parte.trim();
        if (n) nombres.add(n.includes(" as ") ? n.split(" as ").pop().trim() : n);
      }
    }
    assert.ok(nombres.has(esperado), `no detectó '${esperado}' en: ${src}`);
  }
});

test("el detector encuentra los imports estáticos y los dinámicos", () => {
  const src = `
import { a, b as c } from "./uno.js";
import {
  d,
} from "../dos.js?v=1.9";
const { e } = await import("./tres.js");
import externo from "cosa";
`;
  const encontrados = importsDe(src);
  assert.deepEqual(encontrados.map((i) => i.nombre).sort(), ["a", "b", "d", "e"]);
  assert.equal(encontrados.find((i) => i.nombre === "d").destino, "../dos.js",
    "el ?v= de bustear caché no es parte de la ruta");
  assert.equal(encontrados.find((i) => i.nombre === "e").dinamico, true);
});
