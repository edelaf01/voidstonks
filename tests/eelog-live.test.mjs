import { test } from "node:test";
import assert from "node:assert/strict";

const { parseLinea, nombrePantalla } = await import("../deploy/js/utils/eelog_events.js");
const { EELogLive } = await import("../deploy/js/services/scanner/eelog_live.service.js");

const RECOMPENSA = "612.104 Sys [Info]: Created /Lotus/Interface/ProjectionRewardChoice.swf";
const RELIQUIA = "41.860 Script [Info]: Dialog.lua: Dialog::CreateOkCancel(description=Are you sure you want to equip Neo Y2 Relic [EXCEPTIONAL] for this mission? It will be consumed if you seal the Void Fissure and extract., title= leftItem=/Menu/Confirm_Item_Yes, rightItem=/Menu/Confirm_Item_No)";

test("la pantalla de elegir recompensa es el contexto REWARD", () => {
  assert.deepEqual(parseLinea(RECOMPENSA), { tipo: "pantalla", swf: "ProjectionRewardChoice", contexto: "REWARD", t: 612.104 });
  assert.equal(nombrePantalla("ProjectionRewardChoice", "es"), "Elegir recompensa de fisura");
  assert.equal(nombrePantalla("ProjectionRewardChoice", "en"), "Fissure reward choice");
  assert.equal(nombrePantalla("PantallaNueva", "es"), "PantallaNueva");
});

test("el log distingue el kiosko de ducados de Baro del inventario normal", () => {
  assert.deepEqual(parseLinea("110.343 Script [Info]: InventoryTest.lua: InventoryTest - CurrMode: Selling Prime Parts"),
    { tipo: "inventario", modo: "Selling Prime Parts", kiosco: true, t: 110.343 });
  assert.equal(parseLinea("3541.694 Script [Info]: InventoryTest.lua: InventoryTest - CurrMode: Inventory").kiosco, false);
});

test("el inventario del juego es el contexto INVENTORY", () => {
  const ev = parseLinea("3541.735 Sys [Info]: Created /Lotus/Interface/InventoryTest.swf");
  assert.equal(ev.contexto, "INVENTORY");
  assert.equal(nombrePantalla(ev.swf, "es"), "Inventario");
});

test("el diálogo de equipar da la reliquia exacta", () => {
  assert.deepEqual(parseLinea(RELIQUIA), { tipo: "reliquia", nombre: "Neo Y2", refinamiento: "EXCEPTIONAL", t: 41.86 });
});

test("retículas, HUDs, avisos internos y ruido no son eventos", () => {
  for (const l of [
    "1.0 Sys [Info]: Created /Lotus/Interface/SpecialReticles/EvolvingMelee.swf",
    "1.0 Sys [Info]: Created /Lotus/Interface/PowerSuitCustomHuds/DuelistCustomHud.swf",
    "1.0 Sys [Info]: Created /Lotus/Interface/FocusGainMessage.swf",
    "23.318 Script [Info]: Dialog.lua: Dialog::CreateOkCancel(description=/Lotus/Language/Menu/Session_Creating, title= leftItem=nil, rightItem=nil)",
    "940.677 Sys [Info]: Full connectivity update took 10us",
    "",
  ]) assert.equal(parseLinea(l), null, l);
});

test("un diálogo con texto se conserva", () => {
  const ev = parseLinea("5.5 Script [Info]: Dialog.lua: Dialog::CreateOk(description=Trade complete, title= leftItem=nil)");
  assert.deepEqual(ev, { tipo: "dialogo", texto: "Trade complete", t: 5.5 });
});

