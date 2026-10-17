import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { creaWfm } from "../desktop/electron/src/wfm.js";

const json = (datos, init = {}) =>
  new Response(JSON.stringify(datos), {
    status: 200,
    ...init,
    headers: { "content-type": "application/json", ...(init.headers || {}) }
  });

const montaje = ({
  responde = () => json({}),
  disco = new Map(),
  reloj = { t: 1_000_000_000 },
  escribeFichero
} = {}) => {
  const llamadas = [];
  const esperas = [];
  const lecturas = [];
  const escrituras = [];
  const rutaCatalogo = "/tmp/vs-test/wfm-catalogo.json";
  const wfm = creaWfm({
    fetch: async (url, init) => {
      llamadas.push({ url: String(url), init });
      return responde(String(url), init);
    },
    ahora: () => reloj.t,
    espera: async (ms) => {
      esperas.push(ms);
    },
    rutaCatalogo,
    leeFichero: async (ruta) => {
      lecturas.push(ruta);
      if (!disco.has(ruta)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return disco.get(ruta);
    },
    escribeFichero:
      escribeFichero ||
      (async (ruta, texto) => {
        escrituras.push([ruta, texto]);
        disco.set(ruta, texto);
      })
  });
  return { wfm, llamadas, esperas, lecturas, escrituras, reloj, disco, rutaCatalogo };
};

const error = (status, mensaje) => ({ status, cuerpo: JSON.stringify({ error: mensaje }) });
const ID = "a".repeat(24);
const ID2 = "b".repeat(24);
const ID3 = "0123456789abcdef01234567";

const UA = "VoidStonks/2.6 (+https://voidstonks.com)";
const V1 = "https://api.warframe.market/v1";
const V2 = "https://api.warframe.market/v2";

test("rechaza tipos desconocidos con status 400 y sin llamadas", async () => {
  const { wfm, llamadas } = montaje();
  for (const tipo of ["wfm_nada", "toString", "__proto__", "constructor", "hasOwnProperty", undefined]) {
    const res = await wfm.ejecuta(tipo);
    assert.deepEqual(res, { status: 400, cuerpo: '{"error":"Invalid type"}' });
  }
  assert.equal(llamadas.length, 0);
});

test("captura errores de red y devuelve 502 sin rechazar", async () => {
  const { wfm } = montaje({
    responde: () => {
      throw new Error("ECONNRESET");
    }
  });
  const r1 = await wfm.ejecuta("wfm_my_orders", { token: "t" });
  const r2 = await wfm.ejecuta("wfm_login", {
    metodo: "POST",
    cuerpo: JSON.stringify({ email: "a@b.c", password: "p", platform: "pc" })
  });
  const r3 = await wfm.ejecuta("wfm_order_create", {
    metodo: "POST",
    token: "t",
    cuerpo: JSON.stringify({ itemId: ID, type: "sell", platinum: 5 })
  });
  assert.deepEqual(r1, { status: 502, cuerpo: '{"error":"network"}' });
  assert.deepEqual(r2, { status: 502, cuerpo: '{"error":"network"}' });
  assert.deepEqual(r3, { status: 502, cuerpo: '{"error":"network"}' });
});

test("normaliza la peticion y parametros no validos sin realizar fetch", async () => {
  const { wfm, llamadas } = montaje();
  for (const p of [null, undefined, "x", 5]) {
    assert.deepEqual(await wfm.ejecuta("wfm_my_orders", p), error(401, "Missing token or user"));
    assert.deepEqual(await wfm.ejecuta("wfm_login", p), error(405, "Method not allowed"));
  }
  for (const params of ["user=tenno", null]) {
    assert.deepEqual(await wfm.ejecuta("wfm_my_orders", { params }), error(401, "Missing token or user"));
  }
  assert.deepEqual(await wfm.ejecuta("wfm_login", { metodo: "post", cuerpo: "{}" }), error(405, "Method not allowed"));
  assert.deepEqual(await wfm.ejecuta("wfm_login", { metodo: "PUT", cuerpo: "{}" }), error(405, "Method not allowed"));
  assert.deepEqual(await wfm.ejecuta("wfm_login", { metodo: "POST", cuerpo: "{malo" }), error(400, "Invalid body"));
  assert.deepEqual(await wfm.ejecuta("wfm_logout", { token: "" }), { status: 200, cuerpo: '{"ok":true}' });
  assert.deepEqual(await wfm.ejecuta("wfm_logout", { token: 123 }), { status: 200, cuerpo: '{"ok":true}' });
  assert.deepEqual(
    await wfm.ejecuta("wfm_login", {
      metodo: "POST",
      cuerpo: { email: "a@b.c", password: "p", platform: "pc" }
    }),
    error(400, "Missing credentials")
  );
  assert.equal(llamadas.length, 0);
});

const colaManual = ({ responde = () => json({}) } = {}) => {
  const reloj = { t: 1_000_000_000 };
  const esperas = [];
  const pendientes = [];
  const salidas = [];
  let terminadas = 0;
  const wfm = creaWfm({
    fetch: async (url) => {
      salidas.push({ url: String(url), terminadas });
      return responde(String(url));
    },
    ahora: () => reloj.t,
    espera: (ms) => {
      esperas.push(ms);
      return new Promise((resolve) => pendientes.push(() => {
        terminadas++;
        resolve();
      }));
    },
    rutaCatalogo: "/tmp/vs-test/wfm-catalogo.json",
    leeFichero: async () => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    },
    escribeFichero: async () => {}
  });
  const vacia = async () => {
    for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
  };
  const suelta = async () => {
    pendientes.shift()();
    await vacia();
  };
  return { wfm, reloj, esperas, pendientes, salidas, vacia, suelta };
};

test("la cola deja salir cada peticion solo tras terminar la espera de quinientos ms de la anterior", { timeout: 5000 }, async () => {
  const { wfm, esperas, salidas, vacia, suelta } = colaManual();
  const p1 = wfm.ejecuta("wfm_my_orders", { token: "t" });
  await vacia();
  assert.equal(salidas.length, 1);
  await p1;
  const p2 = wfm.ejecuta("wfm_my_orders", { token: "t" });
  await vacia();
  assert.equal(salidas.length, 1);
  assert.equal(esperas.length, 1);
  await suelta();
  assert.equal(salidas.length, 2);
  await p2;
  const p3 = wfm.ejecuta("wfm_my_orders", { token: "t" });
  await vacia();
  assert.equal(salidas.length, 2);
  assert.equal(esperas.length, 2);
  await suelta();
  assert.equal(salidas.length, 3);
  await p3;
  assert.deepEqual(salidas.map((s) => s.terminadas), [0, 1, 2]);
  assert.deepEqual(esperas, [500, 500, 500]);
});

test("la primera peticion tras estar parada la cola sale al instante", { timeout: 5000 }, async () => {
  const { wfm, esperas, salidas, vacia, suelta } = colaManual();
  await wfm.ejecuta("wfm_my_orders", { token: "t" });
  await suelta();
  const p2 = wfm.ejecuta("wfm_my_orders", { token: "t" });
  const p3 = wfm.ejecuta("wfm_my_orders", { token: "t" });
  await vacia();
  assert.equal(salidas.length, 2);
  assert.equal(esperas.length, 2);
  await suelta();
  assert.equal(salidas.length, 3);
  await Promise.all([p2, p3]);
  assert.deepEqual(salidas.map((s) => s.terminadas), [0, 1, 2]);
  assert.deepEqual(esperas, [500, 500, 500]);
});

test("la cola se comparte entre catalogo y mercado", { timeout: 5000 }, async () => {
  const { wfm, esperas, salidas, vacia, suelta } = colaManual({
    responde: (url) => (url.includes("/v2/items") ? json({ data: [] }) : json({}))
  });
  const pM = wfm.ejecuta("wfm_item_market", { params: { slug: "serration" } });
  const pR = wfm.ejecuta("wfm_resolve", { params: { ids: ID } });
  await vacia();
  assert.equal(salidas.length, 1);
  assert.equal(esperas.length, 1);
  await suelta();
  assert.equal(salidas.length, 2);
  assert.equal(esperas.length, 2);
  await suelta();
  assert.equal(salidas.length, 3);
  await Promise.all([pM, pR]);
  assert.deepEqual(salidas.map((s) => s.url), [
    `${V1}/items/serration/statistics`,
    `${V2}/orders/item/serration/top`,
    `${V2}/items`
  ]);
  assert.deepEqual(salidas.map((s) => s.terminadas), [0, 1, 2]);
  assert.deepEqual(esperas, [500, 500, 500]);
});

test("cabeceras por defecto para peticion anonima", async () => {
  const { wfm, llamadas } = montaje();
  await wfm.ejecuta("wfm_item_market", { params: { slug: "serration" } });
  const init = llamadas[0].init;
  assert.equal(init.method, "GET");
  assert.equal(init.body, undefined);
  assert.deepEqual(init.headers, {
    "User-Agent": UA,
    Accept: "application/json",
    platform: "pc",
    language: "en"
  });
});

test("cabecera platform se normaliza segun las plataformas permitidas", async () => {
  const { wfm, llamadas } = montaje();
  for (const p of ["pc", "ps4", "xbox", "switch", "mobile"]) {
    llamadas.length = 0;
    await wfm.ejecuta("wfm_my_orders", { params: { user: "tenno", platform: p } });
    assert.equal(llamadas[0].init.headers.platform, p);
  }
  for (const p of ["PC", "android", "", undefined]) {
    llamadas.length = 0;
    await wfm.ejecuta("wfm_my_orders", { params: { user: "tenno", platform: p } });
    assert.equal(llamadas[0].init.headers.platform, "pc");
  }
});

test("cabeceras de autenticacion con cookie y bearer cuando hay token", async () => {
  const { wfm, llamadas } = montaje();
  await wfm.ejecuta("wfm_my_orders", { token: "t" });
  assert.equal(llamadas[0].init.headers.Cookie, "JWT=t");
  assert.equal(llamadas[0].init.headers.Authorization, "Bearer t");
});

test("cabecera content-type solo se envia cuando existe cuerpo", async () => {
  const { wfm, llamadas } = montaje();
  await wfm.ejecuta("wfm_order_create", {
    metodo: "POST",
    token: "t",
    cuerpo: JSON.stringify({ itemId: ID, type: "sell", platinum: 1 })
  });
  assert.equal(llamadas[0].init.headers["Content-Type"], "application/json");
  llamadas.length = 0;
  await wfm.ejecuta("wfm_order_edit", {
    metodo: "POST",
    token: "t",
    params: { id: ID, action: "delete" }
  });
  assert.equal(llamadas[0].init.headers["Content-Type"], undefined);
});

test("convierte status 204 y 205 de wfm a status 200", async () => {
  const { wfm: wfm1 } = montaje({ responde: () => new Response(null, { status: 204 }) });
  const r1 = await wfm1.ejecuta("wfm_order_edit", {
    metodo: "POST",
    token: "t",
    params: { id: ID, action: "delete" }
  });
  assert.deepEqual(r1, { status: 200, cuerpo: '{"ok":true}' });

  const { wfm: wfm2 } = montaje({ responde: () => new Response(null, { status: 205 }) });
  const r2 = await wfm2.ejecuta("wfm_my_orders", { params: { user: "tenno" } });
  assert.deepEqual(r2, { status: 200, cuerpo: "", scope: "public" });
});

test("login valida metodo http y cuerpo json", async () => {
  const { wfm } = montaje();
  const valido = JSON.stringify({ email: "yo@x.com", password: "secreto-123", platform: "ps4" });
  assert.deepEqual(await wfm.ejecuta("wfm_login", { metodo: "GET", cuerpo: valido }), error(405, "Method not allowed"));
  assert.deepEqual(await wfm.ejecuta("wfm_login", { metodo: "POST", cuerpo: "{invalido" }), error(400, "Invalid body"));
});

