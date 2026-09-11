import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

globalThis.document ??= { createElement: () => ({ getContext: () => null }) };
const { state } = await import("../deploy/js/state.js");
const { OCRService } = await import("../deploy/js/services/scanner/ocr.service.js");

// ===========================================================================
// Barrido de lecturas OCR degradadas contra el matcher de piezas prime.
//
// La pregunta que contesta: cuando el OCR lee mal, ¿el matcher devuelve la pieza correcta,
// no devuelve nada, o mete OTRA pieza? Lo tercero es lo grave: lo leído se escribe en el
// inventario del usuario y no queda copia de lo que había.
//
// El catálogo sale del fichero real del repo (piezas Prime), no de una lista a mano.
// ===========================================================================

const entidades = JSON.parse(readFileSync(new URL("../deploy/assets/json/cleaned_entities.json", import.meta.url), "utf8"));
state.itemsDatabase = {};
for (const e of entidades) {
    if (!/\bPrime\b/i.test(e.name)) continue;
    for (const c of e.components || []) state.itemsDatabase[`${e.name} ${c.name}`] = [{ ducats: c.ducats || 0 }];
}
const NOMBRES = Object.keys(state.itemsDatabase);
const leer = (t) => { const m = OCRService.getValidItemMatch(t); return m?.originalName ?? m?.name ?? m ?? null; };

// Confusiones de glifo: los mismos grupos que declara el matcher.
const GRUPOS = ["O0QDCG", "IL1TJ", "S5", "B8", "Z2", "A4", "EF", "MN", "UV", "RP"];
const semilla = (n) => { let s = n; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; };
const confunde = (ch, rnd) => {
    const g = GRUPOS.find((s) => s.includes(ch));
    if (!g) return ch;
    const alt = g.split("").filter((c) => c !== ch);
    return alt[Math.floor(rnd() * alt.length)] || ch;
};

const CORRUPCIONES = {
    "limpio": (n) => n.toUpperCase(),
    "un glifo cambiado": (n, rnd) => { const u = n.toUpperCase().split(""); const i = Math.floor(rnd() * u.length); u[i] = confunde(u[i], rnd); return u.join(""); },
    "dos glifos cambiados": (n, rnd) => { const u = n.toUpperCase().split(""); for (let k = 0; k < 2; k++) { const i = Math.floor(rnd() * u.length); u[i] = confunde(u[i], rnd); } return u.join(""); },
    "palabras fusionadas por un punto": (n) => n.toUpperCase().replace(" ", "."),
    "con el ruido de la interfaz": (n) => `OWNED ${n.toUpperCase()} 2`,
    "una letra perdida": (n, rnd) => { const u = n.toUpperCase(); const i = Math.floor(rnd() * u.length); return u.slice(0, i) + u.slice(i + 1); },
    "solo la primera palabra": (n) => n.toUpperCase().split(" ")[0],
    "solo la última palabra": (n) => n.toUpperCase().split(" ").at(-1),
    "sin espacios": (n) => n.toUpperCase().replaceAll(" ", ""),
    // Como lo pinta el juego: el camino que lee el nombre a color no binariza y devuelve el
    // texto en mixto. Antes se limpiaba con /[^A-Z]/ y "Caliban Prime Blueprint" quedaba "CPB".
    "tal cual lo pinta el juego": (n) => n,
    "todo en minúsculas": (n) => n.toLowerCase(),
};

describe("matcher de piezas: qué pasa cuando el OCR lee mal", () => {
    for (const [etiqueta, fn] of Object.entries(CORRUPCIONES)) {
        test(`${etiqueta}: nunca devuelve OTRA pieza`, () => {
            const rnd = semilla(42);
            const cruces = [];
            for (const nombre of NOMBRES) {
                const leido = leer(fn(nombre, rnd));
                if (leido && leido !== nombre) cruces.push(`"${fn(nombre, semilla(42))}" -> ${leido} (era ${nombre})`);
            }
            assert.deepEqual(cruces.slice(0, 5), [], `${cruces.length} cruces de ${NOMBRES.length}`);
        });
    }

    test("las lecturas limpias y con un glifo mal se recuperan casi todas", () => {
        for (const etiqueta of ["limpio", "un glifo cambiado", "tal cual lo pinta el juego", "todo en minúsculas"]) {
            const rnd = semilla(42);
            const ok = NOMBRES.filter((n) => leer(CORRUPCIONES[etiqueta](n, rnd)) === n).length;
            assert.ok(ok / NOMBRES.length > 0.98, `${etiqueta}: solo ${ok}/${NOMBRES.length}`);
        }
    });

    // ---------------------------------------------------------------------
    // El fallo que reportó el usuario, medido: "Xaku Prime Neuroptics Blueprint"
    // leído como "Xaku Prime Blueprint". No es que el matcher sea flojo — los DOS
    // existen en el catálogo, así que perder la línea del medio convierte un ítem
    // en otro y el texto solo ya no permite distinguirlos. Hace falta la geometría
    // de la caja (cuántas líneas de tinta hay) para descartarlo.
    // ---------------------------------------------------------------------
    const CON_BP = ["Neuroptics", "Systems", "Chassis", "Harness", "Wings", "Carapace", "Cerebrum"];
    const enPantalla = (k) => (CON_BP.some((c) => k.endsWith(` ${c}`)) ? `${k} Blueprint` : k);

    test("cuántos nombres se convierten en otro ítem si se pierde una línea", () => {
        let multilinea = 0, cruces = 0;
        for (const k of NOMBRES) {
            const palabras = enPantalla(k).toUpperCase().split(" ");
            if (palabras.length < 4) continue;
            multilinea++;
            const leido = leer([...palabras.slice(0, 2), palabras.at(-1)].join(" "));
            if (leido && leido !== k) cruces++;
        }
        // Documenta la magnitud del agujero: hoy son 168 de 224. Si un cambio lo empeora,
        // este número sube y el test lo dice; cuando se arregle, baja y hay que actualizarlo.
        assert.ok(multilinea > 200, `esperaba 200+ nombres multilínea, hay ${multilinea}`);
        assert.ok(cruces <= 168, `los cruces por línea perdida han EMPEORADO: ${cruces} (antes 168)`);
    });

    test("leer el rótulo completo de pantalla sí da la pieza correcta", () => {
        // "XAKU PRIME NEUROPTICS BLUEPRINT" -> Xaku Prime Neuroptics: la regla que hace
        // BLUEPRINT opcional detrás del componente funciona y hay que conservarla.
        for (const k of NOMBRES.filter((n) => CON_BP.some((c) => n.endsWith(` ${c}`))).slice(0, 40)) {
            assert.equal(leer(enPantalla(k).toUpperCase()), k);
        }
    });
});
