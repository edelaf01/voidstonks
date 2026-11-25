import test from "node:test";
import assert from "node:assert/strict";
import { parseTabHash, readHashState } from "../deploy/js/utils/tab_hash.js";

const TABS = ["relic", "set", "riven", "lfg", "bounties", "vosfor", "ducat", "eelog", "orders"];

test("percent-encoding malformado en contexto no lanza excepción y devuelve contexto vacío", () => {
  assert.deepEqual(parseTabHash("#relic/%E0%A4%A", TABS), { tab: "relic", ctx: "" });
  assert.deepEqual(parseTabHash("#relic/%", TABS), { tab: "relic", ctx: "" });
  assert.deepEqual(parseTabHash("#relic/%ZZ", TABS), { tab: "relic", ctx: "" });
});

test("pestaña desconocida devuelve null independientemente de que incluya contexto", () => {
  assert.equal(parseTabHash("#pestañaInvalida/detalles", TABS), null);
  assert.equal(parseTabHash("#random", TABS), null);
});

test("hash consistente únicamente en una almohadilla devuelve null", () => {
  assert.equal(parseTabHash("#", TABS), null);
  assert.equal(parseTabHash("  #  ", TABS), null);
});

test("hash con separador de contexto pero sin nombre de pestaña devuelve null", () => {
  assert.equal(parseTabHash("#/contexto", TABS), null);
  assert.equal(parseTabHash("/contexto", TABS), null);
});

test("pestaña válida seguida de barra con contexto vacío devuelve contexto en blanco", () => {
  assert.deepEqual(parseTabHash("#relic/", TABS), { tab: "relic", ctx: "" });
  assert.deepEqual(parseTabHash("set/", TABS), { tab: "set", ctx: "" });
});

test("contexto que contiene barras internas conserva la ruta completa tras la primera barra", () => {
  assert.deepEqual(parseTabHash("#relic/Axi/A1/Extra", TABS), { tab: "relic", ctx: "Axi/A1/Extra" });
  assert.deepEqual(parseTabHash("#set/item/sub/path", TABS), { tab: "set", ctx: "item/sub/path" });
});

test("contexto con doble codificación percent solo resuelve un nivel de decodificación", () => {
  assert.deepEqual(parseTabHash("#relic/Axi%2520A1", TABS), { tab: "relic", ctx: "Axi%20A1" });
});

test("hash sin almohadilla inicial procesa la pestaña y el contexto normalmente", () => {
  assert.deepEqual(parseTabHash("relic/Axi A1", TABS), { tab: "relic", ctx: "Axi A1" });
  assert.deepEqual(parseTabHash("set/Braton Prime", TABS), { tab: "set", ctx: "Braton Prime" });
});

test("lista de pestañas vacía o no array devuelve null ante cualquier hash", () => {
  assert.equal(parseTabHash("#relic/Axi", []), null);
  assert.equal(parseTabHash("#relic", null), null);
  assert.equal(parseTabHash("#relic", {}), null);
});

test("hash nulo o indefinido devuelve null sin lanzar errores de ejecución", () => {
  assert.equal(parseTabHash(null, TABS), null);
  assert.equal(parseTabHash(undefined, TABS), null);
});

test("readHashState obtiene y analiza el estado desde globalThis.location.hash o devuelve null", () => {
  const originalLocation = globalThis.location;

  globalThis.location = { hash: "#relic/Neo%20N1" };
  assert.deepEqual(readHashState(TABS), { tab: "relic", ctx: "Neo N1" });

  globalThis.location = { hash: "" };
  assert.equal(readHashState(TABS), null);

  delete globalThis.location;
  assert.equal(readHashState(TABS), null);

  globalThis.location = originalLocation;
});