test("login valida campos requeridos y longitudes de credenciales", async () => {
  const { wfm, llamadas } = montaje();
  const invalidos = [
    {},
    { password: "p", platform: "pc" },
    { email: "e@e.c", platform: "pc" },
    { email: "e@e.c", password: "p" },
    { email: 5, password: "p", platform: "pc" },
    { email: "e@e.c", password: "", platform: "pc" },
    { email: "a".repeat(255), password: "p", platform: "pc" },
    { email: "e@e.c", password: "p".repeat(257), platform: "pc" }
  ];
  for (const inv of invalidos) {
    assert.deepEqual(
      await wfm.ejecuta("wfm_login", { metodo: "POST", cuerpo: JSON.stringify(inv) }),
      error(400, "Missing credentials")
    );
  }
  assert.equal(llamadas.length, 0);

  await wfm.ejecuta("wfm_login", {
    metodo: "POST",
    cuerpo: JSON.stringify({ email: "a".repeat(254), password: "p".repeat(256), platform: "pc" })
  });
  assert.equal(llamadas.length, 1);
});

test("login envia credenciales al endpoint de signin con cabeceras correctas", async () => {
  const { wfm, llamadas } = montaje({
    responde: () => json({ payload: { user: { ingame_name: "Tenno_X" } } }, { headers: { authorization: "JWT tok" } })
  });
  await wfm.ejecuta("wfm_login", {
    metodo: "POST",
    cuerpo: JSON.stringify({ email: "yo@x.com", password: "secreto-123", platform: "ps4" })
  });
  assert.equal(llamadas[0].url, `${V1}/auth/signin`);
  assert.equal(llamadas[0].init.method, "POST");
  assert.equal(llamadas[0].init.headers.Authorization, "JWT");
  assert.equal(llamadas[0].init.headers.platform, "ps4");
  assert.equal(llamadas[0].init.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(llamadas[0].init.body), { email: "yo@x.com", password: "secreto-123" });
});

test("login mapea codigos y respuestas de error de signin", async () => {
  const casos = [
    [json({ error: { email: "app.form.invalid" } }, { status: 400 }), error(401, "email_not_found")],
    [json({ error: { password: "app.form.invalid" } }, { status: 400 }), error(401, "wrong_password")],
    [json({ error: { otro: 1 } }, { status: 400 }), error(401, "invalid_credentials")],
    [new Response("<html>", { status: 400 }), error(401, "invalid_credentials")],
    [json({}, { status: 429 }), error(429, "rate_limited")],
    [json({}, { status: 403, headers: { "cf-mitigated": "challenge" } }), error(429, "rate_limited")],
    [json({}, { status: 403 }), error(403, "invalid_credentials")],
    [json({}, { status: 500 }), error(500, "server")],
    [new Response("<html>", { status: 503 }), error(503, "server")]
  ];
  for (const [respuestaFetch, esperado] of casos) {
    const { wfm, llamadas } = montaje({ responde: () => respuestaFetch });
    const res = await wfm.ejecuta("wfm_login", {
      metodo: "POST",
      cuerpo: JSON.stringify({ email: "yo@x.com", password: "p", platform: "pc" })
    });
    assert.deepEqual(res, esperado);
    assert.equal(llamadas.length, 1);
  }
});

test("login extrae token desde cabecera authorization y valida con sondeo v2", async () => {
  const { wfm, llamadas } = montaje({
    responde: (url) =>
      url.includes("/auth/signin")
        ? json(
            { payload: { user: { ingame_name: "Tenno_X", slug: "Tenno-X" } } },
            { headers: { authorization: "JWT abc.def.ghi" } }
          )
        : json({}, { status: 200 })
  });
  const r = await wfm.ejecuta("wfm_login", {
    metodo: "POST",
    cuerpo: JSON.stringify({ email: "yo@x.com", password: "p", platform: "ps4" })
  });
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(r.cuerpo), {
    token: "abc.def.ghi",
    ingameName: "Tenno_X",
    userSlug: "tenno-x",
    authorized: true,
    diag: { via: "header", v2Status: 200 }
  });
  assert.equal(llamadas[1].url, `${V2}/orders/my`);
  assert.equal(llamadas[1].init.headers.Cookie, "JWT=abc.def.ghi");
  assert.equal(llamadas[1].init.headers.Authorization, "Bearer abc.def.ghi");
  assert.equal(llamadas[1].init.headers.platform, "ps4");
});

test("login limpia prefijo jwt sin distinguir mayusculas", async () => {
  const { wfm } = montaje({
    responde: () => json({ payload: {} }, { headers: { authorization: "jwt   xyz" } })
  });
  const r = await wfm.ejecuta("wfm_login", {
    metodo: "POST",
    cuerpo: JSON.stringify({ email: "a@b.c", password: "p", platform: "pc" })
  });
  assert.equal(JSON.parse(r.cuerpo).token, "xyz");
});

test("login extrae token desde cookies set-cookie", async () => {
  const h = new Headers({ "content-type": "application/json" });
  h.append("set-cookie", "a=1; Path=/");
  h.append("set-cookie", "JWT=tok123; Path=/; HttpOnly");
  const resp = new Response(JSON.stringify({ payload: { user: { ingame_name: "Solo" } } }), {
    status: 200,
    headers: h
  });
  const { wfm } = montaje({
    responde: (url) => (url.includes("/auth/signin") ? resp : json({}))
  });
  const r = await wfm.ejecuta("wfm_login", {
    metodo: "POST",
    cuerpo: JSON.stringify({ email: "a@b.c", password: "p", platform: "pc" })
  });
  const datos = JSON.parse(r.cuerpo);
  assert.equal(datos.token, "tok123");
  assert.equal(datos.diag.via, "cookie");
  assert.equal(datos.ingameName, "Solo");
  assert.equal(datos.userSlug, "solo");
});

test("login extrae token desde set-cookie cuando falta getsetcookie", async () => {
  const resp = {
    ok: true,
    status: 200,
    headers: { get: (n) => (n === "set-cookie" ? "JWT=viejo; Path=/" : null) },
    json: async () => ({})
  };
  const { wfm } = montaje({
    responde: (url) => (url.includes("/auth/signin") ? resp : json({}))
  });
  const r = await wfm.ejecuta("wfm_login", {
    metodo: "POST",
    cuerpo: JSON.stringify({ email: "a@b.c", password: "p", platform: "pc" })
  });
  const datos = JSON.parse(r.cuerpo);
  assert.equal(datos.token, "viejo");
  assert.equal(datos.diag.via, "cookie");
  assert.equal(datos.ingameName, null);
  assert.equal(datos.userSlug, null);
});

test("login devuelve 502 cuando la respuesta no contiene token", async () => {
  const { wfm, llamadas } = montaje({
    responde: () => json({ payload: {} })
  });
  const r = await wfm.ejecuta("wfm_login", {
    metodo: "POST",
    cuerpo: JSON.stringify({ email: "a@b.c", password: "p", platform: "pc" })
  });
  assert.deepEqual(r, error(502, "No token returned"));
  assert.equal(llamadas.length, 1);
});

test("login marca authorized en false si el sondeo devuelve 401", async () => {
  const { wfm } = montaje({
    responde: (url) =>
      url.includes("/auth/signin")
        ? json({ payload: {} }, { headers: { authorization: "JWT tok" } })
        : new Response(null, { status: 401 })
  });
  const r = await wfm.ejecuta("wfm_login", {
    metodo: "POST",
    cuerpo: JSON.stringify({ email: "a@b.c", password: "p", platform: "pc" })
  });
  const datos = JSON.parse(r.cuerpo);
  assert.equal(datos.authorized, false);
  assert.equal(datos.diag.v2Status, 401);
});

test("login no filtra contraseñas ni tokens en los registros de consola", async () => {
  const metodos = ["log", "info", "warn", "error", "debug"];
  const originales = {};
  const registros = [];
  for (const m of metodos) {
    originales[m] = console[m];
    console[m] = (...args) => {
      registros.push(args);
    };
  }
  try {
    const { wfm } = montaje({
      responde: () => json({ payload: {} }, { headers: { authorization: "JWT abc.def.ghi" } })
    });
    await wfm.ejecuta("wfm_login", {
      metodo: "POST",
      cuerpo: JSON.stringify({ email: "yo@x.com", password: "secreto-123", platform: "pc" })
    });
    await wfm.ejecuta("wfm_login", {
      metodo: "POST",
      cuerpo: JSON.stringify({ email: "mal", password: "", platform: "pc" })
    });
    for (const args of registros) {
      const texto = args
        .map((a) => {
          try {
            return typeof a === "object" ? JSON.stringify(a) : String(a);
          } catch {
            return String(a);
          }
        })
        .join(" ");
      assert.equal(texto.includes("secreto-123"), false);
      assert.equal(texto.includes("abc.def.ghi"), false);
    }
  } finally {
    for (const m of metodos) console[m] = originales[m];
  }
});

test("logout sin token devuelve ok sin peticiones", async () => {
  const { wfm, llamadas } = montaje();
  const r = await wfm.ejecuta("wfm_logout", {});
  assert.deepEqual(r, { status: 200, cuerpo: '{"ok":true}' });
  assert.equal(llamadas.length, 0);
});

test("logout con token invoca signout y reporta estado de revocacion", async () => {
  const { wfm, llamadas } = montaje({ responde: () => json({}) });
  const r = await wfm.ejecuta("wfm_logout", { token: "t" });
  assert.deepEqual(r, { status: 200, cuerpo: '{"ok":true,"revoked":true}' });
  assert.equal(llamadas[0].url, `${V2}/auth/signout`);
  assert.equal(llamadas[0].init.method, "POST");
  assert.equal(llamadas[0].init.headers.Authorization, "Bearer t");
  assert.equal(llamadas[0].init.headers["Content-Type"], undefined);
});

test("logout maneja respuesta 401 y excepciones de red", async () => {
  const { wfm: wfm1 } = montaje({ responde: () => new Response(null, { status: 401 }) });
  assert.deepEqual(await wfm1.ejecuta("wfm_logout", { token: "t" }), {
    status: 200,
    cuerpo: '{"ok":true,"revoked":false}'
  });

  const { wfm: wfm2 } = montaje({
    responde: () => {
      throw new Error("red");
    }
  });
  assert.deepEqual(await wfm2.ejecuta("wfm_logout", { token: "t" }), {
    status: 200,
    cuerpo: '{"ok":true,"revoked":false}'
  });
});

test("my orders con token valido devuelve listado privado con scope full", async () => {
  const cuerpoEsperado = '{"data":[{"id":"o1"}]}';
  const { wfm, llamadas } = montaje({ responde: () => new Response(cuerpoEsperado, { status: 200 }) });
  const r = await wfm.ejecuta("wfm_my_orders", { token: "t" });
  assert.deepEqual(r, { status: 200, cuerpo: cuerpoEsperado, scope: "full" });
  assert.equal(llamadas.length, 1);
  assert.equal(llamadas[0].url, `${V2}/orders/my`);
});

test("my orders recurre al endpoint publico si el token falla pero hay usuario", async () => {
  const cuerpoPublico = '{"data":[{"id":"pub"}]}';
  const { wfm, llamadas } = montaje({
    responde: (url) =>
      url.includes("/orders/my") ? new Response(null, { status: 401 }) : new Response(cuerpoPublico, { status: 200 })
  });
  const r = await wfm.ejecuta("wfm_my_orders", { token: "t", params: { user: "Tenno" } });
  assert.deepEqual(r, { status: 200, cuerpo: cuerpoPublico, scope: "public" });
  assert.equal(llamadas.length, 2);
  assert.equal(llamadas[1].url, `${V2}/orders/user/tenno`);
});

