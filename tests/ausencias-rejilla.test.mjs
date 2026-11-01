import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getSetName } from "../deploy/js/utils/ui_utils.js";
import {
    VOTOS_PARA_CERO,
    CADUCIDAD_VOTO_MS,
    ESTADO_AUSENCIAS,
    claveSet,
    comparaNombres,
    revisaOrden,
    rachasConfiadas,
    ausentesEnPagina,
    registraVistos,
    acumulaNoVistos,
    cierraEscaneo
} from "../deploy/js/utils/inventory/ausencias_rejilla.js";

const corpus = JSON.parse(readFileSync(new URL("./_fixtures/corpus-verdad.json", import.meta.url), "utf8"));
const baruukNombres = corpus.inventario["baruuk.png"].nombres;
const malcountNombres = corpus.inventario["arreglar_malcount.png"].nombres;
const malcountBadges = corpus.inventario["arreglar_malcount.png"].badges;
const celdasDe = (nombres, qty = (i) => (i % 2 ? 2 : null)) => nombres.map((nombre, i) => ({ r: Math.floor(i / 6), c: i % 6, tipo: "item", nombre, qty: qty(i) }));
const PUERTA = { puerta: true, cols: 6 };
const odonataPrimero = (n) => n === "Odonata Prime Blueprint";
const T0 = Date.UTC(2026, 9, 1);
const DIA = 24 * 60 * 60 * 1000;
const sin = (lista, ...idx) => lista.filter((_, i) => !idx.includes(i));
const paginaUno = [
    "Odonata Prime Blueprint",
    "Acceltra Prime Barrel",
    "Acceltra Prime Receiver",
    "Acceltra Prime Stock",
    "Acceltra Prime Blueprint",
    "Akarius Prime Barrel",
    "Akarius Prime Receiver",
    "Akarius Prime Blueprint",
    "Akbolto Prime Barrel",
    "Akbolto Prime Link",
    "Akbolto Prime Receiver",
    "Akbolto Prime Blueprint"
];

test("claveSet extrae el prefijo del set o devuelve el propio nombre si no es de set", () => {
    assert.equal(claveSet("Bo Prime Handle", getSetName), "Bo Prime");
    assert.equal(claveSet("Kavasa Prime Kubrow Collar Blueprint", getSetName), "Kavasa Prime");
    assert.equal(claveSet("Forma Blueprint", getSetName), "Forma Blueprint");
    assert.equal(claveSet("Bo Prime", getSetName), "Bo Prime");
    assert.equal(claveSet("Odonata Prime Blueprint", getSetName, odonataPrimero), "\u0000Odonata Prime Blueprint");
    assert.equal(claveSet("Odonata Prime Harness Blueprint", getSetName, odonataPrimero), "Odonata Prime");
    assert.equal(claveSet("Odonata Prime Blueprint", getSetName), "Odonata Prime");
});

test("comparaNombres ordena piezas dentro del set con Blueprint al final", () => {
    assert.ok(comparaNombres("Okina Prime Handle", "Okina Prime Blueprint", getSetName) < 0);
    assert.ok(comparaNombres("Zhuge Prime String", "Zhuge Prime Blueprint", getSetName) < 0);
    const zhuge = [
        "Zhuge Prime Barrel",
        "Zhuge Prime Grip",
        "Zhuge Prime Receiver",
        "Zhuge Prime String",
        "Zhuge Prime Blueprint"
    ];
    assert.equal(revisaOrden(zhuge, getSetName), null);
    const zhugeMal = [
        "Zhuge Prime Blueprint",
        "Zhuge Prime Barrel",
        "Zhuge Prime Grip",
        "Zhuge Prime Receiver",
        "Zhuge Prime String"
    ];
    assert.deepEqual(revisaOrden(zhugeMal, getSetName), { motivo: "desordenado", en: 1 });
});

test("comparaNombres: el espacio va antes que las letras (Bo Prime antes que Boar Prime)", () => {
    assert.ok(comparaNombres("Bo Prime Blueprint", "Boar Prime Barrel", getSetName) < 0);
    assert.equal(revisaOrden(["Bo Prime Blueprint", "Boar Prime Barrel"], getSetName), null);
    assert.deepEqual(revisaOrden(["Boar Prime Barrel", "Bo Prime Blueprint"], getSetName), { motivo: "desordenado", en: 1 });
    assert.equal(comparaNombres("Bo Prime Handle", "Bo Prime Handle", getSetName), 0);
});

