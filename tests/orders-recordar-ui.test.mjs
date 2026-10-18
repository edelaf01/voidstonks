import { test, after } from "node:test";
import assert from "node:assert/strict";

function creaElemento(tag) {
  const elem = {
    tagName: tag.toUpperCase(),
    className: "",
    textContent: "",
    hidden: false,
    type: "",
    id: "",
    title: "",
    checked: false,
    disabled: false,
    children: [],
    parentNode: null,
    _listeners: {},
    addEventListener(evento, fn) {
      (this._listeners[evento] ??= []).push(fn);
    },
    async click() {
      const handlers = [...(this._listeners["click"] || [])];
      for (const h of handlers) {
        await h();
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
    insertBefore(nuevo, ref) {
      if (nuevo.parentNode) nuevo.parentNode.removeChild(nuevo);
      nuevo.parentNode = this;
      if (!ref) {
        this.children.push(nuevo);
        return nuevo;
      }
      const idx = this.children.indexOf(ref);
      if (idx === -1) {
        this.children.push(nuevo);
      } else {
        this.children.splice(idx, 0, nuevo);
      }
      return nuevo;
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

const docOriginal = globalThis.document;
const storageOriginal = globalThis.sessionStorage;
const localOriginal = globalThis.localStorage;
const nativoOriginal = globalThis.voidstonksNativo;

globalThis.document = { createElement: creaElemento };
globalThis.sessionStorage = {
  getItem: () => null,
  setItem() {},
  removeItem() {}
};
globalThis.localStorage = {
  getItem: () => null,
  setItem() {},
  removeItem() {}
};
globalThis.atob ??= (s) => Buffer.from(s, "base64").toString("binary");

const { state } = await import("../deploy/js/state.js");
const { montaRecordar } = await import("../deploy/js/ui.components/market/ui_orders_recordar.js");

const esperaMicrotareas = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
};

const jwt = (payload) => {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "HS256" })}.${b64(payload)}.firma`;
};

const nuevoForm = () => {
  const form = creaElemento("form");
  const cabecera = creaElemento("h2");
  cabecera.className = "orders-header";
  const campo = creaElemento("div");
  campo.className = "orders-field";
  const submit = creaElemento("button");
  submit.className = "orders-submit";
  form.append(cabecera, campo, submit);
  return { form, cabecera, campo, submit };
};

after(() => {
  if (docOriginal === undefined) delete globalThis.document;
  else globalThis.document = docOriginal;
  if (storageOriginal === undefined) delete globalThis.sessionStorage;
  else globalThis.sessionStorage = storageOriginal;
  if (localOriginal === undefined) delete globalThis.localStorage;
  else globalThis.localStorage = localOriginal;
  if (nativoOriginal === undefined) delete globalThis.voidstonksNativo;
  else globalThis.voidstonksNativo = nativoOriginal;
});

test("montaje inserta la fila orders-remember justo antes del submit y oculta", () => {
  const { form, cabecera, campo, submit } = nuevoForm();
  montaRecordar(form, submit, () => {});
  assert.equal(form.children.length, 4);
  assert.equal(form.children[0], cabecera);
  assert.equal(form.children[1], campo);
  assert.equal(form.children[2].className, "orders-remember");
  assert.equal(form.children[2].hidden, true);
  assert.equal(form.children[3], submit);
});

test("no disponible mantiene fila oculta marcada undefined y sin orders-saved", async () => {
  delete globalThis.voidstonksNativo;
  const { form: formSin, submit: submitSin } = nuevoForm();
  const hSin = montaRecordar(formSin, submitSin, () => {});
  await esperaMicrotareas();
  const fSin = formSin.children.find((c) => c.className === "orders-remember");
  assert.equal(fSin.hidden, true);
  assert.equal(hSin.marcada(), undefined);
  assert.equal(formSin.children.some((c) => c.className === "orders-saved"), false);

  globalThis.voidstonksNativo = {
    wfm: async (tipo) => {
      if (tipo === "wfm_recordadas") {
        return { status: 200, cuerpo: JSON.stringify({ disponible: false, guardadas: false, nombre: null }) };
      }
      return { status: 200, cuerpo: "{}" };
    }
  };
  try {
    const { form: formNoDisp, submit: submitNoDisp } = nuevoForm();
    const hNoDisp = montaRecordar(formNoDisp, submitNoDisp, () => {});
    await esperaMicrotareas();
    const fNoDisp = formNoDisp.children.find((c) => c.className === "orders-remember");
    assert.equal(fNoDisp.hidden, true);
    assert.equal(hNoDisp.marcada(), undefined);
    assert.equal(formNoDisp.children.some((c) => c.className === "orders-saved"), false);
  } finally {
    delete globalThis.voidstonksNativo;
  }
});

test("disponible sin guardadas muestra fila casilla desmarcada y marcada responde", async () => {
  globalThis.voidstonksNativo = {
    wfm: async (tipo) => {
      if (tipo === "wfm_recordadas") {
        return { status: 200, cuerpo: JSON.stringify({ disponible: true, guardadas: false, nombre: null }) };
      }
      return { status: 200, cuerpo: "{}" };
    }
  };
  try {
    const { form, submit } = nuevoForm();
    const h = montaRecordar(form, submit, () => {});
    await esperaMicrotareas();
    const fila = form.children.find((c) => c.className === "orders-remember");
    assert.equal(fila.hidden, false);
    const casilla = fila.children.find((c) => c.tagName === "INPUT");
    assert.equal(casilla.checked, false);
    assert.equal(h.marcada(), false);
    casilla.checked = true;
    assert.equal(h.marcada(), true);
    assert.equal(form.children.some((c) => c.className === "orders-saved"), false);
  } finally {
    delete globalThis.voidstonksNativo;
  }
});

test("guardadas con nombre marca casilla inserta orders-saved y usa texto segun idioma", async () => {
  globalThis.voidstonksNativo = {
    wfm: async (tipo) => {
      if (tipo === "wfm_recordadas") {
        return { status: 200, cuerpo: JSON.stringify({ disponible: true, guardadas: true, nombre: "Tenno_X" }) };
      }
      return { status: 200, cuerpo: "{}" };
    }
  };
  try {
    state.currentLang = "es";
    const { form: formEs, submit: submitEs } = nuevoForm();
    montaRecordar(formEs, submitEs, () => {});
    await esperaMicrotareas();
    const filaEs = formEs.children.find((c) => c.className === "orders-remember");
    const casillaEs = filaEs.children.find((c) => c.tagName === "INPUT");
    assert.equal(casillaEs.checked, true);
    assert.equal(formEs.children[1].className, "orders-saved");
    assert.equal(formEs.children[1].children[0].textContent, "Entrar como Tenno_X");

    state.currentLang = "en";
    const { form: formEn, submit: submitEn } = nuevoForm();
    montaRecordar(formEn, submitEn, () => {});
    await esperaMicrotareas();
    assert.equal(formEn.children[1].className, "orders-saved");
    assert.equal(formEn.children[1].children[0].textContent, "Sign in as Tenno_X");
  } finally {
    state.currentLang = "es";
    delete globalThis.voidstonksNativo;
  }
});

test("guardadas con caracteres html en nombre se asignan como texto literal", async () => {
  globalThis.voidstonksNativo = {
    wfm: async (tipo) => {
      if (tipo === "wfm_recordadas") {
        return { status: 200, cuerpo: JSON.stringify({ disponible: true, guardadas: true, nombre: "<b>Tenno</b>" }) };
      }
      return { status: 200, cuerpo: "{}" };
    }
  };
  try {
    state.currentLang = "es";
    const { form, submit } = nuevoForm();
    montaRecordar(form, submit, () => {});
    await esperaMicrotareas();
    const caja = form.children.find((c) => c.className === "orders-saved");
    assert.equal(caja.children[0].textContent, "Entrar como <b>Tenno</b>");
  } finally {
    delete globalThis.voidstonksNativo;
  }
});

test("guardadas sin nombre utiliza texto loginSavedAnon", async () => {
  globalThis.voidstonksNativo = {
    wfm: async (tipo) => {
      if (tipo === "wfm_recordadas") {
        return { status: 200, cuerpo: JSON.stringify({ disponible: true, guardadas: true, nombre: null }) };
      }
      return { status: 200, cuerpo: "{}" };
    }
  };
  try {
    state.currentLang = "es";
    const { form, submit } = nuevoForm();
    montaRecordar(form, submit, () => {});
    await esperaMicrotareas();
    const caja = form.children.find((c) => c.className === "orders-saved");
    assert.equal(caja.children[0].textContent, "Entrar con la cuenta guardada");
  } finally {
    delete globalThis.voidstonksNativo;
  }
});

test("click en entrar deshabilita botones pide login recordado y notifica resultado", async () => {
  const token = jwt({ exp: Math.floor(Date.now() / 1000) + 3600 });
  const llamadas = [];
  globalThis.voidstonksNativo = {
    wfm: async (tipo, peticion) => {
      llamadas.push({ tipo, peticion });
      if (tipo === "wfm_recordadas") {
        return { status: 200, cuerpo: JSON.stringify({ disponible: true, guardadas: true, nombre: "Tenno" }) };
      }
      if (tipo === "wfm_login_recordado") {
        return {
          status: 200,
          cuerpo: JSON.stringify({
            token,
            ingameName: "Tenno",
            userSlug: "tenno",
            authorized: true,
            platform: "pc"
          })
        };
      }
      return { status: 200, cuerpo: "{}" };
    }
  };

  let resultado = null;
  try {
    const { form, submit } = nuevoForm();
    montaRecordar(form, submit, (r) => {
      resultado = r;
    });
    await esperaMicrotareas();
    const caja = form.children.find((c) => c.className === "orders-saved");
    const [btnEntrar, btnOlvidar] = caja.children;
    await btnEntrar.click();
    assert.equal(btnEntrar.disabled, true);
    assert.equal(btnOlvidar.disabled, true);
    assert.equal(llamadas.some((l) => l.tipo === "wfm_login_recordado"), true);
    assert.deepEqual(resultado, { ok: true, ingameName: "Tenno", authorized: true });
  } finally {
    delete globalThis.voidstonksNativo;
  }

  globalThis.voidstonksNativo = {
    wfm: async (tipo) => {
      if (tipo === "wfm_recordadas") {
        return { status: 200, cuerpo: JSON.stringify({ disponible: true, guardadas: true, nombre: "Tenno" }) };
      }
      if (tipo === "wfm_login_recordado") {
        return { status: 401, cuerpo: JSON.stringify({ error: "no_saved" }) };
      }
      return { status: 200, cuerpo: "{}" };
    }
  };
  let resultadoErr = null;
  try {
    const { form: fErr, submit: sErr } = nuevoForm();
    montaRecordar(fErr, sErr, (r) => {
      resultadoErr = r;
    });
    await esperaMicrotareas();
    const cajaErr = fErr.children.find((c) => c.className === "orders-saved");
    const [btnEntrarErr, btnOlvidarErr] = cajaErr.children;
    await btnEntrarErr.click();
    assert.equal(btnEntrarErr.disabled, true);
    assert.equal(btnOlvidarErr.disabled, true);
    assert.deepEqual(resultadoErr, { ok: false, error: "no_saved" });
  } finally {
    delete globalThis.voidstonksNativo;
  }
});

test("click en olvidar envia POST a wfm_olvidar extrae caja y desmarca casilla", async () => {
  const llamadas = [];
  globalThis.voidstonksNativo = {
    wfm: async (tipo, peticion) => {
      llamadas.push({ tipo, peticion });
      if (tipo === "wfm_recordadas") {
        return { status: 200, cuerpo: JSON.stringify({ disponible: true, guardadas: true, nombre: "Tenno" }) };
      }
      if (tipo === "wfm_olvidar") {
        return { status: 200, cuerpo: JSON.stringify({ ok: true }) };
      }
      return { status: 200, cuerpo: "{}" };
    }
  };

  try {
    const { form, submit } = nuevoForm();
    montaRecordar(form, submit, () => {});
    await esperaMicrotareas();
    const fila = form.children.find((c) => c.className === "orders-remember");
    const casilla = fila.children.find((c) => c.tagName === "INPUT");
    assert.equal(casilla.checked, true);
    const caja = form.children.find((c) => c.className === "orders-saved");
    assert.ok(caja);
    const [, btnOlvidar] = caja.children;
    await btnOlvidar.click();
    const llamadaOlv = llamadas.find((l) => l.tipo === "wfm_olvidar");
    assert.ok(llamadaOlv);
    assert.equal(llamadaOlv.peticion.metodo, "POST");
    assert.equal(form.children.includes(caja), false);
    assert.equal(casilla.checked, false);
  } finally {
    delete globalThis.voidstonksNativo;
  }
});
