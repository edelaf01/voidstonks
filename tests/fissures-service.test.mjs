// Fisuras y arbitración: preferencias del usuario, normalización del worldstate y contadores.
//
// Casi todo lo de aquí falla en silencio y en la misma dirección: el panel se queda vacío o
// enseña algo caducado, y no hay error en consola que lo delate. Los tres agujeros que se
// cierran son los que ya han mordido — el toggle de Railjack contra los tipos que se llaman
// igual, un fallo del worker vaciando la lista, y el reloj del cliente adelantado tirando a
// la basura fisuras que seguían vivas.

import { test } from "node:test";
import assert from "node:assert/strict";

let almacen = {};
globalThis.localStorage = {
  getItem: (k) => (k in almacen ? almacen[k] : null),
  setItem: (k, v) => { almacen[k] = String(v); },
  removeItem: (k) => { delete almacen[k]; },
};

let respuestaFisuras = [];
let fisurasOk = true;
let respuestaArby = null;
let arbyOk = true;
const urls = [];

globalThis.fetch = async (url) => {
  const u = String(url);
  urls.push(u);
  // El servidor va 3 s por detrás del cliente: un desfase real pero inofensivo, que además
  // deja _serverTimeOffset distinto de 0 y así el rescate por heurística (probado al final)
  // no se dispara en el resto de los tests.
  if (u.includes("type=time")) return { ok: true, status: 200, json: async () => ({ now: Date.now() - 3000 }) };
  if (u.includes("type=fissures")) {
    return { ok: fisurasOk, status: fisurasOk ? 200 : 502, json: async () => respuestaFisuras };
  }
  if (u.includes("type=arbitration")) {
    return { ok: arbyOk, status: arbyOk ? 200 : 503, json: async () => respuestaArby };
  }
  return { ok: false, status: 404, json: async () => ({}) };
};

const M = await import("../deploy/js/services/farms/fissures.service.js");

/** ISO a `m` minutos de ahora (negativo = pasado). */
const min = (m) => new Date(Date.now() + m * 60000).toISOString();

/** Fisura cruda tal y como la manda el worldstate. */
const cruda = (o = {}) => ({
  node: "Hepit (Void)",
  missionType: "Capture",
  tier: "Lith",
  activation: min(-20),
  expiry: min(40.3),
  ...o,
});

const guardar = (prefs) => { almacen.vs_fissure_prefs = JSON.stringify(prefs); };
const nFetch = (tipo) => urls.filter((u) => u.includes(tipo)).length;

async function sinRuido(fn) {
  const { error, warn } = console;
  console.error = console.warn = () => {};
  try { return await fn(); } finally { console.error = error; console.warn = warn; }
}

// --- Preferencias -----------------------------------------------------------------------

test("sin nada guardado se ven los cuatro tipos de siempre y Omnia, sin Railjack", () => {
  almacen = {};
  const p = M.getFissurePrefs();
  assert.deepEqual(p.missionTypes, ["Capture", "Extermination", "Rescue", "Void Cascade"]);
  assert.equal(p.includeOmnia, true);
  // Railjack apagado: encenderlo por defecto llenaría el panel de misiones que la mayoría no
  // juega y que además rotan aparte.
  assert.equal(p.includeRailjack, false);
});

test("el default que se devuelve es una copia, no la constante del módulo", () => {
  almacen = {};
  // El panel de filtros trabaja sobre el objeto que sale de aquí; si fuera la constante, un
  // solo `push` la dejaría contaminada para toda la sesión y para todos los que la lean.
  M.getFissurePrefs().missionTypes.push("Defense");
  assert.deepEqual(M.getFissurePrefs().missionTypes,
    ["Capture", "Extermination", "Rescue", "Void Cascade"]);
});

test("una preferencia corrupta cae al default en vez de dejar el panel a medias", () => {
  almacen.vs_fissure_prefs = "{esto no es json";
  const p = sinRuidoSync(() => M.getFissurePrefs());
  assert.deepEqual(p.missionTypes, M.DEFAULT_MISSION_TYPES);
  assert.deepEqual(p.railjackTypes, M.RAILJACK_MISSION_TYPES);
});