test("comparaNombres prioriza vaPrimero antes que el orden alfabetico normal", () => {
    assert.ok(comparaNombres("Odonata Prime Blueprint", "Acceltra Prime Barrel", getSetName, odonataPrimero) < 0);
    assert.ok(comparaNombres("Acceltra Prime Barrel", "Odonata Prime Blueprint", getSetName, odonataPrimero) > 0);
    assert.ok(comparaNombres("Odonata Prime Blueprint", "Acceltra Prime Barrel", getSetName) > 0);
    assert.equal(comparaNombres("Odonata Prime Blueprint", "Odonata Prime Blueprint", getSetName, odonataPrimero), 0);
    assert.ok(comparaNombres("Odonata Prime Wings Blueprint", "Okina Prime Blade", getSetName, odonataPrimero) < 0);
});

test("revisaOrden valida secuencias correctas, detecta desorden, repetidos, nombres vacios y sets partidos", () => {
    assert.equal(revisaOrden(baruukNombres, getSetName), null);
    assert.deepEqual(revisaOrden(malcountNombres, getSetName), { motivo: "desordenado", en: 3 });
    assert.deepEqual(revisaOrden(["Bo Prime Handle", "Bo Prime Handle"], getSetName), { motivo: "repetido", en: 1 });
    assert.deepEqual(revisaOrden([""], getSetName), { motivo: "sin_nombre", en: 0 });
    assert.deepEqual(revisaOrden([undefined], getSetName), { motivo: "sin_nombre", en: 0 });
    assert.deepEqual(revisaOrden(["Bo Prime Handle", null], getSetName), { motivo: "sin_nombre", en: 1 });
    assert.deepEqual(revisaOrden(["Bo Prime Handle", "Boar Prime Barrel", "Bo Prime Ornament"], getSetName), { motivo: "desordenado", en: 2 });
    assert.equal(revisaOrden([], getSetName), null);
    assert.equal(revisaOrden(paginaUno, getSetName, odonataPrimero), null);
    assert.deepEqual(revisaOrden(paginaUno, getSetName), { motivo: "desordenado", en: 1 });
});

