import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// ===========================================================================
// Se lee el FUENTE en vez de ejecutar el servicio. Justificación (CLAUDE.md permite esto
// cuando montar el entorno cuesta más que lo que protege): disparar este camino de verdad
// pide un <video>, getDisplayMedia, workers de OCR y una pantalla de inventario real.
//
// Lo que protege es grave y silencioso: `processFrame()` sale en su primera línea si
// `detectionLocked` sigue puesto, así que un `return` que se deje el cerrojo mata el escáner
// ENTERO —contexto incluido— hasta reiniciarlo. Pasó: cuatro salidas del camino de inventario
// (pantalla de kubrow, sin calibración, tras el flujo de calibración y auto-grid fallido) lo
// dejaban puesto, y el síntoma era "no me sale la pantalla de recompensas".
// ===========================================================================

const FUENTE = readFileSync(new URL("../deploy/js/services/scanner/scanner.service.js", import.meta.url), "utf8");
const LINEAS = FUENTE.split("\n");

/** Región entre tomar el cerrojo y el final del método que lo toma. */
function regionDelCerrojo() {
    const ini = LINEAS.findIndex((l) => /^\s+this\.detectionLocked = true;/.test(l));
    assert.notEqual(ini, -1, "ya no se toma el cerrojo: ¿se renombró detectionLocked?");
    const sangria = LINEAS[ini].match(/^\s*/)[0].length;
    for (let i = ini + 1; i < LINEAS.length; i++) {
        // el cierre del método está dos niveles por fuera de la sentencia
        if (new RegExp(`^\\s{${sangria - 4}}\\},?$`).test(LINEAS[i])) return { ini, fin: i };
    }
    return { ini, fin: LINEAS.length };
}

describe("cerrojo del escáner", () => {
    test("toda salida temprana suelta detectionLocked", () => {
        const { ini, fin } = regionDelCerrojo();
        const culpables = [];
        for (let i = ini + 1; i < fin; i++) {
            if (!/^\s+return;\s*$/.test(LINEAS[i])) continue;
            const antes = LINEAS.slice(Math.max(ini, i - 3), i).join("\n");
            if (!/detectionLocked = false/.test(antes)) culpables.push(`línea ${i + 1}: ${LINEAS[i].trim()}`);
        }
        assert.deepEqual(culpables, [], `salidas que se dejan el cerrojo puesto:\n${culpables.join("\n")}`);
    });

    test("el camino que abre el modal sí se queda el cerrojo, y lo suelta el modal", () => {
        assert.match(FUENTE, /this\.detectionLocked = true;[\s\S]{0,400}ScannerModal\.open\(/);
        const modal = readFileSync(new URL("../deploy/js/ui.components/ui_scanner_modal.js", import.meta.url), "utf8");
        assert.equal(/ScannerService\.detectionLocked = false/.test(modal), true);
    });
});
