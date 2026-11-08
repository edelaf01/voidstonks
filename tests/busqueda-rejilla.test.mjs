import { test } from "node:test";
import assert from "node:assert/strict";
import {
    MIN_CONSULTA,
    VACIA_STD,
    ESTADO_BUSQUEDA,
    normalizaTexto,
    normalizaConsulta,
    resuelveConsulta,
    rejillaCompleta,
    ausentesDeBusqueda,
    pasoBusqueda,
    categoriaDeBusqueda,
    analizaFranjaBusqueda,
    celdaEnBlanco
} from "../deploy/js/utils/inventory/busqueda_rejilla.js";
import { ESTADO_AUSENCIAS } from "../deploy/js/utils/inventory/ausencias_rejilla.js";

function pagina(nombres, filas, cols, extra) {
    const celdas = [];
    const total = filas * cols;
    const otraSet = new Set(Array.isArray(extra) ? extra : extra?.otra || []);
    for (let i = 0; i < total; i++) {
        const r = Math.floor(i / cols);
        const c = i % cols;
        if (extra && typeof extra === "object" && !Array.isArray(extra) && extra[i]) {
            celdas.push({ r, c, ...extra[i] });
        } else if (otraSet.has(i)) {
            celdas.push({ r, c, tipo: "otra" });
        } else if (i < (nombres || []).length) {
            celdas.push({ r, c, tipo: "item", nombre: nombres[i] });
        } else {
            celdas.push({ r, c, tipo: "vacia" });
        }
    }
    return celdas;
}

test("constantes exportadas", () => {
    assert.equal(MIN_CONSULTA, 3);
    assert.equal(VACIA_STD, 8);
    assert.equal(ESTADO_BUSQUEDA.clave, null);
    assert.equal(ESTADO_BUSQUEDA.ausencias, ESTADO_AUSENCIAS);
    assert.equal(Object.isFrozen(ESTADO_BUSQUEDA), true);
});

test("normalizaTexto y normalizaConsulta limpian cadenas y placeholders", () => {
    assert.equal(normalizaTexto("  Akbronco   Prime \n\t Blueprint  "), "akbronco prime blueprint");
    assert.equal(normalizaTexto(null), "");
    assert.equal(normalizaTexto(undefined), "");
    assert.equal(normalizaTexto(""), "");
    assert.equal(normalizaConsulta("SEARCH..."), "");
    assert.equal(normalizaConsulta("Search"), "");
    assert.equal(normalizaConsulta("  search   "), "");
    assert.equal(normalizaConsulta("search!"), "");
    assert.equal(normalizaConsulta("bronco"), "bronco");
    assert.equal(normalizaConsulta("search something"), "search something");
});

test("resuelveConsulta maneja cursores de texto y sufijos genuinos", () => {
    const visibleBronco = ["Akbronco Prime Blueprint", "Bronco Prime Barrel"];
    for (const txt of ["broncol", "bronco|", "bronco l", "bronco1", "bronco!"]) {
        assert.equal(resuelveConsulta(txt, visibleBronco), "bronco");
    }
    assert.equal(resuelveConsulta("col", ["Kavasa Prime Collar"]), "coll");
});

test("resuelveConsulta descarta consultas cortas, placeholders y nombres no coincidentes", () => {
    assert.equal(resuelveConsulta("br", ["Akbronco Prime Blueprint"]), null);
    assert.equal(resuelveConsulta("a", ["Akbronco Prime Blueprint"]), null);
    assert.equal(resuelveConsulta("SEARCH...", ["Akbronco Prime Blueprint"]), null);
    assert.equal(resuelveConsulta("Search", ["Akbronco Prime Blueprint"]), null);
    assert.equal(resuelveConsulta("bronco", ["Akbronco Prime Blueprint", "Braton Prime Stock"]), null);
    assert.equal(resuelveConsulta("bronco", []), null);
    assert.equal(resuelveConsulta("bronco", null), null);
    assert.equal(resuelveConsulta("bronco@#$", ["Akbronco Prime Blueprint"]), null);
});

