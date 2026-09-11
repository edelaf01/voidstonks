import { test } from "node:test";
import assert from "node:assert/strict";
import { nextLedger, readingSignature, INITIAL_LEDGER, CONSENSUS_FRAMES } from "../deploy/js/utils/inventory/reward_ledger.js";

const pieza = (name, qty = 1) => ({ name, qty });

test("la firma no depende del orden de las celdas", () => {
  const a = [pieza("Revenant Prime Neuroptics Blueprint"), pieza("Lex Prime Barrel")];
  assert.equal(readingSignature(a), readingSignature([...a].reverse()));
});

test("la firma sí depende de la cantidad", () => {
  assert.notEqual(readingSignature([pieza("Lex Prime Barrel", 1)]),
                  readingSignature([pieza("Lex Prime Barrel", 2)]));
});

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

test("dos misiones con la MISMA pieza vuelven a escribir si hubo otra pantalla entre medias", () => {
  const misma = [pieza("Lex Prime Barrel")];
  let l = INITIAL_LEDGER;
  for (let i = 0; i < CONSENSUS_FRAMES; i++) l = nextLedger(l, misma).ledger;

  // Entre partida y partida el escáner ve otras pantallas; aquí llega otra lectura distinta.
  for (let i = 0; i < CONSENSUS_FRAMES; i++) l = nextLedger(l, [pieza("Paris Prime String")]).ledger;

  let commit = null;
  for (let i = 0; i < CONSENSUS_FRAMES; i++) {
    const r = nextLedger(l, misma);
    l = r.ledger;
    commit = commit || r.commit;
  }
  assert.deepEqual(commit, misma, "la misma pieza en otra misión no es un duplicado");
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
