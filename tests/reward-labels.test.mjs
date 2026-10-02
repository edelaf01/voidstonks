// Paneles del overlay para la pantalla de recompensas: lo mismo que dice la insignia del modal.

import { test } from "node:test";
import assert from "node:assert/strict";
import { panelesDeRecompensas } from "../deploy/js/utils/inventory/reward_labels.js";

const t = {
  tagBestValue: "TE LLEVAS ≈{plat}p", tagBestSet: "CIERRA SET", tagBestSetNear: "TE ACERCA",
  tagBestPl: "MÁS PLAT", tagBestDuc: "MÁS DUCADOS", lblSeen: "en juego", lblUnread: "JUEGO: SIN LEER",
};
// Captura de Hildryn a 1920 con escala 1: los centros salen de xPos.
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
  assert.deepEqual(p[1].bloques.slice(0, 2), [
    { tipo: "chips", chips: [{ texto: "TE LLEVAS ≈5.2p", tipo: "valor" }] },
    { tipo: "chips", chips: [{ texto: "MÁS PLAT", tipo: "pl" }, { texto: "MÁS DUCADOS", tipo: "duc" }] },
  ]);
  assert.deepEqual(p[3].bloques[0], { tipo: "chips", chips: [{ texto: "CIERRA SET · 65p", tipo: "set" }] });
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
  assert.deepEqual(p[0].bloques[0].chips, [{ texto: "TE LLEVAS ≈12p", tipo: "valor-justo" }]);
  assert.deepEqual(p[1].bloques[0].chips, [{ texto: "TE ACERCA", tipo: "set-cerca" }]);
  assert.equal(p[1].borde, "");
});

test("sin posición la fila va centrada y sin precio sale una interrogación", () => {
  const p = panelesDeRecompensas([{ name: "A", ducats: 0 }, { name: "B", price: 3, ducats: 0 }], { anchoReferencia: 1920, t });
  assert.deepEqual(p.map((x) => +x.x.toFixed(3)), [0.437, 0.563]);
  assert.deepEqual(p[0].bloques.at(-1), { tipo: "precio", plat: "?", ducados: "" });
});
