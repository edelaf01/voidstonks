// Las reglas de ARCHITECTURE.md, comprobadas. Una regla que solo está escrita se erosiona:
// nadie relee un .md antes de añadir un import.
//
// Cómo funciona: cada regla se mide sobre deploy/js y se compara contra
// tests/_baseline/architecture-debt.json, que congela las infracciones que YA existían el
// día que se escribió esto. Sin ese baseline no habría forma de adoptar las reglas sin un
// refactor gigante primero, y el refactor nunca llega.
//
// El baseline es un trinquete, no un silenciador:
//   - una infracción nueva -> test rojo,
//   - una infracción arreglada pero aún listada -> test rojo (obliga a borrarla del JSON).
// Así el número solo puede bajar.

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

/**
 * Compara la lista actual de infracciones contra la congelada, en los dos sentidos.
 * `regla` es el texto que se le enseña a quien rompe el test, así que dice qué hacer.
 */
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

/**
 * Variante para métricas numéricas por fichero (líneas, nº de globals). Aquí solo se vigila
 * el techo: mejorar no debe poner el test en rojo, porque estos números se mueven en cada
 * commit y obligar a actualizar el baseline por cada línea borrada sería insufrible.
 */
function assertCeiling(key, current, regla) {
  const frozen = BASELINE[key] ?? {};
  const problemas = [];
  for (const [file, value] of Object.entries(current)) {
    if (!(file in frozen)) problemas.push(`${file}: ${value} (fichero nuevo por encima del límite)`);
    else if (value > frozen[file]) problemas.push(`${file}: ${value} (el baseline lo dejó en ${frozen[file]})`);
  }
  assert.equal(problemas.length, 0, `Regla incumplida:\n\n${regla}\n\n  ${problemas.join("\n  ")}\n`);

  // Sin esto se podía presembrar el baseline: una entrada para un fichero que aún no existe
  // (o que ya no infringe) nunca se miraba, así que "ui_nuevo.js": 5000 lo dejaba nacer con
  // 5000 líneas. Exigir que toda clave congelada siga infringiendo hoy cierra las dos vías.
  const fantasma = Object.keys(frozen).filter((file) => !(file in current));
  assert.equal(
    fantasma.length,
    0,
    `Entradas de "${key}" en ${BASELINE_PATH} que ya no infringen nada (o que apuntan a un ` +
      `fichero inexistente) → bórralas, o estarás reservando cupo para código futuro:\n  ${fantasma.join("\n  ")}\n`,
  );
}

// ---------------------------------------------------------------------------

// El contrato de capas está en LAYERS (tests/_helpers/architecture-rules.mjs). El caso que
// más duele: un ui.component que llama al repositorio directo se salta la lógica del
// service, así que la misma consulta acaba implementada dos veces con reglas distintas.
test("arquitectura: los imports respetan el contrato de capas", () => {
  assertRatchet(
    "layers",
    layerViolations(MODS),
    "utils/ y repositories/ no importan de ui.components/ ni de services/; services/ no\n" +
      "importa de ui.components/; ui.components/ no importa de repositories/ (pasa por un\n" +
      "service). Si necesitas algo de una capa superior, súbelo de sitio o pásalo por\n" +
      "parámetro. Ver ARCHITECTURE.md §A.",
  );
});

// `import()` dinámico es la salida legítima a un ciclo, pero sin vigilarlo el trinquete se
// esquiva con un cambio mecánico: conviertes el import estático prohibido en dinámico, el test
// de capas se pone verde, borras la entrada del baseline y la regla ya no se puede reintroducir.
test("arquitectura: el import() dinámico tampoco salta de capa", () => {
  assertRatchet(
    "dynamicLayerCrossings",
    dynamicLayerCrossings(MODS),
    "Un import() sirve para romper un ciclo, no para saltarse la tabla de capas: si el\n" +
      "destino está prohibido en estático, también lo está en dinámico.\n" +
      "Ver ARCHITECTURE.md §A.",
  );
});

// La otra vía de lavado: ui.components/ no puede importar de repositories/, pero sí de api.js,
// y api.js reexporta repositorios. Congelar qué reexporta impide que la puerta se ensanche.
test("arquitectura: api.js no amplía lo que reexporta de repositories/", () => {
  assertRatchet(
    "barrelRepositoryReexports",
    barrelRepositoryReexports(MODS),
    "api.js es una fachada heredada, no un atajo para que un componente llegue al\n" +
      "repositorio. Lo que necesite la UI se expone desde un service. Ver DEUDA.md §8.",
  );
});

