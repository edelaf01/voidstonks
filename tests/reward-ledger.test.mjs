import { test } from "node:test";
import assert from "node:assert/strict";
import { nextLedger, INITIAL_LEDGER, CONSENSUS_FRAMES, esPantallaRecordada, recuerdaPantalla, memoriaPantalla, MEMORIA_PANTALLA_MS, sigueALaVista } from "../deploy/js/utils/inventory/reward_ledger.js";

const pieza = (name, qty = 1) => ({ name, qty });

test("una sola lectura no escribe", () => {
  const { ledger, commit } = nextLedger(INITIAL_LEDGER, [pieza("Lex Prime Barrel")]);
  assert.equal(commit, null);
  assert.equal(ledger.consensus.items["Lex Prime Barrel"].score, 1);
  assert.equal(ledger.consensus.items["Lex Prime Barrel"].confirmed, false);
});

test("dos lecturas iguales escriben una vez", () => {
  const items = [pieza("Lex Prime Barrel")];
  let l = INITIAL_LEDGER, commits = 0;
  for (let i = 0; i < 6; i++) {
    const r = nextLedger(l, items);
    l = r.ledger;
    if (r.commit) commits++;
  }
  assert.equal(commits, 1, "la pantalla sigue ahí muchos frames, pero solo se da de alta una vez");
});

test("una lectura distinta no confirma de inmediato y mantiene consenso por ítem", () => {
  let l = nextLedger(INITIAL_LEDGER, [pieza("Lex Prime Barrel")]).ledger;
  const r = nextLedger(l, [pieza("Paris Prime String")]);
  assert.equal(r.commit, null);
  assert.equal(r.ledger.consensus.items["Paris Prime String"].score, 1);
  assert.equal(r.ledger.consensus.items["Lex Prime Barrel"].score, 0.75);
});

test("una lectura vacía no borra lo ya escrito", () => {
  const items = [pieza("Lex Prime Barrel")];
  let l = INITIAL_LEDGER;
  for (let i = 0; i < CONSENSUS_FRAMES; i++) l = nextLedger(l, items).ledger;
  const escrito = l.committed;

  l = nextLedger(l, []).ledger;
  assert.equal(l.committed, escrito);
  // Y al volver a verla no se repite el alta.
  assert.equal(nextLedger(nextLedger(l, items).ledger, items).commit, null);
});

test("una misión nueva con otras piezas sí escribe otra vez", () => {
  const primera = [pieza("Lex Prime Barrel")];
  const segunda = [pieza("Paris Prime String")];
  let l = INITIAL_LEDGER;
  for (let i = 0; i < CONSENSUS_FRAMES; i++) l = nextLedger(l, primera).ledger;

  let commit = null;
  for (let i = 0; i < CONSENSUS_FRAMES; i++) {
    const r = nextLedger(l, segunda);
    l = r.ledger;
    commit = commit || r.commit;
  }
  assert.deepEqual(commit, segunda);
});

test("desplazar el panel y volver a subir no repite el alta; lo nuevo sí entra", () => {
  // Plague Star llena más de cuatro filas: la fila de arriba sale de la vista al bajar y
  // vuelve al subir. Ninguna de las dos veces es recibirla otra vez.
  const arriba = [pieza("Lex Prime Barrel"), { name: "Lith K2", qty: 1, reliquia: true }];
  const abajo = [{ name: "Lith K2", qty: 1, reliquia: true }, pieza("Paris Prime String")];
  let l = INITIAL_LEDGER;
  const altas = [];
  for (const items of [arriba, arriba, abajo, abajo, arriba, arriba, abajo, abajo]) {
    const r = nextLedger(l, items);
    l = r.ledger;
    if (r.commit) altas.push(r.commit.map((c) => c.name));
  }
  assert.deepEqual(altas, [["Lex Prime Barrel", "Lith K2"], ["Paris Prime String"]]);
});

test("en la misión siguiente la misma pieza vuelve a contar: el libro empieza de cero", () => {
  // El escáner reinicia el libro al soltar el contexto MISSION_COMPLETE; dentro de la misma
  // pantalla, ver la pieza otra vez (tras el ratón, tras desplazar) nunca la repite.
  const misma = [pieza("Lex Prime Barrel")];
  let l = INITIAL_LEDGER;
  for (let i = 0; i < CONSENSUS_FRAMES; i++) l = nextLedger(l, misma).ledger;
  for (let i = 0; i < CONSENSUS_FRAMES; i++) l = nextLedger(l, [pieza("Paris Prime String")]).ledger;
  for (let i = 0; i < CONSENSUS_FRAMES; i++) assert.equal(nextLedger(l, misma).commit, null);

  let commit = null;
  l = INITIAL_LEDGER;
  for (let i = 0; i < CONSENSUS_FRAMES; i++) {
    const r = nextLedger(l, misma);
    l = r.ledger;
    commit = commit || r.commit;
  }
  assert.deepEqual(commit, misma);
});

