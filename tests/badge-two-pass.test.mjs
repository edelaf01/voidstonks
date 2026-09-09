// Lectura del badge de cantidad TAL COMO LA HACE EL ESCÁNER (services/scanner/badge_read.service.js),
// sobre la captura real del inventario y bajo VARIOS TEMAS.
//
// Los otros cinco ficheros de badges (badge-extract, badge-band-filter, badge-multidigit,
// badge-digit-ocr*) llaman a extractBadgeByColor directamente y siempre con el tema Default:
// ninguno pasaba por las DOS pasadas ni por un tema distinto, que es justo donde estaba el fallo
// —la pasada por brillo iba primera, acertaba 0/16 y sus dos respuestas no vacías eran erróneas,
// así que ganaban a la pasada buena.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodePng } from "./_helpers/png.mjs";
import { installFakeDocument } from "./_helpers/fake-canvas.mjs";

installFakeDocument(); // antes del import dinámico: vision.service.js crea canvases al cargar
const { leeCantidadBadge } = await import("../deploy/js/services/scanner/badge_read.service.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SNAP = decodePng(fs.readFileSync(
    path.join(__dirname, "_fixtures", "inventory_ballistica_banshee_2531x1412.png")));

// Auto-grid detectada en esta captura (misma que usa badge-extract.test.mjs).
const GRID = { gx: 87, gy: 281, cellW: 277, cellH: 296, dy: -44 };
const cellAt = (r, c) => ({ r, c, sx: GRID.gx + c * GRID.cellW, sy: GRID.gy + r * GRID.cellH + GRID.dy });

// Contado a mano sobre la captura. `null` = celda sin badge (el ítem no está repetido).
const VERDAD = [
    5, null, 3, 2, null, 4,
    4, 6, 11, 2, 2, 3,
    2, 3, 3, 5, 2, 9,
];

const DEFAULT = { name: "Default", r: 227, g: 128, b: 20, actualR: 246, actualG: 129, actualB: 3 };

/**
 * Repinta el frame con otro color de tema. El juego dibuja la MISMA máscara de píxeles en el
 * color elegido, así que se conserva la intensidad relativa de cada píxel (antialias incluido)
 * y se remapea al color destino. Sirve para probar la invariancia al tema sin necesitar una
 * captura por tema.
 */
function repinta(snap, [dr, dg, db], origen = [246, 129, 3]) {
    const lumaOrigen = 0.299 * origen[0] + 0.587 * origen[1] + 0.114 * origen[2];
    const s = snap.data, d = new Uint8ClampedArray(s.length);
    for (let i = 0; i < s.length; i += 4) {
        const t = (0.299 * s[i] + 0.587 * s[i + 1] + 0.114 * s[i + 2]) / lumaOrigen;
        d[i] = Math.min(255, t * dr);
        d[i + 1] = Math.min(255, t * dg);
        d[i + 2] = Math.min(255, t * db);
        d[i + 3] = 255;
    }
    return { width: snap.width, height: snap.height, data: d };
}

async function leePagina(snap, theme) {
    const out = [];
    for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 6; c++) out.push((await leeCantidadBadge(snap, cellAt(r, c), GRID.cellW, GRID.cellH, theme)).raw || null);
    }
    return out;
}

const conBadge = VERDAD.map((v, i) => [v, i]).filter(([v]) => v !== null);
const fallos = (leidos) => conBadge
    .filter(([v, i]) => leidos[i] !== String(v))
    .map(([v, i]) => `r${Math.floor(i / 6)}c${i % 6}: leído "${leidos[i]}", real ${v}`);

test("los 16 badges de la página se leen bien con el tema correcto", async () => {
    const leidos = await leePagina(SNAP, DEFAULT);
    assert.deepEqual(fallos(leidos), []);
});

test("una celda sin badge no inventa cantidad", async () => {
    const leidos = await leePagina(SNAP, DEFAULT);
    // Astilla Prime Stock (r0c1) y Athodai Prime Blueprint (r0c4) no están repetidos.
    assert.equal(leidos[1], null);
    assert.equal(leidos[4], null);
    const q = await leeCantidadBadge(SNAP, cellAt(0, 1), GRID.cellW, GRID.cellH, DEFAULT);
    assert.equal(q.qty, 1, "sin dígito, la cantidad es 1");
});

test("la pasada por brillo no pisa a la de color (regresión del orden)", async () => {
    // Los dos únicos badges que la pasada por brillo llegaba a 'leer', ambos mal: iba primera,
    // devolvía dígito y la de color —que acierta— ya no llegaba a correr.
    const leidos = await leePagina(SNAP, DEFAULT);
    assert.equal(leidos[0], "5", 'r0c0 Astilla Prime Receiver: el brillo lo leía "8"');
    assert.equal(leidos[10], "2", 'r1c4 Ballistica Prime Receiver: el brillo lo leía "8"');
});

// El tema del juego cambia el COLOR del badge, y con él su luminancia: el rojo oscuro
// rgb(128,40,40) tiene luma 66 frente a los 183 del naranja por defecto. Una pasada que umbralice
// por brillo ABSOLUTO se queda a cero en los temas oscuros.
for (const [nombre, color] of [
    ["rojo claro rgb(224,64,64)", [224, 64, 64]],
    ["rojo oscuro rgb(128,40,40)", [128, 40, 40]],
    ["verde rgb(40,200,90)", [40, 200, 90]],
    ["blanco rgb(230,230,230)", [230, 230, 230]],
]) {
    test(`los badges se leen igual con el tema ${nombre}`, async () => {
        const theme = { name: nombre, r: color[0], g: color[1], b: color[2], actualR: color[0], actualG: color[1], actualB: color[2] };
        assert.deepEqual(fallos(await leePagina(repinta(SNAP, color), theme)), []);
    });
}

test("con el tema MAL detectado la lectura aguanta", async () => {
    // La captura es del tema naranja y se le pasa el rojo a propósito: era el escenario que
    // justificaba poner el brillo primero. La pasada por color no se cae, así que no lo justifica.
    const rojo = { name: "Rojo", r: 128, g: 40, b: 40, actualR: 128, actualG: 40, actualB: 40 };
    const leidos = await leePagina(SNAP, rojo);
    assert.deepEqual(fallos(leidos), []);
});
