// Los detectores de tests/_helpers/architecture-rules.mjs, comprobados contra fixtures
// sintéticos.
//
// Sin esto, la forma más barata de saltarse ARCHITECTURE.md no es escribir código malo: es
// relajar una regex o añadir "repositories" a LAYERS.ui.allow. Un diff de una línea en un
// fichero de _helpers/ pondría verdes las tres deudas de capa de golpe y ningún test se
// enteraría, porque architecture.test.mjs solo compara el resultado del detector consigo mismo.
//
// Los casos de "no detectado" de aquí abajo no son hipótesis: son las evasiones que se
// probaron una a una contra la primera versión de los detectores y que funcionaban.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  layerViolations,
  dynamicLayerCrossings,
  duplicateExports,
  servicesTouchingDOM,
  componentsDoingIO,
  looseGlobals,
  oversizeModules,
  untestedModules,
  resolveRel,
  staticImportsOf,
  layerOf,
} from "./_helpers/architecture-rules.mjs";

/** Fixture con la forma que esperan los detectores (rel + src + lines). */
const mod = (rel, src) => ({ rel, src, lines: src.split("\n").length, abs: rel });

// Los detectores necesitan que el destino exista en la lista para no confundirlo con un .json
// o algo de fuera de deploy/js, así que los fixtures incluyen siempre el módulo importado.
const DESTINOS = [
  mod("repositories/riven.repository.js", "export const x = 1;\n"),
  mod("ui.components/ui_components.js", "export const y = 1;\n"),
  mod("services/foo.service.js", "export const z = 1;\n"),
];

test("capas: detecta el import prohibido y respeta el permitido", () => {
  const malo = mod("ui.components/ui_x.js", 'import { x } from "../repositories/riven.repository.js";\n');
  assert.deepEqual(layerViolations([...DESTINOS, malo]), [
    "ui.components/ui_x.js -> repositories/riven.repository.js",
  ]);

  const bueno = mod("ui.components/ui_x.js", 'import { z } from "../services/foo.service.js";\n');
  assert.deepEqual(layerViolations([...DESTINOS, bueno]), []);
});

test("capas: una carpeta sin clasificar no tiene barra libre", () => {
  // El fallback antiguo devolvía "app" (que puede importar de todo), así que cualquier
  // carpeta nueva nacía exenta de las reglas sin que nadie lo decidiera.
  assert.equal(layerOf("widgets/w.js"), "unknown");
  assert.equal(layerOf("helpers.js"), "unknown");
  const nuevo = mod("widgets/w.js", 'import { x } from "../repositories/riven.repository.js";\n');
  assert.equal(layerViolations([...DESTINOS, nuevo]).length, 1);
});

test("capas: el import() dinámico se mide aparte, pero se mide", () => {
  const src = 'const { x } = await import("../repositories/riven.repository.js");\n';
  const dinamico = mod("ui.components/ui_x.js", src);
  assert.deepEqual(layerViolations([...DESTINOS, dinamico]), [], "no debe contar como estático");
  assert.deepEqual(dynamicLayerCrossings([...DESTINOS, dinamico]), [
    "ui.components/ui_x.js -> repositories/riven.repository.js",
  ]);
});

test("imports: las formas raras no esconden la dependencia", () => {
  // Un comentario dentro de la lista de nombres cortaba la regex y hacía desaparecer el
  // import entero; y `import{a}from"x"` sin espacios tampoco se veía.
  const conComentario = 'import {\n  a, // ojo: "legacy"\n  b,\n} from "../repositories/riven.repository.js";\n';
  assert.deepEqual(staticImportsOf(conComentario), ["../repositories/riven.repository.js"]);
  assert.deepEqual(staticImportsOf('import{a}from"../repositories/riven.repository.js";\n'), [
    "../repositories/riven.repository.js",
  ]);
  assert.deepEqual(staticImportsOf('export * from "../services/foo.service.js";\n'), [
    "../services/foo.service.js",
  ]);
  assert.deepEqual(staticImportsOf('import x from "../config.js?v=1.9";\n'), ["../config.js"]);
});

test("imports: lo que solo parece un import no cuenta", () => {
  assert.deepEqual(staticImportsOf('// import { x } from "../repositories/riven.repository.js";\n'), []);
  assert.deepEqual(staticImportsOf('/* import { x } from "../repositories/riven.repository.js"; */\n'), []);
  assert.deepEqual(staticImportsOf('const ejemplo = `import { x } from "../repositories/r.js"`;\n'), []);
});

test("resolveRel: normaliza de verdad, incluida la ruta que sale y vuelve a entrar", () => {
  assert.equal(resolveRel("ui.components/ui_x.js", "./ui_y.js"), "ui.components/ui_y.js");
  assert.equal(resolveRel("ui.components/ui_x.js", "../utils/tap.js"), "utils/tap.js");
  assert.equal(resolveRel("ui.components/ui_x.js", "../../js/repositories/r.js"), "repositories/r.js");
  assert.equal(resolveRel("utils/a.js", "../state"), "state.js");
  assert.equal(resolveRel("utils/a.js", "../../../fuera.js"), null);
});

test("duplicados: ve las formas de export que no son declaración", () => {
  const a = mod("utils/a.js", "function calc() {}\nexport { calc };\n");
  const b = mod("utils/b.js", "export function calc() {}\n");
  assert.deepEqual(duplicateExports([a, b]), ["calc: utils/a.js, utils/b.js"]);

  const c = mod("utils/c.js", "const x = 1;\nexport { x as calc };\n");
  assert.equal(duplicateExports([b, c]).length, 1);
});

