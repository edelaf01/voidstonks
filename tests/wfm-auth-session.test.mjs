import { test } from "node:test";
import assert from "node:assert/strict";

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

// wfm tokens last 60 days but local session expires in 3 h: removing wfm_exp widens the XSS window
test("la caducidad local manda sobre la del JWT aunque el JWT siga vivo", () => {
  const tokenLargo = jwt({ exp: dentroDe(60 * 24 * 3600) });

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
  sesion({ token: jwt({ exp: dentroDe(3600) }) });
  assert.equal(auth.getToken(), null);
});

test("un token caducado en el propio JWT se rechaza aunque la ventana local aguante", () => {
  sesion({ token: jwt({ exp: dentroDe(-10) }), expiry: Date.now() + 3600_000 });
  assert.equal(auth.getToken(), null);
});

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

test("Mis órdenes solo en local; en la web pública, nunca", () => {
  const original = globalThis.location;
  try {
    for (const hostname of ["localhost", "127.0.0.1", "[::1]"]) {
      globalThis.location = { hostname, search: "" };
      assert.equal(auth.wfmPrivado(), true, hostname);
    }
    for (const hostname of ["voidstonks.com", "www.voidstonks.com", "abc.voidstonks.pages.dev", "localhost.evil.com"]) {
      globalThis.location = { hostname, search: "?wfm=1" };
      assert.equal(auth.wfmPrivado(), false, hostname);
    }
    globalThis.location = undefined;
    assert.equal(auth.wfmPrivado(), false);
    globalThis.location = { hostname: "voidstonks.localhost", search: "" };
    assert.equal(auth.wfmPrivado(), false, "la app de escritorio empaquetada no lo tiene");
    globalThis.voidstonksNativo = { wfmLocal: true };
    assert.equal(auth.wfmPrivado(), true, "la de escritorio arrancada desde el código fuente, sí");
  } finally { globalThis.location = original; delete globalThis.voidstonksNativo; }
});
