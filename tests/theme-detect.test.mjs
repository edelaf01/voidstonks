// detectThemeFromSnapshot contra los 18 temas votables, sobre una captura real repintada.
//
// La función ya se llamaba en cuatro tests (badge-*, inventory-captures) pero SIEMPRE con la
// misma captura naranja y sin comprobar qué tema devolvía —`assert.ok(theme)` pasa igual si
// acierta que si se equivoca de tema—. El tema es la entrada de todas las máscaras por color
// que vienen después (nombres, badges), así que fallar aquí no rompe esta función: rompe el
// escaneo entero y en un sitio que no se mira.
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
// Zona de la rejilla: lo que scanner.service.js le pasa de verdad.
const ZONA = { x: 87, y: 281, w: 277 * 6, h: 296 * 3 };

/** Repinta el frame con otro color de tema conservando la intensidad relativa (antialias incluido). */
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

// El detector arrastra estado a propósito (el tema no cambia a mitad de sesión, así que un tema
// nuevo necesita ganar varios frames seguidos). Cada test parte de cero.
beforeEach(() => {
    VisionService._temaVotos = [];
    globalThis.state = globalThis.state || {};
    globalThis.state.lastStableTheme = null;
});

// Los 18, sin excepciones. Conquera rgb(255,215,0) y High Contrast rgb(255,255,0) distan solo
// 40 en Manhattan y con el peso 1/(dist+1)^4 se confundían; el núcleo de afinidad suave las
// separa porque deja de decidirlo un puñado de píxeles casi exactos.
for (const tema of WF_THEMES_VOTABLES) {
    test(`detectThemeFromSnapshot reconoce el tema ${tema.name}`, () => {
        const det = detecta(repinta(SNAP, [tema.r, tema.g, tema.b]));
        assert.ok(det, "devolvió null: ningún píxel pasó el corte de brillo");
        assert.equal(det.name, tema.name);
    });
}

test("Tenno rgb(6,106,74) se detecta pese a su luma 72 (regresión del corte fijo en 100)", () => {
    // El corte absoluto descartaba TODO píxel por debajo de 100 y este tema entero cae ahí:
    // la detección devolvía null y el escáner seguía con el último tema estable, o con ninguno.
    const tenno = WF_THEMES_VOTABLES.find((t) => t.name === "Tenno");
    assert.ok(tenno, "el catálogo debe seguir teniendo el tema Tenno");
    assert.ok(0.299 * tenno.r + 0.587 * tenno.g + 0.114 * tenno.b < 100, "premisa: su luma está bajo 100");
    assert.equal(detecta(repinta(SNAP, [tenno.r, tenno.g, tenno.b]))?.name, "Tenno");
});

test("el color devuelto es el MEDIDO en pantalla, no el del catálogo", () => {
    // actualR/G/B es lo que alimenta las máscaras: si devolviera el color del catálogo, el
    // bloom y la compresión de la captura quedarían fuera y la máscara aislaría de menos.
    const det = detecta(SNAP);
    assert.equal(det.name, "Default");
    assert.ok(det.actualR !== det.r || det.actualG !== det.g || det.actualB !== det.b,
        `actual rgb(${det.actualR},${det.actualG},${det.actualB}) no debería ser el del catálogo`);
});

test("un frame casi negro no inventa tema", () => {
    // Sin texto no hay tema: el guard de peso mínimo debe seguir devolviendo null aunque el
    // corte por percentil siempre deje pasar el 10% más brillante (aquí, ruido oscuro).
    const negro = { width: 400, height: 400, data: new Uint8ClampedArray(400 * 400 * 4) };
    for (let i = 0; i < negro.data.length; i += 4) {
        const v = (i / 4) % 7;
        negro.data[i] = v; negro.data[i + 1] = v; negro.data[i + 2] = v; negro.data[i + 3] = 255;
    }
    assert.equal(VisionService.detectThemeFromSnapshot(negro, 0, 0, 400, 400), null);
});

// Visto en vivo: el título "MISSION COMPLETE" es un oro más oscuro que el Vitruvian recordado de
// la sesión; binarizarlo por distancia a ese recuerdo dejaba el recorte en blanco y el fin de
// misión no se detectaba nunca. Sin voto fiable, el título centrado va sin tema (recorte crudo).
test("sin voto fiable se devuelve el tema recordado, salvo que se pida sin recuerdo", () => {
    const negro = { width: 400, height: 400, data: new Uint8ClampedArray(400 * 400 * 4) };
    for (let i = 0; i < negro.data.length; i += 4) { const v = (i / 4) % 7; negro.data[i] = v; negro.data[i + 1] = v; negro.data[i + 2] = v; negro.data[i + 3] = 255; }
    const recordado = { name: "Vitruvian", r: 245, g: 227, b: 173, actualR: 226, actualG: 211, actualB: 163 };
    globalThis.state.lastStableTheme = recordado;
    try {
        assert.equal(VisionService.detectThemeFromSnapshot(negro, 0, 0, 400, 400), recordado);
        assert.equal(VisionService.detectThemeFromSnapshot(negro, 0, 0, 400, 400, { sinRecuerdo: true }), null);
    } finally { globalThis.state.lastStableTheme = null; }
});

