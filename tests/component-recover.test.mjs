import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { recuperaComponente } from "../deploy/js/utils/inventory/component_recover.js";

// measured on the 646 item catalog: losing a middle word turns 153 of 204 names into ANOTHER part, while one wrong glyph crosses none
const CATALOGO = new Set([
    "Gyre Prime Blueprint", "Gyre Prime Chassis Blueprint", "Gyre Prime Neuroptics Blueprint",
    "Ash Prime Blueprint", "Ash Prime Neuroptics Blueprint",
    "Caliban Prime Blueprint", "Boltor Prime Stock", "Nezha Prime Blueprint",
]);
const existe = (n) => CATALOGO.has(n);
// toy similarity: 1 when equal, tolerates one changed glyph
const sim = (a, b) => {
    if (a === b) return 1;
    if (a.length !== b.length) return 0;
    let d = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
    return d === 1 ? 0.9 : 0;
};

describe("rescatar el componente que el OCR perdió", () => {
    test("un token de componente en la columna corrige el plano pelado", () => {
        assert.equal(recuperaComponente("Gyre Prime Blueprint", ["Gyre", "Bre", "Chassis"], existe, sim),
            "Gyre Prime Chassis Blueprint");
    });

    test("vale con el componente medio garbleado, que es como llega de verdad", () => {
        assert.equal(recuperaComponente("Ash Prime Blueprint", ["Ash", "Neuroptlcs"], existe, sim),
            "Ash Prime Neuroptics Blueprint");
    });

    test("un plano pelado legítimo NO se toca", () => {
        assert.equal(recuperaComponente("Caliban Prime Blueprint", ["Caliban", "Prime", "Blueprint"], existe, sim),
            "Caliban Prime Blueprint");
    });

    test("no inventa una pieza que no está en el catálogo", () => {
        assert.equal(recuperaComponente("Nezha Prime Blueprint", ["Nezha", "Systems"], existe, sim),
            "Nezha Prime Blueprint");
    });

    test("lo que no es un plano se devuelve intacto", () => {
        assert.equal(recuperaComponente("Boltor Prime Stock", ["Boltor", "Chassis"], existe, sim),
            "Boltor Prime Stock");
    });

    test("una palabra ajena no dispara el rescate", () => {
        assert.equal(recuperaComponente("Gyre Prime Blueprint", ["Gyre", "Steel", "Path"], existe, sim),
            "Gyre Prime Blueprint");
    });

    test("entre dos componentes gana el que más se parece", () => {
        assert.equal(recuperaComponente("Gyre Prime Blueprint", ["Neuroptics", "Chassls"], existe, sim),
            "Gyre Prime Neuroptics Blueprint");
    });
});
