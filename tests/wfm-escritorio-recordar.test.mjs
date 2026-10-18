import { test } from "node:test";
import assert from "node:assert/strict";
import { creaWfm } from "../desktop/electron/src/wfm.js";
import { creaCredenciales } from "../desktop/electron/src/credenciales.js";

const json = (datos, init = {}) =>
  new Response(JSON.stringify(datos), {
    status: 200,
    ...init,
    headers: { "content-type": "application/json", ...(init.headers || {}) }
  });

const respondeSigninOk = (url) => {
  if (url.includes("/auth/signin")) {
    return json(
      { payload: { user: { ingame_name: "Tenno_X", slug: "Tenno-X" } } },
      { headers: { authorization: "JWT abc.def.ghi" } }
    );
  }
  return json({}, { status: 200 });
};

const dobleCredenciales = ({ disponible = true, guardado = null } = {}) => {
  const llamadasGuarda = [];
  const llamadasBorra = [];
  let llamadasLee = 0;
  let actual = guardado;
  return {
    credenciales: {
      disponible: () => disponible,
      lee: async () => {
        llamadasLee++;
        return actual;
      },
      guarda: async (d) => {
        llamadasGuarda.push(d);
        actual = d;
        return true;
      },
      borra: async () => {
        llamadasBorra.push(true);
        actual = null;
      }
    },
    llamadasGuarda,
    llamadasBorra,
    getLlamadasLee: () => llamadasLee
  };
};

const montaje = ({ responde = respondeSigninOk, credenciales = null } = {}) => {
  const llamadas = [];
  const disco = new Map();
  const wfm = creaWfm({
    fetch: async (url, init) => {
      llamadas.push({ url: String(url), init });
      return responde(String(url), init);
    },
    ahora: () => 1_000_000_000,
    espera: async () => {},
    rutaCatalogo: "/tmp/vs-test/wfm-catalogo.json",
    leeFichero: async (r) => {
      if (!disco.has(r)) {
        const err = new Error("ENOENT");
        err.code = "ENOENT";
        throw err;
      }
      return disco.get(r);
    },
    escribeFichero: async (r, t) => disco.set(r, t),
    credenciales
  });
  return { wfm, llamadas };
};

test("wfm_login con recordar true y signin bueno guarda credenciales y no expone contraseña", async () => {
  const d = dobleCredenciales();
  const { wfm } = montaje({ credenciales: d.credenciales });
  const { wfm: wfmSin } = montaje();
  const r1 = await wfm.ejecuta("wfm_login", {
    metodo: "POST",
    cuerpo: JSON.stringify({ email: "tenno@test.com", password: "password123", platform: "ps4", recordar: true })
  });
  const r2 = await wfmSin.ejecuta("wfm_login", {
    metodo: "POST",
    cuerpo: JSON.stringify({ email: "tenno@test.com", password: "password123", platform: "ps4" })
  });
  assert.deepEqual(r1, r2);
  assert.equal(r1.cuerpo.includes("password123"), false);
  assert.equal(d.llamadasGuarda.length, 1);
  assert.deepEqual(d.llamadasGuarda[0], {
    email: "tenno@test.com",
    password: "password123",
    platform: "ps4",
    nombre: "Tenno_X"
  });
  assert.equal(d.llamadasBorra.length, 0);
});

test("wfm_login con recordar true y signin 400 no guarda ni borra", async () => {
  const d = dobleCredenciales();
  const { wfm } = montaje({
    credenciales: d.credenciales,
    responde: () => json({ error: { password: "app.form.invalid" } }, { status: 400 })
  });
  const r = await wfm.ejecuta("wfm_login", {
    metodo: "POST",
    cuerpo: JSON.stringify({ email: "a@b.c", password: "p", platform: "pc", recordar: true })
  });
  assert.equal(r.status, 401);
  assert.equal(d.llamadasGuarda.length, 0);
  assert.equal(d.llamadasBorra.length, 0);
});

test("wfm_login con recordar false borra credenciales tanto con signin bueno como con malo", async () => {
  const d1 = dobleCredenciales();
  const { wfm: wfm1 } = montaje({ credenciales: d1.credenciales });
  const r1 = await wfm1.ejecuta("wfm_login", {
    metodo: "POST",
    cuerpo: JSON.stringify({ email: "a@b.c", password: "p", platform: "pc", recordar: false })
  });
  assert.equal(r1.status, 200);
  assert.equal(d1.llamadasGuarda.length, 0);
  assert.equal(d1.llamadasBorra.length, 1);

  const d2 = dobleCredenciales();
  const { wfm: wfm2 } = montaje({
    credenciales: d2.credenciales,
    responde: () => json({}, { status: 400 })
  });
  const r2 = await wfm2.ejecuta("wfm_login", {
    metodo: "POST",
    cuerpo: JSON.stringify({ email: "a@b.c", password: "p", platform: "pc", recordar: false })
  });
  assert.equal(r2.status, 401);
  assert.equal(d2.llamadasGuarda.length, 0);
  assert.equal(d2.llamadasBorra.length, 1);
});