test("los campos con el tipo equivocado se ignoran uno a uno", () => {
  // Viene de una versión anterior del formato o de un localStorage manipulado a mano: lo que
  // no encaja se sustituye por su default, sin tirar el resto de la configuración.
  guardar({ missionTypes: "Capture", includeOmnia: "sí", includeRailjack: 1, railjackTypes: ["Spy", 7, null] });
  const p = M.getFissurePrefs();

  assert.deepEqual(p.missionTypes, M.DEFAULT_MISSION_TYPES);
  assert.equal(p.includeOmnia, true);
  assert.equal(p.includeRailjack, false);
  assert.deepEqual(p.railjackTypes, ["Spy"], "de la lista solo sobreviven las cadenas");
});

test("desmarcarlo todo se respeta: una lista vacía no es una lista ausente", () => {
  // Confundir [] con "no configurado" resucitaría los 4 tipos por defecto justo después de
  // que el usuario los quitara, y el panel se vería igual que antes de tocar nada.
  guardar({ missionTypes: [], includeOmnia: false, includeRailjack: true, railjackTypes: [] });
  const p = M.getFissurePrefs();
  assert.deepEqual(p.missionTypes, []);
  assert.equal(p.includeOmnia, false);
  assert.deepEqual(p.railjackTypes, []);
});

test("un localStorage que no deja escribir no tumba el panel", () => {
  const real = globalThis.localStorage.setItem;
  globalThis.localStorage.setItem = () => { throw new Error("QuotaExceededError"); };
  try {
    // Pasa de verdad: modo privado de Safari y navegadores con la cuota llena. Perder la
    // preferencia es aceptable; perder la pestaña entera por marcar una casilla, no.
    assert.doesNotThrow(() => sinRuidoSync(() => M.saveFissurePrefs({ missionTypes: ["Capture"] })));
  } finally {
    globalThis.localStorage.setItem = real;
  }
});

// --- Filtrado por preferencias ----------------------------------------------------------

test("una tormenta del vacío no se cuela por llamarse igual que una misión normal", async () => {
  almacen = {};
  respuestaFisuras = [
    cruda({ node: "Ur (Veil)", missionType: "Extermination", tier: "Neo", isStorm: true }),
    cruda({ node: "Hepit (Void)", missionType: "Extermination", tier: "Lith" }),
  ];
  await M.fetchAllFissures(true);

  // "Extermination" está en las dos listas de tipos. Si el filtro mirase solo el tipo, el
  // toggle de Railjack no serviría de nada para esas misiones.
  assert.deepEqual((await M.fetchBestFissures()).map((f) => f.node), ["Hepit (Void)"]);

  guardar({ missionTypes: [], includeOmnia: false, includeRailjack: true, railjackTypes: ["Extermination"] });
  assert.deepEqual((await M.fetchBestFissures()).map((f) => f.node), ["Ur (Veil)"]);

  // Railjack encendido pero con ese tipo desmarcado: manda su propia lista.
  guardar({ missionTypes: [], includeOmnia: false, includeRailjack: true, railjackTypes: ["Volatile"] });
  assert.deepEqual(await M.fetchBestFissures(), []);
});

test("Omnia se ve aunque su tipo de misión no esté marcado", async () => {
  almacen = {};
  respuestaFisuras = [
    cruda({ node: "Ceres", missionType: "Defense", tier: "Omnia" }),
    cruda({ node: "Marte", missionType: "Defense", tier: "Meso" }),
  ];
  await M.fetchAllFissures(true);

  // Omnia (Vacío Sin Fin) no se elige por tipo: es la fisura que sirve para cualquier
  // reliquia, y esconderla porque "Defense" no está marcado deja fuera la más útil.
  assert.deepEqual((await M.fetchBestFissures()).map((f) => f.node), ["Ceres"]);

  guardar({ missionTypes: ["Defense"], includeOmnia: false, includeRailjack: false, railjackTypes: [] });
  assert.deepEqual((await M.fetchBestFissures()).map((f) => f.node), ["Ceres", "Marte"]);
});

