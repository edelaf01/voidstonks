import { test } from "node:test";
import assert from "node:assert/strict";
import { panelesDeRecompensas, desgloseSet } from "../deploy/js/utils/inventory/reward_labels.js";

const t = {
  tagBestValue: "TE LLEVAS ≈{plat}p", tagBestSet: "CIERRA SET", tagBestSetNear: "TE ACERCA",
  tagBestPl: "MÁS PLAT", tagBestDuc: "MÁS DUCADOS", lblSeen: "en juego", lblUnread: "JUEGO: SIN LEER", lblSetsOwned: "Sets completos: {n}", lblInApp: "Tienes", lblSetPrice: "Set entero",
};
const items = [
  { name: "Dual Zoren Prime Handle", price: 2, ducats: 15, owned: 5, ownedRead: true, xPos: 595 },
  { name: "Bronco Prime Barrel", price: 5, ducats: 45, owned: 4, ownedRead: true, xPos: 838 },
  { name: "Paris Prime Lower Limb", price: 1, ducats: 45, crafted: true, xPos: 1080 },
  { name: "Hildryn Prime Systems Blueprint", price: 4, ducats: 15, owned: null, ownedRead: false, xPos: 1322 },
];

test("cada panel dice lo mismo que la insignia del modal", () => {
  const p = panelesDeRecompensas(items, {
    anchoReferencia: 1920,
    mejor: { name: "Bronco Prime Barrel", value: { plat: 5.2 }, clear: true },
    mejores: { plat: new Set(["Bronco Prime Barrel"]), ducats: new Set(["Bronco Prime Barrel", "Paris Prime Lower Limb"]) },
    cerca: { name: "Hildryn Prime Systems Blueprint", left: 0, set: "Hildryn Prime" }, precioSet: 65, t,
  });
  assert.deepEqual(p.map((x) => x.borde), ["", "valor", "duc", "set"]);
  assert.deepEqual(p.map((x) => x.bloques[0]), items.map((it) => ({ tipo: "titulo", texto: it.name.replace(" Prime", ""), tono: "blanco" })));
  assert.deepEqual(p[1].bloques.slice(1, 3), [
    { tipo: "chips", chips: [{ texto: "TE LLEVAS ≈5.2p", tipo: "valor" }] },
    { tipo: "chips", chips: [{ texto: "MÁS PLAT", tipo: "pl" }, { texto: "MÁS DUCADOS", tipo: "duc" }] },
  ]);
  assert.deepEqual(p[3].bloques[1], { tipo: "chips", chips: [{ texto: "CIERRA SET · 65p", tipo: "set" }] });
  assert.deepEqual(p.map((x) => x.bloques.find((b) => b.tipo === "estado")), [
    { tipo: "estado", texto: "5 en juego", tono: "verde" },
    { tipo: "estado", texto: "4 en juego", tono: "verde" },
    { tipo: "estado", texto: "Crafted", tono: "apagado" },
    { tipo: "estado", texto: "JUEGO: SIN LEER", tono: "naranja" },
  ]);
  assert.deepEqual(p[0].bloques.at(-1), { tipo: "precio", plat: "2", ducados: "15" });
  assert.equal(p[1].x.toFixed(3), "0.436");
});

test("un ganador por poco va con la píldora sin rellenar y el set que solo acerca no se rellena", () => {
  const p = panelesDeRecompensas(items.slice(0, 2), {
    anchoReferencia: 1920, mejor: { name: "Dual Zoren Prime Handle", value: { plat: 12.4 }, clear: false },
    cerca: { name: "Bronco Prime Barrel", left: 2 }, t,
  });
  assert.deepEqual(p[0].bloques[1].chips, [{ texto: "TE LLEVAS ≈12p", tipo: "valor-justo" }]);
  assert.deepEqual(p[1].bloques[1].chips, [{ texto: "TE ACERCA", tipo: "set-cerca" }]);
  assert.equal(p[1].borde, "");
});

test("sin posición la fila va centrada y sin precio sale una interrogación", () => {
  const p = panelesDeRecompensas([{ name: "A", ducats: 0 }, { name: "B", price: 3, ducats: 0 }], { anchoReferencia: 1920, t });
  assert.deepEqual(p.map((x) => +x.x.toFixed(3)), [0.437, 0.563]);
  assert.deepEqual(p[0].bloques.at(-1), { tipo: "precio", plat: "?", ducados: "" });
});

test("el nombre de cada tarjeta lleva la imagen de la pieza", () => {
  const p = panelesDeRecompensas([{ name: "Steflos Prime Barrel", ducats: 100 }], { anchoReferencia: 1920, t, iconoDe: () => "assets/relic_contents/prime_barrel.webp" });
  assert.deepEqual(p[0].bloques[0], { tipo: "titulo", texto: "Steflos Barrel", tono: "blanco", imagen: "assets/relic_contents/prime_barrel.webp" });
});

test("cada tarjeta dice cuántos sets completos tienes y cuántas tienes de cada pieza del set", () => {
  const setsDatabase = { "Bo Prime": ["Bo Prime Blueprint", "Bo Prime Handle", "Bo Prime Ornament"] };
  const sets = { setsDatabase, getSetName: (n) => n.replace(/ (Blueprint|Handle|Ornament)$/, ""), getRequiredCount: (s, p) => (p.endsWith("Ornament") ? 2 : 1), precioSetDe: (set) => (set === "Bo Prime" ? 41.6 : 0) };
  const inventario = { "Bo Prime Blueprint": 3, "Bo Prime Handle": 1, "Bo Prime Ornament": 3 };
  assert.deepEqual(desgloseSet("Bo Prime Handle", { ...sets, primeInventory: inventario }).completos, 1);
  const p = panelesDeRecompensas([{ name: "Bo Prime Handle", ducats: 45, owned: 1, ownedRead: true }], { anchoReferencia: 1920, t, inventario, sets });
  assert.deepEqual(p[0].bloques.find((b) => b.tipo === "lista").filas, [
    [{ texto: "Sets completos: 1", tono: "verde" }],
    [{ texto: "Set entero", tono: "gris" }, { texto: "42", tono: "oro", icono: "plat" }],
    [{ texto: "Blueprint", tono: "gris" }, { texto: "3", tono: "verde" }],
    [{ texto: "Handle", tono: "cian" }, { texto: "1", tono: "verde" }],
    [{ texto: "Ornament", tono: "gris" }, { texto: "3/2", tono: "verde" }],
  ]);
  const sinSet = panelesDeRecompensas([{ name: "Forma Blueprint", ducats: 0 }], { anchoReferencia: 1920, t, inventario: {}, sets });
  assert.deepEqual(sinSet[0].bloques.find((b) => b.tipo === "lista").filas, [[{ texto: "Tienes", tono: "gris" }, { texto: "0", tono: "apagado" }]]);
});
