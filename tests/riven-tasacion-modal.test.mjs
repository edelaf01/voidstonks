import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

function attachCardSelectors(el) {
  if (el.registeredSelectors && el.registeredSelectors["[data-fair-price]"]) return;
  const fp = createMockElement("span", false);
  fp.setAttribute("data-fair-price", "");
  fp.setAttribute("data-sin-cifra", "");
  fp.textContent = "…";

  const fr = createMockElement("div", false);
  fr.setAttribute("data-fair-range", "");

  const ml = createMockElement("div", false);
  ml.setAttribute("data-ml-line", "");

  const ss = createMockElement("b", false);
  ss.textContent = "…";

  const rs = createMockElement("b", false);
  rs.textContent = "…";

  const mk = createMockElement("span", false);
  mk.setAttribute("data-market-line", "");

  const comp = createMockElement("span", false);
  comp.setAttribute("data-comp-line", "");

  el.registeredSelectors = {
    ...el.registeredSelectors,
    "[data-fair-price]": fp,
    "[data-fair-range]": fr,
    "[data-ml-line]": ml,
    "[data-stat-score] b": ss,
    "[data-roll-score] b": rs,
    "[data-market-line]": mk,
    "[data-comp-line]": comp,
  };
}

function createMockElement(tag = "div", autoAttach = true) {
  const styleObj = {};
  const el = {
    tagName: tag.toUpperCase(),
    _className: "",
    get className() {
      return this._className;
    },
    set className(val) {
      this._className = String(val);
      if (this.classList) {
        this.classList._classes = new Set(this._className.split(/\s+/).filter(Boolean));
      }
      if (this._className.includes("grade-summary-card") || this._className.includes("gsc")) {
        attachCardSelectors(this);
      }
    },
    get style() {
      return styleObj;
    },
    set style(val) {
      if (typeof val === "string") {
        styleObj.cssText = val;
        val.split(";").forEach((rule) => {
          const idx = rule.indexOf(":");
          if (idx > -1) {
            const prop = rule.slice(0, idx).trim().replace(/-([a-z])/g, (_, c) => c.toUpperCase());
            const propVal = rule.slice(idx + 1).trim();
            if (prop) styleObj[prop] = propVal;
          }
        });
      } else if (typeof val === "object" && val !== null) {
        Object.assign(styleObj, val);
      }
    },
    dataset: {},
    children: [],
    attributes: {},
    listeners: {},
    offsetParent: {},
    _innerHTML: "",
    get innerHTML() {
      return this._innerHTML;
    },
    set innerHTML(val) {
      this._innerHTML = String(val);
      this._textContent = this._innerHTML.replace(/<[^>]*>/g, "");
      if (!this._innerHTML) {
        this.children = [];
      }
    },
    _textContent: "",
    get textContent() {
      return this._textContent;
    },
    set textContent(val) {
      this._textContent = String(val);
      this._innerHTML = String(val);
    },
    get innerText() {
      return this._textContent;
    },
    set innerText(val) {
      this._textContent = String(val);
      this._innerHTML = String(val);
    },
    appendChild(child) {
      if (child.nodeType === 11) {
        this.children.push(...child.children);
        child.children = [];
      } else {
        this.children.push(child);
      }
      return child;
    },
    replaceChildren(...newChildren) {
      this.children = [];
      for (const c of newChildren) {
        if (c.nodeType === 11) {
          this.children.push(...c.children);
          c.children = [];
        } else {
          this.children.push(c);
        }
      }
    },
    append(...items) {
      for (const item of items) {
        if (item.nodeType === 11) {
          this.children.push(...item.children);
          item.children = [];
        } else {
          this.children.push(item);
        }
      }
    },
    remove() {},
    contains(target) {
      if (this === target) return true;
      for (const c of this.children) {
        if (c.contains && c.contains(target)) return true;
      }
      return false;
    },
    setAttribute(k, v) {
      this.attributes[k] = String(v);
      if (k === "class") this.className = String(v);
      if (k.startsWith("data-")) {
        const camel = k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        this.dataset[camel] = String(v);
      }
    },
    getAttribute(k) {
      return this.attributes[k] ?? null;
    },
    removeAttribute(k) {
      delete this.attributes[k];
    },
    classList: {
      _classes: new Set(),
      add(...cls) {
        for (const c of cls) this._classes.add(c);
        el._className = Array.from(this._classes).join(" ");
      },
      remove(...cls) {
        for (const c of cls) this._classes.delete(c);
        el._className = Array.from(this._classes).join(" ");
      },
      contains(c) {
        return this._classes.has(c) || el._className.split(/\s+/).includes(c);
      },
      toggle(c) {
        if (this.contains(c)) {
          this.remove(c);
          return false;
        }
        this.add(c);
        return true;
      },
    },
    addEventListener(evt, fn) {
      if (!this.listeners[evt]) this.listeners[evt] = [];
      this.listeners[evt].push(fn);
    },
    removeEventListener(evt, fn) {
      if (this.listeners[evt]) {
        this.listeners[evt] = this.listeners[evt].filter((f) => f !== fn);
      }
    },
    dispatchEvent(evt) {
      const fns = this.listeners[evt.type] || [];
      for (const fn of fns) fn(evt);
    },
    insertAdjacentHTML(position, html) {
      this.innerHTML += html;
    },
    scrollIntoView() {},
    click() {
      const evt = { type: "click", target: this };
      const fns = this.listeners["click"] || [];
      for (const fn of fns) fn(evt);
    },
    registeredSelectors: {},
    querySelector(sel) {
      if (this.registeredSelectors && this.registeredSelectors[sel]) {
        return this.registeredSelectors[sel];
      }
      for (const child of this.children) {
        if (sel.startsWith(".") && child.classList?.contains(sel.slice(1))) return child;
        if (sel.startsWith("#") && child.id === sel.slice(1)) return child;
        if (child.querySelector) {
          const res = child.querySelector(sel);
          if (res) return res;
        }
      }
      return null;
    },
    querySelectorAll(sel) {
      const matches = [];
      const walk = (node) => {
        for (const child of node.children || []) {
          if (sel.startsWith(".") && child.classList?.contains(sel.slice(1))) matches.push(child);
          else if (sel.startsWith("#") && child.id === sel.slice(1)) matches.push(child);
          walk(child);
        }
      };
      walk(this);
      return matches;
    },
  };
  if (autoAttach && tag.toLowerCase() === "div") {
    attachCardSelectors(el);
  }
  return el;
}

