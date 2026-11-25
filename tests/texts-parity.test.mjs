import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { TEXTS } from "../deploy/js/assets/texts.js";

const BASE_BLOCKS = ["undo", "deeplinks", "palette", "tutorial"];
const isTraderKey = (key) => /^(tr|trader|varzia|vault)/i.test(key);

const traderKeysEs = Object.keys(TEXTS.es).filter(isTraderKey);
const traderKeysEn = Object.keys(TEXTS.en).filter(isTraderKey);
const TARGET_KEYS = Array.from(new Set([...BASE_BLOCKS, ...traderKeysEs, ...traderKeysEn]));

function extractPlaceholders(str) {
  if (typeof str !== "string") return [];
  const matches = str.match(/\{[^}]+\}|%[0-9]*[sdf]/g);
  return matches ? matches.slice().sort() : [];
}

function collectTreeDiffs(valEs, valEn, currentPath = "") {
  const diffs = [];
  if (typeof valEs !== typeof valEn) {
    diffs.push(`Tipo distinto en ${currentPath}: ${typeof valEs} !== ${typeof valEn}`);
    return diffs;
  }
  if (Array.isArray(valEs) && Array.isArray(valEn)) {
    if (valEs.length !== valEn.length) {
      diffs.push(`Longitud de array distinta en ${currentPath}: ${valEs.length} !== ${valEn.length}`);
    }
    const max = Math.max(valEs.length, valEn.length);
    for (let i = 0; i < max; i++) {
      diffs.push(...collectTreeDiffs(valEs[i], valEn[i], `${currentPath}[${i}]`));
    }
    return diffs;
  }
  if (typeof valEs === "object" && valEs !== null && valEn !== null) {
    const keysEs = Object.keys(valEs).sort();
    const keysEn = Object.keys(valEn).sort();
    for (const k of keysEs) {
      if (!keysEn.includes(k)) {
        diffs.push(`Clave ausente en EN en ${currentPath}.${k}`);
      }
    }
    for (const k of keysEn) {
      if (!keysEs.includes(k)) {
        diffs.push(`Clave ausente en ES en ${currentPath}.${k}`);
      }
    }
    for (const k of keysEs) {
      if (keysEn.includes(k)) {
        diffs.push(...collectTreeDiffs(valEs[k], valEn[k], `${currentPath}.${k}`));
      }
    }
  }
  return diffs;
}

function collectEmptyStrings(val, currentPath = "") {
  const empty = [];
  if (typeof val === "string") {
    if (val.trim() === "") {
      empty.push(`Cadena vacía o solo espacios en ${currentPath}`);
    }
    return empty;
  }
  if (Array.isArray(val)) {
    val.forEach((item, idx) => {
      empty.push(...collectEmptyStrings(item, `${currentPath}[${idx}]`));
    });
    return empty;
  }
  if (typeof val === "object" && val !== null) {
    for (const [k, v] of Object.entries(val)) {
      empty.push(...collectEmptyStrings(v, `${currentPath}.${k}`));
    }
  }
  return empty;
}

function collectPlaceholderMismatches(valEs, valEn, currentPath = "") {
  const mismatches = [];
  if (typeof valEs === "string" && typeof valEn === "string") {
    const phEs = extractPlaceholders(valEs);
    const phEn = extractPlaceholders(valEn);
    if (JSON.stringify(phEs) !== JSON.stringify(phEn)) {
      mismatches.push(`Marcadores no coinciden en ${currentPath}: [${phEs}] !== [${phEn}]`);
    }
    return mismatches;
  }
  if (Array.isArray(valEs) && Array.isArray(valEn)) {
    const len = Math.min(valEs.length, valEn.length);
    for (let i = 0; i < len; i++) {
      mismatches.push(...collectPlaceholderMismatches(valEs[i], valEn[i], `${currentPath}[${i}]`));
    }
    return mismatches;
  }
  if (typeof valEs === "object" && valEs !== null && typeof valEn === "object" && valEn !== null) {
    for (const k of Object.keys(valEs)) {
      if (k in valEn) {
        mismatches.push(...collectPlaceholderMismatches(valEs[k], valEn[k], `${currentPath}.${k}`));
      }
    }
  }
  return mismatches;
}

test("los bloques base y las claves derivadas de traders existen en ambos idiomas", () => {
  assert.ok(TARGET_KEYS.length >= 5);
  for (const block of TARGET_KEYS) {
    assert.ok(block in TEXTS.es, `Falta bloque ${block} en TEXTS.es`);
    assert.ok(block in TEXTS.en, `Falta bloque ${block} en TEXTS.en`);
  }
});

