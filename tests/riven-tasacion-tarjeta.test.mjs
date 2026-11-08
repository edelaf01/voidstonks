import test from "node:test";
import assert from "node:assert/strict";
import { montarTarjeta } from "./_helpers/riven-tasacion-dom.mjs";

const { state } = await import("../deploy/js/state.js");

const {
  buildAppraisalWarningsHtml,
  buildAppraisalCardHTML,
  buildStatsTable,
  computeFairHigh,
  parchearTasacion,
} = await import("../deploy/js/ui.components/rivens/ui_riven_appraisal.js");

const {
  getRivenStatRange,
  calculateHybridTiers,
  calculateAdvancedPredictivePrice,
} = await import("../deploy/js/utils/rivens/riven_logic.js");

test("buildStatsTable genera filas por stat y leyenda final como ultimo hijo", () => {
  const weaponData = { name: "Torid", t: "Rifle", disposition: 1.0 };
  const stats = [
    { name: "Critical Chance", value: 120, projected: 120 },
    { name: "Multishot", value: 80, projected: 80 },
  ];
  const table = buildStatsTable(stats, weaponData, 2, false, true, { weaponName: "Torid" });
  assert.equal(table.children.length, 3);
  assert.equal(table.children[2].className, "tas-leyenda");
});

test("buildStatsTable formatea stat positivo en valor maximo como tirada alta y cien por cien en ES y EN", () => {
  const prevLang = state.currentLang;
  try {
    const weaponData = { name: "Torid", t: "Rifle", disposition: 1.0 };
    const rango = getRivenStatRange(weaponData, "Critical Chance", false, 2, true);
    const maxVal = Math.max(Math.abs(rango.min), Math.abs(rango.max));

    state.currentLang = "es";
    const tableEs = buildStatsTable(
      [{ name: "Critical Chance", value: maxVal, projected: maxVal }],
      weaponData, 2, true, true, { weaponName: "Torid" }
    );
    const rowEs = tableEs.children[0];
    assert.equal(rowEs.classList.contains("tas-pos"), true);
    assert.equal(rowEs.classList.contains("tas-nivel-alta"), true);
    assert.equal(rowEs.textContent.includes("TIRADA ALTA · 100%"), true);

    state.currentLang = "en";
    const tableEn = buildStatsTable(
      [{ name: "Critical Chance", value: maxVal, projected: maxVal }],
      weaponData, 2, true, false, { weaponName: "Torid" }
    );
    const rowEn = tableEn.children[0];
    assert.equal(rowEn.classList.contains("tas-pos"), true);
    assert.equal(rowEn.classList.contains("tas-nivel-alta"), true);
    assert.equal(rowEn.textContent.includes("HIGH ROLL · 100%"), true);
  } finally {
    state.currentLang = prevLang;
  }
});

test("buildStatsTable formatea stat positivo en valor minimo como tirada baja y cero por ciento", () => {
  const weaponData = { name: "Torid", t: "Rifle", disposition: 1.0 };
  const rango = getRivenStatRange(weaponData, "Critical Chance", false, 2, true);
  const minVal = Math.min(Math.abs(rango.min), Math.abs(rango.max));
  const table = buildStatsTable(
    [{ name: "Critical Chance", value: minVal, projected: minVal }],
    weaponData, 2, true, true, { weaponName: "Torid" }
  );
  const row = table.children[0];
  assert.equal(row.classList.contains("tas-nivel-baja"), true);
  assert.equal(row.textContent.includes("TIRADA BAJA · 0%"), true);
});

test("buildStatsTable formatea negativo con magnitud minima como leve y maxima como fuerte sin porcentaje", () => {
  const weaponData = { name: "Torid", t: "Rifle", disposition: 1.0 };
  const rango = getRivenStatRange(weaponData, "Zoom", true, 2, true);
  const minVal = Math.min(Math.abs(rango.min), Math.abs(rango.max));
  const maxVal = Math.max(Math.abs(rango.min), Math.abs(rango.max));

  const tableLeve = buildStatsTable(
    [{ name: "Zoom", value: -minVal, projected: -minVal }],
    weaponData, 2, true, true, { meta: null, weaponName: "Torid" }
  );
  const rowLeve = tableLeve.children[0];
  assert.equal(rowLeve.classList.contains("tas-neg"), true);
  assert.equal(rowLeve.classList.contains("tas-nivel-alta"), true);
  const matchLeve = rowLeve.innerHTML.match(/<span class="tas-nivel">([^<]*)<\/span>/);
  assert.equal(matchLeve[1], "PENALIZACIÓN LEVE");
  assert.equal(matchLeve[1].includes("%"), false);

  const tableFuerte = buildStatsTable(
    [{ name: "Zoom", value: -maxVal, projected: -maxVal }],
    weaponData, 2, true, true, { meta: null, weaponName: "Torid" }
  );
  const rowFuerte = tableFuerte.children[0];
  assert.equal(rowFuerte.classList.contains("tas-neg"), true);
  assert.equal(rowFuerte.classList.contains("tas-nivel-baja"), true);
  const matchFuerte = rowFuerte.innerHTML.match(/<span class="tas-nivel">([^<]*)<\/span>/);
  assert.equal(matchFuerte[1], "PENALIZACIÓN FUERTE");
  assert.equal(matchFuerte[1].includes("%"), false);
});

