// Que cada `import { X } from "./y.js"` encuentre de verdad una `X` exportada en `y.js`.
//
// Es el fallo que se cuela por TODOS los filtros del repo: el lint no resuelve módulos, el
// `node --check` solo mira sintaxis, la suite no importa los ui.components (están exentos), y
// `import-graph.test.mjs` mira quién importa a quién, no qué. Solo aparece al recargar el
// navegador, y cuando aparece **tumba la app entera**:
//
//   Uncaught SyntaxError: The requested module './ui_ducanator.js' does not
//   provide an export named 'getPartDucats'
//
// Pasó dos veces al trocear módulos grandes: una función se lleva a su fichero nuevo y se queda
// sin `export`, o el import se deja apuntando al módulo viejo, que ya no la tiene.
//
// El caso hermano, y el más traicionero, es el `import()` DINÁMICO: ahí ni siquiera hay
// SyntaxError. El módulo carga, el destructuring da `undefined` y la llamada revienta cuando el
// usuario pulsa el botón, semanas después.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { modules } from "./_helpers/architecture-rules.mjs";

/** Nombres que un módulo exporta. `reexporta` marca los `export * from`, que no se resuelven. */
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
 * Todos los imports con llaves de un fuente, estáticos y dinámicos.
 * El `?v=1.9` de bustear caché se recorta: es de Cloudflare Pages, no del fichero.
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
  // El `[^{}]` es obligatorio: con `[^}]` la captura se comía hacia atrás todo lo que hubiera
  // desde la última llave, y media función acababa contada como "nombre importado".
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
      // Con un `export * from` no se puede saber sin seguir la cadena; se da por bueno.
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

// El detector solo vale si de verdad recorre el repo: si un cambio en `modules()` o en las
// regex lo dejara mirando cero imports, el test de arriba pasaría siempre.
test("el detector está mirando de verdad todo el repo", () => {
  let total = 0;
  for (const mod of MODS) total += importsDe(mod.src).length;

  assert.ok(MODS.length > 50, `solo encontró ${MODS.length} módulos`);
  assert.ok(total > 200, `solo encontró ${total} imports con nombre`);
});

// Comprobaciones del propio detector, sobre fuentes de mentira.
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
    // Se reusa la misma lógica que arriba escribiendo a un temporal sería más caro que
    // repetirla; en su lugar se comprueba con las mismas regex.
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