test("el estado sigue la pantalla actual, la reliquia y el reinicio del juego", () => {
  let avisos = 0;
  const deja = EELogLive.escuchar(() => avisos++);
  let alEstado, alLeer, cortado = false;
  EELogLive.iniciar({ sigue: (o) => { ({ alEstado, alLeer } = o); return () => { cortado = true; }; } });
  EELogLive.iniciar({ sigue: () => assert.fail("no se abre dos veces") });

  alEstado("ruta", "");
  assert.equal(EELogLive.estado, "falta");
  alEstado("ruta", "/x/EE.log");
  assert.equal(EELogLive.estado, "leyendo");
  assert.equal(EELogLive.ruta, "/x/EE.log");

  alLeer([RELIQUIA, "ruido", RECOMPENSA]);
  assert.equal(EELogLive.pantalla.swf, "ProjectionRewardChoice");
  assert.equal(EELogLive.reliquia.nombre, "Neo Y2");
  assert.equal(EELogLive.eventos.length, 2);

  alEstado("falta", "/x/EE.log");
  assert.equal(EELogLive.estado, "falta");
  alLeer([RECOMPENSA]);
  assert.equal(EELogLive.estado, "leyendo", "si llegan líneas es que ya está leyendo");

  alEstado("reinicio", "/x/EE.log");
  assert.deepEqual([EELogLive.eventos.length, EELogLive.pantalla, EELogLive.reliquia], [0, null, null]);

  alLeer(Array.from({ length: 250 }, (_, i) => `${i}.0 Sys [Info]: Created /Lotus/Interface/Dialog.swf`));
  assert.equal(EELogLive.eventos.length, 200);
  assert.equal(EELogLive.eventos[0].t, 50);

  const antes = avisos;
  alLeer(["sin eventos"]);
  assert.equal(avisos, antes, "sin eventos nuevos no se repinta");

  EELogLive.parar();
  assert.equal(cortado, true);
  assert.equal(EELogLive.estado, "parado");
  deja();
});

const { ESTADO_JUEGO_INICIAL, siguienteEstado, modoEscaner, VENTANA_DESCONOCIDA_MS } = await import("../deploy/js/utils/eelog_estado.js");
const { nombreInterno } = await import("../deploy/js/utils/eelog_events.js");

const RONDA = [
  "64.824 Script [Info]: MissionIntro.lua: MissionName: TUVUL COMMONS",
  "300.797 Sys [Info]: Created /Lotus/Interface/ProjectionRewardChoice.swf",
  "306.067 Sys [Info]: VoidProjections: 5b460ffa113ac9f4cb2847ee gets reward /Lotus/StoreItems/Types/Recipes/Weapons/WeaponParts/VentoPrimeHandle",
  "306.127 Script [Info]: ProjectionRewardChoice.lua: Got rewards",
  "306.128 Script [Info]: ProjectionRewardChoice.lua: Missing icon data!",
  "306.128 Script [Info]: ProjectionRewardChoice.lua: Missing icon data!",
  "306.128 Script [Info]: ProjectionRewardChoice.lua: Missing icon data!",
  "321.128 Script [Info]: ProjectionRewardChoice.lua: Relic reward screen shut down",
  "321.231 Sys [Info]: Created /Lotus/Interface/ThemedProjectionManager.swf",
  "331.306 Script [Info]: Dialog.lua: Dialog::CreateOkCancel(description=Are you sure you want to refine and equip Neo Y2 Relic? It will cost 25 Void Traces and the relic will be consumed if you seal the Void Fissure and extract., title= leftItem=x)",
  "337.214 Sys [Info]: Created /Lotus/Interface/ProjectionRewardChoice.swf",
  "342.215 Script [Info]: ProjectionRewardChoice.lua: Relic reward screen shut down",
];

function recorre(lineas, ahora = 0) {
  const modos = [];
  let e = ESTADO_JUEGO_INICIAL;
  for (const l of lineas) {
    const ev = parseLinea(l);
    if (!ev) continue;
    e = siguienteEstado(e, ev, ahora);
    const m = modoEscaner(e, ahora);
    modos.push(m.modo + (m.contexto ? `:${m.tarjetas}` : ""));
  }
  return { e, modos };
}

test("en una ronda el escáner duerme, despierta en cuanto se crea la pantalla de recompensas y despierta para elegir reliquia", () => {
  const { e, modos } = recorre(RONDA);
  assert.deepEqual(modos, ["dormido", "normal", "normal", "forzado:null", "forzado:1", "forzado:2", "forzado:3",
    "dormido", "normal", "normal", "normal", "dormido"], "Got rewards llega a ráfagas (medido: 14,8 s tarde), así que no se espera a esa línea para despertar");
  assert.equal(e.mision, "TUVUL COMMONS");
  const abierta = siguienteEstado({ ...ESTADO_JUEGO_INICIAL, enMision: true }, parseLinea(RONDA[1]), 1234);
  assert.equal(abierta.recompensas.desde, 1234, "se apunta cuándo se abrió la pantalla para saber cuánto le queda");
  assert.equal(siguienteEstado(abierta, parseLinea(RONDA[3]), 9999).recompensas.desde, 1234);
});