test("wfm_login sin recordar o recordar no booleano ni guarda ni borra", async () => {
  for (const recordar of [undefined, "si", "false", 1, null, {}]) {
    const d = dobleCredenciales();
    const { wfm } = montaje({ credenciales: d.credenciales });
    const cuerpo = { email: "a@b.c", password: "p", platform: "pc" };
    if (recordar !== undefined) cuerpo.recordar = recordar;
    const r = await wfm.ejecuta("wfm_login", {
      metodo: "POST",
      cuerpo: JSON.stringify(cuerpo)
    });
    assert.equal(r.status, 200);
    assert.equal(d.llamadasGuarda.length, 0);
    assert.equal(d.llamadasBorra.length, 0);
  }
});

test("wfm_login sin dependencia credenciales funciona igual con recordar true", async () => {
  const { wfm } = montaje({ credenciales: null });
  const r = await wfm.ejecuta("wfm_login", {
    metodo: "POST",
    cuerpo: JSON.stringify({ email: "a@b.c", password: "p", platform: "pc", recordar: true })
  });
  assert.equal(r.status, 200);
  assert.equal(JSON.parse(r.cuerpo).token, "abc.def.ghi");
});

test("wfm_recordadas reporta no disponible sin credenciales o con disponible false sin llamar a lee", async () => {
  const { wfm: wfmSin } = montaje({ credenciales: null });
  const rSin = await wfmSin.ejecuta("wfm_recordadas");
  assert.deepEqual(rSin, {
    status: 200,
    cuerpo: JSON.stringify({ disponible: false, guardadas: false, nombre: null })
  });

  const dNoDisp = dobleCredenciales({ disponible: false });
  const { wfm: wfmNoDisp } = montaje({ credenciales: dNoDisp.credenciales });
  const rNoDisp = await wfmNoDisp.ejecuta("wfm_recordadas");
  assert.deepEqual(rNoDisp, {
    status: 200,
    cuerpo: JSON.stringify({ disponible: false, guardadas: false, nombre: null })
  });
  assert.equal(dNoDisp.getLlamadasLee(), 0);
});

test("wfm_recordadas devuelve estado y nombre sin incluir email ni password", async () => {
  const dCon = dobleCredenciales({
    disponible: true,
    guardado: { email: "privado@mail.com", password: "secreto123", platform: "ps4", nombre: "Tenno_X" }
  });
  const { wfm: wfmCon } = montaje({ credenciales: dCon.credenciales });
  const rCon = await wfmCon.ejecuta("wfm_recordadas");
  assert.deepEqual(rCon, {
    status: 200,
    cuerpo: JSON.stringify({ disponible: true, guardadas: true, nombre: "Tenno_X" })
  });
  assert.equal(rCon.cuerpo.includes("privado@mail.com"), false);
  assert.equal(rCon.cuerpo.includes("secreto123"), false);

  const dSin = dobleCredenciales({ disponible: true, guardado: null });
  const { wfm: wfmSin } = montaje({ credenciales: dSin.credenciales });
  const rSin = await wfmSin.ejecuta("wfm_recordadas");
  assert.deepEqual(rSin, {
    status: 200,
    cuerpo: JSON.stringify({ disponible: true, guardadas: false, nombre: null })
  });
});

test("wfm_login_recordado rechaza GET y reporta no_saved si no hay guardadas sin hacer fetch", async () => {
  const d = dobleCredenciales({ disponible: true, guardado: null });
  const { wfm, llamadas } = montaje({ credenciales: d.credenciales });

  const rGet = await wfm.ejecuta("wfm_login_recordado", { metodo: "GET" });
  assert.deepEqual(rGet, { status: 405, cuerpo: '{"error":"Method not allowed"}' });

  const rPost = await wfm.ejecuta("wfm_login_recordado", { metodo: "POST" });
  assert.deepEqual(rPost, { status: 401, cuerpo: '{"error":"no_saved"}' });
  assert.equal(llamadas.length, 0);
});

test("wfm_login_recordado con credenciales guardadas hace signin y retorna sesion sin password", async () => {
  const d = dobleCredenciales({
    disponible: true,
    guardado: { email: "guardado@mail.com", password: "pass-guardada", platform: "switch", nombre: "Tenno_X" }
  });
  const { wfm, llamadas } = montaje({ credenciales: d.credenciales });
  const r = await wfm.ejecuta("wfm_login_recordado", { metodo: "POST" });
  assert.equal(r.status, 200);
  const datos = JSON.parse(r.cuerpo);
  assert.equal(datos.token, "abc.def.ghi");
  assert.equal(datos.platform, "switch");
  assert.equal(r.cuerpo.includes("pass-guardada"), false);

  assert.equal(llamadas[0].url.includes("/auth/signin"), true);
  assert.equal(llamadas[0].init.headers.platform, "switch");
  assert.deepEqual(JSON.parse(llamadas[0].init.body), { email: "guardado@mail.com", password: "pass-guardada" });
});