test("rejillaCompleta valida filas, columnas, tipos de celda y posiciones", () => {
    assert.equal(rejillaCompleta(pagina(["A", "B"], 2, 2, [1]), 2, 2), false);

    const celdasGap = [
        { r: 0, c: 0, tipo: "item", nombre: "A" },
        { r: 0, c: 1, tipo: "vacia" },
        { r: 1, c: 0, tipo: "item", nombre: "B" },
        { r: 1, c: 1, tipo: "vacia" }
    ];
    assert.equal(rejillaCompleta(celdasGap, 2, 2), false);

    const celdasDup = [
        { r: 0, c: 0, tipo: "item", nombre: "A" },
        { r: 0, c: 0, tipo: "vacia" },
        { r: 0, c: 1, tipo: "vacia" },
        { r: 1, c: 0, tipo: "vacia" }
    ];
    assert.equal(rejillaCompleta(celdasDup, 2, 2), false);

    const celdasOutOfRange = [
        { r: 0, c: 0, tipo: "item", nombre: "A" },
        { r: 0, c: 1, tipo: "vacia" },
        { r: 1, c: 0, tipo: "vacia" },
        { r: 2, c: 0, tipo: "vacia" }
    ];
    assert.equal(rejillaCompleta(celdasOutOfRange, 2, 2), false);

    const celdasNegPos = [
        { r: -1, c: 0, tipo: "item", nombre: "A" },
        { r: 0, c: 1, tipo: "vacia" },
        { r: 1, c: 0, tipo: "vacia" },
        { r: 1, c: 1, tipo: "vacia" }
    ];
    assert.equal(rejillaCompleta(celdasNegPos, 2, 2), false);

    assert.equal(rejillaCompleta(pagina([], 2, 2), 2, 2), false);
    assert.equal(rejillaCompleta(pagina(["A"], 2, 2), 0, 2), false);
    assert.equal(rejillaCompleta(pagina(["A"], 2, 2), 2, 0), false);
    assert.equal(rejillaCompleta(pagina(["A"], 2, 2), 1.5, 2), false);
    assert.equal(rejillaCompleta(pagina(["A"], 2, 2), -1, 2), false);
    assert.equal(rejillaCompleta(pagina(["A"], 2, 2), null, 2), false);
    assert.equal(rejillaCompleta(null, 2, 2), false);
    assert.equal(rejillaCompleta([], 2, 2), false);

    const celdasSinNombre = [
        { r: 0, c: 0, tipo: "item", nombre: "" },
        { r: 0, c: 1, tipo: "vacia" },
        { r: 1, c: 0, tipo: "vacia" },
        { r: 1, c: 1, tipo: "vacia" }
    ];
    assert.equal(rejillaCompleta(celdasSinNombre, 2, 2), false);

    const celdasNullNombre = [
        { r: 0, c: 0, tipo: "item", nombre: null },
        { r: 0, c: 1, tipo: "vacia" },
        { r: 1, c: 0, tipo: "vacia" },
        { r: 1, c: 1, tipo: "vacia" }
    ];
    assert.equal(rejillaCompleta(celdasNullNombre, 2, 2), false);

    const celdasUndefNombre = [
        { r: 0, c: 0, tipo: "item" },
        { r: 0, c: 1, tipo: "vacia" },
        { r: 1, c: 0, tipo: "vacia" },
        { r: 1, c: 1, tipo: "vacia" }
    ];
    assert.equal(rejillaCompleta(celdasUndefNombre, 2, 2), false);
});

test("rejillaCompleta comprueba filas completas y cortes por scroll", () => {
    const celdas18 = pagina(Array.from({ length: 18 }, (_, i) => `Item ${i}`), 3, 6);
    assert.equal(rejillaCompleta(celdas18, 3, 6), false);

    const celdas12 = pagina(Array.from({ length: 12 }, (_, i) => `Item ${i}`), 2, 6);
    assert.equal(rejillaCompleta(celdas12, 2, 6), false);

    const celdas7 = pagina(Array.from({ length: 7 }, (_, i) => `Item ${i}`), 2, 6);
    assert.equal(rejillaCompleta(celdas7, 2, 6), false);

    const celdas1x6 = pagina(["Item A", "Item B", "Item C"], 1, 6);
    assert.equal(rejillaCompleta(celdas1x6, 1, 6), true);

    const celdas1Item = pagina(["Item A"], 3, 6);
    assert.equal(rejillaCompleta(celdas1Item, 3, 6), true);

    const celdas8Items = pagina(Array.from({ length: 8 }, (_, i) => `Item ${i}`), 3, 6);
    assert.equal(rejillaCompleta(celdas8Items, 3, 6), true);
});

test("ausentesDeBusqueda resuelve consulta bronco con candidatos exactos", () => {
    const inv = {
        "Akbronco Prime Blueprint": 1,
        "Akbronco Prime Link": 2,
        "Bronco Prime Barrel": 1,
        "Bronco Prime Receiver": 3,
        "Braton Prime Stock": 1
    };
    const celdas = pagina(["Akbronco Prime Blueprint", "Bronco Prime Receiver"], 3, 6);
    const res = ausentesDeBusqueda({
        texto: "bronco",
        celdas,
        filas: 3,
        cols: 6,
        inventario: inv
    });
    assert.equal(res.consulta, "bronco");
    assert.equal(res.motivo, null);
    assert.deepEqual(res.vistos, ["Akbronco Prime Blueprint", "Bronco Prime Receiver"]);
    assert.deepEqual(res.candidatos, ["Akbronco Prime Link", "Bronco Prime Barrel"]);
});

