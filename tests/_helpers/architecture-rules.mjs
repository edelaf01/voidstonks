// architecture rule detectors, kept in _helpers/ (node --test does not run it) because three consumers share them:
// architecture.test.mjs, architecture-rules.test.mjs and the command that regenerates the baseline

import { readdirSync, lstatSync, readFileSync } from "node:fs";
import { join, resolve, relative, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const JS_ROOT = fileURLToPath(new URL("../../deploy/js", import.meta.url));
export const TESTS_ROOT = fileURLToPath(new URL("..", import.meta.url));

// vendored: not our source and they skew every metric (tesseract.min.js is 5 MB on one line)
// an explicit list on purpose, a substring pattern would also exclude a future file like ui_tesseract_panel.js
const VENDORED = new Set(["tesseract.min.js"]);
// third-party folders (the Tesseract worker and cores we serve, Chart.js), excluded by path and not by file name
const VENDORED_DIRS = ["tesseract"];

function walk(dir, keep) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    // lstat, not stat: a circular symlink would hang the recursion
    const st = lstatSync(p);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) out.push(...walk(p, keep));
    else if (keep(p)) out.push(p);
  }
  return out;
}

const toPosix = (p) => p.split(sep).join("/");

/** every own module under deploy/js with its relative path, source and line count */
export function modules() {
  const esVendor = (p) => VENDORED.has(p.slice(p.lastIndexOf(sep) + 1))
    || VENDORED_DIRS.some((d) => p.includes(`${sep}${d}${sep}`));
  return walk(JS_ROOT, (p) => p.endsWith(".js") && !esVendor(p))
    .map((abs) => {
      const src = readFileSync(abs, "utf8");
      // same as `wc -l`: the final newline does not open a new line
      const lines = src.split("\n").length - (src.endsWith("\n") ? 1 : 0);
      return { abs, rel: toPosix(relative(JS_ROOT, abs)), src, lines };
    });
}

// normalization: comments and literals out

// without this the detectors are both blind and paranoid: a commented-out import counted as a violation,
// and a comment inside a multi-line import list made the whole dependency vanish
// regex literals are recognised apart, otherwise the `//` in /https:\/\// would start a comment
const BEFORE_REGEX = new Set(["(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", "\n", "+", "-", "*", "%", "<", ">", "~", "^"]);

function strip(src, { strings }) {
  let out = "";
  let i = 0;
  let lastCode = "\n"; // last significant char, to tell a regex from a division
  const blank = (ch) => (ch === "\n" ? "\n" : " "); // keeps lines and offsets

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
      // template literals are always blanked: an import specifier never uses backticks
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

/** source without comments, literals intact (to read import specifiers) */
const codeWithStrings = (src) => strip(src, { strings: true });
/** source without comments or literals (to find real uses of an API) */
const codeOnly = (src) => strip(src, { strings: false });

// layers

// the layer contract as data: `allow` is the full whitelist of layers each one may import
const LAYERS = {
  // `assets` are data modules (base64 images, tables): no dependencies, anyone imports them like a .json
  assets: { allow: [] },
  store: { allow: ["assets"] },
  core: { allow: ["assets", "store", "utils"] }, // config.js / state.js
  utils: { allow: ["assets", "store", "core", "utils"] },
  repositories: { allow: ["assets", "store", "core", "utils", "repositories"] },
  services: { allow: ["assets", "store", "core", "utils", "repositories", "services"] },
  barrel: { allow: ["assets", "store", "core", "utils", "repositories", "services"] }, // api.js
  ui: { allow: ["assets", "store", "core", "utils", "services", "barrel", "ui"] },
  // scanner/ and the app (ui.js, main.js) orchestrate: they compose every layer on purpose
  scanner: { allow: ["assets", "store", "core", "utils", "repositories", "services", "barrel", "ui", "scanner"] },
  app: { allow: ["assets", "store", "core", "utils", "repositories", "services", "barrel", "ui", "scanner", "app"] },
  // a folder or file nobody classified imports nothing, so its layer has to be decided here
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

// drops the `?v=1.9` Cloudflare Pages cache buster before resolving the path
const cleanSpec = (spec) => spec.split("?")[0].split("#")[0];

const RELATIVE = (s) => s.startsWith("./") || s.startsWith("../");

/** relative specifiers of STATIC imports and export-from */
export function staticImportsOf(src) {
  const code = codeWithStrings(src);
  const specs = [];
  // whitespace after import/export is optional: `import{a}from"x"` is valid
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

/** relative specifiers of dynamic `import()` calls with a literal */
export function dynamicImportsOf(src) {
  const code = codeWithStrings(src);
  const specs = [];
  const re = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  let m;
  while ((m = re.exec(code))) specs.push(m[1]);
  return [...new Set(specs.filter(RELATIVE).map(cleanSpec))];
}

/** target path relative to deploy/js, or null when it falls outside the tree */
export function resolveRel(fromRel, spec) {
  // resolve() really normalizes: `../../js/repositories/x.js` from ui.components/ leaves the tree and re-enters it
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
      if (!target || !known.has(target)) continue; // vendored, .json, outside deploy/js
      const to = layerOf(target);
      if (!LAYERS[from].allow.includes(to)) out.add(`${mod.rel} -> ${target}`);
    }
  }
  return [...out].sort();
}

/** static imports that break the layer contract */
export const layerViolations = (mods = modules()) => crossings(mods, staticImportsOf);

/**
 * the same through `import()`, measured apart because it is the legit way out of a cycle (rivens.service ↔ riven_market.service)
 * unwatched, any frozen debt could be "fixed" by turning the static import into a dynamic one
 */
export const dynamicLayerCrossings = (mods = modules()) => crossings(mods, dynamicImportsOf);

/**
 * symbols api.js re-exports from repositories/: ui.components/ may not import repositories/ but may import api.js
 * freezing the list keeps that door from widening
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

// duplication

/** exported names defined in more than one module, as "name: file, file" */
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

    // `export { calc }` / `export { x as calc }`, but NOT `export { x } from "..."`: a re-export is not a second definition
    // neither is importing at the top and `export { x }` below
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

// DOM / I/O separation

const DOM_IN_SERVICE = /\bdocument\s*[.[]|innerHTML|\bshowToast\s*\(/;

// every I/O path, not just `fetch(`: the lookbehind that skips `this.fetch(` also let `window.fetch(` through
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

// size and globals

export const MAX_MODULE_LINES = 800;

const sortedKeys = (obj) => Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)));

