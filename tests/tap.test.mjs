import { test } from "node:test";
import assert from "node:assert/strict";
import { onTap } from "../deploy/js/utils/tap.js";

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

test("arrastrar más de 10 px es scroll, no selección", () => {
  const el = fakeEl();
  let veces = 0;
  onTap(el, () => veces++);

  el.fire("pointerdown", punto(100, 100));
  el.fire("pointerup", punto(100, 130));
  assert.equal(veces, 0, "un arrastre vertical no debe activar");

  el.fire("pointerdown", punto(100, 100));
  el.fire("pointerup", punto(100, 110));
  assert.equal(veces, 1);
});

test("el click que sigue al toque no activa por segunda vez", () => {
  const el = fakeEl();
  let veces = 0;
  onTap(el, () => veces++);

  el.fire("pointerdown", punto(50, 50));
  el.fire("pointerup", punto(50, 50));
  el.fire("click", punto(50, 50));
  assert.equal(veces, 1, "pointerup + click = una sola activación");
});

test("un click sin toque previo (teclado, .click() programático) sí activa", () => {
  const el = fakeEl();
  let veces = 0;
  onTap(el, () => veces++);

  el.fire("click", punto(0, 0));
  assert.equal(veces, 1);
});

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
