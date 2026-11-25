import { test } from "node:test";
import assert from "node:assert/strict";

class StubElement {
  constructor() {
    this.parentElement = null;
    this.scrollWidth = 100;
    this.clientWidth = 100;
    this.overflowX = "visible";
    this.closestResult = null;
  }
  closest(selector) {
    return this.closestResult;
  }
}

globalThis.Element = StubElement;
globalThis.getComputedStyle = (el) => ({
  overflowX: el?.overflowX || "visible",
});

const handlers = {};
const bodyClasses = new Set();
const tabButtons = ["relic", "bounties", "set", "orders"];

globalThis.document = {
  body: {
    classList: {
      contains: (cls) => bodyClasses.has(cls),
      add: (cls) => bodyClasses.add(cls),
      remove: (cls) => bodyClasses.delete(cls),
    },
  },
  addEventListener: (type, fn) => {
    handlers[type] = fn;
  },
  querySelectorAll: (selector) => {
    if (selector.includes(".tabs > .tab-btn")) {
      return tabButtons.map((id) => ({ id: `btn-${id}` }));
    }
    return [];
  },
  querySelector: (selector) => {
    if (selector === ".content-area") {
      return {
        classList: {
          add: () => {},
          remove: () => {},
        },
        offsetWidth: 100,
      };
    }
    return null;
  },
};

let coarsePointer = true;
globalThis.matchMedia = (query) => {
  if (query === "(pointer: coarse)") return { matches: coarsePointer };
  if (query === "(prefers-reduced-motion: reduce)") return { matches: false };
  return { matches: false };
};

const storage = new Map();
let storageThrows = false;
globalThis.localStorage = {
  getItem: (k) => {
    if (storageThrows) throw new Error("Storage failure");
    return storage.get(k) ?? null;
  },
  setItem: (k, v) => {
    if (storageThrows) throw new Error("Storage failure");
    storage.set(k, String(v));
  },
  clear: () => storage.clear(),
};

let currentSelection = "";
globalThis.getSelection = () => ({
  toString: () => currentSelection,
});

let switchedTabs = [];
globalThis.switchTab = (tab) => {
  switchedTabs.push(tab);
};

let switchedSubviews = [];
globalThis.switchFarmsSubview = (subview) => {
  switchedSubviews.push(subview);
};

let fakeNow = 1000;
const originalDateNow = Date.now;
Date.now = () => fakeNow;

const { initSwipeNav } = await import("../deploy/js/utils/swipe_nav.js");
const { state } = await import("../deploy/js/state.js");

function triggerTouchStart(target, x, y, count = 1) {
  const touches = [];
  for (let i = 0; i < count; i++) {
    touches.push({ clientX: x, clientY: y });
  }
  handlers.touchstart({ touches, target });
}

function triggerTouchEnd(x, y, count = 1) {
  const changedTouches = [];
  for (let i = 0; i < count; i++) {
    changedTouches.push({ clientX: x, clientY: y });
  }
  handlers.touchend({ changedTouches });
}

function resetEnv() {
  bodyClasses.clear();
  storage.clear();
  storageThrows = false;
  currentSelection = "";
  switchedTabs = [];
  switchedSubviews = [];
  fakeNow = 1000;
  state.activeTab = "relic";
}

test("initSwipeNav no registra listeners cuando pointer coarse es falso", () => {
  const tempHandlers = {};
  const originalAddEventListener = globalThis.document.addEventListener;
  globalThis.document.addEventListener = (type, fn) => {
    tempHandlers[type] = fn;
  };
  coarsePointer = false;
  initSwipeNav();
  coarsePointer = true;
  globalThis.document.addEventListener = originalAddEventListener;
  assert.equal(Object.keys(tempHandlers).length, 0);
});

initSwipeNav();

test("desplazamiento horizontal inferior a 72px no navega y con 72px sí navega", () => {
  resetEnv();
  state.activeTab = "relic";
  const target = new StubElement();

  fakeNow = 1000;
  triggerTouchStart(target, 100, 100);
  fakeNow = 1100;
  triggerTouchEnd(29, 100);
  assert.equal(switchedTabs.length, 0);

  resetEnv();
  state.activeTab = "relic";
  fakeNow = 1000;
  triggerTouchStart(target, 100, 100);
  fakeNow = 1100;
  triggerTouchEnd(28, 100);
  assert.deepEqual(switchedTabs, ["bounties"]);
});

