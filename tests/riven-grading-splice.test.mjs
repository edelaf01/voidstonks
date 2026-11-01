import test from "node:test";
import assert from "node:assert/strict";

const elements = new Map();
function makeElement(id = "") {
  return {
    id,
    dataset: {},
    style: {},
    innerHTML: "",
    classList: { add() {}, remove() {}, toggle() {} },
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {},
    getAttribute: () => null,
    setAttribute() {},
    removeAttribute() {},
  };
}

globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.document = {
  getElementById: (id) => {
    if (!elements.has(id)) elements.set(id, makeElement(id));
    return elements.get(id);
  },
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => makeElement(),
  addEventListener() {},
  body: { appendChild() {} },
};
globalThis.window = globalThis;
globalThis.fetch = async () => ({ ok: false, json: async () => ({}) });

const { gradeWeaponStats } = await import("../deploy/js/utils/rivens/riven_logic.js");
const { pesoFusionado } = await import("../deploy/js/utils/rivens/riven_cycling.js");
const { RIVEN_SPLICED_BASE_STATS } = await import("../deploy/js/config.js");
const { state } = await import("../deploy/js/state.js");
const { renderMetaStats } = await import("../deploy/js/ui.components/rivens/ui_riven_meta_stats.js");

test("sin typeIdx el resultado no cambia respecto al original", () => {
  const table = {
    "Critical Chance": 1,
    "Multishot": 0.9,
    "Toxin Damage": 0.6,
    "Cold Damage": 0.5,
    "Viral": 0.01,
  };
  const g = gradeWeaponStats({ dynamic_weights: table });
  assert.ok(g);
  assert.ok(g.meh.includes("Viral"));
  assert.ok(!g.best.includes("Viral"));
  assert.ok(!g.mid.includes("Viral"));
  assert.equal(g.pesos["Viral"], 0.01);
  assert.equal("Weak Point Critical Chance" in g.pesos, false);
});

test("con typeIdx 0 ubica Viral en mid y Weak Point Critical Chance en best", () => {
  const table = {
    "Critical Chance": 1,
    "Multishot": 0.9,
    "Toxin Damage": 0.6,
    "Cold Damage": 0.5,
    "Viral": 0.01,
  };
  const g = gradeWeaponStats({ dynamic_weights: table }, null, 0);
  assert.ok(g);
  assert.ok(g.mid.includes("Viral"));
  assert.equal(g.pesos["Viral"], pesoFusionado("Viral", table, 0));
  assert.equal(g.pesos["Viral"], 0.55);
  assert.ok(g.best.includes("Weak Point Critical Chance"));
  assert.equal(g.pesos["Weak Point Critical Chance"], 0.95);
  const totalViral = [...g.best, ...g.mid, ...g.meh].filter(s => s === "Viral").length;
  assert.equal(totalViral, 1);
});

test("con typeIdx 0 solo aparecen fusionados con base mayor a cero y excluye los de melee", () => {
  const table = {
    "Critical Chance": 1,
    "Multishot": 0.9,
    "Toxin Damage": 0.6,
    "Cold Damage": 0.5,
    "Viral": 0.01,
    "Heavy Attack Damage": 0.01,
  };
  const g = gradeWeaponStats({ dynamic_weights: table }, null, 0);
  assert.ok(g);
  const allGraded = [...g.best, ...g.mid, ...g.meh];
  const splicedPresent = allGraded.filter(k => k in RIVEN_SPLICED_BASE_STATS);
  for (const k of splicedPresent) {
    assert.equal(g.pesos[k], pesoFusionado(k, table, 0));
    assert.ok(RIVEN_SPLICED_BASE_STATS[k][0] > 0);
  }
  const meleeOnly = ["Heavy Attack Damage", "Heavy Attack Wind Up Speed", "Parry Angle", "Slam Attack Damage"];
  for (const m of meleeOnly) {
    assert.ok(!allGraded.includes(m));
    assert.ok(!(m in g.pesos));
  }
});

test("con typeIdx 3 para melee no aparecen fusionados de distancia y calcula Parry Angle", () => {
  const table = {
    "Fire Rate / Attack Speed": 0.8,
    "Range": 0.6,
    "Critical Chance": 0.9,
    "Base Damage / Melee Damage": 0.7,
    "Weak Point Damage": 0.01,
    "Heavy Attack Efficiency": 0.2,
    "Combo Duration": 0.2,
  };
  const g = gradeWeaponStats({ dynamic_weights: table }, null, 3);
  assert.ok(g);
  const allGraded = [...g.best, ...g.mid, ...g.meh];
  const excluded = [
    "Weak Point Damage",
    "Weak Point Critical Chance",
    "Ammo Efficiency",
    "Magazine Reload when Holstered",
  ];
  for (const ex of excluded) {
    assert.ok(!allGraded.includes(ex));
    assert.ok(!(ex in g.pesos));
  }
  const expectedParry = pesoFusionado("Parry Angle", table, 3);
  assert.equal(g.pesos["Parry Angle"], expectedParry);
});