test("duplicados: un reexport no es una segunda definición", () => {
  // ui_sets.js importa dos utilidades y las vuelve a exportar. Sigue habiendo una sola
  // definición: contarlo como duplicado metería una mentira permanente en el baseline.
  const util = mod("utils/u.js", "export function calc() {}\n");
  const comp = mod("ui.components/ui_x.js", 'import { calc } from "../utils/u.js";\nexport { calc };\n');
  assert.deepEqual(duplicateExports([util, comp]), []);

  const barrel = mod("api.js", 'export { calc } from "./utils/u.js";\n');
  assert.deepEqual(duplicateExports([util, barrel]), []);
});

test("DOM en services: distingue el uso real de la palabra escrita", () => {
  const real = mod("services/a.service.js", "export function f() { document.body.innerHTML = ''; }\n");
  assert.deepEqual(servicesTouchingDOM([real]), ["services/a.service.js"]);

  const falso = mod(
    "services/b.service.js",
    '// devuelve el innerHTML que pintará el componente\nconst SEL = "document.querySelector";\nexport const f = () => SEL;\n',
  );
  assert.deepEqual(servicesTouchingDOM([falso]), []);
  // documentFragment no es document.
  assert.deepEqual(servicesTouchingDOM([mod("services/c.service.js", "const d = documentFragment;\n")]), []);
});

test("I/O en componentes: cubre las vías que no son fetch() a secas", () => {
  const casos = [
    "await fetch(url);",
    "await window.fetch(url);",
    "await globalThis.fetch(url);",
    'localStorage.setItem("k", 1);',
    'sessionStorage.setItem("k", 1);',
    'localStorage["k"] = 1;',
    "new XMLHttpRequest();",
    "new WebSocket(url);",
    "navigator.sendBeacon(url);",
  ];
  for (const caso of casos) {
    assert.deepEqual(
      componentsDoingIO([mod("ui.components/ui_x.js", `export function f(url) { ${caso} }\n`)]),
      ["ui.components/ui_x.js"],
      `no detectado: ${caso}`,
    );
  }

  // Lo que se le parece pero no lo es.
  for (const caso of ["prefetch(url);", "this.fetch(url);", "refetchData();", 'const K = "localStorage.theme";']) {
    assert.deepEqual(
      componentsDoingIO([mod("ui.components/ui_x.js", `export function f(url) { ${caso} }\n`)]),
      [],
      `falso positivo: ${caso}`,
    );
  }
});

test("globals: cuenta los alias de la asignación a pelo", () => {
  const casos = [
    "globalThis.miFn = miFn;",
    "window.miFn = miFn;",
    'globalThis["miFn"] = miFn;',
    "Object.assign(globalThis, { miFn });",
  ];
  for (const caso of casos) {
    assert.deepEqual(
      looseGlobals([mod("ui.components/ui_x.js", `${caso}\n`)]),
      { "ui.components/ui_x.js": 1 },
      `no detectado: ${caso}`,
    );
  }
  // Un comentario que lo menciona no es una asignación.
  assert.deepEqual(looseGlobals([mod("ui.components/ui_x.js", "// antes: globalThis.miFn = miFn\n")]), {});
  // Comparar no es asignar.
  assert.deepEqual(looseGlobals([mod("ui.components/ui_x.js", "if (globalThis.miFn === x) {}\n")]), {});
});

// Varios tests componen la ruta (`new URL("js/utils/x.js", P)` con P = "../deploy/"), así que
// exigir el prefijo "deploy/" daba por no testeados módulos que sí se importan y ejecutan.
// Pasó con utils/platform.js, que lleva 8 tests desde antes de que existiera esta regla.
test("cobertura: cuenta la ruta compuesta, no solo la literal completa", () => {
  const util = mod("utils/x.js", "export const a = 1;\n");
  assert.deepEqual(untestedModules([util]), ["utils/x.js"], "hoy nadie lo importa");
  // El propio fichero de este test menciona deploy/js/utils/tap.js en su import, así que sirve
  // de caso real: tap.js no puede salir como no testeado.
  assert.ok(!untestedModules().includes("utils/tap.js"));
  assert.ok(!untestedModules().includes("utils/platform.js"));
});

// El límite de 800 líneas existe porque un módulo de lógica enorme son varias pantallas
// mezcladas. Una tabla de traducciones de 1600 líneas se lee por la clave que buscas, así que
// assets/ está exento — pero solo assets/: sin esa frontera, "muevo esto a assets/" sería la
// forma de saltarse el límite.
test("tamaño: assets/ está exento, el resto no", () => {
  const tabla = mod("assets/texts.js", "export const T = {};\n".repeat(1000));
  assert.deepEqual(oversizeModules([tabla]), {});

  const codigo = mod("utils/gordo.js", "export const a = 1;\n".repeat(1000));
  assert.equal(oversizeModules([codigo])["utils/gordo.js"], codigo.lines);
});

test("el stripper no se come una línea por culpa de una expresión regular", () => {
  // /\/\// contiene dos barras seguidas: tomarlas por el principio de un comentario borraba
  // el resto de la línea y con él cualquier import o global que viniera detrás.
  const src = 'const re = /https:\\/\\//; globalThis.miFn = miFn;\n';
  assert.deepEqual(looseGlobals([mod("ui.components/ui_x.js", src)]), { "ui.components/ui_x.js": 1 });
});
