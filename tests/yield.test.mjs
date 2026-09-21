import { test } from "node:test";
import assert from "node:assert/strict";
import { creaCedeHilo, cedeHilo } from "../deploy/js/utils/yield.js";

const variantes = {
  "por defecto": cedeHilo,
  "MessageChannel": creaCedeHilo({ MessageChannel }),
  "setTimeout": creaCedeHilo({}),
};

for (const [nombre, cede] of Object.entries(variantes)) {
  test(`${nombre}: la continuación es una macrotarea y deja pasar las microtareas`, async () => {
    const orden = [];
    const p = cede().then(() => orden.push("cede"));
    await Promise.resolve().then(() => orden.push("micro"));
    await p;
    assert.deepEqual(orden, ["micro", "cede"]);
  });
}

test("con scheduler.yield disponible se usa, invocado sobre el scheduler", async () => {
  let n = 0;
  const scheduler = { yield() { assert.equal(this, scheduler); n++; return Promise.resolve(); } };
  await creaCedeHilo({ scheduler, MessageChannel })();
  assert.equal(n, 1);
});

// in Node setTimeout(0) is >=1 ms per hop (>=200 ms total); MessageChannel measured at 24 ms
test("200 cesiones encadenadas sin scheduler no pagan el clamp de los temporizadores", async () => {
  const cede = creaCedeHilo({ MessageChannel });
  const t = performance.now();
  for (let i = 0; i < 200; i++) await cede();
  assert.ok(performance.now() - t < 150, `${(performance.now() - t).toFixed(0)} ms`);
});

test("varias cesiones en vuelo se resuelven todas", { timeout: 2000 }, async () => {
  const cede = creaCedeHilo({ MessageChannel });
  await Promise.all([cede(), cede(), cede()]);
});