test("buildStatsTable aplica atenuado y texto especifico cuando el negativo es inofensivo", () => {
  const weaponData = { name: "Torid", t: "Rifle", disposition: 1.0 };
  const rango = getRivenStatRange(weaponData, "Zoom", true, 2, true);
  const minVal = Math.min(Math.abs(rango.min), Math.abs(rango.max));
  const meta = { neg: ["Zoom"] };
  const table = buildStatsTable(
    [{ name: "Zoom", value: -minVal, projected: -minVal }],
    weaponData, 2, true, true, { meta, weaponName: "Torid" }
  );
  const row = table.children[0];
  assert.equal(row.classList.contains("tas-atenuado"), true);
  assert.equal(row.classList.contains("tas-cal-inofensiva"), true);
  assert.equal(row.textContent.includes("La tirada apenas importa"), true);
});

test("buildStatsTable no atenua negativos dañinos o sin datos y expresa el nivel como penalizacion", () => {
  const weaponData = { name: "Torid", t: "Rifle", disposition: 1.0 };
  const rango = getRivenStatRange(weaponData, "Critical Chance", true, 2, true);
  const maxVal = Math.max(Math.abs(rango.min), Math.abs(rango.max));
  const tableSinDatos = buildStatsTable(
    [{ name: "Critical Chance", value: -maxVal, projected: -maxVal }],
    weaponData, 2, true, true, { meta: null, weaponName: "Torid" }
  );
  const rowSinDatos = tableSinDatos.children[0];
  assert.equal(rowSinDatos.classList.contains("tas-atenuado"), false);
  assert.equal(rowSinDatos.textContent.includes("PENALIZACIÓN"), true);

  const metaRuinoso = { pos: ["Critical Chance"], neg: ["Zoom"] };
  const tableRuinoso = buildStatsTable(
    [{ name: "Critical Chance", value: -maxVal, projected: -maxVal }],
    weaponData, 2, true, true, { meta: metaRuinoso, weaponName: "Torid" }
  );
  const rowRuinoso = tableRuinoso.children[0];
  assert.equal(rowRuinoso.classList.contains("tas-atenuado"), false);
  assert.equal(rowRuinoso.textContent.includes("PENALIZACIÓN"), true);
});

test("buildStatsTable situa barra de medidor en cien por ciento para negativo minimo y coloca mayor magnitud a la izquierda", () => {
  const weaponData = { name: "Torid", t: "Rifle", disposition: 1.0 };
  const rango = getRivenStatRange(weaponData, "Zoom", true, 2, true);
  const minVal = Math.min(Math.abs(rango.min), Math.abs(rango.max));
  const maxVal = Math.max(Math.abs(rango.min), Math.abs(rango.max));
  const table = buildStatsTable(
    [{ name: "Zoom", value: -minVal, projected: -minVal }],
    weaponData, 2, true, true, { meta: null, weaponName: "Torid" }
  );
  const row = table.children[0];
  assert.equal(row.innerHTML.includes("--pos:100.0%"), true);
  const extremos = [...row.innerHTML.matchAll(/<span class="tas-extremo">([^<]*)<\/span>/g)].map((m) => m[1]);
  assert.equal(extremos[0], `-${maxVal}%`);
  assert.equal(extremos[1], `-${minVal}%`);
});

test("buildStatsTable maneja stats fusionados con etiqueta cortes especificos y sin porcentaje", () => {
  const weaponData = { name: "Torid", t: "Rifle", disposition: 1.0 };
  const table = buildStatsTable(
    [{ name: "Gas", value: 30, projected: 30 }],
    weaponData, 2, false, true, { weaponName: "Torid" }
  );
  const row = table.children[0];
  assert.equal(row.innerHTML.includes('<span class="tas-tag">fusionado</span>'), true);
  assert.equal(row.innerHTML.includes("--c1:69.3%"), true);
  const matchNivel = row.innerHTML.match(/<span class="tas-nivel">([^<]*)<\/span>/);
  assert.equal(matchNivel[1].includes("%"), false);
  const leyenda = table.children[table.children.length - 1];
  assert.equal(leyenda.innerHTML.includes("Fusionado: calidad y tramos provisionales"), true);
});

test("buildStatsTable asigna nivel nulo sin medidor cuando el stat no tiene rango conocido", () => {
  const weaponData = { name: "Torid", t: "Rifle", disposition: 1.0 };
  const table = buildStatsTable(
    [{ name: "Range", value: 50, projected: 50 }],
    weaponData, 2, false, true, { weaponName: "Torid" }
  );
  const row = table.children[0];
  assert.equal(row.classList.contains("tas-nivel-nula"), true);
  assert.equal(row.innerHTML.includes("tas-medidor"), false);
  assert.equal(row.textContent.includes("Sin rango conocido"), true);
});

test("buildStatsTable asigna nivel fuera cuando el valor proyectado supera ampliamente el maximo", () => {
  const weaponData = { name: "Torid", t: "Rifle", disposition: 1.0 };
  const table = buildStatsTable(
    [{ name: "Critical Chance", value: 100, projected: 9999 }],
    weaponData, 2, false, true, { weaponName: "Torid" }
  );
  const row = table.children[0];
  assert.equal(row.classList.contains("tas-nivel-fuera"), true);
  assert.equal(row.textContent.includes("Fuera de rango"), true);
});

