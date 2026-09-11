import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { installFakeDocument } from "./_helpers/fake-canvas.mjs";
import { pantallaFisura, TEMAS } from "./_helpers/reward-synth.mjs";

installFakeDocument();
const { VisionService } = await import("../deploy/js/services/scanner/vision.service.js");

// ===========================================================================
// La pasada de NOMBRES de la pantalla de fisura, que es la que alimenta a parseRewards.
//
// Reproduce un fallo visto en vivo con los logs delante: la banda se detectaba bien
// ("card_row: 3 cards"), el lienzo se construía (1690x217) y aun así el OCR de nombres
// devolvía "" y salían 0 ítems, tres veces por frame (un preset cada vez), en bucle.
//
// La causa es que la máscara se quedaba con el ARTE de las tarjetas —lo más brillante del
// frame— y tiraba los rótulos, que son tenues. Ningún test lo veía porque ninguno recorría
// pantalla -> banda -> lienzo de nombres: la suite estaba verde con esto roto.
//
// La escena sintética reproduce los números de esa sesión: lienzo de 1690 px de ancho, ~30k
// píxeles de tinta y CERO dentro de la franja del rótulo.
// ===========================================================================

/** Píxeles de tinta (negros) dentro de una franja de filas del lienzo. */
function tintaEnFilas(cvs, y0, y1) {
    const { data, width } = cvs.getContext("2d").getImageData(0, 0, cvs.width, cvs.height);
    let n = 0;
    for (let y = Math.max(0, y0); y < Math.min(cvs.height, y1); y++) {
        for (let x = 0; x < width; x++) if (data[(y * width + x) * 4] < 128) n++;
    }
    return n;
}

function lienzoDeNombres(escena) {
    const { img, banda } = escena;
    const video = globalThis.document.createElement("canvas");
    video.width = img.width; video.height = img.height;
    video.getContext("2d").putImageData(img, 0, 0);
    video.videoWidth = img.width; video.videoHeight = img.height;
    const escala = 0.75;
    const cvs = VisionService.prepareRewardNamesCanvas(video, img.width, img.height, escala, banda);
    return { cvs, escala };
}

describe("pasada de nombres de la pantalla de fisura", () => {
    test("el rótulo sobrevive a la máscara aunque el arte de la tarjeta brille mucho más", () => {
        const escena = pantallaFisura({ tema: TEMAS.stalker, brilloRotulo: 0.6, tinte: 0.55, manchasArte: 10 });
        const { cvs, escala } = lienzoDeNombres(escena);
        assert.notEqual(cvs, null, "la pasada de nombres se saltó entera (máscara ruidosa)");

        const r = escena.rotulos[0];
        const y0 = Math.round((r.y - escena.banda.y) * escala);
        const filas = tintaEnFilas(cvs, y0, y0 + Math.round(r.h * escala));
        // El rótulo son trazos finos; con que quede una parte reconocible basta para el OCR.
        assert.ok(filas > 200, `el rótulo se perdió en la máscara: solo ${filas} px de tinta`);
    });

    // PENDIENTE, no arreglado: con el rótulo al 45% del brillo del tema su contraste local
    // contra el fondo teñido es ~14, y el listón de themeTextMask se queda en 20 porque el arte
    // brillante de la tarjeta sube el percentil del que sale el listón relativo. Hace falta que
    // el contraste se mida por zonas, no con un valor para todo el recorte. Queda en `todo` a
    // propósito: bajar la aserción para que pase sería tapar el mismo agujero que este fichero
    // existe para destapar.
    test("un rótulo más tenue todavía sigue apareciendo", { todo: true }, () => {
        // El brillo del texto depende del tema que elija el jugador y del tinte de la misión;
        // fijar un suelo de brillo es justo lo que rompía esto.
        const escena = pantallaFisura({ tema: TEMAS.stalker, brilloRotulo: 0.45, tinte: 0.55, manchasArte: 10 });
        const { cvs, escala } = lienzoDeNombres(escena);
        assert.notEqual(cvs, null, "la pasada de nombres se saltó entera");
        const r = escena.rotulos[0];
        const y0 = Math.round((r.y - escena.banda.y) * escala);
        assert.ok(tintaEnFilas(cvs, y0, y0 + Math.round(r.h * escala)) > 200,
            "con el rótulo más tenue la máscara vuelve a quedarse solo con el arte");
    });

    // ---------------------------------------------------------------------------
    // Barrido por TEMA. El color del rótulo lo elige el jugador y el juego lo dibuja atenuado
    // sobre un fondo teñido del mismo tono, así que "¿sobrevive el rótulo?" no tiene UNA
    // respuesta: la tiene por tema y por lo atenuado que venga. Esta rejilla es el mapa de
    // dónde aguanta hoy la máscara, y su valor está en que un cambio en el enmascarado la
    // mueve entera y se ve de un vistazo cuál se rompió.
    //
    // El 0,6 es el brillo medido en las capturas del usuario (arte a canal ~250, rótulo ~150).
    // ---------------------------------------------------------------------------
    const tintaDelRotulo = (escena) => {
        const { cvs, escala } = lienzoDeNombres(escena);
        if (!cvs) return -1;   // -1 = la pasada se saltó entera (máscara ruidosa)
        const r = escena.rotulos[0];
        const y0 = Math.round((r.y - escena.banda.y) * escala);
        return tintaEnFilas(cvs, y0, y0 + Math.round(r.h * escala));
    };

    // Temas de color SATURADO: el histograma de tono encuentra su pico y la máscara los aísla.
    for (const nombre of ["legacy", "vitruvian", "stalker", "baruuk", "corpus", "fortuna",
        "grineer", "lotus", "nidus", "orokin", "default", "high-contrast"]) {
        test(`tema ${nombre}: el rótulo aguanta al 60 % del brillo del tema`, () => {
            const tinta = tintaDelRotulo(pantallaFisura({ tema: TEMAS[nombre], brilloRotulo: 0.6, tinte: 0.55, manchasArte: 10 }));
            assert.ok(tinta > 200, `solo ${tinta} px de tinta en la franja del rótulo`);
        });
    }

    // Los tres que daban CERO tinta a cualquier brillo, cada uno por un motivo, y los dos
    // arreglos que lo resolvieron:
    //   - Tenno rgb(6,106,74) y el apagado son temas OSCUROS: su rótulo contrasta igual de bien
    //     que uno brillante pero con la mitad de diferencia absoluta de luma (22.9 contra 43.9),
    //     y el listón de contraste estaba en unidades de luma. Ahora es relativo al nivel local.
    //   - El blanco puro no estaba en el catálogo de temas, así que no era un caso peor sino
    //     imposible: la máscara marca un píxel si coincide con ALGÚN tema.
    for (const [nombre, brillo] of [["tenno", 0.75], ["blanco", 0.75], ["apagado", 0.75]]) {
        test(`tema ${nombre}: el rótulo aguanta al ${brillo * 100} % del brillo`, () => {
            const tinta = tintaDelRotulo(pantallaFisura({ tema: TEMAS[nombre], brilloRotulo: brillo, tinte: 0.55, manchasArte: 10 }));
            assert.ok(tinta > 200, `solo ${tinta} px de tinta en la franja del rótulo`);
        });
    }
});