const mockElementsById = {};

globalThis.window = globalThis;
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
globalThis.matchMedia = (query) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
});
try {
  Object.defineProperty(globalThis, "navigator", {
    value: { userAgent: "node", maxTouchPoints: 0 },
    configurable: true,
    writable: true,
  });
} catch {}
globalThis.addEventListener = () => {};
globalThis.document = {
  body: createMockElement("body"),
  createElement: (tag) => createMockElement(tag),
  createDocumentFragment: () => {
    const frag = createMockElement("#document-fragment");
    frag.nodeType = 11;
    return frag;
  },
  getElementById: (id) => mockElementsById[id] ?? null,
  querySelector: (sel) => {
    for (const el of Object.values(mockElementsById)) {
      if (sel.startsWith(".") && el.classList?.contains(sel.slice(1))) return el;
      if (sel.startsWith("#") && el.id === sel.slice(1)) return el;
      if (el.querySelector) {
        const res = el.querySelector(sel);
        if (res) return res;
      }
    }
    return globalThis.document.body.querySelector(sel);
  },
  querySelectorAll: (sel) => {
    const matches = [];
    for (const el of Object.values(mockElementsById)) {
      if (sel.startsWith(".") && el.classList?.contains(sel.slice(1))) matches.push(el);
      else if (sel.startsWith("#") && el.id === sel.slice(1)) matches.push(el);
      if (el.querySelectorAll) {
        matches.push(...el.querySelectorAll(sel));
      }
    }
    return matches;
  },
  addEventListener: () => {},
};

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const requestedUrls = [];
let mockAuctions = [];
let historyGate = null;

