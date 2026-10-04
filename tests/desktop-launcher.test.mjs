import { test } from "node:test";
import assert from "node:assert/strict";

const repo = await import("../deploy/js/repositories/launcher.repository.js");
const svc = await import("../deploy/js/services/desktop.service.js");
const { esEscritorio, carcasaActiva } = await import("../deploy/js/utils/shell.js");

async function enHost(hostname, fn) {
  globalThis.location = { hostname };
  try { return await fn(); } finally { delete globalThis.location; }
}

async function conFetch(impl, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  try { return await fn(); } finally { globalThis.fetch = original; }
}

test("solo el host del lanzador cuenta como lanzador", () => {
  assert.equal(svc.enLanzador("voidstonks.localhost"), true);
  assert.equal(svc.enLanzador("localhost"), false);
  assert.equal(svc.enLanzador("127.0.0.1"), false);
  assert.equal(svc.enLanzador("voidstonks.com"), false);
  assert.equal(svc.enLanzador(), false);
});

test("sin el puente nativo no hace nada ni sale a la red", async () => {
  await conFetch(async () => { throw new Error("no debería pedir nada por HTTP"); }, async () => {
    assert.equal(await repo.capacidadesDelLanzador(), null);
    assert.equal(await repo.guardarPermisosEnLanzador({ clip: true }), false);
    assert.equal(await repo.copiarConLanzador("x"), false);
    assert.equal(await repo.panelesEnJuego({ grupo: "kiosko", paneles: [] }), false);
  });
  const corta = repo.seguirEELogDelLanzador({ alLeer: () => assert.fail("sin puente no hay líneas") });
  assert.equal(typeof corta, "function");
  corta();
  const suelta = repo.escucharAccionesDelOverlay(() => {});
  assert.equal(typeof suelta, "function");
});

test("fuera del lanzador no se piden permisos nativos", async () => {
  let llamado = false;
  assert.equal(await svc.capacidadesNativas({ pide: async () => { llamado = true; } }), null);
  assert.equal(await svc.copiarNativo("x", { copia: async () => { llamado = true; return true; } }), false);
  assert.equal(llamado, false);
});

test("dentro del lanzador copia y pide capacidades una sola vez", async () => {
  await enHost("voidstonks.localhost", async () => {
    let pedidas = 0;
    const pide = async () => { pedidas++; return { clip: true }; };
    assert.deepEqual(await svc.capacidadesNativas({ pide }), { clip: true });
    assert.deepEqual(await svc.capacidadesNativas({ pide }), { clip: true });
    assert.equal(pedidas, 1);
    assert.equal(await svc.copiarNativo("hola", { copia: async (t) => t === "hola" }), true);
  });
});

test("los paneles solo salen con el overlay activo y en la app de escritorio", async () => {
  const enviados = [];
  const manda = async (d) => { enviados.push(d); return true; };
  assert.equal(await svc.mostrarPaneles("kiosko", [{}], {}, { manda }), false, "inactivo por defecto");
  svc.activaOverlay(true);
  assert.equal(await svc.mostrarPaneles("kiosko", [{}], {}, { manda }), false, "fuera del lanzador no se activa");
  await enHost("voidstonks.localhost", async () => {
    svc.activaOverlay(true);
    await svc.mostrarPaneles("recompensas", [{ x: 0.5 }], { mismoAncho: true, duracionMs: svc.RECOMPENSAS_DURACION_MS }, { manda });
    await svc.quitarPaneles("recompensas", { manda });
    svc.activaOverlay(false);
    assert.equal(await svc.quitarPaneles("recompensas", { manda }), false);
  });
  assert.deepEqual(enviados, [
    { grupo: "recompensas", paneles: [{ x: 0.5 }], mismoAncho: true, duracionMs: svc.RECOMPENSAS_DURACION_MS },
    { grupo: "recompensas", paneles: [] },
  ]);
});

