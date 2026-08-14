import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const JS_ROOT = fileURLToPath(new URL("../deploy/js", import.meta.url));
const INDEX = fileURLToPath(new URL("../deploy/index.html", import.meta.url));
const SKIP = /tesseract|\.min\.js|wasm\.js|opencv/;

function allJs(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...allJs(p));
    else if (e.endsWith(".js") && !SKIP.test(p)) out.push(p);
  }
  return out;
}

function braceBody(src, openIdx) {
  let depth = 0, i = openIdx;
  while (i < src.length) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (!depth) break; }
    i++;
  }
  return src.slice(openIdx + 1, i);
}

function publishedNames() {
  const names = new Set();
  for (const file of allJs(JS_ROOT)) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/(?:globalThis|window)\.([A-Za-z_$][\w$]*)\s*=/g)) names.add(m[1]);
    for (const m of src.matchAll(/(?:Object\.assign\(\s*(?:globalThis|window)\s*,\s*|exposeGlobals\(\s*)\{/g)) {
      const body = braceBody(src, m.index + m[0].length - 1);
      for (const k of body.matchAll(/(?:^|,)\s*([A-Za-z_$][\w$]*)\s*(?=[,:}]|$)/g)) names.add(k[1]);
    }
    for (const m of src.matchAll(/Object\.assign\(\s*(?:globalThis|window)\s*,\s*([A-Za-z_$][\w$]*)\s*\)/g)) {
      const decl = new RegExp(`(?:const|let|var)\\s+${m[1]}\\s*=\\s*\\{`).exec(src);
      if (!decl) continue;
      const body = braceBody(src, decl.index + decl[0].length - 1);
      for (const k of body.matchAll(/(?:^|,)\s*([A-Za-z_$][\w$]*)\s*(?=[,:}]|$)/g)) names.add(k[1]);
    }
  }
  return names;
}

const NOT_A_GLOBAL = new Set([
  "if", "for", "while", "return", "typeof", "new", "this", "function", "import", "then",
  "catch", "alert", "confirm", "parseInt", "parseFloat", "String", "Number", "Boolean",
  "Math", "JSON", "Date", "Array", "Object", "console", "event", "true", "false", "null",
  "style", "classList", "remove", "add", "toggle", "contains", "focus", "blur", "click",
  "value", "preventDefault", "stopPropagation", "getElementById", "querySelector",
  "querySelectorAll", "toFixed", "toString", "trim", "split", "join", "map", "filter",
  "forEach", "includes", "indexOf", "slice", "replace", "reload", "open", "close",
  "setAttribute", "getAttribute", "scrollIntoView", "select", "submit", "reset",
]);

function htmlInvocations() {
  const html = readFileSync(INDEX, "utf8");
  const calls = new Map();
  for (const m of html.matchAll(/\son(?:click|input|change|keyup|keydown|submit|focus|blur)\s*=\s*"([^"]*)"/g)) {
    const code = m[1].replace(/'[^']*'/g, "''").replace(/&quot;[^&]*&quot;/g, "''");
    for (const c of code.matchAll(/(?:globalThis\.|window\.)?\b([A-Za-z_$][\w$]*)\s*\(/g)) {
      const name = c[1];
      if (NOT_A_GLOBAL.has(name)) continue;
      const at = c.index;
      const before = code.slice(Math.max(0, at - 2), at);
      if (before.endsWith(".") && !/(?:globalThis|window)\.$/.test(code.slice(0, at))) continue;
      calls.set(name, (calls.get(name) || 0) + 1);
    }
  }
  return calls;
}

test("todo handler inline de index.html tiene su función publicada en globalThis", () => {
  const published = publishedNames();
  const used = htmlInvocations();

  const missing = [...used.keys()].filter((n) => !published.has(n)).sort();

  assert.deepEqual(
    missing,
    [],
    `Estos handlers del HTML no están publicados en globalThis y fallarán al pulsarlos:\n` +
      missing.map((n) => `  ${n}()  — ${used.get(n)} uso(s) en index.html`).join("\n"),
  );
});

test("global_registry avisa de colisiones entre módulos", async () => {
  const { exposeGlobals, listGlobals, ownerOf } = await import(
    "../deploy/js/utils/global_registry.js"
  );

  const warnings = [];
  const orig = console.warn;
  console.warn = (msg) => warnings.push(String(msg));
  try {
    exposeGlobals({ __vsTestFn: () => "a" }, "modulo/a.js");
    exposeGlobals({ __vsTestFn: () => "b" }, "modulo/b.js");
  } finally {
    console.warn = orig;
  }

  assert.equal(warnings.length, 1, "una publicación en conflicto debe avisar exactamente una vez");
  assert.match(warnings[0], /__vsTestFn/);
  assert.match(warnings[0], /modulo\/a\.js/);
  assert.equal(ownerOf("__vsTestFn"), "modulo/b.js", "el último en publicar es el que queda");
  assert.ok(listGlobals().includes("__vsTestFn"));
});

test("republicar el mismo valor no cuenta como colisión", async () => {
  const { exposeGlobals } = await import("../deploy/js/utils/global_registry.js");
  const fn = () => "estable";

  const warnings = [];
  const orig = console.warn;
  console.warn = (msg) => warnings.push(String(msg));
  try {
    exposeGlobals({ __vsSameFn: fn }, "modulo/a.js");
    exposeGlobals({ __vsSameFn: fn }, "modulo/b.js");
  } finally {
    console.warn = orig;
  }

  assert.deepEqual(warnings, []);
});