test("my orders valida usuario y tokens requeridos", async () => {
  const { wfm, llamadas } = montaje({ responde: () => new Response(null, { status: 401 }) });
  assert.deepEqual(await wfm.ejecuta("wfm_my_orders", { token: "t" }), error(401, "Missing token or user"));
  for (const u of ["a b", "../x", "ñu"]) {
    assert.deepEqual(await wfm.ejecuta("wfm_my_orders", { params: { user: u } }), error(400, "Invalid user"));
  }
  assert.deepEqual(await wfm.ejecuta("wfm_my_orders", {}), error(401, "Missing token or user"));
  assert.equal(llamadas.length, 1);
});

test("my orders devuelve status publico cuando el usuario no existe", async () => {
  const { wfm } = montaje({ responde: () => new Response("not found", { status: 404 }) });
  const r = await wfm.ejecuta("wfm_my_orders", { params: { user: "tenno" } });
  assert.deepEqual(r, { status: 404, cuerpo: "not found", scope: "public" });
});

test("order create valida metodo token y formato de cuerpo", async () => {
  const { wfm, llamadas } = montaje();
  assert.deepEqual(await wfm.ejecuta("wfm_order_create", { metodo: "GET" }), error(405, "Method not allowed"));
  assert.deepEqual(await wfm.ejecuta("wfm_order_create", { metodo: "POST" }), error(401, "Missing token"));
  assert.deepEqual(
    await wfm.ejecuta("wfm_order_create", { metodo: "POST", token: "t", cuerpo: "{" }),
    error(400, "Invalid body")
  );
  assert.equal(llamadas.length, 0);
});

test("order create sigue el orden de validacion de campos", async () => {
  const { wfm, llamadas } = montaje();
  assert.deepEqual(
    await wfm.ejecuta("wfm_order_create", {
      metodo: "POST",
      token: "t",
      cuerpo: JSON.stringify({ itemId: "x", type: "nope", platinum: 0, quantity: 0 })
    }),
    error(400, "Invalid itemId")
  );
  assert.deepEqual(
    await wfm.ejecuta("wfm_order_create", {
      metodo: "POST",
      token: "t",
      cuerpo: JSON.stringify({ itemId: ID, type: "nope", platinum: 0, quantity: 0 })
    }),
    error(400, "Invalid type")
  );
  assert.deepEqual(
    await wfm.ejecuta("wfm_order_create", {
      metodo: "POST",
      token: "t",
      cuerpo: JSON.stringify({ itemId: ID, type: "buy", platinum: 0, quantity: 0 })
    }),
    error(400, "Invalid platinum")
  );
  assert.deepEqual(
    await wfm.ejecuta("wfm_order_create", {
      metodo: "POST",
      token: "t",
      cuerpo: JSON.stringify({ itemId: ID, type: "buy", platinum: 1.5, quantity: 1 })
    }),
    error(400, "Invalid platinum")
  );
  assert.deepEqual(
    await wfm.ejecuta("wfm_order_create", {
      metodo: "POST",
      token: "t",
      cuerpo: JSON.stringify({ itemId: ID, type: "buy", platinum: 3, quantity: 0 })
    }),
    error(400, "Invalid quantity")
  );
  assert.equal(llamadas.length, 0);
});

test("order create filtra campos por lista blanca y normaliza tipos", async () => {
  const { wfm, llamadas } = montaje({
    responde: () => new Response('{"data":{"id":"n1"}}', { status: 200 })
  });
  const payload = {
    itemId: ID,
    type: "sell",
    platinum: "15",
    rank: 3,
    subtype: "radiant",
    perTrade: 2,
    visible: false,
    amberStars: 1,
    cyanStars: 2,
    platform: "xbox",
    extra: "no",
    user: "otro"
  };
  const r = await wfm.ejecuta("wfm_order_create", {
    metodo: "POST",
    token: "t",
    cuerpo: JSON.stringify(payload)
  });
  assert.equal(llamadas[0].url, `${V2}/order`);
  assert.equal(llamadas[0].init.method, "POST");
  assert.equal(llamadas[0].init.headers.platform, "xbox");
  assert.equal(llamadas[0].init.headers.Authorization, "Bearer t");
  assert.equal(llamadas[0].init.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(llamadas[0].init.body), {
    itemId: ID,
    type: "sell",
    platinum: 15,
    quantity: 1,
    rank: 3,
    subtype: "radiant",
    perTrade: 2,
    visible: false,
    amberStars: 1,
    cyanStars: 2
  });
  assert.equal(r.cuerpo, '{"data":{"id":"n1"}}');
});

test("order create maneja respuestas de exito y error de wfm", async () => {
  const { wfm: wfm201 } = montaje({ responde: () => new Response("", { status: 201 }) });
  assert.deepEqual(
    await wfm201.ejecuta("wfm_order_create", {
      metodo: "POST",
      token: "t",
      cuerpo: JSON.stringify({ itemId: ID, type: "sell", platinum: 5 })
    }),
    { status: 201, cuerpo: '{"ok":true}' }
  );

  const { wfm: wfm400 } = montaje({ responde: () => new Response("", { status: 400 }) });
  assert.deepEqual(
    await wfm400.ejecuta("wfm_order_create", {
      metodo: "POST",
      token: "t",
      cuerpo: JSON.stringify({ itemId: ID, type: "sell", platinum: 5 })
    }),
    { status: 400, cuerpo: '{"ok":false}' }
  );
});

test("order edit valida metodo token id y cuerpo", async () => {
  const { wfm, llamadas } = montaje();
  assert.deepEqual(await wfm.ejecuta("wfm_order_edit", { metodo: "GET" }), error(405, "Method not allowed"));
  assert.deepEqual(await wfm.ejecuta("wfm_order_edit", { metodo: "POST" }), error(401, "Missing token"));
  for (const badId of [undefined, "abc", "a".repeat(25), "g".repeat(24)]) {
    assert.deepEqual(
      await wfm.ejecuta("wfm_order_edit", { metodo: "POST", token: "t", params: { id: badId } }),
      error(400, "Invalid order id")
    );
  }
  assert.deepEqual(
    await wfm.ejecuta("wfm_order_edit", { metodo: "POST", token: "t", params: { id: ID }, cuerpo: "{" }),
    error(400, "Invalid body")
  );
  assert.deepEqual(
    await wfm.ejecuta("wfm_order_edit", { metodo: "POST", token: "t", params: { id: ID, action: "remove" } }),
    error(400, "Invalid action")
  );
  assert.deepEqual(
    await wfm.ejecuta("wfm_order_edit", { metodo: "POST", token: "t", params: { id: ID } }),
    error(400, "Invalid action")
  );
  assert.equal(llamadas.length, 0);
});

test("order edit ejecuta patch con campos permitidos para accion update", async () => {
  const { wfm, llamadas } = montaje({ responde: () => json({ ok: true }) });
  const payload = {
    platinum: 20,
    quantity: 2,
    visible: true,
    perTrade: 1,
    rank: 0,
    subtype: "a",
    itemId: "no",
    type: "buy",
    platform: "switch"
  };
  await wfm.ejecuta("wfm_order_edit", {
    metodo: "POST",
    token: "t",
    params: { id: ID, action: "update" },
    cuerpo: JSON.stringify(payload)
  });
  assert.equal(llamadas[0].url, `${V2}/order/${ID}`);
  assert.equal(llamadas[0].init.method, "PATCH");
  assert.equal(llamadas[0].init.headers.platform, "switch");
  assert.deepEqual(JSON.parse(llamadas[0].init.body), {
    platinum: 20,
    quantity: 2,
    visible: true,
    perTrade: 1,
    rank: 0,
    subtype: "a"
  });

  llamadas.length = 0;
  for (const b of ["{}", '{"foo":1}', null]) {
    assert.deepEqual(
      await wfm.ejecuta("wfm_order_edit", {
        metodo: "POST",
        token: "t",
        params: { id: ID, action: "update" },
        cuerpo: b
      }),
      error(400, "Nothing to update")
    );
  }
  assert.equal(llamadas.length, 0);
});

test("order edit ejecuta post para accion close con cantidad", async () => {
  const { wfm, llamadas } = montaje({ responde: () => json({ ok: true }) });
  await wfm.ejecuta("wfm_order_edit", {
    metodo: "POST",
    token: "t",
    params: { id: ID, action: "close" },
    cuerpo: JSON.stringify({ quantity: 3 })
  });
  assert.equal(llamadas[0].url, `${V2}/order/${ID}/close`);
  assert.equal(llamadas[0].init.method, "POST");
  assert.equal(llamadas[0].init.body, '{"quantity":3}');

  await wfm.ejecuta("wfm_order_edit", {
    metodo: "POST",
    token: "t",
    params: { id: ID, action: "close" }
  });
  assert.equal(llamadas[1].init.body, '{"quantity":1}');
});

test("order edit ejecuta delete sin cuerpo para accion delete", async () => {
  const { wfm, llamadas } = montaje({ responde: () => json({ ok: true }) });
  await wfm.ejecuta("wfm_order_edit", {
    metodo: "POST",
    token: "t",
    params: { id: ID, action: "delete" }
  });
  assert.equal(llamadas[0].url, `${V2}/order/${ID}`);
  assert.equal(llamadas[0].init.method, "DELETE");
  assert.equal(llamadas[0].init.body, undefined);
  assert.equal(llamadas[0].init.headers["Content-Type"], undefined);
});

test("order edit rechaza acciones desconocidas o ausentes", async () => {
  const { wfm, llamadas } = montaje();
  assert.deepEqual(
    await wfm.ejecuta("wfm_order_edit", {
      metodo: "POST",
      token: "t",
      params: { id: ID, action: "otro" }
    }),
    error(400, "Invalid action")
  );
  assert.equal(llamadas.length, 0);
});

test("resolve y ids devuelven vacio sin parametros o con comas", async () => {
  const { wfm, llamadas, lecturas } = montaje();
  assert.deepEqual(await wfm.ejecuta("wfm_resolve", {}), { status: 200, cuerpo: "{}" });
  assert.deepEqual(await wfm.ejecuta("wfm_resolve", { params: { ids: "," } }), { status: 200, cuerpo: "{}" });
  assert.deepEqual(await wfm.ejecuta("wfm_ids", {}), { status: 200, cuerpo: "{}" });
  assert.deepEqual(await wfm.ejecuta("wfm_ids", { params: { slugs: "," } }), { status: 200, cuerpo: "{}" });
  assert.equal(llamadas.length, 0);
  assert.equal(lecturas.length, 0);
});

test("resolve y ids buscan elementos existentes en el catalogo", async () => {
  const disco = new Map();
  const items = [
    { id: ID, slug: "ash_prime_set", name: "Ash Prime Set", thumb: "items/ash.png" },
    { id: ID2, slug: "serration", name: "Serration", thumb: "items/serration.png", maxRank: 10 }
  ];
  const { wfm, rutaCatalogo, reloj } = montaje({ disco });
  disco.set(rutaCatalogo, JSON.stringify({ t: reloj.t - 3600_000, items }));

  const rRes = await wfm.ejecuta("wfm_resolve", { params: { ids: `${ID},${ID2},${ID3}` } });
  assert.deepEqual(JSON.parse(rRes.cuerpo), {
    [ID]: { slug: "ash_prime_set", name: "Ash Prime Set", thumb: "items/ash.png" },
    [ID2]: { slug: "serration", name: "Serration", thumb: "items/serration.png", maxRank: 10 }
  });

  const rIds = await wfm.ejecuta("wfm_ids", { params: { slugs: "ash_prime_set,serration,no_existe" } });
  assert.deepEqual(JSON.parse(rIds.cuerpo), {
    ash_prime_set: { id: ID, name: "Ash Prime Set", thumb: "items/ash.png" },
    serration: { id: ID2, name: "Serration", thumb: "items/serration.png", maxRank: 10 }
  });
});

