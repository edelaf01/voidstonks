import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { applyRewardCommit, undoRewardCommit } from "../deploy/js/utils/inventory/reward_commit.js";

// ===========================================================================
// Alta automática de recompensas en el inventario de piezas Prime.
//
// Es una SUMA sobre lo que el usuario ya tenía, así que un fallo aquí no se ve: el número
// queda inflado y no hay con qué compararlo. Se barren tandas inventadas —cantidades > 1,
// la misma pieza repetida, piezas ya apuntadas a mano al elegir la recompensa— sin escáner.
// ===========================================================================

describe("alta de recompensas", () => {
    test("una pieza nueva entra con su cantidad", () => {
        const { inventario, anadidas } = applyRewardCommit({}, [{ name: "Xaku Prime Neuroptics" }]);
        assert.equal(inventario["Xaku Prime Neuroptics"], 1);
        assert.deepEqual(anadidas, ["Xaku Prime Neuroptics"]);
    });

    test("se SUMA a lo que ya había, no lo reemplaza", () => {
        const { inventario } = applyRewardCommit({ "Ash Prime Systems": 2 }, [{ name: "Ash Prime Systems" }]);
        assert.equal(inventario["Ash Prime Systems"], 3);
    });

    test("una cantidad mayor que uno se suma entera y se anuncia con ×N", () => {
        const { inventario, anadidas } = applyRewardCommit({}, [{ name: "Forma Blueprint", qty: 3 }]);
        assert.equal(inventario["Forma Blueprint"], 3);
        assert.deepEqual(anadidas, ["Forma Blueprint ×3"]);
    });

    test("no muta el inventario que se le pasa", () => {
        const antes = { "Ash Prime Systems": 2 };
        applyRewardCommit(antes, [{ name: "Ash Prime Systems" }]);
        assert.equal(antes["Ash Prime Systems"], 2, "el original tiene que quedar intacto");
    });

    test("una pieza ya apuntada a mano NO se suma otra vez", () => {
        // El usuario la eligió en la pantalla de recompensa y el resumen se la enseña de nuevo.
        const { inventario, anadidas, pendientes } = applyRewardCommit(
            { "Corvas Prime Receiver": 10 },
            [{ name: "Corvas Prime Receiver" }],
            ["Corvas Prime Receiver"],
        );
        assert.equal(inventario["Corvas Prime Receiver"], 10, "no puede subir a 11");
        assert.deepEqual(anadidas, []);
        assert.deepEqual(pendientes, [], "el apunte se consume");
    });

    test("un apunte a mano solo tapa UNA copia, no todas", () => {
        const { inventario } = applyRewardCommit({}, [
            { name: "Fang Prime Blade" }, { name: "Fang Prime Blade" },
        ], ["Fang Prime Blade"]);
        assert.equal(inventario["Fang Prime Blade"], 1, "la segunda copia sí entra");
    });

    test("el apunte a mano descuenta UNA copia del ×N, no la entrada entera", () => {
        // Misma pieza que dos compañeros de escuadra: el resumen la enseña con ×3 y el
        // usuario ya se apuntó la suya. Saltarse la entrada perdía las otras dos.
        const { inventario, anadidas } = applyRewardCommit(
            { "Fang Prime Blade": 10 },
            [{ name: "Fang Prime Blade", qty: 3 }],
            ["Fang Prime Blade"],
        );
        assert.equal(inventario["Fang Prime Blade"], 12);
        assert.deepEqual(anadidas, ["Fang Prime Blade ×2"]);
    });

    test("una cantidad que no describe piezas recibidas se ignora entera", () => {
        // readRewardQty acota el badge a 1..20; lo que llegue fuera de ahí es un fallo de
        // lectura, y escribirlo deja el contador corrupto (NaN se guarda como null).
        for (const qty of [0, -2, Number.NaN, "dos"]) {
            const { inventario, anadidas } = applyRewardCommit({ "Lex Prime Receiver": 13 },
                [{ name: "Lex Prime Receiver", qty }]);
            assert.deepEqual(inventario, { "Lex Prime Receiver": 13 }, `qty ${String(qty)}`);
            assert.deepEqual(anadidas, [], `qty ${String(qty)} no puede anunciarse`);
        }
    });

    test("una pieza nueva con cantidad inválida no deja la clave a cero", () => {
        // Un 0 crea una fila en el inventario ("mostrar vacías") de algo que nunca llegó.
        const { inventario } = applyRewardCommit({}, [{ name: "Soma Prime Barrel", qty: 0 }]);
        assert.deepEqual(inventario, {});
    });

    test("un contador guardado como texto se suma como número", () => {
        // El import de JSON no valida nada: con "5" guardado, "5"+1 daba "51".
        const { inventario } = applyRewardCommit({ "Braton Prime Stock": "5" },
            [{ name: "Braton Prime Stock" }]);
        assert.equal(inventario["Braton Prime Stock"], 6);
    });

    test("los apuntes de otras piezas sobreviven a la tanda", () => {
        const { pendientes } = applyRewardCommit({}, [{ name: "Ash Prime Chassis" }],
            ["Ash Prime Chassis", "Volt Prime Systems"]);
        assert.deepEqual(pendientes, ["Volt Prime Systems"]);
    });

    test("la misma pieza dos veces en la tanda suma dos veces", () => {
        // Dos jugadores del escuadrón con la misma recompensa: son dos piezas de verdad.
        const { inventario } = applyRewardCommit({}, [
            { name: "Braton Prime Stock" }, { name: "Braton Prime Stock" },
        ]);
        assert.equal(inventario["Braton Prime Stock"], 2);
    });

    test("una tanda vacía o con entradas sin nombre no toca nada", () => {
        assert.deepEqual(applyRewardCommit({ a: 1 }, []).inventario, { a: 1 });
        assert.deepEqual(applyRewardCommit({ a: 1 }, [{ qty: 2 }]).inventario, { a: 1 });
        assert.deepEqual(applyRewardCommit({ a: 1 }, null).inventario, { a: 1 });
    });
});