test("cada grupo se quita al salir de su pantalla y todos al parar", async () => {
  const enviados = [];
  const manda = async (d) => { enviados.push(d); return true; };
  await enHost("voidstonks.localhost", async () => {
    svc.activaOverlay(true);
    for (const g of ["recompensas", "kiosko", "riven", "reliquias"]) await svc.mostrarPaneles(g, [{}], {}, { manda });
    enviados.length = 0;
    await svc.ajustaPanelesAlContexto("INVENTORY_MODS", { manda });
    assert.deepEqual(enviados.map((d) => d.grupo).sort(), ["kiosko", "recompensas", "reliquias"]);
    enviados.length = 0;
    await svc.ajustaPanelesAlContexto("INVENTORY_MODS", { manda });
    assert.equal(enviados.length, 0, "lo ya quitado no se vuelve a pedir");
    await svc.quitarTodosLosPaneles({ manda });
    assert.deepEqual(enviados.map((d) => d.grupo), ["riven"]);
    assert.equal(await svc.quitarPaneles("kiosko", { manda }), false);
    svc.activaOverlay(false);
  });
});

test("las órdenes van de una en una y de cada grupo solo sale la última", async () => {
  const enviados = [];
  let suelta;
  const manda = (d) => { enviados.push(d); return d.grupo === "kiosko" ? new Promise((r) => { suelta = () => r(true); }) : Promise.resolve(true); };
  await enHost("voidstonks.localhost", async () => {
    svc.activaOverlay(true);
    const kiosko = svc.mostrarPaneles("kiosko", [{}], {}, { manda });
    const viejo = svc.mostrarPaneles("riven", [{ v: 1 }], {}, { manda });
    const nuevo = svc.mostrarPaneles("riven", [{ v: 2 }], {}, { manda });
    const quita = svc.quitarPaneles("riven", { manda });
    assert.equal(enviados.length, 1, "nada sale mientras hay una en vuelo");
    suelta();
    assert.deepEqual(await Promise.all([kiosko, viejo, nuevo, quita]), [true, false, false, true]);
    assert.deepEqual(enviados.map((d) => [d.grupo, d.paneles.length]), [["kiosko", 1], ["riven", 0]]);
    enviados.length = 0;
    svc.quitarTodosAlSalir({ manda });
    assert.deepEqual(enviados.map((d) => d.grupo), ["kiosko"]);
    svc.activaOverlay(false);
  });
});

test("en la app de Electron todo va por el puente nativo y nada por fetch", async () => {
  const llamadas = [];
  let alEvento = null;
  globalThis.voidstonksNativo = {
    capacidades: async () => ({ overlay: true }),
    guardarPermisos: async (p) => { llamadas.push(["permisos", p]); return true; },
    copiar: async (t) => { llamadas.push(["copiar", t]); return true; },
    paneles: async (d) => { llamadas.push(["paneles", d.grupo]); return true; },
    seguirEELog: (cola, fn) => { llamadas.push(["eelog", cola]); alEvento = fn; return () => llamadas.push(["corta"]); },
  };
  try {
    await conFetch(async () => { throw new Error("no debería pedir nada por HTTP"); }, async () => {
      assert.deepEqual(await repo.capacidadesDelLanzador(), { overlay: true });
      assert.equal(await repo.guardarPermisosEnLanzador({ clip: true }), true);
      assert.equal(await repo.copiarConLanzador("hola"), true);
      assert.equal(await repo.panelesEnJuego({ grupo: "riven", paneles: [] }), true);
    });
    const lineas = [], estados = [];
    const corta = repo.seguirEELogDelLanzador({ cola: 1024, alLeer: (l) => lineas.push(...l), alEstado: (n, d) => estados.push([n, d]) });
    alEvento("ruta", "/x/EE.log");
    alEvento("lineas", "a\nb");
    corta();
    assert.deepEqual(lineas, ["a", "b"]);
    assert.deepEqual(estados, [["ruta", "/x/EE.log"]]);
    assert.deepEqual(llamadas, [["permisos", { clip: true }], ["copiar", "hola"], ["paneles", "riven"], ["eelog", 1024], ["corta"]]);
    globalThis.voidstonksNativo.capacidades = async () => { throw new Error("ipc caído"); };
    assert.equal(await repo.capacidadesDelLanzador(), null);
  } finally {
    delete globalThis.voidstonksNativo;
  }
});

