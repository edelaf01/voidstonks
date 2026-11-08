import test from "node:test";
import assert from "node:assert/strict";
import { createMockElement, createMockEstCard } from "./_helpers/riven-tasacion-dom.mjs";

const {
  renderMlChip,
  renderMarketChip,
} = await import("../deploy/js/ui.components/rivens/ui_riven_appraisal.js");

test("renderMlChip asigna pips y textos de confianza segun error mape", () => {
  const { estCard, ml } = createMockEstCard();
  const band = { confianza: "alta", fuente: "de10" };

  renderMlChip(estCard, { mape: 20 }, band, true);
  const pipsAlta = (ml.innerHTML.match(/tas-pip lleno/g) || []).length;
  assert.equal(pipsAlta, 3);
  assert.equal(ml.innerHTML.includes("Confianza alta"), true);
  assert.equal(ml.innerHTML.includes("±20%"), true);

  renderMlChip(estCard, { mape: 50 }, band, true);
  const pipsMedia = (ml.innerHTML.match(/tas-pip lleno/g) || []).length;
  assert.equal(pipsMedia, 2);
  assert.equal(ml.innerHTML.includes("Confianza media"), true);

  renderMlChip(estCard, { mape: 90 }, band, true);
  const pipsBaja = (ml.innerHTML.match(/tas-pip lleno/g) || []).length;
  assert.equal(pipsBaja, 1);
  assert.equal(ml.innerHTML.includes("Confianza baja"), true);

  renderMlChip(estCard, null, band, true);
  const pipsNula = (ml.innerHTML.match(/tas-pip lleno/g) || []).length;
  assert.equal(pipsNula, 0);
  assert.equal(ml.innerHTML.includes("Sin historial suficiente"), true);
});

test("renderMlChip renderiza avisos de muestra y soporta elementos sin setAttribute", () => {
  const { estCard, ml } = createMockEstCard();

  renderMlChip(estCard, { mape: 20 }, { confianza: "alta", aviso: "trash", fuente: "de10" }, true);
  assert.equal(ml.innerHTML.includes("Roll de gama baja: precio orientativo"), true);
  assert.equal(ml.getAttribute("data-tooltip").includes("Roll de gama baja"), true);

  renderMlChip(estCard, { mape: 20 }, { confianza: "alta", aviso: "trash", fuente: "de10" }, false);
  assert.equal(ml.innerHTML.includes("Low-end roll: ballpark price"), true);

  renderMlChip(estCard, { mape: 20 }, { confianza: "alta", aviso: "pocosDatos", fuente: "de10" }, true);
  assert.equal(ml.innerHTML.includes("Pocos datos del arma"), true);

  renderMlChip(estCard, { mape: 20 }, { confianza: "alta", aviso: "pocosDatos", fuente: "de10" }, false);
  assert.equal(ml.innerHTML.includes("Little data for this weapon"), true);

  ml.setAttribute = undefined;
  renderMlChip(estCard, { mape: 20 }, { confianza: "alta", fuente: "de10" }, true);
  assert.equal(ml.innerHTML.includes("Confianza"), true);

  const cardVacia = createMockElement("div");
  renderMlChip(cardVacia, { mape: 20 }, { confianza: "alta", fuente: "de10" }, true);
  assert.equal(cardVacia.children.length, 0);
});

test("renderMarketChip formatea volumen ratio de sobreprecio y consejos en chip de mercado", () => {
  const { estCard, mk } = createMockEstCard();

  renderMarketChip(estCard, null, true);
  assert.equal(mk.innerHTML, "");

  const datosCompletos = {
    flag: "meta",
    label: "Mercado activo",
    vol: 15,
    refFiable: true,
    ratio: 2.5,
    advice: "Venta rapida recomendada",
  };
  renderMarketChip(estCard, datosCompletos, true);
  assert.equal(mk.style.display, "inline-flex");
  assert.equal(mk.innerHTML.includes("15 anuncios/día"), true);
  assert.equal(mk.innerHTML.includes("piden 2.5× lo que se paga"), true);
  assert.equal(mk.dataset.tooltip, "Venta rapida recomendada");

  const datosSinVol = {
    flag: "meta",
    label: "Mercado activo",
    refFiable: true,
  };
  renderMarketChip(estCard, datosSinVol, true);
  assert.equal(mk.style.display, "inline-flex");
  assert.equal(mk.innerHTML.includes("anuncios/día"), false);

  const datosRatioBajo = {
    flag: "meta",
    label: "Mercado activo",
    vol: 15,
    refFiable: true,
    ratio: 1.5,
    advice: "Mercado normal",
  };
  renderMarketChip(estCard, datosRatioBajo, true);
  assert.equal(mk.innerHTML.includes("15 anuncios/día"), true);
  assert.equal(mk.innerHTML.includes("piden"), false);

  const coloresPorFlag = {
    meta: "#4ade80",
    bubble: "#f87171",
    illiquid: "#60a5fa",
    mid: "#cbd5e1",
    nodata: "#9ca3af",
  };
  for (const [flag, colorEsperado] of Object.entries(coloresPorFlag)) {
    const { estCard: card, mk: chip } = createMockEstCard();
    renderMarketChip(card, { flag, label: flag }, true);
    assert.equal(chip.style.color, colorEsperado);
  }

  const datosDesconocidos = {
    flag: "inexistente",
    label: "Sin flag",
    advice: "Default color",
  };
  renderMarketChip(estCard, datosDesconocidos, true);
  assert.equal(mk.style.color, "#cbd5e1");
});

