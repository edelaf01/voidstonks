import { test as testNode } from "node:test";
import assert from "node:assert/strict";
import { optionalSource } from "./_helpers/optional-source.mjs";
import { resumen, filasDeTail, consultaSQL } from "../scripts/wfm-rps.mjs";

const { src: workerSrc, test } = optionalSource(new URL("../worker-code.js", import.meta.url));

function internos() {
  const head = workerSrc.slice(0, workerSrc.search(/^export default\b/m));
  return new Function(`${head}\nreturn { WFM, fetchWFM, endpointWFM, ColaTurnos, conCliente, RefrescoContinuo, PriceSnapshot, Handlers };`)();
}

function conObjetoDurable() {
  const fuente = workerSrc.replace(/^export default \{/m, "const __porDefecto = {").replace(/^export class /m, "class ");
  return new Function(`${fuente}\nreturn { WFM, RefrescoContinuo, TurnosWFM };`)();
}

async function conFetch(impl, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  try { return await fn(); } finally { globalThis.fetch = original; }
}

testNode("el resumen da el pico de rps global y por colo, los 429 y lo frenado", () => {
  const filas = [
    { s: 100, endpoint: "top", colo: "MAD", tipo: "enviada", estado: 200, n: 2 },
    { s: 100, endpoint: "top", colo: "CDG", tipo: "enviada", estado: 200, n: 2 },
    { s: 101, endpoint: "estadisticas", colo: "MAD", tipo: "enviada", estado: 429, n: 1 },
    { s: 101, endpoint: "top", colo: "MAD", tipo: "frenada", estado: 429, n: 3 },
    { s: 160, endpoint: "subastas", colo: "MAD", tipo: "enviada", estado: 200, n: 1 },
  ];
  const r = resumen(filas);
  assert.equal(r.total, 6);
  assert.equal(r.r429, 1);
  assert.equal(r.frenadas, 3);
  assert.deepEqual(r.pico, { rps: 4, s: 100 });
  assert.deepEqual(r.picoColo, { MAD: 2, CDG: 2 });
  assert.deepEqual(r.porEndpoint, { top: 4, estadisticas: 1, subastas: 1 });
  assert.equal(r.minutoMasCargado.n, 5);
  assert.equal(resumen([]).total, 0);
});

testNode("el modo tail lee las líneas de wrangler tail y se salta lo demás", () => {
  const evento = { logs: [{ timestamp: 5000, message: [JSON.stringify({ wfm: "top", estado: 200, colo: "MAD", t: 7300 }), "otra cosa"] }] };
  assert.deepEqual(filasDeTail(JSON.stringify(evento)), [{ s: 7, endpoint: "top", colo: "MAD", tipo: "enviada", estado: 200, n: 1 }]);
  assert.deepEqual(filasDeTail("no es json"), []);
});

testNode("la consulta de Analytics Engine suma el muestreo y acota las horas", () => {
  assert.match(consultaSQL("voidstonks_wfm", 999), /INTERVAL '72' HOUR/);
  assert.match(consultaSQL("voidstonks_wfm"), /sum\(_sample_interval\)/);
});

test("cada llamada a WFM deja un punto de medida con su endpoint, su colo y su estado", async () => {
  const { WFM, fetchWFM } = internos();
  const puntos = [];
  WFM.configura({ WFM_RPS: "50", WFM_METRICAS: { writeDataPoint: (p) => puntos.push(p) } }, "MAD");
  await conFetch(async () => new Response("{}", { status: 200 }), async () => {
    await fetchWFM("https://api.warframe.market/v2/orders/item/paris_prime_string/top");
    await fetchWFM("https://api.warframe.market/v1/items/paris_prime_string/statistics");
  });
  assert.deepEqual(puntos.map((p) => p.blobs), [["top", "MAD", "enviada"], ["estadisticas", "MAD", "enviada"]]);
  assert.equal(puntos[0].doubles[0], 200);
});

test("WFM_PAUSA corta todo sin salir a la red y WFM_RPS se queda por debajo de 3", async () => {
  const { WFM, fetchWFM } = internos();
  let llamadas = 0;
  WFM.configura({ WFM_PAUSA: "1" });
  const res = await conFetch(async () => { llamadas++; return new Response("{}"); }, () => fetchWFM("https://api.warframe.market/v2/items"));
  assert.equal(res.status, 429);
  assert.equal(llamadas, 0);
  WFM.configura({ WFM_PAUSA_HASTA: new Date(Date.now() + 60000).toISOString() });
  assert.equal(WFM.pausa, true, "pausa con fecha: hasta entonces no sale nada");
  WFM.configura({ WFM_PAUSA_HASTA: new Date(Date.now() - 60000).toISOString() });
  assert.equal(WFM.pausa, false, "pasada la fecha vuelve sola");
  WFM.configura({ WFM_RPS: "10" });
  assert.equal(WFM.huecoMs, 400);
  WFM.configura({});
  assert.equal(WFM.huecoMs, 500);
});

test("las búsquedas de subastas van espaciadas aparte (WFM las limita a 10-20 por minuto) y no frenan lo demás", async () => {
  const { WFM, fetchWFM } = internos();
  WFM.configura({ WFM_RPS: "10" });
  WFM.huecoSubastasMs = 300;
  const salidas = [];
  await conFetch(async (url) => { salidas.push([String(url).includes("/auctions/") ? "subasta" : "top", Date.now()]); return new Response("{}"); }, async () => {
    const t0 = Date.now();
    await Promise.all([
      fetchWFM("https://api.warframe.market/v1/auctions/search?type=riven&weapon_url_name=torid"),
      fetchWFM("https://api.warframe.market/v1/auctions/search?type=riven&weapon_url_name=kunai"),
      fetchWFM("https://api.warframe.market/v2/orders/item/paris_prime_string/top"),
    ]);
    const subastas = salidas.filter(([k]) => k === "subasta").map(([, t]) => t - t0);
    const top = salidas.find(([k]) => k === "top")[1] - t0;
    assert.ok(subastas[1] - subastas[0] >= 290, `subastas separadas ${subastas[1] - subastas[0]} ms`);
    assert.ok(top < subastas[1], "una orden normal no espera a la siguiente subasta");
  });
  assert.equal(internos().WFM.huecoSubastasMs, 6000, "en producción, una cada 6 s");
});

test("tras un 429 la instancia deja de llamar a WFM durante el Retry-After", async () => {
  const { WFM, fetchWFM } = internos();
  WFM.configura({ WFM_RPS: "50" });
  let llamadas = 0;
  await conFetch(async () => { llamadas++; return new Response("{}", { status: 429, headers: { "Retry-After": "20" } }); }, async () => {
    assert.equal((await fetchWFM("https://api.warframe.market/v2/orders/item/a/top")).status, 429);
    assert.equal((await fetchWFM("https://api.warframe.market/v2/orders/item/b/top")).status, 429);
  });
  assert.equal(llamadas, 1);
  assert.ok(WFM.frenoHasta - Date.now() > 15000 && WFM.frenoHasta - Date.now() <= 20000);
});

test("los endpoints se agrupan por tipo de llamada", () => {
  const { endpointWFM } = internos();
  assert.equal(endpointWFM("https://api.warframe.market/v1/auctions/search?type=riven"), "subastas");
  assert.equal(endpointWFM("https://api.warframe.market/v2/orders/item/axi_a1_relic"), "ordenes");
  assert.equal(endpointWFM("https://api.warframe.market/v2/items"), "catalogo");
  assert.equal(endpointWFM("https://api.warframe.market/v1/auth/signin"), "login");
  assert.equal(endpointWFM("https://api.warframe.market/v2/order/abc/close"), "cuenta");
  assert.equal(endpointWFM("https://api.warframe.market/v1/profile/x/orders"), "perfil");
});

function relojFalso() {
  let t = 0;
  const pendientes = [];
  return {
    ahora: () => t,
    espera: (fn, ms) => pendientes.push({ fn, en: t + ms }),
    async avanza(ms) {
      const fin = t + ms;
      for (;;) {
        pendientes.sort((a, b) => a.en - b.en);
        if (!pendientes.length || pendientes[0].en > fin) break;
        const p = pendientes.shift();
        t = p.en;
        p.fn();
        await new Promise(setImmediate);
      }
      t = fin;
      await new Promise(setImmediate);
    },
  };
}

function apuntaTurnos(cola, reloj, peticiones, concedidos = []) {
  for (const [cliente, n] of peticiones) {
    for (let i = 0; i < n; i++) cola.pide(cliente, 500).then((ok) => concedidos.push([cliente, ok, reloj.ahora()]));
  }
  return concedidos;
}

test("los turnos rotan entre usuarios: uno con un lote grande no deja esperando a los demás", async () => {
  const { ColaTurnos } = internos();
  const reloj = relojFalso();
  const cola = new ColaTurnos(reloj);
  const concedidos = apuntaTurnos(cola, reloj, [["A", 3], ["B", 1], ["C", 1]]);
  await reloj.avanza(3000);
  assert.deepEqual(concedidos.map(([c, , t]) => `${c}@${t}`), ["A@0", "B@500", "C@1000", "A@1500", "A@2000"]);
});

test("el cron va detrás de los usuarios", async () => {
  const { ColaTurnos } = internos();
  const reloj = relojFalso();
  const concedidos = apuntaTurnos(new ColaTurnos(reloj), reloj, [["cron", 2], ["U", 1]]);
  await reloj.avanza(2000);
  assert.deepEqual(concedidos.map(([c]) => c), ["U", "cron", "cron"]);
});

test("un usuario no puede acaparar la cola", async () => {
  const { ColaTurnos } = internos();
  const reloj = relojFalso();
  const concedidos = apuntaTurnos(new ColaTurnos({ ...reloj, maxPorCliente: 2 }), reloj, [["A", 3]]);
  await reloj.avanza(0);
  assert.deepEqual(concedidos, [["A", false, 0], ["A", true, 0]], "el tercero se rechaza al momento");
});

test("un turno que caduca esperando no gasta hueco: pasa el siguiente", async () => {
  const { ColaTurnos } = internos();
  const reloj = relojFalso();
  const cola = new ColaTurnos({ ...reloj, caducaMs: 900 });
  const concedidos = apuntaTurnos(cola, reloj, [["A", 1], ["B", 1], ["C", 1]]);
  await reloj.avanza(950);
  apuntaTurnos(cola, reloj, [["D", 1]], concedidos);
  await reloj.avanza(2000);
  assert.deepEqual(concedidos.map(([c, ok, t]) => `${c}:${ok}@${t}`), ["A:true@0", "B:true@500", "C:false@1000", "D:true@1000"]);
});

test("tras un 429 el freno vale para todos", async () => {
  const { ColaTurnos } = internos();
  const reloj = relojFalso();
  const cola = new ColaTurnos(reloj);
  cola.frena(5000);
  const concedidos = apuntaTurnos(cola, reloj, [["A", 1], ["B", 1]]);
  await reloj.avanza(6000);
  assert.deepEqual(concedidos.map(([c, , t]) => `${c}@${t}`), ["A@5000", "B@5500"]);
});

test("con el Durable Object configurado, fetchWFM pide turno global con su usuario y avisa del 429", async () => {
  const { WFM, fetchWFM, conCliente } = internos();
  const pedidos = [];
  const turnos = { idFromName: (n) => n, get: () => ({ fetch: async (url) => { pedidos.push(String(url)); return new Response(null, { status: 204 }); } }) };
  WFM.configura({ WFM_TURNOS: turnos });
  await conFetch(async () => new Response("{}", { status: 429, headers: { "Retry-After": "10" } }), () =>
    conCliente("1.2.3.4", () => fetchWFM("https://api.warframe.market/v2/orders/item/a/top")));
  assert.deepEqual(pedidos, ["https://turnos/turno?c=1.2.3.4&h=500", "https://turnos/frena?ms=10000"]);
  const sinTurno = { idFromName: (n) => n, get: () => ({ fetch: async () => new Response(null, { status: 429 }) }) };
  WFM.configura({ WFM_TURNOS: sinTurno });
  WFM.frenoHasta = 0;
  let salio = false;
  const res = await conFetch(async () => { salio = true; return new Response("{}"); }, () => fetchWFM("https://api.warframe.market/v2/items"));
  assert.equal(res.status, 429);
  assert.equal(salio, false, "sin turno no se llama a WFM");
});

test("un precio que se movió vale 6 h y uno estable 8 h, y se pide antes el que antes caduca", () => {
  const { RefrescoContinuo: R } = internos();
  const h = 3600000;
  assert.deepEqual([R.caducidad(undefined), R.caducidad({ p: 30, t: 0, c: true }), R.caducidad({ p: 30, t: 0, c: false })], [0, 6 * h, 8 * h]);
  const precios = { a: { p: 30, t: 0, c: true }, b: { p: 5, t: 0, c: false }, c: { p: 15, t: h, c: true } };
  assert.deepEqual(R.siguiente(["a", "b", "c"], precios), { slug: "a", vence: 6 * h }, "lo que se mueve caduca antes");
  assert.equal(R.siguiente(["a", "b", "c", "nuevo"], precios).slug, "nuevo");
  precios.a.t = 5 * h;
  assert.equal(R.siguiente(["a", "b", "c"], precios).slug, "c");
});

test("con pocos vendedores se apunta la consulta pero se conserva el precio", () => {
  const { RefrescoContinuo: R } = internos();
  const precios = { x: { p: 40, t: 0 } };
  assert.equal(R.aplica(precios, "x", { price: 9, vendedores: 1 }, 1000), true);
  assert.deepEqual(precios.x, { p: 40, t: 1000, c: false }, "si no se apuntara la hora, se volvería a pedir sin parar");
  R.aplica(precios, "x", { price: 12, vendedores: 5 }, 2000);
  assert.deepEqual(precios.x, { p: 12, t: 2000, c: true }, "cambió: la próxima vez a las 6 h");
  R.aplica(precios, "x", { price: 12, vendedores: 5 }, 3000);
  assert.equal(precios.x.c, false, "igual que antes: a las 8 h");
  assert.equal(R.aplica(precios, "x", {}, 4000), false, "un fallo no toca nada");
  assert.deepEqual(R.documento({ x: { p: 12, t: 2000 }, y: { p: 3, t: 500 } }), { v: 1, t: 2000, cursor: 0, p: { x: 12, y: 3 } });
});

test("el objeto durable refresca sin parar a su ritmo, guarda, publica y se vuelve a programar", async () => {
  const { WFM, RefrescoContinuo, TurnosWFM } = conObjetoDurable();
  const almacen = new Map();
  let alarma = null;
  const state = {
    storage: {
      get: async (k) => almacen.get(k), put: async (k, v) => { almacen.set(k, v); },
      getAlarm: async () => alarma, setAlarm: async (t) => { alarma = t; },
    },
    waitUntil: () => {},
  };
  const kv = new Map([["prices_universe_v1", JSON.stringify(["a_prime_set", "b_prime_set", "c_prime_set"])],
    ["prices_snapshot_v1", JSON.stringify({ v: 1, t: 1000, p: { a_prime_set: 50, b_prime_set: 5 } })]]);
  const env = { WFM_RPS: "10", WFM_TURNOS: {}, VOID_KV: { get: async (k) => kv.get(k) ?? null, put: async (k, v) => kv.set(k, v) } };
  const pedidos = [];
  await conFetch(async (url) => {
    pedidos.push(String(url).split("/").at(-2));
    return new Response(JSON.stringify({ data: { sell: [10, 11, 12, 13, 14].map((platinum) => ({ platinum, user: { status: "ingame" } })) } }), { status: 200 });
  }, async () => {
    const t = new TurnosWFM(state, env);
    RefrescoContinuo.VUELTA_MS = 1100;
    await t.alarm();
  });
  assert.equal(WFM.huecoMs, 400);
  assert.ok(pedidos.length >= 2 && pedidos.length <= 4, `pidió ${pedidos.length}`);
  assert.deepEqual(pedidos.slice(0, 2), ["c_prime_set", "a_prime_set"], "primero lo que no tenía precio, luego lo que antes caduca");
  assert.equal(almacen.get("precios_v2").c_prime_set.p, 12);
  assert.equal(JSON.parse(kv.get("prices_snapshot_v1")).p.c_prime_set, 12, "publica el documento para el resto del worker");
  assert.ok(alarma > Date.now() - 1000, "se vuelve a programar al momento");
});

test("el objeto durable sirve el snapshot y arranca su bucle si estaba parado", async () => {
  const { TurnosWFM } = conObjetoDurable();
  let alarma = null;
  const state = { storage: { get: async () => ({ x_prime_set: { p: 7, t: 123 } }), put: async () => {}, getAlarm: async () => alarma, setAlarm: async (t) => { alarma = t; } } };
  const t = new TurnosWFM(state, { VOID_KV: { get: async () => null } });
  const res = await t.fetch(new Request("https://turnos/snapshot"));
  assert.deepEqual(await res.json(), { v: 1, t: 123, cursor: 0, p: { x_prime_set: 7 } });
  assert.ok(alarma);
});

test("con el objeto durable, prices_snapshot sale del refresco continuo", async () => {
  const { WFM, Handlers } = internos();
  WFM.configura({ WFM_TURNOS: { idFromName: (n) => n, get: () => ({ fetch: async (u) => new Response(JSON.stringify({ t: 99, p: { a: 1 } }), { status: String(u).endsWith("/snapshot") ? 200 : 404 }) }) } });
  const r = await Handlers.prices_snapshot(new URL("https://x/?type=prices_snapshot"), {}, { waitUntil: () => {} });
  assert.deepEqual(r, { data: { t: 99, p: { a: 1 } }, ttl: 300, swr: 3600 });
});

test("sin nada caducado no pide nada y se duerme hasta el siguiente vencimiento", async () => {
  const { RefrescoContinuo, TurnosWFM } = conObjetoDurable();
  let alarma = null;
  const ahora = Date.now();
  const state = { storage: { get: async (k) => (k === "precios_v2" ? { a: { p: 30, t: ahora - 6 * 3600000 + 60000, c: true }, b: { p: 4, t: ahora, c: false } } : undefined), put: async () => {}, getAlarm: async () => alarma, setAlarm: async (t) => { alarma = t; } } };
  const kv = new Map([["prices_universe_v1", JSON.stringify(["a", "b"])]]);
  let pedidas = 0;
  await conFetch(async () => { pedidas++; return new Response("{}"); }, async () => {
    RefrescoContinuo.VUELTA_MS = 60000;
    await new TurnosWFM(state, { WFM_TURNOS: {}, VOID_KV: { get: async (k) => kv.get(k) ?? null, put: async () => {} } }).alarm();
  });
  assert.equal(pedidas, 0);
  assert.ok(alarma >= ahora + 55000 && alarma <= ahora + 65000 + 2000, "despierta cuando caduca el primero (dentro de 1 min)");
});

test("sin el enlace WFM_TURNOS el objeto durable queda en reserva: borra su alarma y no pide nada", async () => {
  const { TurnosWFM } = conObjetoDurable();
  let alarma = Date.now() + 1000;
  const state = { storage: { get: async () => ({}), put: async () => {}, getAlarm: async () => alarma, setAlarm: async (t) => { alarma = t; }, deleteAlarm: async () => { alarma = null; } } };
  let pedidas = 0;
  await conFetch(async () => { pedidas++; return new Response("{}"); }, () => new TurnosWFM(state, { VOID_KV: { get: async () => null } }).alarm());
  assert.equal(pedidas, 0);
  assert.equal(alarma, null);
});

test("sin el enlace WFM_TURNOS, prices_snapshot vuelve a leer el documento de KV", async () => {
  const { WFM, Handlers } = internos();
  WFM.configura({});
  const kv = { get: async (k) => (k === "prices_snapshot_v1" ? JSON.stringify({ v: 1, t: Date.now(), p: { a_prime_set: 9 } }) : null) };
  const r = await Handlers.prices_snapshot(new URL("https://x/?type=prices_snapshot"), { VOID_KV: kv }, { waitUntil: () => {} });
  assert.deepEqual(r.data.p, { a_prime_set: 9 });
  assert.equal(r.ttl, 900);
});

test("el objeto durable cuenta lo que pide y cómo le responde WFM, y no se reprograma a mitad de vuelta", async () => {
  const { TurnosWFM } = conObjetoDurable();
  let alarma = null, programadas = 0;
  const state = { storage: { get: async () => ({}), put: async () => {}, getAlarm: async () => alarma, setAlarm: async (t) => { alarma = t; programadas++; } } };
  const t = new TurnosWFM(state, { VOID_KV: { get: async () => JSON.stringify(["a_prime_set"]) } });
  await conFetch(async () => new Response("{}", { status: 429, headers: { "Retry-After": "7" } }), () => t.pidePrecio("a_prime_set"));
  await conFetch(async () => new Response(JSON.stringify({ data: { sell: [] } }), { status: 200 }), () => t.pidePrecio("a_prime_set"));
  const estado = await (await t.fetch(new Request("https://turnos/estado"))).json();
  assert.deepEqual([estado.pedidas, estado.ok, estado.r429, estado.fallos], [2, 1, 1, 0]);
  assert.equal(estado.ultimo.estado, 200);
  assert.equal(estado.universo, 1);
  t.enMarcha = true;
  await t.arranca();
  assert.equal(programadas, 0, "con la vuelta en marcha no se pisa la alarma");
});
