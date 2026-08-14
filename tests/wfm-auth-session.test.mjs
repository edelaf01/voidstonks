// Sesión de warframe.market: vida del JWT, alcance y cierre.
//
// `wfm-credentials.test.mjs` cubre que la contraseña no se filtre. Esto cubre lo de después:
// cuánto vive el token en el navegador y cuándo se considera que hay sesión. El JWT de WFM da
// acceso TOTAL a la cuenta y no tiene scopes, así que la caducidad local corta es la única
// mitigación real ante un XSS — y es justo la clase de regla que alguien "simplifica" por
// parecer redundante con la caducidad del propio JWT.

import { test } from "node:test";
import assert from "node:assert/strict";

// sessionStorage de mentira, con interruptor para simular el navegador que lo bloquea
// (modo privado de Safari, cookies de terceros desactivadas).
let almacen = new Map();
let almacenRoto = false;
const store = {
  getItem: (k) => {
    if (almacenRoto) throw new Error("sessionStorage bloqueado");
    return almacen.has(k) ? almacen.get(k) : null;
  },
  setItem: (k, v) => {
    if (almacenRoto) throw new Error("sessionStorage bloqueado");
    almacen.set(k, String(v));
  },
  removeItem: (k) => {
    if (almacenRoto) throw new Error("sessionStorage bloqueado");
    almacen.delete(k);
  },
};
globalThis.sessionStorage = store;
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.atob ??= (s) => Buffer.from(s, "base64").toString("binary");

let respuestaLogout = { ok: true, json: async () => ({ revoked: true }) };
const peticiones = [];
globalThis.fetch = async (url, init) => {
  peticiones.push({ url: String(url), init });
  return respuestaLogout;
};

const auth = await import("../deploy/js/services/market/wfm_auth.service.js");