globalThis.fetch = async (url) => {
  const urlStr = String(url);
  requestedUrls.push(urlStr);
  if (urlStr.includes("history")) {
    if (historyGate !== null) {
      await historyGate;
    }
    return { ok: true, json: async () => [] };
  }
  if (urlStr.includes("type=riven")) {
    return {
      ok: true,
      json: async () => ({
        payload: {
          auctions: mockAuctions,
        },
      }),
    };
  }
  const base = urlStr.split("/").pop().split("?")[0];
  const ruta = base === "de10.json"
    ? new URL("./fixtures/de10_fijo.json", import.meta.url)
    : new URL(`../deploy/assets/ml/${base}`, import.meta.url);
  if (!fs.existsSync(ruta)) return { ok: false, status: 404, json: async () => ({}) };
  const buf = fs.readFileSync(ruta);
  return { ok: true, json: async () => JSON.parse(buf.toString()) };
};

const { state } = await import("../deploy/js/state.js");
const { calculateModalGrade } = await import("../deploy/js/ui.components/rivens/ui_rivens.js");
const { fetchRivenAverage } = await import("../deploy/js/services/rivens/rivens.service.js");

function setupModalInputs(weaponName = "Haalvu", rank = "8", rolls = "0", mr = "16") {
  const rivenWeaponInput = createMockElement("input");
  rivenWeaponInput.value = weaponName;
  mockElementsById["rivenWeaponInput"] = rivenWeaponInput;

  const gRank = createMockElement("input");
  gRank.value = rank;
  mockElementsById["g-rank"] = gRank;

  for (const s of ["1", "2", "3", "Neg"]) {
    mockElementsById[`g-slider-container${s}`] = createMockElement("div");
    mockElementsById[`g-slider${s}`] = createMockElement("input");
    mockElementsById[`g-slider-min${s}`] = createMockElement("span");
    mockElementsById[`g-slider-max${s}`] = createMockElement("span");
  }

  const gStat1 = createMockElement("select");
  gStat1.value = "Critical Chance";
  mockElementsById["g-stat1"] = gStat1;

  const gVal1 = createMockElement("input");
  gVal1.value = "150";
  mockElementsById["g-val1"] = gVal1;

  const gStat2 = createMockElement("select");
  gStat2.value = "Critical Damage";
  mockElementsById["g-stat2"] = gStat2;

  const gVal2 = createMockElement("input");
  gVal2.value = "120";
  mockElementsById["g-val2"] = gVal2;

  const gStat3 = createMockElement("select");
  gStat3.value = "";
  mockElementsById["g-stat3"] = gStat3;

  const gVal3 = createMockElement("input");
  gVal3.value = "";
  mockElementsById["g-val3"] = gVal3;

  const gStatNeg = createMockElement("select");
  gStatNeg.value = "";
  mockElementsById["g-statNeg"] = gStatNeg;

  const gValNeg = createMockElement("input");
  gValNeg.value = "";
  mockElementsById["g-valNeg"] = gValNeg;

  const gRolls = createMockElement("input");
  gRolls.value = rolls;
  mockElementsById["g-rolls"] = gRolls;

  const gMr = createMockElement("input");
  gMr.value = mr;
  mockElementsById["g-mr"] = gMr;

  const resultsDiv = createMockElement("div");
  resultsDiv.id = "grading-modal-results";
  mockElementsById["grading-modal-results"] = resultsDiv;

  return { resultsDiv, rivenWeaponInput };
}

async function waitForCondition(predicate, timeout = 3000, step = 20) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, step));
  }
  throw new Error(`Timeout waiting for condition after ${timeout}ms`);
}

function findCard(el) {
  if (!el) return null;
  if (el.className && el.className.includes("grade-summary-card")) return el;
  for (const c of el.children || []) {
    const res = findCard(c);
    if (res) return res;
  }
  return null;
}

function findAllCards(el) {
  if (!el) return [];
  const cards = [];
  if (el.className && el.className.includes("grade-summary-card")) cards.push(el);
  for (const c of el.children || []) {
    cards.push(...findAllCards(c));
  }
  return cards;
}

