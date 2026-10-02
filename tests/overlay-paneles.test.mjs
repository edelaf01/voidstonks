// Paneles del overlay del kiosko de Baro.

import { test } from "node:test";
import assert from "node:assert/strict";
import { panelKiosko, MAX_FILAS_KIOSKO } from "../deploy/js/utils/overlay_paneles.js";

test("el kiosko enseña las piezas a echar con su platino, ratio y ducados", () => {
  const p = panelKiosko([
    { name: "Venato Prime Handle", qty: 2, plat: 3, ratio: 5, ducats: 30 },
    { name: "Alternox Prime Blueprint", qty: 1, plat: 0, ratio: Infinity, ducats: 100 },
  ], "PARA ECHAR");
  assert.equal(p.anclaje, "derecha");
  assert.deepEqual(p.bloques[0], { tipo: "titulo", texto: "PARA ECHAR", tono: "ducado" });
  assert.deepEqual(p.bloques[1].filas, [
    [{ texto: "2× Venato Prime Handle" }, { texto: "3p", tono: "cian" }, { texto: "5.0 d/pl" }, { texto: "30", tono: "ducado" }],
    [{ texto: "1× Alternox Prime Blueprint" }, { texto: "0p", tono: "cian" }, { texto: "∞ d/pl" }, { texto: "100", tono: "ducado" }],
  ]);
});

test("como mucho las primeras filas, y sin piezas no hay panel", () => {
  const muchas = Array.from({ length: 9 }, (_, i) => ({ name: `P${i}`, qty: 1, ducats: 45 }));
  assert.equal(panelKiosko(muchas, "X").bloques[1].filas.length, MAX_FILAS_KIOSKO);
  assert.equal(panelKiosko([], "X"), null);
  assert.deepEqual(panelKiosko([{ name: "Solo", qty: 1 }], "X").bloques[1].filas, [[{ texto: "1× Solo" }]]);
});

import { panelRiven, panelRivenComparacion, tonoGrado } from "../deploy/js/utils/overlay_paneles.js";

const stats = [
  { texto: "+120.5% Multishot", positivo: true, grado: "A" },
  { texto: "+80.2% Critical Chance", positivo: true, grado: "S" },
  { texto: "-30% Zoom", positivo: false, grado: null },
];

test("una carta de riven: valor, grado del arma y stats con su nota", () => {
  const p = panelRiven({ arma: "Kuva Bramma", valor: 120, min: 80, max: 160, grado: "A", score: 74, stats, rotulos: { valor: "VALOR", grado: "GRADO" } });
  assert.deepEqual(p.bloques[0], { tipo: "titulo", texto: "Kuva Bramma", tono: "cian" });
  assert.deepEqual(p.bloques[1].filas, [
    [{ texto: "VALOR", tono: "gris" }, { texto: "~120p", tono: "oro" }, { texto: "80–160p", tono: "gris" }],
    [{ texto: "GRADO", tono: "gris" }, { texto: "A", tono: "gradoA" }, { texto: "74/100", tono: "gris" }],
  ]);
  assert.deepEqual(p.bloques.at(-1).filas[2], [{ texto: "-30% Zoom", tono: "rojo" }]);
  assert.equal(panelRiven({ arma: "X", stats: [], rotulos: {} }).bloques.length, 2, "sin tasación solo arma y stats");
});

test("el ciclo marca la tirada que gana y enseña las dos", () => {
  const p = panelRivenComparacion({
    arma: "Kuva Bramma", ganador: 1, rotulos: { mejor: "ES MEJOR" },
    tiradas: [{ rotulo: "ACTUAL", precio: 85, score: 63, stats }, { rotulo: "NUEVO", precio: 120, score: 71, stats: stats.slice(0, 2) }],
  });
  assert.equal(p.borde, "valor");
  assert.deepEqual(p.bloques[1], { tipo: "chips", chips: [{ texto: "NUEVO ES MEJOR", tipo: "valor" }] });
  const listas = p.bloques.filter((b) => b.tipo === "lista");
  assert.deepEqual(listas.map((l) => l.filas[0][0]), [{ texto: "ACTUAL", tono: "gris" }, { texto: "NUEVO", tono: "verde" }]);
  assert.equal(listas[1].filas.length, 3);
  assert.deepEqual(["S+", "B", "F", "", null].map(tonoGrado), ["gradoS", "gradoB", "gradoF", "blanco", "blanco"]);
});