test("resolve y ids limitan la busqueda a cien elementos y eliminan duplicados", async () => {
  const disco = new Map();
  const items120 = Array.from({ length: 120 }, (_, i) => ({
    id: i.toString(16).padStart(24, "0"),
    slug: `s${i}`,
    name: `Item ${i}`,
    thumb: `thumb_${i}.png`
  }));
  const { wfm, rutaCatalogo, reloj } = montaje({ disco });
  disco.set(rutaCatalogo, JSON.stringify({ t: reloj.t, items: items120 }));

  const idsPedir = items120
    .map((it) => it.id)
    .concat(items120.slice(0, 10).map((it) => it.id))
    .join(",");
  const resResolve = JSON.parse((await wfm.ejecuta("wfm_resolve", { params: { ids: idsPedir } })).cuerpo);
  assert.equal(Object.keys(resResolve).length, 100);
  assert.equal(items120[0].id in resResolve, true);
  assert.equal(items120[99].id in resResolve, true);
  assert.equal(items120[100].id in resResolve, false);

  const slugsPedir = items120
    .map((it) => it.slug)
    .concat(items120.slice(0, 10).map((it) => it.slug))
    .join(",");
  const resIds = JSON.parse((await wfm.ejecuta("wfm_ids", { params: { slugs: slugsPedir } })).cuerpo);
  assert.equal(Object.keys(resIds).length, 100);
  assert.equal(items120[0].slug in resIds, true);
  assert.equal(items120[99].slug in resIds, true);
  assert.equal(items120[100].slug in resIds, false);
});

test("resolve y ids rechazan identificadores invalidos sin hacer fetch", async () => {
  const { wfm, llamadas } = montaje();
  assert.deepEqual(await wfm.ejecuta("wfm_resolve", { params: { ids: `${ID},xyz` } }), error(400, "Invalid id"));
  assert.deepEqual(
    await wfm.ejecuta("wfm_ids", { params: { slugs: "ash_prime_set,mal slug" } }),
    error(400, "Invalid slug")
  );
  assert.equal(llamadas.length, 0);
});

test("resolve y ids fallan con 502 cuando el catalogo no es accesible", async () => {
  const { wfm } = montaje({ responde: () => new Response(null, { status: 500 }) });
  assert.deepEqual(await wfm.ejecuta("wfm_resolve", { params: { ids: ID } }), error(502, "network"));
});

test("catalogo reutiliza copia fresca en disco sin hacer peticiones", async () => {
  const disco = new Map();
  const { wfm, rutaCatalogo, reloj, llamadas, lecturas } = montaje({ disco });
  disco.set(rutaCatalogo, JSON.stringify({ t: reloj.t - 3600_000, items: [{ id: ID, slug: "ash_prime_set", name: "Ash" }] }));
  await wfm.ejecuta("wfm_resolve", { params: { ids: ID } });
  await wfm.ejecuta("wfm_resolve", { params: { ids: ID } });
  await wfm.ejecuta("wfm_ids", { params: { slugs: "ash_prime_set" } });
  assert.equal(llamadas.length, 0);
  assert.deepEqual(lecturas, [rutaCatalogo]);
});

test("catalogo actualiza copia vieja descargando v2 items y guarda en disco", async () => {
  const disco = new Map();
  const { wfm, rutaCatalogo, reloj, llamadas, lecturas, escrituras } = montaje({
    disco,
    responde: (url) =>
      url.includes("/v2/items")
        ? json({
            data: [
              {
                id: ID,
                slug: "ash_prime_set",
                i18n: {
                  en: { name: "Ash Prime Set", thumb: "items/ash.png", icon: "i.png", description: "larga" },
                  de: { name: "Asche" }
                },
                tags: ["prime"],
                gameRef: "/Lotus/x"
              },
              {
                id: ID2,
                slug: "serration",
                maxRank: 10,
                i18n: { fr: { name: "Dentelure", thumb: "items/fr.png" } }
              },
              { i18n: { en: { name: "sin id ni slug" } } }
            ]
          })
        : json({})
  });
  disco.set(rutaCatalogo, JSON.stringify({ t: reloj.t - 25 * 3600_000, items: [] }));
  await wfm.ejecuta("wfm_resolve", { params: { ids: ID } });
  assert.equal(llamadas.length, 1);
  assert.equal(llamadas[0].url, `${V2}/items`);
  const ultimaEscritura = escrituras[escrituras.length - 1];
  assert.equal(ultimaEscritura[0], rutaCatalogo);
  assert.deepEqual(JSON.parse(ultimaEscritura[1]), {
    t: reloj.t,
    items: [
      { id: ID, slug: "ash_prime_set", name: "Ash Prime Set", thumb: "items/ash.png" },
      { id: ID2, slug: "serration", name: "Dentelure", thumb: "items/fr.png", maxRank: 10 }
    ]
  });
  await wfm.ejecuta("wfm_resolve", { params: { ids: ID } });
  assert.equal(llamadas.length, 1);
  assert.equal(lecturas.length, 1);
});

test("catalogo descarga datos si el archivo no existe o contiene datos corruptos", async () => {
  for (const c of [null, "{no json", '{"t":"ayer","items":[]}', '{"t":1,"items":{}}']) {
    const disco = new Map();
    const { wfm, rutaCatalogo, llamadas } = montaje({
      disco,
      responde: () => json({ data: [{ id: ID, slug: "ash", i18n: { en: { name: "Ash" } } }] })
    });
    if (c !== null) disco.set(rutaCatalogo, c);
    await wfm.ejecuta("wfm_resolve", { params: { ids: ID } });
    assert.equal(llamadas.length, 1);
    assert.equal(llamadas[0].url, `${V2}/items`);
  }
});

test("catalogo usa copia vieja si la descarga remota falla", async () => {
  const disco1 = new Map();
  const { wfm: wfm500, rutaCatalogo: r1, reloj: reloj1 } = montaje({
    disco: disco1,
    responde: () => new Response(null, { status: 500 })
  });
  disco1.set(r1, JSON.stringify({ t: reloj1.t - 25 * 3600_000, items: [{ id: ID, slug: "ash", name: "Ash", thumb: "t.png" }] }));
  const res500 = await wfm500.ejecuta("wfm_resolve", { params: { ids: ID } });
  assert.equal(res500.status, 200);
  assert.deepEqual(JSON.parse(res500.cuerpo), { [ID]: { slug: "ash", name: "Ash", thumb: "t.png" } });

  const disco2 = new Map();
  const { wfm: wfmThrow, rutaCatalogo: r2, reloj: reloj2 } = montaje({
    disco: disco2,
    responde: () => {
      throw new Error("red");
    }
  });
  disco2.set(r2, JSON.stringify({ t: reloj2.t - 25 * 3600_000, items: [{ id: ID, slug: "ash", name: "Ash", thumb: "t.png" }] }));
  const resThrow = await wfmThrow.ejecuta("wfm_resolve", { params: { ids: ID } });
  assert.equal(resThrow.status, 200);
  assert.deepEqual(JSON.parse(resThrow.cuerpo), { [ID]: { slug: "ash", name: "Ash", thumb: "t.png" } });
});

test("catalogo rechaza respuesta con formato invalido sin escribir en disco", async () => {
  const { wfm, escrituras } = montaje({ responde: () => json({ data: "nada" }) });
  const r = await wfm.ejecuta("wfm_resolve", { params: { ids: ID } });
  assert.deepEqual(r, error(502, "network"));
  assert.equal(escrituras.length, 0);
});

test("catalogo deduplica descargas simultaneas en vuelo", async () => {
  const { wfm, llamadas, lecturas } = montaje({
    responde: () => json({ data: [{ id: ID, slug: "ash", i18n: { en: { name: "Ash" } } }] })
  });
  const [r1, r2, r3] = await Promise.all([
    wfm.ejecuta("wfm_resolve", { params: { ids: ID } }),
    wfm.ejecuta("wfm_ids", { params: { slugs: "ash" } }),
    wfm.ejecuta("wfm_resolve", { params: { ids: ID } })
  ]);
  assert.equal(r1.status, 200);
  assert.equal(r2.status, 200);
  assert.equal(r3.status, 200);
  assert.equal(llamadas.length, 1);
  assert.equal(lecturas.length, 1);
});

test("catalogo tolera fallos sincronos y asincronos al escribir en disco", async () => {
  const sincronico = () => {
    throw new Error("EROFS");
  };
  const { wfm: wfmSync } = montaje({
    escribeFichero: sincronico,
    responde: () => json({ data: [{ id: ID, slug: "ash", i18n: { en: { name: "Ash" } } }] })
  });
  const rSync1 = await wfmSync.ejecuta("wfm_resolve", { params: { ids: ID } });
  assert.equal(rSync1.status, 200);
  const rSync2 = await wfmSync.ejecuta("wfm_resolve", { params: { ids: ID } });
  assert.equal(rSync2.status, 200);

  const asincronico = async () => {
    throw new Error("EROFS");
  };
  const { wfm: wfmAsync, llamadas: llamadasAsync } = montaje({
    escribeFichero: asincronico,
    responde: () => json({ data: [{ id: ID, slug: "ash", i18n: { en: { name: "Ash" } } }] })
  });
  const rAsync1 = await wfmAsync.ejecuta("wfm_resolve", { params: { ids: ID } });
  assert.equal(rAsync1.status, 200);
  const rAsync2 = await wfmAsync.ejecuta("wfm_resolve", { params: { ids: ID } });
  assert.equal(rAsync2.status, 200);
  assert.equal(llamadasAsync.length, 1);
});

test("catalogo pasa la ruta configurada a lee y escribe fichero", async () => {
  let rutaEscrita;
  const { wfm, rutaCatalogo } = montaje({
    responde: () => json({ data: [{ id: ID, slug: "ash", i18n: { en: { name: "Ash" } } }] }),
    disco: new Map(),
    escribeFichero: async (ruta) => {
      rutaEscrita = ruta;
    }
  });
  await wfm.ejecuta("wfm_resolve", { params: { ids: ID } });
  assert.equal(rutaEscrita, rutaCatalogo);
});

test("item market valida slug y rango de rank", async () => {
  const { wfm, llamadas } = montaje();
  for (const badSlug of [undefined, "a b", "x/y"]) {
    assert.deepEqual(await wfm.ejecuta("wfm_item_market", { params: { slug: badSlug } }), error(400, "Invalid slug"));
  }
  for (const badRank of ["-1", "21", "abc"]) {
    assert.deepEqual(
      await wfm.ejecuta("wfm_item_market", { params: { slug: "serration", rank: badRank } }),
      error(400, "Invalid rank")
    );
  }
  assert.equal(llamadas.length, 0);

  const r0 = await wfm.ejecuta("wfm_item_market", { params: { slug: "serration", rank: "0" } });
  assert.equal(r0.status, 200);
  const r20 = await wfm.ejecuta("wfm_item_market", { params: { slug: "serration", rank: "20" } });
  assert.equal(r20.status, 200);
});

