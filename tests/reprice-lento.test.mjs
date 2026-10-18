import { test, after } from "node:test";
import assert from "node:assert/strict";

const origSessionStorage = globalThis.sessionStorage;
const origLocalStorage = globalThis.localStorage;
const origFetch = globalThis.fetch;
const origAtob = globalThis.atob;
const origNativo = globalThis.voidstonksNativo;

const almacenSession = new Map();
globalThis.sessionStorage = {
  getItem: (k) => (almacenSession.has(k) ? almacenSession.get(k) : null),
  setItem: (k, v) => almacenSession.set(k, String(v)),
  removeItem: (k) => almacenSession.delete(k),
  clear: () => almacenSession.clear()
};

const almacenLocal = new Map();
globalThis.localStorage = {
  getItem: (k) => (almacenLocal.has(k) ? almacenLocal.get(k) : null),
  setItem: (k, v) => almacenLocal.set(k, String(v)),
  removeItem: (k) => almacenLocal.delete(k),
  clear: () => almacenLocal.clear()
};

globalThis.atob ??= (s) => Buffer.from(s, "base64").toString("binary");
delete globalThis.voidstonksNativo;

const rutas = new Map();
const peticiones = [];
globalThis.fetch = async (url, init) => {
  const u = String(url);
  peticiones.push({ url: u, init });
  for (const [patron, responder] of rutas) {
    if (u.includes(patron)) return responder(u, init);
  }
  return respuesta(404);
};

function respuesta(status, cuerpo = {}, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => cuerpo,
    text: async () => JSON.stringify(cuerpo),
    headers: { get: (h) => headers[h] ?? null }
  };
}

const {
  ESPERA_MS,
  RITMO_MS,
  FALLOS_SEGUIDOS,
  marcaVistas,
  estado,
  suscribe,
  enEspera,
  revisa,
  aplica,
  _reinicia
} = await import("../deploy/js/services/market/reprice_lento.service.js");

