import { test, mock } from "node:test";
import assert from "node:assert/strict";

mock.timers.enable({ apis: ["setTimeout"] });

class FakeElement {
  constructor(tag = "div") {
    this.tagName = tag.toUpperCase();
    this.className = "";
    this.classList = {
      _classes: new Set(),
      add(c) {
        this._classes.add(c);
      },
      remove(c) {
        this._classes.delete(c);
      },
      contains(c) {
        return this._classes.has(c);
      },
    };
    this.children = [];
    this.parentElement = null;
    this._innerHTML = "";
    this.textContent = "";
    this.onclick = null;
  }
  get innerHTML() {
    return this._innerHTML;
  }
  set innerHTML(val) {
    this._innerHTML = String(val);
  }
  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }
  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
    }
    child.parentElement = null;
    return child;
  }
  remove() {
    if (this.parentElement) {
      this.parentElement.removeChild(this);
    }
  }
  querySelector(sel) {
    if (sel === ".toast-close") {
      if (!this._closeBtn) {
        this._closeBtn = new FakeElement("span");
        this._closeBtn.className = "toast-close";
      }
      return this._closeBtn;
    }
    if (sel === ".toast-action") {
      return this.children.find((c) => c.className === "toast-action") || null;
    }
    return null;
  }
}

const container = new FakeElement("div");
container.id = "toast-container";

globalThis.document = {
  getElementById: (id) => (id === "toast-container" ? container : null),
  createElement: (tag) => new FakeElement(tag),
};

const { showToast } = await import("../deploy/js/ui.components/ui_components.js");
const { escapeHTML } = await import("../deploy/js/utils/escape_html.js");

function resetContainer() {
  while (container.children.length > 0) {
    container.removeChild(container.children[0]);
  }
}

test("doble clic sobre el botón de acción ejecuta el callback una sola vez", () => {
  resetContainer();
  let ejecuciones = 0;
  const toast = showToast("Cambio guardado", {
    action: {
      label: "Deshacer",
      onClick: () => {
        ejecuciones++;
      },
    },
  });

  const btn = toast.querySelector(".toast-action");
  assert.ok(btn);

  const fakeEvt = { stopPropagation: () => {} };
  btn.onclick(fakeEvt);
  btn.onclick(fakeEvt);

  assert.equal(ejecuciones, 1);
});

test("duración de visibilidad es de 6000ms sin acción y de 8000ms con acción", () => {
  resetContainer();

  const toastSinAccion = showToast("Mensaje normal informativo");
  mock.timers.tick(5999);
  assert.equal(toastSinAccion.classList.contains("fade-out"), false);
  mock.timers.tick(1);
  assert.equal(toastSinAccion.classList.contains("fade-out"), true);
  mock.timers.tick(400);
  assert.equal(container.children.includes(toastSinAccion), false);

  const toastConAccion = showToast("Acción pendiente", {
    action: { label: "Reintentar" },
  });
  mock.timers.tick(7999);
  assert.equal(toastConAccion.classList.contains("fade-out"), false);
  mock.timers.tick(1);
  assert.equal(toastConAccion.classList.contains("fade-out"), true);
  mock.timers.tick(400);
  assert.equal(container.children.includes(toastConAccion), false);
});

test("toast repetido con la misma etiqueta no deja el mapa corrupto cuando expira el primero", () => {
  resetContainer();

  const toast1 = showToast("Primero", { tag: "alerta-frecuente" });
  mock.timers.tick(3000);

  const toast2 = showToast("Segundo", { tag: "alerta-frecuente" });
  assert.equal(container.children.includes(toast1), false);
  assert.equal(container.children.includes(toast2), true);

  mock.timers.tick(3400);

  const toast3 = showToast("Tercero", { tag: "alerta-frecuente" });
  assert.equal(container.children.includes(toast2), false);
  assert.equal(container.children.includes(toast3), true);
});

test("botón de acción sin función de callback definida no produce excepciones al pulsarse", () => {
  resetContainer();
  const toast = showToast("Aviso sin acción ejecutable", {
    action: { text: "Entendido" },
  });

  const btn = toast.querySelector(".toast-action");
  assert.ok(btn);

  assert.doesNotThrow(() => {
    btn.onclick({ stopPropagation: () => {} });
  });
});

test("mensaje con caracteres HTML se inserta escapado como texto plano y no como HTML sin sanitizar", () => {
  resetContainer();
  const payload = "<script>alert('xss')</script><b onmouseover='boom()'>peligro</b>";
  const toast = showToast(payload);

  assert.ok(toast.innerHTML.includes(escapeHTML(payload)));
  assert.equal(toast.innerHTML.includes("<script>"), false);
  assert.equal(toast.innerHTML.includes("<b onmouseover="), false);
});