test("con el permiso de portapapeles la copia automática se enciende una sola vez", () => {
  const vistas = new Set();
  const deps = { visto: (k) => vistas.has(k), marca: (k) => vistas.add(k) };
  assert.equal(svc.estrenaAutoCopia({ clip: false }, deps), false);
  assert.equal(svc.estrenaAutoCopia({ clip: true }, deps), true);
  assert.equal(svc.estrenaAutoCopia({ clip: true }, deps), false, "si luego la apagas, se respeta");
  assert.equal(svc.estrenaAutoCopia(null, deps), false);
});

test("cada grupo del overlay recibe solo los clics de sus paneles", () => {
  let reparte = null;
  const escucha = (fn) => { reparte = fn; };
  const recibidas = [];
  svc.alPulsarEnOverlay("reliquias", (a) => recibidas.push(["reliquias", a]), { escucha });
  svc.alPulsarEnOverlay("kiosko", (a) => recibidas.push(["kiosko", a]), { escucha });
  reparte?.("reliquias", "refino:Rad");
  reparte?.("riven", "nada:1");
  reparte?.("kiosko", "vendido:1");
  assert.deepEqual(recibidas, [["reliquias", "refino:Rad"], ["kiosko", "vendido:1"]]);
});

test("la carcasa cede a la maqueta web por debajo del ancho mínimo", () => {
  const dataset = {};
  globalThis.document = { documentElement: { dataset } };
  let ancho = true;
  globalThis.matchMedia = () => ({ matches: ancho });
  try {
    assert.equal(esEscritorio(), false);
    assert.equal(carcasaActiva(), false);
    dataset.shell = "desktop";
    assert.equal(esEscritorio(), true);
    assert.equal(carcasaActiva(), true);
    ancho = false;
    assert.equal(carcasaActiva(), false);
  } finally {
    delete globalThis.document;
    delete globalThis.matchMedia;
  }
});

test("guardar permisos obliga a volver a pedir las capacidades", async () => {
  await enHost("voidstonks.localhost", async () => {
    let version = 0;
    const pide = async () => ({ permisos: { clip: version > 0 } });
    assert.deepEqual(await svc.capacidadesNativas({ pide }), { clip: true }, "caché del test anterior");
    assert.equal(await svc.guardarPermisos({ clip: false }, { guarda: async () => false }), false);
    version = 1;
    assert.equal(await svc.guardarPermisos({ clip: true }, { guarda: async () => true }), true);
    assert.deepEqual(await svc.capacidadesNativas({ pide }), { permisos: { clip: true } });
  });
});

test("las tarjetas de recompensas duran lo que le queda a la pantalla del juego (15 s desde que se abre)", () => {
  assert.equal(svc.duracionRecompensas(10_000, 12_000), 13_500, "pintadas 2 s después de abrirse");
  assert.equal(svc.duracionRecompensas(10_000, 30_000), 3000, "aunque llegue tarde, se ve un momento");
  assert.equal(svc.duracionRecompensas(undefined, 12_000), svc.RECOMPENSAS_DURACION_MS, "sin log, el tope de siempre");
});

test("los paneles ocultos del escritorio se recuerdan y un valor roto no rompe nada", () => {
  const antes = globalThis.localStorage;
  const datos = new Map();
  globalThis.localStorage = { getItem: (k) => datos.get(k) ?? null, setItem: (k, v) => datos.set(k, String(v)), removeItem: (k) => datos.delete(k) };
  try {
    assert.deepEqual(svc.leePanelesOcultos(), []);
    svc.guardaPanelesOcultos(["inv", "fis"]);
    assert.deepEqual(svc.leePanelesOcultos(), ["inv", "fis"]);
    datos.set("vs_ds_ocultos", "{roto");
    assert.deepEqual(svc.leePanelesOcultos(), []);
    datos.set("vs_ds_ocultos", '"inv"');
    assert.deepEqual(svc.leePanelesOcultos(), []);
  } finally {
    globalThis.localStorage = antes;
  }
});
