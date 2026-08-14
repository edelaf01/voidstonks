// El carrusel afirma cosas sobre el mercado, así que lo que se protege aquí es que no MIENTA.
//
// La afirmación delicada es `solo_ask`: "los vendedores suben lo que piden y las ventas reales no se
// mueven". Solo es cierta si DE publicó dentro de la ventana. Como DE actualiza semanalmente y la
// serie es diaria, official_median solo cambia el 13% de los días: sin comprobarlo, un "venta +0%"
// significa casi siempre "DE no ha publicado", no "el precio real está quieto".
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const F = path.resolve(__dirname, "../deploy/assets/ml/curiosidades.json");
const hay = fs.existsSync(F);
const datos = hay ? JSON.parse(fs.readFileSync(F, "utf8")) : null;

test("si existe el fichero, tiene la forma que espera el front", { skip: !hay }, () => {
  assert.ok(Array.isArray(datos.eventos), "eventos debe ser un array");
  assert.match(String(datos.generado || ""), /^\d{4}-\d{2}-\d{2}$/, "generado debe ser una fecha");
  for (const e of datos.eventos) {
    for (const c of ["arma", "ask_pct", "ask_de", "ask_a", "ofertas", "solo_ask"]) {
      assert.ok(e[c] !== undefined, `falta el campo ${c} en ${JSON.stringify(e).slice(0, 60)}`);
    }
  }
});

test("un evento marcado solo_ask trae el dato de venta que lo respalda", { skip: !hay }, () => {
  // Si venta_pct es null, DE no publicó y NO se puede afirmar que el precio real siguiera quieto.
  const mentirosos = datos.eventos
    .filter(e => e.solo_ask && (e.venta_pct === null || e.venta_pct === undefined))
    .map(e => e.arma);
  assert.deepEqual(mentirosos, [],
    `solo_ask sin dato de venta: la frase afirmaría algo no observado. Armas: ${mentirosos.join(", ")}`);
});

test("solo_ask exige movimiento fuerte del ask y venta real plana", { skip: !hay }, () => {
  const malos = datos.eventos.filter(e => e.solo_ask
    && !(Math.abs(e.ask_pct) >= 60 && Math.abs(e.venta_pct) < 15))
    .map(e => `${e.arma}: ask ${e.ask_pct}% venta ${e.venta_pct}%`);
  assert.deepEqual(malos, [], `solo_ask mal clasificado: ${malos.slice(0, 4).join(" | ")}`);
});

test("los eventos superan los filtros anti-ruido", { skip: !hay }, () => {
  // Sin estos mínimos salían +8829% de armas con 9 ofertas donde apareció una cara.
  const flojos = datos.eventos.filter(e => e.ofertas < 12 || e.ask_de < 60 || e.ask_a < 60)
    .map(e => `${e.arma} (${e.ofertas} ofertas, ${e.ask_de}->${e.ask_a}p)`);
  assert.deepEqual(flojos, [], `eventos por debajo del umbral de ruido: ${flojos.slice(0, 4).join(" | ")}`);
});

test("no se repite arma: el carrusel no debe contar seis veces lo mismo", { skip: !hay }, () => {
  const nombres = datos.eventos.map(e => String(e.arma).toLowerCase());
  assert.equal(new Set(nombres).size, nombres.length, "hay armas duplicadas en el carrusel");
});

test("dentro de cada tipo, primero lo más reciente", { skip: !hay }, () => {
  // El array NO está globalmente ordenado por fecha a propósito: se hace una ronda entre tipos (el
  // más reciente de cada uno, luego el segundo de cada uno...) para que las primeras tarjetas den
  // variedad sin dejar de ser recientes. Lo que sí debe cumplirse es el orden DENTRO de cada tipo.
  const porTipo = {};
  for (const e of datos.eventos) (porTipo[e.tipo] ||= []).push(e.fecha);
  const malos = Object.entries(porTipo)
    .filter(([, f]) => f.join() !== [...f].sort().reverse().join())
    .map(([t]) => t);
  assert.deepEqual(malos, [], `tipos sin ordenar por fecha descendente: ${malos.join(", ")}`);
});

test("la primera tarjeta es el movimiento más reciente que hay", { skip: !hay }, () => {
  const fechas = datos.eventos.map(e => e.fecha);
  assert.equal(datos.eventos[0].fecha, [...fechas].sort().at(-1),
    "el carrusel abre por la primera tarjeta, así que debe ser la más reciente");
});

test("el carrusel es bilingüe y escapa el nombre del arma", () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, "../deploy/js/ui.components/rivens/ui_riven_curiosidades.js"), "utf8");
  const i = src.indexOf("function _curioFrase");
  assert.ok(i > 0, "no se encontró _curioFrase");
  const bloque = src.slice(i, i + 2200);
  assert.match(bloque, /isEs\s*\n?\s*\?/, "las frases deben tener versión es/en");
  assert.match(bloque, /escapeHTML\(/,
    "el nombre del arma viene de un JSON externo y va a innerHTML: hay que escaparlo");
});