// Pasó de verdad: calculateHybridTiers vive en services/rivens.service.js Y en
// utils/riven_logic.js con firmas distintas. La del service está muerta, pero quien la abre
// cree estar leyendo la que corre.
test("arquitectura: ningún nombre exportado se define en dos módulos", () => {
  assertRatchet(
    "duplicateExports",
    duplicateExports(MODS),
    "Un nombre exportado = un módulo. Si dos sitios necesitan lo mismo, uno importa del\n" +
      "otro. Busca antes de escribir: search_graph(query=\"...\") del MCP, o\n" +
      "grep -rn \"export function nombre\" deploy/js. Ver ARCHITECTURE.md §C.",
  );
});

// Un service que pinta un toast no se puede reutilizar desde otra pantalla ni testear sin
// DOM, que es justo lo que hace testeable a la capa de lógica.
test("arquitectura: services/ no toca el DOM", () => {
  assertRatchet(
    "servicesTouchingDOM",
    servicesTouchingDOM(MODS),
    "Un service devuelve datos; decidir qué se enseña es del componente. Nada de\n" +
      "document.*, innerHTML ni showToast() en deploy/js/services/. Ver ARCHITECTURE.md §A.",
  );
});

// El componente que hace su propio fetch se salta la caché, el timeout y el manejo de
// errores del repositorio, y reaparece el mismo bug arreglado en otra pestaña.
test("arquitectura: ui.components/ no hace I/O directo", () => {
  assertRatchet(
    "componentsDoingIO",
    componentsDoingIO(MODS),
    "fetch() y localStorage viven en repositories/ y los orquesta un service.\n" +
      "Ver ARCHITECTURE.md §A.",
  );
});

// Un módulo de 5900 líneas ya no es un componente: son varias pestañas juntas, y cualquier
// cambio obliga a leerlo entero para saber qué más se rompe.
test(`arquitectura: ningún módulo nuevo pasa de ${MAX_MODULE_LINES} líneas`, () => {
  assertCeiling(
    "oversize",
    oversizeModules(MODS),
    `Un fichero = un componente o un área. Al pasar de ${MAX_MODULE_LINES} líneas se parte\n` +
      "por secciones (ui_rivens_index.js, ui_rivens_grader.js…) y queda un módulo delgado\n" +
      "que compone. Los que ya estaban por encima pueden encoger, no crecer.\n" +
      "Ver ARCHITECTURE.md §B.",
  );
});

// El registro avisa cuando dos módulos publican el mismo nombre; la asignación a pelo deja
// que el segundo pise al primero en silencio (ver tests/global-registry.test.mjs).
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
      "El contador vigila los dos casos. Ver ARCHITECTURE.md §D.",
  );
});

// La lógica sin test es la que se rompe al refactorizar: no hay navegador en CI que la pille.
test("arquitectura: todo módulo nuevo de lógica entra con su test", () => {
  assertRatchet(
    "untested",
    untestedModules(MODS),
    "Un módulo nuevo en services/, utils/ o repositories/ necesita un tests/<nombre>.test.mjs\n" +
      "que lo importe (node:test + node:assert/strict, sin dependencias). ui.components/ está\n" +
      "exento: lo que se le extraiga, no. Ver ARCHITECTURE.md §E.",
  );
});

// Las hojas de css/components/ NO están aisladas: comparten cascada con styles.css, así que a
// igualdad de especificidad gana la que se cargue después. Que el ganador dependa de la línea
// del <link> hace impredecible tocar cualquier regla, y ya mordió: orders.css definía .inv-row /
// .inv-name / .inv-meta, que también son las filas del panel lateral de reliquias.
test("arquitectura: ningún componente CSS nuevo se carga antes de styles.css", () => {
  assertRatchet(
    "cssBeforeBase",
    cssComponentsBeforeBase(),
    "Un componente que carga ANTES de styles.css pierde a igualdad de especificidad, o sea\n" +
      "que sus reglas dependen de que nadie repita el selector en la hoja grande. Pon el\n" +
      "<link> nuevo DESPUÉS de styles.css. Ver DEUDA.md §8.",
  );
});

// El conteo mira solo las clases definidas FUERA de @media: las de dentro son overrides
// responsive y no compiten en la misma cascada (de las 19 clases de header.css, 15 eran de
// esas). Cada choque que queda es una regla cuyo ganador decide el orden de carga.
test("arquitectura: una clase nueva no se define a la vez en un componente y en styles.css", () => {
  assertRatchet(
    "cssClassClashes",
    cssClassClashes(),
    "Antes de crear una clase, grep del nombre: si ya existe en styles.css, o la reutilizas\n" +
      "de verdad o eliges otro nombre. Y ancla la regla al contenedor de su pestaña\n" +
      "(#orders-content .inv-row) salvo que el nombre sea claramente exclusivo.\n" +
      "Ver ARCHITECTURE.md §F y DEUDA.md §8.",
  );
});
