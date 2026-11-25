import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSearchIndex,
  searchIndex,
} from "../deploy/js/utils/fuzzy_search.js";

const PALETTE_SEARCH_OPTS = { limit: 6, threshold: 0.5 };

test("query vacía o compuesta solo por espacios devuelve un array vacío", () => {
  const items = [{ label: "Reliquias" }, { label: "Braton Prime" }];
  const index = buildSearchIndex(items, { key: "label" });

  assert.deepEqual(searchIndex("", index, PALETTE_SEARCH_OPTS), []);
  assert.deepEqual(searchIndex("   ", index, PALETTE_SEARCH_OPTS), []);
  assert.deepEqual(searchIndex("\t\n", index, PALETTE_SEARCH_OPTS), []);
});

test("texto sin relación con los elementos del índice no produce resultados", () => {
  const items = [
    { label: "Reliquias" },
    { label: "Braton Prime" },
    { label: "Sargas Ruk" },
  ];
  const index = buildSearchIndex(items, { key: "label" });

  const resultados = searchIndex("zzzzzzzzz", index, PALETTE_SEARCH_OPTS);
  assert.deepEqual(resultados, []);
});

test("la búsqueda normaliza acentos y es insensible a mayúsculas y minúsculas", () => {
  const items = [
    { label: "Ámbar Archon Shard" },
    { label: "Reliquias" },
  ];
  const index = buildSearchIndex(items, { key: "label" });

  const resAmbarSinAcento = searchIndex("ambar", index, PALETTE_SEARCH_OPTS);
  assert.equal(resAmbarSinAcento.length, 1);
  assert.equal(resAmbarSinAcento[0].item.label, "Ámbar Archon Shard");

  const resAmbarConAcento = searchIndex("ÁMBAR", index, PALETTE_SEARCH_OPTS);
  assert.equal(resAmbarConAcento.length, 1);
  assert.equal(resAmbarConAcento[0].item.label, "Ámbar Archon Shard");

  const resReliquiasMinus = searchIndex("reliquias", index, PALETTE_SEARCH_OPTS);
  assert.equal(resReliquiasMinus.length, 1);
  assert.equal(resReliquiasMinus[0].item.label, "Reliquias");

  const resReliquiasMayus = searchIndex("RELIQUIAS", index, PALETTE_SEARCH_OPTS);
  assert.equal(resReliquiasMayus.length, 1);
  assert.equal(resReliquiasMayus[0].item.label, "Reliquias");
});

test("la búsqueda tolera errores tipográficos de una letra", () => {
  const items = [{ label: "Reliquias" }, { label: "Calculadora" }];
  const index = buildSearchIndex(items, { key: "label" });

  const resultados = searchIndex("reliquas", index, PALETTE_SEARCH_OPTS);
  assert.ok(resultados.length >= 1);
  assert.equal(resultados[0].item.label, "Reliquias");
});

test("el límite de seis resultados configurado para la paleta es respetado", () => {
  const items = [
    { label: "Braton Prime" },
    { label: "Burston Prime" },
    { label: "Paris Prime" },
    { label: "Orthos Prime" },
    { label: "Lex Prime" },
    { label: "Fang Prime" },
    { label: "Akarius Prime" },
    { label: "Venato Prime" },
  ];
  const index = buildSearchIndex(items, { key: "label" });

  const resultados = searchIndex("prime", index, PALETTE_SEARCH_OPTS);
  assert.equal(resultados.length, 6);
});

test("la coincidencia exacta se sitúa por delante de coincidencias parciales por mayor puntuación", () => {
  const items = [
    { label: "Braton Prime Set" },
    { label: "Braton" },
    { label: "Braton Prime" },
  ];
  const index = buildSearchIndex(items, { key: "label" });

  const resBraton = searchIndex("braton", index, PALETTE_SEARCH_OPTS);
  assert.equal(resBraton[0].item.label, "Braton");

  const resBratonPrime = searchIndex("braton prime", index, PALETTE_SEARCH_OPTS);
  assert.equal(resBratonPrime[0].item.label, "Braton Prime");
});

test("buscar sobre un índice vacío devuelve un array vacío sin lanzar excepciones", () => {
  const index = buildSearchIndex([], { key: "label" });
  assert.deepEqual(searchIndex("relic", index, PALETTE_SEARCH_OPTS), []);
});

test("buildSearchIndex tolera elementos nulos, indefinidos o sin propiedad label válida", () => {
  const items = [
    null,
    undefined,
    {},
    { id: 1 },
    { label: null },
    { label: undefined },
    { label: "" },
    { label: 12345 },
    { label: "Elemento Válido" },
  ];
  const index = buildSearchIndex(items, { key: "label" });

  assert.equal(index.length, 1);
  assert.equal(index[0].item.label, "Elemento Válido");

  const res = searchIndex("valido", index, PALETTE_SEARCH_OPTS);
  assert.equal(res.length, 1);
  assert.equal(res[0].item.label, "Elemento Válido");
});
