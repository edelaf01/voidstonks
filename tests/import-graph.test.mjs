import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const JS_ROOT = fileURLToPath(new URL("../deploy/js", import.meta.url));
const DEPLOY = fileURLToPath(new URL("../deploy", import.meta.url));
const INDEX = join(DEPLOY, "index.html");

function allJs(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...allJs(p));
    else if (e.endsWith(".js")) out.push(p);
  }
  return out;
}

// Devuelve los specifiers relativos (./ o ../) de un archivo JS.
function specifiersOf(src) {
  const specs = [];
  const patterns = [
    /(?:^|[^.\w])import\s+(?:[^'";]*?\sfrom\s*)?['"]([^'"]+)['"]/g, // import ... from "x" / import "x"
    /(?:^|[^.\w])export\s+[^'"]*?\sfrom\s*['"]([^'"]+)['"]/g,        // export ... from "x"
    /import\(\s*['"]([^'"]+)['"]\s*\)/g,                              // import("x")
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(src))) specs.push(m[1]);
  }
  return specs.filter((s) => s.startsWith("./") || s.startsWith("../"));
}

function clean(spec) {
  return spec.split("?")[0].split("#")[0]; // quita ?v=1.10 etc.
}

function resolveExists(baseDir, spec) {
  const target = resolve(baseDir, clean(spec));
  if (existsSync(target)) return true;
  if (!/\.\w+$/.test(target) && existsSync(target + ".js")) return true; // sin extensión
  return false;
}

test("ningún import relativo de deploy/js apunta a un archivo inexistente", () => {
  const broken = [];
  for (const file of allJs(JS_ROOT)) {
    const src = readFileSync(file, "utf8");
    for (const spec of specifiersOf(src)) {
      if (!resolveExists(dirname(file), spec)) broken.push(`${file}  ->  ${spec}`);
    }
  }
  assert.equal(broken.length, 0, `Imports rotos:\n${broken.join("\n")}`);
});

test("index.html: <script src> e import() apuntan a archivos existentes", () => {
  const html = readFileSync(INDEX, "utf8");
  const broken = [];

  // <script src="js/...">  (ignora http/cdn)
  for (const m of html.matchAll(/<script[^>]*\ssrc=["']([^"']+)["']/g)) {
    const src = m[1];
    if (/^https?:/.test(src)) continue;
    if (!resolveExists(DEPLOY, src)) broken.push(`<script src> -> ${src}`);
  }
  // import('./js/...') en handlers inline
  for (const m of html.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    const src = m[1];
    if (/^https?:/.test(src)) continue;
    if (!resolveExists(DEPLOY, src)) broken.push(`import() -> ${src}`);
  }

  assert.equal(broken.length, 0, `Referencias rotas en index.html:\n${broken.join("\n")}`);
});

// Un ciclo de imports es fatal cuando alguno de los módulos implicados ejecuta código
// en top-level: el segundo módulo se evalúa a medias y sus `let/const` quedan en TDZ.
// Pasó de verdad: añadir `import { switchTab } from "../ui.js"` a ui_inventory.js creó
// el ciclo ui.js -> ui_inventory.js -> ui.js, y como ui.js llama a updateUILabels() al
// final del fichero, la app moría con "Cannot access 'lastRenderedHash' before
// initialization". Los ficheros parseaban y el lint pasaba: solo se veía en el navegador.
function resolveToPath(baseDir, spec) {
  const target = resolve(baseDir, clean(spec));
  if (existsSync(target) && target.endsWith(".js")) return target;
  if (!/\.\w+$/.test(target) && existsSync(target + ".js")) return target + ".js";
  return null;
}

// Detecta llamadas a nivel de módulo: `foo()` / `await foo()` / `new X()` a columna 0.
// Un ciclo SOLO rompe la carga si alguno de sus miembros ejecuta algo al ser importado;
// los ciclos entre módulos que solo declaran son latentes y no fallan hoy.
function hasTopLevelExecution(file) {
  const src = readFileSync(file, "utf8");
  return src
    .split("\n")
    .some((l) => /^(await\s+|new\s+)?[A-Za-z_$][\w$.]*\s*\(/.test(l) && !/^(import|export)\b/.test(l));
}

// Solo los imports ESTÁTICOS forman ciclos de evaluación. Un `import()` dinámico se
// resuelve más tarde, con el módulo ya inicializado, así que no rompe la carga
// (rivens.service <-> riven_market.service se llaman así a propósito).
function staticSpecifiersOf(src) {
  const specs = [];
  const patterns = [
    /(?:^|[^.\w])import\s+(?:[^'";]*?\sfrom\s*)?['"]([^'"]+)['"]/g,
    /(?:^|[^.\w])export\s+[^'"]*?\sfrom\s*['"]([^'"]+)['"]/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(src))) specs.push(m[1]);
  }
  return specs.filter((s) => s.startsWith("./") || s.startsWith("../"));
}

test("deploy/js: sin ciclos de imports que rompan la carga", () => {
  const graph = new Map();
  for (const file of allJs(JS_ROOT)) {
    const deps = [];
    for (const spec of staticSpecifiersOf(readFileSync(file, "utf8"))) {
      const dep = resolveToPath(dirname(file), spec);
      if (dep) deps.push(dep);
    }
    graph.set(file, deps);
  }

  const cycles = [];
  const WHITE = 0, GREY = 1, BLACK = 2;
  const color = new Map([...graph.keys()].map((f) => [f, WHITE]));

  const visit = (node, stack) => {
    color.set(node, GREY);
    stack.push(node);
    for (const dep of graph.get(node) || []) {
      if (color.get(dep) === GREY) {
        const at = stack.indexOf(dep);
        cycles.push([...stack.slice(at), dep]);
      } else if (color.get(dep) === WHITE) {
        visit(dep, stack);
      }
    }
    stack.pop();
    color.set(node, BLACK);
  };

  for (const file of graph.keys()) if (color.get(file) === WHITE) visit(file, []);

  const rel = (p) => p.replace(JS_ROOT + "/", "");
  const fatal = new Set();
  for (const cycle of cycles) {
    const culprits = cycle.filter(hasTopLevelExecution);
    if (culprits.length) {
      fatal.add(`${cycle.map(rel).join(" -> ")}   [ejecuta al importarse: ${culprits.map(rel).join(", ")}]`);
    }
  }

  assert.equal(
    fatal.size,
    0,
    `Ciclos de imports que rompen la carga en el navegador:\n${[...fatal].join("\n")}`,
  );
});