function jwt(payload) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "HS256" })}.${b64(payload)}.firma`;
}

function conSesion({ token = true, slug = "tenno" } = {}) {
  almacenSession.clear();
  if (token) {
    almacenSession.set("wfm_jwt", jwt({ exp: Math.floor((Date.now() + 3600_000) / 1000) }));
    almacenSession.set("wfm_exp", String(Date.now() + 3600_000));
  }
  if (slug) almacenSession.set("wfm_slug", slug);
}

function reset() {
  _reinicia();
  almacenLocal.clear();
  almacenSession.clear();
  rutas.clear();
  peticiones.length = 0;
}

const ahora = 1_700_000_000_000;
const hace = (horas) => new Date(ahora - horas * 3600_000).toISOString();
const mercado100 = { reciente: { "": { ultima: 100, hora: hace(1), mediana: 100, volumen: 10 } } };

after(() => {
  if (origSessionStorage === undefined) delete globalThis.sessionStorage;
  else globalThis.sessionStorage = origSessionStorage;
  if (origLocalStorage === undefined) delete globalThis.localStorage;
  else globalThis.localStorage = origLocalStorage;
  if (origFetch === undefined) delete globalThis.fetch;
  else globalThis.fetch = origFetch;
  if (origAtob === undefined) delete globalThis.atob;
  else globalThis.atob = origAtob;
  if (origNativo === undefined) delete globalThis.voidstonksNativo;
  else globalThis.voidstonksNativo = origNativo;
});

test("enEspera sin almacen reporta faltan con slugs unicos y desfasadas vacias", () => {
  reset();
  const ordenes = [
    { id: "o1", type: "sell", itemSlug: "s1", platinum: 150 },
    { id: "o2", type: "sell", itemSlug: "s1", platinum: 100 },
    { id: "o3", type: "buy", itemSlug: "s2", platinum: 80 }
  ];
  const r = enEspera(ordenes, ahora);
  assert.deepEqual(r.faltan, ["s1"]);
  assert.deepEqual(r.desfasadas, []);
  assert.equal(r.alDia, 0);
  assert.equal(r.sinDatos, 2);
  assert.equal(r.enEspera, 0);
});

test("enEspera con mercado vigente distingue desfasada y al dia y no falta", () => {
  reset();
  almacenLocal.set("vs_reprice_v1", JSON.stringify({
    mercados: { s1: { t: ahora - 1000, d: mercado100 } },
    cambios: {}
  }));
  const ordenes = [
    { id: "o1", type: "sell", itemSlug: "s1", platinum: 150 },
    { id: "o2", type: "sell", itemSlug: "s1", platinum: 100 }
  ];
  const r = enEspera(ordenes, ahora);
  assert.deepEqual(r.faltan, []);
  assert.equal(r.desfasadas.length, 1);
  assert.equal(r.desfasadas[0].orden.id, "o1");
  assert.equal(r.alDia, 1);
  assert.equal(r.sinDatos, 0);
});

test("enEspera con dato caducado o en el futuro vuelve a faltar", () => {
  reset();
  almacenLocal.set("vs_reprice_v1", JSON.stringify({
    mercados: { s1: { t: ahora - ESPERA_MS - 1000, d: mercado100 } },
    cambios: {}
  }));
  let r = enEspera([{ id: "o1", type: "sell", itemSlug: "s1", platinum: 150 }], ahora);
  assert.deepEqual(r.faltan, ["s1"]);

  almacenLocal.set("vs_reprice_v1", JSON.stringify({
    mercados: { s1: { t: ahora + 1000, d: mercado100 } },
    cambios: {}
  }));
  r = enEspera([{ id: "o1", type: "sell", itemSlug: "s1", platinum: 150 }], ahora);
  assert.deepEqual(r.faltan, ["s1"]);
});

test("enEspera con d null vigente no falta y cuenta sinDatos", () => {
  reset();
  almacenLocal.set("vs_reprice_v1", JSON.stringify({
    mercados: { s1: { t: ahora - 1000, d: null } },
    cambios: {}
  }));
  const r = enEspera([{ id: "o1", type: "sell", itemSlug: "s1", platinum: 150 }], ahora);
  assert.deepEqual(r.faltan, []);
  assert.equal(r.sinDatos, 1);
  assert.equal(r.desfasadas.length, 0);
});

test("enEspera con orden cambiada hace menos de dos horas la aparta", () => {
  reset();
  almacenLocal.set("vs_reprice_v1", JSON.stringify({
    mercados: {},
    cambios: { o1: ahora - 1000 }
  }));
  const r = enEspera([{ id: "o1", type: "sell", itemSlug: "s1", platinum: 150 }], ahora);
  assert.equal(r.enEspera, 1);
  assert.deepEqual(r.desfasadas, []);
  assert.deepEqual(r.faltan, []);
});

test("enEspera con cambio de hace mas de dos horas vuelve a revisarse", () => {
  reset();
  almacenLocal.set("vs_reprice_v1", JSON.stringify({
    mercados: {},
    cambios: { o1: ahora - ESPERA_MS - 1000 }
  }));
  const r = enEspera([{ id: "o1", type: "sell", itemSlug: "s1", platinum: 150 }], ahora);
  assert.equal(r.enEspera, 0);
  assert.deepEqual(r.faltan, ["s1"]);
});

test("enEspera cuenta tipo SELL en mayusculas", () => {
  reset();
  const r = enEspera([{ id: "o1", type: "SELL", itemSlug: "s1", platinum: 150 }], ahora);
  assert.deepEqual(r.faltan, ["s1"]);
});

test("revisa pide solo los que faltan con parametros y ritmo esperado", async () => {
  reset();
  almacenLocal.set("vs_reprice_v1", JSON.stringify({
    mercados: { s2: { t: ahora - 1000, d: mercado100 } },
    cambios: {}
  }));
  const ordenes = [
    { id: "o1", type: "sell", itemSlug: "s1", platinum: 150 },
    { id: "o2", type: "sell", itemSlug: "s2", platinum: 100 },
    { id: "o3", type: "sell", itemSlug: "s3", platinum: 100 }
  ];
  rutas.set("wfm_market_batch", (u) => {
    const s = new URL(u).searchParams.get("slugs");
    return respuesta(200, { [s]: mercado100 });
  });

  const esperas = [];
  const res = await revisa(ordenes, {
    espera: async (ms) => esperas.push(ms),
    ahora: () => ahora
  });

  assert.equal(peticiones.length, 2);
  for (const p of peticiones) {
    assert.match(p.url, /type=wfm_market_batch/);
    assert.match(p.url, /solo=stats/);
  }
  assert.deepEqual(esperas, [RITMO_MS]);

  const guardado = JSON.parse(almacenLocal.get("vs_reprice_v1"));
  assert.equal(guardado.mercados.s1.t, ahora);
  assert.deepEqual(guardado.mercados.s1.d, mercado100);
  assert.equal(res.frenado, false);
});

test("revisa no guarda si el worker no devuelve el slug", async () => {
  reset();
  rutas.set("wfm_market_batch", () => respuesta(200, {}));
  const ordenes = [{ id: "o1", type: "sell", itemSlug: "s1", platinum: 100 }];
  const res = await revisa(ordenes, {
    espera: async () => {},
    ahora: () => ahora
  });
  const raw = almacenLocal.get("vs_reprice_v1");
  const guardado = raw ? JSON.parse(raw) : null;
  assert.equal(guardado?.mercados?.s1, undefined);
  assert.deepEqual(enEspera(ordenes, ahora).faltan, ["s1"]);
  assert.equal(res.sinRevisar, 1);
});

test("revisa con 500 no guarda y continua con el siguiente", async () => {
  reset();
  rutas.set("wfm_market_batch", (u) => {
    if (u.includes("slugs=s1")) return respuesta(500);
    return respuesta(200, { s2: mercado100 });
  });
  const res = await revisa([
    { id: "o1", type: "sell", itemSlug: "s1", platinum: 100 },
    { id: "o2", type: "sell", itemSlug: "s2", platinum: 100 }
  ], {
    espera: async () => {},
    ahora: () => ahora
  });
  const guardado = JSON.parse(almacenLocal.get("vs_reprice_v1"));
  assert.equal(guardado.mercados.s1, undefined);
  assert.ok(guardado.mercados.s2);
  assert.deepEqual(res.faltan, ["s1"]);
});

test("revisa con 429 para el bucle y marca frenado true", async () => {
  reset();
  rutas.set("wfm_market_batch", (u) => {
    if (u.includes("slugs=s1")) return respuesta(429);
    return respuesta(200, { s2: mercado100 });
  });
  const res = await revisa([
    { id: "o1", type: "sell", itemSlug: "s1", platinum: 100 },
    { id: "o2", type: "sell", itemSlug: "s2", platinum: 100 }
  ], {
    espera: async () => {},
    ahora: () => ahora
  });
  assert.equal(res.frenado, true);
  assert.equal(peticiones.length, 1);
  assert.deepEqual(res.faltan, ["s1", "s2"]);
});

test("revisa transiciona estados y actualiza pendientes al final", async () => {
  reset();
  rutas.set("wfm_market_batch", () => respuesta(200, { s1: mercado100 }));
  const estados = [];
  const desuscribe = suscribe((e) => estados.push(e));
  await revisa([{ id: "o1", type: "sell", itemSlug: "s1", platinum: 150 }], {
    espera: async () => {},
    ahora: () => ahora
  });
  desuscribe();

  assert.equal(estados[0].fase, "revisando");
  assert.equal(estados[0].hechos, 0);
  assert.equal(estados[0].total, 1);
  assert.equal(estados.at(-1).fase, "libre");
  assert.equal(estados.at(-1).pendientes, 1);
  assert.equal(estado().fase, "libre");
  assert.equal(estado().pendientes, 1);
});

test("dos llamadas concurrentes a revisa devuelven la misma promesa", async () => {
  reset();
  rutas.set("wfm_market_batch", () => respuesta(200, { s1: mercado100 }));
  const p1 = revisa([{ id: "o1", type: "sell", itemSlug: "s1", platinum: 100 }], {
    espera: async () => {},
    ahora: () => ahora
  });
  const p2 = revisa([{ id: "o1", type: "sell", itemSlug: "s1", platinum: 100 }], {
    espera: async () => {},
    ahora: () => ahora
  });
  assert.equal(p1, p2);
  await Promise.all([p1, p2]);
  assert.equal(peticiones.length, 1);
});

test("fetch que lanza no deja la fase en revisando", async () => {
  reset();
  rutas.set("wfm_market_batch", () => {
    throw new Error("red rota");
  });
  await revisa([{ id: "o1", type: "sell", itemSlug: "s1", platinum: 100 }], {
    espera: async () => {},
    ahora: () => ahora
  });
  assert.equal(estado().fase, "libre");
});

test("un segundo revisa dentro del periodo vigente no pide nada", async () => {
  reset();
  rutas.set("wfm_market_batch", () => respuesta(200, { s1: mercado100 }));
  const ordenes = [{ id: "o1", type: "sell", itemSlug: "s1", platinum: 100 }];
  await revisa(ordenes, { espera: async () => {}, ahora: () => ahora });
  assert.equal(peticiones.length, 1);
  await revisa(ordenes, { espera: async () => {}, ahora: () => ahora + 1000 });
  assert.equal(peticiones.length, 1);
});

test("aplica sin sesion falla de inmediato sin peticiones", async () => {
  reset();
  const res = await aplica([{ orden: { id: "o1" }, precio: 105 }], {
    espera: async () => {},
    ahora: () => ahora
  });
  assert.deepEqual(res, { hechas: 0, fallos: 1, frenado: false });
  assert.equal(peticiones.length, 0);
});

test("aplica con sesion envia peticion de edicion y espera entre ellas", async () => {
  reset();
  conSesion();
  rutas.set("wfm_order_edit", () => respuesta(200, {}));
  const esperas = [];
  const elegidas = [
    { orden: { id: "o1" }, precio: 105 },
    { orden: { id: "o2" }, precio: 95 }
  ];
  const res = await aplica(elegidas, {
    espera: async (ms) => esperas.push(ms),
    ahora: () => ahora
  });
  assert.deepEqual(res, { hechas: 2, fallos: 0, frenado: false });
  assert.deepEqual(esperas, [RITMO_MS]);
  assert.equal(peticiones.length, 2);
  assert.match(peticiones[0].url, /type=wfm_order_edit/);
  assert.match(peticiones[0].url, /id=o1/);
  assert.match(peticiones[0].url, /action=update/);
  assert.deepEqual(JSON.parse(peticiones[0].init.body), { platinum: 105 });
});

test("aplica con 500 cuenta fallo y sigue con la siguiente orden", async () => {
  reset();
  conSesion();
  rutas.set("wfm_order_edit", (u) => {
    if (u.includes("id=o1")) return respuesta(500);
    return respuesta(200, {});
  });
  const elegidas = [
    { orden: { id: "o1" }, precio: 105 },
    { orden: { id: "o2" }, precio: 95 }
  ];
  const res = await aplica(elegidas, {
    espera: async () => {},
    ahora: () => ahora
  });
  assert.deepEqual(res, { hechas: 1, fallos: 1, frenado: false });
});

test("aplica con 401 corta el bucle y cuenta restantes como fallo", async () => {
  reset();
  conSesion();
  rutas.set("wfm_order_edit", () => respuesta(401));
  const elegidas = [
    { orden: { id: "o1" }, precio: 105 },
    { orden: { id: "o2" }, precio: 95 },
    { orden: { id: "o3" }, precio: 90 }
  ];
  const res = await aplica(elegidas, {
    espera: async () => {},
    ahora: () => ahora
  });
  assert.deepEqual(res, { hechas: 0, fallos: 3, frenado: false });
  assert.equal(peticiones.length, 1);
});

test("aplica guarda cambios y enEspera aparta la orden durante dos horas", async () => {
  reset();
  conSesion();
  rutas.set("wfm_order_edit", () => respuesta(200, {}));
  const elegidas = [{ orden: { id: "o1", type: "sell", itemSlug: "s1", platinum: 150 }, precio: 100 }];
  await aplica(elegidas, { espera: async () => {}, ahora: () => ahora });
  const guardado = JSON.parse(almacenLocal.get("vs_reprice_v1"));
  assert.equal(guardado.cambios.o1, ahora);

  let r = enEspera([{ id: "o1", type: "sell", itemSlug: "s1", platinum: 150 }], ahora + 1000);
  assert.equal(r.enEspera, 1);
  assert.deepEqual(r.desfasadas, []);

  r = enEspera([{ id: "o1", type: "sell", itemSlug: "s1", platinum: 150 }], ahora + ESPERA_MS + 1000);
  assert.equal(r.enEspera, 0);
});

test("aplica reduce pendientes sin bajar de cero", async () => {
  reset();
  rutas.set("wfm_market_batch", () => respuesta(200, { s1: mercado100, s2: mercado100 }));
  await revisa([
    { id: "o1", type: "sell", itemSlug: "s1", platinum: 150 },
    { id: "o2", type: "sell", itemSlug: "s2", platinum: 150 }
  ], {
    espera: async () => {},
    ahora: () => ahora
  });
  assert.equal(estado().pendientes, 2);

  conSesion();
  rutas.set("wfm_order_edit", () => respuesta(200, {}));
  await aplica([{ orden: { id: "o1" }, precio: 100 }], {
    espera: async () => {},
    ahora: () => ahora
  });
  assert.equal(estado().pendientes, 1);

  await aplica([
    { orden: { id: "o2" }, precio: 100 },
    { orden: { id: "o3" }, precio: 100 }
  ], {
    espera: async () => {},
    ahora: () => ahora
  });
  assert.equal(estado().pendientes, 0);
});

test("revisa y aplica se bloquean mutuamente cuando estan ocupados", async () => {
  reset();
  let resuelveRevisa;
  const promesaBloqueo = new Promise((r) => { resuelveRevisa = r; });
  rutas.set("wfm_market_batch", () => promesaBloqueo.then(() => respuesta(200, { s1: mercado100 })));

  const pRev = revisa([{ id: "o1", type: "sell", itemSlug: "s1", platinum: 100 }], {
    espera: async () => {},
    ahora: () => ahora
  });
  const resAplica = await aplica([{ orden: { id: "o1" }, precio: 100 }], {
    espera: async () => {},
    ahora: () => ahora
  });
  assert.deepEqual(resAplica, { hechas: 0, fallos: 0, ocupado: true });
  resuelveRevisa();
  await pRev;

  conSesion();
  let resuelveAplica;
  const promesaBloqueoAplica = new Promise((r) => { resuelveAplica = r; });
  rutas.set("wfm_order_edit", () => promesaBloqueoAplica.then(() => respuesta(200, {})));

  const pApl = aplica([{ orden: { id: "o1" }, precio: 100 }], {
    espera: async () => {},
    ahora: () => ahora
  });
  const resRevisa = await revisa([{ id: "o1", type: "sell", itemSlug: "s1", platinum: 100 }], {
    espera: async () => {},
    ahora: () => ahora
  });
  assert.deepEqual(resRevisa, { ocupado: true });
  resuelveAplica();
  await pApl;
});

test("suscribe cancela y aisla errores de suscriptores", async () => {
  reset();
  let c1 = 0;
  let c2 = 0;
  const desuscribe = suscribe(() => {
    c1++;
    throw new Error("fallo de suscriptor");
  });
  suscribe(() => {
    c2++;
  });
  await revisa([{ id: "o1", type: "sell", itemSlug: "s1", platinum: 100 }], {
    espera: async () => {},
    ahora: () => ahora
  });
  assert.ok(c1 > 0);
  assert.ok(c2 > 0);
  assert.equal(c1, c2);

  desuscribe();
  const c1Antes = c1;
  await revisa([], { espera: async () => {}, ahora: () => ahora });
  assert.equal(c1, c1Antes);
});

test("localStorage con errores mantiene funcionamiento en memoria", async () => {
  reset();
  globalThis.localStorage.getItem = () => {
    throw new Error("disco inaccesible");
  };
  globalThis.localStorage.setItem = () => {
    throw new Error("disco inaccesible");
  };
  rutas.set("wfm_market_batch", () => respuesta(200, { s1: mercado100 }));
  const ordenes = [{ id: "o1", type: "sell", itemSlug: "s1", platinum: 150 }];
  await revisa(ordenes, { espera: async () => {}, ahora: () => ahora });
  const r = enEspera(ordenes, ahora);
  assert.deepEqual(r.faltan, []);
  assert.equal(r.desfasadas.length, 1);
});

test("integracion revisa aplica espera y caducidad", async () => {
  reset();
  const ordenes = [
    { id: "o1", type: "sell", itemSlug: "s1", platinum: 150 },
    { id: "o2", type: "sell", itemSlug: "s2", platinum: 100 }
  ];
  rutas.set("wfm_market_batch", (u) => {
    const s = new URL(u).searchParams.get("slugs");
    return respuesta(200, { [s]: mercado100 });
  });
  rutas.set("wfm_order_edit", () => respuesta(200, {}));
  conSesion();

  const rRev = await revisa(ordenes, { espera: async () => {}, ahora: () => ahora });
  assert.equal(rRev.desfasadas.length, 1);
  assert.equal(rRev.desfasadas[0].orden.id, "o1");

  const rApl = await aplica([{ orden: rRev.desfasadas[0].orden, precio: rRev.desfasadas[0].precio }], {
    espera: async () => {},
    ahora: () => ahora
  });
  assert.deepEqual(rApl, { hechas: 1, fallos: 0, frenado: false });

  const rEspera = enEspera(ordenes, ahora);
  assert.equal(rEspera.enEspera, 1);
  assert.deepEqual(rEspera.faltan, []);
  assert.deepEqual(rEspera.desfasadas, []);

  const rFuturo = enEspera(ordenes, ahora + ESPERA_MS + 1000);
  assert.equal(rFuturo.enEspera, 0);
  assert.deepEqual(rFuturo.faltan.sort(), ["s1", "s2"]);
});

test("tres fallos seguidos con cinco que faltan detienen el bucle", async () => {
  reset();
  rutas.set("wfm_market_batch", () => respuesta(500));
  const ordenes = [
    { id: "o1", type: "sell", itemSlug: "s1", platinum: 100 },
    { id: "o2", type: "sell", itemSlug: "s2", platinum: 100 },
    { id: "o3", type: "sell", itemSlug: "s3", platinum: 100 },
    { id: "o4", type: "sell", itemSlug: "s4", platinum: 100 },
    { id: "o5", type: "sell", itemSlug: "s5", platinum: 100 }
  ];
  const res = await revisa(ordenes, { espera: async () => {}, ahora: () => ahora });
  assert.equal(peticiones.length, FALLOS_SEGUIDOS);
  assert.equal(res.frenado, false);
  assert.equal(res.sinRevisar, 5);
});

test("acierto reinicia la cuenta de fallos seguidos y completa cinco peticiones", async () => {
  reset();
  const ordenes = [
    { id: "o1", type: "sell", itemSlug: "s1", platinum: 100 },
    { id: "o2", type: "sell", itemSlug: "s2", platinum: 100 },
    { id: "o3", type: "sell", itemSlug: "s3", platinum: 100 },
    { id: "o4", type: "sell", itemSlug: "s4", platinum: 100 },
    { id: "o5", type: "sell", itemSlug: "s5", platinum: 100 }
  ];
  rutas.set("wfm_market_batch", (u) => {
    if (u.includes("slugs=s2")) return respuesta(200, { s2: mercado100 });
    if (u.includes("slugs=s5")) return respuesta(200, { s5: mercado100 });
    return respuesta(500);
  });
  const res = await revisa(ordenes, { espera: async () => {}, ahora: () => ahora });
  assert.equal(peticiones.length, 5);
  assert.equal(res.sinRevisar, 3);
});

test("sinRevisar es cero cuando todos los slugs se guardan", async () => {
  reset();
  rutas.set("wfm_market_batch", (u) => {
    const s = new URL(u).searchParams.get("slugs");
    return respuesta(200, { [s]: mercado100 });
  });
  const ordenes = [
    { id: "o1", type: "sell", itemSlug: "s1", platinum: 100 },
    { id: "o2", type: "sell", itemSlug: "s2", platinum: 100 }
  ];
  const res = await revisa(ordenes, { espera: async () => {}, ahora: () => ahora });
  assert.equal(res.sinRevisar, 0);
});

test("sinRevisar cuenta restantes cuando 429 corta en el segundo de tres", async () => {
  reset();
  rutas.set("wfm_market_batch", (u) => {
    if (u.includes("slugs=s1")) return respuesta(200, { s1: mercado100 });
    if (u.includes("slugs=s2")) return respuesta(429);
    return respuesta(200, { s3: mercado100 });
  });
  const ordenes = [
    { id: "o1", type: "sell", itemSlug: "s1", platinum: 100 },
    { id: "o2", type: "sell", itemSlug: "s2", platinum: 100 },
    { id: "o3", type: "sell", itemSlug: "s3", platinum: 100 }
  ];
  const res = await revisa(ordenes, { espera: async () => {}, ahora: () => ahora });
  assert.equal(res.frenado, true);
  assert.equal(res.sinRevisar, 2);
  assert.equal(peticiones.length, 2);
});

test("aplica con 429 en la segunda de tres marca frenado y no sigue", async () => {
  reset();
  conSesion();
  rutas.set("wfm_order_edit", (u) => {
    if (u.includes("id=o1")) return respuesta(200, {});
    if (u.includes("id=o2")) return respuesta(429);
    return respuesta(200, {});
  });
  const elegidas = [
    { orden: { id: "o1" }, precio: 105 },
    { orden: { id: "o2" }, precio: 95 },
    { orden: { id: "o3" }, precio: 90 }
  ];
  const res = await aplica(elegidas, {
    espera: async () => {},
    ahora: () => ahora
  });
  assert.deepEqual(res, { hechas: 1, fallos: 2, frenado: true });
  assert.equal(peticiones.length, 2);
});

test("marcaVistas con pendientes pone a cero y avisa y con cero no avisa", async () => {
  reset();
  rutas.set("wfm_market_batch", () => respuesta(200, { s1: mercado100 }));
  await revisa([{ id: "o1", type: "sell", itemSlug: "s1", platinum: 150 }], {
    espera: async () => {},
    ahora: () => ahora
  });
  assert.equal(estado().pendientes, 1);

  let avisos = 0;
  const desuscribe = suscribe(() => {
    avisos++;
  });
  marcaVistas();
  assert.equal(estado().pendientes, 0);
  assert.equal(avisos, 1);

  marcaVistas();
  assert.equal(avisos, 1);
  desuscribe();
});
