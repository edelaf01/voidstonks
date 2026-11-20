import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const { dbHelper } = await import("../deploy/js/repositories/storage.repository.js");
dbHelper.get = async () => [
  { id: "1", reliquia: "Lith B4 (Radiant)", minutos: 5 },
  { id: "2", reliquia: "Lith B4", minutos: 7 },
];

const {
  normalizaReliquia,
  initSesionesFarmeo,
  leeSesiones,
  sesionesCargadas,
  minutosDeReliquia,
} = await import("../deploy/js/services/farms/sesiones_farmeo.service.js");

test("normalizaReliquia elimina sufijos de reliquia y refinamiento", () => {
  assert.equal(normalizaReliquia("  Neo V8 Relic (Radiant)  "), "neo v8");
  assert.equal(normalizaReliquia("Meso A1 (Intact)"), "meso a1");
});

test("normalizaReliquia devuelve cadena vacia si no recibe nombre", () => {
  assert.equal(normalizaReliquia(null), "");
  assert.equal(normalizaReliquia(""), "");
});

test("sesionesCargadas reporta falso antes de la inicializacion", () => {
  assert.equal(sesionesCargadas(), false);
});

test("minutosDeReliquia devuelve null antes de cargar sesiones", () => {
  assert.equal(minutosDeReliquia("Neo V8"), null);
  assert.equal(minutosDeReliquia(""), null);
});

test("initSesionesFarmeo carga las sesiones y marca el estado como cargado", async () => {
  await initSesionesFarmeo();
  assert.equal(sesionesCargadas(), true);
});

test("leeSesiones devuelve la lista de sesiones cargadas", () => {
  const lista = leeSesiones();
  assert.equal(lista.length, 2);
  assert.equal(lista[0].id, "1");
});

test("minutosDeReliquia calcula la duracion media de la reliquia", () => {
  assert.equal(minutosDeReliquia("Lith B4 (Intact)"), 6);
  assert.equal(minutosDeReliquia("Axi A1"), null);
});