afterEach(() => {
  historyGate = null;
  mockAuctions = [];
  for (const k of Object.keys(mockElementsById)) delete mockElementsById[k];
  requestedUrls.length = 0;
  delete globalThis.activeGradingRolls;
  state.currentLang = "es";
  state.currentWeaponHistory = null;
  state.rivenStatPrior = null;
  state.weaponMap = {
    Torid: { name: "Torid", t: "Rifle", d: 1.4 },
    Haalvu: { name: "Haalvu", t: "Rifle", d: 1.0 },
  };
  state.rivenIndexData = {
    Torid: { official_median: 357, pos: ["Critical Chance", "Multishot"], neg: ["Zoom"] },
  };
});

test("calculateModalGrade arma sin meta en pagina nueva tasa con ML y deja precio tipico sin datos", async () => {
  state.currentLang = "es";
  state.currentWeaponHistory = null;
  state.rivenStatPrior = null;
  state.weaponMap = {
    Torid: { name: "Torid", t: "Rifle", d: 1.4 },
    Haalvu: { name: "Haalvu", t: "Rifle", d: 1.0 },
  };
  state.rivenIndexData = {
    Torid: { official_median: 357, pos: ["Critical Chance", "Multishot"], neg: ["Zoom"] },
  };

  assert.equal(mockElementsById["riven-avg-value"], undefined);

  const { resultsDiv } = setupModalInputs("Haalvu");

  const logs = [];
  const origLog = console.log;
  console.log = (...args) => {
    logs.push(args.join(" "));
    origLog(...args);
  };

  try {
    calculateModalGrade();
    await waitForCondition(() => logs.some((l) => l.includes("[ML fusion] Haalvu")));
    await new Promise((r) => setTimeout(r, 60));

    const card = findCard(resultsDiv);
    assert.ok(card);

    const fusionLog = logs.find((l) => l.includes("[ML fusion] Haalvu"));
    assert.ok(fusionLog);
    const match = fusionLog.match(/fair=(\d+)/);
    assert.ok(match);
    const fair = Number(match[1]);
    assert.ok(fair > 0);

    assert.ok(card.innerHTML.includes("Precio típico: <b>sin datos</b>"));
    assert.equal(card.innerHTML.includes("Precio típico: <b>50"), false);
    assert.equal(card.innerHTML.includes("50<span class=\"plat-icon\""), false);

    const fp = card.querySelector("[data-fair-price]");
    assert.ok(fp);
    assert.ok(fp.textContent.startsWith("~"));
    assert.equal(fp.textContent, `~${fair}`);

    assert.equal(fp.getAttribute("data-sin-cifra"), null);
    assert.equal("data-sin-cifra" in fp.attributes, false);

    const rs = card.querySelector("[data-roll-score] b");
    assert.ok(rs);
    assert.notEqual(rs.textContent, "…");
    assert.notEqual(rs.textContent, "—");
    assert.match(rs.textContent, /\d+%/);
  } finally {
    console.log = origLog;
  }
});

test("calculateModalGrade arma sin meta con HUD tasa ambos rolls en results-compare-row", async () => {
  state.currentLang = "es";
  state.weaponMap = {
    Torid: { name: "Torid", t: "Rifle", d: 1.4 },
    Haalvu: { name: "Haalvu", t: "Rifle", d: 1.0 },
  };

  const { resultsDiv } = setupModalInputs("Haalvu");

  globalThis.activeGradingRolls = {
    activeIndex: 0,
    rollL: {
      rolls: 3,
      mr: 16,
      stats: [
        { name: "Critical Chance", value: 150, isPositive: true },
        { name: "Critical Damage", value: 120, isPositive: true },
      ],
    },
    rollR: {
      rolls: 3,
      mr: 16,
      stats: [
        { name: "Multishot", value: 90, isPositive: true },
        { name: "Critical Damage", value: 110, isPositive: true },
      ],
    },
  };

  const logs = [];
  const origLog = console.log;
  console.log = (...args) => {
    logs.push(args.join(" "));
    origLog(...args);
  };

  try {
    calculateModalGrade();
    await waitForCondition(() => logs.filter((l) => l.includes("[ML fusion] Haalvu")).length >= 2);
    await new Promise((r) => setTimeout(r, 60));

    const fusionLogs = logs.filter((l) => l.includes("[ML fusion] Haalvu"));
    assert.ok(fusionLogs.length >= 2);

    const compareRow = resultsDiv.querySelector(".results-compare-row") || resultsDiv.children.find((c) => c.className === "results-compare-row");
    assert.ok(compareRow);

    const cards = findAllCards(compareRow);
    assert.equal(cards.length, 2);

    for (const card of cards) {
      const fp = card.querySelector("[data-fair-price]");
      assert.ok(fp);
      assert.ok(fp.textContent.startsWith("~"));
      assert.equal(fp.getAttribute("data-sin-cifra"), null);
    }
  } finally {
    console.log = origLog;
  }
});