/**
 * { file: lines } of the modules over the limit
 * `assets/` is out: data tables are read by the key you look for, not whole
 */
export function oversizeModules(mods = modules()) {
  const out = {};
  for (const m of mods) {
    if (layerOf(m.rel) === "assets") continue;
    if (m.lines > MAX_MODULE_LINES) out[m.rel] = m.lines;
  }
  return sortedKeys(out);
}

// bare assignments to the global object; utils/global_registry.js does the same but warns when two modules publish one name
// also counts `window.x =`, bracket access and Object.assign(globalThis, …)
const LOOSE_GLOBAL = new RegExp(
  [
    /(?:globalThis|window)\s*\.\s*[A-Za-z_$][\w$]*\s*=(?!=)/.source,
    // the bracket uses `[^\]]*`, not a string literal, because this regex runs on source already stripped of literals
    /(?:globalThis|window)\s*\[[^\]]*\]\s*=(?!=)/.source,
    /\bObject\s*\.\s*assign\s*\(\s*(?:globalThis|window)\b/.source,
  ].join("|"),
  "g",
);

/** { file: number of loose assignments } */
export function looseGlobals(mods = modules()) {
  const out = {};
  for (const m of mods) {
    // global_registry.js is out: assigning is its job
    if (m.rel === "utils/global_registry.js") continue;
    const n = (codeOnly(m.src).match(LOOSE_GLOBAL) || []).length;
    if (n) out[m.rel] = n;
  }
  return sortedKeys(out);
}

// test coverage

// only logic needs a test: services/, utils/ and repositories/; ui.components/ paint DOM
const NEEDS_TEST = /^(services|utils|repositories)\//;

/** logic modules no test imports; only import/from lines count, a readFileSync grep runs no line of the module */
export function untestedModules(mods = modules()) {
  // the path must hang from a real import; covers the four forms the repo uses, split calls included
  // and `import(new URL("js/x.js", P).href)`, which is why the `deploy/` prefix is optional
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

// CSS: component sheets share the cascade with styles.css, so at equal specificity the one loaded later wins
// (orders.css once redefined .inv-row / .inv-name / .inv-meta and cut the relic panel names)

const CSS_BASE = "styles.css";
const CSS_DIR = "css/components";

/** order of the <link rel=stylesheet> as index.html loads them */
export function cssLoadOrder() {
  const html = readFileSync(new URL(`../../deploy/index.html`, import.meta.url), "utf8");
  return [...html.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]*href=["']([^"'?]+)/g)]
    .map((m) => m[1]);
}

/** components loaded BEFORE styles.css: at equal specificity they lose to it */
export function cssComponentsBeforeBase() {
  const orden = cssLoadOrder();
  const base = orden.indexOf(CSS_BASE);
  if (base === -1) return [];
  return orden.slice(0, base).filter((h) => h.includes(CSS_DIR)).sort();
}

/** classes defined in a CSS file, split by whether they sit inside `@media`: those are responsive overrides and do not compete */
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

/** class names defined both in a component and in styles.css, outside `@media`, as "component.css .class" */
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

/** full snapshot, exactly the format of tests/_baseline/architecture-debt.json */
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