test("rachasConfiadas agrupa celdas de items casados respetando orden de lectura y corta ante cualquier celda no item", () => {
    const celdasBaruuk = celdasDe(baruukNombres);
    const rachaEntera = rachasConfiadas(celdasBaruuk, 6);
    assert.equal(rachaEntera.length, 1);
    assert.equal(rachaEntera[0].length, 18);
    assert.equal(rachaEntera[0][0], celdasBaruuk[0]);
    assert.equal(rachaEntera[0][17], celdasBaruuk[17]);

    const rSinCols = rachasConfiadas(celdasBaruuk);
    assert.equal(rSinCols.length, 3);
    assert.equal(rSinCols[0].length, 6);
    assert.equal(rSinCols[1].length, 6);
    assert.equal(rSinCols[2].length, 6);

    const sinCoords = [{ tipo: "item", nombre: "Bo Prime Handle" }, { tipo: "item", nombre: "Bo Prime Ornament" }];
    const rSinCoords = rachasConfiadas(sinCoords, 6);
    assert.equal(rSinCoords.length, 2);
    assert.equal(rSinCoords[0].length, 1);
    assert.equal(rSinCoords[1].length, 1);

    const celdasPartidas = [...celdasBaruuk];
    celdasPartidas[8] = { r: 1, c: 2, tipo: "sin_casar", nombre: "" };
    const rPartidas = rachasConfiadas(celdasPartidas, 6);
    assert.equal(rPartidas.length, 2);
    assert.equal(rPartidas[0].length, 8);
    assert.equal(rPartidas[1].length, 9);
    assert.equal(rPartidas[0][7], celdasBaruuk[7]);
    assert.equal(rPartidas[1][0], celdasBaruuk[9]);

    const rHueco = rachasConfiadas(sin(celdasBaruuk, 8), 6);
    assert.equal(rHueco.length, 2);
    assert.equal(rHueco[0].length, 8);
    assert.equal(rHueco[1].length, 9);

    const rSalto = rachasConfiadas([
        { r: 0, c: 4, tipo: "item", nombre: "Bo Prime Handle" },
        { r: 1, c: 0, tipo: "item", nombre: "Bo Prime Ornament" }
    ], 6);
    assert.equal(rSalto.length, 2);

    for (const tipo of ["none", "riven", "reliquia", "tapada", "vacia"]) {
        const cortadas = rachasConfiadas([celdasBaruuk[0], { r: 0, c: 1, tipo }, celdasBaruuk[1]], 6);
        assert.equal(cortadas.length, 2);
        assert.equal(cortadas[0].length, 1);
        assert.equal(cortadas[1].length, 1);
    }
    const itemSinNombre = rachasConfiadas([celdasBaruuk[0], { r: 0, c: 1, tipo: "item", nombre: "" }, celdasBaruuk[1]], 6);
    assert.equal(itemSinNombre.length, 2);

    const conVaciasFinal = [...celdasBaruuk, { r: 3, c: 0, tipo: "vacia" }, { r: 3, c: 1, tipo: "vacia" }];
    const rVaciasFinal = rachasConfiadas(conVaciasFinal, 6);
    assert.equal(rVaciasFinal.length, 1);
    assert.equal(rVaciasFinal[0].length, 18);

    const invertidas = [...celdasBaruuk].reverse();
    const rInvertidas = rachasConfiadas(invertidas, 6);
    assert.equal(rInvertidas.length, 1);
    assert.equal(rInvertidas[0].length, 18);
    assert.equal(rInvertidas[0][0], celdasBaruuk[0]);
    assert.equal(rInvertidas[0][17], celdasBaruuk[17]);

    assert.deepEqual(rachasConfiadas(undefined, 6), []);
    assert.deepEqual(rachasConfiadas([], 6), []);
});

test("ausentesEnPagina: los empates de OWNED de malcount solo pasan con la puerta y los para la cantidad", () => {
    const tres = celdasDe(malcountNombres.slice(0, 3), (i) => malcountBadges[i]);
    const invKhora = {
        "Khora Prime Neuroptics Blueprint": 16,
        "Khora Prime Systems Blueprint": 16,
        "Khora Prime Blueprint": 3
    };

    assert.deepEqual(ausentesEnPagina(tres, invKhora, getSetName), { inferible: false, motivo: "sin_puerta", ausentes: [] });
    assert.deepEqual(ausentesEnPagina(tres, invKhora, getSetName, null), { inferible: false, motivo: "sin_puerta", ausentes: [] });
    assert.deepEqual(ausentesEnPagina(tres, invKhora, getSetName, { puerta: false, cols: 6 }), { inferible: false, motivo: "sin_puerta", ausentes: [] });
    assert.deepEqual(ausentesEnPagina(tres, invKhora, getSetName, { puerta: "si", cols: 6 }), { inferible: false, motivo: "sin_puerta", ausentes: [] });
    assert.deepEqual(ausentesEnPagina(tres, invKhora, getSetName, PUERTA), { inferible: false, motivo: "cantidades", ausentes: [] });

    const tresCreciente = celdasDe(malcountNombres.slice(0, 3), (i) => i + 1);
    assert.deepEqual(ausentesEnPagina(tresCreciente, invKhora, getSetName, PUERTA), {
        inferible: true,
        ausentes: ["Khora Prime Neuroptics Blueprint", "Khora Prime Systems Blueprint", "Khora Prime Blueprint"]
    });

    const tramo16 = celdasDe(malcountNombres.slice(9, 13), (i) => malcountBadges[9 + i]);
    const invTramo = { "Gara Prime Neuroptics Blueprint": 14, "Harrow Prime Systems Blueprint": 2 };
    assert.deepEqual(ausentesEnPagina(tramo16, invTramo, getSetName), { inferible: false, motivo: "sin_puerta", ausentes: [] });
    assert.deepEqual(ausentesEnPagina(tramo16, invTramo, getSetName, PUERTA), { inferible: false, motivo: "cantidades", ausentes: [] });

    const tramo16Creciente = celdasDe(malcountNombres.slice(9, 13), (i) => i + 1);
    assert.deepEqual(ausentesEnPagina(tramo16Creciente, invTramo, getSetName, PUERTA), {
        inferible: true,
        ausentes: ["Gara Prime Neuroptics Blueprint", "Harrow Prime Systems Blueprint"]
    });

    const paginaEntera = celdasDe(malcountNombres, (i) => malcountBadges[i]);
    assert.deepEqual(ausentesEnPagina(paginaEntera, invKhora, getSetName), { inferible: false, motivo: "sin_puerta", ausentes: [] });
    assert.deepEqual(ausentesEnPagina(paginaEntera, invKhora, getSetName, PUERTA), { inferible: false, motivo: "desordenado", ausentes: [] });
});