test("calculateModalGrade secuencia Haalvu Torid Haalvu no transfiere mediana entre armas", async () => {
  state.currentLang = "es";
  state.weaponMap = {
    Torid: { name: "Torid", t: "Rifle", d: 1.4 },
    Haalvu: { name: "Haalvu", t: "Rifle", d: 1.0 },
  };
  state.rivenIndexData = {
    Torid: { official_median: 357, pos: ["Critical Chance", "Multishot"], neg: ["Zoom"] },
  };

  const { resultsDiv, rivenWeaponInput } = setupModalInputs("Haalvu");

  const logs = [];
  const origLog = console.log;
  console.log = (...args) => {
    logs.push(args.join(" "));
    origLog(...args);
  };

  try {
    logs.length = 0;
    calculateModalGrade();
    await waitForCondition(() => logs.some((l) => l.includes("[ML fusion] Haalvu")));
    await new Promise((r) => setTimeout(r, 60));

    const card1 = findCard(resultsDiv);
    assert.ok(card1);
    const log1 = logs.find((l) => l.includes("[ML fusion] Haalvu"));
    const match1 = log1.match(/fair=(\d+)/);
    const fair1 = Number(match1[1]);
    assert.ok(fair1 > 0);

    rivenWeaponInput.value = "Torid";
    logs.length = 0;
    calculateModalGrade();
    await waitForCondition(() => logs.some((l) => l.includes("[ML fusion] Torid")));
    await new Promise((r) => setTimeout(r, 60));

    const cardTorid = findCard(resultsDiv);
    assert.ok(cardTorid);
    assert.ok(cardTorid.innerHTML.includes("357"));

    rivenWeaponInput.value = "Haalvu";
    logs.length = 0;
    calculateModalGrade();
    await waitForCondition(() => logs.some((l) => l.includes("[ML fusion] Haalvu")));
    await new Promise((r) => setTimeout(r, 60));

    const card2 = findCard(resultsDiv);
    assert.ok(card2);
    const log2 = logs.find((l) => l.includes("[ML fusion] Haalvu"));
    const match2 = log2.match(/fair=(\d+)/);
    const fair2 = Number(match2[1]);

    assert.equal(fair1, fair2);
    assert.ok(card2.innerHTML.includes("Precio típico: <b>sin datos</b>"));
    assert.equal(card2.innerHTML.includes("357"), false);
  } finally {
    console.log = origLog;
  }
});