test("las estructuras de claves de los bloques seleccionados son idénticas recursivamente", () => {
  const allDiffs = [];
  for (const block of TARGET_KEYS) {
    allDiffs.push(...collectTreeDiffs(TEXTS.es[block], TEXTS.en[block], block));
  }
  assert.deepEqual(allDiffs, []);
});

test("ningún texto en los bloques analizados está vacío ni contiene solo espacios", () => {
  const emptyEs = [];
  const emptyEn = [];
  for (const block of TARGET_KEYS) {
    emptyEs.push(...collectEmptyStrings(TEXTS.es[block], `es.${block}`));
    emptyEn.push(...collectEmptyStrings(TEXTS.en[block], `en.${block}`));
  }
  assert.deepEqual([...emptyEs, ...emptyEn], []);
});

test("los pasos del tutorial para escritorio y móvil tienen la misma cantidad y mismas claves", () => {
  const modes = ["desktop", "mobile"];
  for (const mode of modes) {
    const stepsEs = TEXTS.es.tutorial[mode];
    const stepsEn = TEXTS.en.tutorial[mode];
    assert.ok(Array.isArray(stepsEs));
    assert.ok(Array.isArray(stepsEn));
    assert.equal(stepsEs.length, stepsEn.length);
    for (let i = 0; i < stepsEs.length; i++) {
      assert.deepEqual(Object.keys(stepsEs[i]).sort(), Object.keys(stepsEn[i]).sort());
    }
  }
});

test("los marcadores de posición coinciden exactamente entre español e inglés", () => {
  const mismatches = [];
  for (const block of TARGET_KEYS) {
    mismatches.push(...collectPlaceholderMismatches(TEXTS.es[block], TEXTS.en[block], block));
  }
  assert.deepEqual(mismatches, []);
});

test("todos los assets relativos con url en deploy/styles.css existen físicamente", () => {
  const cssPath = path.resolve("deploy/styles.css");
  const cssContent = fs.readFileSync(cssPath, "utf8");
  const urlMatches = [...cssContent.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)]
    .map((m) => m[1])
    .filter((u) => !u.startsWith("data:") && !u.startsWith("http://") && !u.startsWith("https://"));

  assert.ok(urlMatches.length > 0);
  const missing = [];
  for (const relUrl of urlMatches) {
    const cleanUrl = relUrl.split("?")[0].split("#")[0];
    const absPath = path.resolve("deploy", cleanUrl);
    if (!fs.existsSync(absPath)) {
      missing.push(relUrl);
    }
  }
  assert.deepEqual(missing, []);
});

test("todos los scripts y hojas de estilo locales de deploy/index.html existen físicamente", () => {
  const htmlPath = path.resolve("deploy/index.html");
  const htmlContent = fs.readFileSync(htmlPath, "utf8");

  const linkMatches = [
    ...htmlContent.matchAll(/<link[^>]+rel=['"]?stylesheet['"]?[^>]*href=['"]?([^>'"]+)['"]?/gi),
    ...htmlContent.matchAll(/<link[^>]+href=['"]?([^>'"]+)['"]?[^>]*rel=['"]?stylesheet['"]?/gi),
  ]
    .map((m) => m[1])
    .filter((u) => !u.startsWith("http://") && !u.startsWith("https://"));

  const scriptMatches = [...htmlContent.matchAll(/<script[^>]+src=['"]?([^>'"]+)['"]?/gi)]
    .map((m) => m[1])
    .filter((u) => !u.startsWith("http://") && !u.startsWith("https://"));

  assert.ok(linkMatches.length > 0);
  assert.ok(scriptMatches.length > 0);

  const missing = [];
  for (const localRef of [...linkMatches, ...scriptMatches]) {
    const cleanRef = localRef.split("?")[0].split("#")[0];
    const absPath = path.resolve("deploy", cleanRef);
    if (!fs.existsSync(absPath)) {
      missing.push(localRef);
    }
  }
  assert.deepEqual(missing, []);
});

test("las hojas de estilo de nuevas funcionalidades están enlazadas en deploy/index.html", () => {
  const htmlPath = path.resolve("deploy/index.html");
  const htmlContent = fs.readFileSync(htmlPath, "utf8");
  const requiredCss = [
    "palette.css",
    "swipe.css",
    "tutorial.css",
    "deeplinks.css",
    "traders.css",
  ];

  for (const file of requiredCss) {
    const pattern = new RegExp(`href=['"][^'"]*${file}(?:\\?[^'"]*)?['"]`, "i");
    assert.ok(pattern.test(htmlContent), `Falta enlazar ${file} en deploy/index.html`);
  }
});