test("ausentesDeBusqueda resuelve consulta nikana con candidatos", () => {
    const inv = {
        "Nikana Prime Blade": 1,
        "Nikana Prime Hilt": 1,
        "Nikana Prime Blueprint": 2,
        "Nami Skyla Prime Blade": 1
    };
    const celdas = pagina(["Nikana Prime Blade", "Nikana Prime Hilt"], 4, 6);
    const res = ausentesDeBusqueda({
        texto: "nikana",
        celdas,
        filas: 4,
        cols: 6,
        inventario: inv
    });
    assert.equal(res.consulta, "nikana");
    assert.equal(res.motivo, null);
    assert.deepEqual(res.vistos, ["Nikana Prime Blade", "Nikana Prime Hilt"]);
    assert.deepEqual(res.candidatos, ["Nikana Prime Blueprint"]);
});

test("ausentesDeBusqueda resuelve consulta glaive con dos filas visibles", () => {
    const itemsGlaive = [
        "Glaive Prime Blade",
        "Glaive Prime Disc",
        "Glaive Prime Blueprint",
        "Ceramic Glaive",
        "Halikar Glaive",
        "Kestrel Glaive",
        "Orvius Glaive",
        "Xoris Glaive"
    ];
    const inv = {
        ...itemsGlaive.reduce((acc, k) => ({ ...acc, [k]: 1 }), {}),
        "Glaive Prime Handle": 1
    };
    const celdas = pagina(itemsGlaive, 3, 6);
    assert.equal(rejillaCompleta(celdas, 3, 6), true);
    const res = ausentesDeBusqueda({
        texto: "glaive",
        celdas,
        filas: 3,
        cols: 6,
        inventario: inv
    });
    assert.equal(res.consulta, "glaive");
    assert.equal(res.motivo, null);
    assert.deepEqual(res.vistos, itemsGlaive);
    assert.deepEqual(res.candidatos, ["Glaive Prime Handle"]);
});

test("ausentesDeBusqueda maneja reliquias y mapeo textoDe", () => {
    const inv = {
        "AXI A1": 1,
        "AXI B2": 2,
        "AXI C3": 4,
        "LITH A1": 1
    };
    const celdas = pagina(["AXI A1", "AXI B2"], 2, 6);
    const resAxi = ausentesDeBusqueda({
        texto: "axi",
        celdas,
        filas: 2,
        cols: 6,
        inventario: inv,
        textoDe: (k) => `${k} relic`
    });
    assert.equal(resAxi.consulta, "axi");
    assert.equal(resAxi.motivo, null);
    assert.deepEqual(resAxi.vistos, ["AXI A1", "AXI B2"]);
    assert.deepEqual(resAxi.candidatos, ["AXI C3"]);

    const celdasSinRelic = pagina(["AXI A1 relic", "AXI B2"], 2, 6);
    const resSinRelic = ausentesDeBusqueda({
        texto: "relic",
        celdas: celdasSinRelic,
        filas: 2,
        cols: 6,
        inventario: inv
    });
    assert.equal(resSinRelic.consulta, null);
    assert.equal(resSinRelic.motivo, "sin_consulta");
    assert.deepEqual(resSinRelic.candidatos, []);
});

test("ausentesDeBusqueda rechaza rejilla completa de prime y blueprint", () => {
    const items18 = Array.from({ length: 18 }, (_, i) => `Item ${i} Prime Blueprint`);
    const celdasFull = pagina(items18, 3, 6);
    const inv = { "Extra Prime Blueprint": 1 };

    const resPrime = ausentesDeBusqueda({
        texto: "prime",
        celdas: celdasFull,
        filas: 3,
        cols: 6,
        inventario: inv
    });
    assert.equal(resPrime.motivo, "incompleta");
    assert.equal(resPrime.consulta, null);
    assert.deepEqual(resPrime.vistos, []);
    assert.deepEqual(resPrime.candidatos, []);

    const resBp = ausentesDeBusqueda({
        texto: "blueprint",
        celdas: celdasFull,
        filas: 3,
        cols: 6,
        inventario: inv
    });
    assert.equal(resBp.motivo, "incompleta");
    assert.equal(resBp.consulta, null);
    assert.deepEqual(resBp.vistos, []);
    assert.deepEqual(resBp.candidatos, []);
});