// ---------------------------------------------------------------------------
// eligeTema: la votación en sí, sin canvas de por medio.
// ---------------------------------------------------------------------------

/** Buffer RGBA con `nTexto` píxeles del color dado sobre `nFondo` píxeles de fondo oscuro. */
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
    // Esta propiedad es la contraria a la que tenía el algoritmo original, y a propósito: con
    // el peso 1/(dist+1)^4, un puñado de píxeles que dieran el color exacto del catálogo ganaba
    // a toda la pantalla de texto, porque el texto renderizado nunca da el color exacto.
    // Aquí: 100 píxeles del Zephyr EXACTO contra 300 con el naranja realmente medido en las
    // capturas, rgb(247,130,3), que no es el rgb(227,128,20) del catálogo.
    const zephyr = WF_THEMES_VOTABLES.find((t) => t.name === "Zephyr");
    // Fondo oscuro mayoritario para que el corte por percentil deje pasar a los DOS grupos,
    // como pasa en un frame de verdad.
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
    // Texto con bloom: sale desplazado del color del catálogo y es ESE el que hay que aislar.
    const voto = eligeTema(muestra([243, 123, 23], 160, 240), TEMAS);
    assert.equal(voto.tema.name, "A");
    assert.deepEqual([voto.actualR, voto.actualG, voto.actualB], [243, 123, 23]);
});

test("eligeTema descarta el fondo por PERCENTIL, no por brillo absoluto", () => {
    // Un tema oscuro (luma 66) sobre fondo aún más oscuro: un corte fijo en 100 lo tiraría
    // entero. Es el caso Tenno, aislado.
    const oscuro = [{ name: "Oscuro", r: 128, g: 40, b: 40 }, ...TEMAS];
    assert.equal(eligeTema(muestra([128, 40, 40], 40, 360, [8, 8, 10]), oscuro)?.tema.name, "Oscuro");
});

test("eligeTema no elige nada si ningún píxel se parece a un tema", () => {
    // Grises: equidistantes de todo, así que ningún tema reúne peso.
    assert.equal(eligeTema(muestra([128, 128, 128], 200, 200), TEMAS), null);
});

test("un puñado de píxeles de CROMO no gana al texto de toda la pantalla", () => {
    // Sobre la ZONA QUE ELIGE EL AUTO-GRID, que es la que usa el escáner de verdad (la de más
    // arriba en este fichero está puesta a mano y no incluye la fila de iconos de filtro).
    // Dentro de ella hay 37 píxeles del borde rojo del icono seleccionado, que dan el color
    // EXACTO de Zephyr rgb(255,53,0), contra 9678 píxeles de los nombres del inventario, que
    // miden rgb(247,130,3) y no aciertan el rgb(227,128,20) del catálogo por bloom y compresión.
    // Con el peso 1/(dist+1)^4 el cromo pesaba 36,0 y el texto 0,0058 —factor 6000— y 21 de las
    // 37 capturas reales de inventario detectaban Zephyr en vez de Default.
    const calib = VisionService.detectGridAutoCalib(SNAP, SNAP.width, SNAP.height);
    assert.ok(calib?.gridZone, "el auto-grid debe encontrar la zona de la rejilla");
    const z = calib.gridZone;
    assert.equal(VisionService.detectThemeFromSnapshot(SNAP, z.x, z.y, z.w, z.h)?.name, "Default");
});

test("el listón de fiabilidad va sobre la afinidad MEDIA, no sobre la suma", () => {
    // Una suma escala con el tamaño de la zona, así que una región grande de arte grisáceo la
    // superaba sin que ningún píxel se pareciera a un tema. Medido: las capturas que aciertan
    // dan afinidad media 0,325-0,334 y el arte que colaba falsos positivos, 0,048-0,19.
    const gris = new Uint8ClampedArray(40000 * 4);
    for (let i = 0; i < 40000; i++) {
        const v = 180 + (i % 5);
        gris[i * 4] = v; gris[i * 4 + 1] = v - 2; gris[i * 4 + 2] = v - 14; gris[i * 4 + 3] = 255;
    }
    assert.equal(eligeTema(gris, WF_THEMES_VOTABLES), null, "40.000 píxeles de arte no hacen un tema");

    // Y el mismo número de píxeles, ahora sí del color de un tema, sí lo hace.
    const naranja = new Uint8ClampedArray(40000 * 4);
    for (let i = 0; i < 40000; i++) {
        naranja[i * 4] = 247; naranja[i * 4 + 1] = 130; naranja[i * 4 + 2] = 3; naranja[i * 4 + 3] = 255;
    }
    const voto = eligeTema(naranja, WF_THEMES_VOTABLES);
    assert.equal(voto?.tema.name, "Default");
    assert.ok(voto.afinidad >= 0.25, `afinidad ${voto.afinidad}`);
});