/** JWT de mentira: solo forma y payload, la firma no se verifica en cliente. */
function jwt(payload) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "HS256" })}.${b64(payload)}.firmaFalsa`;
}

const dentroDe = (ms) => Math.floor((Date.now() + ms) / 1000);

function sesion({ token, expiry, ...resto } = {}) {
  almacen = new Map();
  almacenRoto = false;
  if (token) almacen.set("wfm_jwt", token);
  if (expiry) almacen.set("wfm_exp", String(expiry));
  for (const [k, v] of Object.entries(resto)) almacen.set(k, v);
}

test("decodeToken tolera el 'JWT ' y las comillas que se cuelan al copiar", () => {
  const t = jwt({ exp: dentroDe(3600), sub: "u" });
  assert.equal(auth.decodeToken(t).sub, "u");
  assert.equal(auth.decodeToken(`JWT ${t}`).sub, "u");
  assert.equal(auth.decodeToken(`"${t}"`).sub, "u");
  assert.equal(auth.decodeToken(`  '${t}'  `).sub, "u");
});

test("un token con forma inválida devuelve null, no revienta", () => {
  for (const malo of ["", null, undefined, "abc", "a.b", "a.b.c.d", "a.noEsBase64.c"]) {
    assert.equal(auth.decodeToken(malo), null, String(malo));
  }
});

test("isTokenValid mira la caducidad del propio JWT", () => {
  assert.equal(auth.isTokenValid(jwt({ exp: dentroDe(3600) })), true);
  assert.equal(auth.isTokenValid(jwt({ exp: dentroDe(-10) })), false, "caducado");
  assert.equal(auth.isTokenValid(jwt({ sub: "sin exp" })), false, "sin exp no vale");
});

// Esta es la regla que importa: WFM acepta el token 60 días, pero la sesión local muere en 3 h.
// Si alguien quita la comprobación de wfm_exp por "redundante", el token vive dos meses en el
// navegador y la ventana ante un XSS pasa de horas a meses.
test("la caducidad local manda sobre la del JWT aunque el JWT siga vivo", () => {
  const tokenLargo = jwt({ exp: dentroDe(60 * 24 * 3600) }); // válido 60 días para WFM

  sesion({ token: tokenLargo, expiry: Date.now() + 3600_000 });
  assert.equal(auth.getToken(), tokenLargo, "dentro de la ventana local sí vale");

  sesion({ token: tokenLargo, expiry: Date.now() - 1 });
  assert.equal(auth.getToken(), null, "pasada la ventana local, no");
});

test("al caducar, la sesión se borra entera y no solo se oculta", () => {
  sesion({
    token: jwt({ exp: dentroDe(60 * 24 * 3600) }),
    expiry: Date.now() - 1,
    wfm_name: "Tenno",
    wfm_slug: "tenno",
    wfm_scope: "full",
  });
  auth.getToken();
  assert.equal(almacen.size, 0, "no puede quedar nada de la sesión en sessionStorage");
});

test("sin marca de caducidad tampoco se acepta el token", () => {
  // Un token sin su wfm_exp es una sesión a medio escribir: se descarta en vez de asumir.
  sesion({ token: jwt({ exp: dentroDe(3600) }) });
  assert.equal(auth.getToken(), null);
});

test("un token caducado en el propio JWT se rechaza aunque la ventana local aguante", () => {
  sesion({ token: jwt({ exp: dentroDe(-10) }), expiry: Date.now() + 3600_000 });
  assert.equal(auth.getToken(), null);
});

// El scope real solo se conoce al USAR el token, no al obtenerlo, así que lo corrige quien lee
// las órdenes. Aceptar cualquier cadena dejaría la UI decidiendo con un valor inventado.
test("cacheScope solo admite los dos valores reales", () => {
  sesion({});
  auth.cacheScope("full");
  assert.equal(auth.getScope(), "full");

  auth.cacheScope("public");
  assert.equal(auth.getScope(), "public");

  for (const basura of ["FULL", "admin", "", null, undefined, "publico"]) {
    auth.cacheScope(basura);
    assert.equal(auth.getScope(), "public", `no debe aceptar ${String(basura)}`);
  }
});

// Sin token pero con slug se pueden leer las órdenes públicas del perfil: es un modo de uso
// real, no una sesión rota.
test("hay sesión con token válido, o en modo público con solo el slug", () => {
  sesion({ token: jwt({ exp: dentroDe(3600) }), expiry: Date.now() + 3600_000 });
  assert.equal(auth.isLoggedIn(), true, "con token");

  sesion({ wfm_slug: "tenno" });
  assert.equal(auth.isLoggedIn(), true, "modo público");

  sesion({});
  assert.equal(auth.isLoggedIn(), false);
});

test("la plataforma cae en pc cuando no consta", () => {
  sesion({});
  assert.equal(auth.getPlatform(), "pc");
  sesion({ wfm_platform: "ps4" });
  assert.equal(auth.getPlatform(), "ps4");
});

// Sin revocar, el token sigue sirviendo 60 días aunque el usuario crea que ha salido.
test("logout revoca en WFM mandando el token, y luego limpia", async () => {
  sesion({
    token: jwt({ exp: dentroDe(3600) }),
    expiry: Date.now() + 3600_000,
    wfm_name: "Tenno",
  });
  const token = auth.getToken();
  const antes = peticiones.length;

  const res = await auth.logout();

  assert.equal(peticiones.length, antes + 1, "debe llamar a la revocación");
  const p = peticiones.at(-1);
  assert.match(p.url, /type=wfm_logout/);
  assert.equal(p.init.method, "POST");
  assert.equal(p.init.headers["X-WFM-Token"], token, "el worker necesita el token para revocar");
  assert.deepEqual(res, { ok: true, revoked: true });
  assert.equal(almacen.size, 0);
});

// Quedarse conectado en local porque no había red sería lo peor de los dos mundos.
test("sin red, logout cierra igual la sesión local", async () => {
  sesion({ token: jwt({ exp: dentroDe(3600) }), expiry: Date.now() + 3600_000 });
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("sin red"); };

  const res = await auth.logout();
  assert.deepEqual(res, { ok: true, revoked: false });
  assert.equal(almacen.size, 0, "la sesión local se borra pase lo que pase");

  globalThis.fetch = original;
});

test("sin token no se llama a la revocación", async () => {
  sesion({});
  const antes = peticiones.length;
  const res = await auth.logout();
  assert.equal(peticiones.length, antes, "no hay nada que revocar");
  assert.deepEqual(res, { ok: true, revoked: false });
});

// Safari en privado y algunos bloqueadores hacen que sessionStorage lance al tocarlo. La app
// tiene que quedarse sin sesión, no romperse al arrancar.
test("si el navegador bloquea sessionStorage, no hay sesión pero nada revienta", () => {
  sesion({ token: jwt({ exp: dentroDe(3600) }), expiry: Date.now() + 3600_000 });
  almacenRoto = true;

  assert.equal(auth.getToken(), null);
  assert.equal(auth.getIngameName(), null);
  assert.equal(auth.getUserSlug(), null);
  assert.equal(auth.getScope(), null);
  assert.equal(auth.getPlatform(), "pc");
  assert.equal(auth.isLoggedIn(), false);
  assert.doesNotThrow(() => auth.clearToken());
  assert.doesNotThrow(() => auth.cacheScope("full"));

  almacenRoto = false;
});

test("login sin credenciales no sale a la red", async () => {
  const antes = peticiones.length;
  assert.deepEqual(await auth.login("", "x"), { ok: false, error: "missing_fields" });
  assert.deepEqual(await auth.login("a@b.c", ""), { ok: false, error: "missing_fields" });
  assert.equal(peticiones.length, antes);
});
