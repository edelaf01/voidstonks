import { test } from "node:test";
import assert from "node:assert/strict";
import { posicionFuera, DEBAJO_PRIMERO, AL_LADO_PRIMERO } from "../deploy/js/utils/tooltip_position.js";

const vista = { ancho: 1920, alto: 1080 };
const caja = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });
const solapa = (r, p, ancho, alto) => p.left < r.right && p.left + ancho > r.left && p.top < r.bottom && p.top + alto > r.top;

test("en PC el tooltip sale debajo del botón y centrado, sin taparlo", () => {
  const boton = caja(900, 400, 120, 40);
  const p = posicionFuera(boton, 200, 60, vista);
  assert.deepEqual(p, { left: 860, top: 448 });
  assert.equal(solapa(boton, p, 200, 60), false);
});

test("pegado abajo sube encima del botón", () => {
  const boton = caja(900, 1030, 120, 40);
  const p = posicionFuera(boton, 200, 60, vista);
  assert.equal(p.top, 1030 - 8 - 60);
  assert.equal(solapa(boton, p, 200, 60), false);
});

test("un botón de la barra lateral arriba a la izquierda no queda debajo del tooltip", () => {
  const boton = caja(8, 8, 48, 48);
  const p = posicionFuera(boton, 300, 50, vista);
  assert.equal(p.left, 8);
  assert.equal(solapa(boton, p, 300, 50), false);
});

test("si no cabe ni arriba ni abajo se va a un lado", () => {
  const alto = caja(100, 20, 300, 1040);
  const p = posicionFuera(alto, 250, 120, vista);
  assert.equal(p.left, 408);
  assert.equal(solapa(alto, p, 250, 120), false);
});

test("los tooltips grandes prefieren el lado y se quedan dentro de la ventana", () => {
  const fila = caja(1700, 900, 180, 30);
  const p = posicionFuera(fila, 340, 400, vista, AL_LADO_PRIMERO);
  assert.equal(p.left, 1700 - 8 - 340);
  assert.ok(p.top + 400 <= 1080 - 8);
  assert.equal(solapa(fila, p, 340, 400), false);
});

test("si no cabe en ningún sitio al menos no se sale de la ventana", () => {
  const p = posicionFuera(caja(0, 0, 1920, 1080), 400, 300, vista, DEBAJO_PRIMERO);
  assert.ok(p.left >= 8 && p.top >= 8 && p.left + 400 <= 1912 && p.top + 300 <= 1072);
});
