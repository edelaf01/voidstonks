import { test, after } from "node:test";
import assert from "node:assert/strict";

let almacen = new Map();
const store = {
  getItem: (k) => (almacen.has(k) ? almacen.get(k) : null),
  setItem: (k, v) => almacen.set(k, String(v)),
  removeItem: (k) => almacen.delete(k)
};

const nativoOriginal = globalThis.voidstonksNativo;
const sessionOriginal = globalThis.sessionStorage;
const localOriginal = globalThis.localStorage;
const fetchOriginal = globalThis.fetch;

globalThis.sessionStorage = store;
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.atob ??= (s) => Buffer.from(s, "base64").toString("binary");

const peticiones = [];
globalThis.fetch = async (url, init) => {
  peticiones.push({ url: String(url), init });
  return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
};

const auth = await import("../deploy/js/services/market/wfm_auth.service.js");

function jwt(payload) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "HS256" })}.${b64(payload)}.firmaFalsa`;
}

const dentroDe = (ms) => Math.floor((Date.now() + ms) / 1000);

after(() => {
  if (nativoOriginal === undefined) delete globalThis.voidstonksNativo;
  else globalThis.voidstonksNativo = nativoOriginal;
  if (sessionOriginal === undefined) delete globalThis.sessionStorage;
  else globalThis.sessionStorage = sessionOriginal;
  if (localOriginal === undefined) delete globalThis.localStorage;
  else globalThis.localStorage = localOriginal;
  if (fetchOriginal === undefined) delete globalThis.fetch;
  else globalThis.fetch = fetchOriginal;
});

test("login con puente envia parametro recordar segun corresponda", async () => {
  const llamadas = [];
  globalThis.voidstonksNativo = {
    wfm: async (tipo, peticion) => {
      llamadas.push({ tipo, peticion });
      return {
        status: 200,
        cuerpo: JSON.stringify({
          token: jwt({ exp: dentroDe(3600) }),
          ingameName: "Tenno",
          userSlug: "tenno",
          authorized: true
        })
      };
    }
  };

  try {
    await auth.login("a@b.c", "p", "pc", true);
    assert.equal(llamadas.length, 1);
    const c1 = JSON.parse(llamadas[0].peticion.cuerpo);
    assert.equal(c1.recordar, true);

    await auth.login("a@b.c", "p", "pc", false);
    assert.equal(llamadas.length, 2);
    const c2 = JSON.parse(llamadas[1].peticion.cuerpo);
    assert.equal(c2.recordar, false);

    await auth.login("a@b.c", "p", "pc");
    assert.equal(llamadas.length, 3);
    const c3 = JSON.parse(llamadas[2].peticion.cuerpo);
    assert.equal(Object.hasOwn(c3, "recordar"), false);
  } finally {
    delete globalThis.voidstonksNativo;
  }
});

test("en entorno web sin puente las funciones de recordar devuelven valores por defecto sin red", async () => {
  delete globalThis.voidstonksNativo;
  peticiones.length = 0;

  const rec = await auth.credencialesRecordadas();
  assert.deepEqual(rec, { disponible: false, guardadas: false, nombre: null });
  assert.equal(peticiones.length, 0);

  const log = await auth.loginRecordado();
  assert.deepEqual(log, { ok: false, error: "no_saved" });
  assert.equal(peticiones.length, 0);

  await auth.olvidarCredenciales();
  assert.equal(peticiones.length, 0);

  await auth.login("web@b.c", "pass", "pc", true);
  const llamadaLogin = peticiones.find((p) => p.url.includes("type=wfm_login"));
  assert.ok(llamadaLogin);
  const cuerpo = JSON.parse(llamadaLogin.init.body);
  assert.equal(Object.hasOwn(cuerpo, "recordar"), false);
});

test("credencialesRecordadas normaliza respuesta del puente y tolera fallos", async () => {
  const casos = [
    [{ disponible: 1, guardadas: "si", nombre: "Tenno" }, { disponible: true, guardadas: true, nombre: "Tenno" }],
    [{ disponible: true, guardadas: true, nombre: "" }, { disponible: true, guardadas: true, nombre: null }],
    [{ disponible: true, guardadas: true, nombre: 123 }, { disponible: true, guardadas: true, nombre: null }],
    [{ disponible: false, guardadas: false, nombre: null }, { disponible: false, guardadas: false, nombre: null }]
  ];

  for (const [respuesta, esperado] of casos) {
    globalThis.voidstonksNativo = {
      wfm: async () => ({ status: 200, cuerpo: JSON.stringify(respuesta) })
    };
    try {
      const res = await auth.credencialesRecordadas();
      assert.deepEqual(res, esperado);
    } finally {
      delete globalThis.voidstonksNativo;
    }
  }

  globalThis.voidstonksNativo = {
    wfm: async () => {
      throw new Error("fallo de comunicacion");
    }
  };
  try {
    assert.deepEqual(await auth.credencialesRecordadas(), { disponible: false, guardadas: false, nombre: null });
  } finally {
    delete globalThis.voidstonksNativo;
  }

  globalThis.voidstonksNativo = {
    wfm: async () => ({ status: 200, cuerpo: "{roto" })
  };
  try {
    assert.deepEqual(await auth.credencialesRecordadas(), { disponible: false, guardadas: false, nombre: null });
  } finally {
    delete globalThis.voidstonksNativo;
  }
});

test("loginRecordado gestiona respuesta valida y guarda plataforma en sessionStorage", async () => {
  const token = jwt({ exp: dentroDe(3600) });
  const llamadas = [];
  globalThis.voidstonksNativo = {
    wfm: async (tipo, peticion) => {
      llamadas.push({ tipo, peticion });
      return {
        status: 200,
        cuerpo: JSON.stringify({
          token,
          ingameName: "Tenno_X",
          userSlug: "tenno_x",
          authorized: true,
          platform: "ps4"
        })
      };
    }
  };

  try {
    almacen.clear();
    const res = await auth.loginRecordado();
    assert.equal(llamadas[0].tipo, "wfm_login_recordado");
    assert.equal(llamadas[0].peticion.metodo, "POST");
    assert.deepEqual(res, { ok: true, ingameName: "Tenno_X", authorized: true });
    assert.equal(store.getItem("wfm_platform"), "ps4");
  } finally {
    delete globalThis.voidstonksNativo;
  }
});

test("loginRecordado normaliza plataforma invalida o ausente a pc", async () => {
  const token = jwt({ exp: dentroDe(3600) });
  for (const platform of ["pc2", undefined, null, "android"]) {
    globalThis.voidstonksNativo = {
      wfm: async () => ({
        status: 200,
        cuerpo: JSON.stringify({
          token,
          ingameName: "Tenno_X",
          userSlug: "tenno_x",
          authorized: true,
          platform
        })
      })
    };

    try {
      almacen.clear();
      await auth.loginRecordado();
      assert.equal(store.getItem("wfm_platform"), "pc");
    } finally {
      delete globalThis.voidstonksNativo;
    }
  }
});

test("loginRecordado mapea errores de puente y rechazo de sesion", async () => {
  const casos = [
    [{ status: 401, cuerpo: '{"error":"no_saved"}' }, { ok: false, error: "no_saved" }],
    [{ status: 401, cuerpo: '{"error":"wrong_password"}' }, { ok: false, error: "wrong_password" }]
  ];

  for (const [respuesta, esperado] of casos) {
    globalThis.voidstonksNativo = {
      wfm: async () => respuesta
    };
    try {
      const res = await auth.loginRecordado();
      assert.deepEqual(res, esperado);
    } finally {
      delete globalThis.voidstonksNativo;
    }
  }

  globalThis.voidstonksNativo = {
    wfm: async () => {
      throw new Error("error nativo");
    }
  };
  try {
    const res = await auth.loginRecordado();
    assert.deepEqual(res, { ok: false, error: "network" });
  } finally {
    delete globalThis.voidstonksNativo;
  }
});

test("olvidarCredenciales con puente ejecuta POST y tolera excepciones", async () => {
  const llamadas = [];
  globalThis.voidstonksNativo = {
    wfm: async (tipo, peticion) => {
      llamadas.push({ tipo, peticion });
      return { status: 200, cuerpo: '{"ok":true}' };
    }
  };

  try {
    await auth.olvidarCredenciales();
    assert.equal(llamadas.length, 1);
    assert.equal(llamadas[0].tipo, "wfm_olvidar");
    assert.equal(llamadas[0].peticion.metodo, "POST");
  } finally {
    delete globalThis.voidstonksNativo;
  }

  globalThis.voidstonksNativo = {
    wfm: async () => {
      throw new Error("fallo de puente");
    }
  };
  try {
    await assert.doesNotReject(async () => {
      await auth.olvidarCredenciales();
    });
  } finally {
    delete globalThis.voidstonksNativo;
  }
});