test("buildStatsTable divide extremos del pie por la escala provista", () => {
  const weaponData = { name: "Torid", t: "Rifle", disposition: 1.0 };
  const rango = getRivenStatRange(weaponData, "Critical Chance", false, 2, false);
  const maxVal = Math.max(Math.abs(rango.min), Math.abs(rango.max));

  const tableEsc1 = buildStatsTable(
    [{ name: "Critical Chance", value: 50, projected: 50 }],
    weaponData, 2, false, true, { weaponName: "Torid", escala: 1 }
  );
  const tableEsc2 = buildStatsTable(
    [{ name: "Critical Chance", value: 50, projected: 50 }],
    weaponData, 2, false, true, { weaponName: "Torid", escala: 2 }
  );

  const mitad = Number((maxVal / 2).toFixed(1));
  assert.equal(tableEsc1.children[0].innerHTML.includes(`+${maxVal}%`), true);
  assert.equal(tableEsc2.children[0].innerHTML.includes(`+${mitad}%`), true);
});

test("buildStatsTable muestra valor actual en tas-valor y fija posicion de barra en cien por cien usando el proyectado", () => {
  const weaponData = { name: "Torid", t: "Rifle", disposition: 1.0 };
  const rango = getRivenStatRange(weaponData, "Critical Chance", false, 2, false);
  const maxVal = Math.max(Math.abs(rango.min), Math.abs(rango.max));
  const mitad = Number((maxVal / 2).toFixed(1));
  const table = buildStatsTable(
    [{ name: "Critical Chance", value: mitad, projected: maxVal }],
    weaponData, 2, false, true, { weaponName: "Torid", escala: 2 }
  );
  const row = table.children[0];
  const matchValor = row.innerHTML.match(/<span class="tas-valor">([^<]*)<\/span>/);
  assert.equal(matchValor[1], `+${mitad}%`);
  assert.equal(row.innerHTML.includes("--pos:100.0%"), true);
});

test("buildStatsTable maneja meta null asignando sindato y etiqueta sin datos sin lanzar error", () => {
  const weaponData = { name: "Torid", t: "Rifle", disposition: 1.0 };
  const table = buildStatsTable(
    [{ name: "Critical Chance", value: 100, projected: 100 }],
    weaponData, 1, false, true, { meta: null, weaponName: "Torid" }
  );
  const row = table.children[0];
  assert.equal(row.classList.contains("tas-cal-sindato"), true);
  assert.equal(row.textContent.includes("SIN DATOS"), true);
});

test("buildStatsTable muestra tilde de calidad estimada y nota en leyenda cuando meta tiene recomendaciones genericas", () => {
  const weaponData = { name: "ArmaInventada", t: "Rifle", disposition: 1.0 };
  const meta = { name: "ArmaInventada", t: "Rifle", _genericRecs: true };
  const table = buildStatsTable(
    [{ name: "Critical Chance", value: 100, projected: 100 }],
    weaponData, 1, false, true, { meta, weaponName: "ArmaInventada" }
  );
  const row = table.children[0];
  assert.equal(row.innerHTML.includes('<span class="tas-calidad">~TOP</span>'), true);
  const leyenda = table.children[table.children.length - 1];
  assert.equal(leyenda.innerHTML.includes("~ Calidad estimada por tipo de arma, sin datos propios"), true);
});

test("buildStatsTable no muta el objeto meta recibido como parametro", () => {
  const weaponData = { name: "Torid", t: "Rifle", disposition: 1.0 };
  const meta = { name: "Torid", official_median: 200 };
  const clon = structuredClone(meta);
  buildStatsTable(
    [{ name: "Critical Chance", value: 100, projected: 100 }],
    weaponData, 1, false, true, { meta, weaponName: "Torid" }
  );
  assert.deepEqual(meta, clon);
});

test("buildStatsTable procesa retroceso con rango real invirtiendo signos visuales y conservando medidores", () => {
  const weaponData = { name: "Torid", t: "Rifle", disposition: 1.0 };

  const rangoNeg = getRivenStatRange(weaponData, "Recoil", true, 2, true);
  const valNeg = Number(((rangoNeg.min + rangoNeg.max) / 2).toFixed(1));
  const tableNeg = buildStatsTable(
    [{ name: "Recoil", value: valNeg, projected: valNeg }],
    weaponData, 2, true, true, { weaponName: "Torid" }
  );
  const rowNeg = tableNeg.children[0];
  assert.equal(rowNeg.classList.contains("tas-neg"), true);
  assert.equal(rowNeg.classList.contains("tas-nivel-fuera"), false);
  assert.equal(rowNeg.classList.contains("tas-nivel-nula"), false);
  assert.equal(rowNeg.innerHTML.includes("tas-medidor"), true);
  const matchValNeg = rowNeg.innerHTML.match(/<span class="tas-valor">([^<]*)<\/span>/);
  assert.equal(matchValNeg[1].startsWith("+"), true);

  const rangoPos = getRivenStatRange(weaponData, "Recoil", false, 2, false);
  const magPos = Math.abs(Number(((rangoPos.min + rangoPos.max) / 2).toFixed(1)));
  const tablePos = buildStatsTable(
    [{ name: "Recoil", value: magPos, projected: magPos }],
    weaponData, 2, false, true, { weaponName: "Torid" }
  );
  const rowPos = tablePos.children[0];
  assert.equal(rowPos.classList.contains("tas-pos"), true);
  assert.equal(rowPos.classList.contains("tas-nivel-fuera"), false);
  assert.equal(rowPos.classList.contains("tas-nivel-nula"), false);
  const matchValPos = rowPos.innerHTML.match(/<span class="tas-valor">([^<]*)<\/span>/);
  assert.equal(matchValPos[1].startsWith("-"), true);
});