test("la recompensa propia y la reliquia refinada al equiparla salen del log", () => {
  let e = ESTADO_JUEGO_INICIAL;
  for (const l of RONDA.slice(0, 4)) e = siguienteEstado(e, parseLinea(l));
  assert.equal(nombreInterno(e.recompensas.propia), "Vento Prime Handle");
  assert.deepEqual(parseLinea(RONDA[9]), { tipo: "reliquia", nombre: "Neo Y2", refinamiento: "EXCEPTIONAL", t: 331.306 });
});

test("la pantalla de fin de misión despierta al escáner aunque aún no hayas vuelto a la nave", () => {
  const fin = [
    RONDA[0],
    "15443.569 Sys [Info]: Created /Lotus/Interface/EndOfMatch.swf",
    "15508.224 Sys [Info]: Created /Lotus/Interface/EndOfMatch.swf",
    "15511.241 Input [Info]: Subscribing for /Lotus/Interface/EndOfMatch.swf with input filter /Lotus/Interface/EndOfMatchInputFilter",
  ];
  assert.deepEqual(recorre(fin).modos, ["dormido", "dormido", "dormido", "normal"], "en las infinitas EndOfMatch se crea en cada rotación: solo cuenta cuando toma el control");
});

test("fuera de la misión el escáner va como siempre", () => {
  const fin = [...RONDA, "2458.939 Script [Info]: EndOfMatch.lua: Skip ReturnedToShip"];
  assert.equal(recorre(fin).modos.at(-1), "normal");
  assert.equal(recorre(["2570.432 Net [Info]: GameRulesImpl - changing state from SS_ENDING to SS_ENDED"]).modos.at(-1), "normal");
  assert.equal(modoEscaner(ESTADO_JUEGO_INICIAL).modo, "normal");
});

test("un menú con apertura y cierre en plena misión despierta mientras está abierto", () => {
  const { modos } = recorre([RONDA[0],
    "1571.772 Script [Info]: EndOfMatch.lua: DBG: HudVis 1",
    "1573.340 Script [Info]: EndOfMatch.lua: DBG: HudVis 0",
    "65.524 Script [Info]: HudRedux.lua: DBG: HudVis 1",
    "321.231 Script [Info]: ThemedProjectionManager.lua: DBG: HudVis 2"]);
  assert.deepEqual(modos, ["dormido", "normal", "dormido", "dormido"]);
});

test("una pantalla desconocida en plena misión despierta un rato, las de juego no", () => {
  let e = siguienteEstado(ESTADO_JUEGO_INICIAL, parseLinea(RONDA[0]), 0);
  e = siguienteEstado(e, parseLinea("1.0 Sys [Info]: Created /Lotus/Interface/SurvivalReward.swf"), 0);
  assert.equal(modoEscaner(e, 0).modo, "dormido");
  e = siguienteEstado(e, parseLinea("1.0 Sys [Info]: Created /Lotus/Interface/GenericMenu.swf"), 1000);
  assert.equal(modoEscaner(e, 1000).modo, "normal");
  assert.equal(modoEscaner(e, 1000 + VENTANA_DESCONOCIDA_MS).modo, "dormido");
});

test("sin log, caído o reconectando, el escáner no se duerme", () => {
  EELogLive.cambiaEstado("ruta", "/x/EE.log");
  EELogLive.leer([RONDA[0]]);
  assert.equal(EELogLive.modoEscaner().modo, "dormido");
  EELogLive.cambiaEstado("error", "");
  assert.equal(EELogLive.estado, "error");
  assert.equal(EELogLive.modoEscaner(), null);
  EELogLive.cambiaEstado("ruta", "/x/EE.log");
  assert.equal(EELogLive.modoEscaner().modo, "normal", "la cola vuelve a llegar: se empieza de cero");
  EELogLive.parar();
  assert.equal(EELogLive.modoEscaner(), null);
});

