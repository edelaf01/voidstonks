import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, stat, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cifradoDeElectron, creaCredenciales } from "../desktop/electron/src/credenciales.js";

const cifradoFalso = (disponible = true) => ({
  disponible: () => disponible,
  cifra: (t) => Buffer.from("enc:" + Buffer.from(t).toString("base64")),
  descifra: (datos) => {
    const s = Buffer.isBuffer(datos) ? datos.toString("utf8") : String(datos);
    if (!s.startsWith("enc:")) throw new Error("no enc");
    return Buffer.from(s.slice(4), "base64").toString("utf8");
  }
});

const discoEnMemoria = () => {
  const disco = new Map();
  const escrituras = [];
  const borrados = [];
  let lecturas = 0;
  return {
    disco,
    escrituras,
    borrados,
    getLecturas: () => lecturas,
    leeFichero: async (p) => {
      lecturas++;
      if (!disco.has(p)) {
        const err = new Error("ENOENT");
        err.code = "ENOENT";
        throw err;
      }
      return disco.get(p);
    },
    escribeFichero: async (p, d, opts) => {
      escrituras.push({ p, d, opts });
      disco.set(p, d);
    },
    renombra: async (de, a) => {
      if (!disco.has(de)) {
        const err = new Error("ENOENT");
        err.code = "ENOENT";
        throw err;
      }
      disco.set(a, disco.get(de));
      disco.delete(de);
    },
    borraFichero: async (p) => {
      borrados.push(p);
      disco.delete(p);
    }
  };
};

test("cifradoDeElectron comprueba backend en linux", () => {
  const seguro = (backend) => ({
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => backend
  });

  assert.equal(cifradoDeElectron(seguro("basic_text"), "linux").disponible(), false);
  assert.equal(cifradoDeElectron(seguro("unknown"), "linux").disponible(), false);
  assert.equal(cifradoDeElectron(seguro("kwallet6"), "linux").disponible(), true);
  assert.equal(cifradoDeElectron(seguro("gnome_libsecret"), "linux").disponible(), true);
});

test("cifradoDeElectron devuelve false si isEncryptionAvailable es false", () => {
  const seguro = {
    isEncryptionAvailable: () => false,
    getSelectedStorageBackend: () => "gnome_libsecret"
  };
  assert.equal(cifradoDeElectron(seguro, "linux").disponible(), false);
  assert.equal(cifradoDeElectron(seguro, "darwin").disponible(), false);
  assert.equal(cifradoDeElectron(seguro, "win32").disponible(), false);
});

test("cifradoDeElectron devuelve false si getSelectedStorageBackend lanza", () => {
  const seguro = {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => {
      throw new Error("fallo de backend");
    }
  };
  assert.equal(cifradoDeElectron(seguro, "linux").disponible(), false);
});

test("cifradoDeElectron devuelve true en darwin y win32 sin consultar el backend", () => {
  const seguro = {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => {
      throw new Error("no debe llamarse");
    }
  };
  assert.equal(cifradoDeElectron(seguro, "darwin").disponible(), true);
  assert.equal(cifradoDeElectron(seguro, "win32").disponible(), true);
});

test("cifradoDeElectron cifra y descifra delegando en safeStorage", () => {
  let textoRecibido = null;
  let datosRecibidos = null;
  const seguro = {
    isEncryptionAvailable: () => true,
    encryptString: (t) => {
      textoRecibido = t;
      return Buffer.from("cifrado:" + t);
    },
    decryptString: (d) => {
      datosRecibidos = d;
      return d.toString("utf8").replace(/^cifrado:/, "");
    }
  };
  const c = cifradoDeElectron(seguro, "win32");
  const cifrado = c.cifra("mi-clave");
  assert.equal(textoRecibido, "mi-clave");
  const descifrado = c.descifra(cifrado);
  assert.equal(datosRecibidos, cifrado);
  assert.equal(descifrado, "mi-clave");
});

test("guarda escribe en temporal con mode 0o600 y renombra sin exponer texto en claro", async () => {
  const mem = discoEnMemoria();
  const c = creaCredenciales({ ruta: "/tmp/cred.dat", cifrado: cifradoFalso(), ...mem });
  const ok = await c.guarda({ email: "user@example.com", password: "password123", platform: "pc", nombre: "Tenno_X" });
  assert.equal(ok, true);
  assert.equal(mem.escrituras.length, 1);
  assert.equal(mem.escrituras[0].p, "/tmp/cred.dat.tmp");
  assert.equal(mem.escrituras[0].opts.mode, 0o600);
  assert.equal(mem.disco.has("/tmp/cred.dat.tmp"), false);
  assert.equal(mem.disco.has("/tmp/cred.dat"), true);
  const escrito = mem.disco.get("/tmp/cred.dat").toString("utf8");
  assert.equal(escrito.includes("user@example.com"), false);
  assert.equal(escrito.includes("password123"), false);
  const leido = await c.lee();
  assert.deepEqual(leido, { email: "user@example.com", password: "password123", platform: "pc", nombre: "Tenno_X" });
});

test("guarda recorta nombre a 64 y convierte nombre no string a null", async () => {
  const mem = discoEnMemoria();
  const c = creaCredenciales({ ruta: "/tmp/cred.dat", cifrado: cifradoFalso(), ...mem });
  await c.guarda({ email: "a@b.c", password: "p", platform: "ps4", nombre: "N".repeat(100) });
  const conLargo = await c.lee();
  assert.equal(conLargo.nombre, "N".repeat(64));

  for (const n of [123, true, null, undefined, {}]) {
    await c.guarda({ email: "a@b.c", password: "p", platform: "ps4", nombre: n });
    const leido = await c.lee();
    assert.equal(leido.nombre, null);
  }
});