test("buildStatsTable muestra todas las etiquetas de calidad de stats en castellano e ingles", () => {
  const weaponData = { name: "Torid", t: "Rifle", disposition: 1.0 };
  const meta = {
    pos: ["Critical Chance"],
    midPos: ["Multishot"],
    neg: ["Zoom"],
    midNeg: ["Critical Damage"],
  };

  const tableTopEs = buildStatsTable([{ name: "Critical Chance", value: 100, projected: 100 }], weaponData, 1, false, true, { meta, weaponName: "Torid" });
  assert.equal(tableTopEs.children[0].innerHTML.includes('<span class="tas-calidad">TOP</span>'), true);

  const tableTopEn = buildStatsTable([{ name: "Critical Chance", value: 100, projected: 100 }], weaponData, 1, false, false, { meta, weaponName: "Torid" });
  assert.equal(tableTopEn.children[0].innerHTML.includes('<span class="tas-calidad">TOP</span>'), true);

  const tableMidEs = buildStatsTable([{ name: "Multishot", value: 80, projected: 80 }], weaponData, 1, false, true, { meta, weaponName: "Torid" });
  assert.equal(tableMidEs.children[0].innerHTML.includes('<span class="tas-calidad">MEDIO</span>'), true);

  const tableMidEn = buildStatsTable([{ name: "Multishot", value: 80, projected: 80 }], weaponData, 1, false, false, { meta, weaponName: "Torid" });
  assert.equal(tableMidEn.children[0].innerHTML.includes('<span class="tas-calidad">MID</span>'), true);

  const metaFlojo = {
    pos: ["Critical Chance"],
    midPos: ["Multishot"],
    neg: ["Zoom"],
    midNeg: ["Critical Damage"],
    dynamic_weights: { "Impact Damage": 0.05 },
  };
  const tableWeakEs = buildStatsTable([{ name: "Impact Damage", value: 50, projected: 50 }], weaponData, 1, false, true, { meta: metaFlojo, weaponName: "Torid" });
  assert.equal(tableWeakEs.children[0].innerHTML.includes('<span class="tas-calidad">FLOJO</span>'), true);

  const tableWeakEn = buildStatsTable([{ name: "Impact Damage", value: 50, projected: 50 }], weaponData, 1, false, false, { meta: metaFlojo, weaponName: "Torid" });
  assert.equal(tableWeakEn.children[0].innerHTML.includes('<span class="tas-calidad">WEAK</span>'), true);

  const tableInofEs = buildStatsTable([{ name: "Zoom", value: -30, projected: -30 }], weaponData, 2, true, true, { meta, weaponName: "Torid" });
  assert.equal(tableInofEs.children[0].innerHTML.includes('<span class="tas-calidad">INOFENSIVA</span>'), true);

  const tableInofEn = buildStatsTable([{ name: "Zoom", value: -30, projected: -30 }], weaponData, 2, true, false, { meta, weaponName: "Torid" });
  assert.equal(tableInofEn.children[0].innerHTML.includes('<span class="tas-calidad">HARMLESS</span>'), true);

  const tableMedNegEs = buildStatsTable([{ name: "Critical Damage", value: -50, projected: -50 }], weaponData, 2, true, true, { meta, weaponName: "Torid" });
  assert.equal(tableMedNegEs.children[0].innerHTML.includes('<span class="tas-calidad">MEDIA</span>'), true);

  const tableMedNegEn = buildStatsTable([{ name: "Critical Damage", value: -50, projected: -50 }], weaponData, 2, true, false, { meta, weaponName: "Torid" });
  assert.equal(tableMedNegEn.children[0].innerHTML.includes('<span class="tas-calidad">MODERATE</span>'), true);

  const tableRuinEs = buildStatsTable([{ name: "Critical Chance", value: -80, projected: -80 }], weaponData, 2, true, true, { meta, weaponName: "Torid" });
  assert.equal(tableRuinEs.children[0].innerHTML.includes('<span class="tas-calidad">RUINOSA</span>'), true);

  const tableRuinEn = buildStatsTable([{ name: "Critical Chance", value: -80, projected: -80 }], weaponData, 2, true, false, { meta, weaponName: "Torid" });
  assert.equal(tableRuinEn.children[0].innerHTML.includes('<span class="tas-calidad">RUINOUS</span>'), true);

  const tableSinMetaEs = buildStatsTable([{ name: "Critical Chance", value: 100, projected: 100 }], weaponData, 1, false, true, { meta: null, weaponName: "Torid" });
  assert.equal(tableSinMetaEs.children[0].innerHTML.includes('<span class="tas-calidad">SIN DATOS</span>'), true);

  const tableSinMetaEn = buildStatsTable([{ name: "Critical Chance", value: 100, projected: 100 }], weaponData, 1, false, false, { meta: null, weaponName: "Torid" });
  assert.equal(tableSinMetaEn.children[0].innerHTML.includes('<span class="tas-calidad">NO DATA</span>'), true);
});

