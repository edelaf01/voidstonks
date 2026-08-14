// La ruta del icono de un arma.
//
// Nunca falla a la vista: si la ruta es mala, el <img> dispara su onerror y sale el SVG
// genérico. Así que un fallo aquí no es un error, es "todas las armas de esta familia salen
// sin foto" — y eso solo se nota mirando la pantalla arma por arma. De ahí que cada regla de
// construcción del slug esté fijada: son las que se han ido añadiendo por casos concretos.

import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const { state } = await import("../deploy/js/state.js");
const { getWeaponImagePath } = await import("../deploy/js/utils/rivens/weapon_image.js");

test("una Prime sale del catálogo de items, no de la convención de nombre", () => {
  state.itemsDatabase = { "Braton Prime": { icon: "icons/braton_prime.png" } };
  const ruta = getWeaponImagePath("Braton Prime", { localImage: "weapons/otra_cosa.png" });
  assert.ok(!ruta.includes("otra_cosa"), `${ruta} debería venir del catálogo`);
});

test("sin entrada en el catálogo se usa el localImage de la base de armas", () => {
  state.itemsDatabase = {};
  assert.equal(
    getWeaponImagePath("Kuva Bramma", { localImage: "weapons/kuva_bramma.png" }),
    "assets/relic_contents/kuva_bramma.webp",
    "weapons/ se reescribe a relic_contents/ y .png a .webp",
  );
});

test("un localImage que no cuelga de weapons/ se respeta tal cual", () => {
  state.itemsDatabase = {};
  assert.equal(
    getWeaponImagePath("Algo", { localImage: "custom/algo.png" }),
    "assets/custom/algo.webp",
  );
});

// Sin esto, "Vinquibus (Melee)" buscaba un fichero "vinquibus_melee.webp" que no existe: las
// variantes de modo comparten la imagen del arma base.
test("las variantes de modo reutilizan la imagen del arma base", () => {
  state.itemsDatabase = {};
  assert.equal(
    getWeaponImagePath("Vinquibus (Melee)", null),
    "assets/relic_contents/vinquibus.webp",
  );
});

// Los nombres con "&" (Twin Grakatas, Dual Toxocyst…) llevan doble guion bajo en el nombre de
// fichero, que es como están guardados los assets.
test("el ampersand se convierte en doble guion bajo, sin colapsarlo", () => {
  state.itemsDatabase = {};
  assert.equal(
    getWeaponImagePath("Sword & Shield", null),
    "assets/relic_contents/sword__shield.webp",
  );
});

test("fuera del caso del ampersand los separadores se colapsan en uno", () => {
  state.itemsDatabase = {};
  assert.equal(
    getWeaponImagePath("Ack & Brunt Prime Test", null).includes("__"),
    true,
    "el & sobrevive",
  );
  assert.equal(getWeaponImagePath("Dual - Cestra", null), "assets/relic_contents/dual_cestra.webp");
});

test("los signos raros del nombre no llegan al fichero", () => {
  state.itemsDatabase = {};
  assert.equal(
    getWeaponImagePath("Ceti Lacera's Edge!", null),
    "assets/relic_contents/ceti_laceras_edge.webp",
  );
});

// Devolver "" o null obligaría a cada sitio que la usa a poner su propia guarda, y hay ocho.
test("siempre devuelve una ruta, aunque no se sepa nada del arma", () => {
  state.itemsDatabase = {};
  const ruta = getWeaponImagePath("Arma Que No Existe", null);
  assert.equal(typeof ruta, "string");
  assert.ok(ruta.startsWith("assets/"), ruta);
});
