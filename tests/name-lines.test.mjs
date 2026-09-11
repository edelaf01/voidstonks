import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { rotuloRecompensa, TEMAS } from "./_helpers/reward-synth.mjs";
import { textLines, inkCoverage, labelFullyRead } from "../deploy/js/utils/vision/name_lines.js";

// ===========================================================================
// Líneas de tinta del rótulo de una recompensa.
//
// Para qué: el juego parte "Xaku Prime Neuroptics Blueprint" en dos o tres líneas y, si el
// OCR pierde una, el texto que queda ("Xaku Prime Blueprint") es OTRO ítem real del catálogo
// — de los 224 nombres multilínea, 168 tienen ese gemelo. Con el texto no hay forma de
// distinguirlo; la tinta que quedó sin leer sí lo delata.
//
// El rótulo sintético reproduce lo que mira la visión (líneas centradas, arte detrás), no
// los glifos: el OCR no corre en los tests.
// ===========================================================================

const CASOS = {
    "una línea": [["FORMA", "BLUEPRINT"]],
    "dos líneas": [["XAKU", "PRIME", "NEUROPTICS"], ["BLUEPRINT"]],
    "tres líneas": [["HARROW", "PRIME"], ["NEUROPTICS"], ["BLUEPRINT"]],
};

describe("rótulo de recompensa: cuántas líneas y cuánta tinta se ha leído", () => {
    for (const [etiqueta, lineas] of Object.entries(CASOS)) {
        for (const [nombreTema, tema] of Object.entries(TEMAS)) {
            for (const ruido of [0, 1]) {
                test(`${etiqueta} · tema ${nombreTema} · ruido ${ruido}: cuenta las líneas`, () => {
                    const { img } = rotuloRecompensa({ lineas, tema, ruido });
                    assert.equal(textLines(img, { tinta: tema }).length, lineas.length);
                });
            }
        }
    }

    test("leyendo todas las palabras, la cobertura es total", () => {
        for (const [etiqueta, lineas] of Object.entries(CASOS)) {
            for (const tema of Object.values(TEMAS)) {
                const { img, cajas } = rotuloRecompensa({ lineas, tema, ruido: 1 });
                const cob = inkCoverage(textLines(img, { tinta: tema }), cajas);
                assert.ok(cob > 0.95, `${etiqueta}: cobertura ${cob.toFixed(2)}`);
            }
        }
    });

    test("perder una palabra del medio deja la mitad de la línea sin cubrir", () => {
        // El caso del usuario: "Xaku Prime Neuroptics" leído como "Xaku Prime".
        const lineas = CASOS["dos líneas"];
        const { img, cajas } = rotuloRecompensa({ lineas, tema: TEMAS.rojo, ruido: 1 });
        const ls = textLines(img, { tinta: TEMAS.rojo });
        const incompleto = cajas.filter((c) => c.texto !== "NEUROPTICS");
        const cob = inkCoverage(ls, incompleto);
        assert.ok(cob < 0.6, `debería delatarse; cobertura ${cob.toFixed(2)}`);
    });

    test("perder una línea entera se ve aún más claro", () => {
        const lineas = CASOS["tres líneas"];
        const { img, cajas } = rotuloRecompensa({ lineas, tema: TEMAS.naranja, ruido: 1 });
        const ls = textLines(img, { tinta: TEMAS.naranja });
        const sinLinea = cajas.filter((c) => c.fila !== 1);
        assert.equal(inkCoverage(ls, sinLinea), 0);
    });

    test("sin color de tinta, se cae a distancia al fondo y sigue contando líneas limpias", () => {
        const { img } = rotuloRecompensa({ lineas: CASOS["tres líneas"], tema: TEMAS.naranja, ruido: 0 });
        assert.equal(textLines(img).length, 3);
    });
});

test("labelFullyRead: acepta el rótulo completo y rechaza el que perdió una palabra", () => {
  // Como lo ve el lector de recompensas: un canvas binarizado (texto negro sobre blanco) y
  // las cajas de palabra del OCR. Aquí el canvas es el rótulo sintético invertido.
  const { img, cajas } = rotuloRecompensa({
    lineas: [["XAKU", "PRIME", "NEUROPTICS"], ["BLUEPRINT"]], tema: TEMAS.rojo, ruido: 1,
  });
  const bin = new Uint8ClampedArray(img.data.length);
  for (let i = 0; i < img.data.length; i += 4) {
    // tinta = píxel saturado del tema -> negro; lo demás -> blanco
    const esTinta = img.data[i] > 120 && img.data[i] - img.data[i + 2] > 40;
    const v = esTinta ? 0 : 255;
    bin[i] = bin[i + 1] = bin[i + 2] = v; bin[i + 3] = 255;
  }
  const canvas = {
    width: img.width, height: img.height,
    getContext: () => ({ getImageData: () => ({ data: bin, width: img.width, height: img.height }) }),
  };
  // El rótulo ocupa la caja entera del sintético, así que se mira desde arriba.
  const opciones = { desdeY: 0 };
  assert.equal(labelFullyRead(canvas, cajas, opciones).completo, true);
  const sinMedio = cajas.filter((c) => c.texto !== "NEUROPTICS");
  const parcial = labelFullyRead(canvas, sinMedio, opciones);
  assert.equal(parcial.completo, false);
  assert.ok(parcial.cobertura < 0.6, `cobertura ${parcial.cobertura}`);
});