test("buildStatsTable traduce estados de tirada y leyendas informativas en ingles y castellano", () => {
  const weaponData = { name: "Torid", t: "Rifle", disposition: 1.0 };
  const rango = getRivenStatRange(weaponData, "Critical Chance", false, 2, false);
  const valMedio = Number(((rango.min + rango.max) / 2).toFixed(1));

  const tableMedEs = buildStatsTable([{ name: "Critical Chance", value: valMedio, projected: valMedio }], weaponData, 2, false, true, { weaponName: "Torid" });
  assert.equal(tableMedEs.children[0].textContent.includes("TIRADA MEDIA"), true);

  const tableMedEn = buildStatsTable([{ name: "Critical Chance", value: valMedio, projected: valMedio }], weaponData, 2, false, false, { weaponName: "Torid" });
  assert.equal(tableMedEn.children[0].textContent.includes("MID ROLL"), true);
  const leyendaMedEn = tableMedEn.children[tableMedEn.children.length - 1];
  assert.equal(leyendaMedEn.innerHTML.includes("Bar: right = better for you"), true);

  const rangoNeg = getRivenStatRange(weaponData, "Zoom", true, 2, true);
  const minMag = Math.min(Math.abs(rangoNeg.min), Math.abs(rangoNeg.max));
  const maxMag = Math.max(Math.abs(rangoNeg.min), Math.abs(rangoNeg.max));
  const medMag = Number(((minMag + maxMag) / 2).toFixed(1));

  const tableNegMedEs = buildStatsTable([{ name: "Zoom", value: -medMag, projected: -medMag }], weaponData, 2, true, true, { meta: null, weaponName: "Torid" });
  assert.equal(tableNegMedEs.children[0].textContent.includes("PENALIZACIÓN MEDIA"), true);

  const tableNegMedEn = buildStatsTable([{ name: "Zoom", value: -medMag, projected: -medMag }], weaponData, 2, true, false, { meta: null, weaponName: "Torid" });
  assert.equal(tableNegMedEn.children[0].textContent.includes("MODERATE PENALTY"), true);

  const tableLeveEn = buildStatsTable([{ name: "Zoom", value: -minMag, projected: -minMag }], weaponData, 2, true, false, { meta: null, weaponName: "Torid" });
  assert.equal(tableLeveEn.children[0].textContent.includes("MILD PENALTY"), true);

  const tableFuerteEn = buildStatsTable([{ name: "Zoom", value: -maxMag, projected: -maxMag }], weaponData, 2, true, false, { meta: null, weaponName: "Torid" });
  assert.equal(tableFuerteEn.children[0].textContent.includes("HEAVY PENALTY"), true);

  const tableNulaEn = buildStatsTable([{ name: "Range", value: 50, projected: 50 }], weaponData, 2, false, false, { weaponName: "Torid" });
  assert.equal(tableNulaEn.children[0].textContent.includes("No known range"), true);

  const tableFueraEn = buildStatsTable([{ name: "Critical Chance", value: 100, projected: 9999 }], weaponData, 2, false, false, { weaponName: "Torid" });
  assert.equal(tableFueraEn.children[0].textContent.includes("Out of range"), true);

  const tableAtenuadoEn = buildStatsTable([{ name: "Zoom", value: -minMag, projected: -minMag }], weaponData, 2, true, false, { meta: { neg: ["Zoom"] }, weaponName: "Torid" });
  assert.equal(tableAtenuadoEn.children[0].textContent.includes("Roll barely matters"), true);

  const tableSplicedEn = buildStatsTable([{ name: "Gas", value: 30, projected: 30 }], weaponData, 2, false, false, { weaponName: "Torid" });
  const leyendaSpliced = tableSplicedEn.children[tableSplicedEn.children.length - 1];
  assert.equal(leyendaSpliced.innerHTML.includes("Spliced:"), true);

  const metaGenerico = { name: "Torid", t: "Rifle", _genericRecs: true };
  const tableEstEn = buildStatsTable([{ name: "Critical Chance", value: 100, projected: 100 }], weaponData, 1, false, false, { meta: metaGenerico, weaponName: "Torid" });
  const leyendaEst = tableEstEn.children[tableEstEn.children.length - 1];
  assert.equal(leyendaEst.innerHTML.includes("~ Quality estimated"), true);
});

test("buildStatsTable escapa nombres de stat con caracteres HTML", () => {
  const weaponData = { name: "Torid", t: "Rifle", disposition: 1.0 };
  const table = buildStatsTable(
    [{ name: "<b>x</b>", value: 50, projected: 50 }],
    weaponData, 1, false, true, { weaponName: "Torid" }
  );
  const row = table.children[0];
  assert.equal(row.innerHTML.includes("&lt;b&gt;x&lt;/b&gt;"), true);
  assert.equal(row.innerHTML.includes("<span class=\"tas-nombre\"><b>x</b></span>"), false);
});

test("buildAppraisalCardHTML renderiza cifras ganchos de datos y estado de calculo de confianza", () => {
  const prevLang = state.currentLang;
  try {
    state.currentLang = "es";
    const htmlEs = buildAppraisalCardHTML({
      tier: "S",
      tierColor: "grade-s",
      priceCalculated: 500,
      minPrice: 200,
      maxPrice: 800,
      finalScore: 85,
      demanda: 70,
      precioTipico: 200,
      warningHtml: "",
      isEs: true,
      withSimilarButton: false,
      histLoading: false,
    });
    assert.equal(htmlEs.includes("~500"), true);
    assert.equal(htmlEs.includes("tas-banda-cifras"), true);
    assert.equal(htmlEs.includes("data-fair-price"), true);
    assert.equal(htmlEs.includes("data-fair-range"), true);
    assert.equal(htmlEs.includes("data-ml-line"), true);
    assert.equal(htmlEs.includes("data-stat-score"), true);
    assert.equal(htmlEs.includes("data-roll-score"), true);
    assert.equal(htmlEs.includes("data-market-line"), true);
    assert.equal(htmlEs.includes("data-comp-line"), true);
    assert.equal(htmlEs.includes("Calculando confianza…"), true);

    state.currentLang = "en";
    const htmlEn = buildAppraisalCardHTML({
      tier: "S",
      tierColor: "grade-s",
      priceCalculated: 500,
      minPrice: 200,
      maxPrice: 800,
      finalScore: 85,
      demanda: 70,
      precioTipico: 200,
      warningHtml: "",
      isEs: false,
      withSimilarButton: false,
      histLoading: false,
    });
    assert.equal(htmlEn.includes("Computing confidence…"), true);
  } finally {
    state.currentLang = prevLang;
  }
});