describe("deshacer", () => {
    test("devuelve las cantidades exactas que había", () => {
        const inicial = { "Ash Prime Systems": 2, "Volt Prime Chassis": 1 };
        const { inventario, previo } = applyRewardCommit(inicial, [
            { name: "Ash Prime Systems", qty: 2 }, { name: "Volt Prime Chassis" },
        ]);
        assert.equal(inventario["Ash Prime Systems"], 4);
        assert.deepEqual(undoRewardCommit(inventario, previo), inicial);
    });

    test("una pieza que NO existía se borra, no se queda a cero", () => {
        // Un 0 la dejaría en la lista de piezas, que es justo lo que el usuario no tenía.
        const { inventario, previo } = applyRewardCommit({}, [{ name: "Nikana Prime Blade" }]);
        const vuelta = undoRewardCommit(inventario, previo);
        assert.equal("Nikana Prime Blade" in vuelta, false);
    });

    test("una pieza que estaba a CERO vuelve a cero, no desaparece", () => {
        // El inventario real trae piezas a 0 (el usuario las ve con "mostrar vacías" y son
        // las que le faltan del set). Borrar la clave al deshacer se lleva esa fila.
        const inicial = { "Garuda Prime Blueprint": 0 };
        const { inventario, previo } = applyRewardCommit(inicial, [{ name: "Garuda Prime Blueprint" }]);
        assert.equal(inventario["Garuda Prime Blueprint"], 1);
        assert.deepEqual(undoRewardCommit(inventario, previo), inicial);
    });

    test("deshacer dos veces deja lo mismo que deshacer una", () => {
        // El botón del aviso sigue ahí después de pulsarlo: la segunda pulsación no puede
        // restar otra vez.
        const inicial = { "Astilla Prime Stock": 7 };
        const { inventario, previo } = applyRewardCommit(inicial, [{ name: "Astilla Prime Stock", qty: 2 }]);
        const una = undoRewardCommit(inventario, previo);
        assert.deepEqual(undoRewardCommit(una, previo), inicial);
    });

    test("deshacer no arrastra lo que se añadió por otra vía entre medias", () => {
        const { inventario, previo } = applyRewardCommit({ "Soma Prime Barrel": 1 }, [{ name: "Soma Prime Barrel" }]);
        const conMano = { ...inventario, "Otra Prime Pieza": 5 };   // el usuario añade otra cosa
        const vuelta = undoRewardCommit(conMano, previo);
        assert.equal(vuelta["Soma Prime Barrel"], 1);
        assert.equal(vuelta["Otra Prime Pieza"], 5, "lo ajeno al alta no se toca");
    });
});