test("item market consulta endpoints de estadisticas y mejores ordenes", async () => {
  const { wfm, llamadas } = montaje();
  await wfm.ejecuta("wfm_item_market", { params: { slug: "serration" } });
  const urls = llamadas.map((l) => l.url).sort();
  assert.deepEqual(
    urls,
    [`${V1}/items/serration/statistics`, `${V2}/orders/item/serration/top`].sort()
  );
});

test("item market devuelve objeto vacio si fallan ambas fuentes", async () => {
  const { wfm: wfmFail500 } = montaje({ responde: () => new Response(null, { status: 500 }) });
  assert.deepEqual(await wfmFail500.ejecuta("wfm_item_market", { params: { slug: "serration" } }), {
    status: 200,
    cuerpo: "{}"
  });

  const { wfm: wfmFailThrow } = montaje({
    responde: () => {
      throw new Error("red");
    }
  });
  assert.deepEqual(await wfmFailThrow.ejecuta("wfm_item_market", { params: { slug: "serration" } }), {
    status: 200,
    cuerpo: "{}"
  });
});

test("item market resume estadisticas recientes y filtra ordenes de venta y compra", async () => {
  const stats = {
    payload: {
      statistics_closed: {
        "90days": [
          { datetime: "d1", mod_rank: 0, median: 10, avg_price: 11, volume: 5, min_price: 8, max_price: 12 },
          { datetime: "d2", mod_rank: 10, median: 100, avg_price: 101, volume: 2, min_price: 90, max_price: 110 },
          { datetime: "d3", mod_rank: 0, median: 12, avg_price: 13, volume: 7, min_price: 9, max_price: 15 }
        ],
        "48hours": [
          { datetime: "2026-10-15T10", mod_rank: 0, volume: 1, median: 10, closed_price: 11 },
          { datetime: "2026-10-15T09", mod_rank: 0, volume: 3, median: 20, closed_price: 19 },
          { datetime: "2026-10-15T11", mod_rank: 0, volume: 0, median: 99, closed_price: 99 },
          { datetime: "2026-10-15T08", mod_rank: 10, volume: 2, median: 50, closed_price: 52 },
          { datetime: "2026-10-15T07", volume: 4, median: 5, closed_price: 6 }
        ]
      }
    }
  };
  const top = {
    data: {
      sell: [
        { platinum: 5, quantity: 1, rank: 0, user: { ingameName: "u1", status: "offline" } },
        { platinum: 6, quantity: 2, rank: 0, user: { ingameName: "u2", status: "ingame" } },
        { platinum: 7, quantity: 1, rank: 10, user: { ingameName: "u3", status: "online" } },
        { platinum: 8, quantity: 3, rank: 0 },
        { platinum: 9, quantity: 1, rank: 10, user: { ingameName: "u5", status: "ingame" } },
        { platinum: 10, quantity: 2, rank: 0, user: { ingameName: "u6", status: "online" } },
        { platinum: 11, quantity: 1, rank: 10, user: { ingameName: "u7", status: "online" } },
        { platinum: 12, quantity: 1, rank: 0, user: { ingameName: "u8", status: "ingame" } }
      ],
      buy: [
        { platinum: 4, quantity: 1, user: { ingameName: "b1", status: "online" } },
        { platinum: 3, quantity: 2, user: { ingameName: "b2", status: "ingame" } }
      ]
    }
  };
  const { wfm } = montaje({
    responde: (url) => (url.includes("/statistics") ? json(stats) : json(top))
  });
  const r = await wfm.ejecuta("wfm_item_market", { params: { slug: "serration" } });
  const d = JSON.parse(r.cuerpo);
  assert.equal(d.median, 12);
  assert.equal(d.avg, 13);
  assert.equal(d.volume, 7);
  assert.equal(d.min, 9);
  assert.equal(d.max, 15);
  assert.equal(d.day, "d3");
  assert.equal(d.rank, null);
  assert.equal(d.sell.length, 5);
  assert.deepEqual(d.sell, [
    { platinum: 6, quantity: 2, user: "u2", status: "ingame" },
    { platinum: 7, quantity: 1, user: "u3", status: "online" },
    { platinum: 8, quantity: 3, user: "?", status: "offline" },
    { platinum: 9, quantity: 1, user: "u5", status: "ingame" },
    { platinum: 10, quantity: 2, user: "u6", status: "online" }
  ]);
  for (const fila of d.sell) {
    assert.deepEqual(Object.keys(fila).sort(), ["platinum", "quantity", "status", "user"]);
  }
  assert.deepEqual(d.reciente, {
    "0": { ultima: 11, hora: "2026-10-15T10", mediana: 20, volumen: 4 },
    "10": { ultima: 52, hora: "2026-10-15T08", mediana: 50, volumen: 2 },
    "": { ultima: 6, hora: "2026-10-15T07", mediana: 5, volumen: 4 }
  });
});

test("item market filtra resumen por rank especifico o retrocede a general", async () => {
  const stats = {
    payload: {
      statistics_closed: {
        "90days": [
          { datetime: "d1", mod_rank: 0, median: 10, avg_price: 11, volume: 5, min_price: 8, max_price: 12 },
          { datetime: "d2", mod_rank: 10, median: 100, avg_price: 101, volume: 2, min_price: 90, max_price: 110 },
          { datetime: "d3", mod_rank: 0, median: 12, avg_price: 13, volume: 7, min_price: 9, max_price: 15 }
        ],
        "48hours": []
      }
    }
  };
  const top = {
    data: {
      sell: [
        { platinum: 5, quantity: 1, rank: 0, user: { ingameName: "u1", status: "offline" } },
        { platinum: 6, quantity: 2, rank: 0, user: { ingameName: "u2", status: "ingame" } },
        { platinum: 7, quantity: 1, rank: 10, user: { ingameName: "u3", status: "online" } },
        { platinum: 8, quantity: 3, rank: 0 },
        { platinum: 9, quantity: 1, rank: 10, user: { ingameName: "u5", status: "ingame" } },
        { platinum: 10, quantity: 2, rank: 0, user: { ingameName: "u6", status: "online" } },
        { platinum: 11, quantity: 1, rank: 10, user: { ingameName: "u7", status: "online" } },
        { platinum: 12, quantity: 1, rank: 0, user: { ingameName: "u8", status: "ingame" } }
      ],
      buy: []
    }
  };
  const { wfm } = montaje({
    responde: (url) => (url.includes("/statistics") ? json(stats) : json(top))
  });
  const r10 = await wfm.ejecuta("wfm_item_market", { params: { slug: "serration", rank: "10" } });
  const d10 = JSON.parse(r10.cuerpo);
  assert.equal(d10.median, 100);
  assert.equal(d10.day, "d2");
  assert.equal(d10.rank, 10);
  assert.deepEqual(d10.sell, [
    { platinum: 7, quantity: 1, user: "u3", status: "online" },
    { platinum: 9, quantity: 1, user: "u5", status: "ingame" },
    { platinum: 11, quantity: 1, user: "u7", status: "online" }
  ]);

  const r5 = await wfm.ejecuta("wfm_item_market", { params: { slug: "serration", rank: "5" } });
  const d5 = JSON.parse(r5.cuerpo);
  assert.equal(d5.median, 12);
  assert.equal(d5.day, "d3");
  assert.equal(d5.rank, 5);
});

test("market batch devuelve vacio si no recibe slugs", async () => {
  const { wfm, llamadas } = montaje();
  assert.deepEqual(await wfm.ejecuta("wfm_market_batch", {}), { status: 200, cuerpo: "{}" });
  assert.equal(llamadas.length, 0);
});

test("market batch procesa hasta treinta slugs en serie y omite fallidos", async () => {
  const { wfm: wfm35, llamadas: ll35 } = montaje();
  const slugs35 = Array.from({ length: 35 }, (_, i) => `s${i}`).concat(["s0", "s1"]).join(",");
  await wfm35.ejecuta("wfm_market_batch", { params: { slugs: slugs35 } });
  assert.equal(ll35.length, 60);
  for (const l of ll35) {
    assert.equal(l.url.includes("/s30/"), false);
  }

  const { wfm: wfmOmit } = montaje({
    responde: (url) =>
      url.includes("/malo/")
        ? new Response(null, { status: 500 })
        : json({ payload: { statistics_closed: { "90days": [] } } })
  });
  const rOmit = await wfmOmit.ejecuta("wfm_market_batch", { params: { slugs: "bueno,malo" } });
  assert.deepEqual(Object.keys(JSON.parse(rOmit.cuerpo)), ["bueno"]);

  const { wfm: wfmSerie, llamadas: llSerie } = montaje();
  await wfmSerie.ejecuta("wfm_market_batch", { params: { slugs: "a,b" } });
  assert.equal(llSerie.length, 4);
  assert.equal(llSerie[0].url.includes("/a/"), true);
  assert.equal(llSerie[1].url.includes("/a/"), true);
  assert.equal(llSerie[2].url.includes("/b/"), true);
  assert.equal(llSerie[3].url.includes("/b/"), true);
});

test("market batch rechaza slug invalido sin hacer fetch", async () => {
  const { wfm, llamadas } = montaje();
  assert.deepEqual(await wfm.ejecuta("wfm_market_batch", { params: { slugs: "bueno,mal slug" } }), error(400, "Invalid slug"));
  assert.equal(llamadas.length, 0);
});

test("espera por defecto utiliza settimeout para espaciar peticiones", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    let llamadas = 0;
    const wfm = creaWfm({
      fetch: async () => {
        llamadas++;
        return json({});
      },
      ahora: () => 1_000_000_000,
      rutaCatalogo: "/tmp/vs-wfm-test.json"
    });
    const p1 = wfm.ejecuta("wfm_my_orders", { token: "t" });
    const p2 = wfm.ejecuta("wfm_my_orders", { token: "t" });
    await new Promise((r) => setImmediate(r));
    assert.equal(llamadas, 1);
    mock.timers.tick(499);
    await new Promise((r) => setImmediate(r));
    assert.equal(llamadas, 1);
    mock.timers.tick(1);
    await Promise.all([p1, p2]);
    assert.equal(llamadas, 2);
  } finally {
    mock.timers.reset();
  }
});