test("fetchRivenAverage rellena contenedor con meta y deja N/A sin meta", async () => {
  state.currentLang = "es";
  state.rivenIndexData = {
    Torid: {
      official_median: 357,
      de_unrolled: { median: 357, min_price: 150, max_price: 900 },
      de_rerolled: { median: 785, min_price: 300, max_price: 2500 },
      wfm_avg_price: 310,
      web_min: 120,
      wfm_market_sample: 42,
    },
  };

  const ids = [
    "riven-avg-box",
    "riven-unrolled-title", "riven-unrolled-subtitle",
    "riven-rerolled-title", "riven-rerolled-subtitle",
    "riven-web-title", "riven-web-subtitle",
    "riven-unrolled-median", "riven-unrolled-min", "riven-unrolled-max",
    "riven-rerolled-median", "riven-rerolled-min", "riven-rerolled-max",
    "riven-web-avg", "riven-web-min", "riven-web-orders",
  ];
  for (const id of ids) {
    mockElementsById[id] = createMockElement("div");
  }

  await fetchRivenAverage("Torid");

  assert.equal(mockElementsById["riven-avg-box"].style.display, "block");
  assert.equal(mockElementsById["riven-unrolled-title"].innerText, "Sin Ciclos");
  assert.equal(mockElementsById["riven-unrolled-median"].innerText, "357");
  assert.equal(mockElementsById["riven-unrolled-min"].innerText, "150");
  assert.equal(mockElementsById["riven-unrolled-max"].innerText, "900");
  assert.equal(mockElementsById["riven-rerolled-median"].innerText, "785");
  assert.equal(mockElementsById["riven-rerolled-min"].innerText, "300");
  assert.equal(mockElementsById["riven-rerolled-max"].innerText, "2500");
  assert.equal(mockElementsById["riven-web-avg"].innerText, "310");
  assert.equal(mockElementsById["riven-web-min"].innerText, "120");
  assert.equal(mockElementsById["riven-web-orders"].innerText, "42");

  await fetchRivenAverage("Haalvu");

  assert.equal(mockElementsById["riven-avg-box"].style.display, "block");
  const numFields = [
    "riven-unrolled-median", "riven-unrolled-min", "riven-unrolled-max",
    "riven-rerolled-median", "riven-rerolled-min", "riven-rerolled-max",
    "riven-web-avg", "riven-web-min", "riven-web-orders",
  ];
  for (const fieldId of numFields) {
    assert.equal(mockElementsById[fieldId].innerText, "N/A");
  }
});

test("calculateModalGrade no opera si el input esta vacio o el arma no esta en weaponMap", async () => {
  state.weaponMap = {
    Torid: { name: "Torid", t: "Rifle", d: 1.4 },
    Haalvu: { name: "Haalvu", t: "Rifle", d: 1.0 },
  };

  const { resultsDiv, rivenWeaponInput } = setupModalInputs("");
  requestedUrls.length = 0;

  calculateModalGrade();
  await new Promise((r) => setTimeout(r, 350));

  assert.equal(resultsDiv.children.length, 0);
  assert.equal(requestedUrls.filter((u) => u.includes("history")).length, 0);

  rivenWeaponInput.value = "ArmaDesconocida";
  requestedUrls.length = 0;

  calculateModalGrade();
  await new Promise((r) => setTimeout(r, 350));

  assert.equal(resultsDiv.children.length, 0);
  assert.equal(requestedUrls.filter((u) => u.includes("history")).length, 0);
});

test("calculateModalGrade vuelve a pintar la tarjeta al llegar el historial y quita el aviso de carga", async () => {
  state.currentLang = "es";
  state.currentWeaponHistory = null;
  const { resultsDiv } = setupModalInputs("Haalvu");

  let soltar;
  historyGate = new Promise((r) => {
    soltar = r;
  });

  calculateModalGrade();

  await waitForCondition(() => {
    const card = findCard(resultsDiv);
    return card && card.innerHTML.includes("actualizando historial…");
  });

  assert.equal(state.currentWeaponHistory.weaponName, "Haalvu");
  assert.equal(state.currentWeaponHistory.loading, true);
  assert.equal(requestedUrls.filter((u) => u.includes("history?weapon=")).length, 1);

  soltar();

  await waitForCondition(() => {
    const card = findCard(resultsDiv);
    return card && !card.innerHTML.includes("actualizando historial…");
  }, 3000);

  assert.equal(state.currentWeaponHistory.loading, false);
  const finalCard = findCard(resultsDiv);
  assert.ok(finalCard);
  assert.ok(finalCard.innerHTML.includes("Precio típico: <b>sin datos</b>"));
  assert.equal(requestedUrls.filter((u) => u.includes("history?weapon=")).length, 1);
});

