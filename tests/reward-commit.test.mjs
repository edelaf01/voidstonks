import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { applyRewardCommit, undoRewardCommit, pickManualReward, aplicaTradeo } from "../deploy/js/utils/inventory/reward_commit.js";

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
        const { inventario, anadidas } = applyRewardCommit(
            { "Fang Prime Blade": 10 },
            [{ name: "Fang Prime Blade", qty: 3 }],
            ["Fang Prime Blade"],
        );
        assert.equal(inventario["Fang Prime Blade"], 12);
        assert.deepEqual(anadidas, ["Fang Prime Blade ×2"]);
    });

    test("una cantidad que no describe piezas recibidas se ignora entera", () => {
        for (const qty of [0, -2, Number.NaN, "dos"]) {
            const { inventario, anadidas } = applyRewardCommit({ "Lex Prime Receiver": 13 },
                [{ name: "Lex Prime Receiver", qty }]);
            assert.deepEqual(inventario, { "Lex Prime Receiver": 13 }, `qty ${String(qty)}`);
            assert.deepEqual(anadidas, [], `qty ${String(qty)} no puede anunciarse`);
        }
    });

    test("una pieza nueva con cantidad inválida no deja la clave a cero", () => {
        const { inventario } = applyRewardCommit({}, [{ name: "Soma Prime Barrel", qty: 0 }]);
        assert.deepEqual(inventario, {});
    });

    test("un contador guardado como texto se suma como número", () => {
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
        const { inventario, previo } = applyRewardCommit({}, [{ name: "Nikana Prime Blade" }]);
        const vuelta = undoRewardCommit(inventario, previo);
        assert.equal("Nikana Prime Blade" in vuelta, false);
    });

    test("una pieza que estaba a CERO vuelve a cero, no desaparece", () => {
        // real inventories include 0-count parts: deleting the key on undo removes that row
        const inicial = { "Garuda Prime Blueprint": 0 };
        const { inventario, previo } = applyRewardCommit(inicial, [{ name: "Garuda Prime Blueprint" }]);
        assert.equal(inventario["Garuda Prime Blueprint"], 1);
        assert.deepEqual(undoRewardCommit(inventario, previo), inicial);
    });

    test("deshacer dos veces deja lo mismo que deshacer una", () => {
        const inicial = { "Astilla Prime Stock": 7 };
        const { inventario, previo } = applyRewardCommit(inicial, [{ name: "Astilla Prime Stock", qty: 2 }]);
        const una = undoRewardCommit(inventario, previo);
        assert.deepEqual(undoRewardCommit(una, previo), inicial);
    });

    test("deshacer no arrastra lo que se añadió por otra vía entre medias", () => {
        const { inventario, previo } = applyRewardCommit({ "Soma Prime Barrel": 1 }, [{ name: "Soma Prime Barrel" }]);
        const conMano = { ...inventario, "Otra Prime Pieza": 5 };
        const vuelta = undoRewardCommit(conMano, previo);
        assert.equal(vuelta["Soma Prime Barrel"], 1);
        assert.equal(vuelta["Otra Prime Pieza"], 5, "lo ajeno al alta no se toca");
    });
});

describe("cambiar de idea en la pantalla de recompensas", () => {
  test("reelegir sustituye: la descartada no se queda en el inventario", () => {
    const a = pickManualReward({}, [], null, "Volt Prime Systems Blueprint");
    assert.deepEqual(a.inventario, { "Volt Prime Systems Blueprint": 1 });
    assert.deepEqual(a.pendientes, ["Volt Prime Systems Blueprint"]);

    const b = pickManualReward(a.inventario, a.pendientes,
      "Volt Prime Systems Blueprint", "Ash Prime Chassis Blueprint");
    assert.deepEqual(b.inventario, { "Volt Prime Systems Blueprint": 0, "Ash Prime Chassis Blueprint": 1 });
    assert.deepEqual(b.pendientes, ["Ash Prime Chassis Blueprint"],
      "la descartada seguía pendiente y el alta de fin de misión le descontaba una copia");
  });

  test("volver a pulsar la MISMA no suma otra", () => {
    const r = pickManualReward({ "Ash Prime Chassis Blueprint": 1 }, ["Ash Prime Chassis Blueprint"],
      "Ash Prime Chassis Blueprint", "Ash Prime Chassis Blueprint");
    assert.equal(r.cambio, false);
    assert.deepEqual(r.inventario, { "Ash Prime Chassis Blueprint": 1 });
  });

  test("con sincronización al cerrar no se toca el inventario, solo la cola", () => {
    const r = pickManualReward({}, ["Volt Prime Systems Blueprint"],
      "Volt Prime Systems Blueprint", "Ash Prime Chassis Blueprint", false);
    assert.deepEqual(r.inventario, {}, "restó una pieza que aún no se había sumado");
    assert.deepEqual(r.pendientes, ["Ash Prime Chassis Blueprint"]);
  });

  test("tras sustituir, el alta de fin de misión no duplica ni se come la pieza", () => {
    const { inventario, pendientes } = pickManualReward({}, [], "Volt Prime Systems Blueprint",
      "Ash Prime Chassis Blueprint");
    const r = applyRewardCommit(inventario, [{ name: "Ash Prime Chassis Blueprint", qty: 1 }], pendientes);
    assert.equal(r.inventario["Ash Prime Chassis Blueprint"], 1);
    assert.deepEqual(r.anadidas, []);
  });
});

describe("trade cerrado", () => {
    const mesa = {
        doy: [{ tipo: "prime", name: "Khora Prime Chassis Blueprint", qty: 1 }, { tipo: "arcano", name: "Arcane Velocity", qty: 1 }],
        recibo: [{ tipo: "prime", name: "Braton Prime Barrel", qty: 2 }, { tipo: "platino", name: "Platinum", qty: 80 }],
    };

    test("lo que das se resta, lo que recibes se suma, y arcanos y platino no tocan el inventario de piezas", () => {
        const { inventario, movidas } = aplicaTradeo({ "Khora Prime Chassis Blueprint": 2, "Braton Prime Barrel": 1 }, mesa);
        assert.deepEqual(inventario, { "Khora Prime Chassis Blueprint": 1, "Braton Prime Barrel": 3 });
        assert.deepEqual(movidas, ["−Khora Prime Chassis Blueprint", "+Braton Prime Barrel ×2"]);
    });

    test("dar una pieza que no tenías apuntada no deja negativos ni la inventa", () => {
        const { inventario, movidas } = aplicaTradeo({}, { doy: mesa.doy });
        assert.deepEqual(inventario, {});
        assert.deepEqual(movidas, []);
    });

    test("deshacer deja el inventario como estaba, también las claves que no existían", () => {
        const antes = { "Khora Prime Chassis Blueprint": 1 };
        const { inventario, previo } = aplicaTradeo(antes, mesa);
        assert.deepEqual(undoRewardCommit(inventario, previo), antes);
    });
});
