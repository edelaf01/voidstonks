// detectThemeFromSnapshot against all 18 votable themes on a repainted real capture
// the theme feeds every subsequent colour mask (names, badges): failing here silently breaks the entire
// scanner downstream
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodePng } from "./_helpers/png.mjs";
import { installFakeDocument } from "./_helpers/fake-canvas.mjs";

installFakeDocument();
const { VisionService } = await import("../deploy/js/services/scanner/vision.service.js");
const { WF_THEMES_VOTABLES } = await import("../deploy/js/utils/vision/wf_themes.js");
const { eligeTema } = await import("../deploy/js/utils/vision/theme_vote.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SNAP = decodePng(fs.readFileSync(
    path.join(__dirname, "_fixtures", "inventory_ballistica_banshee_2531x1412.png")));
// grid zone: what scanner.service.js actually passes
const ZONA = { x: 87, y: 281, w: 277 * 6, h: 296 * 3 };

/** repaints the frame with another theme colour while preserving relative intensity and antialiasing */
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

const detecta = (snap) => VisionService.detectThemeFromSnapshot(snap, ZONA.x, ZONA.y, ZONA.w, ZONA.h);

// the detector intentionally carries state across frames: each test resets to clean state
beforeEach(() => {
    VisionService._temaRacha = null;
    globalThis.state = globalThis.state || {};
    globalThis.state.lastStableTheme = null;
});

// all 18 themes: Conquera rgb(255,215,0) and High Contrast rgb(255,255,0) differ by only 40 in Manhattan
// distance and used to collide under 1/(dist+1)^4; smooth affinity separates them without letting a few
// near-exact pixels decide
for (const tema of WF_THEMES_VOTABLES) {
    test(`detectThemeFromSnapshot reconoce el tema ${tema.name}`, () => {
        const det = detecta(repinta(SNAP, [tema.r, tema.g, tema.b]));
        assert.ok(det, "devolvió null: ningún píxel pasó el corte de brillo");
        assert.equal(det.name, tema.name);
    });
}

test("Tenno rgb(6,106,74) se detecta pese a su luma 72 (regresión del corte fijo en 100)", () => {
    // absolute threshold discarded ALL pixels below 100 and this theme falls entirely below that: detection
    // returned null and the scanner stayed on the previous stable theme or none
    const tenno = WF_THEMES_VOTABLES.find((t) => t.name === "Tenno");
    assert.ok(tenno, "el catálogo debe seguir teniendo el tema Tenno");
    assert.ok(0.299 * tenno.r + 0.587 * tenno.g + 0.114 * tenno.b < 100, "premisa: su luma está bajo 100");
    assert.equal(detecta(repinta(SNAP, [tenno.r, tenno.g, tenno.b]))?.name, "Tenno");
});

test("el color devuelto es el MEDIDO en pantalla, no el del catálogo", () => {
    // actualR/G/B feeds masks: returning catalog colors would ignore bloom and capture compression, isolating
    // too little
    const det = detecta(SNAP);
    assert.equal(det.name, "Default");
    assert.ok(det.actualR !== det.r || det.actualG !== det.g || det.actualB !== det.b,
        `actual rgb(${det.actualR},${det.actualG},${det.actualB}) no debería ser el del catálogo`);
});

test("un frame casi negro no inventa tema", () => {
    // no text means no theme: minimum weight guard must return null even when percentile threshold lets the
    // top 10% through (dark noise)
    const negro = { width: 400, height: 400, data: new Uint8ClampedArray(400 * 400 * 4) };
    for (let i = 0; i < negro.data.length; i += 4) {
        const v = (i / 4) % 7;
        negro.data[i] = v; negro.data[i + 1] = v; negro.data[i + 2] = v; negro.data[i + 3] = 255;
    }
    assert.equal(VisionService.detectThemeFromSnapshot(negro, 0, 0, 400, 400), null);
});

// eligeTema: the voting itself without a canvas

/** RGBA buffer with nTexto pixels of given colour over nFondo dark background pixels */
function muestra(color, nTexto, nFondo, fondo = [12, 14, 20]) {
    const total = nTexto + nFondo;
    const px = new Uint8ClampedArray(total * 4);
    for (let i = 0; i < total; i++) {
        const c = i < nTexto ? color : fondo;
        px[i * 4] = c[0]; px[i * 4 + 1] = c[1]; px[i * 4 + 2] = c[2]; px[i * 4 + 3] = 255;
    }
    return px;
}

const TEMAS = [
    { name: "A", r: 240, g: 120, b: 20 },
    { name: "B", r: 20, g: 120, b: 240 },
];

test("eligeTema no deja que una minoría EXACTA gane a la mayoría del texto", () => {
    // with 1/(dist+1)^4 a few pixels matching the exact catalog colour beat the entire text screen because
    // rendered text never matches catalog values: here 100 exact Zephyr pixels vs 300 real capture orange
    // rgb(247,130,3)
    const zephyr = WF_THEMES_VOTABLES.find((t) => t.name === "Zephyr");
    // mostly dark background so percentile threshold lets BOTH groups through, matching real frames
    const grupos = [[12000, [9, 11, 14]], [400, [zephyr.r, zephyr.g, zephyr.b]], [1200, [247, 130, 3]]];
    const total = grupos.reduce((n, [c]) => n + c, 0);
    const px = new Uint8ClampedArray(total * 4);
    let i = 0;
    for (const [n, [r, g, b]] of grupos) {
        for (let k = 0; k < n; k++, i++) {
            px[i * 4] = r; px[i * 4 + 1] = g; px[i * 4 + 2] = b; px[i * 4 + 3] = 255;
        }
    }
    assert.equal(eligeTema(px, WF_THEMES_VOTABLES)?.tema.name, "Default");
});