test("lee y escribe fichero por defecto persisten el catalogo en disco", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vs-wfm-"));
  const rutaCatalogo = join(dir, "catalogo.json");
  try {
    const wfm1 = creaWfm({
      fetch: async (url) => {
        if (String(url).includes("/v2/items")) {
          return json({
            data: [{ id: ID, slug: "serration", i18n: { en: { name: "Serration" } } }]
          });
        }
        return json({});
      },
      ahora: () => 1_000_000_000,
      espera: async () => {},
      rutaCatalogo
    });

    const r1 = await wfm1.ejecuta("wfm_ids", { params: { slugs: "serration" } });
    assert.equal(r1.status, 200);
    assert.deepEqual(JSON.parse(r1.cuerpo), {
      serration: { id: ID, name: "Serration" }
    });

    const contenido = JSON.parse(await readFile(rutaCatalogo, "utf8"));
    assert.equal(contenido.t, 1_000_000_000);
    assert.equal(Array.isArray(contenido.items), true);
    assert.equal(contenido.items.length, 1);
    assert.equal(contenido.items[0].slug, "serration");

    const wfm2 = creaWfm({
      fetch: async () => assert.fail("no debe llamar a fetch"),
      ahora: () => 1_000_000_000,
      espera: async () => {},
      rutaCatalogo
    });

    const r2 = await wfm2.ejecuta("wfm_ids", { params: { slugs: "serration" } });
    assert.equal(r2.status, 200);
    assert.deepEqual(JSON.parse(r2.cuerpo), {
      serration: { id: ID, name: "Serration" }
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("login tolera fallo al leer texto en sondeo de ordenes", async () => {
  const { wfm } = montaje({
    responde: (url) =>
      url.includes("/auth/signin")
        ? json(
            { payload: { user: { ingame_name: "Tenno_X", slug: "Tenno-X" } } },
            { headers: { authorization: "JWT abc.def.ghi" } }
          )
        : { status: 200, ok: true, text: () => Promise.reject(new Error("x")) }
  });
  const res = await wfm.ejecuta("wfm_login", {
    metodo: "POST",
    cuerpo: JSON.stringify({ email: "yo@x.com", password: "p", platform: "pc" })
  });
  assert.equal(res.status, 200);
  const datos = JSON.parse(res.cuerpo);
  assert.equal(datos.authorized, true);
  assert.equal(datos.token, "abc.def.ghi");
  assert.equal(datos.diag.v2Status, 200);
});

test("logout tolera fallo al leer texto de signout", async () => {
  const { wfm } = montaje({
    responde: () => ({ ok: true, status: 200, text: () => Promise.reject(new Error("x")) })
  });
  const res = await wfm.ejecuta("wfm_logout", { token: "t" });
  assert.deepEqual(res, { status: 200, cuerpo: '{"ok":true,"revoked":true}' });
});

test("my orders tolera fallo al leer texto en respuesta no ok de orders my", async () => {
  const { wfm, llamadas } = montaje({
    responde: (url) =>
      url.includes("/orders/my")
        ? { ok: false, status: 401, text: () => Promise.reject(new Error("x")) }
        : new Response('{"data":[]}', { status: 200 })
  });
  const res = await wfm.ejecuta("wfm_my_orders", { token: "t", params: { user: "tenno" } });
  assert.deepEqual(res, { status: 200, cuerpo: '{"data":[]}', scope: "public" });
  assert.equal(llamadas.length, 2);
  assert.equal(llamadas[1].url, `${V2}/orders/user/tenno`);
});

test("item market con rank cero incluye dias y ordenes sin mod rank o rank explicito", async () => {
  const stats = {
    payload: {
      statistics_closed: {
        "90days": [
          { datetime: "d1", median: 10, avg_price: 10, volume: 1 },
          { datetime: "d2", mod_rank: 5, median: 50, avg_price: 50, volume: 1 }
        ],
        "48hours": []
      }
    }
  };
  const top = {
    data: {
      sell: [
        { platinum: 10, quantity: 1, user: { ingameName: "u1", status: "online" } },
        { platinum: 50, quantity: 1, rank: 5, user: { ingameName: "u2", status: "online" } }
      ],
      buy: []
    }
  };
  const { wfm } = montaje({
    responde: (url) => (url.includes("/statistics") ? json(stats) : json(top))
  });
  const res = await wfm.ejecuta("wfm_item_market", { params: { slug: "serration", rank: "0" } });
  const datos = JSON.parse(res.cuerpo);
  assert.equal(datos.median, 10);
  assert.equal(datos.day, "d1");
  assert.equal(datos.sell.length, 1);
  assert.equal(datos.sell[0].platinum, 10);
});

test("catalogo procesa items sin informacion i18n", async () => {
  const { wfm } = montaje({
    responde: () =>
      json({
        data: [{ id: ID, slug: "sin_i18n" }]
      })
  });
  const res = await wfm.ejecuta("wfm_ids", { params: { slugs: "sin_i18n" } });
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(res.cuerpo), {
    sin_i18n: { id: ID }
  });
});

test("login asigna slug nulo si el usuario carece de slug e ingame name", async () => {
  const { wfm } = montaje({
    responde: (url) =>
      url.includes("/auth/signin")
        ? json({ payload: { user: { slug: "", ingame_name: "" } } }, { headers: { authorization: "JWT tok" } })
        : json({}, { status: 200 })
  });
  const res = await wfm.ejecuta("wfm_login", {
    metodo: "POST",
    cuerpo: JSON.stringify({ email: "a@b.c", password: "p", platform: "pc" })
  });
  const datos = JSON.parse(res.cuerpo);
  assert.equal(datos.ingameName, null);
  assert.equal(datos.userSlug, null);
});

test("toda peticion a wfm lleva un timeout de veinte segundos", async (t) => {
  const originalTimeout = AbortSignal.timeout.bind(AbortSignal);
  const argumentos = [];
  t.mock.method(AbortSignal, "timeout", (...args) => {
    argumentos.push(...args);
    return originalTimeout(...args);
  });
  const { wfm, llamadas } = montaje();
  await wfm.ejecuta("wfm_my_orders", { token: "t" });
  assert.equal(argumentos[0], 20000);
  assert.equal(llamadas[0].init.signal instanceof AbortSignal, true);
});

test("un timeout cuenta como error de red y no frena", async () => {
  let primero = true;
  const { wfm, llamadas } = montaje({
    responde: () => {
      if (primero) {
        primero = false;
        throw new DOMException("timeout", "TimeoutError");
      }
      return json({ data: [] });
    }
  });
  const r1 = await wfm.ejecuta("wfm_my_orders", { token: "t" });
  assert.deepEqual(r1, { status: 502, cuerpo: '{"error":"network"}' });
  const r2 = await wfm.ejecuta("wfm_my_orders", { token: "t" });
  assert.equal(r2.status, 200);
  assert.equal(llamadas.length, 2);
});

test("un 429 frena segun retry-after acotado entre cinco segundos y dos minutos", async () => {
  const casos = [
    ["10", 10000],
    ["1", 5000],
    ["999", 120000],
    ["0", 30000],
    ["abc", 30000],
    [null, 30000]
  ];
  for (const [retry, ms] of casos) {
    let primero = true;
    const { wfm, llamadas, reloj } = montaje({
      responde: () => {
        if (primero) {
          primero = false;
          return json({}, { status: 429, headers: retry === null ? {} : { "Retry-After": retry } });
        }
        return json({ data: [] });
      }
    });
    const r1 = await wfm.ejecuta("wfm_my_orders", { params: { user: "tenno" } });
    assert.equal(r1.status, 429);
    reloj.t += ms - 1;
    const r2 = await wfm.ejecuta("wfm_my_orders", { params: { user: "tenno" } });
    assert.deepEqual(r2, { status: 429, cuerpo: '{"error":"wfm_frenado"}', scope: "public" });
    assert.equal(llamadas.length, 1);
    reloj.t += 1;
    const r3 = await wfm.ejecuta("wfm_my_orders", { params: { user: "tenno" } });
    assert.equal(r3.status, 200);
    assert.equal(llamadas.length, 2);
  }
});

test("un 403 con cf-mitigated frena media hora y sin la cabecera no frena", async () => {
  let primeroA = true;
  const { wfm: wfmA, llamadas: llA, reloj: relojA } = montaje({
    responde: () => {
      if (primeroA) {
        primeroA = false;
        return json({}, { status: 403, headers: { "cf-mitigated": "challenge" } });
      }
      return json({ data: [] });
    }
  });
  const rA1 = await wfmA.ejecuta("wfm_my_orders", { params: { user: "tenno" } });
  assert.deepEqual(rA1, { status: 429, cuerpo: '{"error":"wfm_frenado"}', scope: "public" });
  relojA.t += 30 * 60 * 1000 - 1;
  const rA2 = await wfmA.ejecuta("wfm_my_orders", { params: { user: "tenno" } });
  assert.deepEqual(rA2, { status: 429, cuerpo: '{"error":"wfm_frenado"}', scope: "public" });
  assert.equal(llA.length, 1);
  relojA.t += 1;
  const rA3 = await wfmA.ejecuta("wfm_my_orders", { params: { user: "tenno" } });
  assert.equal(rA3.status, 200);
  assert.equal(llA.length, 2);

  let primeroB = true;
  const { wfm: wfmB, llamadas: llB } = montaje({
    responde: () => {
      if (primeroB) {
        primeroB = false;
        return json({}, { status: 403 });
      }
      return json({ data: [] });
    }
  });
  const rB1 = await wfmB.ejecuta("wfm_my_orders", { params: { user: "tenno" } });
  assert.equal(rB1.status, 403);
  const rB2 = await wfmB.ejecuta("wfm_my_orders", { params: { user: "tenno" } });
  assert.equal(rB2.status, 200);
  assert.equal(llB.length, 2);
});

test("un 5xx frena treinta segundos y un 4xx no", async () => {
  for (const status of [500, 503]) {
    let primero = true;
    const { wfm, llamadas, reloj } = montaje({
      responde: () => {
        if (primero) {
          primero = false;
          return new Response(null, { status });
        }
        return json({ data: [] });
      }
    });
    const r1 = await wfm.ejecuta("wfm_my_orders", { params: { user: "tenno" } });
    assert.equal(r1.status, status);
    reloj.t += 29_999;
    const r2 = await wfm.ejecuta("wfm_my_orders", { params: { user: "tenno" } });
    assert.deepEqual(r2, { status: 429, cuerpo: '{"error":"wfm_frenado"}', scope: "public" });
    assert.equal(llamadas.length, 1);
    reloj.t += 1;
    const r3 = await wfm.ejecuta("wfm_my_orders", { params: { user: "tenno" } });
    assert.equal(r3.status, 200);
    assert.equal(llamadas.length, 2);
  }

  let primero404 = true;
  const { wfm: wfm404, llamadas: ll404 } = montaje({
    responde: () => {
      if (primero404) {
        primero404 = false;
        return new Response(null, { status: 404 });
      }
      return json({ data: [] });
    }
  });
  const r404_1 = await wfm404.ejecuta("wfm_my_orders", { params: { user: "tenno" } });
  assert.equal(r404_1.status, 404);
  const r404_2 = await wfm404.ejecuta("wfm_my_orders", { params: { user: "tenno" } });
  assert.equal(r404_2.status, 200);
  assert.equal(ll404.length, 2);
});

test("el freno se queda con el plazo mas largo", async () => {
  const reloj = { t: 1_000_000_000 };
  const llamadas = [];
  const diferidas = [];
  const wfm = creaWfm({
    fetch: (url, init) => {
      llamadas.push({ url: String(url), init });
      return new Promise((resolve) => diferidas.push(resolve));
    },
    ahora: () => reloj.t,
    espera: async () => {},
    rutaCatalogo: "/tmp/vs-test/wfm-catalogo.json",
    leeFichero: async () => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    },
    escribeFichero: async () => {}
  });

  const p1 = wfm.ejecuta("wfm_my_orders", { params: { user: "tenno" } });
  const p2 = wfm.ejecuta("wfm_my_orders", { params: { user: "tenno" } });
  await new Promise((r) => setImmediate(r));
  assert.equal(llamadas.length, 2);

  diferidas[1](json({}, { status: 429, headers: { "Retry-After": "120" } }));
  diferidas[0](new Response(null, { status: 500 }));
  await Promise.all([p1, p2]);

  const t0 = reloj.t;
  reloj.t = t0 + 30_000;
  const r3 = await wfm.ejecuta("wfm_my_orders", { params: { user: "tenno" } });
  assert.deepEqual(r3, { status: 429, cuerpo: '{"error":"wfm_frenado"}', scope: "public" });
  assert.equal(llamadas.length, 2);

  reloj.t = t0 + 120_000;
  const p4 = wfm.ejecuta("wfm_my_orders", { params: { user: "tenno" } });
  await new Promise((r) => setImmediate(r));
  assert.equal(llamadas.length, 3);
  diferidas[2](json({ data: [] }));
  const r4 = await p4;
  assert.equal(r4.status, 200);
});

test("el freno se comprueba antes y despues de esperar turno", { timeout: 5000 }, async () => {
  const reloj = { t: 1_000_000_000 };
  const llamadas = [];
  const diferidasFetch = [];
  const esperas = [];
  const diferidasEspera = [];
  const wfm = creaWfm({
    fetch: (url, init) => {
      llamadas.push({ url: String(url), init });
      return new Promise((resolve) => diferidasFetch.push(resolve));
    },
    ahora: () => reloj.t,
    espera: (ms) => {
      esperas.push(ms);
      return new Promise((resolve) => diferidasEspera.push(resolve));
    },
    rutaCatalogo: "/tmp/vs-test/wfm-catalogo.json",
    leeFichero: async () => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    },
    escribeFichero: async () => {}
  });

  const pA = wfm.ejecuta("wfm_my_orders", { params: { user: "tenno" } });
  await new Promise((r) => setImmediate(r));
  assert.equal(llamadas.length, 1);
  assert.equal(diferidasFetch.length, 1);

  const pB = wfm.ejecuta("wfm_my_orders", { params: { user: "tenno" } });
  await new Promise((r) => setImmediate(r));
  assert.equal(esperas.length, 1);
  assert.equal(llamadas.length, 1);

  diferidasFetch[0](new Response(null, { status: 500 }));
  await pA;

  diferidasEspera[0]();
  const resB = await pB;
  assert.deepEqual(resB, { status: 429, cuerpo: '{"error":"wfm_frenado"}', scope: "public" });
  assert.equal(llamadas.length, 1);

  const resC = await wfm.ejecuta("wfm_my_orders", { params: { user: "tenno" } });
  assert.deepEqual(resC, { status: 429, cuerpo: '{"error":"wfm_frenado"}', scope: "public" });
  assert.equal(llamadas.length, 1);
  assert.equal(esperas.length, 2);
});

test("con el freno puesto login devuelve 429 y market batch omite los slugs frenados", { timeout: 5000 }, async () => {
  const { wfm: wfmA, llamadas: llA } = montaje({
    responde: (url) => (url.includes("/orders/user/") ? new Response(null, { status: 500 }) : json({}))
  });
  await wfmA.ejecuta("wfm_my_orders", { params: { user: "tenno" } });
  const rLogin = await wfmA.ejecuta("wfm_login", {
    metodo: "POST",
    cuerpo: JSON.stringify({ email: "yo@x.com", password: "p", platform: "pc" })
  });
  assert.deepEqual(rLogin, error(429, "rate_limited"));
  assert.equal(llA.length, 1);

  const rLogout = await wfmA.ejecuta("wfm_logout", { token: "t" });
  assert.deepEqual(rLogout, { status: 200, cuerpo: '{"ok":true,"revoked":false}' });
  assert.equal(llA.length, 1);

  const rCreate = await wfmA.ejecuta("wfm_order_create", {
    metodo: "POST",
    token: "t",
    cuerpo: JSON.stringify({ itemId: ID, type: "sell", platinum: 5 })
  });
  assert.deepEqual(rCreate, { status: 429, cuerpo: '{"error":"wfm_frenado"}' });
  assert.equal(llA.length, 1);

  let respondeStatsB;
  const { wfm: wfmB, salidas, vacia, suelta } = colaManual({
    responde: (url) =>
      url.includes("/b/statistics")
        ? new Promise((r) => {
            respondeStatsB = () => r(new Response(null, { status: 503 }));
          })
        : url.includes("/b/")
          ? new Response(null, { status: 503 })
          : json({ payload: { statistics_closed: { "90days": [] } } })
  });
  const pBatch = wfmB.ejecuta("wfm_market_batch", { params: { slugs: "a,b,c" } });
  await vacia();
  await suelta();
  await suelta();
  assert.deepEqual(salidas.map((s) => s.url), [`${V1}/items/a/statistics`, `${V2}/orders/item/a/top`, `${V1}/items/b/statistics`]);
  respondeStatsB();
  await vacia();
  await suelta();
  const rBatch = await pBatch;
  assert.deepEqual(Object.keys(JSON.parse(rBatch.cuerpo)), ["a"]);
  assert.deepEqual(salidas.map((s) => s.url), [`${V1}/items/a/statistics`, `${V2}/orders/item/a/top`, `${V1}/items/b/statistics`]);
  assert.equal(salidas.some((s) => s.url.includes("/c/")), false);
});

test("market batch deja salir /b/top si su turno llega antes que el 503 de /b/statistics", { timeout: 5000 }, async () => {
  let respondeStatsB;
  const { wfm, salidas, vacia, suelta } = colaManual({
    responde: (url) =>
      url.includes("/b/statistics")
        ? new Promise((r) => {
            respondeStatsB = () => r(new Response(null, { status: 503 }));
          })
        : url.includes("/b/")
          ? new Response(null, { status: 503 })
          : json({ payload: { statistics_closed: { "90days": [] } } })
  });
  const pBatch = wfm.ejecuta("wfm_market_batch", { params: { slugs: "a,b,c" } });
  await vacia();
  await suelta();
  await suelta();
  await suelta();
  assert.deepEqual(salidas.map((s) => s.url), [
    `${V1}/items/a/statistics`,
    `${V2}/orders/item/a/top`,
    `${V1}/items/b/statistics`,
    `${V2}/orders/item/b/top`
  ]);
  respondeStatsB();
  const rBatch = await pBatch;
  assert.deepEqual(Object.keys(JSON.parse(rBatch.cuerpo)), ["a"]);
  assert.equal(salidas.length, 4);
  assert.equal(salidas.some((s) => s.url.includes("/c/")), false);
});

test("el catalogo recuerda el fallo diez minutos si no hay copia vieja", async () => {
  const fallos = [
    () => new Response(null, { status: 404 }),
    () => {
      throw new Error("red");
    },
    () => json({ data: "nada" })
  ];
  for (const falla of fallos) {
    let primero = true;
    const { wfm, llamadas, reloj } = montaje({
      responde: () => {
        if (primero) {
          primero = false;
          return falla();
        }
        return json({ data: [{ id: ID, slug: "ash", i18n: { en: { name: "Ash" } } }] });
      }
    });
    const r1 = await wfm.ejecuta("wfm_resolve", { params: { ids: ID } });
    assert.deepEqual(r1, error(502, "network"));
    assert.equal(llamadas.length, 1);

    const r2 = await wfm.ejecuta("wfm_resolve", { params: { ids: ID } });
    assert.deepEqual(r2, error(502, "network"));
    assert.equal(llamadas.length, 1);

    reloj.t += 10 * 60 * 1000 - 1;
    const r3 = await wfm.ejecuta("wfm_resolve", { params: { ids: ID } });
    assert.deepEqual(r3, error(502, "network"));
    assert.equal(llamadas.length, 1);

    reloj.t += 1;
    const r4 = await wfm.ejecuta("wfm_resolve", { params: { ids: ID } });
    assert.equal(r4.status, 200);
    assert.deepEqual(JSON.parse(r4.cuerpo), { [ID]: { slug: "ash", name: "Ash" } });
    assert.equal(llamadas.length, 2);
  }
});

test("con copia vieja el fallo del catalogo se recuerda y sirve la copia sin pedir", async () => {
  const fallos = [
    () => new Response(null, { status: 404 }),
    () => {
      throw new Error("red");
    },
    () => {
      throw new DOMException("timeout", "TimeoutError");
    }
  ];
  for (const falla of fallos) {
    const disco = new Map();
    const { wfm, rutaCatalogo, reloj, llamadas } = montaje({ disco, responde: falla });
    disco.set(rutaCatalogo, JSON.stringify({ t: reloj.t - 25 * 3600_000, items: [{ id: ID, slug: "ash", name: "Ash", thumb: "t.png" }] }));
    const vieja = { [ID]: { slug: "ash", name: "Ash", thumb: "t.png" } };

    const r1 = await wfm.ejecuta("wfm_resolve", { params: { ids: ID } });
    assert.equal(r1.status, 200);
    assert.deepEqual(JSON.parse(r1.cuerpo), vieja);
    assert.equal(llamadas.length, 1);

    const r2 = await wfm.ejecuta("wfm_resolve", { params: { ids: ID } });
    assert.equal(r2.status, 200);
    assert.deepEqual(JSON.parse(r2.cuerpo), vieja);
    assert.equal(llamadas.length, 1);

    reloj.t += 10 * 60 * 1000 - 1;
    const r3 = await wfm.ejecuta("wfm_ids", { params: { slugs: "ash" } });
    assert.equal(r3.status, 200);
    assert.deepEqual(JSON.parse(r3.cuerpo), { ash: { id: ID, name: "Ash", thumb: "t.png" } });
    assert.equal(llamadas.length, 1);

    reloj.t += 1;
    const r4 = await wfm.ejecuta("wfm_resolve", { params: { ids: ID } });
    assert.equal(r4.status, 200);
    assert.deepEqual(JSON.parse(r4.cuerpo), vieja);
    assert.equal(llamadas.length, 2);
  }
});

test("el fallo recordado del catalogo caduca si el reloj va hacia atras", async () => {
  let primero = true;
  const { wfm, llamadas, reloj } = montaje({
    responde: () => {
      if (primero) {
        primero = false;
        return new Response(null, { status: 404 });
      }
      return json({ data: [{ id: ID, slug: "ash", i18n: { en: { name: "Ash" } } }] });
    }
  });
  const r1 = await wfm.ejecuta("wfm_resolve", { params: { ids: ID } });
  assert.deepEqual(r1, error(502, "network"));
  assert.equal(llamadas.length, 1);

  reloj.t -= 1000;
  const r2 = await wfm.ejecuta("wfm_resolve", { params: { ids: ID } });
  assert.equal(r2.status, 200);
  assert.deepEqual(JSON.parse(r2.cuerpo), { [ID]: { slug: "ash", name: "Ash" } });
  assert.equal(llamadas.length, 2);
});

test("el catalogo de disco solo es fresco con edad entre cero y veinticuatro horas", async () => {
  const casos = [
    [0, 0],
    [24 * 3600_000 - 1, 0],
    [24 * 3600_000, 1],
    [-1, 1],
    [-3600_000, 1]
  ];
  for (const [edad, esperadas] of casos) {
    const disco = new Map();
    const { wfm, rutaCatalogo, reloj, llamadas } = montaje({
      disco,
      responde: () => json({ data: [{ id: ID, slug: "ash", i18n: { en: { name: "Ash" } } }] })
    });
    disco.set(rutaCatalogo, JSON.stringify({ t: reloj.t - edad, items: [{ id: ID, slug: "ash", name: "Ash" }] }));
    const res = await wfm.ejecuta("wfm_resolve", { params: { ids: ID } });
    assert.equal(res.status, 200);
    assert.equal(llamadas.length, esperadas);
  }
});

test("la cola deja salir peticiones concurrentes de una en una tras cada espera", { timeout: 5000 }, async () => {
  const { wfm, esperas, pendientes, salidas, vacia, suelta } = colaManual();
  const p1 = wfm.ejecuta("wfm_my_orders", { token: "t" });
  const p2 = wfm.ejecuta("wfm_my_orders", { token: "t" });
  const p3 = wfm.ejecuta("wfm_my_orders", { token: "t" });
  await vacia();
  assert.equal(salidas.length, 1);
  assert.equal(esperas.length, 1);
  await suelta();
  assert.equal(salidas.length, 2);
  await suelta();
  assert.equal(salidas.length, 3);
  await Promise.all([p1, p2, p3]);
  assert.deepEqual(salidas.map((s) => s.terminadas), [0, 1, 2]);
  assert.deepEqual(esperas, [500, 500, 500]);
  assert.equal(pendientes.length, 1);
});

test("el reloj no influye en la cola aunque salte hacia atras o hacia delante", { timeout: 5000 }, async () => {
  const { wfm, reloj, esperas, salidas, vacia, suelta } = colaManual();
  const p1 = wfm.ejecuta("wfm_my_orders", { token: "t" });
  const p2 = wfm.ejecuta("wfm_my_orders", { token: "t" });
  const p3 = wfm.ejecuta("wfm_my_orders", { token: "t" });
  const p4 = wfm.ejecuta("wfm_my_orders", { token: "t" });
  await vacia();
  assert.equal(salidas.length, 1);
  assert.equal(esperas.length, 1);
  reloj.t -= 3_600_000;
  await vacia();
  assert.equal(salidas.length, 1);
  await suelta();
  assert.equal(salidas.length, 2);
  reloj.t += 7_200_000;
  await vacia();
  assert.equal(salidas.length, 2);
  await suelta();
  assert.equal(salidas.length, 3);
  reloj.t -= 1000;
  await vacia();
  assert.equal(salidas.length, 3);
  await suelta();
  assert.equal(salidas.length, 4);
  await Promise.all([p1, p2, p3, p4]);
  assert.deepEqual(salidas.map((s) => s.terminadas), [0, 1, 2, 3]);
  assert.deepEqual(esperas, [500, 500, 500, 500]);
});

test("normaliza 304 a 200 y status fuera de rango a 502", async () => {
  const { wfm: wfm304 } = montaje({ responde: () => new Response(null, { status: 304 }) });
  const r304 = await wfm304.ejecuta("wfm_my_orders", { params: { user: "tenno" } });
  assert.deepEqual(r304, { status: 200, cuerpo: "", scope: "public" });

  const { wfm: wfm600 } = montaje({
    responde: () => ({ status: 600, ok: false, headers: new Headers(), text: async () => "x" })
  });
  const r600 = await wfm600.ejecuta("wfm_my_orders", { params: { user: "tenno" } });
  assert.deepEqual(r600, { status: 502, cuerpo: "x", scope: "public" });

  const { wfm: wfm150 } = montaje({
    responde: () => ({ status: 150, ok: false, headers: new Headers(), text: async () => "x" })
  });
  const r150 = await wfm150.ejecuta("wfm_my_orders", { params: { user: "tenno" } });
  assert.deepEqual(r150, { status: 502, cuerpo: "x", scope: "public" });

  const { wfm: wfmEdit } = montaje({ responde: () => new Response(null, { status: 304 }) });
  const rEdit = await wfmEdit.ejecuta("wfm_order_edit", {
    metodo: "POST",
    token: "t",
    params: { id: ID, action: "delete" }
  });
  assert.deepEqual(rEdit, { status: 200, cuerpo: '{"ok":false}' });
});

test("un freno corto no hace recordar el fallo del catalogo", async () => {
  const responde = (url) =>
    url.includes("/orders/user/")
      ? json({}, { status: 429, headers: { "Retry-After": "5" } })
      : json({ data: [{ id: ID, slug: "ash", i18n: { en: { name: "Ash" } } }] });

  const { wfm, llamadas, reloj } = montaje({ responde });
  await wfm.ejecuta("wfm_my_orders", { params: { user: "tenno" } });
  const r1 = await wfm.ejecuta("wfm_resolve", { params: { ids: ID } });
  assert.deepEqual(r1, error(502, "network"));
  assert.equal(llamadas.length, 1);
  reloj.t += 5000;
  const r2 = await wfm.ejecuta("wfm_resolve", { params: { ids: ID } });
  assert.equal(r2.status, 200);
  assert.deepEqual(JSON.parse(r2.cuerpo), { [ID]: { slug: "ash", name: "Ash" } });
  assert.equal(llamadas.length, 2);
  assert.equal(llamadas[1].url, `${V2}/items`);

  const disco = new Map();
  const { wfm: wfmB, llamadas: llB, reloj: relojB, rutaCatalogo } = montaje({ disco, responde });
  disco.set(rutaCatalogo, JSON.stringify({ t: relojB.t - 25 * 3600_000, items: [{ id: ID, slug: "ash", name: "Vieja" }] }));
  await wfmB.ejecuta("wfm_my_orders", { params: { user: "tenno" } });
  const rB1 = await wfmB.ejecuta("wfm_resolve", { params: { ids: ID } });
  assert.deepEqual(JSON.parse(rB1.cuerpo), { [ID]: { slug: "ash", name: "Vieja" } });
  assert.equal(llB.length, 1);
  relojB.t += 5000;
  const rB2 = await wfmB.ejecuta("wfm_resolve", { params: { ids: ID } });
  assert.deepEqual(JSON.parse(rB2.cuerpo), { [ID]: { slug: "ash", name: "Ash" } });
  assert.equal(llB.length, 2);
});

test("un salto del reloj hacia atras o hacia delante no junta salidas de la cola", async () => {
  let real = 0;
  let reloj = 1_000_000_000;
  const timers = [];
  const agenda = (en, fn) => timers.push({ en, fn });
  const salidas = [];
  const wfm = creaWfm({
    fetch: async () => {
      salidas.push(real);
      return json({});
    },
    ahora: () => reloj,
    espera: (ms) => new Promise((resolve) => agenda(real + ms, resolve)),
    rutaCatalogo: "/tmp/vs-test/wfm-catalogo.json",
    leeFichero: async () => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    },
    escribeFichero: async () => {}
  });
  const pide = () => wfm.ejecuta("wfm_my_orders", { token: "t" });
  for (let i = 0; i < 4; i++) agenda(0, pide);
  agenda(499, () => {
    reloj -= 1000;
    pide();
  });
  agenda(500.5, pide);
  agenda(1250, () => {
    reloj += 3_600_000;
    pide();
  });
  while (timers.length) {
    timers.sort((a, b) => a.en - b.en);
    const siguiente = timers.shift();
    reloj += siguiente.en - real;
    real = siguiente.en;
    siguiente.fn();
    for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
  }
  assert.deepEqual(salidas, [0, 500, 1000, 1500, 2000, 2500, 3000]);
});