// --- Normalización y caché --------------------------------------------------------------

test("una fisura ya expirada no llega al panel", async () => {
  almacen = {};
  respuestaFisuras = [cruda({ node: "Viva" }), cruda({ node: "Muerta", expiry: min(-5) })];
  const r = await M.fetchAllFissures(true);
  assert.deepEqual(r.map((f) => f.node), ["Viva"]);
});

test("el contador pasa a horas y minutos al superar la hora", async () => {
  respuestaFisuras = [
    cruda({ node: "A", expiry: min(40.3) }),
    cruda({ node: "B", expiry: min(60.3) }),
    cruda({ node: "C", expiry: min(95.3) }),
  ];
  const r = await M.fetchAllFissures(true);
  assert.deepEqual(r.map((f) => f.eta), ["40m", "1h 0m", "1h 35m"]);
});

test("las banderas del panel exigen true, no un valor parecido", async () => {
  respuestaFisuras = [
    cruda({ node: "SP", isHard: true, tier: "Omnia", isStorm: true }),
    cruda({ node: "Normal", isHard: "false", isStorm: 0 }),
  ];
  const [sp, normal] = await M.fetchAllFissures(true);

  assert.deepEqual(
    { isSP: sp.isSP, isOmnia: sp.isOmnia, isStorm: sp.isStorm },
    { isSP: true, isOmnia: true, isStorm: true },
  );
  // La cadena "false" y el 0 vienen de parsers distintos; sin el === true, "false" pintaría
  // el badge de Steel Path en una fisura normal.
  assert.deepEqual(
    { isSP: normal.isSP, isOmnia: normal.isOmnia, isStorm: normal.isStorm },
    { isSP: false, isOmnia: false, isStorm: false },
  );
});

test("el worldstate se acepta como array, como cadena JSON y envuelto en {data}", async () => {
  respuestaFisuras = JSON.stringify([cruda({ node: "Cadena" })]);
  assert.deepEqual((await M.fetchAllFissures(true)).map((f) => f.node), ["Cadena"]);

  // Las tres formas salen de la cascada de fuentes del parser (warframestat.us, tenno.tools,
  // worldstate crudo): quien lea esto no elige de cuál viene la respuesta.
  respuestaFisuras = { data: [cruda({ node: "Envuelta" })] };
  assert.deepEqual((await M.fetchAllFissures(true)).map((f) => f.node), ["Envuelta"]);
});

test("un fallo del worker deja lo último bueno en pantalla, no una lista vacía", async () => {
  await sinRuido(async () => {
    respuestaFisuras = [cruda({ node: "Buena" })];
    await M.fetchAllFissures(true);

    // Timeout o cold start del worker. Vaciar el panel por un fallo transitorio es peor que
    // enseñar contadores un poco viejos: la siguiente ronda ya los corrige.
    fisurasOk = false;
    assert.deepEqual((await M.fetchAllFissures(true)).map((f) => f.node), ["Buena"]);
    fisurasOk = true;

    // Lo mismo con una respuesta bien formada pero que no es la lista esperada.
    respuestaFisuras = { error: "upstream" };
    assert.deepEqual((await M.fetchAllFissures(true)).map((f) => f.node), ["Buena"]);
  });
});

// El panel de rutas se pinta en tres sitios a la vez y cada instancia pedía sus fisuras. Con
// el worker frío, la que se comía el timeout pintaba "esperando fisura" sobre eras que la de
// al lado enseñaba abiertas — y el usuario lo veía como que el panel se rompía solo.
test("varias peticiones a la vez comparten una sola llamada al worker", async () => {
  respuestaFisuras = [cruda({ node: "Hepit (Void)" })];
  await M.fetchAllFissures(true);
  const antes = nFetch("type=fissures");

  // Sin caché fresca (force) y en paralelo: es el arranque en frío de las tres instancias.
  const [a, b, c] = await Promise.all([
    M.fetchAllFissures(true), M.fetchAllFissures(), M.fetchAllFissures(),
  ]);
  assert.equal(nFetch("type=fissures"), antes + 1, "una sola llamada para las tres");
  assert.deepEqual(a.map((f) => f.node), ["Hepit (Void)"]);
  assert.deepEqual(b, a);
  assert.deepEqual(c, a);
});