test("wfm_login_recordado con signin 400 devuelve 401 y borra credenciales", async () => {
  const d = dobleCredenciales({
    disponible: true,
    guardado: { email: "a@b.c", password: "p", platform: "pc", nombre: "T" }
  });
  const { wfm } = montaje({
    credenciales: d.credenciales,
    responde: () => json({ error: { password: "mal" } }, { status: 400 })
  });
  const r = await wfm.ejecuta("wfm_login_recordado", { metodo: "POST" });
  assert.equal(r.status, 401);
  assert.equal(d.llamadasBorra.length, 1);
});

test("wfm_login_recordado no borra credenciales ante errores temporales de red o servidor", async () => {
  const respuestas = [
    () => json({}, { status: 429 }),
    () => json({}, { status: 500 }),
    () => json({}, { status: 403 }),
    () => {
      throw new Error("red caida");
    }
  ];

  for (const resp of respuestas) {
    const d = dobleCredenciales({
      disponible: true,
      guardado: { email: "a@b.c", password: "p", platform: "pc", nombre: "T" }
    });
    const { wfm } = montaje({ credenciales: d.credenciales, responde: resp });
    const r = await wfm.ejecuta("wfm_login_recordado", { metodo: "POST" });
    assert.notEqual(r.status, 200);
    assert.equal(d.llamadasBorra.length, 0);
  }
});

test("wfm_olvidar gestiona metodo http y borra credenciales", async () => {
  const d = dobleCredenciales();
  const { wfm } = montaje({ credenciales: d.credenciales });

  const rGet = await wfm.ejecuta("wfm_olvidar", { metodo: "GET" });
  assert.deepEqual(rGet, { status: 405, cuerpo: '{"error":"Method not allowed"}' });
  assert.equal(d.llamadasBorra.length, 0);

  const rPost = await wfm.ejecuta("wfm_olvidar", { metodo: "POST" });
  assert.deepEqual(rPost, { status: 200, cuerpo: '{"ok":true}' });
  assert.equal(d.llamadasBorra.length, 1);

  const { wfm: wfmSin } = montaje({ credenciales: null });
  const rSin = await wfmSin.ejecuta("wfm_olvidar", { metodo: "POST" });
  assert.deepEqual(rSin, { status: 200, cuerpo: '{"ok":true}' });
});

test("integracion punta a punta de recordar con creaCredenciales en memoria", async () => {
  const disco = new Map();
  const cifrado = {
    disponible: () => true,
    cifra: (t) => Buffer.from("enc:" + Buffer.from(t).toString("base64")),
    descifra: (d) => {
      const s = Buffer.isBuffer(d) ? d.toString("utf8") : String(d);
      if (!s.startsWith("enc:")) throw new Error("no enc");
      return Buffer.from(s.slice(4), "base64").toString("utf8");
    }
  };
  const creds = creaCredenciales({
    ruta: "/mem/creds.dat",
    cifrado,
    leeFichero: async (p) => {
      if (!disco.has(p)) {
        const err = new Error("ENOENT");
        err.code = "ENOENT";
        throw err;
      }
      return disco.get(p);
    },
    escribeFichero: async (p, d) => disco.set(p, d),
    renombra: async (de, a) => {
      disco.set(a, disco.get(de));
      disco.delete(de);
    },
    borraFichero: async (p) => disco.delete(p)
  });

  let estadoSignin = 200;
  const { wfm } = montaje({
    credenciales: creds,
    responde: (url) => {
      if (url.includes("/auth/signin")) {
        if (estadoSignin === 200) {
          return json(
            { payload: { user: { ingame_name: "Tenno_Int", slug: "Tenno-Int" } } },
            { headers: { authorization: "JWT jwt-token-ok" } }
          );
        }
        return json({ error: { password: "mal" } }, { status: 400 });
      }
      return json({}, { status: 200 });
    }
  });

  await wfm.ejecuta("wfm_login", {
    metodo: "POST",
    cuerpo: JSON.stringify({ email: "int@test.com", password: "p", platform: "ps4", recordar: true })
  });

  const rec1 = await wfm.ejecuta("wfm_recordadas");
  assert.deepEqual(JSON.parse(rec1.cuerpo), { disponible: true, guardadas: true, nombre: "Tenno_Int" });

  const log1 = await wfm.ejecuta("wfm_login_recordado", { metodo: "POST" });
  assert.equal(log1.status, 200);
  assert.equal(JSON.parse(log1.cuerpo).platform, "ps4");

  estadoSignin = 400;
  const logErr = await wfm.ejecuta("wfm_login_recordado", { metodo: "POST" });
  assert.equal(logErr.status, 401);

  const rec2 = await wfm.ejecuta("wfm_recordadas");
  assert.deepEqual(JSON.parse(rec2.cuerpo), { disponible: true, guardadas: false, nombre: null });

  estadoSignin = 200;
  await wfm.ejecuta("wfm_login", {
    metodo: "POST",
    cuerpo: JSON.stringify({ email: "int@test.com", password: "p", platform: "ps4", recordar: true })
  });
  await wfm.ejecuta("wfm_olvidar", { metodo: "POST" });
  const logOlv = await wfm.ejecuta("wfm_login_recordado", { metodo: "POST" });
  assert.deepEqual(logOlv, { status: 401, cuerpo: '{"error":"no_saved"}' });
});
