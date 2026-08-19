// La ventanita flotante (Picture-in-Picture) que enseña las recompensas mientras el juego está
// en primer plano.
//
// Vive en OTRO documento: el suyo. Eso la hace frágil de una forma que no se ve — si la ventana
// se cierra, o el navegador no soporta la API, cada repintado apuntaría a un documento muerto, y
// el escáner llama a `renderItemsInPiP` en cada frame reconocido. Sus tarjetas se montan con
// `innerHTML` a partir de nombres que salen del OCR, así que el escapado es obligatorio.
//
// Se conduce por la puerta de verdad (`openPiP` con un `documentPictureInPicture` falso), no
// tocando el estado interno del módulo: así el test también cubre el montaje de la ventana.

import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeDocument } from "./_helpers/fake-canvas.mjs";

installFakeDocument();
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const { state } = await import("../deploy/js/state.js");
const PiP = await import("../deploy/js/utils/pip_overlay.js");

/** Documento de mentira para la ventana PiP: resuelve por id lo que se le cuelgue. */
function docPip() {
  const porId = new Map();
  const crear = () => {
    const el = {
      style: {}, dataset: {}, children: [], className: "", textContent: "",
      set id(v) { this._id = v; porId.set(v, el); },
      get id() { return this._id; },
      set innerHTML(v) {
        this._html = v;
        this.children.length = 0;   // como en el DOM real: asignar innerHTML borra lo que había
        // Los ids que vengan dentro de una plantilla también tienen que ser localizables.
        for (const m of String(v).matchAll(/id="([^"]+)"/g)) porId.set(m[1], crear());
      },
      get innerHTML() { return this._html || ""; },
      appendChild(n) { this.children.push(n); return n; },
      addEventListener() {},
      querySelector: () => null,
    };
    return el;
  };
  return {
    createElement: crear,
    getElementById: (id) => porId.get(id) || null,
    head: crear(),
    body: crear(),
  };
}

/**
 * Abre la ventana por la vía real (con una API de navegador falsa), ejecuta y cierra PASE LO QUE
 * PASE: `pipWindow` es estado de módulo, así que un fallo sin cerrar arrastraría al resto.
 */
async function conPip(fn) {
  const doc = docPip();
  const ventana = {
    document: doc, closed: false, addEventListener() {}, close() { ventana.closed = true; },
  };
  globalThis.documentPictureInPicture = { requestWindow: async () => ventana, window: ventana };
  await PiP.openPiP();
  try {
    await fn(doc, ventana);
  } finally {
    ventana.closed = false;
    await PiP.openPiP();   // segunda llamada = cerrar
    delete globalThis.documentPictureInPicture;
  }
}

const badges = (doc) => doc.getElementById("pip-badges");
const html1 = (doc) => badges(doc).children[0].innerHTML;

const item = (o = {}) => ({
  name: "Braton Prime Blueprint", price: 12, ducats: 15, owned: 1, appOwned: 0, ...o,
});

// --- Sin ventana abierta --------------------------------------------------------------------

// Es el estado normal: la mayoría de los usuarios nunca abre el PiP y el escáner llama a
// renderItemsInPiP en cada frame reconocido.
test("sin ventana abierta, pintar y limpiar no hacen nada ni fallan", () => {
  assert.equal(PiP.isPiPActive(), false);
  assert.doesNotThrow(() => PiP.renderItemsInPiP([item()]));
  assert.doesNotThrow(() => PiP.clearPiPBadges());
});

test("initPiP sin el botón en la página no rompe el arranque", () => {
  assert.doesNotThrow(() => PiP.initPiP());
});

// El botón solo tiene sentido si el navegador trae la API: Firefox y Safari no la tienen, y un
// botón que no hace nada es peor que no tenerlo.
test("el botón solo aparece si el navegador soporta PiP", () => {
  const doc = globalThis.document;
  const btn = { style: { display: "none" } };
  const getIdReal = doc.getElementById;
  doc.getElementById = (id) => (id === "btn-pip-toggle" ? btn : null);

  try {
    delete globalThis.documentPictureInPicture;
    PiP.initPiP();
    assert.equal(btn.style.display, "none", "sin API, el botón sigue oculto");

    globalThis.documentPictureInPicture = {};
    PiP.initPiP();
    assert.equal(btn.style.display, "inline-block");
  } finally {
    doc.getElementById = getIdReal;
    delete globalThis.documentPictureInPicture;
  }
});

