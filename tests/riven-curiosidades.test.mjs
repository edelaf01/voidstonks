// El carrusel afirma cosas sobre el mercado, así que lo que se protege aquí es que no MIENTA.
import { test, after } from "node:test";
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
    for (const c of ["arma", "tipo", "fecha", "pct", "de", "a", "fuente"]) {
      assert.ok(e[c] !== undefined, `falta el campo ${c} en ${JSON.stringify(e).slice(0, 60)}`);
    }
  }
});

test("todos los eventos son de fuente DE y tipos validos", { skip: !hay }, () => {
  const tiposValidos = new Set(["subida_venta", "bajada_venta", "volatil"]);
  for (const e of datos.eventos) {
    assert.equal(e.fuente, "de");
    assert.ok(tiposValidos.has(e.tipo), `tipo no valido: ${e.tipo}`);
  }
});

test("los eventos de precio cumplen los umbrales de valor y porcentaje", { skip: !hay }, () => {
  const eventosPrecio = datos.eventos.filter(e => e.tipo === "subida_venta" || e.tipo === "bajada_venta");
  for (const e of eventosPrecio) {
    assert.ok(e.de >= 40, `de menor a 40: ${e.de}`);
    assert.ok(e.a >= 40, `a menor a 40: ${e.a}`);
    assert.ok(Math.abs(e.pct) >= 25, `pct menor a 25%: ${e.pct}`);
    if (e.tipo === "subida_venta") {
      assert.ok(e.pct > 0, `pct debe ser positivo para subida_venta: ${e.pct}`);
    } else {
      assert.ok(e.pct < 0, `pct debe ser negativo para bajada_venta: ${e.pct}`);
    }
  }
});

