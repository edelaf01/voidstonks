import { readdirSync, lstatSync, readFileSync } from "node:fs";
import { join, resolve, relative, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const JS_ROOT = fileURLToPath(new URL("../../deploy/js", import.meta.url));
export const TESTS_ROOT = fileURLToPath(new URL("..", import.meta.url));

const VENDORED = new Set(["tesseract.min.js", "tesseract-core.wasm.js"]);

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

export function modules() {
  return walk(JS_ROOT, (p) => p.endsWith(".js") && !VENDORED.has(p.slice(p.lastIndexOf(sep) + 1)))
    .map((abs) => {
      const src = readFileSync(abs, "utf8");
      const lines = src.split("\n").length - (src.endsWith("\n") ? 1 : 0);
      return { abs, rel: toPosix(relative(JS_ROOT, abs)), src, lines };
    });
}

const BEFORE_REGEX = new Set(["(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", "\n", "+", "-", "*", "%", "<", ">", "~", "^"]);

function strip(src, { strings }) {
  let out = "";
  let i = 0;
  let lastCode = "\n";
  const blank = (ch) => (ch === "\n" ? "\n" : " ");

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

const codeWithStrings = (src) => strip(src, { strings: true });
const codeOnly = (src) => strip(src, { strings: false });

const LAYERS = {
  assets: { allow: [] },
  store: { allow: ["assets"] },
  core: { allow: ["assets", "store", "utils"] },
  utils: { allow: ["assets", "store", "core", "utils"] },
  repositories: { allow: ["assets", "store", "core", "utils", "repositories"] },
  services: { allow: ["assets", "store", "core", "utils", "repositories", "services"] },
  barrel: { allow: ["assets", "store", "core", "utils", "repositories", "services"] },
  ui: { allow: ["assets", "store", "core", "utils", "services", "barrel", "ui"] },
  scanner: { allow: ["assets", "store", "core", "utils", "repositories", "services", "barrel", "ui", "scanner"] },
  app: { allow: ["assets", "store", "core", "utils", "repositories", "services", "barrel", "ui", "scanner", "app"] },
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

const cleanSpec = (spec) => spec.split("?")[0].split("#")[0];

const RELATIVE = (s) => s.startsWith("./") || s.startsWith("../");

export function staticImportsOf(src) {
  const code = codeWithStrings(src);
  const specs = [];
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

export function dynamicImportsOf(src) {
  const code = codeWithStrings(src);
  const specs = [];
  const re = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  let m;
  while ((m = re.exec(code))) specs.push(m[1]);
  return [...new Set(specs.filter(RELATIVE).map(cleanSpec))];
}

export function resolveRel(fromRel, spec) {
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
      if (!target || !known.has(target)) continue;
      const to = layerOf(target);
      if (!LAYERS[from].allow.includes(to)) out.add(`${mod.rel} -> ${target}`);
    }
  }
  return [...out].sort();
}

export const layerViolations = (mods = modules()) => crossings(mods, staticImportsOf);

export const dynamicLayerCrossings = (mods = modules()) => crossings(mods, dynamicImportsOf);

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

const DOM_IN_SERVICE = /\bdocument\s*[.[]|innerHTML|\bshowToast\s*\(/;

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

export const MAX_MODULE_LINES = 800;

const sortedKeys = (obj) => Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)));

export function oversizeModules(mods = modules()) {
  const out = {};
  for (const m of mods) {
    if (layerOf(m.rel) === "assets") continue;
    if (m.lines > MAX_MODULE_LINES) out[m.rel] = m.lines;
  }
  return sortedKeys(out);
}

const LOOSE_GLOBAL = new RegExp(
  [
    /(?:globalThis|window)\s*\.\s*[A-Za-z_$][\w$]*\s*=(?!=)/.source,
    /(?:globalThis|window)\s*\[[^\]]*\]\s*=(?!=)/.source,
    /\bObject\s*\.\s*assign\s*\(\s*(?:globalThis|window)\b/.source,
  ].join("|"),
  "g",
);

export function looseGlobals(mods = modules()) {
  const out = {};
  for (const m of mods) {
    if (m.rel === "utils/global_registry.js") continue;
    const n = (codeOnly(m.src).match(LOOSE_GLOBAL) || []).length;
    if (n) out[m.rel] = n;
  }
  return sortedKeys(out);
}

const NEEDS_TEST = /^(services|utils|repositories)\//;

export function untestedModules(mods = modules()) {
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

// component sheets share cascade with styles.css: at equal specificity the later one wins

const CSS_BASE = "styles.css";
const CSS_DIR = "css/components";

export function cssLoadOrder() {
  const html = readFileSync(new URL(`../../deploy/index.html`, import.meta.url), "utf8");
  return [...html.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]*href=["']([^"'?]+)/g)]
    .map((m) => m[1]);
}

export function cssComponentsBeforeBase() {
  const orden = cssLoadOrder();
  const base = orden.indexOf(CSS_BASE);
  if (base === -1) return [];
  return orden.slice(0, base).filter((h) => h.includes(CSS_DIR)).sort();
}

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
