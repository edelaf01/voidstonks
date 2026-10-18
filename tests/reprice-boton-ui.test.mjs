import { test, after } from "node:test";
import assert from "node:assert/strict";

function creaElemento(tag) {
  const elem = {
    tagName: tag.toUpperCase(),
    className: "",
    textContent: "",
    hidden: false,
    type: "",
    disabled: false,
    checked: false,
    value: "",
    min: "",
    attributes: new Map(),
    children: [],
    parentNode: null,
    _listeners: {},
    classList: {
      add(...classes) {
        const set = new Set(elem.className.split(" ").filter(Boolean));
        for (const c of classes) set.add(c);
        elem.className = [...set].join(" ");
      }
    },
    get firstChild() {
      return this.children[0] || null;
    },
    get isConnected() {
      let n = this;
      while (n) {
        if (n === globalThis.document?.body) return true;
        n = n.parentNode;
      }
      return false;
    },
    setAttribute(k, v) {
      this.attributes.set(k, String(v));
    },
    getAttribute(k) {
      return this.attributes.get(k) ?? null;
    },
    addEventListener(evento, fn) {
      (this._listeners[evento] ??= []).push(fn);
    },
    removeEventListener(evento, fn) {
      if (!this._listeners[evento]) return;
      this._listeners[evento] = this._listeners[evento].filter((f) => f !== fn);
    },
    async click() {
      const handlers = [...(this._listeners["click"] || [])];
      for (const h of handlers) {
        await h({ target: this });
      }
    },
    append(...hijos) {
      for (const h of hijos) this.appendChild(h);
    },
    appendChild(hijo) {
      if (hijo.parentNode) hijo.parentNode.removeChild(hijo);
      hijo.parentNode = this;
      this.children.push(hijo);
      return hijo;
    },
    removeChild(hijo) {
      const idx = this.children.indexOf(hijo);
      if (idx !== -1) {
        this.children.splice(idx, 1);
        hijo.parentNode = null;
      }
      return hijo;
    },
    remove() {
      if (this.parentNode) this.parentNode.removeChild(this);
    },
    replaceChildren(...nuevos) {
      for (const c of [...this.children]) this.removeChild(c);
      for (const n of nuevos) this.appendChild(n);
    }
  };
  return elem;
}

function buscaPorClase(nodo, clase, res = []) {
  if (nodo.className && nodo.className.split(" ").includes(clase)) {
    res.push(nodo);
  }
  for (const c of nodo.children) {
    buscaPorClase(c, clase, res);
  }
  return res;
}

const listenersDoc = {};
const doc = {
  createElement: creaElemento,
  body: creaElemento("body"),
  addEventListener(evento, fn) {
    (listenersDoc[evento] ??= []).push(fn);
  },
  removeEventListener(evento, fn) {
    if (!listenersDoc[evento]) return;
    listenersDoc[evento] = listenersDoc[evento].filter((f) => f !== fn);
  },
  disparar(evento, datos = {}) {
    const handlers = [...(listenersDoc[evento] || [])];
    for (const h of handlers) {
      h(datos);
    }
  },
  querySelector(sel) {
    if (sel.startsWith(".")) {
      const cls = sel.slice(1);
      const res = buscaPorClase(this.body, cls);
      return res[0] || null;
    }
    return null;
  },
  querySelectorAll(sel) {
    if (sel.startsWith(".")) {
      const cls = sel.slice(1);
      return buscaPorClase(this.body, cls);
    }
    return [];
  }
};

const origDocument = globalThis.document;
const origSessionStorage = globalThis.sessionStorage;
const origLocalStorage = globalThis.localStorage;
const origFetch = globalThis.fetch;
const origAtob = globalThis.atob;
const origNativo = globalThis.voidstonksNativo;
const origShowToast = globalThis.showToast;

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

globalThis.document = doc;
globalThis.atob ??= (s) => Buffer.from(s, "base64").toString("binary");
delete globalThis.voidstonksNativo;

