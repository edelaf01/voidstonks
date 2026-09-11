import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hasComponentSiblings } from "../deploy/js/utils/inventory/component_siblings.js";

const idx = (nombres) => nombres.map((n) => {
    const words = n.toUpperCase().split(" ").filter((w) => w !== "PRIME");
    return { originalName: n, firstWord: words[0], searchWords: words };
});

describe("hermanos de componente", () => {
    test("el plano del warframe con componentes hermanos: hay que mirar la tinta", () => {
        const items = idx(["Xaku Prime Blueprint", "Xaku Prime Neuroptics", "Xaku Prime Chassis"]);
        assert.equal(hasComponentSiblings(items, "Xaku Prime Blueprint"), true);
    });

    test("un plano de ARMA no tiene ese riesgo: sus partes no llevan Blueprint detrás", () => {
        const items = idx(["Braton Prime Blueprint", "Braton Prime Barrel", "Braton Prime Receiver"]);
        assert.equal(hasComponentSiblings(items, "Braton Prime Blueprint"), false);
    });

    test("un componente no es un plano: no aplica", () => {
        const items = idx(["Xaku Prime Blueprint", "Xaku Prime Neuroptics"]);
        assert.equal(hasComponentSiblings(items, "Xaku Prime Neuroptics"), false);
    });

    test("un nombre que no está en el índice no rompe", () => {
        assert.equal(hasComponentSiblings(idx(["Ash Prime Blueprint"]), "Nombre Inventado"), false);
    });

    test("un componente ya nombrado no es ambiguo: no le falta ninguna línea", () => {
        const items = idx(["Ash Prime Blueprint", "Ash Prime Chassis Blueprint"]);
        assert.equal(hasComponentSiblings(items, "Ash Prime Chassis Blueprint"), false);
    });

    test("sobre el catálogo real, marca los planos de warframe y solo esos", () => {
        const entidades = JSON.parse(readFileSync(new URL("../deploy/assets/json/cleaned_entities.json", import.meta.url), "utf8"));
        const nombres = [];
        for (const e of entidades) {
            if (!/\bPrime\b/i.test(e.name)) continue;
            for (const c of e.components || []) nombres.push(`${e.name} ${c.name}`);
        }
        const items = idx(nombres);
        const marcados = nombres.filter((n) => hasComponentSiblings(items, n));
        assert.ok(marcados.length > 30, `esperaba decenas de planos de warframe, hay ${marcados.length}`);
        assert.ok(marcados.every((n) => n.endsWith("Blueprint")), "se ha marcado algo que no es un plano");
    });
});

describe("hermanos de componente con los nombres que corren en la app", () => {
    const items = idx([
        "Ash Prime Blueprint", "Ash Prime Chassis Blueprint",
        "Ash Prime Neuroptics Blueprint", "Ash Prime Systems Blueprint",
        "Braton Prime Blueprint", "Braton Prime Barrel", "Braton Prime Receiver",
        "Odonata Prime Blueprint", "Odonata Prime Harness Blueprint",
    ]);

    test("el plano pelado del warframe se marca aunque el componente lleve Blueprint detrás", () => {
        assert.equal(hasComponentSiblings(items, "Ash Prime Blueprint"), true);
    });

    test("el arcoala también: Harness es un componente, no una parte de arma", () => {
        assert.equal(hasComponentSiblings(items, "Odonata Prime Blueprint"), true);
    });

    test("el plano del arma sigue sin marcarse", () => {
        assert.equal(hasComponentSiblings(items, "Braton Prime Blueprint"), false);
    });

    test("el componente entero no se marca: ya trae la línea que se podría perder", () => {
        assert.equal(hasComponentSiblings(items, "Ash Prime Systems Blueprint"), false);
    });
});
