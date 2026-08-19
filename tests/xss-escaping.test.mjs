// Comprueba que los sumideros de innerHTML escapan los datos que no controla el código
// (nombres de la API de warframe.market, del worldstate y del OCR).
//
// Contexto: el OCR y la API resuelven contra catálogos cerrados, así que hoy no hay
// inyección explotable; esto es defensa en profundidad. Si mañana un catálogo cambia de
// origen, el escape ya está puesto y estos tests lo mantienen.
import { test } from "node:test";
import assert from "node:assert/strict";

// --- DOM mínimo: solo lo que tocan showToast/escapeHTML ---
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
      // Igual que el navegador: textContent escapa al leerse como innerHTML.
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
    // showToast engancha .toast-close / .toast-action tras pintar el innerHTML.
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

// La salida entra en ~106 sitios DENTRO de un atributo (`title="${escapeHTML(p.text)}"`,
// `href="${escapeHTML(w.wikiUrl)}"`). La implementación vieja usaba textContent->innerHTML, que
// es lo que hace el navegador con el texto de un nodo: no toca las comillas. Un preset de trade
// guardado como `" onmouseover=...` cerraba el atributo y se convertía en un handler real.
test("escapeHTML escapa las comillas: la salida va dentro de atributos", () => {
  assert.equal(escapeHTML(`" onmouseover="alert(1)`), "&quot; onmouseover=&quot;alert(1)");
  assert.equal(escapeHTML(`' onerror='alert(1)`), "&#39; onerror=&#39;alert(1)");
  assert.ok(!escapeHTML(`x" onload="y`).includes('"'), "no puede quedar ninguna comilla cruda");
});

test("escapeHTML no depende del DOM (vive en utils/, lo usan capas que no pintan)", async () => {
  const { escapeHTML: puro } = await import("../deploy/js/utils/escape_html.js");
  assert.equal(puro(PAYLOAD), "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  // El & se escapa primero: si no, `&lt;` acabaría como `&amp;lt;` al pasar dos veces.
  assert.equal(puro("a & b < c"), "a &amp; b &lt; c");
});

// 0 y false renderizaban vacío con la versión vieja (`if (!str) return ""`). Mantenerlo evita
// que aparezcan ceros en contadores que hoy no muestran nada.
test("escapeHTML conserva el comportamiento con valores falsy", () => {
  assert.equal(escapeHTML(0), "");
  assert.equal(escapeHTML(false), "");
  assert.equal(escapeHTML(""), "");
});

// showToast tiene fan-in ~43: es el sumidero más usado de la app y varios llamadores le
// pasan nombres de ítem venidos del OCR o de la API (p. ej. `${relicName}`, `${partName}`).
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

// Guardarraíl estático: los tres avisos que montan markup deben declarar html:true, o el
// escape por defecto les rompería el formato en silencio.
test("los showToast con markup declaran html:true", async () => {
  const { readFileSync } = await import("node:fs");
  const files = [
    "deploy/js/ui.components/farms/ui_fissures.js",
    "deploy/js/ui.components/farms/ui_bounties.js",
  ];
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    // Cada llamada a showToast que interpola markup debe tener html:true en sus options.
    for (const m of src.matchAll(/showToast\(`[^`]*<(?:b|br|span|div|strong)[^`]*`\s*,\s*\{([^}]*)\}/g)) {
      assert.match(m[1], /html:\s*true/, `${f}: showToast con markup sin html:true → se escaparía`);
    }
  }
});