const toasts = [];
globalThis.showToast = (msg) => toasts.push(msg);

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

function jwt(payload) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "HS256" })}.${b64(payload)}.firma`;
}

function conSesion({ scope = "full" } = {}) {
  almacenSession.clear();
  almacenSession.set("wfm_jwt", jwt({ exp: Math.floor((Date.now() + 3600_000) / 1000) }));
  almacenSession.set("wfm_exp", String(Date.now() + 3600_000));
  almacenSession.set("wfm_scope", scope);
}

const { state } = await import("../deploy/js/state.js");
const { botonRevisarPrecios } = await import("../deploy/js/ui.components/market/ui_reprice.js");
const { revisa } = await import("../deploy/js/services/market/reprice_lento.service.js");

async function reset() {
  await revisa([]);
  almacenLocal.clear();
  almacenSession.clear();
  rutas.clear();
  peticiones.length = 0;
  toasts.length = 0;
  doc.body.replaceChildren();
  state.currentLang = "es";
  conSesion();
}

after(() => {
  if (origDocument === undefined) delete globalThis.document;
  else globalThis.document = origDocument;
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
  if (origShowToast === undefined) delete globalThis.showToast;
  else globalThis.showToast = origShowToast;
});

test("boton oculto sin ventas o sin scope full y textos segun idioma", async () => {
  await reset();
  conSesion({ scope: "public" });
  let b = botonRevisarPrecios([{ id: "o1", type: "sell" }], () => {});
  assert.equal(b.hidden, true);

  conSesion({ scope: "full" });
  b = botonRevisarPrecios([{ id: "o1", type: "buy" }], () => {});
  assert.equal(b.hidden, true);

  b = botonRevisarPrecios([{ id: "o1", type: "sell" }], () => {});
  assert.equal(b.hidden, false);
  assert.equal(b.textContent, "Revisar precios");

  state.currentLang = "en";
  const bEn = botonRevisarPrecios([{ id: "o1", type: "sell" }], () => {});
  assert.equal(bEn.hidden, false);
  assert.equal(bEn.textContent, "Review prices");
});

test("click con slug faltante pide stats muestra revisando toast y actualiza boton", async () => {
  await reset();
  const ahora = Date.now();
  const hace = (h) => new Date(ahora - h * 3600_000).toISOString();
  const mercado100 = { reciente: { "": { ultima: 100, hora: hace(1), mediana: 100, volumen: 10 } } };

  let resolverFetch;
  const bloqueo = new Promise((r) => { resolverFetch = r; });
  rutas.set("wfm_market_batch", () => bloqueo.then(() => respuesta(200, { s1: mercado100 })));

  const ordenes = [{ id: "o1", type: "sell", itemSlug: "s1", platinum: 150 }];
  const btn = botonRevisarPrecios(ordenes, () => {});
  doc.body.appendChild(btn);

  await btn.click();
  assert.equal(btn.disabled, true);
  assert.equal(btn.textContent, "Revisando 0/1");

  resolverFetch();
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));

  assert.equal(peticiones.length, 1);
  assert.match(peticiones[0].url, /solo=stats/);
  assert.equal(btn.disabled, false);
  assert.equal(btn.textContent, "Revisar precios (1)");
  assert.equal(toasts.length, 1);
  assert.match(toasts[0], /1 desfasados/);
  assert.equal(doc.querySelector(".reprice-modal"), null);

  rutas.set("wfm_market_batch", () => respuesta(200, { s2: mercado100 }));
  const ordenesAlDia = [{ id: "o2", type: "sell", itemSlug: "s2", platinum: 100 }];
  const btnAlDia = botonRevisarPrecios(ordenesAlDia, () => {});
  doc.body.appendChild(btnAlDia);

  await btnAlDia.click();
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));

  assert.match(toasts.at(-1), /están al día/);
  assert.equal(btnAlDia.textContent, "Revisar precios");
  assert.equal(doc.querySelector(".reprice-modal"), null);
});

test("dos botones montados se actualizan y uno desmontado no falla", async () => {
  await reset();
  const ahora = Date.now();
  const hace = (h) => new Date(ahora - h * 3600_000).toISOString();
  const mercado100 = { reciente: { "": { ultima: 100, hora: hace(1), mediana: 100, volumen: 10 } } };
  rutas.set("wfm_market_batch", () => respuesta(200, { s1: mercado100 }));

  const ordenes = [{ id: "o1", type: "sell", itemSlug: "s1", platinum: 150 }];
  const b1 = botonRevisarPrecios(ordenes, () => {});
  const b2 = botonRevisarPrecios(ordenes, () => {});
  const b3 = botonRevisarPrecios(ordenes, () => {});

  doc.body.appendChild(b1);
  doc.body.appendChild(b2);
  doc.body.appendChild(b3);
  b3.remove();

  await b1.click();
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));

  assert.equal(b1.textContent, "Revisar precios (1)");
  assert.equal(b2.textContent, "Revisar precios (1)");
  assert.equal(b3.isConnected, false);
});

test("click con datos guardados abre modal sin peticiones y muestra resumen", async () => {
  await reset();
  const ahora = Date.now();
  const hace = (h) => new Date(ahora - h * 3600_000).toISOString();
  const mercado100 = { reciente: { "": { ultima: 100, hora: hace(1), mediana: 100, volumen: 10 } } };

  almacenLocal.set("vs_reprice_v1", JSON.stringify({
    mercados: {
      s1: { t: ahora, d: mercado100 },
      s2: { t: ahora, d: mercado100 }
    },
    cambios: {
      o3: ahora - 1000
    }
  }));

  const ordenes = [
    { id: "o1", type: "sell", itemSlug: "s1", itemName: "Serration", platinum: 150 },
    { id: "o2", type: "sell", itemSlug: "s2", itemName: "Split Chamber", platinum: 100 },
    { id: "o3", type: "sell", itemSlug: "s3", itemName: "Heavy Caliber", platinum: 200 }
  ];

  const btn = botonRevisarPrecios(ordenes, () => {});
  doc.body.appendChild(btn);

  await btn.click();
  assert.equal(peticiones.length, 0);

  const modal = doc.querySelector(".reprice-modal");
  assert.ok(modal);

  const cuerpo = modal.children.find((c) => c.className === "reprice-body");
  const resumen = cuerpo.children.find((c) => c.className === "reprice-resumen");
  assert.match(resumen.textContent, /1 desfasadas/);
  assert.match(resumen.textContent, /1 al día/);
  assert.match(resumen.textContent, /1 cambiados hace menos de 2 h/);

  const lista = cuerpo.children.find((c) => c.className === "reprice-list");
  assert.equal(lista.children.length, 1);
  const fila = lista.children[0];
  const info = fila.children.find((c) => c.className === "reprice-info");
  assert.match(info.children[0].textContent, /Serration/);
  const inputPrecio = fila.children.find((c) => c.className.includes("reprice-price"));
  assert.equal(inputPrecio.value, "100");
});

test("aplicar cierra modal envia edicion con precio muestra toast y llama alTerminar", async () => {
  await reset();
  const ahora = Date.now();
  const hace = (h) => new Date(ahora - h * 3600_000).toISOString();
  const mercado100 = { reciente: { "": { ultima: 100, hora: hace(1), mediana: 100, volumen: 10 } } };

  almacenLocal.set("vs_reprice_v1", JSON.stringify({
    mercados: { s1: { t: ahora, d: mercado100 } },
    cambios: {}
  }));
  rutas.set("wfm_order_edit", () => respuesta(200, {}));

  let alTerminarLlamado = false;
  const ordenes = [
    { id: "o1", type: "sell", itemSlug: "s1", itemName: "Serration", platinum: 150 }
  ];

  const btn = botonRevisarPrecios(ordenes, () => {
    alTerminarLlamado = true;
  });
  doc.body.appendChild(btn);

  await btn.click();
  const modal = doc.querySelector(".reprice-modal");
  assert.ok(modal);

  const cuerpo = modal.children.find((c) => c.className === "reprice-body");
  const lista = cuerpo.children.find((c) => c.className === "reprice-list");
  const inputPrecio = lista.children[0].children.find((c) => c.className.includes("reprice-price"));
  inputPrecio.value = "115";

  const pie = modal.children.find((c) => c.className === "orders-modal-foot");
  const btnAplicar = pie.children.find((c) => c.className === "orders-btn");

  await btnAplicar.click();
  assert.equal(doc.querySelector(".reprice-modal"), null);

  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));

  assert.equal(alTerminarLlamado, true);
  const pEdit = peticiones.find((p) => p.url.includes("wfm_order_edit"));
  assert.ok(pEdit);
  assert.match(pEdit.url, /id=o1/);
  assert.deepEqual(JSON.parse(pEdit.init.body), { platinum: 115 });
  assert.ok(toasts.some((t) => t.includes("Precios actualizados: 1")));
});

test("aplicar con todas fallidas llama a alTerminar", async () => {
  await reset();
  const ahora = Date.now();
  const hace = (h) => new Date(ahora - h * 3600_000).toISOString();
  const mercado100 = { reciente: { "": { ultima: 100, hora: hace(1), mediana: 100, volumen: 10 } } };

  almacenLocal.set("vs_reprice_v1", JSON.stringify({
    mercados: { s1: { t: ahora, d: mercado100 } },
    cambios: {}
  }));
  rutas.set("wfm_order_edit", () => respuesta(500));

  let alTerminarLlamado = false;
  const ordenes = [
    { id: "o1", type: "sell", itemSlug: "s1", itemName: "Serration", platinum: 150 }
  ];

  const btn = botonRevisarPrecios(ordenes, () => {
    alTerminarLlamado = true;
  });
  doc.body.appendChild(btn);

  await btn.click();
  const modal = doc.querySelector(".reprice-modal");
  const pie = modal.children.find((c) => c.className === "orders-modal-foot");
  const btnAplicar = pie.children.find((c) => c.className === "orders-btn");

  await btnAplicar.click();
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));

  assert.equal(alTerminarLlamado, true);
  assert.ok(toasts.some((t) => t.includes("fallidas: 1")));
});

test("escape y click en fondo cierran el modal", async () => {
  await reset();
  const ahora = Date.now();
  const hace = (h) => new Date(ahora - h * 3600_000).toISOString();
  const mercado100 = { reciente: { "": { ultima: 100, hora: hace(1), mediana: 100, volumen: 10 } } };

  almacenLocal.set("vs_reprice_v1", JSON.stringify({
    mercados: { s1: { t: ahora, d: mercado100 } },
    cambios: {}
  }));

  const ordenes = [
    { id: "o1", type: "sell", itemSlug: "s1", itemName: "Serration", platinum: 150 }
  ];

  const btn = botonRevisarPrecios(ordenes, () => {});
  doc.body.appendChild(btn);

  await btn.click();
  assert.ok(doc.querySelector(".reprice-modal"));

  doc.disparar("keydown", { key: "Escape" });
  assert.equal(doc.querySelector(".reprice-modal"), null);

  await btn.click();
  assert.ok(doc.querySelector(".reprice-modal"));

  const backdrop = doc.body.children.find((c) => c.className === "orders-modal-backdrop");
  await backdrop.click();
  assert.equal(doc.querySelector(".reprice-modal"), null);
});

test("con pendientes mayor a cero abre modal sin peticiones restaura boton y siguiente click revisa", async () => {
  await reset();
  const ahora = Date.now();
  const hace = (h) => new Date(ahora - h * 3600_000).toISOString();
  const mercado100 = { reciente: { "": { ultima: 100, hora: hace(1), mediana: 100, volumen: 10 } } };

  rutas.set("wfm_market_batch", (u) => {
    if (u.includes("slugs=s1")) return respuesta(200, { s1: mercado100 });
    if (u.includes("slugs=s2")) return respuesta(200, { s2: mercado100 });
    return respuesta(404);
  });

  const ordenes = [
    { id: "o1", type: "sell", itemSlug: "s1", itemName: "Serration", platinum: 150 }
  ];
  const btn = botonRevisarPrecios(ordenes, () => {});
  doc.body.appendChild(btn);

  await btn.click();
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));

  assert.equal(btn.textContent, "Revisar precios (1)");
  assert.equal(peticiones.length, 1);

  ordenes.push({ id: "o2", type: "sell", itemSlug: "s2", itemName: "Split Chamber", platinum: 100 });

  await btn.click();
  assert.equal(peticiones.length, 1);
  assert.ok(doc.querySelector(".reprice-modal"));
  assert.equal(btn.textContent, "Revisar precios");

  doc.disparar("keydown", { key: "Escape" });
  assert.equal(doc.querySelector(".reprice-modal"), null);

  await btn.click();
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));

  assert.equal(peticiones.length, 2);
  assert.match(peticiones[1].url, /slugs=s2/);
  assert.equal(doc.querySelector(".reprice-modal"), null);
});

test("toast sin slug muestra no consultadas y no all good", async () => {
  await reset();
  rutas.set("wfm_market_batch", () => respuesta(200, {}));
  const ordenes = [{ id: "o1", type: "sell", itemSlug: "s1", platinum: 100 }];
  const btn = botonRevisarPrecios(ordenes, () => {});
  doc.body.appendChild(btn);

  await btn.click();
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));

  assert.equal(toasts.length, 1);
  assert.match(toasts[0], /1 no se pudieron consultar/);
  assert.equal(toasts[0].includes("están al día"), false);
});

test("toast de revisa con 429 contiene mensaje de freno", async () => {
  await reset();
  rutas.set("wfm_market_batch", () => respuesta(429));
  const ordenes = [{ id: "o1", type: "sell", itemSlug: "s1", platinum: 100 }];
  const btn = botonRevisarPrecios(ordenes, () => {});
  doc.body.appendChild(btn);

  await btn.click();
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));

  assert.equal(toasts.length, 1);
  assert.match(toasts[0], /pidió frenar/);
});

test("aplicar con 429 incluye aviso de freno en el toast", async () => {
  await reset();
  const ahora = Date.now();
  const hace = (h) => new Date(ahora - h * 3600_000).toISOString();
  const mercado100 = { reciente: { "": { ultima: 100, hora: hace(1), mediana: 100, volumen: 10 } } };

  almacenLocal.set("vs_reprice_v1", JSON.stringify({
    mercados: { s1: { t: ahora, d: mercado100 } },
    cambios: {}
  }));
  rutas.set("wfm_order_edit", () => respuesta(429));

  let alTerminarLlamado = false;
  const ordenes = [
    { id: "o1", type: "sell", itemSlug: "s1", itemName: "Serration", platinum: 150 }
  ];

  const btn = botonRevisarPrecios(ordenes, () => {
    alTerminarLlamado = true;
  });
  doc.body.appendChild(btn);

  await btn.click();
  const modal = doc.querySelector(".reprice-modal");
  assert.ok(modal);

  const pie = modal.children.find((c) => c.className === "orders-modal-foot");
  const btnAplicar = pie.children.find((c) => c.className === "orders-btn");

  await btnAplicar.click();
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));

  assert.equal(alTerminarLlamado, false);
  assert.ok(toasts.some((t) => t.includes("pidió frenar")));
});
