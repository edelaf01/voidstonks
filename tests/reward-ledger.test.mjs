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
  assert.equal(ledger.pendingCount, 1);
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

test("una lectura distinta rompe el consenso a medias", () => {
  let l = nextLedger(INITIAL_LEDGER, [pieza("Lex Prime Barrel")]).ledger;
  const r = nextLedger(l, [pieza("Paris Prime String")]);
  assert.equal(r.commit, null);
  assert.equal(r.ledger.pendingCount, 1, "empieza a contar de cero para la lectura nueva");
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
