// Detectores de las reglas de ARCHITECTURE.md.
//
// Vive en _helpers/ (no lo ejecuta `node --test`) porque lo usan tres consumidores:
// architecture.test.mjs, que compara contra tests/_baseline/architecture-debt.json;
// architecture-rules.test.mjs, que comprueba que estos detectores detectan; y el comando que
// regenera el baseline. Si la detección viviera dentro del test, medir la deuda y comprobarla
// podrían divergir sin que nadie se enterase.

import { readdirSync, lstatSync, readFileSync } from "node:fs";
import { join, resolve, relative, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const JS_ROOT = fileURLToPath(new URL("../../deploy/js", import.meta.url));
export const TESTS_ROOT = fileURLToPath(new URL("..", import.meta.url));

// Vendored: no son fuente propia y falsean cualquier métrica (tesseract.min.js son 5 MB en
// una línea). Lista explícita a propósito: un patrón por subcadena dejaría fuera de TODAS las
// reglas a cualquier fichero futuro que se llamase, p. ej., ui_tesseract_panel.js.
const VENDORED = new Set(["tesseract.min.js", "tesseract-core.wasm.js"]);

function walk(dir, keep) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    // lstat, no stat: un symlink circular colgaría la recursión.
    const st = lstatSync(p);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) out.push(...walk(p, keep));
    else if (keep(p)) out.push(p);
  }
  return out;
}

const toPosix = (p) => p.split(sep).join("/");

/** Todos los módulos propios de deploy/js, con su ruta relativa, fuente y nº de líneas. */
export function modules() {
  return walk(JS_ROOT, (p) => p.endsWith(".js") && !VENDORED.has(p.slice(p.lastIndexOf(sep) + 1)))
    .map((abs) => {
      const src = readFileSync(abs, "utf8");
      // Mismo criterio que `wc -l`: el salto final no abre una línea nueva. Sin esto todos
      // los tamaños salen uno de más y no cuadran con lo que dice cualquier otra herramienta.
      const lines = src.split("\n").length - (src.endsWith("\n") ? 1 : 0);
      return { abs, rel: toPosix(relative(JS_ROOT, abs)), src, lines };
    });
}

// ---------------------------------------------------------------------------
// Normalización: comentarios y literales fuera
// ---------------------------------------------------------------------------

// Sin esto los detectores son a la vez ciegos y paranoicos, y las dos cosas se comprobaron:
//   - `// import { x } from "../repositories/y.js"` se contaba como violación real,
//   - y al revés, un comentario DENTRO de la lista de nombres de un import multilínea
//     (`import {\n a, // legacy\n b\n} from "..."`) hacía desaparecer la dependencia entera,
//     porque la comilla del comentario cortaba la regex.
// Los literales de regex se reconocen aparte: si no, el `//` de /https:\/\// se tomaría por
// el principio de un comentario y se comería el resto de la línea.
const BEFORE_REGEX = new Set(["(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", "\n", "+", "-", "*", "%", "<", ">", "~", "^"]);

