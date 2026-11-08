import test from "node:test";
import assert from "node:assert/strict";
import { createMockElement, mockElementsById, requestedUrls, mock, createMockEstCard } from "./_helpers/riven-tasacion-dom.mjs";

const { state } = await import("../deploy/js/state.js");

const {
  parchearTasacion,
  generateRollResultsDOM,
} = await import("../deploy/js/ui.components/rivens/ui_riven_appraisal.js");

test("parchearTasacion no solicita subastas cuando conComparables es falso", async () => {
  const { estCard } = createMockEstCard();
  const weaponData = { name: "Braton", t: "Rifle", disposition: 1.0 };
  const meta = { name: "Braton", official_median: 200, wfm_avg: 400 };
  const stats = [
    { name: "Critical Chance", value: 120, isPositive: true, minIdeal: 50, maxIdeal: 150 },
    { name: "Critical Damage", value: 120, isPositive: true, minIdeal: 50, maxIdeal: 150 },
    { name: "Zoom", value: 30, isPositive: false, minIdeal: 20, maxIdeal: 60 },
  ];
  const appraisal = { adjustedScore: 70, estimatedValue: 300, suggestedMin: 150, suggestedMax: 600 };

  requestedUrls.length = 0;
  await parchearTasacion({
    estCard,
    appraisal,
    weaponName: "Braton",
    weaponData,
    meta,
    basePrice: 200,
    precioTipico: 200,
    itemAttributes: stats,
    isEs: true,
    conComparables: false,
  });

  assert.equal(requestedUrls.some((u) => u.includes("type=riven")), false);
});

test("parchearTasacion ajusta tasacion ante cinco subastas de comparables con ponderacion exacta", async () => {
  const weaponData = { name: "Soma", t: "Rifle", disposition: 1.0 };
  const meta = { name: "Soma", official_median: 300, wfm_avg: 500 };
  const stats = [
    { name: "Critical Chance", value: 120, isPositive: true, minIdeal: 50, maxIdeal: 150 },
    { name: "Critical Damage", value: 120, isPositive: true, minIdeal: 50, maxIdeal: 150 },
    { name: "Zoom", value: 30, isPositive: false, minIdeal: 20, maxIdeal: 60 },
  ];
  const itemAttrs = [
    { positive: true, url_name: "critical_chance" },
    { positive: true, url_name: "critical_damage" },
    { positive: false, url_name: "zoom" },
  ];
  mock.auctions = [400, 500, 600, 700, 800].map((buyout) => ({
    visible: true,
    owner: { status: "ingame" },
    buyout_price: buyout,
    item: { attributes: itemAttrs },
  }));

  const { estCard: cardSin } = createMockEstCard();
  const appraisalSin = { adjustedScore: 75, estimatedValue: 300, suggestedMin: 150, suggestedMax: 600 };
  await parchearTasacion({
    estCard: cardSin,
    appraisal: appraisalSin,
    weaponName: "Soma",
    weaponData,
    meta,
    basePrice: 300,
    precioTipico: 300,
    itemAttributes: stats,
    isEs: true,
    conComparables: false,
  });
  const antes = appraisalSin.fairPrice;
  assert.equal(requestedUrls.some((u) => u.includes("type=riven")), false);

  const { estCard: cardCon, fp, fr, comp } = createMockEstCard();
  const appraisalCon = { adjustedScore: 75, estimatedValue: 300, suggestedMin: 150, suggestedMax: 600 };
  await parchearTasacion({
    estCard: cardCon,
    appraisal: appraisalCon,
    weaponName: "Soma",
    weaponData,
    meta,
    basePrice: 300,
    precioTipico: 300,
    itemAttributes: stats,
    isEs: true,
    conComparables: true,
  });

  assert.equal(requestedUrls.some((u) => u.includes("type=riven")), true);
  assert.equal(appraisalCon.fairPrice, Math.round(antes ** 0.6 * 500 ** 0.4));
  assert.equal(fp.textContent, `~${appraisalCon.fairPrice}`);
  assert.equal(fr.innerHTML.includes(String(appraisalCon.fairPrice)), true);
  assert.equal(appraisalCon.fairHigh >= 600, true);
  assert.equal(appraisalCon.fairLow <= appraisalCon.fairPrice, true);
  assert.equal(comp.style.display, "inline-flex");
});

