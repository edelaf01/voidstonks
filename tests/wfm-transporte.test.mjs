import { test } from "node:test";
import assert from "node:assert/strict";

const { WORKER_URL } = await import("../deploy/js/config.js");
const { pideWfm } = await import("../deploy/js/services/market/wfm_transporte.js");

async function conFetch(fn) {
  const original = globalThis.fetch;
  const llamadas = [];
  const marcador = { marca: 1 };
  globalThis.fetch = function () {
    llamadas.push([...arguments]);
    return marcador;
  };
  try {
    return await fn(llamadas, marcador);
  } finally {
    globalThis.fetch = original;
  }
}

test("sin puente la url es la del worker y fetch recibe un solo argumento si no se paso init", async () => {
  await conFetch(async (llamadas, marcador) => {
    const res1 = await pideWfm("wfm_resolve", "&ids=a,b");
    assert.equal(llamadas.length, 1);
    assert.equal(llamadas[0].length, 1);
    assert.equal(llamadas[0][0], `${WORKER_URL}?type=wfm_resolve&ids=a,b`);
    assert.strictEqual(res1, marcador);

    const res2 = await pideWfm("wfm_x");
    assert.equal(llamadas.length, 2);
    assert.equal(llamadas[1].length, 1);
    assert.equal(llamadas[1][0], `${WORKER_URL}?type=wfm_x`);
    assert.strictEqual(res2, marcador);
  });
});

test("sin puente un init undefined llama a fetch con un solo argumento y un init real con dos", async () => {
  await conFetch(async (llamadas) => {
    await pideWfm("wfm_market_batch", "&slugs=x", undefined);
    assert.equal(llamadas.length, 1);
    assert.equal(llamadas[0].length, 1);
    assert.equal(llamadas[0][0], `${WORKER_URL}?type=wfm_market_batch&slugs=x`);

    const init = { method: "POST", body: "{}" };
    await pideWfm("wfm_login", "", init);
    assert.equal(llamadas.length, 2);
    assert.equal(llamadas[1].length, 2);
    assert.strictEqual(llamadas[1][1], init);
  });
});

test("un puente sin funcion wfm sigue yendo por fetch", async () => {
  globalThis.voidstonksNativo = { desarrollo: true };
  try {
    await conFetch(async (llamadas) => {
      await pideWfm("wfm_test");
      assert.equal(llamadas.length, 1);
      assert.equal(llamadas[0][0], `${WORKER_URL}?type=wfm_test`);
    });
  } finally {
    delete globalThis.voidstonksNativo;
  }
});

test("con puente llegan params metodo token y cuerpo", async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = () => assert.fail("no debe llamar a fetch");
  const recibidas = [];
  globalThis.voidstonksNativo = {
    wfm: async (tipo, peticion) => {
      recibidas.push([tipo, peticion]);
      return { status: 200, cuerpo: "{}" };
    }
  };
  try {
    await pideWfm("wfm_my_orders", "&user=tenno&platform=ps4", { headers: { "X-WFM-Token": "tok" } });
    assert.deepEqual(recibidas.at(-1), [
      "wfm_my_orders",
      { params: { user: "tenno", platform: "ps4" }, metodo: "GET", token: "tok", cuerpo: null }
    ]);

    await pideWfm("wfm_resolve", "&ids=a%2Cb&slug=ash_prime_set");
    assert.deepEqual(recibidas.at(-1), [
      "wfm_resolve",
      { params: { ids: "a,b", slug: "ash_prime_set" }, metodo: "GET", token: null, cuerpo: null }
    ]);

    await pideWfm("wfm_order_edit", "&id=x&action=update", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-WFM-Token": "t" },
      body: '{"a":1}'
    });
    assert.deepEqual(recibidas.at(-1), [
      "wfm_order_edit",
      { params: { id: "x", action: "update" }, metodo: "POST", token: "t", cuerpo: '{"a":1}' }
    ]);

    await pideWfm("wfm_logout");
    assert.deepEqual(recibidas.at(-1), [
      "wfm_logout",
      { params: {}, metodo: "GET", token: null, cuerpo: null }
    ]);

    await pideWfm("wfm_market_batch", "&slugs=a", undefined);
    assert.deepEqual(recibidas.at(-1), [
      "wfm_market_batch",
      { params: { slugs: "a" }, metodo: "GET", token: null, cuerpo: null }
    ]);

    await pideWfm("wfm_test", "", { headers: {} });
    assert.equal(recibidas.at(-1)[1].token, null);

    await pideWfm("wfm_test", "", { headers: { "Content-Type": "application/json" } });
    assert.equal(recibidas.at(-1)[1].token, null);
  } finally {
    globalThis.fetch = origFetch;
    delete globalThis.voidstonksNativo;
  }
});

test("con puente el response lleva el status el cuerpo y la cabecera x-wfm-scope", async () => {
  let respuestaPuente;
  globalThis.voidstonksNativo = {
    wfm: async () => respuestaPuente
  };
  try {
    respuestaPuente = { status: 201, cuerpo: '{"ok":true}', scope: "full" };
    const res1 = await pideWfm("wfm_login");
    assert.equal(res1.status, 201);
    assert.deepEqual(await res1.json(), { ok: true });
    assert.equal(res1.headers.get("X-WFM-Scope"), "full");

    respuestaPuente = { status: 200, cuerpo: "[]" };
    const res2 = await pideWfm("wfm_market_batch");
    assert.equal(res2.status, 200);
    assert.deepEqual(await res2.json(), []);
    assert.equal(res2.headers.get("X-WFM-Scope"), null);
  } finally {
    delete globalThis.voidstonksNativo;
  }
});

test("con puente null del puente da 502", async () => {
  let respuestaPuente;
  globalThis.voidstonksNativo = {
    wfm: async () => respuestaPuente
  };
  try {
    for (const valor of [null, undefined, {}]) {
      respuestaPuente = valor;
      const res = await pideWfm("wfm_test");
      assert.equal(res.status, 502);
      assert.equal(await res.text(), "");
    }
    respuestaPuente = { cuerpo: "x" };
    const resX = await pideWfm("wfm_test");
    assert.equal(resX.status, 502);
    assert.equal(await resX.text(), "x");
  } finally {
    delete globalThis.voidstonksNativo;
  }
});

test("con puente un rechazo se propaga", async () => {
  globalThis.voidstonksNativo = {
    wfm: async () => {
      throw new Error("ipc caído");
    }
  };
  try {
    await assert.rejects(
      pideWfm("wfm_login", "", { method: "POST" }),
      /ipc caído/
    );
    globalThis.voidstonksNativo = {
      wfm: () => {
        throw new Error("síncrono caído");
      }
    };
    await assert.rejects(
      pideWfm("wfm_login", "", { method: "POST" }),
      /síncrono caído/
    );
  } finally {
    delete globalThis.voidstonksNativo;
  }
});
