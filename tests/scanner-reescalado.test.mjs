import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodePng } from "./_helpers/png.mjs";
import { installFakeDocument, FakeCanvas } from "./_helpers/fake-canvas.mjs";

installFakeDocument();
const { detectInventoryGrid } = await import("../deploy/js/utils/vision/grid_detect.js");
const { rampCoreColor } = await import("../deploy/js/utils/vision/name_color.js");
const { VisionService } = await import("../deploy/js/services/scanner/vision.service.js");
const { leeCantidadBadge } = await import("../deploy/js/services/scanner/badge_read.service.js");

const FIXTURE = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "_fixtures/inventory_ballistica_banshee_2531x1412.png",
);
const NATIVA = decodePng(fs.readFileSync(FIXTURE));
const FILAS = 3;
const CELDAS = 18;

function reescala(w, h) {
    if (w === NATIVA.width && h === NATIVA.height) return NATIVA;
    const cvs = new FakeCanvas(w, h);
    const ctx = cvs.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(NATIVA, 0, 0, NATIVA.width, NATIVA.height, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h);
}

const RESOLUCIONES = [[2531, 1412], [2560, 1440], [1920, 1080], [1600, 900], [1280, 720], [960, 540]];

test("la 4ª fila cortada no se cuenta como fila de nombres a ninguna resolución", () => {
    for (const [w, h] of RESOLUCIONES) {
        const res = detectInventoryGrid(reescala(w, h));
        assert.ok(res, `${w}x${h}: sin detección`);
        assert.equal(res.rows, FILAS, `${w}x${h}: ${res.rows} filas; la 4ª solo enseña badges y arte`);
        assert.equal(res.cols, 6, `${w}x${h}: ${res.cols} columnas`);
    }
});

test("la rejilla detectada cae en el mismo sitio aunque cambie la resolución", () => {
    let ref = null;
    for (const [w, h] of RESOLUCIONES) {
        const res = detectInventoryGrid(reescala(w, h));
        const k = w / NATIVA.width;
        const norm = { x: res.gridZone.x / k, y: res.gridZone.y / k, cw: res.cellW / k, ch: res.cellH / k };
        if (!ref) { ref = norm; continue; }
        const tol = 0.02 * ref.ch;
        for (const campo of ["x", "y", "cw", "ch"]) {
            assert.ok(
                Math.abs(norm[campo] - ref[campo]) <= tol,
                `${w}x${h}: ${campo} normalizado ${norm[campo].toFixed(1)} vs ${ref[campo].toFixed(1)} (tol ${tol.toFixed(1)})`,
            );
        }
    }
});

test("la banda de nombre binarizada no se llena del arte de la card al reescalar", () => {
    const TOPE = 0.10;
    for (const [w, h] of RESOLUCIONES) {
        const img = reescala(w, h);
        const calib = detectInventoryGrid(img);
        const z = calib.gridZone;
        const tema = VisionService.detectThemeFromSnapshot(img, z.x, z.y, z.w, z.h);
        const grid = VisionService.buildAutoGrid(img, z, tema, calib);
        const { cellW, cellH, cols } = grid;
        const bandaY = Math.round(cellH * 0.50), bandaH = Math.round(cellH * 0.48);
        for (const celda of grid.cellRects) {
            if (celda.r * cols + celda.c >= CELDAS) continue;
            const cvs = VisionService.cropThemeBinarized(img, celda.sx, celda.sy + bandaY, cellW, bandaH, tema, null);
            const px = cvs.getContext("2d").getImageData(0, 0, cvs.width, cvs.height).data;
            let tinta = 0;
            for (let i = 0; i < px.length; i += 4) if (px[i] === 0) tinta++;
            const frac = tinta / (cvs.width * cvs.height);
            assert.ok(
                frac < TOPE,
                `${w}x${h} r${celda.r}c${celda.c}: ${(frac * 100).toFixed(1)}% de tinta — el recorte es arte, no un nombre`,
            );
        }
    }
});

