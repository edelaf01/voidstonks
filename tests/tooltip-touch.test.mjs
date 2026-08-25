import { test } from "node:test";
import assert from "node:assert/strict";

const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

function matchesSel(el, sel) {
  for (const raw of sel.split(",")) {
    const part = raw.trim();
    if (!part) continue;
    if (part.startsWith("#")) {
      if (el.attrs.id === part.slice(1)) return true;
      continue;
    }
    if (part.startsWith(".")) {
      if (el.classList.contains(part.slice(1))) return true;
      continue;
    }
    const m = /^([a-zA-Z]*)(?:\[([^\]]+)\])?$/.exec(part);
    if (!m) continue;
    const [, tag, attr] = m;
    if (tag && el.tagName !== tag.toUpperCase()) continue;
    if (attr && !(attr in el.attrs)) continue;
    return true;
  }
  return false;
}

function makeEl(tag = "div", attrs = {}) {
  const classes = new Set(String(attrs.class || "").split(" ").filter(Boolean));
  const el = {
    tagName: tag.toUpperCase(),
    attrs: { ...attrs },
    parentNode: null,
    children: [],
    dataset: {},
    style: {},
    innerHTML: "",
    innerText: "",
    offsetWidth: 120,
    offsetHeight: 40,
    get id() { return el.attrs.id || ""; },
    set id(v) { el.attrs.id = v; },
    get className() { return [...classes].join(" "); },
    set className(v) {
      classes.clear();
      String(v).split(" ").filter(Boolean).forEach((c) => classes.add(c));
    },
    classList: {
      add: (...c) => c.forEach((x) => classes.add(x)),
      remove: (...c) => c.forEach((x) => classes.delete(x)),
      contains: (c) => classes.has(c),
    },
    appendChild(child) {
      child.parentNode = el;
      el.children.push(child);
      return child;
    },
    remove() {},
    addEventListener() {},
    querySelector: () => null,
    getBoundingClientRect: () => ({ top: 0, left: 0, right: 0, bottom: 0 }),
    closest(sel) {
      let node = el;
      while (node) {
        if (matchesSel(node, sel)) return node;
        node = node.parentNode;
      }
      return null;
    },
  };
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith("data-")) el.dataset[camel(k.slice(5))] = v;
  }
  return el;
}

const listeners = {};
const body = makeEl("body");
globalThis.document = {
  getElementById: () => null,
  createElement: (t) => makeEl(t),
  addEventListener: (type, fn) => ((listeners[type] ||= []).push(fn)),
  querySelector: () => null,
  querySelectorAll: () => [],
  body,
};
globalThis.addEventListener = () => {};
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.innerWidth = 390;
globalThis.innerHeight = 844;

const { initGlobalTooltipSystem } = await import("../deploy/js/ui.components/ui_components.js");
initGlobalTooltipSystem();

const tooltipEl = body.children.at(-1);
const click = (target) => listeners.click.forEach((fn) => fn({ target, clientX: 50, clientY: 50 }));
const abierto = () => !tooltipEl.classList.contains("hidden");

const conDedo = () => (globalThis.matchMedia = (q) => ({ matches: q === "(hover: none)" }));
const conRaton = () => (globalThis.matchMedia = () => ({ matches: false }));

// in real tabs text sits inside a <span> that actually receives the tap
const pestana = body.appendChild(makeEl("button", {
  id: "btn-orders", class: "tab-btn orders is-wip",
  "data-tooltip": "Esperando a que warframe.market...",
}));
const textoPestana = pestana.appendChild(makeEl("span"));

const chipDucados = body.appendChild(makeEl("button", {
  id: "ducat-owned-chip", class: "ducat-chip active",
  "data-tooltip": "Apagarlo añade las piezas a 0, nunca el catálogo.",
}));

const enlace = body.appendChild(
  makeEl("a", { href: "guia.html", "data-tooltip": "Guía paso a paso" }));

const infoIcon = body.appendChild(
  makeEl("span", { class: "info-icon", "data-tooltip": "Qué significa esta métrica" }));

const fuera = body.appendChild(makeEl("div"));

const reset = () => {
  conRaton();
  click(fuera);
  assert.equal(abierto(), false);
};

test("en táctil, tocar una pestaña con tooltip no abre el tooltip", () => {
  reset();
  conDedo();
  click(textoPestana);
  assert.equal(abierto(), false, "el toque ya cambió de pestaña: el tooltip sobra encima");
});

test("en táctil, un botón que no cambia de pantalla conserva su tooltip", () => {
  reset();
  conDedo();
  click(chipDucados);
  assert.equal(abierto(), true, "su acción es instantánea: el tooltip no tapa nada nuevo");
  assert.equal(tooltipEl.innerText, "Apagarlo añade las piezas a 0, nunca el catálogo.");
});

test("en táctil, un enlace con tooltip tampoco lo abre", () => {
  reset();
  conDedo();
  click(enlace);
  assert.equal(abierto(), false);
});

test("en táctil, tocar la pestaña cierra el tooltip que hubiera abierto un ℹ️", () => {
  reset();
  conDedo();
  click(infoIcon);
  assert.equal(abierto(), true);
  click(textoPestana);
  assert.equal(abierto(), false);
});

test("en táctil, los disparadores que solo informan siguen abriendo y cerrando por toque", () => {
  reset();
  conDedo();
  click(infoIcon);
  assert.equal(abierto(), true, "sin este click el móvil no tiene forma de leer la ayuda");
  assert.equal(tooltipEl.innerText, "Qué significa esta métrica");
  click(infoIcon);
  assert.equal(abierto(), false, "tocar de nuevo el mismo disparador lo cierra");
  click(infoIcon);
  click(fuera);
  assert.equal(abierto(), false, "tocar fuera lo cierra");
});

test("con ratón, el botón conserva su tooltip al hacer click", () => {
  reset();
  conRaton();
  click(textoPestana);
  assert.equal(abierto(), true);
});
