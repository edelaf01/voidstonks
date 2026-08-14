// onTap: activación por toque de elementos que no son <button> ni <a>.
//
// Nace de un fallo real: en móvil el `click` sobre un <div> se pierde porque el navegador
// consume el primer toque para el :hover pegajoso o para cerrar el teclado, y había que tocar
// dos veces. Pasó en el autocompletado de armas y en los desplegables de stats del tasador.
//
// Las tres reglas de abajo son las que arreglan eso, y ninguna se ve al leer el código de
// quien llama a onTap: si alguien "simplifica" el listener de click o toca las constantes, el
// bug vuelve solo en un móvil de verdad, que es donde nadie prueba.

import { test } from "node:test";
import assert from "node:assert/strict";
import { onTap } from "../deploy/js/utils/tap.js";

/** Elemento mínimo: guarda los listeners y deja dispararlos a mano. */
function fakeEl() {
  const handlers = {};
  return {
    addEventListener(type, fn) {
      (handlers[type] ||= []).push(fn);
    },
    fire(type, ev = {}) {
      for (const fn of handlers[type] || []) fn(ev);
    },
  };
}

const punto = (x, y) => ({ clientX: x, clientY: y, preventDefault() { this.prevented = true; } });

test("un toque limpio activa una sola vez", () => {
  const el = fakeEl();
  let veces = 0;
  onTap(el, () => veces++);

  el.fire("pointerdown", punto(100, 100));
  el.fire("pointerup", punto(102, 101));
  assert.equal(veces, 1);
});

// Si el dedo se movió, el usuario estaba haciendo scroll de la lista: activar ahí selecciona
// una opción que el usuario solo estaba pasando por encima.
test("arrastrar más de 10 px es scroll, no selección", () => {
  const el = fakeEl();
  let veces = 0;
  onTap(el, () => veces++);

  el.fire("pointerdown", punto(100, 100));
  el.fire("pointerup", punto(100, 130));
  assert.equal(veces, 0, "un arrastre vertical no debe activar");

  // Justo en el límite (10 px) todavía cuenta como toque.
  el.fire("pointerdown", punto(100, 100));
  el.fire("pointerup", punto(100, 110));
  assert.equal(veces, 1);
});

// El navegador emite `click` DESPUÉS del pointerup: sin la deduplicación, cada toque en móvil
// activaría dos veces (y en un desplegable eso selecciona y vuelve a abrir).
test("el click que sigue al toque no activa por segunda vez", () => {
  const el = fakeEl();
  let veces = 0;
  onTap(el, () => veces++);

  el.fire("pointerdown", punto(50, 50));
  el.fire("pointerup", punto(50, 50));
  el.fire("click", punto(50, 50));
  assert.equal(veces, 1, "pointerup + click = una sola activación");
});

// Esta es la razón de que el listener de `click` siga existiendo pese a la deduplicación: el
// teclado activa la opción con `.click()` programático, que NO emite eventos de puntero.
// Quitarlo "porque ya está pointerup" deja la app inutilizable con teclado.
test("un click sin toque previo (teclado, .click() programático) sí activa", () => {
  const el = fakeEl();
  let veces = 0;
  onTap(el, () => veces++);

  el.fire("click", punto(0, 0));
  assert.equal(veces, 1);
});

// preventDown lo piden los desplegables de stats: sin él, el pointerdown mueve el foco y el
// input de búsqueda se cierra antes de que llegue la selección.
test("preventDown corta el foco/blur del pointerdown, y por defecto no", () => {
  const conOpt = fakeEl();
  onTap(conOpt, () => {}, { preventDown: true });
  const ev1 = punto(10, 10);
  conOpt.fire("pointerdown", ev1);
  assert.equal(ev1.prevented, true);

  const sinOpt = fakeEl();
  onTap(sinOpt, () => {});
  const ev2 = punto(10, 10);
  sinOpt.fire("pointerdown", ev2);
  assert.notEqual(ev2.prevented, true);
});

test("el handler recibe el evento que lo activó", () => {
  const el = fakeEl();
  let recibido = null;
  onTap(el, (e) => { recibido = e; });

  const ev = punto(7, 9);
  el.fire("pointerdown", punto(7, 9));
  el.fire("pointerup", ev);
  assert.equal(recibido, ev);
});
