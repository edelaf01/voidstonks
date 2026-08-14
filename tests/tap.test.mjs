// onTap: touch activation for non-button non-link elements
// on mobile, click on a <div> is lost when the first tap is consumed by sticky :hover or keyboard
// dismissal (weapon autocomplete, stat dropdowns)
// the rules below prevent regressions that only surface on a real mobile device

import { test } from "node:test";
import assert from "node:assert/strict";
import { onTap } from "../deploy/js/utils/tap.js";

/** minimal element: stores listeners and triggers them manually */
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

// finger movement means scrolling: activating here would select an option the user only skimmed over
test("arrastrar más de 10 px es scroll, no selección", () => {
  const el = fakeEl();
  let veces = 0;
  onTap(el, () => veces++);

  el.fire("pointerdown", punto(100, 100));
  el.fire("pointerup", punto(100, 130));
  assert.equal(veces, 0, "un arrastre vertical no debe activar");

  // exactly at the limit (10 px) still counts as a tap
  el.fire("pointerdown", punto(100, 100));
  el.fire("pointerup", punto(100, 110));
  assert.equal(veces, 1);
});

// browsers fire click AFTER pointerup: without deduplication, every mobile tap fires twice (in a dropdown,
// selecting and reopening)
test("el click que sigue al toque no activa por segunda vez", () => {
  const el = fakeEl();
  let veces = 0;
  onTap(el, () => veces++);

  el.fire("pointerdown", punto(50, 50));
  el.fire("pointerup", punto(50, 50));
  el.fire("click", punto(50, 50));
  assert.equal(veces, 1, "pointerup + click = una sola activación");
});

// why the click listener remains despite deduplication: keyboard triggers options via programmatic
// .click(), which does NOT emit pointer events; dropping it breaks keyboard navigation
test("un click sin toque previo (teclado, .click() programático) sí activa", () => {
  const el = fakeEl();
  let veces = 0;
  onTap(el, () => veces++);

  el.fire("click", punto(0, 0));
  assert.equal(veces, 1);
});

// stat dropdowns need preventDown: without it, pointerdown shifts focus and closes search input before
// selection occurs
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
