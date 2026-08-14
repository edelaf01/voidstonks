// innerHTML sinks escape untrusted data (warframe.market API, worldstate, OCR)
// OCR and API resolve against closed catalogs, so there is no exploitable injection today: defense in
// depth
// if a catalog source changes, escaping is already in place and these tests preserve it
import { test } from "node:test";
import assert from "node:assert/strict";

// minimal DOM: only what showToast/escapeHTML touches
function makeEl(tag = "div") {
  const el = {
    tagName: tag.toUpperCase(),
    className: "",
    style: { setProperty() {} },
    children: [],
    _text: "",
    innerHTML: "",
    set textContent(v) {
      this._text = String(v);
      // like the browser: textContent escapes when read as innerHTML
      this.innerHTML = String(v)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    },
    get textContent() {
      return this._text;
    },
    appendChild(c) {
      this.children.push(c);
      return c;
    },
    remove() {},
    addEventListener() {},
    // showToast attaches .toast-close / .toast-action after rendering innerHTML
    querySelector() {
      return makeEl("span");
    },
    classList: { add() {}, remove() {}, contains: () => false },
  };
  return el;
}

const container = makeEl("div");
globalThis.document = {
  getElementById: (id) => (id === "toast-container" ? container : null),
  createElement: (t) => makeEl(t),
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {},
  body: makeEl(),
};
globalThis.addEventListener = () => {};
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const { escapeHTML, showToast } = await import("../deploy/js/ui.components/ui_components.js");

const PAYLOAD = `<img src=x onerror="alert(1)">`;

test("escapeHTML neutraliza markup", () => {
  const out = escapeHTML(PAYLOAD);
  assert.ok(!out.includes("<img"), `debería escapar '<': ${out}`);
  assert.ok(out.includes("&lt;"), `debería producir &lt;: ${out}`);
});

test("escapeHTML tolera null/undefined sin romper", () => {
  assert.equal(escapeHTML(null), "");
  assert.equal(escapeHTML(undefined), "");
});

// output goes into ~106 places INSIDE an attribute (title="${escapeHTML(p.text)}",
// href="${escapeHTML(w.wikiUrl)}"): previous textContent->innerHTML implementation left quotes untouched,
// so a trade preset saved as " onmouseover=... closed the attribute and became a live handler
test("escapeHTML escapa las comillas: la salida va dentro de atributos", () => {
  assert.equal(escapeHTML(`" onmouseover="alert(1)`), "&quot; onmouseover=&quot;alert(1)");
  assert.equal(escapeHTML(`' onerror='alert(1)`), "&#39; onerror=&#39;alert(1)");
  assert.ok(!escapeHTML(`x" onload="y`).includes('"'), "no puede quedar ninguna comilla cruda");
});

test("escapeHTML no depende del DOM (vive en utils/, lo usan capas que no pintan)", async () => {
  const { escapeHTML: puro } = await import("../deploy/js/utils/escape_html.js");
  assert.equal(puro(PAYLOAD), "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  // & is escaped first: otherwise &lt; would become &amp;lt; when evaluated twice
  assert.equal(puro("a & b < c"), "a &amp; b &lt; c");
});

// 0 and false rendered empty in previous version (if (!str) return ""): preserving this avoids stray zeros
// in counters that currently display nothing
test("escapeHTML conserva el comportamiento con valores falsy", () => {
  assert.equal(escapeHTML(0), "");
  assert.equal(escapeHTML(false), "");
  assert.equal(escapeHTML(""), "");
});

// showToast has ~43 fan-in: most used sink in the app, with callers passing item names from OCR or API
// (${relicName}, ${partName})
test("showToast escapa el mensaje por defecto (texto plano)", () => {
  container.children.length = 0;
  showToast(PAYLOAD);
  const toast = container.children.at(-1);
  assert.ok(toast, "el toast debería haberse añadido al contenedor");
  assert.ok(
    !toast.innerHTML.includes("<img src=x"),
    `el payload no debe llegar crudo al DOM: ${toast.innerHTML}`,
  );
  assert.ok(toast.innerHTML.includes("&lt;img"), "el payload debería quedar escapado");
});

test("showToast respeta html:true (alarmas que montan <b>/<br> y ya escapan sus datos)", () => {
  container.children.length = 0;
  showToast("<b>Alarma</b><br>Lith A1", { html: true });
  const toast = container.children.at(-1);
  assert.ok(toast.innerHTML.includes("<b>Alarma</b>"), "html:true debe preservar el markup");
});

// static guardrail: the three alerts building markup must declare html:true, or default escaping silently
// breaks formatting
test("los showToast con markup declaran html:true", async () => {
  const { readFileSync } = await import("node:fs");
  const files = [
    "deploy/js/ui.components/farms/ui_fissures.js",
    "deploy/js/ui.components/farms/ui_bounties.js",
  ];
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    // each showToast call interpolating markup must set html:true in options
    for (const m of src.matchAll(/showToast\(`[^`]*<(?:b|br|span|div|strong)[^`]*`\s*,\s*\{([^}]*)\}/g)) {
      assert.match(m[1], /html:\s*true/, `${f}: showToast con markup sin html:true → se escaparía`);
    }
  }
});