test("parchearTasacion limita a cincuenta centesimas el peso de comparables con diez subastas", async () => {
  const weaponData = { name: "Boar", t: "Shotgun", disposition: 1.0 };
  const meta = { name: "Boar", official_median: 300, wfm_avg: 500 };
  const stats = [
    { name: "Critical Chance", value: 120, isPositive: true, minIdeal: 50, maxIdeal: 150 },
    { name: "Critical Damage", value: 120, isPositive: true, minIdeal: 50, maxIdeal: 150 },
    { name: "Zoom", value: 30, isPositive: false, minIdeal: 20, maxIdeal: 60 },
  ];
  const itemAttrs = [
    { positive: true, url_name: "critical_chance" },
    { positive: true, url_name: "critical_damage" },
    { positive: false, url_name: "zoom" },
  ];
  mock.auctions = [500, 500, 500, 500, 500, 500, 500, 500, 500, 500].map((buyout) => ({
    visible: true,
    owner: { status: "ingame" },
    buyout_price: buyout,
    item: { attributes: itemAttrs },
  }));

  const { estCard: cardSin } = createMockEstCard();
  const appraisalSin = { adjustedScore: 75, estimatedValue: 300, suggestedMin: 150, suggestedMax: 600 };
  await parchearTasacion({
    estCard: cardSin,
    appraisal: appraisalSin,
    weaponName: "Boar",
    weaponData,
    meta,
    basePrice: 300,
    precioTipico: 300,
    itemAttributes: stats,
    isEs: true,
    conComparables: false,
  });
  const antes = appraisalSin.fairPrice;

  const { estCard: cardCon } = createMockEstCard();
  const appraisalCon = { adjustedScore: 75, estimatedValue: 300, suggestedMin: 150, suggestedMax: 600 };
  await parchearTasacion({
    estCard: cardCon,
    appraisal: appraisalCon,
    weaponName: "Boar",
    weaponData,
    meta,
    basePrice: 300,
    precioTipico: 300,
    itemAttributes: stats,
    isEs: true,
    conComparables: true,
  });

  assert.equal(requestedUrls.some((u) => u.includes("type=riven")), true);
  assert.equal(appraisalCon.fairPrice, Math.round(antes ** 0.5 * 500 ** 0.5));
});

test("parchearTasacion no altera el precio ni activa chip cuando hay solo dos subastas", async () => {
  const weaponData = { name: "Vectis", t: "Sniper", disposition: 1.0 };
  const meta = { name: "Vectis", official_median: 300, wfm_avg: 500 };
  const stats = [
    { name: "Critical Chance", value: 120, isPositive: true, minIdeal: 50, maxIdeal: 150 },
    { name: "Critical Damage", value: 120, isPositive: true, minIdeal: 50, maxIdeal: 150 },
    { name: "Zoom", value: 30, isPositive: false, minIdeal: 20, maxIdeal: 60 },
  ];
  const itemAttrs = [
    { positive: true, url_name: "critical_chance" },
    { positive: true, url_name: "critical_damage" },
    { positive: false, url_name: "zoom" },
  ];
  mock.auctions = [400, 500].map((buyout) => ({
    visible: true,
    owner: { status: "ingame" },
    buyout_price: buyout,
    item: { attributes: itemAttrs },
  }));

  const { estCard: cardSin } = createMockEstCard();
  const appraisalSin = { adjustedScore: 75, estimatedValue: 300, suggestedMin: 150, suggestedMax: 600 };
  await parchearTasacion({
    estCard: cardSin,
    appraisal: appraisalSin,
    weaponName: "Vectis",
    weaponData,
    meta,
    basePrice: 300,
    precioTipico: 300,
    itemAttributes: stats,
    isEs: true,
    conComparables: false,
  });
  const antes = appraisalSin.fairPrice;

  const { estCard: cardCon, comp } = createMockEstCard();
  const appraisalCon = { adjustedScore: 75, estimatedValue: 300, suggestedMin: 150, suggestedMax: 600 };
  await parchearTasacion({
    estCard: cardCon,
    appraisal: appraisalCon,
    weaponName: "Vectis",
    weaponData,
    meta,
    basePrice: 300,
    precioTipico: 300,
    itemAttributes: stats,
    isEs: true,
    conComparables: true,
  });

  assert.equal(requestedUrls.some((u) => u.includes("type=riven")), true);
  assert.equal(appraisalCon.fairPrice, antes);
  assert.notEqual(comp.style.display, "inline-flex");
});