function strip(src, { strings }) {
  let out = "";
  let i = 0;
  let lastCode = "\n"; // último carácter significativo, para distinguir regex de división
  const blank = (ch) => (ch === "\n" ? "\n" : " "); // conserva líneas y offsets

  while (i < src.length) {
    const c = src[i];
    const c2 = src[i + 1];

    if (c === "/" && c2 === "/") {
      while (i < src.length && src[i] !== "\n") out += blank(src[i++]);
      continue;
    }
    if (c === "/" && c2 === "*") {
      out += "  ";
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) out += blank(src[i++]);
      out += "  ";
      i += 2;
      continue;
    }
    if (c === "/" && BEFORE_REGEX.has(lastCode)) {
      out += c;
      i++;
      while (i < src.length && src[i] !== "\n") {
        if (src[i] === "\\") { out += src[i] + (src[i + 1] ?? ""); i += 2; continue; }
        out += src[i];
        if (src[i++] === "/") break;
      }
      lastCode = "/";
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      // Los literales de plantilla se vacían siempre: un specifier de import nunca va en
      // backticks, así que conservarlos solo sirve para que un ejemplo de código dentro de
      // una plantilla se cuente como dependencia real.
      const keep = strings && quote !== "`";
      out += keep ? c : blank(c);
      i++;
      while (i < src.length) {
        if (src[i] === "\\") {
          out += keep ? src[i] + (src[i + 1] ?? "") : "  ";
          i += 2;
          continue;
        }
        if (src[i] === quote) { out += keep ? src[i] : blank(src[i]); i++; break; }
        out += keep ? src[i] : blank(src[i]);
        i++;
      }
      lastCode = quote;
      continue;
    }
    out += c;
    if (!/\s/.test(c)) lastCode = c;
    else if (c === "\n") lastCode = "\n";
    i++;
  }
  return out;
}

/** Fuente sin comentarios, con los literales intactos (para leer specifiers de import). */
const codeWithStrings = (src) => strip(src, { strings: true });
/** Fuente sin comentarios ni literales (para buscar usos reales de una API). */
const codeOnly = (src) => strip(src, { strings: false });

// ---------------------------------------------------------------------------
// Capas
// ---------------------------------------------------------------------------

// El contrato de ARCHITECTURE.md §A, en datos. `allow` es la lista blanca completa de capas
// que cada una puede importar; todo lo que no esté es violación.
const LAYERS = {
  // `assets` son módulos de datos (imágenes en base64, tablas): sin dependencias, los importa
  // cualquiera, igual que un .json.
  assets: { allow: [] },
  store: { allow: ["assets"] },
  core: { allow: ["assets", "store", "utils"] }, // config.js / state.js
  utils: { allow: ["assets", "store", "core", "utils"] },
  repositories: { allow: ["assets", "store", "core", "utils", "repositories"] },
  services: { allow: ["assets", "store", "core", "utils", "repositories", "services"] },
  barrel: { allow: ["assets", "store", "core", "utils", "repositories", "services"] }, // api.js
  ui: { allow: ["assets", "store", "core", "utils", "services", "barrel", "ui"] },
  // scanner/ y app (ui.js, main.js) orquestan: componen todas las capas a propósito.
  scanner: { allow: ["assets", "store", "core", "utils", "repositories", "services", "barrel", "ui", "scanner"] },
  app: { allow: ["assets", "store", "core", "utils", "repositories", "services", "barrel", "ui", "scanner", "app"] },
  // Carpeta o fichero suelto que nadie ha clasificado. No puede importar nada: obliga a
  // decidir su capa aquí en vez de heredar barra libre por descuido.
  unknown: { allow: [] },
};

const FOLDER_LAYER = {
  assets: "assets",
  store: "store",
  utils: "utils",
  repositories: "repositories",
  services: "services",
  "ui.components": "ui",
  scanner: "scanner",
};
const ROOT_LAYER = {
  "config.js": "core",
  "state.js": "core",
  "api.js": "barrel",
  "ui.js": "app",
  "main.js": "app",
};

export function layerOf(rel) {
  if (rel.includes("/")) return FOLDER_LAYER[rel.slice(0, rel.indexOf("/"))] ?? "unknown";
  return ROOT_LAYER[rel] ?? "unknown";
}

// Quita el `?v=1.9` de bustear caché de Cloudflare Pages antes de resolver la ruta.
const cleanSpec = (spec) => spec.split("?")[0].split("#")[0];

const RELATIVE = (s) => s.startsWith("./") || s.startsWith("../");

