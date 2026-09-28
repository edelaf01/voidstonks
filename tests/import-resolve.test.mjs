import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { modules } from "./_helpers/architecture-rules.mjs";

function nombresExportados(src) {
  const nombres = new Set();
  for (const m of src.matchAll(/^export\s+(?:async\s+)?(?:function|class|const|let|var)\s+(\w+)/gm)) {
    nombres.add(m[1]);
  }
  for (const m of src.matchAll(/^export\s+(?:const|let|var)\s+([^;\n]+)/gm)) {
    let decl = m[1];
    while (/[([{][^()[\]{}]*[)\]}]/.test(decl)) decl = decl.replace(/[([{][^()[\]{}]*[)\]}]/g, "");
    for (const d of decl.split(",")) {
      const n = /^\s*(\w+)\s*=/.exec(d)?.[1];
      if (n) nombres.add(n);
    }
  }
  for (const m of src.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const parte of m[1].split(",")) {
      const n = parte.trim();
      if (n) nombres.add(n.includes(" as ") ? n.split(" as ").pop().trim() : n);
    }
  }
  if (/^export\s+default/m.test(src)) nombres.add("default");
  return nombres;
}

function exportsDe(ruta) {
  const src = readFileSync(ruta, "utf8");
  return { nombres: nombresExportados(src), reexporta: /^export\s*\*/m.test(src) };
}

const cache = new Map();
const exportsCache = (ruta) => {
  if (!cache.has(ruta)) cache.set(ruta, exportsDe(ruta));
  return cache.get(ruta);
};

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
    ["export const COLS = 160, FILAS = 10;", "FILAS"],
    ["export const L = Object.freeze({ x: 1, y: 2 }), M = [1, 2];", "M"],
  ];
  for (const [src, esperado] of casos) {
    assert.ok(nombresExportados(src).has(esperado), `no detectó '${esperado}' en: ${src}`);
  }
  assert.ok(!nombresExportados("export const L = Object.freeze({ x: 1, y: 2 });").has("y"), "lo de dentro de las llaves no es una declaración");
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