test("buildAppraisalCardHTML renderiza estado vacio con indicador sin cifra icono de platino y chips pendientes", () => {
  const html = buildAppraisalCardHTML({
    tier: "F",
    tierColor: "grade-f",
    priceCalculated: 0,
    minPrice: 0,
    maxPrice: 0,
    finalScore: 0,
    demanda: null,
    precioTipico: null,
    warningHtml: "",
    isEs: true,
    withSimilarButton: false,
    histLoading: false,
  });
  assert.equal(html.includes("<span data-fair-price data-sin-cifra>…</span>"), true);
  assert.equal(html.includes("tas-plat"), true);
  assert.equal(html.includes("Calculando confianza…"), true);
  assert.equal(html.includes("Sin datos de mercado"), false);
  assert.equal(html.includes('<b style="opacity:.5;">…</b>'), true);
  assert.equal(html.includes("data-fair-price"), true);
  assert.equal(html.includes("data-fair-range"), true);
  assert.equal(html.includes("data-ml-line"), true);
  assert.equal(html.includes("data-stat-score"), true);
  assert.equal(html.includes("data-roll-score"), true);
  assert.equal(html.includes("data-market-line"), true);
  assert.equal(html.includes("data-comp-line"), true);
});

test("buildAppraisalCardHTML formatea demanda en valor numerico o cadena sin datos", () => {
  const htmlNull = buildAppraisalCardHTML({
    tier: "B", tierColor: "grade-b", priceCalculated: 100, minPrice: 50, maxPrice: 150,
    finalScore: 50, demanda: null, precioTipico: 100, warningHtml: "", isEs: true,
    withSimilarButton: false, histLoading: false,
  });
  assert.equal(htmlNull.includes("sin datos"), true);

  const htmlNum = buildAppraisalCardHTML({
    tier: "B", tierColor: "grade-b", priceCalculated: 100, minPrice: 50, maxPrice: 150,
    finalScore: 50, demanda: 64, precioTipico: 100, warningHtml: "", isEs: true,
    withSimilarButton: false, histLoading: false,
  });
  assert.equal(htmlNum.includes("64/100"), true);
});

test("buildAppraisalCardHTML condiciona mensaje de carga y boton de similares a los flags correspondientes", () => {
  const conCarga = buildAppraisalCardHTML({
    tier: "B", tierColor: "grade-b", priceCalculated: 100, minPrice: 50, maxPrice: 150,
    finalScore: 50, demanda: 50, precioTipico: 100, warningHtml: "", isEs: true,
    withSimilarButton: true, histLoading: true,
  });
  assert.equal(conCarga.includes("actualizando historial…"), true);
  assert.equal(conCarga.includes("btn-search-similar-rivens"), true);

  const sinCarga = buildAppraisalCardHTML({
    tier: "B", tierColor: "grade-b", priceCalculated: 100, minPrice: 50, maxPrice: 150,
    finalScore: 50, demanda: 50, precioTipico: 100, warningHtml: "", isEs: true,
    withSimilarButton: false, histLoading: false,
  });
  assert.equal(sinCarga.includes("actualizando historial…"), false);
  assert.equal(sinCarga.includes("btn-search-similar-rivens"), false);
});

test("buildAppraisalCardHTML usa icono de platino y no emite letra p suelta tras cifras de precio", () => {
  const html = buildAppraisalCardHTML({
    tier: "A", tierColor: "grade-a", priceCalculated: 350, minPrice: 150, maxPrice: 600,
    finalScore: 75, demanda: 50, precioTipico: 200, warningHtml: "", isEs: true,
    withSimilarButton: false, histLoading: false,
  });
  const sinEstilos = html.replace(/style="[^"]*"/g, "");
  assert.equal(/\d+p\b/.test(sinEstilos), false);
  assert.equal(html.includes("plat-icon-inline"), true);
});

test("buildAppraisalCardHTML tolera rango invertido mostrando cifras sin pista de barra", () => {
  const html = buildAppraisalCardHTML({
    tier: "A", tierColor: "grade-a", priceCalculated: 300, minPrice: 500, maxPrice: 200,
    finalScore: 70, demanda: 50, precioTipico: 200, warningHtml: "", isEs: true,
    withSimilarButton: false, histLoading: false,
  });
  assert.equal(html.includes("tas-banda-cifras"), true);
  assert.equal(html.includes("tas-banda-pista"), false);
});