test("ratio vertical demasiado alto cancela el swipe pero en el límite exacto navega", () => {
  resetEnv();
  state.activeTab = "relic";
  const target = new StubElement();

  fakeNow = 1000;
  triggerTouchStart(target, 100, 100);
  fakeNow = 1100;
  triggerTouchEnd(16, 150);
  assert.equal(switchedTabs.length, 0);

  resetEnv();
  state.activeTab = "relic";
  fakeNow = 1000;
  triggerTouchStart(target, 100, 100);
  fakeNow = 1100;
  triggerTouchEnd(15, 150);
  assert.deepEqual(switchedTabs, ["bounties"]);
});

test("duración de 700ms navega pero 701ms se considera gesto caducado", () => {
  resetEnv();
  state.activeTab = "relic";
  const target = new StubElement();

  fakeNow = 1000;
  triggerTouchStart(target, 100, 100);
  fakeNow = 1700;
  triggerTouchEnd(20, 100);
  assert.deepEqual(switchedTabs, ["bounties"]);

  resetEnv();
  state.activeTab = "relic";
  fakeNow = 1000;
  triggerTouchStart(target, 100, 100);
  fakeNow = 1701;
  triggerTouchEnd(20, 100);
  assert.equal(switchedTabs.length, 0);
});

test("dirección negativa avanza a la siguiente pestaña y positiva retrocede a la anterior", () => {
  resetEnv();
  state.activeTab = "set";
  const target = new StubElement();

  fakeNow = 1000;
  triggerTouchStart(target, 100, 100);
  fakeNow = 1100;
  triggerTouchEnd(20, 100);
  assert.deepEqual(switchedTabs, ["orders"]);

  resetEnv();
  state.activeTab = "set";
  fakeNow = 1000;
  triggerTouchStart(target, 100, 100);
  fakeNow = 1100;
  triggerTouchEnd(180, 100);
  assert.deepEqual(switchedTabs, ["bounties"]);
});

test("primera y última pestaña no navegan fuera de los límites de la lista", () => {
  resetEnv();
  state.activeTab = "relic";
  const target = new StubElement();

  fakeNow = 1000;
  triggerTouchStart(target, 100, 100);
  fakeNow = 1100;
  triggerTouchEnd(180, 100);
  assert.equal(switchedTabs.length, 0);

  resetEnv();
  state.activeTab = "orders";
  fakeNow = 1000;
  triggerTouchStart(target, 100, 100);
  fakeNow = 1100;
  triggerTouchEnd(20, 100);
  assert.equal(switchedTabs.length, 0);
});

test("multitouch con dos dedos en inicio o en fin es descartado", () => {
  resetEnv();
  state.activeTab = "relic";
  const target = new StubElement();

  fakeNow = 1000;
  triggerTouchStart(target, 100, 100, 2);
  fakeNow = 1100;
  triggerTouchEnd(20, 100, 1);
  assert.equal(switchedTabs.length, 0);

  resetEnv();
  state.activeTab = "relic";
  fakeNow = 1000;
  triggerTouchStart(target, 100, 100, 1);
  fakeNow = 1100;
  triggerTouchEnd(20, 100, 2);
  assert.equal(switchedTabs.length, 0);
});

test("selección de texto no vacía cancela la navegación por gesto", () => {
  resetEnv();
  state.activeTab = "relic";
  currentSelection = "texto seleccionado por usuario";
  const target = new StubElement();

  fakeNow = 1000;
  triggerTouchStart(target, 100, 100);
  fakeNow = 1100;
  triggerTouchEnd(20, 100);
  assert.equal(switchedTabs.length, 0);
});

