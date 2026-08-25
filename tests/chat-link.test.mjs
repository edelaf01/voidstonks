// Lo que copia el auto-copy tiene que enlazar en el chat del juego.
//
// El fallo es mudo del lado de la app: la línea se copia igual, se pega igual y es en el chat
// —ya en la ventana de trading, con el cliente delante— donde se ve que media línea salió en
// texto plano. Los nombres que maneja la app son los de las tablas de drop, y esos no enlazan.

import { test } from "node:test";
import assert from "node:assert/strict";
import { chatLink, chatLine } from "../deploy/js/utils/chat_link.js";

test("las piezas de componente pierden el «Blueprint» entero", () => {
  // "Zephyr Prime Systems Blueprint" es el nombre de la tabla de drop; lo que enlaza el juego
  // es la pieza construible.
  assert.equal(chatLink("Zephyr Prime Systems Blueprint"), "[Zephyr Prime Systems]");
  assert.equal(chatLink("Caliban Prime Chassis Blueprint"), "[Caliban Prime Chassis]");
  assert.equal(chatLink("Ash Prime Neuroptics Blueprint"), "[Ash Prime Neuroptics]");
  // Arcaicos y compañeros: Harness/Wings (Odonata), Carapace/Cerebrum (centinelas).
  assert.equal(chatLink("Odonata Prime Harness Blueprint"), "[Odonata Prime Harness]");
  assert.equal(chatLink("Helios Prime Cerebrum Blueprint"), "[Helios Prime Cerebrum]");
});

test("el plano del set deja «Blueprint» FUERA del corchete", () => {
  // Aquí no vale quitar el sufijo: [Hydroid Prime] es lo que enlaza, y la palabra tiene que
  // seguir estando para que se entienda qué se vende.
  assert.equal(chatLink("Hydroid Prime Blueprint"), "[Hydroid Prime] Blueprint");
  assert.equal(chatLink("Dual Zoren Prime Blueprint"), "[Dual Zoren Prime] Blueprint");
});

test("lo que ya enlaza no se toca", () => {
  assert.equal(chatLink("Bronco Prime Barrel"), "[Bronco Prime Barrel]");
  assert.equal(chatLink("Dual Zoren Prime Handle"), "[Dual Zoren Prime Handle]");
  assert.equal(chatLink("Vadarya Prime Stock"), "[Vadarya Prime Stock]");
  assert.equal(chatLink("Lith A8 Relic"), "[Lith A8 Relic]");
});

test("un nombre vacío no deja unos corchetes sueltos en la línea", () => {
  assert.equal(chatLink(""), "");
  assert.equal(chatLink(null), "");
});

test("la línea lleva el precio solo cuando se sabe", () => {
  assert.equal(chatLine("Zephyr Prime Systems Blueprint", 35), "[Zephyr Prime Systems] 35 :platinum:");
  assert.equal(chatLine("Hydroid Prime Blueprint", 20), "[Hydroid Prime] Blueprint 20 :platinum:");
  // Sin precio cargado se pega el link a secas en vez de un "0 :platinum:" que no es cierto.
  assert.equal(chatLine("Bronco Prime Barrel", 0), "[Bronco Prime Barrel]");
});
