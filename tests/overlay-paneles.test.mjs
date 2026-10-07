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
  assert.deepEqual(p.bloques.at(-1).filas[2], [{ texto: "-30% Zoom", tono: "rojo" }, { texto: "", tono: "gris" }, { texto: "", tono: "blanco" }]);
  assert.equal(panelRiven({ arma: "X", stats: [], rotulos: {} }).bloques.length, 2, "sin tasación solo arma y stats");
});

test("cada stat del riven en dos campos con rótulo: lo bueno que es el atributo y la tirada con su percentil", () => {
  const conCampos = [
    { texto: "+80.9% Multishot", positivo: true, grado: "A+", pct: 84.6, calidad: { texto: "TOP", tono: "oro" } },
    { texto: "-19.5% Zoom", positivo: false, grado: "SSS", pct: 99, calidad: { texto: "INOFENSIVA", tono: "verde" } },
  ];
  const p = panelRiven({ arma: "Kuva Bramma", stats: conCampos, rotulos: { atributo: "ATRIBUTO", tirada: "TIRADA" } });
  assert.deepEqual(p.bloques.at(-1).filas, [
    [{ texto: "", tono: "gris" }, { texto: "ATRIBUTO", tono: "gris" }, { texto: "TIRADA", tono: "gris" }],
    [{ texto: "+80.9% Multishot", tono: "verde" }, { texto: "TOP", tono: "oro" }, { texto: "A+ · p85", tono: "gradoA" }],
    [{ texto: "-19.5% Zoom", tono: "rojo" }, { texto: "INOFENSIVA", tono: "verde" }, { texto: "SSS · p99", tono: "gradoS" }],
  ]);
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
  relicsRefLabel: "Refino", relicsSquadLabel: "Jugad.", relicsEraLabel: "Era", relicsAllEras: "Todas",
  relicsAnyRef: "Cualquiera", relicsGoalLabel: "Objetivo", relicsGoals: { valor: "Valor", sets: "Sets", plat: "Platino", ducados: "Ducados" },
  relicsNoValue: "Aún no hay precios para estas reliquias", relicsAtRef: "en {ref}:", relicsBestRef: "mejor en {ref}", relicsPerTrace: "{n}{u}/vestigio",
};

const pick = (relic, tier, extra = {}) => ({ relic, tier, owned: 3, odds: 0.5, value: 10, parts: [], ...extra });

test("en la selección de reliquias cada fila dice copias, el set, la pieza con SU probabilidad y su precio", () => {
  const picks = [
    pick("Neo Y2", "Neo", { refino: "Rad", mejorRefino: "Rad", parts: [
      { name: "Braton Prime Stock", set: "Braton Prime", missing: 2, total: 4, chance: 0.5, price: 3 },
      { name: "Akarius Prime Receiver", set: "Akarius Prime", missing: 1, total: 4, chance: 0.344, price: 30 },
    ] }),
    pick("Neo V9", "Neo", { owned: 1, refino: "Rad", mejorRefino: "Intact", parts: [{ name: "Lex Prime Blueprint", set: "Lex Prime", missing: 2, total: 3, chance: 0.004, price: 0 }] }),
  ];
  const p = panelReliquias(picks, "Neo", T_RELIQUIAS, { refino: "Rad", escuadra: 4 });
  assert.equal(p.anclaje, "derecha");
  assert.equal(p.anchoMin, 0.2);
  assert.deepEqual(p.bloques[0], { tipo: "titulo", texto: "TUS RELIQUIAS · Neo · 2 te sirven", tono: "cian" });
  const botones = p.bloques.filter((b) => b.tipo === "botones");
  assert.deepEqual(botones.map((b) => b.botones.find((x) => x.activo)?.accion), ["objetivo:sets", "refino:Rad", "escuadra:4", "era:Neo"]);
  assert.deepEqual(botones[1].botones.map((x) => x.accion), ["refino:Any", "refino:Intact", "refino:Exceptional", "refino:Flawless", "refino:Rad"]);
  assert.equal(panelReliquias(picks, null, T_RELIQUIAS, { refino: "Rad", escuadra: 1 }).bloques.filter((b) => b.tipo === "botones")[3].botones[0].activo, true, "sin era, Todas");
  assert.deepEqual(p.bloques.find((b) => b.tipo === "lista").filas, [
    [{ texto: "Neo Y2 ×3", tono: "blanco" }, { texto: "cierra Akarius", tono: "verde" }, { texto: "Receiver 34%", tono: "gris" }, { texto: "30", tono: "oro", icono: "plat" }, { texto: "mejor en Radiante", tono: "verde" }],
    [{ texto: "Neo V9 ×1", tono: "blanco" }, { texto: "Lex: faltan 2/3", tono: "apagado" }, { texto: "Blueprint <1%", tono: "gris" }, { texto: "", tono: "oro" }, { texto: "mejor en Intacta", tono: "naranja" }],
  ], "con un refino elegido cada fila dice si ese es su mejor refino o cuál lo es");
  const cualquiera = panelReliquias(picks, "Neo", T_RELIQUIAS, { refino: null, escuadra: 4 });
  assert.equal(cualquiera.bloques.filter((b) => b.tipo === "botones")[1].botones.find((x) => x.activo).accion, "refino:Any");
  assert.deepEqual(cualquiera.bloques.find((b) => b.tipo === "lista").filas.map((f) => f[4]), [{ texto: "mejor en Radiante", tono: "cian" }, { texto: "mejor en Radiante", tono: "cian" }]);
  const clave = { name: "Akbronco Prime Blueprint", set: "Akbronco Prime", missing: 1, total: 2, chance: 0.25, price: 2 };
  assert.equal(panelReliquias([{ ...picks[0], clave }], "Neo", T_RELIQUIAS, { refino: "Rad", escuadra: 4 }).bloques.at(-1).filas[0][1].texto, "cierra Akbronco", "manda la pieza clave que elige el cálculo");
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

test("varias reliquias para el mismo set salen en una fila con cuántas más lo hacen", () => {
  const akbronco = [{ name: "Akbronco Prime Blueprint", set: "Akbronco Prime", missing: 1, total: 2 }];
  const picks = [
    pick("Lith A12", "Lith", { parts: akbronco }), pick("Lith B11", "Lith", { parts: akbronco }),
    pick("Lith L8", "Lith", { parts: [{ name: "Lavos Prime Systems Blueprint", set: "Lavos Prime", missing: 1, total: 4 }] }),
    pick("Lith K9", "Lith", { parts: akbronco }),
  ];
  const p = panelReliquias(picks, "Lith", T_RELIQUIAS, { refino: "Intact", escuadra: 4 });
  assert.equal(p.bloques[0].texto, "TUS RELIQUIAS · Lith · 4 te sirven");
  assert.deepEqual(p.bloques.find((b) => b.tipo === "lista").filas.map((f) => `${f[0].texto} ${f[1].texto}`), ["Lith A12 ×3 cierra Akbronco +2", "Lith L8 ×3 cierra Lavos"]);
});

test("con objetivo platino o ducados cada fila da lo mejor que suelta, lo que vale y su probabilidad", () => {
  const picks = [{ relic: "Lith A8", tier: "Lith", owned: 5, ev: 12.4, refino: "Rad", mejor: { name: "Akarius Prime Receiver", valor: 30, chance: 0.344 } }];
  const plat = panelReliquias(picks, "Lith", T_RELIQUIAS, { refino: null, escuadra: 4, objetivo: "plat" });
  assert.equal(plat.bloques[0].texto, "TUS RELIQUIAS · Lith");
  assert.deepEqual(plat.bloques.find((b) => b.tipo === "lista").filas[0], [
    { texto: "Lith A8 ×5", tono: "blanco" }, { texto: "Akarius Receiver", tono: "gris" }, { texto: "30", tono: "oro", icono: "plat" }, { texto: "34%", tono: "gris" }, { texto: "mejor en Radiante", tono: "cian" },
  ]);
  const duc = panelReliquias(picks, "Lith", T_RELIQUIAS, { refino: "Rad", escuadra: 4, objetivo: "ducados" });
  assert.deepEqual(duc.bloques.find((b) => b.tipo === "lista").filas[0][2], { texto: "30", tono: "ducado", icono: "ducado" });
  assert.equal(panelReliquias([], "Lith", T_RELIQUIAS, { objetivo: "plat" }).bloques.at(-1).filas[0][0].texto, "Aún no hay precios para estas reliquias");
});

test("con objetivo valor la fila dice si la pieza cierra un set y, si va a ducados, cuántos da", () => {
  const mejor = { name: "Akbronco Prime Blueprint", valor: 29.5, chance: 0.69, ruta: "set", set: "Akbronco Prime", quedan: 0, total: 2, ducados: 15 };
  const fila = (m) => panelReliquias([{ relic: "Lith K9", tier: "Lith", owned: 23, ev: 9, refino: "Intact", mejorRefino: "Intact", mejor: m }], "Lith", T_RELIQUIAS, { refino: "Intact", escuadra: 4, objetivo: "valor" }).bloques.at(-1).filas[0];
  assert.deepEqual(fila(mejor).slice(0, 5), [
    { texto: "Lith K9 ×23", tono: "blanco" }, { texto: "cierra Akbronco", tono: "verde" }, { texto: "Akbronco Blueprint", tono: "gris" }, { texto: "30", tono: "oro", icono: "plat" }, { texto: "69%", tono: "gris" },
  ]);
  assert.deepEqual(fila({ ...mejor, quedan: 1 })[1], { texto: "Akbronco: faltan 2/2", tono: "apagado" });
  const ducados = fila({ name: "Alternox Prime Blueprint", valor: 10, chance: 0.08, ruta: "ducats", set: null, quedan: null, total: 0, ducados: 100 });
  assert.deepEqual(ducados.slice(1, 4), [{ texto: "", tono: "apagado" }, { texto: "Alternox Blueprint", tono: "gris" }, { texto: "100", tono: "ducado", icono: "ducado" }]);
  const objetivos = panelReliquias([], "Lith", T_RELIQUIAS, { refino: "Intact", escuadra: 4, objetivo: "valor" }).bloques.filter((b) => b.tipo === "botones")[0].botones;
  assert.deepEqual(objetivos.map((x) => x.accion), ["objetivo:valor", "objetivo:sets", "objetivo:plat", "objetivo:ducados"]);
  assert.equal(objetivos.find((x) => x.activo).accion, "objetivo:valor");
});

test("con un refino elegido, lo que ganarías refinando se dice con su probabilidad, y cada pieza lleva su imagen", () => {
  const clave = { name: "Cobra & Crane Prime Blade", set: "Cobra & Crane Prime", missing: 1, total: 3, chance: 0.11, price: 5 };
  const otra = { name: "Akarius Prime Receiver", set: "Akarius Prime", missing: 1, total: 3, chance: 0.02, price: 27 };
  const picks = [
    pick("Neo G7", "Neo", { clave, refino: "Intact", mejorRefino: "Rad", ganancia: { refino: "Rad", pieza: clave.name, set: clave.set, chance: 0.2 } }),
    pick("Lith A8", "Neo", { clave: otra, refino: "Intact", mejorRefino: "Rad", ganancia: { refino: "Rad", pieza: "Bronco Prime Receiver", set: "Bronco Prime", chance: 0.167 } }),
  ];
  const iconoDe = (n) => `assets/relic_contents/${n.toLowerCase().replaceAll(" ", "_")}.webp`;
  const filas = panelReliquias(picks, "Neo", T_RELIQUIAS, { refino: "Intact", escuadra: 1, iconoDe }).bloques.at(-1).filas;
  assert.deepEqual(filas[0][4], { texto: "en Rad: 20%", tono: "naranja" });
  assert.deepEqual(filas[1][4], { texto: "en Rad: Receiver 17%", tono: "naranja" }, "si lo que gana es otra pieza, se nombra");
  assert.equal(filas[0][2].imagen, "assets/relic_contents/cobra_&_crane_prime_blade.webp");
});

test("en platino se ve cuánto rinde cada vestigio al refinar", () => {
  const base = { relic: "Lith A8", tier: "Lith", owned: 5, ev: 4, mejor: { name: "Akarius Prime Receiver", valor: 30, chance: 0.08 }, porVestigio: 0.123 };
  const cualquiera = panelReliquias([{ ...base, refino: "Rad", mejorRefino: "Rad" }], "Lith", T_RELIQUIAS, { refino: null, escuadra: 4, objetivo: "plat" });
  assert.deepEqual(cualquiera.bloques.at(-1).filas[0][4], { texto: "mejor en Radiante · 0.12p/vestigio", tono: "cian" });
  const intacta = panelReliquias([{ ...base, refino: "Intact", mejorRefino: "Rad", ganancia: { refino: "Rad", pieza: "Akarius Prime Receiver", chance: 0.34 } }], "Lith", T_RELIQUIAS, { refino: "Intact", escuadra: 4, objetivo: "plat" });
  assert.deepEqual(intacta.bloques.at(-1).filas[0][4], { texto: "en Rad: 34% · 0.12p/vestigio", tono: "naranja" });
  const paraRuns = panelReliquias([{ ...base, refino: "Intact", mejorRefino: "Intact", porVestigio: 0.01 }], "Lith", T_RELIQUIAS, { refino: "Intact", escuadra: 4, objetivo: "plat" });
  assert.deepEqual(paraRuns.bloques.at(-1).filas[0][4], { texto: "mejor en Intacta", tono: "verde" });
});

test("sin reliquias en la app el panel lo dice en vez de no salir", () => {
  const texto = (n) => panelReliquias([], "Neo", T_RELIQUIAS, { reliquiasEnApp: n }).bloques.at(-1).filas[0][0].texto;
  assert.equal(texto(0), "La app aún no tiene tus reliquias");
  assert.equal(texto(40), "Ninguna te acerca a un set");
});

import { panelInventario } from "../deploy/js/utils/overlay_paneles.js";
test("panelInventario: botones y autoScanScanning", () => {
  const t = { statusInventory: "INVENTARIO", autoScanScanning: "ESCANEANDO", autoScanCaptured: "CAPTURADA", lblDetected: "DETECTADOS", ovlScanPage: "ESCANEAR", ovlAuto: "AUTO", ovlSave: "GUARDAR" };
  const p = panelInventario({ detectados: 3, auto: true, escaneando: true }, t);
  assert.equal(p.x, 0.985);
  assert.equal(p.bloques[1].texto, "ESCANEANDO");
  assert.equal(p.bloques[1].tono, "cian");
  const botones = p.bloques[2].botones;
  assert.equal(botones[0].accion, "inv:escanear");
  assert.equal(botones[1].accion, "inv:auto");
  assert.equal(botones[1].activo, true);
  assert.equal(botones[2].accion, "inv:guardar");
  
  const p2 = panelInventario({ detectados: 5, auto: false, escaneando: false }, t);
  assert.equal(p2.bloques[1].texto, "DETECTADOS: 5");
  assert.equal(p2.bloques[1].tono, "verde");
  assert.equal(p2.bloques[2].botones[1].activo, false);

  const p3 = panelInventario({ detectados: 5, auto: false, escaneando: false, capturada: true }, t);
  assert.equal(p3.bloques[1].texto, "CAPTURADA");
  assert.equal(p3.bloques[1].tono, "verde");

  const p4 = panelInventario({ detectados: 5, auto: false, escaneando: true, capturada: true }, t);
  assert.equal(p4.bloques[1].texto, "CAPTURADA");
  assert.equal(p4.bloques[1].tono, "verde");
});


import { panelArcanos } from "../deploy/js/utils/overlay_paneles.js";
test("panelArcanos coloca cada arcano en su celda de la página, con precios y veredicto", () => {
  const t = { scannerHUD: { statusArcanes: "ARCANES" }, vosfor: { verdictSell: "SELL", verdictSellR0: "SELL R0", verdictDissolve: "DISSOLVE", verdictEven: "EVEN" } };
  assert.equal(panelArcanos([], t), null);

  const filas = [
    { name: "Arcane Nullifier", qty: 21, maxRank: 5, rangosMax: 1, accion: "sell_max", r: 0, c: 0, precioR0: 4.5, precioMax: 120 },
    { name: "Arcane Ice", qty: 45, maxRank: 5, rangosMax: 2, accion: "dissolve", r: 0, c: 2, precioR0: 1, precioMax: 0 },
    { name: "Arcane Strike", qty: 3, maxRank: 3, rangosMax: 0, accion: "even", r: 1, c: 1, precioR0: null, precioMax: 15.4 },
  ];

  const p = panelArcanos(filas, t);
  assert.equal(p.bloques[0].texto, "ARCANES");
  const { tipo, cols, celdas } = p.bloques[1];
  assert.equal(tipo, "rejilla");
  assert.equal(cols, 3);
  assert.equal(celdas.length, 6);
  assert.deepEqual(celdas.map((c) => c?.lineas[0].texto ?? null), ["Arcane Nullifier", null, "Arcane Ice", null, "Arcane Strike", null]);
  assert.deepEqual(celdas[0].lineas, [
    { texto: "Arcane Nullifier" }, { texto: "21 · 1×R5" },
    { texto: "R0 4.5 pl", tono: "oro" }, { texto: "R5 120 pl", tono: "oro" },
    { texto: "SELL R5", tono: "verde" },
  ]);
  assert.deepEqual(celdas[2].lineas.slice(2), [{ texto: "R0 1 pl", tono: "oro" }, { texto: "R5 —", tono: "oro" }, { texto: "DISSOLVE", tono: "cian" }]);
  assert.deepEqual(celdas[4].lineas.slice(1), [{ texto: "3" }, { texto: "R0 —", tono: "oro" }, { texto: "R3 15 pl", tono: "oro" }, { texto: "EVEN", tono: "gris" }]);
});