test("bueno, ruido, bueno: la pieza acaba dándose de alta", () => {
  const items = [pieza("Lex Prime Barrel", 1)];
  const r1 = nextLedger(INITIAL_LEDGER, items);
  assert.equal(r1.commit, null);

  const r2 = nextLedger(r1.ledger, []);
  assert.equal(r2.commit, null);

  const r3 = nextLedger(r2.ledger, items);
  assert.deepEqual(r3.commit, items);
});

test("una pieza que se lee con qty distinta en frames distintos entra con la qty mayoritaria", () => {
  let l = INITIAL_LEDGER;
  const r1 = nextLedger(l, [pieza("Forma Blueprint", 1)]);
  assert.equal(r1.commit, null);

  const r2 = nextLedger(r1.ledger, [pieza("Forma Blueprint", 3)]);
  assert.deepEqual(r2.commit, [pieza("Forma Blueprint", 3)]);
});

test("tras el alta, seguir viendo la misma pantalla no vuelve a dar de alta nada", () => {
  const pantalla = [pieza("Lex Prime Barrel", 1), pieza("Paris Prime String", 1)];
  let l = INITIAL_LEDGER;
  l = nextLedger(l, pantalla).ledger;
  const r2 = nextLedger(l, pantalla);
  assert.deepEqual(r2.commit, pantalla);
  l = r2.ledger;

  for (let i = 0; i < 8; i++) {
    const r = nextLedger(l, pantalla);
    l = r.ledger;
    assert.equal(r.commit, null, `frame ${i + 3} no debe dar de alta duplicados`);
  }
});

test("un ítem visto una sola vez no se da de alta nunca", () => {
  let l = nextLedger(INITIAL_LEDGER, [pieza("Braton Prime Stock")]).ledger;
  for (let i = 0; i < 20; i++) {
    const r = nextLedger(l, []);
    l = r.ledger;
    assert.equal(r.commit, null);
  }
});

test("un ítem que aparece de vez en cuando a lo largo de muchos frames no se acumula hasta colarse", () => {
  let l = INITIAL_LEDGER;
  let commits = 0;
  for (let frame = 0; frame < 20; frame++) {
    const items = frame % 5 === 0 ? [pieza("Orthos Prime Handle", 1)] : [];
    const r = nextLedger(l, items);
    l = r.ledger;
    if (r.commit) commits++;
  }
  assert.equal(commits, 0);
});

test("múltiples ítems en la misma pantalla se dan de alta independientemente si uno sufre ruido", () => {
  let l = nextLedger(INITIAL_LEDGER, [pieza("Lex Prime Barrel"), pieza("Paris Prime String")]).ledger;

  // Frame 2: Paris se pierde por ruido de OCR -> Lex confirma
  const r2 = nextLedger(l, [pieza("Lex Prime Barrel")]);
  assert.deepEqual(r2.commit, [pieza("Lex Prime Barrel")]);
  l = r2.ledger;

  // Frame 3: ambos se leen -> Paris confirma sin duplicar Lex
  const r3 = nextLedger(l, [pieza("Lex Prime Barrel"), pieza("Paris Prime String")]);
  assert.deepEqual(r3.commit, [pieza("Paris Prime String")]);
    test("la misma pantalla tras un hueco largo sin lectura NO se da de alta dos veces", () => {
        // El consenso poda un ítem cuando su puntuación cae por debajo de 0.05, y 20 frames sin
        // lectura la dejan en 0.003. Sin la guarda de `committed`, la misma recompensa volvía a
        // acumular desde cero y entraba DOS veces en el inventario.
        const pieza = [{ name: "Lex Prime Barrel", qty: 1 }];
        let st = INITIAL_LEDGER;
        const altas = [];
        const frames = [pieza, pieza, ...Array.from({ length: 20 }, () => []),
            ...Array.from({ length: 20 }, () => pieza)];
        for (const items of frames) {
            const { ledger, commit } = nextLedger(st, items);
            st = ledger;
            if (commit?.length) altas.push(commit.map((c) => c.name));
        }
        assert.deepEqual(altas, [["Lex Prime Barrel"]]);
    });

});

test("una reliquia llega al alta marcada como reliquia, no como pieza", () => {
  // Visto en vivo (Plague Star): "Lith K2" leída en MISSION COMPLETE salía confirmada sin la
  // marca, el alta la trataba como pieza prime y el inventario de reliquias no se movía.
  const items = [{ name: "Lith K2", qty: 2, reliquia: true }, pieza("Paris Prime Grip")];
  const r1 = nextLedger(INITIAL_LEDGER, items);
  const r2 = nextLedger(r1.ledger, items);
  assert.deepEqual(r2.commit, [{ name: "Lith K2", qty: 2, reliquia: true }, pieza("Paris Prime Grip")]);
  // Y sobrevive al frame en que la reliquia no se lee (la marca vive en la entrada, no en la lectura).
  const r3 = nextLedger(INITIAL_LEDGER, items);
  const r4 = nextLedger(r3.ledger, [pieza("Paris Prime Grip")]);
  const r5 = nextLedger(r4.ledger, items);
  assert.deepEqual(r5.commit.find((c) => c.name === "Lith K2"), { name: "Lith K2", qty: 2, reliquia: true });
});