test("elemento contenido en contenedor con scroll horizontal no activa navegación", () => {
  resetEnv();
  state.activeTab = "relic";
  const container = new StubElement();
  container.scrollWidth = 300;
  container.clientWidth = 100;
  container.overflowX = "auto";

  const target = new StubElement();
  target.parentElement = container;

  fakeNow = 1000;
  triggerTouchStart(target, 100, 100);
  fakeNow = 1100;
  triggerTouchEnd(20, 100);
  assert.equal(switchedTabs.length, 0);
});

test("target que coincide con selectores ignorados no inicia navegación", () => {
  resetEnv();
  state.activeTab = "relic";
  const target = new StubElement();
  target.closestResult = new StubElement();

  fakeNow = 1000;
  triggerTouchStart(target, 100, 100);
  fakeNow = 1100;
  triggerTouchEnd(20, 100);
  assert.equal(switchedTabs.length, 0);
});

test("cuerpo con clase tab-fan-open bloquea los gestos de navegación", () => {
  resetEnv();
  state.activeTab = "relic";
  bodyClasses.add("tab-fan-open");
  const target = new StubElement();

  fakeNow = 1000;
  triggerTouchStart(target, 100, 100);
  fakeNow = 1100;
  triggerTouchEnd(20, 100);
  assert.equal(switchedTabs.length, 0);
});

test("evento touchcancel cancela el gesto en curso", () => {
  resetEnv();
  state.activeTab = "relic";
  const target = new StubElement();

  fakeNow = 1000;
  triggerTouchStart(target, 100, 100);
  handlers.touchcancel();
  fakeNow = 1100;
  triggerTouchEnd(20, 100);
  assert.equal(switchedTabs.length, 0);
});

test("en pestaña bounties el swipe recorre subvistas antes de cambiar de pestaña", () => {
  resetEnv();
  state.activeTab = "bounties";
  storage.set("vs_farms_subview_v1", "bounties");
  const target = new StubElement();

  fakeNow = 1000;
  triggerTouchStart(target, 100, 100);
  fakeNow = 1100;
  triggerTouchEnd(20, 100);
  assert.deepEqual(switchedSubviews, ["weapons"]);
  assert.equal(switchedTabs.length, 0);

  resetEnv();
  state.activeTab = "bounties";
  storage.set("vs_farms_subview_v1", "weapons");
  fakeNow = 1000;
  triggerTouchStart(target, 100, 100);
  fakeNow = 1100;
  triggerTouchEnd(20, 100);
  assert.deepEqual(switchedSubviews, ["traders"]);
  assert.equal(switchedTabs.length, 0);

  resetEnv();
  state.activeTab = "bounties";
  storage.set("vs_farms_subview_v1", "traders");
  fakeNow = 1000;
  triggerTouchStart(target, 100, 100);
  fakeNow = 1100;
  triggerTouchEnd(20, 100);
  assert.deepEqual(switchedTabs, ["set"]);
});

test("desde la pestaña siguiente navegando hacia bounties resetea la subvista a bounties", () => {
  resetEnv();
  state.activeTab = "set";
  const target = new StubElement();

  fakeNow = 1000;
  triggerTouchStart(target, 100, 100);
  fakeNow = 1100;
  triggerTouchEnd(180, 100);
  assert.deepEqual(switchedTabs, ["bounties"]);
  assert.deepEqual(switchedSubviews, ["bounties"]);
});

test("localStorage con valor desconocido cae por defecto en subvista bounties", () => {
  resetEnv();
  state.activeTab = "bounties";
  storage.set("vs_farms_subview_v1", "valor_desconocido");
  const target = new StubElement();

  fakeNow = 1000;
  triggerTouchStart(target, 100, 100);
  fakeNow = 1100;
  triggerTouchEnd(20, 100);
  assert.deepEqual(switchedSubviews, ["weapons"]);
});

test("localStorage con error de lectura no interrumpe el flujo y usa subvista inicial", () => {
  resetEnv();
  state.activeTab = "bounties";
  storageThrows = true;
  const target = new StubElement();

  fakeNow = 1000;
  triggerTouchStart(target, 100, 100);
  fakeNow = 1100;
  triggerTouchEnd(20, 100);
  assert.deepEqual(switchedSubviews, ["weapons"]);
});
