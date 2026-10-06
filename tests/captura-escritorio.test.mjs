import { test } from "node:test";
import assert from "node:assert/strict";
import { creaEligeFuente } from "../desktop/electron/src/captura.js";

const WARFRAME = { id: "window:125829121:0", name: "Warframe" };
const PANTALLA = { id: "screen:399:0", name: "Pantalla 1" };

function prepara({ plataforma = "linux", env = { DISPLAY: ":0", XDG_SESSION_TYPE: "wayland" }, juego = () => true, fuentes = [PANTALLA, WARFRAME], falla = 0 } = {}) {
  const vistas = [];
  const pruebas = [];
  const elige = creaEligeFuente({
    plataforma,
    env,
    juegoEnX11: () => { pruebas.push(true); return juego(pruebas.length); },
    listaFuentes: async () => {
      vistas.push(env.XDG_SESSION_TYPE);
      if (vistas.length <= falla) throw new Error("sin fuentes");
      return fuentes;
    },
  });
  return { elige, env, vistas, pruebas };
}

function conLog(t) {
  const original = console.log;
  const lineas = [];
  console.log = (...a) => lineas.push(a.join(" "));
  t.after(() => { console.log = original; });
  return lineas;
}

test("en Wayland con el juego en X11 la primera lista se pide como x11 y el entorno vuelve", async (t) => {
  const log = conLog(t);
  const { elige, env, vistas } = prepara();
  assert.equal(await elige(), WARFRAME);
  assert.deepEqual(vistas, ["x11"]);
  assert.equal(env.XDG_SESSION_TYPE, "wayland");
  assert.deepEqual(log, ["[captura] motor x11"]);
});

test("en Wayland sin el juego en X11 se queda el portal", async (t) => {
  const log = conLog(t);
  const { elige, env, vistas } = prepara({ juego: () => false, fuentes: [{ id: "window:1:0:s", name: "" }] });
  assert.deepEqual(await elige(), { id: "window:1:0:s", name: "" });
  assert.deepEqual(vistas, ["wayland"]);
  assert.equal(env.XDG_SESSION_TYPE, "wayland");
  assert.deepEqual(log, ["[captura] motor sistema"]);
});

test("si buscar la ventana del juego falla se trata como que no está", async (t) => {
  const log = conLog(t);
  const { elige, vistas } = prepara({ juego: () => { throw new Error("sin libX11"); } });
  await elige();
  assert.deepEqual(vistas, ["wayland"]);
  assert.deepEqual(log, ["[captura] motor sistema"]);
});

test("en sesión X11, en Windows o sin DISPLAY ni se busca el juego ni se toca el entorno", async (t) => {
  conLog(t);
  for (const caso of [
    { env: { DISPLAY: ":0", XDG_SESSION_TYPE: "x11" } },
    { plataforma: "win32" },
    { env: { XDG_SESSION_TYPE: "wayland" } },
  ]) {
    const { elige, env, vistas, pruebas } = prepara(caso);
    const antes = env.XDG_SESSION_TYPE;
    await elige();
    assert.equal(pruebas.length, 0);
    assert.deepEqual(vistas, [antes]);
    assert.equal(env.XDG_SESSION_TYPE, antes);
  }
});

test("la decisión es solo la primera vez aunque el juego aparezca después", async (t) => {
  const log = conLog(t);
  const { elige, vistas, pruebas } = prepara({ juego: (n) => n > 1 });
  await elige();
  await elige();
  assert.equal(pruebas.length, 1);
  assert.deepEqual(vistas, ["wayland", "wayland"]);
  assert.equal(log.length, 1);
});

test("si la primera lista falla el entorno vuelve, el error sale y la siguiente decide otra vez", async (t) => {
  const log = conLog(t);
  const { elige, env, vistas } = prepara({ falla: 1 });
  await assert.rejects(elige, /sin fuentes/);
  assert.equal(env.XDG_SESSION_TYPE, "wayland");
  assert.equal(log.length, 0);
  assert.equal(await elige(), WARFRAME);
  assert.deepEqual(vistas, ["x11", "x11"]);
  assert.deepEqual(log, ["[captura] motor x11"]);
});

test("sin Warframe elige una pantalla, si no la primera, y sin fuentes null", async (t) => {
  conLog(t);
  const elige = async (fuentes) => prepara({ plataforma: "win32", fuentes }).elige();
  const firefox = { id: "window:7:0", name: "Firefox" };
  assert.equal(await elige([firefox, PANTALLA]), PANTALLA);
  assert.equal(await elige([firefox, { id: "window:8:0", name: "Chrome" }]), firefox);
  assert.equal(await elige([]), null);
  assert.equal(await elige(null), null);
});