/** Specifiers relativos de los imports/export-from ESTÁTICOS. */
export function staticImportsOf(src) {
  const code = codeWithStrings(src);
  const specs = [];
  // Sin `\s+` obligatorio tras import/export: `import{a}from"x"` es válido y se colaba.
  const patterns = [
    /(?:^|[^.\w$])import\s*(?:[\s\S]*?\bfrom\s*)?['"]([^'"]+)['"]/g,
    /(?:^|[^.\w$])export\s*[\s\S]*?\bfrom\s*['"]([^'"]+)['"]/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(code))) specs.push(m[1]);
  }
  return [...new Set(specs.filter(RELATIVE).map(cleanSpec))];
}

/** Specifiers relativos de los `import()` dinámicos con literal. */
export function dynamicImportsOf(src) {
  const code = codeWithStrings(src);
  const specs = [];
  const re = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  let m;
  while ((m = re.exec(code))) specs.push(m[1]);
  return [...new Set(specs.filter(RELATIVE).map(cleanSpec))];
}

/** Ruta relativa a deploy/js del destino de un import, o null si cae fuera del árbol. */
export function resolveRel(fromRel, spec) {
  // resolve() normaliza de verdad: `../../js/repositories/x.js` desde ui.components/ sale y
  // vuelve a entrar, y una pila de segmentos lo daba por "fuera de deploy/js".
  const abs = resolve(JS_ROOT, dirname(fromRel), spec);
  const rel = toPosix(relative(JS_ROOT, abs));
  if (!rel || rel.startsWith("..")) return null;
  return rel.endsWith(".js") ? rel : `${rel}.js`;
}

function crossings(mods, importsOf) {
  const known = new Set(mods.map((m) => m.rel));
  const out = new Set();
  for (const mod of mods) {
    const from = layerOf(mod.rel);
    for (const spec of importsOf(mod.src)) {
      const target = resolveRel(mod.rel, spec);
      if (!target || !known.has(target)) continue; // vendored, .json, fuera de deploy/js
      const to = layerOf(target);
      if (!LAYERS[from].allow.includes(to)) out.add(`${mod.rel} -> ${target}`);
    }
  }
  return [...out].sort();
}

/** Imports estáticos que cruzan el contrato de capas. */
export const layerViolations = (mods = modules()) => crossings(mods, staticImportsOf);

/**
 * Lo mismo por vía dinámica. Se mide aparte porque `import()` es la salida legítima a un ciclo
 * (rivens.service ↔ riven_market.service la usan a propósito), pero sin vigilarlo cualquier
 * deuda congelada se "arregla" cambiando el import estático por uno dinámico: test verde,
 * entrada fuera del baseline y acoplamiento intacto.
 */
export const dynamicLayerCrossings = (mods = modules()) => crossings(mods, dynamicImportsOf);

/**
 * Símbolos que api.js reexporta desde repositories/. Es el otro lavado posible: ui.components/
 * tiene prohibido importar de repositories/, pero puede importar de api.js, y api.js reexporta
 * repositorios. Congelar la lista impide que la puerta se ensanche.
 */
export function barrelRepositoryReexports(mods = modules()) {
  const api = mods.find((m) => m.rel === "api.js");
  if (!api) return [];
  const out = [];
  const re = /export\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;
  let m;
  const code = codeWithStrings(api.src);
  while ((m = re.exec(code))) {
    const target = resolveRel("api.js", cleanSpec(m[2]));
    if (!target || layerOf(target) !== "repositories") continue;
    for (const raw of m[1].split(",")) {
      const name = raw.trim().split(/\s+as\s+/).pop().trim();
      if (name) out.push(`${name} <- ${target}`);
    }
  }
  return [...new Set(out)].sort();
}

// ---------------------------------------------------------------------------
// Duplicación
// ---------------------------------------------------------------------------