test("buildAppraisalWarningsHtml genera avisos segun combo deseabilidad y umbral de platino ilicito", () => {
  const prevLang = state.currentLang;
  try {
    state.currentLang = "es";
    const avisoCombo = buildAppraisalWarningsHtml({
      appraisal: { comboName: "Corrosive" }, desirabilityMultiplier: 0.6, stats: [], priceCalculated: 200, isEs: true,
    });
    assert.equal(avisoCombo.includes("SINERGIA ELEMENTAL (Corrosive)"), true);

    state.currentLang = "en";
    const avisoComboEn = buildAppraisalWarningsHtml({
      appraisal: { comboName: "Corrosive" }, desirabilityMultiplier: 0.6, stats: [], priceCalculated: 200, isEs: false,
    });
    assert.equal(avisoComboEn.includes("ELEMENTAL SYNERGY (Corrosive)"), true);

    const avisoSinNeg = buildAppraisalWarningsHtml({
      appraisal: {}, desirabilityMultiplier: 0.3, stats: [{ value: 50 }], priceCalculated: 200, isEs: true,
    });
    assert.equal(avisoSinNeg.includes("Sin negativa: stats más débiles"), true);

    const avisoConNeg = buildAppraisalWarningsHtml({
      appraisal: {}, desirabilityMultiplier: 0.3, stats: [{ value: -50 }], priceCalculated: 200, isEs: true,
    });
    assert.equal(avisoConNeg.includes("Penalización por Stats no deseados"), true);

    const avisoMeta = buildAppraisalWarningsHtml({
      appraisal: {}, desirabilityMultiplier: 0.9, stats: [], priceCalculated: 200, isEs: true,
    });
    assert.equal(avisoMeta.includes("Coincide con Stats Meta"), true);

    const avisoNeutro = buildAppraisalWarningsHtml({
      appraisal: {}, desirabilityMultiplier: 0.6, stats: [], priceCalculated: 200, isEs: true,
    });
    assert.equal(avisoNeutro, "");

    const avisoRiesgo = buildAppraisalWarningsHtml({
      appraisal: {}, desirabilityMultiplier: 0.6, stats: [], priceCalculated: 8000, isEs: true,
    });
    assert.equal(avisoRiesgo.includes("RIESGO DE PLATINO ILÍCITO / FRAUDULENTO"), true);

    const sinRiesgo = buildAppraisalWarningsHtml({
      appraisal: {}, desirabilityMultiplier: 0.6, stats: [], priceCalculated: 7999, isEs: true,
    });
    assert.equal(sinRiesgo.includes("RIESGO DE PLATINO ILÍCITO / FRAUDULENTO"), false);
  } finally {
    state.currentLang = prevLang;
  }
});

test("computeFairHigh calcula techo segun escalones de calidad del stat y respeta suelo de fair", () => {
  const bandQ = { p50: 200, p80: 300, p90: 400, p95: 500 };
  const fair = 200;

  const tNull = computeFairHigh({ suggestedMax: 600 }, bandQ, fair);
  assert.equal(tNull, 500);

  const t75 = computeFairHigh({ statScore: { score: 80 }, suggestedMax: 600 }, bandQ, fair);
  assert.equal(t75, 500);

  const t55 = computeFairHigh({ adjustedScore: 60, suggestedMax: 600 }, bandQ, fair);
  assert.equal(t55, 400);

  const t35 = computeFairHigh({ statScore: { score: 40 }, suggestedMax: 600 }, bandQ, fair);
  assert.equal(t35, 300);

  const tBajo = computeFairHigh({ statScore: { score: 20 }, suggestedMax: 600 }, bandQ, fair);
  assert.equal(tBajo, 300);

  const suelo = computeFairHigh({ suggestedMax: 50 }, { p50: 50, p80: 80, p90: 90, p95: 100 }, 250);
  assert.equal(suelo >= 250, true);
  assert.equal(suelo, 250);
});

test("htmlBanda fija style con --tas-pos cuando la posicion existe y omite style cuando devuelve null", () => {
  const htmlConPos = buildAppraisalCardHTML({
    tier: "A", tierColor: "grade-a", priceCalculated: 1000, minPrice: 100, maxPrice: 10000,
    finalScore: 70, demanda: 50, precioTipico: 1000, warningHtml: "", isEs: true,
    withSimilarButton: false, histLoading: false,
  });
  assert.equal(htmlConPos.includes('class="tas-banda-cifras" style="--tas-pos:50.0%"'), true);

  const htmlSinPos = buildAppraisalCardHTML({
    tier: "A", tierColor: "grade-a", priceCalculated: 1000, minPrice: 0, maxPrice: 10000,
    finalScore: 70, demanda: 50, precioTipico: 1000, warningHtml: "", isEs: true,
    withSimilarButton: false, histLoading: false,
  });
  assert.equal(htmlSinPos.includes('class="tas-banda-cifras"'), true);
  assert.equal(htmlSinPos.includes('class="tas-banda-cifras" style='), false);
});