test("parchearTasacion gestiona adecuadamente las alternativas de interaccion del chip de comparables", async () => {
  const { estCard, comp } = createMockEstCard();
  const weaponData = { name: "Larkspur", t: "Archgun", disposition: 1.0 };
  const meta = { name: "Larkspur", official_median: 300, wfm_avg: 500 };
  const stats = [
    { name: "Critical Chance", value: 120, isPositive: true, minIdeal: 50, maxIdeal: 150 },
    { name: "Critical Damage", value: 120, isPositive: true, minIdeal: 50, maxIdeal: 150 },
    { name: "Zoom", value: 30, isPositive: false, minIdeal: 20, maxIdeal: 60 },
  ];
  const itemAttrs = [
    { positive: true, url_name: "critical_chance" },
    { positive: true, url_name: "critical_damage" },
    { positive: false, url_name: "zoom" },
  ];
  mock.auctions = [400, 500, 600, 700, 800].map((buyout) => ({
    visible: true,
    owner: { status: "ingame" },
    buyout_price: buyout,
    item: { attributes: itemAttrs },
  }));
  const appraisal = { adjustedScore: 75, estimatedValue: 300, suggestedMin: 150, suggestedMax: 600 };

  await parchearTasacion({
    estCard,
    appraisal,
    weaponName: "Larkspur",
    weaponData,
    meta,
    basePrice: 300,
    precioTipico: 300,
    itemAttributes: stats,
    isEs: true,
    conComparables: true,
  });

  const prevOpen = globalThis.window.open;
  let llamadaOpen = null;
  globalThis.window.open = (url, target, features) => {
    llamadaOpen = { url, target, features };
  };
  globalThis.open = globalThis.window.open;

  try {
    delete mockElementsById["btn-search-similar-rivens"];
    comp.dispatchEvent({ type: "pointerdown", clientX: 0, clientY: 0 });
    comp.dispatchEvent({ type: "pointerup", clientX: 0, clientY: 0 });
    assert.notEqual(llamadaOpen, null);
    assert.equal(llamadaOpen.url.includes("warframe.market/auctions/search"), true);
    assert.equal(llamadaOpen.url.includes("larkspur"), true);
    assert.equal(llamadaOpen.target, "_blank");
    assert.equal(llamadaOpen.features.includes("noopener"), true);

    let clickEjecutado = false;
    const mockBotonDisabled = createMockElement("button");
    mockBotonDisabled.disabled = true;
    mockBotonDisabled.click = () => {
      clickEjecutado = true;
    };
    mockElementsById["btn-search-similar-rivens"] = mockBotonDisabled;
    comp.dispatchEvent({ type: "pointerdown", clientX: 0, clientY: 0 });
    comp.dispatchEvent({ type: "pointerup", clientX: 0, clientY: 0 });
    assert.equal(clickEjecutado, false);

    let scrollEjecutado = false;
    const mockContainer = createMockElement("div");
    mockContainer.scrollIntoView = () => {
      scrollEjecutado = true;
    };
    mockElementsById["similar-rivens-container"] = mockContainer;
    mockBotonDisabled.disabled = false;
    comp.dispatchEvent({ type: "pointerdown", clientX: 0, clientY: 0 });
    comp.dispatchEvent({ type: "pointerup", clientX: 0, clientY: 0 });
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(scrollEjecutado, true);
  } finally {
    globalThis.window.open = prevOpen;
    globalThis.open = prevOpen;
  }
});

test("generateRollResultsDOM genera tarjeta y columna para un roll valido", () => {
  const prevLang = state.currentLang;
  try {
    state.currentLang = "es";
    state.rivenIndexData = {
      Torid: { official_median: 350, pos: ["Critical Chance", "Multishot"], neg: ["Zoom"] },
    };
    const roll = {
      stats: [
        { name: "Critical Chance", value: 120 },
        { name: "Multishot", value: 80 },
        { name: "Zoom", value: -30 },
      ],
      rolls: 5,
    };
    const weaponData = { name: "Torid", t: "Rifle", disposition: 1.4 };

    const dom = generateRollResultsDOM(roll, weaponData, "Torid", 8, 1.0);
    assert.equal(dom.children.length, 2);
    assert.equal(dom.children[0].className, "grade-summary-card gsc");
    assert.equal(dom.children[1].className, "results-stats-col");
  } finally {
    state.currentLang = prevLang;
  }
});

