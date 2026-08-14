import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../deploy/js", import.meta.url));

// Vendor / no-source files que no deben pasar por node --check.
const SKIP = (name) =>
  /^tesseract/.test(name) || /opencv-?js/.test(name) || name.endsWith(".min.js") || name.endsWith(".wasm.js");

function allJs(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...allJs(p));
    else if (e.endsWith(".js") && !SKIP(basename(e))) out.push(p);
  }
  return out;
}

test("todos los .js de deploy/js parsean (node --check)", () => {
  const files = allJs(ROOT);
  assert.ok(files.length > 0, "no se encontraron archivos");
  const broken = [];
  for (const f of files) {
    try {
      execFileSync(process.execPath, ["--check", f], { stdio: "pipe" });
    } catch (err) {
      broken.push(`${f}\n${err.stderr?.toString() || err.message}`);
    }
  }
  assert.equal(broken.length, 0, `Archivos con error de sintaxis:\n${broken.join("\n---\n")}`);
});