test("ausentesEnPagina infiere en una página de NAME real (baruuk)", () => {
    const sinBoOrnament = celdasDe(sin(baruukNombres, 7));
    const inv = {
        "Bo Prime Ornament": 2,
        "Bo Prime Handle": 1,
        "Baza Prime Stock": 1,
        "Baza Prime Barrel": "3"
    };
    assert.deepEqual(ausentesEnPagina(sinBoOrnament, inv, getSetName, PUERTA), {
        inferible: true,
        ausentes: ["Baza Prime Barrel", "Baza Prime Stock", "Bo Prime Ornament"]
    });

    assert.deepEqual(ausentesEnPagina(sinBoOrnament, { "Bo Prime Ornament": 0, "Baza Prime Stock": "0" }, getSetName, PUERTA), {
        inferible: true,
        ausentes: []
    });
    assert.deepEqual(ausentesEnPagina(sinBoOrnament, undefined, getSetName, PUERTA), {
        inferible: true,
        ausentes: []
    });

    const saltoFila = celdasDe(sin(baruukNombres, 12));
    assert.deepEqual(ausentesEnPagina(saltoFila, { "Boar Prime Blueprint": 1 }, getSetName, PUERTA), {
        inferible: true,
        ausentes: ["Boar Prime Blueprint"]
    });
    assert.deepEqual(ausentesEnPagina(saltoFila, { "Boar Prime Blueprint": 1 }, getSetName, { puerta: true }), {
        inferible: true,
        ausentes: []
    });

    assert.deepEqual(ausentesEnPagina(celdasDe(baruukNombres), { "Bo Prime handle": 1 }, getSetName, PUERTA), {
        inferible: true,
        ausentes: []
    });

    assert.deepEqual(ausentesEnPagina(celdasDe(["Bo Prime Handle", "Bo Prime Handle"]), {}, getSetName, PUERTA), {
        inferible: false,
        motivo: "repetido",
        ausentes: []
    });
});

test("ausentesEnPagina ignora los sets de los bordes", () => {
    const sinBaruukBp = celdasDe(sin(baruukNombres, 3));
    const invBordes = {
        "Baruuk Prime Blueprint": 1,
        "Braton Prime Receiver": 2,
        "Braton Prime Stock": 1
    };
    assert.deepEqual(ausentesEnPagina(sinBaruukBp, invBordes, getSetName, PUERTA), {
        inferible: true,
        ausentes: []
    });

    const dosSets = celdasDe(sin(baruukNombres.slice(0, 6), 1));
    assert.deepEqual(ausentesEnPagina(dosSets, { "Baruuk Prime Neuroptics Blueprint": 1, "Baza Prime Stock": 1 }, getSetName, PUERTA), {
        inferible: true,
        ausentes: []
    });

    const tresSets = celdasDe(sin(baruukNombres.slice(4, 10), 3));
    assert.deepEqual(ausentesEnPagina(tresSets, { "Bo Prime Ornament": 1 }, getSetName, PUERTA), {
        inferible: true,
        ausentes: ["Bo Prime Ornament"]
    });
});