test("ausentesDeBusqueda comprueba rejillas truncadas y casos de una fila", () => {
    const celdas12 = pagina(Array.from({ length: 12 }, (_, i) => `Item ${i}`), 2, 6);
    const res12 = ausentesDeBusqueda({
        texto: "item",
        celdas: celdas12,
        filas: 2,
        cols: 6,
        inventario: { "Item 99": 1 }
    });
    assert.equal(res12.motivo, "incompleta");
    assert.deepEqual(res12.candidatos, []);

    const celdas7 = pagina(Array.from({ length: 7 }, (_, i) => `Item ${i}`), 2, 6);
    const res7 = ausentesDeBusqueda({
        texto: "item",
        celdas: celdas7,
        filas: 2,
        cols: 6,
        inventario: { "Item 99": 1 }
    });
    assert.equal(res7.motivo, "incompleta");
    assert.deepEqual(res7.candidatos, []);

    const celdas1x6 = pagina(["Item A", "Item B", "Item C"], 1, 6);
    const res1x6 = ausentesDeBusqueda({
        texto: "item",
        celdas: celdas1x6,
        filas: 1,
        cols: 6,
        inventario: { "Item D": 1 }
    });
    assert.equal(res1x6.motivo, null);
    assert.equal(res1x6.consulta, "item");
    assert.deepEqual(res1x6.candidatos, ["Item D"]);
});

test("ausentesDeBusqueda comprueba consultas cortas, placeholders y nombres no coincidentes", () => {
    const celdas = pagina(["Akbronco Prime Blueprint"], 3, 6);
    const inv = { "Bronco Prime Barrel": 1 };

    const resBr = ausentesDeBusqueda({ texto: "br", celdas, filas: 3, cols: 6, inventario: inv });
    assert.equal(resBr.motivo, "sin_consulta");
    assert.equal(resBr.consulta, null);

    const resA = ausentesDeBusqueda({ texto: "a", celdas, filas: 3, cols: 6, inventario: inv });
    assert.equal(resA.motivo, "sin_consulta");
    assert.equal(resA.consulta, null);

    const resDots = ausentesDeBusqueda({ texto: "SEARCH...", celdas, filas: 3, cols: 6, inventario: inv });
    assert.equal(resDots.motivo, "sin_consulta");
    assert.equal(resDots.consulta, null);
    assert.deepEqual(resDots.candidatos, []);

    const resSearch = ausentesDeBusqueda({ texto: "Search", celdas, filas: 3, cols: 6, inventario: inv });
    assert.equal(resSearch.motivo, "sin_consulta");
    assert.equal(resSearch.consulta, null);
    assert.deepEqual(resSearch.candidatos, []);

    const celdasMismatch = pagina(["Akbronco Prime Blueprint", "Braton Prime Stock"], 3, 6);
    const resMismatch = ausentesDeBusqueda({ texto: "bronco", celdas: celdasMismatch, filas: 3, cols: 6, inventario: inv });
    assert.equal(resMismatch.consulta, null);
    assert.equal(resMismatch.motivo, "sin_consulta");
    assert.deepEqual(resMismatch.vistos, ["Akbronco Prime Blueprint", "Braton Prime Stock"]);
    assert.deepEqual(resMismatch.candidatos, []);
});

test("ausentesDeBusqueda respeta excluye, cantidades invalidas y elementos ya visibles", () => {
    const celdas = pagina(["Item Alpha"], 2, 2);
    const inv = {
        "Item Alpha": 2,
        "Item Beta": 1,
        "Item Gamma": 1,
        "Item Zero": 0,
        "Item ZeroStr": "0",
        "Item Null": null,
        "Item Neg": -1
    };
    const res = ausentesDeBusqueda({
        texto: "item",
        celdas,
        filas: 2,
        cols: 2,
        inventario: inv,
        excluye: (k) => k === "Item Beta"
    });
    assert.deepEqual(res.candidatos, ["Item Gamma"]);
});