test("generateRollResultsDOM parchea siempre el arma sin precio e ignora cualquier valor de un span antiguo", async () => {
  const prevLang = state.currentLang;
  const prevLog = console.log;
  const logs = [];
  console.log = (...args) => {
    logs.push(args.join(" "));
  };
  try {
    state.currentLang = "es";
    state.rivenIndexData = {};
    requestedUrls.length = 0;

    const roll = {
      stats: [
        { name: "Critical Chance", value: 120 },
        { name: "Multishot", value: 80 },
      ],
      rolls: 2,
    };
    const weaponData = { name: "ArmaSinPrecio", t: "Rifle", disposition: 1.0 };

    const variantes = [
      () => { delete mockElementsById["riven-avg-value"]; },
      () => {
        const el = createMockElement("span");
        el.innerText = "...";
        mockElementsById["riven-avg-value"] = el;
      },
      () => {
        const el = createMockElement("span");
        el.innerText = "50";
        mockElementsById["riven-avg-value"] = el;
      },
      () => {
        const el = createMockElement("span");
        el.innerText = "207";
        mockElementsById["riven-avg-value"] = el;
      },
    ];

    const fairPrecios = [];

    for (const preparar of variantes) {
      preparar();
      logs.length = 0;
      const dom = generateRollResultsDOM(roll, weaponData, "ArmaSinPrecio", 8, 1.0);
      assert.equal(dom.children[0].innerHTML.includes("data-sin-cifra"), true);

      const inicio = Date.now();
      let matchLog = null;
      while (Date.now() - inicio < 3000) {
        matchLog = logs.find((msg) => msg.includes("[ML fusion] ArmaSinPrecio"));
        if (matchLog) break;
        await new Promise((r) => setTimeout(r, 20));
      }
      assert.ok(matchLog);
      const match = matchLog.match(/fair=(\d+)/);
      assert.ok(match);
      fairPrecios.push(match[1]);
    }

    assert.equal(fairPrecios.length, 4);
    for (let i = 1; i < fairPrecios.length; i++) {
      assert.equal(fairPrecios[i], fairPrecios[0]);
    }
  } finally {
    console.log = prevLog;
    state.currentLang = prevLang;
  }
});

