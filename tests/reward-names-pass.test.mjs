import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { installFakeDocument } from "./_helpers/fake-canvas.mjs";
import { pantallaFisura, TEMAS } from "./_helpers/reward-synth.mjs";

installFakeDocument();
const { VisionService } = await import("../deploy/js/services/scanner/vision.service.js");

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
        assert.ok(filas > 200, `el rótulo se perdió en la máscara: solo ${filas} px de tinta`);
    });

    test("un rótulo más tenue todavía sigue apareciendo", { todo: true }, () => {
        const escena = pantallaFisura({ tema: TEMAS.stalker, brilloRotulo: 0.45, tinte: 0.55, manchasArte: 10 });
        const { cvs, escala } = lienzoDeNombres(escena);
        assert.notEqual(cvs, null, "la pasada de nombres se saltó entera");
        const r = escena.rotulos[0];
        const y0 = Math.round((r.y - escena.banda.y) * escala);
        assert.ok(tintaEnFilas(cvs, y0, y0 + Math.round(r.h * escala)) > 200,
            "con el rótulo más tenue la máscara vuelve a quedarse solo con el arte");
    });

    // 0.6 is the brightness measured in user captures (art channel ~250, label ~150)
    const tintaDelRotulo = (escena) => {
        const { cvs, escala } = lienzoDeNombres(escena);
        if (!cvs) return -1;
        const r = escena.rotulos[0];
        const y0 = Math.round((r.y - escena.banda.y) * escala);
        return tintaEnFilas(cvs, y0, y0 + Math.round(r.h * escala));
    };

    for (const nombre of ["legacy", "vitruvian", "stalker", "baruuk", "corpus", "fortuna",
        "grineer", "lotus", "nidus", "orokin", "default", "high-contrast"]) {
        test(`tema ${nombre}: el rótulo aguanta al 60 % del brillo del tema`, () => {
            const tinta = tintaDelRotulo(pantallaFisura({ tema: TEMAS[nombre], brilloRotulo: 0.6, tinte: 0.55, manchasArte: 10 }));
            assert.ok(tinta > 200, `solo ${tinta} px de tinta en la franja del rótulo`);
        });
    }

    for (const [nombre, brillo] of [["tenno", 0.75], ["blanco", 0.75], ["apagado", 0.75]]) {
        test(`tema ${nombre}: el rótulo aguanta al ${brillo * 100} % del brillo`, () => {
            const tinta = tintaDelRotulo(pantallaFisura({ tema: TEMAS[nombre], brilloRotulo: brillo, tinte: 0.55, manchasArte: 10 }));
            assert.ok(tinta > 200, `solo ${tinta} px de tinta en la franja del rótulo`);
        });
    }
});