test("pasoBusqueda gestiona flujo de votacion, reseteos, visibilidad y caducidad", () => {
    const T0 = Date.UTC(2026, 9, 1);
    const DIA = 24 * 60 * 60 * 1000;
    const inv = {
        "Bronco Prime Barrel": 1,
        "Bronco Prime Receiver": 1
    };
    const res = {
        consulta: "bronco",
        motivo: null,
        vistos: ["Akbronco Prime Blueprint"],
        candidatos: ["Bronco Prime Barrel", "Bronco Prime Receiver"]
    };

    const paso1 = pasoBusqueda(ESTADO_BUSQUEDA, res, "piezas|bronco", "scan-1", inv, T0);
    assert.deepEqual(paso1.aCero, []);
    assert.deepEqual(paso1.pendientes.sort(), ["Bronco Prime Barrel", "Bronco Prime Receiver"]);

    const paso2 = pasoBusqueda(paso1.estado, res, "piezas|bronco", "scan-2", inv, T0 + 1000);
    assert.deepEqual(paso2.aCero.sort(), ["Bronco Prime Barrel", "Bronco Prime Receiver"]);
    assert.deepEqual(paso2.pendientes, []);

    const pasoDup = pasoBusqueda(paso1.estado, res, "piezas|bronco", "scan-1", inv, T0 + 1000);
    assert.deepEqual(pasoDup.aCero, []);
    assert.deepEqual(pasoDup.pendientes.sort(), ["Bronco Prime Barrel", "Bronco Prime Receiver"]);

    const pasoResetClave = pasoBusqueda(
        paso1.estado,
        { ...res, consulta: "nikana", candidatos: ["Nikana Prime Blade"] },
        "piezas|nikana",
        "scan-2",
        { ...inv, "Nikana Prime Blade": 1 },
        T0 + 1000
    );
    assert.deepEqual(pasoResetClave.aCero, []);
    assert.deepEqual(pasoResetClave.pendientes, ["Nikana Prime Blade"]);

    const pasoCatReset = pasoBusqueda(
        paso1.estado,
        res,
        "reliquias|bronco",
        "scan-2",
        inv,
        T0 + 1000
    );
    assert.deepEqual(pasoCatReset.aCero, []);

    const rNull = pasoBusqueda(paso1.estado, null, "piezas|bronco", "scan-2", inv, T0 + 1000);
    assert.equal(rNull.estado, ESTADO_BUSQUEDA);
    assert.deepEqual(rNull.aCero, []);
    assert.deepEqual(rNull.pendientes, []);

    const rIncompleta = pasoBusqueda(
        paso1.estado,
        { motivo: "incompleta", consulta: null, vistos: [], candidatos: [] },
        "piezas|bronco",
        "scan-2",
        inv,
        T0 + 1000
    );
    assert.equal(rIncompleta.estado, ESTADO_BUSQUEDA);
    assert.deepEqual(rIncompleta.aCero, []);
    assert.deepEqual(rIncompleta.pendientes, []);

    const rSinConsulta = pasoBusqueda(
        paso1.estado,
        { motivo: "sin_consulta", consulta: null, vistos: [], candidatos: [] },
        "piezas|bronco",
        "scan-2",
        inv,
        T0 + 1000
    );
    assert.equal(rSinConsulta.estado, ESTADO_BUSQUEDA);
    assert.deepEqual(rSinConsulta.aCero, []);
    assert.deepEqual(rSinConsulta.pendientes, []);

    const rEmptyClave = pasoBusqueda(paso1.estado, res, "", "scan-2", inv, T0 + 1000);
    assert.equal(rEmptyClave.estado, ESTADO_BUSQUEDA);
    assert.deepEqual(rEmptyClave.aCero, []);
    assert.deepEqual(rEmptyClave.pendientes, []);

    const resItemVisto = {
        consulta: "bronco",
        motivo: null,
        vistos: ["Akbronco Prime Blueprint", "Bronco Prime Barrel"],
        candidatos: ["Bronco Prime Receiver"]
    };
    const pasoVisto = pasoBusqueda(paso1.estado, resItemVisto, "piezas|bronco", "scan-2", inv, T0 + 1000);
    assert.deepEqual(pasoVisto.aCero, ["Bronco Prime Receiver"]);

    const invMod = {
        "Bronco Prime Barrel": 1,
        "Bronco Prime Receiver": 2
    };
    const pasoInvMod = pasoBusqueda(paso1.estado, res, "piezas|bronco", "scan-2", invMod, T0 + 1000);
    assert.deepEqual(pasoInvMod.aCero, ["Bronco Prime Barrel"]);
    assert.deepEqual(pasoInvMod.pendientes, ["Bronco Prime Receiver"]);

    const pasoCaducado = pasoBusqueda(paso1.estado, res, "piezas|bronco", "scan-2", inv, T0 + 15 * DIA);
    assert.deepEqual(pasoCaducado.aCero, []);
    assert.deepEqual(pasoCaducado.pendientes.sort(), ["Bronco Prime Barrel", "Bronco Prime Receiver"]);
});

test("categoriaDeBusqueda clasifica texto de categoria o devuelve null", () => {
    assert.equal(categoriaDeBusqueda("PRIME PARTS"), "piezas");
    assert.equal(categoriaDeBusqueda("PRIMEPARTS"), "piezas");
    assert.equal(categoriaDeBusqueda("partes prime"), "piezas");
    assert.equal(categoriaDeBusqueda("parte prime"), "piezas");
    assert.equal(categoriaDeBusqueda("RELICS"), "reliquias");
    assert.equal(categoriaDeBusqueda("VOID RELICS"), "reliquias");
    assert.equal(categoriaDeBusqueda("RELIQUIAS"), "reliquias");
    assert.equal(categoriaDeBusqueda("ARCANES"), null);
    assert.equal(categoriaDeBusqueda(""), null);
    assert.equal(categoriaDeBusqueda(null), null);
    assert.equal(categoriaDeBusqueda("MODS"), null);
});