test("ausentesEnPagina: Odonata Prime Blueprint va primero y nunca es candidato", () => {
    const invOdonata = { "Odonata Prime Blueprint": 1 };
    assert.deepEqual(ausentesEnPagina(celdasDe(paginaUno), invOdonata, getSetName, PUERTA), {
        inferible: false,
        motivo: "desordenado",
        ausentes: []
    });
    assert.deepEqual(ausentesEnPagina(celdasDe(paginaUno), invOdonata, getSetName, { ...PUERTA, vaPrimero: odonataPrimero }), {
        inferible: true,
        ausentes: []
    });

    const sinAcceltra = celdasDe(sin(paginaUno, 2));
    assert.deepEqual(ausentesEnPagina(sinAcceltra, { "Acceltra Prime Receiver": 1, "Odonata Prime Blueprint": 1 }, getSetName, { ...PUERTA, vaPrimero: odonataPrimero }), {
        inferible: true,
        ausentes: ["Acceltra Prime Receiver"]
    });

    const paginaOdonata = [
        "Octavia Prime Chassis Blueprint",
        "Octavia Prime Neuroptics Blueprint",
        "Octavia Prime Systems Blueprint",
        "Octavia Prime Blueprint",
        "Odonata Prime Harness Blueprint",
        "Odonata Prime Systems Blueprint",
        "Odonata Prime Wings Blueprint",
        "Okina Prime Blade",
        "Okina Prime Handle",
        "Okina Prime Blueprint",
        "Paris Prime Grip",
        "Paris Prime Lower Limb"
    ];
    assert.deepEqual(ausentesEnPagina(celdasDe(paginaOdonata), invOdonata, getSetName, PUERTA), {
        inferible: true,
        ausentes: ["Odonata Prime Blueprint"]
    });
    assert.deepEqual(ausentesEnPagina(celdasDe(paginaOdonata), invOdonata, getSetName, { ...PUERTA, vaPrimero: odonataPrimero }), {
        inferible: true,
        ausentes: []
    });
});

test("ausentesEnPagina no infiere si el hueco del candidato no es contiguo", () => {
    const celdasHuecoCoords = sin(celdasDe(baruukNombres), 7);
    assert.deepEqual(ausentesEnPagina(celdasHuecoCoords, { "Bo Prime Ornament": 2 }, getSetName, PUERTA), {
        inferible: true,
        ausentes: []
    });

    const celdasIlegible8 = celdasDe(baruukNombres);
    celdasIlegible8[8] = { r: 1, c: 2, tipo: "sin_casar" };
    assert.deepEqual(ausentesEnPagina(celdasIlegible8, { "Bo Prime Blueprint": 1, "Baza Prime Stock": 1 }, getSetName, PUERTA), {
        inferible: true,
        ausentes: ["Baza Prime Stock"]
    });

    const celdasIlegible8Sin15 = sin(celdasIlegible8, 15);
    assert.deepEqual(ausentesEnPagina(celdasIlegible8Sin15, { "Boltor Prime Stock": 1 }, getSetName, PUERTA), {
        inferible: true,
        ausentes: []
    });

    const celdasSin15Ilegible8 = celdasDe(sin(baruukNombres, 15));
    celdasSin15Ilegible8[8] = { r: 1, c: 2, tipo: "sin_casar" };
    assert.deepEqual(ausentesEnPagina(celdasSin15Ilegible8, { "Boltor Prime Stock": 1 }, getSetName, PUERTA), {
        inferible: true,
        ausentes: ["Boltor Prime Stock"]
    });
});

test("ausentesEnPagina aborta si las cantidades nunca suben", () => {
    const nombres = sin(baruukNombres, 7);
    const inv = { "Bo Prime Ornament": 2 };

    assert.deepEqual(ausentesEnPagina(celdasDe(nombres, () => null), inv, getSetName, PUERTA), {
        inferible: false,
        motivo: "cantidades",
        ausentes: []
    });
    assert.deepEqual(ausentesEnPagina(celdasDe(nombres, (i) => 20 - i), inv, getSetName, PUERTA), {
        inferible: false,
        motivo: "cantidades",
        ausentes: []
    });
    assert.deepEqual(ausentesEnPagina(celdasDe(nombres, () => 5), inv, getSetName, PUERTA), {
        inferible: false,
        motivo: "cantidades",
        ausentes: []
    });
    assert.deepEqual(ausentesEnPagina(celdasDe(nombres, (i) => (i === 10 ? 3 : null)), inv, getSetName, PUERTA), {
        inferible: true,
        ausentes: ["Bo Prime Ornament"]
    });
    assert.deepEqual(ausentesEnPagina(celdasDe(["Bo Prime Handle"]), inv, getSetName, PUERTA), {
        inferible: false,
        motivo: "cantidades",
        ausentes: []
    });
    assert.deepEqual(ausentesEnPagina(celdasDe(nombres, (i) => (i % 2 ? "2" : "1")), inv, getSetName, PUERTA), {
        inferible: true,
        ausentes: ["Bo Prime Ornament"]
    });
});