import { panelReliquias, MAX_RELIQUIAS, POR_ERA } from "../deploy/js/utils/overlay_paneles.js";

const T_RELIQUIAS = {
  relicsTitle: "TUS RELIQUIAS", relicsUseful: "{n} te sirven", relicsCloses: "cierra {set}", relicsMissing: "{set}: faltan {m}/{t}",
  relicsNone: "Ninguna te acerca a un set", relicsEmpty: "La app aún no tiene tus reliquias", relicsSetup: "{ref} · {n} jugadores",
  relicsRefNames: { Intact: "Intacta", Rad: "Radiante" }, relicsRefShort: { Intact: "Int", Rad: "Rad" },
};

const pick = (relic, tier, extra = {}) => ({ relic, tier, owned: 3, odds: 0.5, value: 10, parts: [], ...extra });

test("en la selección de reliquias cada fila dice copias, probabilidad, la pieza que importa y el refinamiento", () => {
  const picks = [
    pick("Neo Y2", "Neo", { odds: 0.34, value: 12.4, refino: "Rad", parts: [
      { name: "Braton Prime Stock", set: "Braton Prime", missing: 2, total: 4 },
      { name: "Akarius Prime Receiver", set: "Akarius Prime", missing: 1, total: 4 },
    ] }),
    pick("Neo V9", "Neo", { owned: 1, odds: 0, value: 0, refino: "Intact", parts: [{ name: "Lex Prime Blueprint", set: "Lex Prime", missing: 2, total: 3 }] }),
  ];
  const p = panelReliquias(picks, "Neo", T_RELIQUIAS, { refino: "Rad", escuadra: 4 });
  assert.equal(p.anclaje, "derecha");
  assert.deepEqual(p.bloques[0], { tipo: "titulo", texto: "TUS RELIQUIAS · Neo · 2 te sirven", tono: "cian" });
  assert.deepEqual(p.bloques[1], { tipo: "estado", texto: "Radiante · 4 jugadores", tono: "cian" });
  const lista = p.bloques.find((b) => b.tipo === "lista");
  assert.deepEqual(lista.filas, [
    [{ texto: "Neo Y2 ×3", tono: "blanco" }, { texto: "34% · ~12p", tono: "oro" }, { texto: "cierra Akarius", tono: "verde" }, { texto: "Rad", tono: "cian" }],
    [{ texto: "Neo V9 ×1", tono: "blanco" }, { texto: "", tono: "oro" }, { texto: "Lex: faltan 2/3", tono: "apagado" }, { texto: "Int", tono: "naranja" }],
  ]);
  const muchas = panelReliquias(Array.from({ length: 12 }, (_, i) => pick(`Neo A${i}`, "Neo")), "Neo", T_RELIQUIAS);
  assert.equal(muchas.bloques.find((b) => b.tipo === "lista").filas.length, MAX_RELIQUIAS);
});

test("sin saber la era las agrupa por era, unas pocas de cada una", () => {
  const picks = [pick("Axi A1", "Axi"), pick("Lith B1", "Lith"), pick("Axi A2", "Axi"), pick("Axi A3", "Axi"), pick("Meso C1", "Meso")];
  const filas = panelReliquias(picks, null, T_RELIQUIAS).bloques.find((b) => b.tipo === "lista").filas;
  assert.deepEqual(filas.map((f) => f[0].texto), ["LITH", "Lith B1 ×3", "MESO", "Meso C1 ×3", "AXI", "Axi A1 ×3", "Axi A2 ×3"]);
  assert.ok(filas.filter((f) => f.length > 1).length <= MAX_RELIQUIAS);
  assert.equal(filas.filter((f) => f[0].texto.startsWith("Axi")).length, POR_ERA);
});

test("sin reliquias en la app el panel lo dice en vez de no salir", () => {
  const texto = (n) => panelReliquias([], "Neo", T_RELIQUIAS, { reliquiasEnApp: n }).bloques.at(-1).filas[0][0].texto;
  assert.equal(texto(0), "La app aún no tiene tus reliquias");
  assert.equal(texto(40), "Ninguna te acerca a un set");
});