test("analizaFranjaBusqueda procesa pixeles, detecta lineas y bordes", () => {
    const pixNoInk = new Uint8ClampedArray(20 * 6 * 4);
    for (let i = 0; i < 20 * 6; i++) {
        pixNoInk[i * 4] = 50;
        pixNoInk[i * 4 + 1] = 50;
        pixNoInk[i * 4 + 2] = 50;
        pixNoInk[i * 4 + 3] = 128;
    }
    const resNoInk = analizaFranjaBusqueda(pixNoInk, 20, 6);
    assert.equal(resNoInk.tinta, 0);
    assert.equal(resNoInk.alBorde, false);
    assert.equal(pixNoInk[3], 128);

    const pixLine = new Uint8ClampedArray(20 * 6 * 4);
    for (let i = 0; i < 20 * 6; i++) {
        pixLine[i * 4 + 3] = 128;
    }
    for (let x = 0; x < 20; x++) {
        const idx = (2 * 20 + x) * 4;
        pixLine[idx] = 255;
        pixLine[idx + 1] = 255;
        pixLine[idx + 2] = 255;
    }
    const resLine = analizaFranjaBusqueda(pixLine, 20, 6);
    assert.equal(resLine.tinta, 0);
    assert.equal(resLine.alBorde, false);
    const idxLineCheck = (2 * 20 + 5) * 4;
    assert.equal(pixLine[idxLineCheck], 255);
    assert.equal(pixLine[idxLineCheck + 1], 255);
    assert.equal(pixLine[idxLineCheck + 2], 255);
    assert.equal(pixLine[idxLineCheck + 3], 128);

    const pixBlob = new Uint8ClampedArray(20 * 6 * 4);
    for (let i = 0; i < 20 * 6; i++) {
        pixBlob[i * 4 + 3] = 128;
    }
    const idxBlob1 = (2 * 20 + 8) * 4;
    const idxBlob2 = (2 * 20 + 9) * 4;
    pixBlob[idxBlob1] = 255;
    pixBlob[idxBlob1 + 1] = 255;
    pixBlob[idxBlob1 + 2] = 255;
    pixBlob[idxBlob2] = 255;
    pixBlob[idxBlob2 + 1] = 255;
    pixBlob[idxBlob2 + 2] = 255;
    const resBlob = analizaFranjaBusqueda(pixBlob, 20, 6);
    assert.equal(resBlob.tinta, 2);
    assert.equal(resBlob.alBorde, false);
    assert.equal(pixBlob[idxBlob1], 0);
    assert.equal(pixBlob[idxBlob1 + 1], 0);
    assert.equal(pixBlob[idxBlob1 + 2], 0);
    assert.equal(pixBlob[idxBlob1 + 3], 128);
    const idxOther = 0;
    assert.equal(pixBlob[idxOther], 255);
    assert.equal(pixBlob[idxOther + 1], 255);
    assert.equal(pixBlob[idxOther + 2], 255);
    assert.equal(pixBlob[idxOther + 3], 128);

    const pixBorder = new Uint8ClampedArray(20 * 6 * 4);
    for (let i = 0; i < 20 * 6; i++) {
        pixBorder[i * 4 + 3] = 128;
    }
    const idxBorder = (2 * 20 + 19) * 4;
    pixBorder[idxBorder] = 255;
    pixBorder[idxBorder + 1] = 255;
    pixBorder[idxBorder + 2] = 255;
    const resBorder = analizaFranjaBusqueda(pixBorder, 20, 6);
    assert.equal(resBorder.tinta, 1);
    assert.equal(resBorder.alBorde, true);
    assert.equal(pixBorder[idxBorder], 0);
    assert.equal(pixBorder[idxBorder + 3], 128);
});

test("celdaEnBlanco calcula desviacion tipica sobre luma y aplica tope", () => {
    const uniform = new Uint8ClampedArray(10 * 10 * 4);
    for (let i = 0; i < 100; i++) {
        uniform[i * 4] = 100;
        uniform[i * 4 + 1] = 100;
        uniform[i * 4 + 2] = 100;
        uniform[i * 4 + 3] = 255;
    }
    assert.equal(celdaEnBlanco(uniform), true);

    const noise = new Uint8ClampedArray(10 * 10 * 4);
    for (let i = 0; i < 100; i++) {
        const val = 100 + ((i % 3) - 1) * 3;
        noise[i * 4] = val;
        noise[i * 4 + 1] = val;
        noise[i * 4 + 2] = val;
        noise[i * 4 + 3] = 255;
    }
    assert.equal(celdaEnBlanco(noise), true);

    const half = new Uint8ClampedArray(10 * 10 * 4);
    for (let i = 0; i < 50; i++) {
        half[i * 4] = 0;
        half[i * 4 + 1] = 0;
        half[i * 4 + 2] = 0;
        half[i * 4 + 3] = 255;
    }
    for (let i = 50; i < 100; i++) {
        half[i * 4] = 255;
        half[i * 4 + 1] = 255;
        half[i * 4 + 2] = 255;
        half[i * 4 + 3] = 255;
    }
    assert.equal(celdaEnBlanco(half), false);

    assert.equal(celdaEnBlanco(new Uint8ClampedArray(0)), false);
    assert.equal(celdaEnBlanco([]), false);

    const customPix = new Uint8ClampedArray(100 * 4);
    for (let i = 0; i < 50; i++) {
        customPix[i * 4] = 90;
        customPix[i * 4 + 1] = 90;
        customPix[i * 4 + 2] = 90;
        customPix[i * 4 + 3] = 255;
    }
    for (let i = 50; i < 100; i++) {
        customPix[i * 4] = 110;
        customPix[i * 4 + 1] = 110;
        customPix[i * 4 + 2] = 110;
        customPix[i * 4 + 3] = 255;
    }
    assert.equal(celdaEnBlanco(customPix, 8), false);
    assert.equal(celdaEnBlanco(customPix, 15), true);
});