test("un frame renderizado TENUE sigue dando el mismo tema", () => {
    // El stream de captura en vivo llega más oscuro y comprimido que una captura de escritorio,
    // y varios temas pintan el texto de lista bastante más apagado que su color de catálogo.
    // Medido: comparando contra el color del catálogo SIN escalar, basta un 20% menos de brillo
    // para que el tema se pierda; escalando el catálogo al brillo del píxel aguanta hasta el 60%.
    // Es el caso real de dos capturas del usuario, cuyo texto rojo mide rgb(152,30,34) y
    // rgb(102,21,23) — Stalker rgb(255,61,51) al 60% y al 40%.
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
    // Stalker al 60%: es literalmente lo que hay en las capturas rojas del usuario.
    const stalker = WF_THEMES_VOTABLES.find((t) => t.name === "Stalker");
    const rojoTenue = repinta(SNAP, [stalker.r * 0.6, stalker.g * 0.6, stalker.b * 0.6]);
    assert.equal(detecta(rojoTenue)?.name, "Stalker");
});

test("un frame flojo no cambia el tema de la sesión", () => {
    // El caso en vivo: sesión de tema Vitruvian (afinidad 0,887) en la que la pantalla de fin de
    // misión colaba Grineer con 0,517 y el escáner alternaba entre los dos frame a frame. Con el
    // tema equivocado, TODAS las máscaras por color de después leen mal.
    const naranja = repinta(SNAP, [246, 129, 3]);
    const pom = WF_THEMES_VOTABLES.find((t) => t.name === "Pom 2");
    const verde = repinta(SNAP, [pom.r, pom.g, pom.b]);
    assert.equal(detecta(naranja)?.name, "Default", "el primer tema fiable se fija sin esperar");
    // Dos frames del otro tema no bastan: hacen falta tres de los últimos cinco.
    assert.equal(detecta(verde)?.name, "Default");
    assert.equal(detecta(verde)?.name, "Default");
    assert.equal(detecta(verde)?.name, "Pom 2", "tres sí relevan");
    // Y un frame suelto del anterior no lo devuelve.
    assert.equal(detecta(naranja)?.name, "Pom 2");
});

// El recorte de cabecera vota distinto en cada pantalla: con "tres seguidos", un voto suelto por
// un tercer tema reiniciaba la racha y el tema equivocado se quedaba toda la sesión.
test("un voto intercalado por otro tema no reinicia la cuenta: valen 3 de los últimos 5", () => {
    const naranja = repinta(SNAP, [246, 129, 3]);
    const pom = WF_THEMES_VOTABLES.find((t) => t.name === "Pom 2");
    const verde = repinta(SNAP, [pom.r, pom.g, pom.b]);
    assert.equal(detecta(naranja)?.name, "Default");
    assert.equal(detecta(verde)?.name, "Default");
    assert.equal(detecta(naranja)?.name, "Default", "voto por el vigente, intercalado");
    assert.equal(detecta(verde)?.name, "Default");
    assert.equal(detecta(verde)?.name, "Pom 2", "3 de los últimos 5 aunque no seguidos");
});

// El caso del log: Stalker mal fijado en una pantalla roja y Vitruvian a 0,979 esperando tres
// frames seguidos que no llegaban. Decisión pura, con votos sintéticos.
test("decideTema: un voto inequívoco (≥ 0,9) releva sin esperar; uno normal necesita 3 de 5", async () => {
    const { decideTema } = await import("../deploy/js/utils/vision/theme_vote.js");
    const stalker = { name: "Stalker" };
    const voto = (name, afinidad) => ({ tema: { name }, afinidad });
    assert.equal(decideTema(stalker, voto("Vitruvian", 0.979), []).releva, true);
    assert.equal(decideTema(null, voto("Vitruvian", 0.6), []).releva, true, "sin tema vigente, el primero fiable se fija");
    assert.equal(decideTema(stalker, voto("Stalker", 0.6), ["Lotus"]).releva, true, "votar por el vigente lo mantiene");
    // Secuencia del log con votos normales: Lotus, Vitruvian, Vitruvian, Lotus, Vitruvian → releva al 3º Vitruvian.
    let votos = [];
    const paso = (name, af = 0.8) => { const d = decideTema(stalker, voto(name, af), votos); votos = d.votos; return d.releva; };
    assert.equal(paso("Lotus"), false);
    assert.equal(paso("Vitruvian"), false);
    assert.equal(paso("Vitruvian"), false);
    assert.equal(paso("Lotus"), false, "un voto por un tercer tema no reinicia la cuenta");
    assert.equal(paso("Vitruvian"), true, "3 de los últimos 5");
    // La ventana es de 5: tres votos muy separados no valen.
    votos = ["Vitruvian", "Lotus", "Lotus", "Lotus", "Lotus"];
    assert.equal(decideTema(stalker, voto("Vitruvian", 0.8), votos).releva, false);
    assert.equal(decideTema(stalker, voto("Vitruvian", 0.8), votos).n, 1, "el primero ya salió de la ventana");
});
