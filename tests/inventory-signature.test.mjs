import { test } from "node:test";
import assert from "node:assert/strict";
import { inventorySignature } from "../deploy/js/utils/inventory/inventory_signature.js";

const inv = (n) => Array.from({ length: n }, (_, i) => ({
    name: `Lith ${String.fromCharCode(65 + (i % 26))}${i} Relic`,
    count: (i % 90) + 1,
}));

test("firma: vacío e inexistente no revientan", () => {
    assert.equal(inventorySignature(null), "0");
    assert.equal(inventorySignature([]), "0");
});

test("firma: estable para el mismo contenido", () => {
    assert.equal(inventorySignature(inv(200)), inventorySignature(inv(200)));
});

// Lo único que importa de la firma: si NO cambia, renderInventory se salta el repintado.
// Un cambio no detectado deja la lista mintiendo hasta que algo más fuerce el render.
test("firma: detecta cualquier cambio de cantidad", () => {
    const list = inv(500);
    const base = inventorySignature(list);
    for (let i = 0; i < list.length; i++) {
        const prev = list[i].count;
        list[i].count = prev + 1;
        assert.notEqual(inventorySignature(list), base, `cantidad de la fila ${i} sin detectar`);
        list[i].count = prev;
    }
});

test("firma: detecta cualquier cambio de nombre", () => {
    const list = inv(500);
    const base = inventorySignature(list);
    for (let i = 0; i < list.length; i++) {
        const prev = list[i].name;
        list[i].name = prev + "x";
        assert.notEqual(inventorySignature(list), base, `nombre de la fila ${i} sin detectar`);
        list[i].name = prev;
    }
});

test("firma: detecta altas, bajas y reordenaciones", () => {
    const list = inv(50);
    const base = inventorySignature(list);
    assert.notEqual(inventorySignature([...list, { name: "Axi Z9 Relic", count: 1 }]), base);
    assert.notEqual(inventorySignature(list.slice(0, -1)), base);
    const swapped = [...list];
    [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
    assert.notEqual(inventorySignature(swapped), base, "el orden se ve en la lista, tiene que contar");
});

test("firma: acepta el formato antiguo (array de strings)", () => {
    assert.equal(inventorySignature(["Lith A1 Relic"]), inventorySignature([{ name: "Lith A1 Relic", count: 1 }]));
});