test("eligeTema devuelve el color medido, no el del catálogo", () => {
    // text with bloom drifts from catalog colour and that drifted colour is what needs isolating
    const voto = eligeTema(muestra([243, 123, 23], 160, 240), TEMAS);
    assert.equal(voto.tema.name, "A");
    assert.deepEqual([voto.actualR, voto.actualG, voto.actualB], [243, 123, 23]);
});

test("eligeTema descarta el fondo por PERCENTIL, no por brillo absoluto", () => {
    // dark theme (luma 66) over even darker background: a fixed 100 cutoff dropped it completely (the Tenno
    // case isolated)
    const oscuro = [{ name: "Oscuro", r: 128, g: 40, b: 40 }, ...TEMAS];
    assert.equal(eligeTema(muestra([128, 40, 40], 40, 360, [8, 8, 10]), oscuro)?.tema.name, "Oscuro");
});

test("eligeTema no elige nada si ningún píxel se parece a un tema", () => {
    // grays are equidistant from everything, so no theme gathers enough weight
    assert.equal(eligeTema(muestra([128, 128, 128], 200, 200), TEMAS), null);
});

test("un puñado de píxeles de CROMO no gana al texto de toda la pantalla", () => {
    // on the zone chosen by auto-grid: 37 chrome pixels of exact Zephyr rgb(255,53,0) vs 9678 inventory name
    // pixels at rgb(247,130,3)
    // under 1/(dist+1)^4 chrome weighed 36.0 and text 0.0058 (6000x factor), making 21 of 37 real inventory
    // captures falsely detect Zephyr instead of Default
    const calib = VisionService.detectGridAutoCalib(SNAP, SNAP.width, SNAP.height);
    assert.ok(calib?.gridZone, "el auto-grid debe encontrar la zona de la rejilla");
    const z = calib.gridZone;
    assert.equal(VisionService.detectThemeFromSnapshot(SNAP, z.x, z.y, z.w, z.h)?.name, "Default");
});

test("el listón de fiabilidad va sobre la afinidad MEDIA, no sobre la suma", () => {
    // a raw sum scales with zone size, allowing large grayish art areas to pass: measured true captures give
    // average affinity 0.325-0.334 while false-positive art gave 0.048-0.19
    const gris = new Uint8ClampedArray(40000 * 4);
    for (let i = 0; i < 40000; i++) {
        const v = 180 + (i % 5);
        gris[i * 4] = v; gris[i * 4 + 1] = v - 2; gris[i * 4 + 2] = v - 14; gris[i * 4 + 3] = 255;
    }
    assert.equal(eligeTema(gris, WF_THEMES_VOTABLES), null, "40.000 píxeles de arte no hacen un tema");

    // the same number of pixels matching an actual theme colour does trigger detection
    const naranja = new Uint8ClampedArray(40000 * 4);
    for (let i = 0; i < 40000; i++) {
        naranja[i * 4] = 247; naranja[i * 4 + 1] = 130; naranja[i * 4 + 2] = 3; naranja[i * 4 + 3] = 255;
    }
    const voto = eligeTema(naranja, WF_THEMES_VOTABLES);
    assert.equal(voto?.tema.name, "Default");
    assert.ok(voto.afinidad >= 0.25, `afinidad ${voto.afinidad}`);
});

test("un frame renderizado TENUE sigue dando el mismo tema", () => {
    // live capture streams are darker and compressed: without scaling against pixel brightness a 20%
    // brightness drop lost the theme, while scaling holds down to 60%
    // real user captures with red text measured rgb(152,30,34) and rgb(102,21,23), which is Stalker
    // rgb(255,61,51) at 60% and 40%
    const atenua = (snap, k) => {
        const s = snap.data, d = new Uint8ClampedArray(s.length);
        for (let i = 0; i < s.length; i += 4) {
            d[i] = s[i] * k; d[i + 1] = s[i + 1] * k; d[i + 2] = s[i + 2] * k; d[i + 3] = 255;
        }
        return { width: snap.width, height: snap.height, data: d };
    };
    for (const k of [0.8, 0.7, 0.6]) {
        assert.equal(detecta(atenua(SNAP, k))?.name, "Default", `al ${k * 100}% de brillo`);
    }
});

test("un tema pintado tenue se reconoce como ese tema, no como otro", () => {
    // Stalker at 60%: literally what appears in user red captures
    const stalker = WF_THEMES_VOTABLES.find((t) => t.name === "Stalker");
    const rojoTenue = repinta(SNAP, [stalker.r * 0.6, stalker.g * 0.6, stalker.b * 0.6]);
    assert.equal(detecta(rojoTenue)?.name, "Stalker");
});

test("un frame flojo no cambia el tema de la sesión", () => {
    // live case: Vitruvian session (0.887 affinity) where mission end leaked Grineer at 0.517 and the scanner
    // flickered between them frame to frame; with the wrong theme ALL subsequent colour masks fail
    const naranja = repinta(SNAP, [246, 129, 3]);
    const pom = WF_THEMES_VOTABLES.find((t) => t.name === "Pom 2");
    const verde = repinta(SNAP, [pom.r, pom.g, pom.b]);
    assert.equal(detecta(naranja)?.name, "Default", "el primer tema fiable se fija sin esperar");
    assert.equal(detecta(verde)?.name, "Default");
    assert.equal(detecta(verde)?.name, "Default");
    assert.equal(detecta(verde)?.name, "Pom 2", "tres seguidos sí relevan");
    // an isolated frame of the previous theme does not revert it
    assert.equal(detecta(naranja)?.name, "Pom 2");
});
