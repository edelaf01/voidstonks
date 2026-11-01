import test from "node:test";
import assert from "node:assert/strict";

const elements = new Map();
function makeElement(id = "") {
  return {
    id,
    value: "",
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

const { state } = await import("../deploy/js/state.js");
const { RIVEN_SPLICED_BASE_STATS } = await import("../deploy/js/config.js");
const { renderRivenIndexList, toggleRivenIndexDetails } = await import("../deploy/js/ui.components/rivens/ui_rivens.js");
const { renderMetaStats } = await import("../deploy/js/ui.components/rivens/ui_riven_meta_stats.js");

state.currentLang = "en";
state.rivenStatWeights = null;
state.rivenStatPrior = null;
state.rivenStatBaseline = null;
state.weaponMap = { Synthstaff: { t: "Melee" } };
state.allRivenNames = ["Synthstaff"];
state.rivenIndexData = {
  Synthstaff: {
    name: "Synthstaff",
    t: "Melee",
    official_median: 100,
    liquidity_score: 10,
    pos: ["Critical Chance", "Critical Damage", "Range"],
    midPos: ["Status Chance", "Toxin Damage"],
    neg: ["Channeling Efficiency", "Damage Vs Corpus"],
    negWorst: ["Viral", "Status Damage", "Combo Duration"],
    pos_tier: {
      top: ["Critical Chance", "Critical Damage", "Range"],
      mid: ["Status Chance", "Toxin Damage"],
      trash: ["Initial Combo", "Slash Damage", "Viral", "Status Damage", "Heavy Attack Efficiency"],
    },
    neg_tier: {
      buff: ["Heavy Attack Efficiency", "Critical Chance On Slide Attack"],
      curse: ["Status Chance", "Critical Damage", "Viral", "Status Damage", "Slash Damage"],
    },
    dynamic_weights: {
      "Critical Chance": 1,
      "Critical Damage": 1,
      "Range": 0.9,
      "Status Chance": 0.5,
      "Toxin Damage": 0.45,
      "Initial Combo": 0.05,
      "Slash Damage": 0.05,
      "Heavy Attack Efficiency": 0.03,
      "Critical Chance On Slide Attack": 0.02,
      "Damage Vs Corpus": 0.02,
      "Combo Duration": 0.02,
      "Finisher Damage": 0.01,
    },
  },
};

try {
  toggleRivenIndexDetails("Synthstaff");
} catch (_) {}

renderRivenIndexList([["Synthstaff", state.rivenIndexData.Synthstaff]]);
const indexHtml = document.getElementById("index-results-container").innerHTML;

function getSectionHtml(html, marker, nextMarker) {
  const start = html.indexOf(marker);
  if (start === -1) return "";
  const end = nextMarker ? html.indexOf(nextMarker, start) : html.length;
  return end === -1 ? html.slice(start) : html.slice(start, end);
}

function extractChips(secHtml) {
  return [...secHtml.matchAll(/[+-]\s+([^<]+?)\s*<\/span>/g)].map((m) => m[1].trim());
}

test("el índice expandido muestra cada nivel de atributos positivos y negativos", () => {
  const bestPos = extractChips(getSectionHtml(indexHtml, "<!-- Best Positives -->", "<!-- Mid Positives -->"));
  const midPos = extractChips(getSectionHtml(indexHtml, "<!-- Mid Positives -->", "<!-- Meh Positives -->"));
  const mehPos = extractChips(getSectionHtml(indexHtml, "<!-- Meh Positives -->", "<!-- Best Negatives -->"));
  const bestNeg = extractChips(getSectionHtml(indexHtml, "<!-- Best Negatives -->", "<!-- Mid Negatives -->"));
  const midNeg = extractChips(getSectionHtml(indexHtml, "<!-- Mid Negatives -->", "<!-- Worst Negatives -->"));
  const worstNeg = extractChips(getSectionHtml(indexHtml, "<!-- Worst Negatives -->", null));

  for (const s of ["Critical Chance", "Critical Damage", "Range"]) {
    assert.ok(bestPos.includes(s), `best positives debe incluir ${s}`);
  }
  assert.ok(midPos.includes("Status Chance"), "mid positives debe incluir Status Chance");
  for (const s of ["Initial Combo", "Slash Damage"]) {
    assert.ok(mehPos.includes(s), `meh positives debe incluir ${s}`);
  }
  for (const s of ["Damage Vs Corpus", "Heavy Attack Efficiency"]) {
    assert.ok(bestNeg.includes(s), `best negatives debe incluir ${s}`);
  }
  assert.ok(midNeg.includes("Status Chance"), "mid negatives debe incluir Status Chance");
  for (const s of ["Critical Damage", "Combo Duration"]) {
    assert.ok(worstNeg.includes(s), `worst negatives debe incluir ${s}`);
  }
});

test("los atributos positivos medios nunca aparecen en los peores negativos", () => {
  const worstNeg = extractChips(getSectionHtml(indexHtml, "<!-- Worst Negatives -->", null));
  for (const s of ["Status Chance", "Toxin Damage"]) {
    assert.ok(!worstNeg.includes(s), `worst negatives no debe incluir ${s}`);
  }
});

test("cada sección no contiene chips duplicados y Heavy Attack Efficiency aparece una vez", () => {
  const sections = [
    getSectionHtml(indexHtml, "<!-- Best Positives -->", "<!-- Mid Positives -->"),
    getSectionHtml(indexHtml, "<!-- Mid Positives -->", "<!-- Meh Positives -->"),
    getSectionHtml(indexHtml, "<!-- Meh Positives -->", "<!-- Best Negatives -->"),
    getSectionHtml(indexHtml, "<!-- Best Negatives -->", "<!-- Mid Negatives -->"),
    getSectionHtml(indexHtml, "<!-- Mid Negatives -->", "<!-- Worst Negatives -->"),
    getSectionHtml(indexHtml, "<!-- Worst Negatives -->", null),
  ];

  for (const sec of sections) {
    const chips = extractChips(sec);
    assert.equal(chips.length, new Set(chips).size);
  }

  const bestNeg = extractChips(getSectionHtml(indexHtml, "<!-- Best Negatives -->", "<!-- Mid Negatives -->"));
  const count = bestNeg.filter((s) => s === "Heavy Attack Efficiency").length;
  assert.equal(count, 1);
});

test("ningún atributo fusionado aparece en las secciones negativas", () => {
  const allNeg = [
    ...extractChips(getSectionHtml(indexHtml, "<!-- Best Negatives -->", "<!-- Mid Negatives -->")),
    ...extractChips(getSectionHtml(indexHtml, "<!-- Mid Negatives -->", "<!-- Worst Negatives -->")),
    ...extractChips(getSectionHtml(indexHtml, "<!-- Worst Negatives -->", null)),
  ];

  for (const k of Object.keys(RIVEN_SPLICED_BASE_STATS)) {
    assert.ok(!allNeg.includes(k), `stat fusionado ${k} no debe aparecer en negativas`);
  }
  assert.ok(!allNeg.includes("Viral"), "Viral no debe aparecer en negativas");
  assert.ok(!allNeg.includes("Status Damage"), "Status Damage no debe aparecer en negativas");
});

test("el panel de meta-stats desduplica Heavy Attack Efficiency en las mejores negativas", () => {
  renderMetaStats("Synthstaff", "Melee", "dedupe-container");
  const metaHtml = document.getElementById("dedupe-container").innerHTML;
  const negStart = metaHtml.indexOf("<!-- Negatives Section -->");
  assert.ok(negStart !== -1);
  const negSection = metaHtml.slice(negStart);
  const midOrWorst = negSection.search(/MID NEGATIVES|NEGATIVOS MEDIOS|WORST NEGATIVES|PEORES NEGATIVOS/);
  const bestNegPart = midOrWorst !== -1 ? negSection.slice(0, midOrWorst) : negSection;
  const metaChips = extractChips(bestNegPart);
  const count = metaChips.filter((s) => s === "Heavy Attack Efficiency").length;
  assert.equal(count, 1);
});
