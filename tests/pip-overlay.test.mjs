// the floating Picture-in-Picture window showing rewards while the game is in front
// it lives in ANOTHER document, so if the window closes or the API is missing each repaint would target a
// dead document, and the scanner calls `renderItemsInPiP` on every recognised frame; its cards are built
// with `innerHTML` from ocr names, so escaping is mandatory
// it is driven through the real door (`openPiP` with a fake `documentPictureInPicture`), so the window
// setup is covered too

import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeDocument } from "./_helpers/fake-canvas.mjs";

installFakeDocument();
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const { state } = await import("../deploy/js/state.js");
const PiP = await import("../deploy/js/utils/pip_overlay.js");

/** fake document for the PiP window: resolves by id whatever is attached to it */
function docPip() {
  const porId = new Map();
  const crear = () => {
    const el = {
      style: {}, dataset: {}, children: [], className: "", textContent: "",
      set id(v) { this._id = v; porId.set(v, el); },
      get id() { return this._id; },
      set innerHTML(v) {
        this._html = v;
        this.children.length = 0;   // like the real DOM: assigning innerHTML clears what was there
        // ids inside a template must be findable too
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
 * opens the window the real way (with a fake browser API), runs and closes NO MATTER WHAT: `pipWindow` is
 * module state, so a failure without closing would drag the rest along
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
    await PiP.openPiP();   // second call = close
    delete globalThis.documentPictureInPicture;
  }
}

const badges = (doc) => doc.getElementById("pip-badges");
const html1 = (doc) => badges(doc).children[0].innerHTML;

const item = (o = {}) => ({
  name: "Braton Prime Blueprint", price: 12, ducats: 15, owned: 1, appOwned: 0, ...o,
});

// the normal state: most users never open the PiP and the scanner calls renderItemsInPiP on every
// recognised frame
test("sin ventana abierta, pintar y limpiar no hacen nada ni fallan", () => {
  assert.equal(PiP.isPiPActive(), false);
  assert.doesNotThrow(() => PiP.renderItemsInPiP([item()]));
  assert.doesNotThrow(() => PiP.clearPiPBadges());
});

test("initPiP sin el botón en la página no rompe el arranque", () => {
  assert.doesNotThrow(() => PiP.initPiP());
});

// the button only makes sense if the browser has the API (Firefox and Safari do not); a button that does
// nothing is worse than none
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

// forma is neither sold nor bought: "click to add" or "BEST DUC" on it is noise
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

// a 0 price means "no data", not "worth 0": showing 0 would make users discard parts that are worth
// something
test("un precio sin datos se enseña como raya, no como cero", async () => {
  await conPip((doc) => {
    PiP.renderItemsInPiP([item({ price: 0 })]);
    assert.match(html1(doc), />\s*-\s*<\/div>/);
    assert.doesNotMatch(html1(doc), />\s*0\s*<\/div>/);
  });
});

test("con la ventana cerrada se deja de pintar", async () => {
  await conPip((doc, ventana) => {
    ventana.closed = true;
    PiP.renderItemsInPiP([item()]);
    assert.equal(badges(doc).children.length, 0);
    assert.equal(PiP.isPiPActive(), false);
    assert.doesNotThrow(() => PiP.clearPiPBadges());
  });
});

// the close-set label says what the whole set sells for: that is what decides the click
test("la tarjeta que cierra un set enseña el precio del set", async () => {
  await conPip((doc) => {
    PiP.renderItemsInPiP([item({ isCompletingSet: true, setPrice: 120 })]);
    assert.ok(html1(doc).includes("COMPLETES SET · 120p"), html1(doc).slice(0, 300));
    PiP.renderItemsInPiP([item({ isCompletingSet: true, setPrice: 0 })]);
    assert.ok(html1(doc).includes("COMPLETES SET<"), "sin precio conocido, sin número");
  });
});