test("guarda rechaza campos invalidos o cifrado no disponible sin escribir", async () => {
  const invalidos = [
    { email: "", password: "p", platform: "pc" },
    { email: "a".repeat(255), password: "p", platform: "pc" },
    { email: "a@b.c", password: "", platform: "pc" },
    { email: "a@b.c", password: "p".repeat(257), platform: "pc" },
    { email: "a@b.c", password: "p", platform: "playstation" },
    { email: "a@b.c", password: "p", platform: "" },
    { email: null, password: "p", platform: "pc" },
    { email: "a@b.c", password: null, platform: "pc" }
  ];

  for (const inv of invalidos) {
    const mem = discoEnMemoria();
    const c = creaCredenciales({ ruta: "/tmp/cred.dat", cifrado: cifradoFalso(), ...mem });
    const ok = await c.guarda(inv);
    assert.equal(ok, false);
    assert.equal(mem.escrituras.length, 0);
  }

  const memNoDisp = discoEnMemoria();
  const cNoDisp = creaCredenciales({ ruta: "/tmp/cred.dat", cifrado: cifradoFalso(false), ...memNoDisp });
  const okNoDisp = await cNoDisp.guarda({ email: "a@b.c", password: "p", platform: "pc" });
  assert.equal(okNoDisp, false);
  assert.equal(memNoDisp.escrituras.length, 0);
});

test("lee devuelve null sin borrar si el fichero no existe", async () => {
  const mem = discoEnMemoria();
  const c = creaCredenciales({ ruta: "/tmp/cred.dat", cifrado: cifradoFalso(), ...mem });
  const leido = await c.lee();
  assert.equal(leido, null);
  assert.equal(mem.borrados.length, 0);
});

test("lee devuelve null sin leer si cifrado disponible es false", async () => {
  const mem = discoEnMemoria();
  const c = creaCredenciales({ ruta: "/tmp/cred.dat", cifrado: cifradoFalso(false), ...mem });
  const leido = await c.lee();
  assert.equal(leido, null);
  assert.equal(mem.getLecturas(), 0);
});

test("lee devuelve null y borra el fichero ante datos corruptos o invalidos", async () => {
  const cifrado = cifradoFalso();
  const casos = [
    Buffer.from("no-cifrado-valido"),
    Buffer.from("enc:" + Buffer.from("{invalido").toString("base64")),
    Buffer.from("enc:" + Buffer.from(JSON.stringify({ email: "", password: "p", platform: "pc" })).toString("base64")),
    Buffer.from("enc:" + Buffer.from(JSON.stringify({ email: "a@b.c", password: "p", platform: "invalida" })).toString("base64")),
    Buffer.from("enc:" + Buffer.from(JSON.stringify(null)).toString("base64"))
  ];

  for (const bruto of casos) {
    const mem = discoEnMemoria();
    mem.disco.set("/tmp/cred.dat", bruto);
    const c = creaCredenciales({ ruta: "/tmp/cred.dat", cifrado, ...mem });
    const res = await c.lee();
    assert.equal(res, null);
    assert.equal(mem.disco.has("/tmp/cred.dat"), false);
    assert.equal(mem.borrados.length, 1);
  }
});

test("borra nunca rechaza aunque borraFichero lance error", async () => {
  const mem = discoEnMemoria();
  const c = creaCredenciales({
    ruta: "/tmp/cred.dat",
    cifrado: cifradoFalso(),
    ...mem,
    borraFichero: async () => {
      throw new Error("fallo de eliminacion");
    }
  });
  await assert.doesNotReject(async () => {
    await c.borra();
  });
});

test("integracion de credenciales con disco real", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vs-cred-test-"));
  const ruta = join(dir, "credenciales.dat");
  try {
    const creds = creaCredenciales({ ruta, cifrado: cifradoFalso() });
    const ok = await creds.guarda({ email: "a@b.c", password: "secreto-real", platform: "ps4", nombre: "TennoReal" });
    assert.equal(ok, true);

    const st = await stat(ruta);
    assert.equal(st.mode & 0o777, 0o600);

    await assert.rejects(async () => stat(`${ruta}.tmp`), { code: "ENOENT" });

    const contenido = await readFile(ruta, "utf8");
    assert.equal(contenido.includes("secreto-real"), false);
    assert.equal(contenido.includes("a@b.c"), false);

    const leido1 = await creds.lee();
    assert.deepEqual(leido1, { email: "a@b.c", password: "secreto-real", platform: "ps4", nombre: "TennoReal" });

    const ok2 = await creds.guarda({ email: "otro@b.c", password: "p2", platform: "xbox", nombre: "Otro" });
    assert.equal(ok2, true);
    const leido2 = await creds.lee();
    assert.deepEqual(leido2, { email: "otro@b.c", password: "p2", platform: "xbox", nombre: "Otro" });

    await creds.borra();
    assert.equal(await creds.lee(), null);
    await assert.rejects(async () => stat(ruta), { code: "ENOENT" });

    await assert.doesNotReject(async () => {
      await creds.borra();
    });

    await writeFile(ruta, "basura-directa-en-disco");
    assert.equal(await creds.lee(), null);
    await assert.rejects(async () => stat(ruta), { code: "ENOENT" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
