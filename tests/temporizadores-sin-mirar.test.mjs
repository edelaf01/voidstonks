import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const { seEstaMirando } = await import("../deploy/js/utils/shell.js");

const doc = (visibilityState, foco, shell) => ({
  visibilityState,
  hasFocus: () => foco,
  documentElement: { dataset: { shell } }
});

test("seEstaMirando: la web visible cuenta aunque no tenga foco", () => {
  assert.equal(seEstaMirando(doc("visible", false, undefined)), true);
  assert.equal(seEstaMirando(doc("visible", true, undefined)), true);
});

test("seEstaMirando: la pestaña oculta no se mira", () => {
  assert.equal(seEstaMirando(doc("hidden", true, undefined)), false);
  assert.equal(seEstaMirando(doc("hidden", true, "desktop")), false);
});

test("seEstaMirando: el escritorio sin foco está detrás del juego", () => {
  assert.equal(seEstaMirando(doc("visible", false, "desktop")), false);
  assert.equal(seEstaMirando(doc("visible", true, "desktop")), true);
});

test("al salir de Farms se paran sus contadores", () => {
  const src = read("../deploy/js/ui.js");
  assert.match(src, /state\.activeTab === "bounties" && mode !== "bounties"\) stopFarmsTimers\(\)/);
  const farms = read("../deploy/js/ui.components/farms/ui_farms.js");
  const bodyMatch = farms.match(/export function stopFarmsTimers\(\) \{([^}]*)\}/);
  assert.ok(bodyMatch);
  assert.ok(bodyMatch[1].includes("stopBountyTimers()"));
  assert.ok(bodyMatch[1].includes("stopRotationTimers()"));
});

test("al salir de Riven se para el carrusel de curiosidades", () => {
  const src = read("../deploy/js/ui.js");
  assert.match(src, /m\.stopRivenShowcase\(\); m\.stopCuriosidades\(\);/);
  const rivens = read("../deploy/js/ui.components/rivens/ui_rivens.js");
  assert.match(rivens, /export \{ normalizeStatName, stopCuriosidades \}/);
});

test("los carruseles decorativos no avanzan sin que se miren", () => {
  const cur = read("../deploy/js/ui.components/rivens/ui_riven_curiosidades.js");
  assert.doesNotMatch(cur, /setInterval\(\(\) => mueve\(1\)/);
  assert.match(cur, /const avanza = \(\) => \{ if \(seEstaMirando\(\)\) mueve\(1\); \};/);
  assert.equal((cur.match(/setInterval\(avanza, 9000\)/g) || []).length, 3);
  assert.match(cur, /export function stopCuriosidades\(\) \{\s*clearInterval\(_curioTimer\);\s*_curioTimer = null;\s*\}/);
  const riv = read("../deploy/js/ui.components/rivens/ui_rivens.js");
  assert.match(riv, /emptyShowcaseInterval = setInterval\(\(\) => \{\s*if \(!seEstaMirando\(\)\) return;/);
});