test("login entrega el token aunque falle el sondeo de ordenes", async () => {
  const errores = [new Error("ECONNRESET"), new DOMException("timeout", "TimeoutError")];
  for (const err of errores) {
    const { wfm, llamadas } = montaje({
      responde: (url) => {
        if (url.includes("/auth/signin")) return json({ payload: {} }, { headers: { authorization: "JWT tok" } });
        throw err;
      }
    });
    const r = await wfm.ejecuta("wfm_login", {
      metodo: "POST",
      cuerpo: JSON.stringify({ email: "a@b.c", password: "p", platform: "pc" })
    });
    assert.equal(r.status, 200);
    assert.deepEqual(JSON.parse(r.cuerpo), {
      token: "tok",
      ingameName: null,
      userSlug: null,
      authorized: false,
      diag: { via: "header", v2Status: 0 }
    });
    assert.equal(llamadas.length, 2);
  }
});

test("my orders con freno o 5xx no cae a la consulta publica ni a 401", async () => {
  const casos = [
    [() => json({ error: "x" }, { status: 429 }), { status: 429, cuerpo: '{"error":"x"}' }],
    [() => new Response("caido", { status: 500 }), { status: 500, cuerpo: "caido" }],
    [() => new Response("caido", { status: 503 }), { status: 503, cuerpo: "caido" }]
  ];
  for (const [responde, esperado] of casos) {
    const { wfm, llamadas } = montaje({ responde });
    const r1 = await wfm.ejecuta("wfm_my_orders", { token: "t", params: { user: "tenno" } });
    assert.deepEqual(r1, esperado);
    assert.equal(llamadas.length, 1);
    assert.equal(llamadas[0].url, `${V2}/orders/my`);
    const r2 = await wfm.ejecuta("wfm_my_orders", { token: "t" });
    assert.deepEqual(r2, { status: 429, cuerpo: '{"error":"wfm_frenado"}' });
    assert.equal(llamadas.length, 1);
  }
});