test("renderMlChip con aviso trash y confianza baja clasifica por mape y siempre muestra el aviso y la alerta en EN y ES", () => {
  const bandQ = { aviso: "trash", confianza: "baja", fuente: "de10" };

  const { estCard: cardEs42, ml: mlEs42 } = createMockEstCard();
  renderMlChip(cardEs42, { mape: 42 }, bandQ, true);
  assert.equal(mlEs42.innerHTML.includes("Confianza media"), true);
  assert.equal((mlEs42.innerHTML.match(/tas-pip lleno/g) || []).length, 2);
  assert.equal(mlEs42.innerHTML.includes("tas-aviso"), true);
  assert.equal(mlEs42.innerHTML.includes("Roll de gama baja"), true);
  assert.equal(mlEs42.innerHTML.includes('<b class="tas-alerta">!</b>'), true);
  assert.equal(mlEs42.getAttribute("data-tooltip").includes("Roll de gama baja"), true);

  const { estCard: cardEn42, ml: mlEn42 } = createMockEstCard();
  renderMlChip(cardEn42, { mape: 42 }, bandQ, false);
  assert.equal(mlEn42.innerHTML.includes("Medium confidence"), true);
  assert.equal((mlEn42.innerHTML.match(/tas-pip lleno/g) || []).length, 2);
  assert.equal(mlEn42.innerHTML.includes("tas-aviso"), true);
  assert.equal(mlEn42.innerHTML.includes("Low-end roll"), true);
  assert.equal(mlEn42.innerHTML.includes('<b class="tas-alerta">!</b>'), true);
  assert.equal(mlEn42.getAttribute("data-tooltip").includes("Low-end roll"), true);

  const { estCard: cardEs90, ml: mlEs90 } = createMockEstCard();
  renderMlChip(cardEs90, { mape: 90 }, bandQ, true);
  assert.equal(mlEs90.innerHTML.includes("Confianza baja"), true);
  assert.equal((mlEs90.innerHTML.match(/tas-pip lleno/g) || []).length, 1);
  assert.equal(mlEs90.innerHTML.includes("tas-aviso"), true);

  const { estCard: cardEsNull, ml: mlEsNull } = createMockEstCard();
  renderMlChip(cardEsNull, null, bandQ, true);
  assert.equal(mlEsNull.innerHTML.includes("Confianza baja"), true);
  assert.equal((mlEsNull.innerHTML.match(/tas-pip lleno/g) || []).length, 1);
  assert.equal(mlEsNull.innerHTML.includes("tas-alerta"), true);
  assert.equal(mlEsNull.innerHTML.includes("±"), false);

  const { estCard: cardEnNull, ml: mlEnNull } = createMockEstCard();
  renderMlChip(cardEnNull, null, bandQ, false);
  assert.equal(mlEnNull.innerHTML.includes("Low confidence"), true);
  assert.equal((mlEnNull.innerHTML.match(/tas-pip lleno/g) || []).length, 1);
  assert.equal(mlEnNull.innerHTML.includes("tas-alerta"), true);
  assert.equal(mlEnNull.innerHTML.includes("±"), false);
});

test("renderMarketChip formatea tramo secundario de extras con opacidad y lo omite si no hay extras", () => {
  const { estCard: cardCon, mk: chipCon } = createMockEstCard();
  const mkCon = {
    flag: "meta",
    label: "Mercado activo",
    vol: 12,
  };
  renderMarketChip(cardCon, mkCon, true);
  assert.equal(chipCon.innerHTML.includes('style="opacity:.85;"'), true);
  assert.equal(chipCon.innerHTML.includes("12 anuncios/día"), true);

  const { estCard: cardSin, mk: chipSin } = createMockEstCard();
  const mkSin = {
    flag: "meta",
    label: "Mercado activo",
  };
  renderMarketChip(cardSin, mkSin, true);
  assert.equal(chipSin.innerHTML.includes("opacity"), false);
  assert.equal(chipSin.innerHTML.includes("<b>Mercado activo</b>"), true);
});

test("renderMlChip con mape bajo y banda de confianza baja muestra confianza alta con alerta", () => {
  const prec = { mape: 20 };

  const { estCard: card1, ml: ml1 } = createMockEstCard();
  renderMlChip(card1, prec, { confianza: "baja", fuente: "de10" }, true);
  assert.equal(ml1.innerHTML.includes("Confianza alta"), true);
  assert.equal(ml1.innerHTML.includes("Confianza baja"), false);
  assert.equal(ml1.innerHTML.includes("tas-alerta"), true);

  const { estCard: card2, ml: ml2 } = createMockEstCard();
  renderMlChip(card2, prec, { confianza: "baja", fuente: "de10" }, false);
  assert.equal(ml2.innerHTML.includes("High confidence"), true);
  assert.equal(ml2.innerHTML.includes("tas-alerta"), true);

  const { estCard: card3, ml: ml3 } = createMockEstCard();
  renderMlChip(card3, prec, { fuente: "de10" }, true);
  assert.equal(ml3.innerHTML.includes("Confianza alta"), true);
  assert.equal(ml3.innerHTML.includes("tas-alerta"), false);

  const { estCard: card4, ml: ml4 } = createMockEstCard();
  renderMlChip(card4, prec, { fuente: "de10" }, false);
  assert.equal(ml4.innerHTML.includes("High confidence"), true);
  assert.equal(ml4.innerHTML.includes("tas-alerta"), false);
});
