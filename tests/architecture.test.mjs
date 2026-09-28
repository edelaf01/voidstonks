// architecture rules measured over deploy/js and compared against tests/_baseline/architecture-debt.json
// the baseline is a ratchet: a new violation turns the test red, and so does a fixed one still listed

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MAX_MODULE_LINES,
  modules,
  layerViolations,
  dynamicLayerCrossings,
  barrelRepositoryReexports,
  duplicateExports,
  servicesTouchingDOM,
  componentsDoingIO,
  oversizeModules,
  looseGlobals,
  untestedModules,
  cssComponentsBeforeBase,
  cssClassClashes,
} from "./_helpers/architecture-rules.mjs";

const BASELINE = JSON.parse(
  readFileSync(new URL("./_baseline/architecture-debt.json", import.meta.url), "utf8"),
);
const BASELINE_PATH = "tests/_baseline/architecture-debt.json";
const MODS = modules();

/** compares current violations with the frozen ones both ways; `regla` is the text shown to whoever breaks the test */
function assertRatchet(key, current, regla) {
  const frozen = new Set(BASELINE[key] ?? []);
  const now = new Set(current);

  const nuevas = current.filter((v) => !frozen.has(v));
  assert.equal(
    nuevas.length,
    0,
    `Regla incumplida por código nuevo:\n\n${regla}\n\nInfracciones nuevas:\n  ${nuevas.join("\n  ")}\n`,
  );

  const saldadas = [...frozen].filter((v) => !now.has(v));
  assert.equal(
    saldadas.length,
    0,
    `Deuda ya arreglada pero todavía listada en ${BASELINE_PATH} → bórrala de "${key}" ` +
      `para que el trinquete no permita reintroducirla:\n  ${saldadas.join("\n  ")}\n`,
  );
}

/** for numeric per-file metrics only the ceiling is watched: these numbers move on every commit */
function assertCeiling(key, current, regla) {
  const frozen = BASELINE[key] ?? {};
  const problemas = [];
  for (const [file, value] of Object.entries(current)) {
    if (!(file in frozen)) problemas.push(`${file}: ${value} (fichero nuevo por encima del límite)`);
    else if (value > frozen[file]) problemas.push(`${file}: ${value} (el baseline lo dejó en ${frozen[file]})`);
  }
  assert.equal(problemas.length, 0, `Regla incumplida:\n\n${regla}\n\n  ${problemas.join("\n  ")}\n`);

  // every frozen key must still violate today, otherwise the baseline could be pre-seeded for a file that does not exist yet
  const fantasma = Object.keys(frozen).filter((file) => !(file in current));
  assert.equal(
    fantasma.length,
    0,
    `Entradas de "${key}" en ${BASELINE_PATH} que ya no infringen nada (o que apuntan a un ` +
      `fichero inexistente) → bórralas, o estarás reservando cupo para código futuro:\n  ${fantasma.join("\n  ")}\n`,
  );
}

test("arquitectura: los imports respetan el contrato de capas", () => {
  assertRatchet(
    "layers",
    layerViolations(MODS),
    "utils/ y repositories/ no importan de ui.components/ ni de services/; services/ no\n" +
      "importa de ui.components/; ui.components/ no importa de repositories/ (pasa por un\n" +
      "service). Si necesitas algo de una capa superior, súbelo de sitio o pásalo por\n" +
      "parámetro.",
  );
});

test("arquitectura: el import() dinámico tampoco salta de capa", () => {
  assertRatchet(
    "dynamicLayerCrossings",
    dynamicLayerCrossings(MODS),
    "Un import() sirve para romper un ciclo, no para saltarse la tabla de capas: si el\n" +
      "destino está prohibido en estático, también lo está en dinámico.",
  );
});

