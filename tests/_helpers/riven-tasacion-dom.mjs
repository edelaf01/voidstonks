import { afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

export function createMockElement(tag = "div") {
  const el = {
    tagName: tag.toUpperCase(),
    className: "",
    style: {},
    dataset: {},
    children: [],
    attributes: {},
    listeners: {},
    _innerHTML: "",
    get innerHTML() {
      return this._innerHTML;
    },
    set innerHTML(val) {
      this._innerHTML = String(val);
      this._textContent = this._innerHTML.replace(/<[^>]*>/g, "");
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
      this.children.push(child);
      return child;
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
        el.className = Array.from(this._classes).join(" ");
      },
      remove(...cls) {
        for (const c of cls) this._classes.delete(c);
        el.className = Array.from(this._classes).join(" ");
      },
      contains(c) {
        return this._classes.has(c) || el.className.split(/\s+/).includes(c);
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
    dispatchEvent(evt) {
      const fns = this.listeners[evt.type] || [];
      for (const fn of fns) fn(evt);
    },
    insertAdjacentHTML(position, html) {
      this.innerHTML += html;
    },
    registeredSelectors: {},
    querySelector(sel) {
      if (this.registeredSelectors[sel]) return this.registeredSelectors[sel];
      for (const child of this.children) {
        if (child.querySelector) {
          const res = child.querySelector(sel);
          if (res) return res;
        }
      }
      return null;
    },
  };
  return el;
}

export const mockElementsById = {};

globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.document = {
  body: createMockElement("body"),
  createElement: (tag) => createMockElement(tag),
  getElementById: (id) => mockElementsById[id] ?? null,
  addEventListener: () => {},
};

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

export const requestedUrls = [];
export const mock = { auctions: [] };

afterEach(() => {
  mock.auctions = [];
  for (const k of Object.keys(mockElementsById)) delete mockElementsById[k];
  requestedUrls.length = 0;
});

globalThis.fetch = async (url) => {
  const urlStr = String(url);
  requestedUrls.push(urlStr);
  if (urlStr.includes("type=riven")) {
    return {
      ok: true,
      json: async () => ({
        payload: {
          auctions: mock.auctions,
        },
      }),
    };
  }
  const base = urlStr.split("/").pop().split("?")[0];
  const ruta = base === "de10.json"
    ? new URL("../fixtures/de10_fijo.json", import.meta.url)
    : new URL(`../../deploy/assets/ml/${base}`, import.meta.url);
  if (!fs.existsSync(ruta)) return { ok: false, status: 404, json: async () => ({}) };
  const buf = fs.readFileSync(ruta);
  return { ok: true, json: async () => JSON.parse(buf.toString()) };
};

export function createMockEstCard() {
  const estCard = createMockElement("div");
  const fp = createMockElement("span");
  const fr = createMockElement("div");
  const ml = createMockElement("div");
  const ss = createMockElement("b");
  ss.textContent = "…";
  const rs = createMockElement("b");
  rs.textContent = "…";
  const mk = createMockElement("span");
  const comp = createMockElement("span");

  estCard.registeredSelectors = {
    "[data-fair-price]": fp,
    "[data-fair-range]": fr,
    "[data-ml-line]": ml,
    "[data-stat-score] b": ss,
    "[data-roll-score] b": rs,
    "[data-market-line]": mk,
    "[data-comp-line]": comp,
  };
  return { estCard, fp, fr, ml, ss, rs, mk, comp };
}

export const PESOS_BUENOS = { "Critical Chance": 1, "Critical Damage": 1 };

export async function armaConPerfil(quiereBaja) {
  const { predictRivenMLBand, weaponPrecision } = await import("../../deploy/js/utils/rivens/riven_ml.js");
  const lista = [
    "Rubico", "Soma", "Torid", "Boltor", "Lex", "Tigris", "Ignis", "Vectis",
    "Kohm", "Dread", "Tonkor", "Sybaris", "Burston", "Latron", "Hek", "Strun",
  ];
  const stats = [
    { name: "Critical Chance", value: 120, isPositive: true, minIdeal: 50, maxIdeal: 150 },
    { name: "Critical Damage", value: 120, isPositive: true, minIdeal: 50, maxIdeal: 150 },
    { name: "Zoom", value: 30, isPositive: false, minIdeal: 20, maxIdeal: 60 },
  ];
  for (const name of lista) {
    const band = await predictRivenMLBand({ name, official_median: 300 }, stats, { name, t: "Rifle", dynamic_weights: quiereBaja ? undefined : PESOS_BUENOS }, null, 90);
    const prec = await weaponPrecision(name);
    if (Number.isFinite(prec?.mape) && prec.mape < 100 && (band.confianza === "baja") === quiereBaja) {
      return name;
    }
  }
  assert.fail(`No se encontro arma con perfil quiereBaja=${quiereBaja}`);
}

function findDescendant(node, predicate) {
  for (const child of node.children) {
    if (predicate(child)) return child;
    const found = findDescendant(child, predicate);
    if (found) return found;
  }
  return null;
}

function attachQuerySelector(el) {
  el.querySelector = function (sel) {
    if (sel.endsWith(" b")) {
      const attr = sel.slice(1, -3);
      const host = findDescendant(this, (c) => c.getAttribute(attr) !== null);
      return host ? findDescendant(host, (c) => c.tagName === "B") : null;
    }
    if (sel.startsWith("[") && sel.endsWith("]")) {
      const attr = sel.slice(1, -1);
      return findDescendant(this, (c) => c.getAttribute(attr) !== null);
    }
    return null;
  };
}

export function montarTarjeta(html) {
  const root = createMockElement("div");
  attachQuerySelector(root);

  const VOID_TAGS = new Set(["img", "br", "input", "hr", "meta", "link"]);
  const ATTR_RE = /([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  const stack = [];

  let i = 0;
  while (i < html.length) {
    if (html[i] !== "<") {
      i++;
      continue;
    }
    let inQuote = null;
    let j = i + 1;
    while (j < html.length) {
      const ch = html[j];
      if (inQuote) {
        if (ch === inQuote) inQuote = null;
      } else if (ch === '"' || ch === "'") {
        inQuote = ch;
      } else if (ch === ">") {
        break;
      }
      j++;
    }
    if (j >= html.length) break;

    const tagStr = html.slice(i, j + 1);
    const tagEnd = j + 1;

    if (tagStr.startsWith("<!--")) {
      i = tagEnd;
      continue;
    }

    if (tagStr.startsWith("</")) {
      const tagName = tagStr.slice(2, -1).trim().toLowerCase();
      for (let s = stack.length - 1; s >= 0; s--) {
        if (stack[s].tagName === tagName) {
          while (stack.length > s) {
            const item = stack.pop();
            item.element.innerHTML = html.slice(item.contentStart, i);
          }
          break;
        }
      }
      i = tagEnd;
      continue;
    }

    const selfClosing = tagStr.endsWith("/>");
    const inner = tagStr.slice(1, selfClosing ? -2 : -1).trim();
    const spaceMatch = inner.match(/\s/);
    const spaceIdx = spaceMatch ? spaceMatch.index : -1;
    const tagName = (spaceIdx === -1 ? inner : inner.slice(0, spaceIdx)).toLowerCase();
    const rawAttrs = spaceIdx === -1 ? "" : inner.slice(spaceIdx);

    const el = createMockElement(tagName);
    attachQuerySelector(el);

    ATTR_RE.lastIndex = 0;
    let attrMatch;
    while ((attrMatch = ATTR_RE.exec(rawAttrs)) !== null) {
      const attrName = attrMatch[1];
      const attrVal = attrMatch[2] ?? attrMatch[3] ?? attrMatch[4] ?? "";
      el.setAttribute(attrName, attrVal);
      if (attrName === "style") {
        for (const part of attrVal.split(";")) {
          const [pKey, pVal] = part.split(":").map((s) => s.trim());
          if (pKey && pVal) {
            const camelKey = pKey.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
            el.style[camelKey] = pVal;
          }
        }
      }
    }

    const parent = stack.length > 0 ? stack[stack.length - 1].element : root;
    parent.appendChild(el);

    const isVoid = selfClosing || VOID_TAGS.has(tagName);
    if (!isVoid) {
      stack.push({ element: el, tagName, contentStart: tagEnd });
    }

    i = tagEnd;
  }

  while (stack.length > 0) {
    const item = stack.pop();
    item.element.innerHTML = html.slice(item.contentStart, html.length);
  }

  root.innerHTML = html;
  return root;
}
