// Tipos de daño: etiqueta, color e icono.
//
// La tabla estaba copiada tres veces dentro de ui_rivens.js antes de extraerse aquí, así que
// lo que hay que proteger es que siga siendo la ÚNICA: si alguien vuelve a escribir un color a
// mano en un componente, el mismo elemento sale de dos colores según la pestaña.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { damageMeta, damageIconHtml } from "../deploy/js/utils/damage_types.js";

test("cada tipo tiene etiqueta en los dos idiomas y el mismo color", () => {
  const tipos = [
    "impact", "puncture", "slash", "heat", "cold", "electricity", "toxin",
    "blast", "corrosive", "gas", "magnetic", "radiation", "viral", "void", "true",
  ];
  for (const t of tipos) {
    const es = damageMeta(t, "es");
    const en = damageMeta(t, "en");
    assert.ok(es.label && en.label, `${t} necesita etiqueta en los dos idiomas`);
    assert.equal(es.color, en.color, `${t}: el color no depende del idioma`);
    assert.match(es.color, /^#[0-9a-f]{6}$/i, `${t}: color en hex`);
  }
});

// La API puede estrenar un elemento antes que esta tabla. Devolver undefined pintaría
// "undefined" en la tarjeta; el fallback deja algo legible y gris.
test("un tipo desconocido cae en su nombre capitalizado y gris", () => {
  assert.deepEqual(damageMeta("plasma"), { label: "Plasma", color: "#aaa" });
  assert.deepEqual(damageMeta(""), { label: "", color: "#aaa" });
  assert.deepEqual(damageMeta(null), { label: "", color: "#aaa" });
  assert.deepEqual(damageMeta(undefined), { label: "", color: "#aaa" });
});

test("el tipo se normaliza: mayúsculas y espacios sobrantes no fallan", () => {
  assert.equal(damageMeta("  HEAT ", "es").label, "Calor");
  assert.equal(damageMeta("Toxin", "en").label, "Toxin");
});

test("sin idioma explícito responde en inglés", () => {
  assert.equal(damageMeta("cold").label, "Cold");
});

// El tipo acaba dentro de src y de alt. Escapar no bastaría: se acota a letras para que no
// pueda salirse del atributo ni de la ruta.
test("el icono no puede romper el atributo por mucha basura que lleve el tipo", () => {
  // El único manejador que debe salir es el onerror que oculta el icono cuando el archivo no
  // existe. Cualquier otro `on...=` significa que el tipo se salió de su atributo.
  const handlers = (html) => [...html.matchAll(/\son[a-z]+\s*=/gi)].map((m) => m[0].trim());

  for (const sucio of [
    'heat" onload="alert(1)',
    'x"><script>alert(1)</script>',
    "../../etc/passwd",
    "he at",
    "heat-2",
    "'; DROP TABLE",
  ]) {
    const out = damageIconHtml(sucio);
    assert.deepEqual(handlers(out), ["onerror="], `manejador de más con ${sucio}: ${out}`);
    assert.match(out, /^<img src="assets\/dmg\/Dmg[A-Za-z]*Small64\.webp" alt="[A-Za-z]*"/,
      `src/alt deben quedar en solo letras con ${sucio}`);
    assert.ok(!out.includes("<script"), `se coló script con ${sucio}`);
    assert.ok(!out.includes("/.."), `se coló recorrido de rutas con ${sucio}`);
  }
});

test("el tamaño se aplica a ancho y alto", () => {
  assert.match(damageIconHtml("heat", 20), /width:20px; height:20px/);
  assert.match(damageIconHtml("heat"), /width:14px; height:14px/, "por defecto 14");
});

// Este es el que impide volver al problema original: la tabla vivía copiada en el componente.
test("ningún componente vuelve a escribir la tabla de colores a mano", () => {
  const sospechosos = [
    "deploy/js/ui.components/rivens/ui_rivens.js",
    "deploy/js/ui.components/market/ui_lich_weapons.js",
  ];
  for (const f of sospechosos) {
    const src = readFileSync(f, "utf8");
    // Un objeto que mapee un elemento a un color hex es la señal de la tabla duplicada.
    const copia = /\b(impact|puncture|slash|corrosive|radiation)\s*:\s*\{[^}]*#[0-9a-f]{6}/i.test(src);
    assert.ok(!copia, `${f} parece traer su propia tabla de daños: usa damageMeta()`);
  }
});