test("la ruta de prior con typeIdx calcula fusionados desde el prior en pesos degenerados", () => {
  const saturada = {
    name: "SaturadaSintetica",
    liquidity_score: 40,
    dynamic_weights: Object.fromEntries([
      ...["Critical Damage", "Critical Chance", "Multishot", "Status Duration",
        "Fire Rate / Attack Speed", "Electric Damage", "Zoom", "Recoil"].map(s => [s, 1]),
      ...["Cold Damage", "Toxin Damage", "Heat Damage", "Ammo Maximum", "Magazine Capacity",
        "Reload Speed", "Punch Through", "Status Chance", "Impact Damage", "Puncture Damage",
        "Slash Damage", "Projectile Speed", "Damage Vs Grineer", "Damage Vs Corpus",
        "Damage Vs Infested", "Base Damage / Melee Damage", "Range", "Initial Combo",
        "Combo Duration", "Heavy Attack Efficiency", "Finisher Damage", "Heavy Attack Damage",
      ].map((s, i) => [s, 0.4 - i * 0.01]),
    ]),
  };
  const prior = {
    "Critical Chance": 1.0,
    "Multishot": 0.9,
    "Toxin Damage": 0.6,
    "Cold Damage": 0.5,
    "Zoom": 0.02,
    "Recoil": 0.01,
  };
  const g = gradeWeaponStats(saturada, prior, 0);
  assert.ok(g);
  assert.equal(g.fuente, "prior");
  assert.equal(g.pesos["Weak Point Critical Chance"], pesoFusionado("Weak Point Critical Chance", prior, 0));
  assert.equal(g.pesos["Viral"], pesoFusionado("Viral", prior, 0));
});

test("renderMetaStats posiciona correctamente los atributos fusionados en la guia", () => {
  state.currentLang = "en";
  state.rivenStatWeights = null;
  state.rivenStatPrior = null;
  state.rivenIndexData = {
    Synthrifle: {
      name: "Synthrifle",
      t: "Rifle",
      official_median: 100,
      liquidity_score: 10,
      pos: ["Critical Chance", "Multishot"],
      midPos: ["Toxin Damage", "Cold Damage"],
      neg: ["Zoom"],
      pos_tier: {
        top: ["Critical Chance", "Multishot"],
        mid: ["Toxin Damage", "Cold Damage"],
        trash: ["Viral", "Weak Point Damage", "Recoil", "Ammo Maximum"],
      },
      neg_tier: {
        buff: ["Zoom"],
        curse: ["Critical Chance", "Multishot"],
      },
      dynamic_weights: {
        "Critical Chance": 1,
        "Multishot": 0.9,
        "Toxin Damage": 0.6,
        "Cold Damage": 0.5,
        "Viral": 0.01,
        "Heat Damage": 0.35,
        "Electric Damage": 0.35,
        "Impact Damage": 0.2,
        "Puncture Damage": 0.2,
        "Slash Damage": 0.2,
        "Ammo Maximum": 0.1,
        "Magazine Capacity": 0.1,
        "Reload Speed": 0.1,
        "Zoom": 0.05,
        "Recoil": 0.05,
      },
    },
    Synthblade: {
      name: "Synthblade",
      t: "Melee",
      official_median: 100,
      liquidity_score: 10,
      pos: ["Fire Rate / Attack Speed", "Range"],
      midPos: [],
      neg: ["Finisher Damage"],
      pos_tier: {
        top: ["Fire Rate / Attack Speed", "Range"],
        mid: [],
        trash: ["Weak Point Damage", "Heavy Attack Efficiency"],
      },
      neg_tier: {
        buff: ["Finisher Damage"],
        curse: ["Fire Rate / Attack Speed"],
      },
      dynamic_weights: {
        "Fire Rate / Attack Speed": 0.8,
        "Range": 0.6,
        "Critical Chance": 0.35,
        "Critical Damage": 0.35,
        "Base Damage / Melee Damage": 0.3,
        "Status Chance": 0.2,
        "Initial Combo": 0.1,
        "Combo Duration": 0.1,
        "Heavy Attack Efficiency": 0.1,
        "Finisher Damage": 0.1,
        "Toxin Damage": 0.1,
        "Cold Damage": 0.1,
      },
    },
  };

  renderMetaStats("Synthrifle", "Rifle");
  const rifleHtml = document.getElementById("meta-stats-container").innerHTML;
  const [positivesPart] = rifleHtml.split("<!-- Negatives Section -->");
  assert.ok(positivesPart.includes("Weak Point Critical Chance"));
  assert.ok(positivesPart.includes("Viral"));
  const viralMatches = (positivesPart.match(/Viral/g) || []).length;
  assert.equal(viralMatches, 1);
  for (const k of Object.keys(RIVEN_SPLICED_BASE_STATS)) {
    assert.ok(!rifleHtml.includes(`- ${k}`));
  }
  assert.ok(!rifleHtml.includes("- Weak Point"));

  renderMetaStats("Synthblade", "Melee", "other-container");
  const bladeHtml = document.getElementById("other-container").innerHTML;
  assert.ok(bladeHtml.includes("Parry Angle"));
  assert.ok(!bladeHtml.includes("Weak Point"));
});
