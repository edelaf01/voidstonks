import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { reglasDeCabeceras, cacheControl } from "./_helpers/pages-headers.mjs";

const DEPLOY = fileURLToPath(new URL("../deploy", import.meta.url));
const reglas = reglasDeCabeceras(readFileSync(join(DEPLOY, "_headers"), "utf8"));
const INMUTABLE = "public, max-age=31536000, immutable";

const ficheros = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? ficheros(join(dir, e.name)) : [`/${relative(DEPLOY, join(dir, e.name)).split(sep).join("/")}`]);
const publicados = ficheros(DEPLOY);

test("ningún fichero publicado recibe dos reglas de caché a la vez", () => {
  const dobles = publicados.filter((ruta) => (cacheControl(reglas, ruta).match(/max-age|no-cache/g) || []).length > 1);
  assert.deepEqual(dobles, []);
});

test("todo .js y .css se cachea como inmutable", () => {
  const otros = publicados
    .filter((ruta) => /^\/(js|css)\/.*\.(js|css)$/.test(ruta) || ruta === "/styles.css")
    .filter((ruta) => cacheControl(reglas, ruta) !== INMUTABLE);
  assert.deepEqual(otros, []);
});

test("el html y lo que no lleva versión en el nombre se revalidan", () => {
  assert.equal(cacheControl(reglas, "/"), "no-cache");
  assert.equal(cacheControl(reglas, "/index.html"), "no-cache");
  for (const ruta of ["/js/eng.traineddata", "/assets/json/metastats.json", "/assets/ml/curiosidades.json"]) {
    assert.doesNotMatch(cacheControl(reglas, ruta), /immutable/, ruta);
  }
});