test("el color de texto sale de la rampa de antialias, no del tono más frecuente", () => {
    const fondo = [16, 24, 32];
    const bins = [
        { col: [56, 56, 64], count: 1619 },
        { col: [56, 64, 64], count: 1232 },
        { col: [48, 56, 56], count: 1059 },
        { col: [232, 120, 0], count: 1118 },
        { col: [248, 128, 0], count: 974 },
        { col: [216, 112, 0], count: 755 },
        { col: [192, 104, 8], count: 620 },
        { col: [176, 96, 8], count: 540 },
    ];
    const moda = bins.reduce((a, b) => (b.count > a.count ? b : a)).col;
    assert.deepEqual(moda, [56, 56, 64], "la moda de este histograma es el gris de la card");

    const elegido = rampCoreColor(bins, fondo);
    const dist = Math.hypot(elegido[0] - 248, elegido[1] - 128, elegido[2] - 0);
    assert.ok(dist <= 66, `elegido rgb(${elegido}) fuera de la bola del color del nombre (d=${dist.toFixed(0)})`);
});

const CANTIDADES = [
    5, null, 3, 2, null, 4,
    4, 6, 11, 2, 2, 3,
    2, 3, 3, 5, 2, 9,
];

async function leeBadges(w, h) {
    const img = reescala(w, h);
    const calib = VisionService.detectGridAutoCalib(img, w, h);
    const zona = calib.gridZone;
    const tema = VisionService.detectThemeFromSnapshot(img, zona.x, zona.y, zona.w, zona.h);
    const auto = VisionService.buildAutoGrid(img, zona, tema, calib);
    const leidos = [];
    for (const cell of auto.cellRects) {
        const i = cell.r * auto.cols + cell.c;
        if (i >= CELDAS || CANTIDADES[i] === null) continue;
        const q = await leeCantidadBadge(img, cell, auto.cellW, auto.cellH, tema);
        leidos.push({ celda: `r${cell.r}c${cell.c}`, leido: q.raw || null, real: String(CANTIDADES[i]) });
    }
    return leidos;
}

// full accuracy except at 1280x720: the one gap in 96 badges is a "6" scoring 5@0.760 vs 6@0.695
for (const [w, h] of [[2531, 1412], [2560, 1440], [1920, 1080], [1600, 900], [960, 540]]) {
    test(`los badges se leen todos a ${w}x${h}`, async () => {
        const fallos = (await leeBadges(w, h)).filter((r) => r.leido !== r.real);
        assert.deepEqual(fallos, []);
    });
}

test("a 1280x720 se leen al menos 15 de los 16 badges", async () => {
    const leidos = await leeBadges(1280, 720);
    const ok = leidos.filter((r) => r.leido === r.real).length;
    assert.ok(ok >= 15, `${ok}/16 — ${leidos.filter((r) => r.leido !== r.real).map((r) => `${r.celda}:"${r.leido}"≠${r.real}`).join(" ")}`);
});

test("un dígito bien reconocido no se descarta por medir menos píxeles", async () => {
    const leidos = await leeBadges(1280, 720);
    for (const celda of ["r1c3", "r2c0", "r2c4"]) {
        assert.equal(leidos.find((r) => r.celda === celda)?.leido, "2", `celda ${celda}`);
    }
});


test("pestaña de arcanos a 1080p: los 24 badges, sin el pilar del arte pegado al número", async () => {
    const img = decodePng(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "_fixtures/inventory_arcanes_1920x1080.png")));
    const calib = VisionService.detectGridAutoCalib(img, img.width, img.height);
    const snap = new FakeCanvas(img.width, img.height);
    snap.getContext("2d").putImageData(img, 0, 0);
    const ancla = VisionService.anclaPorChecks(snap, calib.gridZone, calib);
    assert.ok(ancla, "sin fase por ✓");
    const tema = { name: "Grineer", r: 255, g: 224, b: 153, actualR: 178, actualG: 158, actualB: 102 };
    const auto = VisionService.buildAutoGrid(img, calib.gridZone, tema, { ...calib, gridX: ancla.gridX, gridY: ancla.gridY });
    const leidos = [];
    for (const cell of auto.cellRects) leidos.push((await leeCantidadBadge(img, cell, auto.cellW, auto.cellH, tema)).raw);
    assert.deepEqual(leidos, [
        "278", "180", "159", "143", "143", "138",
        "133", "105", "105", "98", "88", "85",
        "84", "76", "75", "70", "68", "66",
        "65", "61", "60", "60", "59", "59",
    ]);
});