/** Nombres exportados definidos en más de un módulo, como "nombre: fichero, fichero". */
export function duplicateExports(mods = modules()) {
  const byName = new Map();
  const add = (name, rel) => {
    if (!byName.has(name)) byName.set(name, new Set());
    byName.get(name).add(rel);
  };

  for (const mod of mods) {
    const code = codeWithStrings(mod.src);
    let m;

    const decl = /(?:^|\n)\s*export\s+(?:async\s+)?(?:function\s*\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g;
    while ((m = decl.exec(code))) add(m[1], mod.rel);

    const def = /(?:^|\n)\s*export\s+default\s+(?:async\s+)?(?:function\s*\*?|class)\s+([A-Za-z_$][\w$]*)/g;
    while ((m = def.exec(code))) add(m[1], mod.rel);

    // `export { calc }` / `export { x as calc }`, pero NO `export { x } from "..."`: eso es un
    // reexport, no una segunda definición (api.js reexporta media app y no es un duplicado).
    // Tampoco cuenta el reexport en dos pasos —importar arriba y `export { x }` abajo, como hace
    // ui_sets.js:680 con las utilidades de relic_drop_odds—: sigue habiendo una sola definición.
    const imported = new Set();
    const imp = /import\s*\{([^}]*)\}\s*from/g;
    while ((m = imp.exec(code))) {
      for (const raw of m[1].split(",")) {
        const name = raw.trim().split(/\s+as\s+/).pop().trim();
        if (name) imported.add(name);
      }
    }

    const list = /(?:^|\n)\s*export\s*\{([^}]*)\}\s*(?!\s*from)/g;
    while ((m = list.exec(code))) {
      for (const raw of m[1].split(",")) {
        const name = raw.trim().split(/\s+as\s+/).pop().trim();
        if (name && name !== "default" && !imported.has(name)) add(name, mod.rel);
      }
    }
  }

  return [...byName]
    .filter(([, files]) => files.size > 1)
    .map(([name, files]) => `${name}: ${[...files].sort().join(", ")}`)
    .sort();
}

// ---------------------------------------------------------------------------
// Separación DOM / I/O
// ---------------------------------------------------------------------------