test("el catalogo usa un timeout de sesenta segundos y el resto veinte", async (t) => {
  const originalTimeout = AbortSignal.timeout.bind(AbortSignal);
  const argumentos = [];
  t.mock.method(AbortSignal, "timeout", (...args) => {
    argumentos.push(...args);
    return originalTimeout(...args);
  });
  const { wfm, llamadas } = montaje({
    responde: (url) => (url.includes("/v2/items") ? json({ data: [{ id: ID, slug: "ash", i18n: { en: { name: "Ash" } } }] }) : json({}))
  });
  await wfm.ejecuta("wfm_my_orders", { token: "t" });
  await wfm.ejecuta("wfm_resolve", { params: { ids: ID } });
  await wfm.ejecuta("wfm_item_market", { params: { slug: "serration" } });
  assert.deepEqual(argumentos, [20000, 60000, 20000, 20000]);
  assert.equal(llamadas[1].url, `${V2}/items`);
  assert.equal(llamadas.length, 4);
});

test("con token un desafio de cloudflare llega como 429 y nunca como 401 ni 403", async () => {
  const casos = [
    ["wfm_my_orders", { token: "t" }],
    ["wfm_my_orders", { token: "t", params: { user: "tenno" } }],
    ["wfm_order_edit", { metodo: "POST", token: "t", params: { id: ID, action: "delete" } }],
    ["wfm_order_create", { metodo: "POST", token: "t", cuerpo: JSON.stringify({ itemId: ID, type: "sell", platinum: 5 }) }]
  ];
  for (const [tipo, peticion] of casos) {
    let ultima;
    const { wfm, llamadas } = montaje({
      responde: () => {
        ultima = new Response("<html>desafio</html>", { status: 403, headers: { "cf-mitigated": "challenge" } });
        return ultima;
      }
    });
    const r1 = await wfm.ejecuta(tipo, peticion);
    assert.deepEqual(r1, { status: 429, cuerpo: '{"error":"wfm_frenado"}' });
    assert.equal(llamadas.length, 1);
    assert.equal(ultima.bodyUsed, true);
    const r2 = await wfm.ejecuta(tipo, peticion);
    assert.deepEqual(r2, { status: 429, cuerpo: '{"error":"wfm_frenado"}' });
    assert.equal(llamadas.length, 1);
  }
  const { wfm: wfmFallo } = montaje({
    responde: () => ({
      status: 403,
      ok: false,
      headers: new Headers({ "cf-mitigated": "challenge" }),
      body: {
        cancel: async () => {
          throw new Error("bloqueado");
        }
      }
    })
  });
  const rFallo = await wfmFallo.ejecuta("wfm_my_orders", { token: "t" });
  assert.deepEqual(rFallo, { status: 429, cuerpo: '{"error":"wfm_frenado"}' });
});

test("un 403 sin cf-mitigated sigue llegando como 403", async () => {
  const { wfm, llamadas } = montaje({
    responde: () => new Response("prohibido", { status: 403 })
  });
  const rEdit = await wfm.ejecuta("wfm_order_edit", {
    metodo: "POST",
    token: "t",
    params: { id: ID, action: "delete" }
  });
  assert.deepEqual(rEdit, { status: 403, cuerpo: "prohibido" });
  const rCreate = await wfm.ejecuta("wfm_order_create", {
    metodo: "POST",
    token: "t",
    cuerpo: JSON.stringify({ itemId: ID, type: "sell", platinum: 5 })
  });
  assert.deepEqual(rCreate, { status: 403, cuerpo: "prohibido" });
  const rUser = await wfm.ejecuta("wfm_my_orders", { params: { user: "tenno" } });
  assert.deepEqual(rUser, { status: 403, cuerpo: "prohibido", scope: "public" });
  const rToken = await wfm.ejecuta("wfm_my_orders", { token: "t" });
  assert.deepEqual(rToken, error(401, "Missing token or user"));
  assert.equal(llamadas.length, 4);
});