test("resuelveConsulta completa palabras comunes presentes en todos los visibles", () => {
    const VOLT = ["Volt Prime Blueprint", "Volt Prime Chassis Blueprint", "Volt Prime Neuroptics Blueprint", "Volt Prime Systems Blueprint"];
    assert.equal(resuelveConsulta("vol", VOLT), "volt");
    assert.equal(resuelveConsulta("voli", VOLT), "volt");
    assert.equal(resuelveConsulta("voll", VOLT), "volt");
    assert.equal(resuelveConsulta("olt", VOLT), "volt");
    assert.equal(resuelveConsulta("volt", VOLT), "volt");
    assert.equal(resuelveConsulta("lok", ["Loki Prime Blueprint", "Loki Prime Chassis Blueprint"]), "loki");
    assert.equal(resuelveConsulta("oma", ["Soma Prime Barrel", "Soma Prime Receiver"]), "soma");
});

test("con cuatro Volt a la vista la consulta vol u olt no vota Volnus ni Akbolto", () => {
    const VOLT = ["Volt Prime Blueprint", "Volt Prime Chassis Blueprint", "Volt Prime Neuroptics Blueprint", "Volt Prime Systems Blueprint"];
    const inv = { "Volt Prime Blueprint": 1, "Volt Prime Chassis Blueprint": 1, "Volt Prime Neuroptics Blueprint": 1, "Volt Prime Systems Blueprint": 1, "Volnus Prime Handle": 1, "Volnus Prime Head": 1, "Akbolto Prime Link": 1 };
    const celdas = pagina(VOLT, 2, 6);
    const resVol = ausentesDeBusqueda({ texto: "vol", celdas, filas: 2, cols: 6, inventario: inv });
    assert.equal(resVol.consulta, "volt");
    assert.deepEqual(resVol.candidatos, []);
    const resOlt = ausentesDeBusqueda({ texto: "olt", celdas, filas: 2, cols: 6, inventario: inv });
    assert.equal(resOlt.consulta, "volt");
    assert.deepEqual(resOlt.candidatos, []);
});

test("ausentesDeBusqueda detecta nombres duplicados en piezas", () => {
    const repetidos = [
        "Volt Prime Blueprint",
        "Volt Prime Blueprint",
        "Volt Prime Neuroptics Blueprint",
        "Volt Prime Systems Blueprint"
    ];
    const celdas = pagina(repetidos, 2, 6);
    const inv = {
        "Volt Prime Chassis Blueprint": 1
    };
    const res = ausentesDeBusqueda({
        texto: "volt",
        celdas,
        filas: 2,
        cols: 6,
        inventario: inv
    });
    assert.equal(res.motivo, "repetida");
    assert.equal(res.consulta, null);
    assert.deepEqual(res.candidatos, []);
});

test("ausentesDeBusqueda con repite permite duplicados y filtra por editDistance", () => {
    const celdas = pagina(["LITH A6", "LITH B1"], 2, 6);
    const inv = {
        "LITH A5": 1,
        "LITH A6": 1,
        "LITH B1": 1,
        "LITH C9": 2
    };
    const res = ausentesDeBusqueda({
        texto: "lith",
        celdas,
        filas: 2,
        cols: 6,
        inventario: inv,
        textoDe: (k) => `${k} relic`,
        repite: true
    });
    assert.equal(res.motivo, null);
    assert.deepEqual(res.candidatos, ["LITH C9"]);

    const celdasDup = pagina(["LITH A6", "LITH A6"], 2, 6);
    const resDup = ausentesDeBusqueda({
        texto: "lith",
        celdas: celdasDup,
        filas: 2,
        cols: 6,
        inventario: inv,
        textoDe: (k) => `${k} relic`,
        repite: true
    });
    assert.equal(resDup.motivo, null);
});

test("resuelveConsulta alarga prefijos y sufijos comunes segun los nombres visibles", () => {
    assert.equal(resuelveConsulta("bronco", ["Akbronco Prime Blueprint"]), "bronco");
    assert.equal(resuelveConsulta("col", ["Kavasa Prime Collar"]), "coll");
    assert.equal(resuelveConsulta("olt", ["Volt Prime Blueprint"]), "olt");
    assert.equal(resuelveConsulta("olt", [
        "Volt Prime Blueprint",
        "Volt Prime Chassis Blueprint",
        "Volt Prime Neuroptics Blueprint",
        "Volt Prime Systems Blueprint"
    ]), "volt");
});