// "Esperando fisura" cuando lo que ha pasado es que no se pudo preguntar es una afirmación
// falsa: no es que no haya fisura de esa era, es que no se sabe. Quien pinte necesita poder
// distinguirlo para decirlo con palabras.
test("se sabe cuándo la lista vacía es un fallo y no una respuesta", async () => {
  await sinRuido(async () => {
    respuestaFisuras = [cruda({ node: "Buena" })];
    await M.fetchAllFissures(true);
    assert.equal(M.fissuresUnavailable(), false);

    // Falla PERO hay caché: se sirve lo último bueno, así que no hay nada que avisar.
    fisurasOk = false;
    await M.fetchAllFissures(true);
    assert.equal(M.fissuresUnavailable(), false, "con datos viejos que enseñar no se avisa");

    // Una respuesta vacía DE VERDAD (el worker contesta, no hay fisuras) tampoco avisa: es
    // un dato, no un fallo.
    fisurasOk = true;
    respuestaFisuras = [];
    await M.fetchAllFissures(true);
    assert.equal(M.fissuresUnavailable(), false);

    // Falla y no queda nada que servir: eso sí es "no lo sabemos", y es lo que separa
    // "esperando fisura" de "no se ha podido preguntar".
    fisurasOk = false;
    await M.fetchAllFissures(true);
    assert.equal(M.fissuresUnavailable(), true);

    // Y se limpia en cuanto vuelve a haber datos.
    fisurasOk = true;
    respuestaFisuras = [cruda({ node: "Buena" })];
    await M.fetchAllFissures(true);
    assert.equal(M.fissuresUnavailable(), false);
  });
});

test("cambiar de filtros no gasta una llamada al worker", async () => {
  respuestaFisuras = [cruda({ node: "Hepit (Void)" })];
  await M.fetchAllFissures(true);
  const antes = nFetch("type=fissures");

  // La caché guarda TODAS las fisuras sin filtrar justo para esto: el panel de filtros se
  // repinta a cada clic y el worker tiene 100k peticiones al día.
  await M.fetchBestFissures();
  await M.fetchAllFissures();
  assert.equal(nFetch("type=fissures"), antes);

  await M.fetchAllFissures(true);
  assert.equal(nFetch("type=fissures"), antes + 1, "el refresco manual sí tiene que salir a la red");
});

test("los tipos observados salen de los datos y separan Railjack del resto", async () => {
  respuestaFisuras = [
    cruda({ node: "A", missionType: "Capture" }),
    cruda({ node: "B", missionType: "Capture" }),
    cruda({ node: "C", missionType: "Alchemy" }),
    cruda({ node: "D", missionType: "Volatile", isStorm: true }),
    cruda({ node: "E", missionType: undefined }),
  ];
  await M.fetchAllFissures(true);

  // El panel fusiona esto con su lista fija: si DE saca un tipo nuevo ("Alchemy") sigue
  // siendo filtrable en vez de quedarse sin casilla y desaparecer de la vista.
  assert.deepEqual(M.getObservedMissionTypes(), { normal: ["Capture", "Alchemy"], railjack: ["Volatile"] });
});

// --- Arbitración ------------------------------------------------------------------------