test("los eventos globales usan solo los tipos permitidos", { skip: !hay }, () => {
  if (datos.globales) {
    assert.ok(Array.isArray(datos.globales), "globales debe ser un array");
    const tiposGlobales = new Set(["global_weekly", "global_prima", "global_cara"]);
    for (const g of datos.globales) {
      assert.ok(tiposGlobales.has(g.tipo), `tipo global no valido: ${g.tipo}`);
    }
  }
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

const originalFetch = globalThis.fetch;
const originalDocument = globalThis.document;
const originalWindow = globalThis.window;

function createFakeElement() {
  const classes = new Set();
  const attributes = new Map();
  const listeners = {};
  return {
    dataset: {},
    style: {},
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
    },
    getAttribute: (attr) => attributes.get(attr) || null,
    setAttribute: (attr, val) => attributes.set(attr, String(val)),
    removeAttribute: (attr) => attributes.delete(attr),
    addEventListener: (evt, fn) => {
      (listeners[evt] ||= []).push(fn);
    },
    dispatchEvent: (evt) => {
      for (const fn of (listeners[evt.type] || [])) fn(evt);
    },
    innerHTML: "",
    title: "",
    onclick: null,
    offsetWidth: 0,
    children: [],
  };
}

function createContainer() {
  const cont = createFakeElement();
  const txt = createFakeElement();
  const dots = createFakeElement();
  const prevBtn = createFakeElement();
  const nextBtn = createFakeElement();
  const icono = createFakeElement();
  const cuerpo = createFakeElement();
  const cab = createFakeElement();
  const frase = createFakeElement();

  cuerpo.querySelector = (sel) => {
    if (sel === ".curio-cab") return cab;
    if (sel === ".curio-frase") return frase;
    return null;
  };
  txt.querySelector = (sel) => {
    if (sel === ".curio-icon") return icono;
    if (sel === ".curio-cuerpo") return cuerpo;
    return null;
  };

  cont._txt = txt;
  cont._dots = dots;
  cont._prevBtn = prevBtn;
  cont._nextBtn = nextBtn;
  cont._cuerpo = cuerpo;
  cont._cab = cab;
  cont._frase = frase;
  cont._icono = icono;

  cont.querySelector = (sel) => {
    if (sel === "[data-curio-texto]") return txt;
    if (sel === "[data-curio-dots]") return dots;
    if (sel === "[data-curio-prev]") return prevBtn;
    if (sel === "[data-curio-next]") return nextBtn;
    if (sel === ".curio-cuerpo") return cuerpo;
    if (sel === ".curio-frase") return frase;
    if (sel === ".curio-cab") return cab;
    if (sel === ".curio-icon") return icono;
    return null;
  };

  cont.querySelectorAll = (sel) => {
    if (sel === "[data-curio-prev],[data-curio-next]") return [prevBtn, nextBtn];
    return [];
  };

  return cont;
}

const containers = {
  rivenCuriosidades: createContainer(),
  rivenCuriosidadesArma: createContainer(),
  rivenWeaponInput: { value: "", dispatchEvent: () => {}, scrollIntoView: () => {} },
};

const fakeDocument = {
  visibilityState: "visible",
  documentElement: { dataset: {} },
  hasFocus: () => true,
  getElementById: (id) => containers[id] || null,
};

const mockPayload = {
  generado: "2026-10-10",
  serie_hasta: "2026-10-10",
  globales: [
    { tipo: "global_weekly", fecha: "2026-10-10", suben: 45, bajan: 25 },
    { tipo: "global_prima", valor: 2.3, armas: 32 },
    { tipo: "global_cara", arma: "torid", valor: 280 },
  ],
  eventos: [
    {
      arma: "braton",
      fecha: "2026-10-10",
      desde: "2026-10-03",
      tipo: "subida_venta",
      pct: 35,
      de: 45,
      a: 60,
      pop_de: 3.1,
      fuente: "de",
    },
    {
      arma: "braton prime",
      fecha: "2026-10-09",
      desde: "2026-10-02",
      tipo: "bajada_venta",
      pct: -28,
      de: 90,
      a: 65,
      pop_de: 4.2,
      fuente: "de",
    },
    {
      arma: "lato",
      fecha: "2026-10-08",
      tipo: "subida_venta",
      pct: 30,
      de: 50,
      a: 65,
    },
    {
      arma: "lex",
      fecha: "2026-10-07",
      tipo: "especulacion",
      pct: 40,
      de: 55,
      a: 77,
      fuente: "de",
    },
  ],
};

globalThis.fetch = async () => ({
  ok: true,
  json: async () => mockPayload,
});
globalThis.document = fakeDocument;
if (!globalThis.window) {
  globalThis.window = globalThis;
}

const {
  _curioVisible,
  _curioFrase,
  _curioEventosDe,
  renderCuriosidades,
  renderCuriosidadesArma,
  stopCuriosidades,
} = await import("../deploy/js/ui.components/rivens/ui_riven_curiosidades.js");

after(() => {
  stopCuriosidades();
  globalThis.fetch = originalFetch;
  globalThis.document = originalDocument;
  globalThis.window = originalWindow;
});

test("_curioVisible valida tipos globales y eventos de fuente DE con porcentaje numerico", () => {
  assert.equal(_curioVisible(null), false);
  assert.equal(_curioVisible(undefined), false);
  assert.equal(_curioVisible({ tipo: "especulacion", fuente: "de", pct: 10 }), false);
  assert.equal(_curioVisible({ tipo: "desplome_ask", fuente: "de", pct: -10 }), false);
  assert.equal(_curioVisible({ tipo: "global_weekly" }), true);
  assert.equal(_curioVisible({ tipo: "global_prima" }), true);
  assert.equal(_curioVisible({ tipo: "global_cara" }), true);

  assert.equal(_curioVisible({ tipo: "subida_venta", fuente: "de", pct: 30 }), true);
  assert.equal(_curioVisible({ tipo: "bajada_venta", fuente: "de", pct: -30 }), true);
  assert.equal(_curioVisible({ tipo: "volatil", fuente: "de", pct: 50 }), true);

  assert.equal(_curioVisible({ tipo: "subida_venta", pct: 30 }), false);
  assert.equal(_curioVisible({ tipo: "subida_venta", fuente: "wfm", pct: 30 }), false);
  assert.equal(_curioVisible({ tipo: "subida_venta", fuente: "de", pct: null }), false);
  assert.equal(_curioVisible({ tipo: "subida_venta", fuente: "de", pct: NaN }), false);
  assert.equal(_curioVisible({ tipo: "subida_venta", fuente: "de", pct: "30" }), false);
  assert.equal(_curioVisible({ tipo: "subida_venta", fuente: "de", pct: undefined }), false);
  assert.equal(_curioVisible({ tipo: "subida_venta", fuente: "de", pct: Infinity }), false);
});

test("_curioFrase genera frases distintas en español e ingles escapando html y sin cadenas obsoletas", () => {
  const tipos = [
    { tipo: "global_weekly", suben: 12, bajan: 8 },
    { tipo: "global_prima", valor: 2.4, armas: 35 },
    { tipo: "global_cara", arma: "Braton", valor: 260 },
    { tipo: "subida_venta", arma: "Braton", de: 50, a: 80, pct: 60 },
    { tipo: "bajada_venta", arma: "Braton", de: 80, a: 50, pct: -38 },
    { tipo: "volatil", arma: "Braton", de: 0.3, a: 1.6, pct: 433 },
  ];

  for (const e of tipos) {
    const fEs = _curioFrase(e, true);
    const fEn = _curioFrase(e, false);
    assert.notEqual(fEs, fEn);
    for (const txt of [fEs, fEn]) {
      assert.ok(!txt.includes("ask"));
      assert.ok(!txt.includes("pide"));
      assert.ok(!txt.includes("—"));
    }
  }

  const eEscape = { arma: "<img src=x onerror=1>", tipo: "subida_venta", de: 50, a: 80, pct: 60 };
  const fraseEscape = _curioFrase(eEscape, true);
  assert.ok(fraseEscape.includes("&lt;img src=x onerror=1&gt;"));
  assert.ok(!fraseEscape.includes("<img src=x onerror=1>"));

  const eSube = { arma: "Braton", tipo: "subida_venta", de: 50, a: 80, pct: 25 };
  const eBaja = { arma: "Braton", tipo: "bajada_venta", de: 80, a: 50, pct: -25 };
  assert.ok(_curioFrase(eSube, true).includes('class="curio-sube"'));
  assert.ok(_curioFrase(eBaja, true).includes('class="curio-baja"'));

  const fSube = _curioFrase(eSube, true);
  assert.ok(fSube.includes("50p"));
  assert.ok(fSube.includes("80p"));

  const fWeekly = _curioFrase({ tipo: "global_weekly", suben: 44, bajan: 22 }, true);
  assert.ok(fWeekly.includes("44"));
  assert.ok(fWeekly.includes("22"));

  const fPrima = _curioFrase({ tipo: "global_prima", valor: 2.5, armas: 33 }, true);
  assert.ok(fPrima.includes("2.5×"));
  assert.ok(fPrima.includes("33 armas"));

  const fCara = _curioFrase({ tipo: "global_cara", arma: "Torid", valor: 290 }, true);
  assert.ok(fCara.includes("290p"));

  const eDesconocido = { arma: "Braton", tipo: "inexistente" };
  assert.equal(_curioFrase(eDesconocido, true), '<span class="curio-arma">Braton</span>');
  assert.equal(_curioFrase(eDesconocido, false), '<span class="curio-arma">Braton</span>');
});

test("integracion con fetch y DOM mockeados renderiza eventos DE y globales ignorando legacy", async () => {
  await renderCuriosidadesArma("Braton Prime");
  const contArma = containers.rivenCuriosidadesArma;
  assert.equal(contArma.classList.contains("hidden"), false);
  const fraseArma = contArma._frase.innerHTML;
  assert.ok(
    fraseArma === _curioFrase(mockPayload.eventos[0], false) ||
    fraseArma === _curioFrase(mockPayload.eventos[1], false) ||
    fraseArma === _curioFrase(mockPayload.eventos[0], true) ||
    fraseArma === _curioFrase(mockPayload.eventos[1], true)
  );
  assert.ok(!fraseArma.includes("lato"));
  assert.ok(!fraseArma.includes("lex"));

  const eventosBraton = _curioEventosDe("Braton Prime");
  assert.equal(eventosBraton.length, 2);
  for (const e of eventosBraton) {
    assert.ok(e.arma === "braton" || e.arma === "braton prime");
    assert.equal(e.fuente, "de");
    assert.ok(_curioVisible(e));
  }
  assert.equal(_curioEventosDe("lato").length, 0);
  assert.equal(_curioEventosDe("lex").length, 0);

  await renderCuriosidades();
  const contGlobal = containers.rivenCuriosidades;
  assert.equal(contGlobal.classList.contains("hidden"), false);
  const fraseGlobal = contGlobal._frase.innerHTML;
  const primeraGlobal = mockPayload.globales[0];
  assert.ok(
    fraseGlobal === _curioFrase(primeraGlobal, false) ||
    fraseGlobal === _curioFrase(primeraGlobal, true)
  );
  assert.ok(!fraseGlobal.includes("lato"));
  assert.ok(!fraseGlobal.includes("lex"));

  stopCuriosidades();
});
