import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { recuperaComponente } from "../deploy/js/utils/inventory/component_recover.js";

// Medido sobre el catálogo de 646 ítems: al perder una palabra intermedia, 153 de 204 nombres
// se convierten en OTRA pieza y ninguno sobrevive — siempre hacia el plano principal, que suele
// ser el más caro. Un glifo mal, en cambio, no cruza ninguna pieza (0 de 4404).
const CATALOGO = new Set([
    "Gyre Prime Blueprint", "Gyre Prime Chassis Blueprint", "Gyre Prime Neuroptics Blueprint",
    "Ash Prime Blueprint", "Ash Prime Neuroptics Blueprint",
    "Caliban Prime Blueprint", "Boltor Prime Stock", "Nezha Prime Blueprint",
]);
const existe = (n) => CATALOGO.has(n);
// Similitud de juguete: 1 si son iguales, y tolera un glifo cambiado.
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
        // "Caliban Prime Blueprint" existe y no hay ningún componente en su columna.
        assert.equal(recuperaComponente("Caliban Prime Blueprint", ["Caliban", "Prime", "Blueprint"], existe, sim),
            "Caliban Prime Blueprint");
    });

    test("no inventa una pieza que no está en el catálogo", () => {
        // "Nezha Prime Systems Blueprint" no está en este catálogo aunque haya un "Systems".
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
