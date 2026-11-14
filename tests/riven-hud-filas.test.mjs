import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.localStorage = { getItem: () => null, setItem: () => {} };
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.document = { getElementById: () => null, createElement: () => ({ style: {} }), addEventListener() {} };
globalThis.fetch = async () => ({ ok: false, json: async () => ({}) });
const { state } = await import("../deploy/js/state.js");
const { getRivenStatRange } = await import("../deploy/js/utils/rivens/riven_logic.js");
const { filasTasacion, filaStatHtml, statOverlay } = await import("../deploy/js/ui.components/rivens/ui_riven_hud_filas.js");
state.weaponMap = { Torid: { t: "Rifle" } };

const extremos = (nombre, isNeg) => { const r = getRivenStatRange({ t: "Rifle" }, nombre, isNeg, 2, true); const a = Math.abs(r.min), b = Math.abs(r.max); return [Math.min(a, b), Math.max(a, b)]; };
const META = { pos: ["Critical Chance"], neg: ["Zoom"] };
const POSITIVAS = [{ name: "Multishot", value: extremos("Multishot", false)[1], isPositive: true }, { name: "Critical Damage", value: extremos("Critical Damage", false)[1], isPositive: true }];
const ultima = (neg, meta, isEs) => filasTasacion({ weaponName: "Torid", stats: [...POSITIVAS, neg] }, meta, isEs).at(-1);

test("una negativa dañina dentro de rango dice su penalización en vez de un porcentaje", () => {
  const [min, max] = extremos("Critical Chance", true);
  const caso = (v, isEs) => ultima({ name: "Critical Chance", value: v, isPositive: false }, META, isEs);

  const leveEs = caso(min, true);
  const leveEn = caso(min, false);
  assert.equal(leveEs.corto, "PENALIZACIÓN LEVE");
  assert.equal(leveEs.nivel, "PENALIZACIÓN LEVE");
  assert.equal(leveEn.corto, "MILD PENALTY");

  const mediaEs = caso((min + max) / 2, true);
  const mediaEn = caso((min + max) / 2, false);
  assert.equal(mediaEs.corto, "PENALIZACIÓN MEDIA");
  assert.equal(mediaEs.nivel, "PENALIZACIÓN MEDIA");
  assert.equal(mediaEn.corto, "MODERATE PENALTY");

  const fuerteEs = caso(max, true);
  const fuerteEn = caso(max, false);
  assert.equal(fuerteEs.corto, "PENALIZACIÓN FUERTE");
  assert.equal(fuerteEs.nivel, "PENALIZACIÓN FUERTE");
  assert.equal(fuerteEn.corto, "HEAVY PENALTY");

  for (const f of [leveEs, mediaEs, fuerteEs]) {
    assert.equal(f.corto.includes("%"), false);
    assert.equal(f.atenuado, false);
  }
});

test("una negativa inofensiva dentro de rango sale atenuada como da igual", () => {
  const es = ultima({ name: "Zoom", value: extremos("Zoom", true)[0], isPositive: false }, META, true);
  const en = ultima({ name: "Zoom", value: extremos("Zoom", true)[0], isPositive: false }, META, false);
  assert.equal(es.atenuado, true);
  assert.equal(es.corto, "da igual");
  assert.equal(en.corto, "fine");
});

test("un valor fuera de rango se marca fuera", () => {
  const es = ultima({ name: "Zoom", value: extremos("Zoom", true)[1] * 3, isPositive: false }, META, true);
  const en = ultima({ name: "Zoom", value: extremos("Zoom", true)[1] * 3, isPositive: false }, META, false);
  assert.equal(es.claseNivel, "fuera");
  assert.equal(es.nivel, "FUERA DE RANGO");
  assert.equal(es.corto, "fuera");
  assert.equal(en.nivel, "OUT OF RANGE");
  assert.equal(en.corto, "out");
});

test("una positiva conserva su porcentaje y sin tipo de arma no hay rango", () => {
  assert.equal(filasTasacion({ weaponName: "Torid", stats: [...POSITIVAS, { name: "Zoom", value: extremos("Zoom", true)[0], isPositive: false }] }, META, true)[0].corto, "100%");
  const sin = filasTasacion({ weaponName: "ArmaInventada", stats: [{ name: "Zoom", value: 5, isPositive: false }] }, null, true)[0];
  assert.equal(sin.pos, null);
  assert.equal(sin.corto, "—");
  assert.equal(sin.nivel, "Sin rango conocido");
  assert.equal(sin.claseNivel, "nula");
  assert.equal(sin.nivelCalidad, "sindato");
});

test("la fila del hud escapa el texto, lleva sus clases y oculta el medidor sin rango", () => {
  const f = { texto: "<b>x</b>", calidad: "A&B", nivel: "PENALIZACIÓN FUERTE", nivelLargo: "PENALIZACIÓN FUERTE", positivo: false, nivelCalidad: "ruinosa", claseNivel: "baja", atenuado: true, pos: { bondad: 0.5, cortes: [0.33, 0.66] } };
  const html = filaStatHtml(f);
  assert.ok(html.startsWith('<div class="hud-fila neg tas-cal-ruinosa tas-nivel-baja tas-atenuado">'));
  assert.ok(html.includes("&lt;b&gt;x&lt;/b&gt;"));
  assert.ok(html.includes("A&amp;B"));
  assert.ok(!html.includes("<b>x</b>"));
  assert.ok(html.includes("--pos:50.0%;--c1:33.0%;--c2:66.0%"));
  const sinMedidor = filaStatHtml({ ...f, pos: null, atenuado: false });
  assert.ok(sinMedidor.includes('<span class="hud-medidor" style="visibility:hidden"></span>'));
  assert.ok(!sinMedidor.includes("tas-atenuado"));
});

test("la tirada del overlay toma el texto corto, su tono y su medidor", () => {
  const f = { texto: "+10% Zoom", positivo: false, nivelCalidad: "ruinosa", calidad: "RUINOSA", claseNivel: "baja", corto: "PENALIZACIÓN FUERTE", atenuado: false, pos: { bondad: 0.126 } };
  assert.deepEqual(statOverlay(f), { texto: "+10% Zoom", positivo: false, calidad: { texto: "RUINOSA", tono: "gradoF" }, tirada: { texto: "PENALIZACIÓN FUERTE", tono: "gradoF", medidor: { pos: 13, nivel: "baja", atenuado: false } } });
  assert.equal(statOverlay({ ...f, atenuado: true }).tirada.tono, "gris");
  const sin = statOverlay({ ...f, nivelCalidad: "sindato", pos: null, claseNivel: "nula", corto: "—" });
  assert.equal("calidad" in sin, false);
  assert.deepEqual(sin.tirada.medidor, { pos: 0, nivel: "nula" });
});
