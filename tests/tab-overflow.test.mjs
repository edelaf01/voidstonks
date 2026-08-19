import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const MODULE = fileURLToPath(new URL("../deploy/js/ui.components/ui_tab_fan.js", import.meta.url));
const INDEX = fileURLToPath(new URL("../deploy/index.html", import.meta.url));
const STYLES = fileURLToPath(new URL("../deploy/styles.css", import.meta.url));

class FakeClassList {
  constructor(initial = "") {
    this.set = new Set(initial.split(/\s+/).filter(Boolean));
  }
  add(c) { this.set.add(c); }
  remove(c) { this.set.delete(c); }
  contains(c) { return this.set.has(c); }
  toggle(c, force) {
    const on = force === undefined ? !this.set.has(c) : force;
    if (on) this.set.add(c); else this.set.delete(c);
    return on;
  }
}

class FakeEl {
  constructor(id, cls) {
    this.id = id;
    this.classList = new FakeClassList(cls);
    this.style = {};
  }
}

// formula is replicated because importing ui_tab_fan.js triggers ResizeObserver on load
function layout({ tabs, barWidth, isMobile = false, activeIndex = 0, MIN = 104, MOBILE_MAX = 4 }) {
  const all = Array.from({ length: tabs }, (_, i) => new FakeEl(`btn-t${i}`, i === activeIndex ? "tab-btn active" : "tab-btn"));

  let visibleCount;
  if (isMobile) {
    visibleCount = MOBILE_MAX;
  } else {
    const fitsAll = Math.floor(barWidth / MIN) >= all.length;
    const usable = fitsAll ? barWidth : barWidth - MIN;
    visibleCount = Math.max(1, Math.min(all.length, Math.floor(usable / MIN)));
  }

  const order = all.map((_, i) => i);
  if (activeIndex >= visibleCount) {
    order[visibleCount - 1] = activeIndex;
    order[activeIndex] = visibleCount - 1;
  }

  order.forEach((tabIndex, slot) => {
    all[tabIndex].classList.toggle("is-overflow", slot >= visibleCount);
    all[tabIndex].style.order = String(slot);
  });

  return {
    visible: all.filter((b) => !b.classList.contains("is-overflow")).map((b) => b.id),
    overflow: all.filter((b) => b.classList.contains("is-overflow")).map((b) => b.id),
    needsMore: all.length - visibleCount > 0,
  };
}

test("con sitio de sobra no se esconde nada y el botón Más no aparece", () => {
  const r = layout({ tabs: 8, barWidth: 1400 });
  assert.equal(r.overflow.length, 0);
  assert.equal(r.needsMore, false, "un 'Más' que abre un menú vacío ocupa hueco para nada");
});

test("cuando no caben todas, las sobrantes van al abanico", () => {
  const r = layout({ tabs: 8, barWidth: 700 });
  assert.ok(r.overflow.length > 0);
  assert.equal(r.visible.length + r.overflow.length, 8, "ninguna pestaña se pierde");
  assert.equal(r.needsMore, true);
});

test("el hueco del botón Más solo se descuenta si de verdad sobra alguna", () => {
  const justFits = layout({ tabs: 8, barWidth: 840 });
  assert.equal(justFits.overflow.length, 0);
  assert.equal(justFits.visible.length, 8);
});

test("la pestaña activa nunca queda escondida", () => {
  const r = layout({ tabs: 8, barWidth: 600, activeIndex: 7 });
  assert.ok(r.visible.includes("btn-t7"), "la activa debe seguir visible");
  assert.equal(r.visible.length + r.overflow.length, 8);
});

test("el rescate de la activa intercambia, no duplica ni pierde pestañas", () => {
  const r = layout({ tabs: 8, barWidth: 600, activeIndex: 6 });
  const todas = [...r.visible, ...r.overflow].sort();
  assert.equal(new Set(todas).size, 8, "sin duplicados");
  assert.equal(todas.length, 8, "sin pérdidas");
});

test("en móvil el corte es fijo a 4, independiente del ancho", () => {
  for (const w of [320, 390, 768]) {
    const r = layout({ tabs: 8, barWidth: w, isMobile: true });
    assert.equal(r.visible.length, 4, `ancho ${w}: la rejilla móvil es de 4 + Más`);
  }
});

test("una barra estrechísima deja al menos una pestaña", () => {
  const r = layout({ tabs: 8, barWidth: 120 });
  assert.ok(r.visible.length >= 1, "quedarse sin ninguna pestaña visible deja la app sin navegación");
});

test("añadir una pestaña no exige tocar ninguna lista: se acomoda sola", () => {
  const ocho = layout({ tabs: 8, barWidth: 700 });
  const nueve = layout({ tabs: 9, barWidth: 700 });
  assert.equal(nueve.visible.length, ocho.visible.length, "las visibles las fija el ancho, no el total");
  assert.equal(nueve.overflow.length, ocho.overflow.length + 1, "la nueva cae al abanico sola");
});

test("styles.css ya no esconde pestañas por id", () => {
  const css = readFileSync(STYLES, "utf8");
  const hardcoded = /\.tabs\s+#btn-[\w-]+\s*,[\s\S]{0,200}?display:\s*none/.test(css);
  assert.equal(hardcoded, false, "esconder pestañas por id vuelve a exigir mantener dos listas sincronizadas");
});

test("ui_tab_fan.js no reintroduce una lista fija de pestañas primarias", () => {
  const src = readFileSync(MODULE, "utf8");
  assert.equal(/const\s+PRIMARY_TABS\s*=/.test(src), false, "el reparto debe salir de medir, no de una lista");
  assert.ok(/is-overflow/.test(src), "reflowTabs marca el desbordamiento con .is-overflow");
});

test("la fórmula del test sigue a la del módulo", () => {
  const src = readFileSync(MODULE, "utf8");
  const min = Number(src.match(/const\s+MIN_TAB_PX\s*=\s*(\d+)/)?.[1]);
  const mobileMax = Number(src.match(/const\s+MOBILE_MAX_TABS\s*=\s*(\d+)/)?.[1]);
  assert.equal(min, 104, "MIN_TAB_PX cambió: revisa los anchos de este test");
  assert.equal(mobileMax, 4, "MOBILE_MAX_TABS cambió: revisa el test de móvil");
});

test("el botón Más sigue existiendo en el HTML con su abanico", () => {
  const html = readFileSync(INDEX, "utf8");
  assert.ok(html.includes('id="btn-tab-more"'), "sin el botón, las pestañas escondidas quedan inalcanzables");
  assert.ok(html.includes('id="tab-fan"'));
});
