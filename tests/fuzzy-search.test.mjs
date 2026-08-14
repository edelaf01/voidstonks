import { test } from "node:test";
import assert from "node:assert/strict";

import {
  normalizeSearchText,
  tokenize,
  editDistance,
  tokenSimilarity,
  prepareQuery,
  buildSearchIndex,
  searchIndex,
  searchItems,
} from "../deploy/js/utils/fuzzy_search.js";

// Muestra representativa de deploy: nombres canónicos de warframe.market.
const DB = [
  "Saryn Prime Blueprint",
  "Saryn Prime Chassis",
  "Saryn Prime Neuroptics",
  "Saryn Prime Systems",
  "Saryn Prime Set",
  "Wisp Prime Blueprint",
  "Wisp Prime Chassis",
  "Braton Prime Barrel",
  "Braton Prime Receiver",
  "Braton Prime Stock",
  "Braton Prime Blueprint",
  "Nikana Prime Blade",
  "Nikana Prime Hilt",
  "Dread Upper Limb",
  "Lex Prime Barrel",
  "Carrier Prime Carapace",
  "Carrier Prime Cerebrum",
  "Forma Blueprint",
];

const GLOSARIO = {
  chasis: "chassis",
  canon: "barrel",
  hoja: "blade",
  culata: "stock",
  caparazon: "carapace",
};

const find = (query, opts = {}) =>
  searchItems(query, DB, { synonyms: GLOSARIO, ...opts }).map((h) => h.item);

test("normalizeSearchText quita tildes, puntuación y mayúsculas", () => {
  assert.equal(normalizeSearchText("Cañón & Culata"), "canon culata");
  assert.equal(normalizeSearchText("  Saryn   Prime  "), "saryn prime");
  assert.equal(normalizeSearchText(null), "");
  assert.deepEqual(tokenize("Saryn Prime Chassis"), ["saryn", "prime", "chassis"]);
});

test("editDistance corta al superar el máximo en vez de calcular la distancia real", () => {
  assert.equal(editDistance("saryn", "saryn"), 0);
  assert.equal(editDistance("saryn", "sarym"), 1);
  assert.equal(editDistance("gato", "perro", 1), 2, "devuelve max+1, no la distancia real");
});

test("tokenSimilarity ordena exacta > prefijo > contenida > errata", () => {
  const exacta = tokenSimilarity("saryn", "saryn");
  const prefijo = tokenSimilarity("sar", "saryn");
  const contenida = tokenSimilarity("ary", "saryn");
  const errata = tokenSimilarity("sarym", "saryn");

  assert.equal(exacta, 1);
  assert.ok(prefijo > contenida, `${prefijo} > ${contenida}`);
  assert.ok(contenida > errata, `${contenida} > ${errata}`);
  assert.ok(errata > 0);
});

test("una errata en tres letras no se tolera: haría casar media base", () => {
  assert.equal(tokenSimilarity("lex", "dex"), 0);
});

test("la búsqueda por substring de antes sigue funcionando", () => {
  const hits = find("braton");
  assert.equal(hits.length, 4);
  assert.ok(hits.every((h) => h.startsWith("Braton Prime")));
});

test("orden libre de palabras: 'chassis saryn' encuentra 'Saryn Prime Chassis'", () => {
  assert.equal(find("chassis saryn")[0], "Saryn Prime Chassis");
});

test("las piezas en español se resuelven vía glosario", () => {
  assert.equal(find("chasis de saryn")[0], "Saryn Prime Chassis");
  assert.equal(find("hoja nikana")[0], "Nikana Prime Blade");
  assert.equal(find("caparazon carrier")[0], "Carrier Prime Carapace");
});

test("las muletillas de una consulta natural no cuentan como término de búsqueda", () => {
  assert.equal(find("quiero farmear el chasis de saryn")[0], "Saryn Prime Chassis");
  // "the" a secas sí busca "the": quitar todas las palabras dejaría la consulta vacía.
  assert.deepEqual(prepareQuery("the").tokens, ["the"]);
});

test("tolera erratas sin devolver cualquier cosa", () => {
  assert.ok(find("sarym prime").some((h) => h.startsWith("Saryn Prime")));
  assert.deepEqual(find("qqqqzzzz"), []);
});

test("los resultados salen ordenados por relevancia", () => {
  const hits = searchItems("saryn", DB, { synonyms: GLOSARIO });
  assert.ok(hits.every((h) => h.item.startsWith("Saryn Prime")));
  for (let i = 1; i < hits.length; i++) {
    assert.ok(hits[i - 1].score >= hits[i].score, "puntuaciones descendentes");
  }
});

test("las iniciales solo casan con una palabra escrita", () => {
  assert.ok(find("wp").includes("Wisp Prime Blueprint"));
  // Con varias palabras, un par de letras sueltas no debe abrir la veda.
  assert.equal(find("de la").length, 0);
});

test("empate a puntuación se rompe alfabéticamente, no por orden de entrada", () => {
  const a = searchItems("prime chassis", ["Zephyr Prime Chassis", "Ash Prime Chassis"]);
  const b = searchItems("prime chassis", ["Ash Prime Chassis", "Zephyr Prime Chassis"]);
  assert.deepEqual(a.map((h) => h.item), b.map((h) => h.item));
});

test("buildSearchIndex acepta objetos vía key y descarta entradas sin texto", () => {
  const items = [{ name: "Saryn Prime Chassis" }, { name: "" }, { otra: "cosa" }];
  const index = buildSearchIndex(items, { key: "name" });
  assert.equal(index.length, 1);
  assert.equal(searchIndex("chasis saryn", index, { synonyms: GLOSARIO })[0].item.name,
    "Saryn Prime Chassis");
});

test("limit y threshold recortan como se espera", () => {
  assert.equal(searchItems("prime", DB, { limit: 3 }).length, 3);
  assert.deepEqual(searchItems("", DB), []);
  assert.equal(searchItems("saryn", DB, { threshold: 0.999 }).length, 0);
});