test("generateRollResultsDOM incluye estimacion de precio y dispara parche cuando existe precio tipico", async () => {
  const prevLang = state.currentLang;
  const prevLog = console.log;
  const logs = [];
  console.log = (...args) => {
    logs.push(args.join(" "));
  };
  try {
    state.currentLang = "es";
    state.rivenIndexData = {
      Ignis: { official_median: 350, pos: ["Critical Chance", "Multishot"], neg: ["Zoom"] },
    };
    const roll = {
      stats: [
        { name: "Critical Chance", value: 120 },
        { name: "Multishot", value: 80 },
        { name: "Zoom", value: -30 },
      ],
      rolls: 5,
    };
    const weaponData = { name: "Ignis", t: "Rifle", disposition: 1.2 };

    const dom = generateRollResultsDOM(roll, weaponData, "Ignis", 8, 1.0);
    assert.match(dom.children[0].innerHTML, /data-fair-price>~\d+/);

    const inicio = Date.now();
    let aparecio = false;
    while (Date.now() - inicio < 3000) {
      if (logs.some((msg) => msg.includes("[ML fusion] Ignis"))) {
        aparecio = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal(aparecio, true);
  } finally {
    console.log = prevLog;
    state.currentLang = prevLang;
  }
});

test("generateRollResultsDOM refleja el estado de carga del historial del arma en la tarjeta", () => {
  const prevLang = state.currentLang;
  const prevHistory = state.currentWeaponHistory;
  try {
    state.currentLang = "es";
    state.rivenIndexData = {
      Torid: { official_median: 350, pos: ["Critical Chance", "Multishot"], neg: ["Zoom"] },
    };
    const roll = {
      stats: [
        { name: "Critical Chance", value: 120 },
        { name: "Multishot", value: 80 },
      ],
      rolls: 1,
    };
    const weaponData = { name: "Torid", t: "Rifle", disposition: 1.4 };

    state.currentWeaponHistory = { weaponName: "Torid", loading: true };
    const domCargando = generateRollResultsDOM(roll, weaponData, "Torid", 8, 1.0);
    assert.equal(domCargando.children[0].innerHTML.includes("actualizando historial…"), true);

    state.currentWeaponHistory = { weaponName: "Torid", loading: false };
    const domListo = generateRollResultsDOM(roll, weaponData, "Torid", 8, 1.0);
    assert.equal(domListo.children[0].innerHTML.includes("actualizando historial…"), false);
  } finally {
    state.currentWeaponHistory = prevHistory;
    state.currentLang = prevLang;
  }
});

test("parchearTasacion eleva fairHigh al considerar subastas comparables", async () => {
  const weaponName = "Rubico";
  const weaponData = { name: weaponName, t: "Sniper", disposition: 1.0 };
  const meta = { name: weaponName, official_median: 300, wfm_avg: 500 };
  const stats = [
    { name: "Critical Chance", value: 120, isPositive: true, minIdeal: 50, maxIdeal: 150 },
    { name: "Critical Damage", value: 120, isPositive: true, minIdeal: 50, maxIdeal: 150 },
    { name: "Zoom", value: 30, isPositive: false, minIdeal: 20, maxIdeal: 60 },
  ];
  const itemAttrs = [
    { positive: true, url_name: "critical_chance" },
    { positive: true, url_name: "critical_damage" },
    { positive: false, url_name: "zoom" },
  ];
  mock.auctions = [4000, 5000, 6000, 7000, 8000].map((buyout) => ({
    visible: true,
    owner: { status: "ingame" },
    buyout_price: buyout,
    item: { attributes: itemAttrs },
  }));

  const { estCard: cardSin } = createMockEstCard();
  const appraisalSin = { adjustedScore: 75, estimatedValue: 300, suggestedMin: 150, suggestedMax: 600 };
  await parchearTasacion({
    estCard: cardSin,
    appraisal: appraisalSin,
    weaponName,
    weaponData,
    meta,
    basePrice: 300,
    precioTipico: 300,
    itemAttributes: stats,
    isEs: true,
    conComparables: false,
  });
  assert.equal(appraisalSin.fairHigh < 6000, true);

  const { estCard: cardCon } = createMockEstCard();
  const appraisalCon = { adjustedScore: 75, estimatedValue: 300, suggestedMin: 150, suggestedMax: 600 };
  await parchearTasacion({
    estCard: cardCon,
    appraisal: appraisalCon,
    weaponName,
    weaponData,
    meta,
    basePrice: 300,
    precioTipico: 300,
    itemAttributes: stats,
    isEs: true,
    conComparables: true,
  });
  assert.equal(appraisalCon.fairHigh, 6000);
});

test("parchearTasacion resiste fallos en el bloque de comparables sin tumbar la tasacion", async () => {
  const weaponName = "Dread";
  const weaponData = { name: weaponName, t: "Bow", disposition: 1.0 };
  const meta = { name: weaponName, official_median: 300, wfm_avg: 500 };
  const stats = [
    { name: "Critical Chance", value: 120, isPositive: true, minIdeal: 50, maxIdeal: 150 },
    { name: "Critical Damage", value: 120, isPositive: true, minIdeal: 50, maxIdeal: 150 },
    { name: "Zoom", value: 30, isPositive: false, minIdeal: 20, maxIdeal: 60 },
  ];
  const itemAttrs = [
    { positive: true, url_name: "critical_chance" },
    { positive: true, url_name: "critical_damage" },
    { positive: false, url_name: "zoom" },
  ];
  mock.auctions = [400, 500, 600, 700, 800].map((buyout) => ({
    visible: true,
    owner: { status: "ingame" },
    buyout_price: buyout,
    item: { attributes: itemAttrs },
  }));

  const { estCard, fp, ml, ss } = createMockEstCard();
  const q = estCard.querySelector;
  estCard.querySelector = (s) => {
    if (s === "[data-comp-line]") throw new Error("x");
    return q.call(estCard, s);
  };
  const appraisal = { adjustedScore: 75, estimatedValue: 300, suggestedMin: 150, suggestedMax: 600 };

  await parchearTasacion({
    estCard,
    appraisal,
    weaponName,
    weaponData,
    meta,
    basePrice: 300,
    precioTipico: 300,
    itemAttributes: stats,
    isEs: true,
    conComparables: true,
  });

  assert.equal(fp.textContent.startsWith("~"), true);
  assert.equal(ml.innerHTML.includes("Confianza no disponible"), false);
  assert.equal(ss.innerHTML.includes("%"), true);
});