test("reliquia intacta, refinar en el menú y el arma del ciclo de rivens salen del log", () => {
  assert.deepEqual(parseLinea("10.0 Script [Info]: Dialog.lua: Dialog::CreateOkCancel(description=Are you sure you want to equip Neo A3 Relic for this mission? It will be consumed if you seal the Void Fissure and extract., title= leftItem=x)"),
    { tipo: "reliquia", nombre: "Neo A3", refinamiento: "INTACT", t: 10 });
  assert.deepEqual(parseLinea("11.0 Script [Info]: Dialog.lua: Dialog::CreateOkCancel(description=Refine Neo A3 Relic to EXCEPTIONAL? It will cost 25., title= leftItem=x)"),
    { tipo: "refino", nombre: "Neo A3", refinamiento: "EXCEPTIONAL", t: 11 });
  assert.deepEqual(parseLinea("12.0 Script [Info]: Dialog.lua: Dialog::CreateOkCancel(description=Are you sure you want to cycle Kuva Bramma Gelican for 1,700?, title= leftItem=x)"),
    { tipo: "rivenCiclo", arma: "Kuva Bramma", riven: "Gelican", kuva: 1700, t: 12 });
  assert.equal(parseLinea("12.0 Script [Info]: Dialog.lua: Dialog::CreateOkCancel(description=Are you sure you want to cycle Miter Crita-acrido for 900?, title= leftItem=x)").arma, "Miter");
});

test("el arma del ciclo vale mientras sigue abierto y se olvida al salir", () => {
  const pasos = [
    "4888.711 Sys [Info]: Created /Lotus/Interface/OmegaRerollSelection.swf",
    "4915.801 Script [Info]: Dialog.lua: Dialog::CreateOkCancel(description=Are you sure you want to cycle Kuva Bramma Gelican for 1,700?, title= leftItem=x)",
    "4915.801 Sys [Info]: Created /Lotus/Interface/Dialog.swf",
  ];
  let e = ESTADO_JUEGO_INICIAL;
  for (const l of pasos) e = siguienteEstado(e, parseLinea(l));
  assert.deepEqual(e.riven, { arma: "Kuva Bramma", nombre: "Gelican" });
  e = siguienteEstado(e, parseLinea("5000.0 Sys [Info]: Created /Lotus/Interface/InventoryTest.swf"));
  assert.equal(e.riven, null);
  assert.equal(siguienteEstado(ESTADO_JUEGO_INICIAL, parseLinea(pasos[1])).riven, null, "sin el ciclo abierto no se apunta");
});

test("en una fisura sin fin cada ronda gasta la reliquia equipada, una vez y solo con lo que llega en vivo", () => {
  const equipa = (t, texto) => `${t} Script [Info]: Dialog.lua: Dialog::CreateOkCancel(description=Are you sure you want to ${texto} if you seal the Void Fissure and extract., title= leftItem=x)`;
  const llenas = (t) => `${t} Script [Info]: ProjectionRewardChoice.lua: Got rewards`;
  const gastadas = [];
  EELogLive.onReliquiaAbierta = (nombre) => gastadas.push(nombre);
  EELogLive.cambiaEstado("ruta", "/x/EE.log");
  EELogLive.leer([equipa(2190.751, "equip Lith A8 Relic [FLAWLESS] for this mission? It will be consumed"), llenas(2447.259)]);
  assert.deepEqual(gastadas, [], "lo que ya estaba en el log al arrancar no se descuenta otra vez");
  assert.equal(EELogLive.reliquiaPorGastar(), null);

  EELogLive.leer([equipa(3426.103, "equip Meso K9 Relic [EXCEPTIONAL] for this mission? It will be consumed")]);
  assert.equal(EELogLive.reliquiaPorGastar(), "Meso K9");
  EELogLive.leer([llenas(3655.734)]);
  EELogLive.leer([llenas(3790.0)]);
  EELogLive.leer([
    equipa(3052.708, "refine and equip Lith A8 Relic? It will cost 50 Void Traces and the relic will be consumed"),
    equipa(3055.844, "refine and equip Lith L8 Relic? It will cost 100 Void Traces and the relic will be consumed"),
    llenas(3170.411),
  ]);
  assert.deepEqual(gastadas, ["Meso K9", "Lith L8"], "una por ronda y la última que confirmaste");

  EELogLive.leer([equipa(3688.723, "equip Lith L8 Relic for this mission? It will be consumed")]);
  EELogLive.cambiaEstado("reinicio", "/x/EE.log");
  assert.equal(EELogLive.reliquiaPorGastar(), null, "un juego nuevo no hereda la reliquia pendiente");
  EELogLive.parar();
  EELogLive.onReliquiaAbierta = null;
});
