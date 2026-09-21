// El repositorio de OPFS: lo que se fija es que sin navigator.storage (o si el navegador lo
// niega) todo devuelve null/false sin lanzar, y que con él lo escrito se lee igual, se borra y
// se vacía. El sistema de ficheros es un árbol en memoria con la API del navegador.
import { test } from "node:test";
import assert from "node:assert/strict";
import { OPFSRepository } from "../deploy/js/repositories/opfs.repository.js";

const ORIGINAL = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const conNavigator = (value) => Object.defineProperty(globalThis, "navigator", { value, configurable: true });
const restaura = () => Object.defineProperty(globalThis, "navigator", ORIGINAL);

/** Raíz OPFS falsa: un nivel de carpetas y ficheros como Uint8Array. */
function raizFalsa({ fallaEscritura = false } = {}) {
  const carpetas = new Map();
  const carpeta = () => {
    const ficheros = new Map();
    return {
      ficheros,
      async getFileHandle(n, { create = false } = {}) {
        if (!create && !ficheros.has(n)) throw new Error("NotFoundError");
        if (!ficheros.has(n)) ficheros.set(n, new Uint8Array());
        return {
          async createWritable() {
            if (fallaEscritura) throw new Error("NoModificationAllowedError");
            const partes = [];
            return {
              async write(b) { partes.push(new Uint8Array(await b.arrayBuffer())); },
              async close() { ficheros.set(n, new Uint8Array(partes.flatMap((p) => [...p]))); },
            };
          },
          async getFile() { return new Blob([ficheros.get(n)]); },
        };
      },
      async removeEntry(n) { if (!ficheros.delete(n)) throw new Error("NotFoundError"); },
      async *keys() { yield* [...ficheros.keys()]; },
    };
  };
  return {
    carpetas,
    async getDirectoryHandle(n, { create = false } = {}) {
      if (!carpetas.has(n)) { if (!create) throw new Error("NotFoundError"); carpetas.set(n, carpeta()); }
      return carpetas.get(n);
    },
  };
}

test("sin navigator.storage nada lanza: abrir false, lee null, escribe/borra/vacia false", async () => {
  conNavigator({ userAgent: "viejo" });
  try {
    assert.equal(await OPFSRepository.abrir("vs-debug"), false);
    assert.equal(await OPFSRepository.escribe("a.png", new Blob([new Uint8Array(3)])), false);
    assert.equal(await OPFSRepository.lee("a.png"), null);
    assert.equal(await OPFSRepository.borra("a.png"), false);
    assert.equal(await OPFSRepository.vacia(), false);
  } finally { restaura(); }
});

test("si el navegador niega el directorio (contexto sin permiso), abrir devuelve false", async () => {
  conNavigator({ storage: { async getDirectory() { throw new Error("SecurityError"); } } });
  try {
    assert.equal(await OPFSRepository.abrir("vs-debug"), false);
    assert.equal(await OPFSRepository.escribe("a.png", new Blob([new Uint8Array(3)])), false, "y no queda una carpeta vieja abierta");
  } finally { restaura(); }
});

test("con OPFS: lo escrito se lee igual, lo que no existe es null, borrar y vaciar dejan la carpeta limpia", async () => {
  const raiz = raizFalsa();
  conNavigator({ storage: { async getDirectory() { return raiz; } } });
  try {
    assert.equal(await OPFSRepository.abrir("vs-debug"), true);
    assert.ok(raiz.carpetas.has("vs-debug"), "crea la carpeta con ese nombre");
    const dir = raiz.carpetas.get("vs-debug");

    assert.equal(await OPFSRepository.escribe("1-frame.png", new Blob(["PNGFALSO"])), true);
    assert.equal(await OPFSRepository.escribe("m1.jpg", new Blob([new Uint8Array([1, 2, 3])])), true);
    assert.equal(new TextDecoder().decode(await OPFSRepository.lee("1-frame.png")), "PNGFALSO");
    assert.deepEqual([...(await OPFSRepository.lee("m1.jpg"))], [1, 2, 3]);
    assert.equal(await OPFSRepository.lee("no-existe.png"), null);

    assert.equal(await OPFSRepository.borra("m1.jpg"), true);
    assert.equal(await OPFSRepository.borra("m1.jpg"), false, "borrar dos veces no lanza");
    assert.deepEqual([...dir.ficheros.keys()], ["1-frame.png"]);

    await OPFSRepository.escribe("2-frame.png", new Blob(["X"]));
    assert.equal(await OPFSRepository.vacia(), true);
    assert.equal(dir.ficheros.size, 0);
    assert.equal(await OPFSRepository.escribe("3-frame.png", new Blob(["Y"])), true, "vaciar no cierra la carpeta");
  } finally { restaura(); }
});

test("una escritura que falla devuelve false en vez de lanzar", async () => {
  const raiz = raizFalsa({ fallaEscritura: true });
  conNavigator({ storage: { async getDirectory() { return raiz; } } });
  try {
    assert.equal(await OPFSRepository.abrir("vs-debug"), true);
    assert.equal(await OPFSRepository.escribe("1-frame.png", new Blob(["PNGFALSO"])), false);
  } finally { restaura(); }
});