const DOM_IN_SERVICE = /\bdocument\s*[.[]|innerHTML|\bshowToast\s*\(/;

// Todas las vías de I/O, no solo `fetch(`: el lookbehind que evita confundir `this.fetch(` con
// la API global es justo lo que dejaba pasar `window.fetch(`, y sin nombrar sessionStorage o
// XMLHttpRequest la regla se esquiva sin querer.
const IO_IN_COMPONENT = new RegExp(
  [
    /(?<![.\w$])fetch\s*\(/.source,
    /\b(?:window|globalThis|self)\s*\.\s*fetch\s*\(/.source,
    /\b(?:localStorage|sessionStorage|indexedDB)\s*[.[]/.source,
    /\bnew\s+(?:XMLHttpRequest|WebSocket|EventSource)\b/.source,
    /\bnavigator\s*\.\s*sendBeacon\b/.source,
  ].join("|"),
);

export function servicesTouchingDOM(mods = modules()) {
  return mods
    .filter((m) => m.rel.startsWith("services/") && DOM_IN_SERVICE.test(codeOnly(m.src)))
    .map((m) => m.rel)
    .sort();
}

export function componentsDoingIO(mods = modules()) {
  return mods
    .filter((m) => m.rel.startsWith("ui.components/") && IO_IN_COMPONENT.test(codeOnly(m.src)))
    .map((m) => m.rel)
    .sort();
}

// ---------------------------------------------------------------------------
// Tamaño y globals
// ---------------------------------------------------------------------------

export const MAX_MODULE_LINES = 800;

const sortedKeys = (obj) => Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)));

/**
 * { fichero: líneas } de los módulos que pasan del límite.
 *
 * `assets/` queda fuera: son tablas de datos sin dependencias (traducciones, changelog, una
 * imagen en base64), y el límite existe porque un fichero de 5900 líneas de LÓGICA son varias
 * pantallas mezcladas que hay que leer enteras para tocar una. Una tabla de 1600 líneas se lee
 * por la clave que buscas. Si un día algo de assets/ tiene código, deja de ser un asset.
 */
export function oversizeModules(mods = modules()) {
  const out = {};
  for (const m of mods) {
    if (layerOf(m.rel) === "assets") continue;
    if (m.lines > MAX_MODULE_LINES) out[m.rel] = m.lines;
  }
  return sortedKeys(out);
}

// Publicar a pelo en el objeto global. El registro (utils/global_registry.js) hace lo mismo
// pero avisa si dos módulos publican el mismo nombre; sin él, el segundo pisa al primero en
// silencio. Cuenta también `window.x =`, el acceso por corchetes y Object.assign(globalThis…),
// que son la misma cosa escrita de otra forma.
const LOOSE_GLOBAL = new RegExp(
  [
    /(?:globalThis|window)\s*\.\s*[A-Za-z_$][\w$]*\s*=(?!=)/.source,
    // El corchete va con `[^\]]*` y no con un literal de cadena porque esta regex se aplica
    // sobre la fuente ya vaciada de literales: `globalThis["x"]` llega aquí como `globalThis[ ]`.
    /(?:globalThis|window)\s*\[[^\]]*\]\s*=(?!=)/.source,
    /\bObject\s*\.\s*assign\s*\(\s*(?:globalThis|window)\b/.source,
  ].join("|"),
  "g",
);

/** { fichero: nº de asignaciones sueltas }. */
export function looseGlobals(mods = modules()) {
  const out = {};
  for (const m of mods) {
    // global_registry.js queda fuera porque asignar es literalmente su trabajo.
    if (m.rel === "utils/global_registry.js") continue;
    const n = (codeOnly(m.src).match(LOOSE_GLOBAL) || []).length;
    if (n) out[m.rel] = n;
  }
  return sortedKeys(out);
}

// ---------------------------------------------------------------------------
// Cobertura de tests
// ---------------------------------------------------------------------------

// Solo se exige test a la lógica: services/, utils/ y repositories/. Los componentes de
// ui.components/ pintan DOM y no se testean de serie; lo que se les extraiga sí cae aquí.
const NEEDS_TEST = /^(services|utils|repositories)\//;

/**
 * Módulos de lógica que ningún test importa.
 *
 * Cuenta solo las menciones en una línea de import/from: mirar el texto entero daba por
 * cubierto cualquier módulo citado en un comentario ("TODO: falta cubrir X") o leído con
 * readFileSync para hacer grep sobre su fuente, que no ejecuta ni una línea del módulo.
 */
export function untestedModules(mods = modules()) {
  // La ruta tiene que colgar de un import de verdad, no de cualquier mención: varios tests
  // leen el fuente con readFileSync para hacer grep sobre él, y eso no ejecuta ni una línea
  // del módulo. Se cubren las cuatro formas que usa el repo, incluidas las que parten la
  // llamada en varias líneas y la que compone la URL:
  //   from "../deploy/js/x.js"                                     import("../deploy/js/x.js")
  //   await import(\n  "../deploy/js/x.js"\n)                      import(new URL("js/x.js", P).href)
  // El prefijo `deploy/` es opcional justo por ese último caso (P vale "../deploy/").
  const IMPORTA = /(?:\bfrom\s*|\bimport\s*\(\s*(?:new\s+URL\s*\(\s*)?|\bimport\s+)["'][^"']*?(?:deploy\/)?js\/([\w./-]+\.js)/g;

  const imported = new Set();
  for (const file of walk(TESTS_ROOT, (p) => p.endsWith(".mjs"))) {
    const code = codeWithStrings(readFileSync(file, "utf8"));
    for (const m of code.matchAll(IMPORTA)) imported.add(m[1]);
  }
  return mods
    .filter((m) => NEEDS_TEST.test(m.rel) && !imported.has(m.rel))
    .map((m) => m.rel)
    .sort();
}

// ---------------------------------------------------------------------------
// CSS. Las hojas de componente NO están aisladas: comparten cascada con
// styles.css y con las demás, así que a igualdad de especificidad gana la que
// se cargue después. Ya mordió una vez — orders.css definía .inv-row / .inv-name
// / .inv-meta, que también son las filas del panel de reliquias, y les impuso
// nombres cortados con ellipsis.

const CSS_BASE = "styles.css";
const CSS_DIR = "css/components";

/** Devuelve el orden de los <link rel=stylesheet> tal como los carga index.html. */
export function cssLoadOrder() {
  const html = readFileSync(new URL(`../../deploy/index.html`, import.meta.url), "utf8");
  return [...html.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]*href=["']([^"'?]+)/g)]
    .map((m) => m[1]);
}

/**
 * Componentes que se cargan ANTES de styles.css. Los de después ganan a igualdad
 * de especificidad; los de antes pierden. Que el ganador dependa de la línea del
 * HTML es justo lo que hace impredecible tocar una regla.
 */
export function cssComponentsBeforeBase() {
  const orden = cssLoadOrder();
  const base = orden.indexOf(CSS_BASE);
  if (base === -1) return [];
  return orden.slice(0, base).filter((h) => h.includes(CSS_DIR)).sort();
}

/**
 * Clases definidas en un fichero CSS, separando las que están dentro de un
 * `@media` de las que no: las de dentro son overrides responsive y no compiten
 * en la misma cascada, así que contarlas infla el número de choques (pasó: de
 * las 19 clases de header.css, 15 eran solo-@media).
 */
function cssClasses(src) {
  const limpio = src.replaceAll(/\/\*[\s\S]*?\*\//g, "");
  const fuera = new Set();
  let profundidad = 0;
  let mediaEn = 0;
  let buf = "";
  for (const ch of limpio) {
    if (ch === "{") {
      const esMedia = /@(media|supports|container)/.test(buf);
      if (esMedia) { if (!mediaEn) mediaEn = profundidad + 1; }
      else if (!mediaEn) {
        for (const m of buf.matchAll(/\.([A-Za-z_][\w-]*)/g)) fuera.add(m[1]);
      }
      profundidad++;
      buf = "";
    } else if (ch === "}") {
      profundidad--;
      if (mediaEn && profundidad < mediaEn) mediaEn = 0;
      buf = "";
    } else buf += ch;
  }
  return fuera;
}

/**
 * Nombres de clase definidos a la vez en un componente y en styles.css, los dos
 * fuera de `@media`. Cada uno es una regla cuyo ganador decide el orden de carga.
 * Formato "componente.css .clase" para que el trinquete señale el par exacto.
 */
export function cssClassClashes() {
  const dir = new URL("../../deploy/css/components/", import.meta.url);
  const base = cssClasses(readFileSync(new URL("../../deploy/styles.css", import.meta.url), "utf8"));
  const out = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".css")).sort()) {
    for (const c of cssClasses(readFileSync(new URL(f, dir), "utf8"))) {
      if (base.has(c)) out.push(`${f} .${c}`);
    }
  }
  return out.sort();
}

/** Instantánea completa: es exactamente el formato de tests/_baseline/architecture-debt.json. */
export function snapshot() {
  const mods = modules();
  return {
    _README:
      "Deuda de arquitectura congelada. Lo vigila tests/architecture.test.mjs: nada nuevo " +
      "puede entrar aquí, y lo que se arregle hay que borrarlo de esta lista. Regenerar: " +
      "npm run baseline:arquitectura",
    layers: layerViolations(mods),
    dynamicLayerCrossings: dynamicLayerCrossings(mods),
    barrelRepositoryReexports: barrelRepositoryReexports(mods),
    duplicateExports: duplicateExports(mods),
    servicesTouchingDOM: servicesTouchingDOM(mods),
    componentsDoingIO: componentsDoingIO(mods),
    oversize: oversizeModules(mods),
    looseGlobals: looseGlobals(mods),
    untested: untestedModules(mods),
    cssBeforeBase: cssComponentsBeforeBase(),
    cssClassClashes: cssClassClashes(),
  };
}