test("buildStatsTable no incluye virgulilla en calidad sindato pero si en otros niveles estimados", () => {
  const weaponData = { name: "ArmaEstimada", t: "Rifle", disposition: 1.0 };
  const meta = {
    name: "ArmaEstimada",
    t: "Rifle",
    _genericRecs: true,
    pos: ["Critical Chance"],
    pos_tier: { trash: ["Impact Damage"] },
  };

  const tableEs = buildStatsTable(
    [
      { name: "Range", value: 50, projected: 50 },
      { name: "Critical Chance", value: 100, projected: 100 },
      { name: "Impact Damage", value: 50, projected: 50 },
    ],
    weaponData, 2, false, true, { meta, weaponName: "ArmaEstimada" }
  );

  const rowSinDatoEs = tableEs.children[0];
  assert.equal(rowSinDatoEs.innerHTML.includes('<span class="tas-calidad">SIN DATOS</span>'), true);
  assert.equal(rowSinDatoEs.innerHTML.includes("~SIN DATOS"), false);

  const rowTopEs = tableEs.children[1];
  assert.equal(rowTopEs.innerHTML.includes('<span class="tas-calidad">~TOP</span>'), true);

  const rowFlojoEs = tableEs.children[2];
  assert.equal(rowFlojoEs.innerHTML.includes('<span class="tas-calidad">~FLOJO</span>'), true);

  const tableEn = buildStatsTable(
    [
      { name: "Range", value: 50, projected: 50 },
      { name: "Critical Chance", value: 100, projected: 100 },
      { name: "Impact Damage", value: 50, projected: 50 },
    ],
    weaponData, 2, false, false, { meta, weaponName: "ArmaEstimada" }
  );

  const rowSinDatoEn = tableEn.children[0];
  assert.equal(rowSinDatoEn.innerHTML.includes('<span class="tas-calidad">NO DATA</span>'), true);
  assert.equal(rowSinDatoEn.innerHTML.includes("~NO DATA"), false);

  const rowTopEn = tableEn.children[1];
  assert.equal(rowTopEn.innerHTML.includes('<span class="tas-calidad">~TOP</span>'), true);

  const rowWeakEn = tableEn.children[2];
  assert.equal(rowWeakEn.innerHTML.includes('<span class="tas-calidad">~WEAK</span>'), true);
});

test("buildStatsTable atenua negativa inofensiva en rango y retira atenuado asignando nivel fuera cuando excede limites", () => {
  const weaponData = { name: "Torid", t: "Rifle", disposition: 1.0 };
  const rango = getRivenStatRange(weaponData, "Zoom", true, 2, true);
  const minVal = Math.min(Math.abs(rango.min), Math.abs(rango.max));
  const meta = { neg: ["Zoom"] };

  const tableEnRango = buildStatsTable(
    [{ name: "Zoom", value: -minVal, projected: -minVal }],
    weaponData, 2, true, true, { meta, weaponName: "Torid" }
  );
  const rowEnRango = tableEnRango.children[0];
  assert.equal(rowEnRango.classList.contains("tas-atenuado"), true);
  assert.equal(rowEnRango.classList.contains("tas-nivel-fuera"), false);

  const tableFuera = buildStatsTable(
    [{ name: "Zoom", value: -minVal, projected: -9999 }],
    weaponData, 2, true, true, { meta, weaponName: "Torid" }
  );
  const rowFuera = tableFuera.children[0];
  assert.equal(rowFuera.classList.contains("tas-atenuado"), false);
  assert.equal(rowFuera.classList.contains("tas-nivel-fuera"), true);
});

test("parchearTasacion rellena los ganchos de la tarjeta real de buildAppraisalCardHTML", async () => {
  const weaponData = { name: "Torid", t: "Rifle", disposition: 1.4 };
  const meta = {
    name: "Torid",
    official_median: 357,
    wfm_avg: 7966,
    de_rerolled: { median: 450, pop: 12, stddev: 300, max_price: 3000 },
    de_unrolled: { median: 357, pop: 8 },
  };
  const stats = [
    { name: "Critical Chance", value: 120, isPositive: true, minIdeal: 50, maxIdeal: 150 },
    { name: "Critical Damage", value: 120, isPositive: true, minIdeal: 50, maxIdeal: 150 },
    { name: "Zoom", value: 30, isPositive: false, minIdeal: 20, maxIdeal: 60 },
  ];
  const tiers = calculateHybridTiers(meta, null);
  const appraisal = calculateAdvancedPredictivePrice(meta, stats, tiers, 1.0, weaponData, null);

  const html = buildAppraisalCardHTML({
    tier: appraisal.tier || "B",
    tierColor: appraisal.tierColor || "grade-b",
    priceCalculated: appraisal.estimatedValue || 0,
    minPrice: appraisal.suggestedMin || 0,
    maxPrice: appraisal.suggestedMax || 0,
    finalScore: appraisal.adjustedScore || 0,
    demanda: null,
    precioTipico: null,
    warningHtml: "",
    isEs: true,
    withSimilarButton: false,
    histLoading: false,
  });

  const estCard = montarTarjeta(html);

  assert.equal(estCard.querySelector("[data-fair-price]").textContent, "…");
  assert.notEqual(estCard.querySelector("[data-ml-line]"), null);
  assert.notEqual(estCard.querySelector("[data-fair-range]"), null);
  assert.notEqual(estCard.querySelector("[data-stat-score] b"), null);
  assert.notEqual(estCard.querySelector("[data-roll-score] b"), null);

  await parchearTasacion({
    estCard,
    appraisal,
    weaponName: "Torid",
    weaponData,
    meta,
    basePrice: 357,
    precioTipico: null,
    itemAttributes: stats,
    isEs: true,
    conComparables: false,
  });

  assert.equal(estCard.querySelector("[data-fair-price]").textContent.startsWith("~"), true);
  assert.equal(estCard.querySelector("[data-fair-price]").getAttribute("data-sin-cifra"), null);
  assert.notEqual(estCard.querySelector("[data-fair-range]").innerHTML, "");
  assert.equal(estCard.querySelector("[data-ml-line]").innerHTML.includes("tas-pips"), true);
  assert.equal(estCard.querySelector("[data-ml-line]").innerHTML.includes("Calculando confianza"), false);
  assert.equal(estCard.querySelector("[data-ml-line]").innerHTML.includes("Confianza no disponible"), false);
  assert.equal(/\d+%/.test(estCard.querySelector("[data-stat-score] b").innerHTML), true);
  assert.equal(/\d+%/.test(estCard.querySelector("[data-roll-score] b").innerHTML), true);
});
