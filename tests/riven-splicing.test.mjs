import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const { state } = await import("../deploy/js/state.js");
const { RivenOCRService } = await import("../deploy/js/services/rivens/riven_ocr.service.js");
const { getRivenStatRange } = await import("../deploy/js/utils/rivens/riven_logic.js");
const { canBeNegative, RIVEN_SPLICED_BASE_STATS, RIVEN_STATS } = await import("../deploy/js/config.js");

state.allRivenNames = ["Braton", "Skana", "Hek"];
state.weaponMap = {
  Braton: { t: "Rifle", d: 1.0 },
  Skana: { t: "Melee", d: 1.0 },
  Hek: { t: "Shotgun", d: 1.0 },
};

test("una carta con Weak Point Critical Chance y Gas se lee entera y es válida", () => {
  const card = `Braton Exitifel
+306.3% Weak Point Critical Chance
+111.4% Gas
-29.8% Zoom
MR 10`;
  const res = RivenOCRService.parseRivenCard(card);
  const pos = res.stats.filter(s => s.isPositive).map(s => s.name);
  const neg = res.stats.filter(s => !s.isPositive).map(s => s.name);
  assert.deepEqual(pos, ["Weak Point Critical Chance", "Gas"]);
  assert.deepEqual(neg, ["Zoom"]);
  assert.equal(res.validation.valid, true);
});

test("las facciones nuevas se leen como multiplicador", () => {
  let card = `Braton Critatis\n+120.5% Critical Damage\n+88.2% Multishot\nx1.56 Damage to Techrot`;
  let res = RivenOCRService.parseRivenCard(card);
  let stat = res.stats.find(s => s.name === "Damage to Techrot");
  assert.equal(stat.value, 56);
  assert.equal(stat.isPositive, true);

  card = `Braton Critatis\n+120.5% Critical Damage\n+88.2% Multishot\nx1.56 Damage to Orokin`;
  res = RivenOCRService.parseRivenCard(card);
  stat = res.stats.find(s => s.name === "Damage to Orokin");
  assert.equal(stat.value, 56);
  assert.equal(stat.isPositive, true);

  card = `Braton Critatis\n+120.5% Critical Damage\n+88.2% Multishot\nx1.56 Damage to Scaldra`;
  res = RivenOCRService.parseRivenCard(card);
  stat = res.stats.find(s => s.name === "Damage to Scaldra");
  assert.equal(stat.value, 56);
  assert.equal(stat.isPositive, true);
});

test("el texto de la carta de la recarga al enfundar casa con su stat", () => {
  const card = `Braton Algo\n+90.0% Magazine Reloaded/s when Holstered\n+10.0% Zoom\n+20.0% Multishot`;
  const res = RivenOCRService.parseRivenCard(card);
  const stat = res.stats.find(s => s.name === "Magazine Reload when Holstered");
  assert.ok(stat);
});

test("el texto de la carta del daño de ataque pesado no cae en Damage", () => {
  const card = `Skana Lacinus\n+120.0% Melee Damage on Heavy Attack\n+90.0% Critical Chance`;
  const res = RivenOCRService.parseRivenCard(card);
  const pos = res.stats.filter(s => s.isPositive).map(s => s.name);
  assert.ok(pos.includes("Heavy Attack Damage"));
  assert.ok(!pos.includes("Damage"));
});

test("un stat fusionado leído con menos sale positivo", () => {
  const card = `Braton Algo\n-111.4% Corrosive\n+90.0% Critical Chance`;
  const res = RivenOCRService.parseRivenCard(card);
  const stat = res.stats.find(s => s.name === "Corrosive");
  assert.equal(stat.isPositive, true);
});

test("solo se recupera el punto decimal cuando el número no lo trae", () => {
  const card1 = `Braton Algo\n+522.1% Weak Point Critical Chance\n+10.0% Zoom\n+20.0% Multishot`;
  const res1 = RivenOCRService.parseRivenCard(card1);
  const stat1 = res1.stats.find(s => s.name === "Weak Point Critical Chance");
  assert.equal(stat1.value, 522.1);

  const card2 = `Braton Algo\n+822% Critical Damage\n+10.0% Zoom\n+20.0% Multishot`;
  const res2 = RivenOCRService.parseRivenCard(card2);
  const stat2 = res2.stats.find(s => s.name === "Crit Damage");
  assert.equal(stat2.value, 82.2);
});

test("Weak Point Damage en un arma cuerpo a cuerpo es ilegal", () => {
  const card = `Skana Algo\n+120.0% Weak Point Damage\n+90.0% Critical Chance\n+60.0% Status Chance`;
  const res = RivenOCRService.parseRivenCard(card);
  assert.ok(res.stats.some(s => s.name === "Weak Point Damage"));
  assert.ok(res.validation.issues.some(i => i.includes("Weak Point Damage") && i.includes("illegal")));
});

test("ningún stat fusionado puede ser negativo", () => {
  for (const key of Object.keys(RIVEN_SPLICED_BASE_STATS)) {
    assert.equal(canBeNegative(key), false);
  }
  assert.equal(canBeNegative("Gas Damage"), false);
  assert.equal(canBeNegative("Critical Chance"), true);
  assert.equal(canBeNegative("Zoom"), true);
  assert.equal(canBeNegative("Status Chance"), true);
});

test("el rango del Gas sale de su valor base", () => {
  const range = getRivenStatRange({ t: "Rifle", d: 1 }, "Gas", false, 2, true);
  assert.equal(range.mid, 111.4);
});

test("los 18 stats fusionados tienen valor base", () => {
  const spliced = RIVEN_STATS.filter(s => s.spliced);
  assert.equal(spliced.length, 18);
  for (const s of spliced) {
    assert.ok(RIVEN_SPLICED_BASE_STATS[s.name_en] !== undefined);
  }
});