test("el tier comunitario se rellena solo cuando el parser no lo trae", async () => {
  respuestaArby = {
    data: {
      current: { node: "Sechura (Pluto)", activation: min(-20), expiry: min(40) },
      upcoming: [
        { node: "Xini (Eris)", tier: "C", activation: min(40), expiry: min(100) },
        { node: "Nodo Inventado (X)", activation: min(100), expiry: min(160) },
      ],
    },
  };
  const a = await M.fetchArbitration(true);

  assert.equal(a.current.tier, "B", "Sechura sale de la tabla de nodos");
  // El parser lee browse.wf/arbyTiers y manda: la tabla local es solo el respaldo para
  // cuando esa fuente falla, así que no puede pisar lo que ya viene.
  assert.equal(a.upcoming[0].tier, "C");
  assert.equal(a.upcoming[1].tier, undefined, "un nodo desconocido se queda sin badge, no con uno inventado");
});

test("la arbitración en curso no se vuelve a pedir hasta que caduque", async () => {
  const antes = nFetch("type=arbitration");
  await M.fetchArbitration();
  // Rota cada hora en punto; una llamada por rotación y cliente es el presupuesto.
  assert.equal(nFetch("type=arbitration"), antes);
});

test("si la actual ya caducó se promociona la rotación que esté corriendo", async () => {
  respuestaArby = {
    current: { node: "Sechura (Pluto)", activation: min(-70), expiry: min(-10) },
    upcoming: [
      { node: "Xini (Eris)", activation: min(-10), expiry: min(50) },
      { node: "Cinxia (Ceres)", activation: min(50), expiry: min(110) },
    ],
  };
  await M.fetchArbitration(true);

  // El parser puede servir una "current" vencida desde su caché; sin promocionar, las alarmas
  // por tier mínimo no dispararían nunca en esa ventana.
  const activa = await M.fetchActiveArbitration();
  assert.deepEqual(activa.map((m) => [m.node, m.tier]), [["Xini (Eris)", "S"]]);
});

test("sin ninguna rotación válida se devuelve lista vacía, no la caducada", async () => {
  respuestaArby = { current: { node: "Sechura (Pluto)", activation: min(-70), expiry: min(-10) }, upcoming: [] };
  await M.fetchArbitration(true);
  assert.deepEqual(await M.fetchActiveArbitration(), []);
});

test("un error pidiendo la arbitración conserva la última conocida", async () => {
  await sinRuido(async () => {
    respuestaArby = { current: { node: "Cinxia (Ceres)", activation: min(-5), expiry: min(55) }, upcoming: [] };
    await M.fetchArbitration(true);

    arbyOk = false;
    const r = await M.fetchArbitration(true);
    arbyOk = true;
    assert.equal(r.current.node, "Cinxia (Ceres)");
  });
});

// --- Rescate del reloj (va el último: mueve el offset global) ----------------------------

test("con el reloj del cliente adelantado las fisuras no desaparecen del panel", async () => {
  const offset = globalThis._serverTimeOffset;
  try {
    await sinRuido(async () => {
      // Escenario: el ping de hora falló y el reloj local va ~30 min adelantado. Todo lo que
      // manda el servidor parece caducado, el filtro por expiry lo tira todo y el panel se
      // queda vacío / en "ROTATING" con las fisuras vivas.
      globalThis._serverTimeOffset = 0;
      respuestaFisuras = [
        cruda({ node: "Hepit (Void)", activation: min(-85), expiry: min(-25) }),
        cruda({ node: "Tessera (Venus)", activation: min(-70), expiry: min(-10) }),
      ];
      const r = await M.fetchAllFissures(true);

      assert.equal(r.length, 2, "el desfase se deduce de los propios datos y las rescata");
      assert.ok(globalThis._serverTimeOffset > 0, "y queda registrado para el resto de contadores");
      assert.ok(r.every((f) => /^\d+m$|^\dh \d+m$/.test(f.eta)), r.map((f) => f.eta).join());
    });
  } finally {
    globalThis._serverTimeOffset = offset;
  }
});

/** Versión síncrona de sinRuido, para los casos que no son async. */
function sinRuidoSync(fn) {
  const { error, warn } = console;
  console.error = console.warn = () => {};
  try { return fn(); } finally { console.error = error; console.warn = warn; }
}
