// Invariantes de los tooltips de métricas de rivens.
//
// Las tres reglas salen de cómo se pintan, no de gusto personal:
//   1. Sin etiquetas HTML — ui_components.js usa innerText para data-tooltip, así que un <b> se ve
//      como "<b>" en pantalla. Pasaba de verdad: el tooltip `max` mostraba
//      "<b>[DATOS REALES - DIGITAL EXTREMES]</b>" literalmente.
//   2. Sin comillas dobles — van dentro de data-tooltip="...", una comilla parte el atributo.
//   3. Bilingüe siempre (es + en), como el resto de la UI.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RIVEN_TOOLTIPS } from "../deploy/js/utils/rivens/riven_tooltips.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// La ficha de meta-stats se lee como fuente porque necesita DOM; los tooltips ya no, así que
// se comprueban sobre el objeto: cuando la tabla se movió a utils/, la versión que raspaba el
// fuente con una regex se puso roja sin que faltara un solo texto.
const SRC = fs.readFileSync(
  path.resolve(__dirname, "../deploy/js/ui.components/rivens/ui_riven_meta_stats.js"), "utf8");

const entradas = Object.keys(RIVEN_TOOLTIPS);
const cadenas = entradas.flatMap((k) => [
  { lang: "es", texto: RIVEN_TOOLTIPS[k].es ?? "" },
  { lang: "en", texto: RIVEN_TOOLTIPS[k].en ?? "" },
].filter((c) => RIVEN_TOOLTIPS[k][c.lang] !== undefined));

test("cada métrica tiene texto en español y en inglés", () => {
  assert.ok(entradas.length >= 8, `se esperaban >=8 métricas; hay ${entradas.length}`);
  const es = cadenas.filter(c => c.lang === "es").length;
  const en = cadenas.filter(c => c.lang === "en").length;
  assert.equal(es, entradas.length, `faltan textos es: ${es} para ${entradas.length} métricas`);
  assert.equal(en, entradas.length, `faltan textos en: ${en} para ${entradas.length} métricas`);
});

test("ningún tooltip lleva etiquetas HTML (se pintan con innerText)", () => {
  const malos = cadenas.filter(c => /<\/?[a-z][^>]*>/i.test(c.texto))
    .map(c => `${c.lang}: ${c.texto.slice(0, 60)}`);
  assert.deepEqual(malos, [],
    `data-tooltip usa innerText: el HTML se vería literal. Ofensores: ${malos.join(" | ")}`);
});

test("ningún tooltip está vacío ni empieza por espacio", () => {
  // Varios arrastraban un espacio inicial (" El precio mediano...") que se veía descolocado.
  const malos = cadenas.filter(c => !c.texto.trim() || c.texto !== c.texto.trim())
    .map(c => `${c.lang}: [${c.texto.slice(0, 40)}]`);
  assert.deepEqual(malos, [], `tooltips con espacios sobrantes o vacíos: ${malos.join(" | ")}`);
});

test("los tooltips explican, pero no son un ensayo", () => {
  const cortos = cadenas.filter(c => c.texto.length < 40).map(c => c.texto);
  assert.deepEqual(cortos, [], `demasiado cortos para explicar nada: ${cortos.join(" | ")}`);
  const largos = cadenas.filter(c => c.texto.length > 400).map(c => c.texto.slice(0, 50));
  assert.deepEqual(largos, [], `demasiado largos para un tooltip: ${largos.join(" | ")}`);
});

test("las etiquetas de las métricas de precio distinguen venta real de precio pedido", () => {
  // El error caro es confundir lo que se PIDE con lo que se PAGA (medido: los asks están ~13x por
  // encima de las ventas de DE). Si alguien renombra estas filas, que sea a conciencia.
  assert.match(SRC, /"Venta real · sin ciclar"/,
    "la fila de official_median debe decir que es VENTA REAL y SIN CICLAR");
  assert.match(SRC, /"Piden en WFM"/,
    "la fila de wfm_avg debe decir que es lo que PIDEN, no un precio de mercado");
  assert.ok(!/\$\{meta\.wfm_market_sample\} trades/.test(SRC),
    "wfm_market_sample son ofertas activas, no trades cerrados");
});