// Al perder el contexto (tooltip, pausa, recarga) el ledger se reiniciaba y la MISMA pantalla
// de fin de misión volvía a sumar: visto en vivo con las piezas duplicadas en el inventario.
test("la última pantalla dada de alta se recuerda y no vuelve a sumar", () => {
  const items = [pieza("Orthos Prime Blueprint"), pieza("Burston Prime Receiver"), pieza("Caliban Prime Chassis Blueprint")];
  let l = INITIAL_LEDGER, commit = null;
  for (let i = 0; i < CONSENSUS_FRAMES; i++) ({ ledger: l, commit } = nextLedger(l, items));
  assert.equal(commit.length, 3);
  const memoria = recuerdaPantalla(items, l, 1000);

  // Contexto perdido: ledger nuevo, pero la pantalla es la misma.
  assert.equal(esPantallaRecordada(items, memoria, 2000), true);
  let l2 = { ...INITIAL_LEDGER, committed: memoria.committed }, commits = 0;
  for (let i = 0; i < 6; i++) { const r = nextLedger(l2, items); l2 = r.ledger; if (r.commit) commits++; }
  assert.equal(commits, 0);

  // Le falta UNA casilla por leer: sigue siendo la misma pantalla.
  assert.equal(esPantallaRecordada(items.slice(0, 2), memoria, 2000), true);
  // Le faltan dos, o el orden es otro, o hace rato que no se ve: misión nueva.
  assert.equal(esPantallaRecordada(items.slice(0, 1), memoria, 2000), false);
  assert.equal(esPantallaRecordada([items[1], items[0], items[2]], memoria, 2000), false);
  assert.equal(esPantallaRecordada(items, memoria, 1000 + MEMORIA_PANTALLA_MS), false);
  // Otra misión con la misma pieza y una nueva: cuenta.
  assert.equal(esPantallaRecordada([items[0], pieza("Lex Prime Barrel")], memoria, 2000), false);
  assert.equal(esPantallaRecordada([], memoria, 2000), false);
  assert.equal(esPantallaRecordada(items, null, 2000), false);
  // La cantidad forma parte de la huella: ×2 de una pieza no es la misma pantalla.
  assert.equal(esPantallaRecordada([pieza("Orthos Prime Blueprint", 2), items[1], items[2]], memoria, 2000), false);
});

// Farmeando, la misma reliquia sale en dos misiones seguidas: con una hora desde el alta, la
// segunda se tomaba por la misma pantalla y no sumaba.
test("la ventana cuenta desde la última vez que se vio la pantalla, no desde el alta", () => {
  const memoria = recuerdaPantalla([pieza("Lith C1 Relic")], { committed: { "Lith C1 Relic": 1 } }, 0);
  assert.equal(sigueALaVista(memoria, 1000), null, "recién escrita: no hace falta reescribir");
  const vista = sigueALaVista(memoria, 60_000);
  assert.equal(vista.t, 60_000);
  assert.deepEqual(vista.huella, memoria.huella);
  assert.equal(esPantallaRecordada([pieza("Lith C1 Relic")], vista, 60_000 + MEMORIA_PANTALLA_MS - 1), true, "tooltip o recarga");
  assert.equal(esPantallaRecordada([pieza("Lith C1 Relic")], vista, 60_000 + MEMORIA_PANTALLA_MS), false, "misión siguiente");
  assert.ok(MEMORIA_PANTALLA_MS <= 2 * 60_000, "una misión no dura menos que la ventana");
  assert.equal(sigueALaVista(null, 60_000), null);
});

test("la memoria persiste en el almacén y sobrevive a que falle", () => {
  const almacen = new Map();
  const storage = () => ({ getItem: (k) => almacen.get(k) ?? null, setItem: (k, v) => almacen.set(k, v) });
  const m = memoriaPantalla(storage, "clave");
  assert.equal(m.lee(), null);
  m.guarda({ huella: ["a×1"], committed: { a: true }, t: 5 });
  assert.deepEqual(JSON.parse(almacen.get("clave")), { huella: ["a×1"], committed: { a: true }, t: 5 });
  assert.deepEqual(memoriaPantalla(storage, "clave").lee(), { huella: ["a×1"], committed: { a: true }, t: 5 }, "otra sesión la recupera");

  const roto = memoriaPantalla(() => { throw new Error("privado"); }, "clave");
  assert.equal(roto.lee(), null);
  roto.guarda({ huella: ["b×1"], committed: {}, t: 1 });
  assert.deepEqual(roto.lee().huella, ["b×1"], "sin almacén se queda en la sesión");
});