test("constantes del sistema de votos", () => {
    assert.deepEqual(ESTADO_AUSENCIAS, { votos: {}, apertura: null });
    assert.equal(VOTOS_PARA_CERO, 2);
    assert.equal(CADUCIDAD_VOTO_MS, 14 * DIA);
});

test("registraVistos gestiona aperturas, limpia votos de vistos y es puro", () => {
    const s1 = registraVistos(undefined, ["A1", "A2"], "S1");
    assert.deepEqual(s1.apertura, { id: "S1", vistos: ["A1", "A2"], pendientes: [] });

    const s2 = registraVistos(s1, ["A2", "A3"], "S1");
    assert.deepEqual(s2.apertura.vistos, ["A1", "A2", "A3"]);

    const s3 = registraVistos(s2, ["B1"], "S2");
    assert.deepEqual(s3.apertura, { id: "S2", vistos: ["B1"], pendientes: [] });

    const estadoInicial = {
        votos: {
            X: [{ id: "A", cant: 1, ts: T0 }],
            Y: [{ id: "A", cant: 1, ts: T0 }]
        },
        apertura: null
    };
    const clonEntrada = structuredClone(estadoInicial);
    const resBorra = registraVistos(estadoInicial, ["X"], "B");
    assert.deepEqual(resBorra.votos, {
        Y: [{ id: "A", cant: 1, ts: T0 }]
    });
    assert.deepEqual(estadoInicial, clonEntrada);
});

test("acumulaNoVistos devuelve el estado directamente, deduplica pendientes y es puro", () => {
    const e = acumulaNoVistos(undefined, ["X", "X", "Y"], "A");
    assert.deepEqual(e.apertura, { id: "A", vistos: [], pendientes: ["X", "Y"] });
    assert.deepEqual(e.votos, {});
    assert.equal("aCero" in e, false);

    const e2 = acumulaNoVistos(e, ["Y", "Z"], "A", ["W"]);
    assert.deepEqual(e2.apertura.pendientes, ["X", "Y", "Z"]);
    assert.deepEqual(e2.apertura.vistos, ["W"]);

    const e3 = acumulaNoVistos(e2, ["NUEVO"], "B");
    assert.deepEqual(e3.apertura.pendientes, ["NUEVO"]);
    assert.deepEqual(e3.apertura.vistos, []);

    const clonE2 = structuredClone(e2);
    acumulaNoVistos(e2, ["OTRO"], "C");
    assert.deepEqual(e2, clonE2);
});