// Sin la API, abrir avisa y no deja el módulo creyéndose abierto.
test("en un navegador sin soporte, abrir avisa y no queda a medias", async () => {
  delete globalThis.documentPictureInPicture;
  const avisos = [];
  const real = globalThis.alert;
  globalThis.alert = (m) => avisos.push(m);
  try {
    await PiP.openPiP();
    assert.equal(avisos.length, 1);
    assert.equal(PiP.isPiPActive(), false);
  } finally { globalThis.alert = real; }
});

// --- Con la ventana abierta -----------------------------------------------------------------

test("abrir la ventana monta sus contenedores y la marca como activa", async () => {
  await conPip((doc) => {
    assert.equal(PiP.isPiPActive(), true);
    assert.ok(badges(doc), "falta el contenedor de tarjetas");
    assert.ok(doc.getElementById("pip-idle"), "falta el estado en reposo");
  });
});

test("los nombres del OCR se escapan antes de ir a innerHTML", async () => {
  await conPip((doc) => {
    PiP.renderItemsInPiP([item({ name: "<img src=x onerror=alert(1)>" })]);
    const html = badges(doc).children.map((c) => c.innerHTML).join("");
    assert.ok(!html.includes("<img src=x"), html.slice(0, 200));
    assert.ok(html.includes("&lt;"), "debe salir escapado");
  });
});

test("una lista vacía deja la ventana en reposo en vez de en blanco", async () => {
  await conPip((doc) => {
    PiP.renderItemsInPiP([]);
    assert.equal(doc.getElementById("pip-idle").style.display, "flex");
    assert.equal(badges(doc).style.display, "none");
  });
});

test("cada repintado sustituye las tarjetas, no las acumula", async () => {
  await conPip((doc) => {
    PiP.renderItemsInPiP([item(), item({ name: "Forma Blueprint" })]);
    assert.equal(badges(doc).children.length, 2);

    PiP.renderItemsInPiP([item()]);
    assert.equal(badges(doc).children.length, 1, "se limpió antes de pintar");
  });
});

// Forma no se vende ni se compra: ofrecer "clic para añadir" o "BEST DUC" sobre ella es ruido.
test("Forma no ofrece añadir al inventario ni mejor ratio de ducados", async () => {
  await conPip((doc) => {
    PiP.renderItemsInPiP([item({ name: "Forma Blueprint", isBestEff: true })]);
    const html = html1(doc);
    assert.ok(!/CLIC PARA|CLICK TO/.test(html), html.slice(0, 300));
    assert.ok(!html.includes("BEST DUC"));
  });
});

test("los textos de la tarjeta siguen el idioma de la app", async () => {
  const antes = state.currentLang;
  try {
    await conPip((doc) => {
      state.currentLang = "es";
      PiP.renderItemsInPiP([item()]);
      assert.match(html1(doc), /CLIC PARA AÑADIR/);

      state.currentLang = "en";
      PiP.renderItemsInPiP([item()]);
      assert.match(html1(doc), /CLICK TO ADD/);
    });
  } finally { state.currentLang = antes; }
});

// Un precio a 0 significa "sin datos", no "vale 0 platino": enseñar un 0 haría descartar piezas
// que sí valen.
test("un precio sin datos se enseña como raya, no como cero", async () => {
  await conPip((doc) => {
    PiP.renderItemsInPiP([item({ price: 0 })]);
    assert.match(html1(doc), /—/);
  });
});

// El usuario puede cerrar la ventana en cualquier momento; el escáner sigue mandando frames.
test("con la ventana cerrada se deja de pintar", async () => {
  await conPip((doc, ventana) => {
    ventana.closed = true;
    PiP.renderItemsInPiP([item()]);
    assert.equal(badges(doc).children.length, 0);
    assert.equal(PiP.isPiPActive(), false);
    assert.doesNotThrow(() => PiP.clearPiPBadges());
  });
});