test("ausentesDeBusqueda discrimina candidatos por la cadena resuelta", () => {
    const celdas = pagina(["Akbronco Prime Blueprint"], 3, 6);
    const inv = {
        "Bronco Prime Barrel": 8,
        "Akbronco Prime Blueprint": 1
    };
    const res = ausentesDeBusqueda({
        texto: "bronco",
        celdas,
        filas: 3,
        cols: 6,
        inventario: inv
    });
    assert.equal(res.motivo, null);
    assert.equal(res.consulta, "bronco");
    assert.deepEqual(res.candidatos, ["Bronco Prime Barrel"]);
    assert.deepEqual(res.vistos, ["Akbronco Prime Blueprint"]);
});

test("con un solo visible la consulta exige inicio de palabra para evitar truncados falsos", () => {
    const celdas = pagina(["Volt Prime Blueprint"], 3, 6);
    const inv = { "Akbolto Prime Barrel": 1, "Boltor Prime Barrel": 1, "Volt Prime Blueprint": 1 };
    const resOlt = ausentesDeBusqueda({ texto: "olt", celdas, filas: 3, cols: 6, inventario: inv });
    assert.deepEqual(resOlt.candidatos, []);
    const celdasBronco = pagina(["Akbronco Prime Blueprint"], 3, 6);
    const invBronco = { "Bronco Prime Barrel": 1, "Akbronco Prime Blueprint": 1 };
    const resBronco = ausentesDeBusqueda({ texto: "bronco", celdas: celdasBronco, filas: 3, cols: 6, inventario: invBronco });
    assert.deepEqual(resBronco.candidatos, ["Bronco Prime Barrel"]);
});

test("tope de ceros devuelve demasiados y anula candidatos cuando se supera", () => {
    const celdas = pagina(["Akbronco Prime Blueprint"], 3, 6);
    const invTope = { "Akbronco Prime Blueprint": 1, ...Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`Bronco Prime Parte ${i}`, 1])) };
    const resTope = ausentesDeBusqueda({ texto: "bronco", celdas, filas: 3, cols: 6, inventario: invTope });
    assert.equal(resTope.motivo, null);
    assert.equal(resTope.candidatos.length, 8);
    const invExceso = { "Akbronco Prime Blueprint": 1, ...Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`Bronco Prime Parte ${i}`, 1])) };
    const resExceso = ausentesDeBusqueda({ texto: "bronco", celdas, filas: 3, cols: 6, inventario: invExceso });
    assert.equal(resExceso.motivo, "demasiados");
    assert.equal(resExceso.consulta, null);
    assert.deepEqual(resExceso.candidatos, []);
    assert.deepEqual(resExceso.vistos, ["Akbronco Prime Blueprint"]);
});

test("fila parcial con primera fila llena devuelve fila llena y descarta candidatos", () => {
    const items = ["Bronco Prime A", "Bronco Prime B", "Bronco Prime C", "Bronco Prime D"];
    const celdasLlena = pagina(items, 2, 4);
    const inv = { "Bronco Prime A": 1, "Bronco Prime B": 1, "Bronco Prime C": 1, "Bronco Prime Barrel": 1 };
    const resLlena = ausentesDeBusqueda({ texto: "bronco", celdas: celdasLlena, filas: 2, cols: 4, inventario: inv, filaParcial: true });
    assert.equal(resLlena.motivo, "fila_llena");
    assert.deepEqual(resLlena.candidatos, []);
    const celdasHueco = pagina(["Bronco Prime A", "Bronco Prime B", "Bronco Prime C"], 2, 4);
    const resHueco = ausentesDeBusqueda({ texto: "bronco", celdas: celdasHueco, filas: 2, cols: 4, inventario: inv, filaParcial: true });
    assert.equal(resHueco.motivo, null);
    assert.deepEqual(resHueco.candidatos, ["Bronco Prime Barrel"]);
    const resSinParcial = ausentesDeBusqueda({ texto: "bronco", celdas: celdasLlena, filas: 2, cols: 4, inventario: inv, filaParcial: false });
    assert.notEqual(resSinParcial.motivo, "fila_llena");
    const celdasRelic = pagina(["LITH A1"], 2, 4);
    const invRelic = { "LITH A1": 1, "LITH C9": 1 };
    const resRelic = ausentesDeBusqueda({ texto: "ith", celdas: celdasRelic, filas: 2, cols: 4, inventario: invRelic, textoDe: (k) => `${k} relic`, repite: true });
    assert.deepEqual(resRelic.candidatos, []);
});