test("cierraEscaneo descuenta a cero con dos aperturas y aplica reglas de votos, caducidad, inventario y pureza", () => {
    const inv = { "Bo Prime Ornament": 2 };
    const a = cierraEscaneo(acumulaNoVistos(undefined, ["Bo Prime Ornament"], "A"), "A", inv, T0);
    assert.deepEqual(a.aCero, []);
    assert.deepEqual(a.estado, {
        votos: { "Bo Prime Ornament": [{ id: "A", cant: 2, ts: T0 }] },
        apertura: null
    });

    const b = cierraEscaneo(acumulaNoVistos(a.estado, ["Bo Prime Ornament"], "B"), "B", inv, T0 + DIA);
    assert.deepEqual(b.aCero, ["Bo Prime Ornament"]);
    assert.deepEqual(b.estado.votos, {});

    const eSalva1 = acumulaNoVistos(a.estado, ["Bo Prime Ornament"], "B");
    const eSalva2 = registraVistos(eSalva1, ["Bo Prime Ornament"], "B");
    const resSalva = cierraEscaneo(eSalva2, "B", inv, T0 + DIA);
    assert.deepEqual(resSalva.aCero, []);
    assert.deepEqual(resSalva.estado.votos, {});

    const eMismoId = acumulaNoVistos(a.estado, ["Bo Prime Ornament"], "A");
    const resMismoId = cierraEscaneo(eMismoId, "A", inv, T0 + DIA);
    assert.deepEqual(resMismoId.aCero, []);
    assert.deepEqual(resMismoId.estado.votos["Bo Prime Ornament"], [{ id: "A", cant: 2, ts: T0 }]);

    const eCambio = acumulaNoVistos(a.estado, ["Bo Prime Ornament"], "B");
    const resCambio = cierraEscaneo(eCambio, "B", { "Bo Prime Ornament": 3 }, T0 + DIA);
    assert.deepEqual(resCambio.aCero, []);
    assert.deepEqual(resCambio.estado.votos, {
        "Bo Prime Ornament": [{ id: "B", cant: 3, ts: T0 + DIA }]
    });

    const eCaducado = acumulaNoVistos(a.estado, ["Bo Prime Ornament"], "B");
    const resCaducado = cierraEscaneo(eCaducado, "B", inv, T0 + 15 * DIA);
    assert.deepEqual(resCaducado.aCero, []);
    assert.deepEqual(resCaducado.estado.votos, {
        "Bo Prime Ornament": [{ id: "B", cant: 2, ts: T0 + 15 * DIA }]
    });

    const eJusto = acumulaNoVistos(a.estado, ["Bo Prime Ornament"], "B");
    const resJusto = cierraEscaneo(eJusto, "B", inv, T0 + 14 * DIA);
    assert.deepEqual(resJusto.aCero, ["Bo Prime Ornament"]);

    const estadoFuturo = {
        votos: { "Bo Prime Ornament": [{ id: "A", cant: 2, ts: T0 + DIA }] },
        apertura: null
    };
    const eFuturo = acumulaNoVistos(estadoFuturo, ["Bo Prime Ornament"], "B");
    const resFuturo = cierraEscaneo(eFuturo, "B", inv, T0);
    assert.deepEqual(resFuturo.aCero, []);
    assert.deepEqual(resFuturo.estado.votos, {
        "Bo Prime Ornament": [{ id: "B", cant: 2, ts: T0 }]
    });

    const eSinAhora = acumulaNoVistos(a.estado, ["Bo Prime Ornament"], "B");
    const resSinAhora = cierraEscaneo(eSinAhora, "B", inv);
    assert.deepEqual(resSinAhora.aCero, []);
    assert.deepEqual(resSinAhora.estado.votos, {});

    const eInvCero = acumulaNoVistos(undefined, ["X"], "A");
    const resInvCero = cierraEscaneo(eInvCero, "A", { X: 0 }, T0);
    assert.deepEqual(resInvCero.estado.votos, {});

    const eInvUndef = acumulaNoVistos(undefined, ["X"], "A");
    const resInvUndef = cierraEscaneo(eInvUndef, "A", undefined, T0);
    assert.deepEqual(resInvUndef.estado.votos, {});

    const estadoY = {
        votos: { Y: [{ id: "Z", cant: 5, ts: T0 }] },
        apertura: null
    };
    const eY = acumulaNoVistos(estadoY, [], "A");
    const resY = cierraEscaneo(eY, "A", { Y: 4 }, T0);
    assert.deepEqual(resY.estado.votos, {});

    const eDist = acumulaNoVistos(undefined, ["X"], "A");
    const resDist = cierraEscaneo(eDist, "B", { X: 1 }, T0);
    assert.equal(resDist.estado, eDist);
    assert.deepEqual(resDist.aCero, []);

    const resSinApertura = cierraEscaneo(undefined, "A", {}, T0);
    assert.deepEqual(resSinApertura, { estado: ESTADO_AUSENCIAS, aCero: [] });
    assert.equal(resSinApertura.estado, ESTADO_AUSENCIAS);

    const clonPureza = structuredClone(eDist);
    cierraEscaneo(eDist, "A", { X: 1 }, T0);
    assert.deepEqual(eDist, clonPureza);
});
