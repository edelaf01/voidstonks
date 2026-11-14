import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeDocument } from "./_helpers/fake-canvas.mjs";

installFakeDocument();

const { fmtPlat, fmtDuc } = await import("../deploy/js/utils/precio_icono.js");

test("fmtPlat formatea platino con clase e icono", () => {
  const el = fmtPlat(12, "kiosk-plat");
  assert.equal(el.className, "kiosk-plat");
  assert.equal(el.textContent, "12");
  assert.equal(el.children.length, 1);
  assert.equal(el.children[0].className, "plat-icon-inline");
});

test("fmtDuc formatea ducados con icono", () => {
  const el = fmtDuc(45, "kiosk-ducats");
  assert.equal(el.textContent, "45");
  assert.equal(el.children[0].className, "ducat-icon-inline");
});

test("fmtPlat maneja nulo y cero", () => {
  const vacio = fmtPlat(null);
  assert.equal(vacio.className, "");
  assert.equal(vacio.textContent, "");
  assert.equal(vacio.children.length, 0);

  const cero = fmtPlat(0);
  assert.equal(cero.textContent, "0");
  assert.equal(cero.children.length, 1);
});