test("arquitectura: api.js no amplía lo que reexporta de repositories/", () => {
  assertRatchet(
    "barrelRepositoryReexports",
    barrelRepositoryReexports(MODS),
    "api.js es una fachada heredada, no un atajo para que un componente llegue al\n" +
      "repositorio. Lo que necesite la UI se expone desde un service.",
  );
});

test("arquitectura: ningún nombre exportado se define en dos módulos", () => {
  assertRatchet(
    "duplicateExports",
    duplicateExports(MODS),
    "Un nombre exportado = un módulo. Si dos sitios necesitan lo mismo, uno importa del\n" +
      "otro. Busca antes de escribir: search_graph(query=\"...\") del MCP, o\n" +
      "grep -rn \"export function nombre\" deploy/js.",
  );
});

test("arquitectura: services/ no toca el DOM", () => {
  assertRatchet(
    "servicesTouchingDOM",
    servicesTouchingDOM(MODS),
    "Un service devuelve datos; decidir qué se enseña es del componente. Nada de\n" +
      "document.*, innerHTML ni showToast() en deploy/js/services/.",
  );
});

test("arquitectura: ui.components/ no hace I/O directo", () => {
  assertRatchet(
    "componentsDoingIO",
    componentsDoingIO(MODS),
    "fetch() y localStorage viven en repositories/ y los orquesta un service.",
  );
});

test(`arquitectura: ningún módulo nuevo pasa de ${MAX_MODULE_LINES} líneas`, () => {
  assertCeiling(
    "oversize",
    oversizeModules(MODS),
    `Un fichero = un componente o un área. Al pasar de ${MAX_MODULE_LINES} líneas se parte\n` +
      "por secciones (ui_rivens_index.js, ui_rivens_grader.js…) y queda un módulo delgado\n" +
      "que compone. Los que ya estaban por encima pueden encoger, no crecer.",
  );
});

test("arquitectura: lo nuevo se publica con exposeGlobals, no con globalThis.X =", () => {
  assertCeiling(
    "looseGlobals",
    looseGlobals(MODS),
    "Si publicas una FUNCIÓN que index.html invoca, va por el registro:\n" +
      '  import { exposeGlobals } from "../utils/global_registry.js";\n' +
      '  exposeGlobals({ miFuncion }, "ui.components/ui_x.js");\n\n' +
      "Si lo que añades es ESTADO compartido (por convención, con guion bajo delante:\n" +
      "_serverTimeOffset, _kubrowHelperCvs), el registro no es su sitio —es para funciones—,\n" +
      "pero tampoco se añade a la ligera: cada uno es un acoplamiento invisible entre módulos.\n" +
      "El contador vigila los dos casos.",
  );
});

test("arquitectura: todo módulo nuevo de lógica entra con su test", () => {
  assertRatchet(
    "untested",
    untestedModules(MODS),
    "Un módulo nuevo en services/, utils/ o repositories/ necesita un tests/<nombre>.test.mjs\n" +
      "que lo importe (node:test + node:assert/strict, sin dependencias). ui.components/ está\n" +
      "exento: lo que se le extraiga, no.",
  );
});

test("arquitectura: ningún componente CSS nuevo se carga antes de styles.css", () => {
  assertRatchet(
    "cssBeforeBase",
    cssComponentsBeforeBase(),
    "Un componente que carga ANTES de styles.css pierde a igualdad de especificidad, o sea\n" +
      "que sus reglas dependen de que nadie repita el selector en la hoja grande. Pon el\n" +
      "<link> nuevo DESPUÉS de styles.css.",
  );
});

test("arquitectura: una clase nueva no se define a la vez en un componente y en styles.css", () => {
  assertRatchet(
    "cssClassClashes",
    cssClassClashes(),
    "Antes de crear una clase, grep del nombre: si ya existe en styles.css, o la reutilizas\n" +
      "de verdad o eliges otro nombre. Y ancla la regla al contenedor de su pestaña\n" +
      "(#orders-content .inv-row) salvo que el nombre sea claramente exclusivo.",
  );
});
