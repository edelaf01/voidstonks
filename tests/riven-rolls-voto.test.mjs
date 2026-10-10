import { test } from "node:test";
import assert from "node:assert/strict";

const { creaVotoRolls } = await import("../deploy/js/utils/rivens/riven_rolls_voto.js");

const carta = (rolls, arma = "Furis") => ({ weaponName: arma, rolls });
const ciclos = (salida) => salida.map((c) => c?.rolls ?? null);

test("la lectura que más se repite entre las dos cartas gana", () => {
  const voto = creaVotoRolls();
  voto([carta(15), carta(15)]);
  assert.deepEqual(ciclos(voto([carta(5), carta(15)])), [15, 15]);
});

test("una carta sin ciclos leídos toma el valor votado", () => {
  const voto = creaVotoRolls();
  voto([carta(15), carta(15)]);
  assert.deepEqual(ciclos(voto([carta(null), carta(null)])), [15, 15]);
});

test("en empate se queda lo que ya enseñaba cada carta", () => {
  const voto = creaVotoRolls();
  voto([carta(15), carta(null)]);
  assert.deepEqual(ciclos(voto([carta(5), carta(null)])), [15, 15]);
});

test("cada arma vota por separado", () => {
  const voto = creaVotoRolls();
  voto([carta(15, "Furis"), carta(3, "Torid")]);
  assert.deepEqual(ciclos(voto([carta(15, "Furis"), carta(3, "Torid")])), [15, 3]);
});

test("con lecturas nuevas suficientes el valor cambia", () => {
  const voto = creaVotoRolls(6);
  voto([carta(15), carta(15)]);
  voto([carta(16), carta(16)]);
  assert.deepEqual(ciclos(voto([carta(16), carta(16)])), [16, 16]);
});

test("un hueco o una carta sin arma pasan sin tocar", () => {
  const voto = creaVotoRolls();
  const sinArma = { rolls: 7 };
  const salida = voto([null, sinArma]);
  assert.equal(salida[0], null);
  assert.equal(salida[1], sinArma);
});
