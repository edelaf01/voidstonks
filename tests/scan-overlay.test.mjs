import { test } from "node:test";
import assert from "node:assert/strict";
import { createCellOverlay } from "../deploy/js/utils/vision/scan_overlay.js";

// ===========================================================================
// Overlay de debug del escaneo (utils/vision/scan_overlay.js).
//
// Se pinta sobre el RECORTE de la zona de rejilla, no sobre el frame entero, así que
// todo tiene que ir en coordenadas del recorte. Si se cuela una coordenada del frame,
// las etiquetas aparecen desplazadas y la captura de debug —que es la única forma de
// diagnosticar una pasada en vivo— señala la celda equivocada.
// ===========================================================================

const ZONE = { x: 88, y: 243, w: 1662, h: 888 };
const CELL_W = 277, CELL_H = 296;
const CELL = { sx: ZONE.x + 2 * CELL_W, sy: ZONE.y + CELL_H, r: 1, c: 2 };

/** ctx de mentira que apunta el rectángulo que toca cada operación. */
function ctxEspia() {
    const ops = [];
    return {
        ops,
        fillStyle: "", strokeStyle: "", font: "", lineWidth: 1,
        fillRect: (x, y, w, h) => ops.push({ x, y, w, h }),
        strokeRect: (x, y, w, h) => ops.push({ x, y, w, h }),
        fillText: (t, x, y) => ops.push({ x, y, w: 0, h: 0, text: t }),
        measureText: (t) => ({ width: String(t).length * 6 }),
    };
}

const CASOS = [
    ["resuelta", (o, ctx) => o.drawResolved({
        cell: CELL, name: "Ankyros Blueprint", qtyResult: { raw: "8" },
        text: ["ANKYROS", "PRIME", "BLUEPRINT"], accent: "#00e676", qty: 8,
    }) || ctx],
    ["fallida", (o, ctx) => o.drawFailed({
        cell: CELL, text: "AKY OS PRIME", line2: 'BDG: "Ø"', status: "UNMATCHED CELL",
    }) || ctx],
];

for (const [nombre, pinta] of CASOS) {
    test(`overlay: la celda ${nombre} se pinta en coordenadas del recorte`, () => {
        const ctx = ctxEspia();
        pinta(createCellOverlay(ctx, ZONE, CELL_W, CELL_H), ctx);
        assert.ok(ctx.ops.length > 0, "no pintó nada");

        const relX = CELL.sx - ZONE.x, relY = CELL.sy - ZONE.y;
        for (const op of ctx.ops) {
            // La píldora de cantidad se sale a la izquierda a propósito (para no tapar el
            // badge), de ahí el margen; lo que no puede es irse a la celda de al lado.
            assert.ok(op.x >= relX - 20 && op.x <= relX + CELL_W,
                `x=${op.x} fuera de la celda [${relX}, ${relX + CELL_W}]`);
            assert.ok(op.y >= relY && op.y <= relY + CELL_H,
                `y=${op.y} fuera de la celda [${relY}, ${relY + CELL_H}]`);
        }
    });
}

test("overlay: el texto largo se recorta para no salirse de la celda", () => {
    const ctx = ctxEspia();
    createCellOverlay(ctx, ZONE, CELL_W, CELL_H).drawFailed({
        cell: CELL, text: "A".repeat(500), line2: 'BDG: "Ø"', status: "UNMATCHED CELL",
    });
    const largos = ctx.ops.filter(o => o.text && o.text.length > Math.floor(CELL_W / 5.5));
    assert.deepEqual(largos, [], "un texto sin recortar se pinta encima de la celda vecina");
});
