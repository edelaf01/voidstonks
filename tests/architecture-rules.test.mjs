// the detectors in _helpers/architecture-rules.mjs checked against synthetic fixtures
// loosening a regex there would turn every layer debt green and no other test would notice

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

const mod = (rel, src) => ({ rel, src, lines: src.split("\n").length, abs: rel });

// the import target must be in the list or it is taken for a .json or something outside deploy/js
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
  assert.deepEqual(looseGlobals([mod("ui.components/ui_x.js", "// antes: globalThis.miFn = miFn\n")]), {});
  assert.deepEqual(looseGlobals([mod("ui.components/ui_x.js", "if (globalThis.miFn === x) {}\n")]), {});
});

test("cobertura: cuenta la ruta compuesta, no solo la literal completa", () => {
  const util = mod("utils/x.js", "export const a = 1;\n");
  assert.deepEqual(untestedModules([util]), ["utils/x.js"], "hoy nadie lo importa");
  assert.ok(!untestedModules().includes("utils/tap.js"));
});

test("tamaño: assets/ está exento, el resto no", () => {
  const tabla = mod("assets/texts.js", "export const T = {};\n".repeat(1000));
  assert.deepEqual(oversizeModules([tabla]), {});

  const codigo = mod("utils/gordo.js", "export const a = 1;\n".repeat(1000));
  assert.equal(oversizeModules([codigo])["utils/gordo.js"], codigo.lines);
});

test("el stripper no se come una línea por culpa de una expresión regular", () => {
  const src = 'const re = /https:\\/\\//; globalThis.miFn = miFn;\n';
  assert.deepEqual(looseGlobals([mod("ui.components/ui_x.js", src)]), { "ui.components/ui_x.js": 1 });
});
