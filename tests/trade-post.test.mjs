// Mesa del TRADING POST (utils/vision/trade_post.js): dónde cae cada casilla y qué hay en ella.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { casillaTradeo, arcanoDelRotulo, leeCasillaTradeo, leeDialogoTradeo, dialogoTradeo, esTradeoHecho } from "../deploy/js/utils/vision/trade_post.js";

const TRADABLES = {
  arcane_velocity: ["Arcane Velocity", "Velocidad Arcana", 5],
  arcane_energize: ["Arcane Energize", "Energizar Arcano", 5],
  arcane_grace: ["Arcane Grace", "Gracia Arcana", 5],
  primary_merciless: ["Primary Merciless", "Principal Despiadado", 5],
};
const cerca = (a, b) => Math.abs(a - b) < 0.003;

describe("geometría", () => {
  // Bordes medidos en un fotograma del vídeo a pantalla completa: casillas de 292 px a paso de 339.
  test("a 2560×1440 las casillas caen donde se midieron", () => {
    const px = (r) => [r.x * 2560, r.y * 1440, r.w * 2560, r.h * 1440].map(Math.round);
    const iguales = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 2);
    assert.ok(iguales(px(casillaTradeo("doy", 0, 2560, 1440).casilla), [287, 278, 292, 292]));
    assert.ok(iguales(px(casillaTradeo("doy", 5, 2560, 1440).casilla), [1983, 278, 292, 292]));
    assert.ok(iguales(px(casillaTradeo("recibo", 2, 2560, 1440).casilla), [966, 899, 292, 292]));
  });

  test("con otra proporción el panel escala con el alto alrededor del centro", () => {
    const desdeCentro = (W, H) => (casillaTradeo("doy", 0, W, H).casilla.x - 0.5) * (W / H);
    assert.ok(cerca(desdeCentro(1920, 1200), desdeCentro(2560, 1440)));
    assert.ok(cerca(casillaTradeo("doy", 0, 1920, 1200).casilla.y, casillaTradeo("doy", 0, 2560, 1440).casilla.y));
  });
});

describe("arcanos", () => {
  test("reconoce el rótulo aunque debajo venga la línea de rombos del rango", () => {
    assert.deepEqual(arcanoDelRotulo("Arcane Velocity\nCOZ ORORORO", TRADABLES), { slug: "arcane_velocity", name: "Arcane Velocity", maxRank: 5 });
    assert.equal(arcanoDelRotulo("Arcane Veloclty", TRADABLES)?.slug, "arcane_velocity", "una letra mal leída");
    assert.equal(arcanoDelRotulo("Velocidad Arcana", TRADABLES)?.slug, "arcane_velocity", "cliente en español");
  });

  test("ruido de una casilla o nombres que no son arcanos, null", () => {
    assert.equal(arcanoDelRotulo("Ce ee\nHi oe Susie edhe", TRADABLES), null);
    assert.equal(arcanoDelRotulo("Braton Prime Barrel", TRADABLES), null);
    assert.equal(arcanoDelRotulo("", TRADABLES), null);
  });
});

describe("casilla", () => {
  const matchPrime = (t) => (/BRATON PRIME BARREL/.test(t) ? { isPrime: true, originalName: "Braton Prime Barrel" } : null);

  test("arcano, pieza prime con cantidad y platino", () => {
    assert.deepEqual(leeCasillaTradeo("Arcane Grace\n◇◇◇", { tradables: TRADABLES, matchPrime }), { tipo: "arcano", slug: "arcane_grace", name: "Arcane Grace", maxRank: 5, qty: 1 });
    assert.deepEqual(leeCasillaTradeo("2 X Braton Prime Barrel", { tradables: TRADABLES, matchPrime }), { tipo: "prime", name: "Braton Prime Barrel", qty: 2 });
    assert.deepEqual(leeCasillaTradeo("Platinum\n150", { tradables: TRADABLES, matchPrime }), { tipo: "platino", name: "Platinum", qty: 150 });
  });

  test("lo que no es prime ni arcano no entra", () => {
    assert.equal(leeCasillaTradeo("Serration", { tradables: TRADABLES, matchPrime }), null);
    assert.equal(leeCasillaTradeo("", { tradables: TRADABLES, matchPrime }), null);
  });
});

// OCR real de las confirmaciones del usuario (Tesseract psm 6 sobre el recorte del diálogo).
describe("diálogo de confirmación", () => {
  const matchPrime = (t) => {
    const m = /(KHORA|HYDROID) PRIME (SYSTEMS |NEUROPTICS |CHASSIS )?BLUEPRINT/.exec(t.toUpperCase());
    return m ? { isPrime: true, originalName: m[0].toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) } : null;
  };
  const lee = (texto) => leeDialogoTradeo(texto, { tradables: TRADABLES, matchPrime });

  test("un set entero y el platino", () => {
    const r = lee("Are you sure you want to accept this trade? You are\noffering:\nKhora Prime Blueprint\nKhora Prime Systems Blueprint\nKhora Prime Neuroptics Blueprint\nKhora Prime Chassis Blueprint\nand will receive from Malcontents753 8m the following:\nPlatinum x 80\nb\nOK (0) CANCEL");
    assert.deepEqual(r.doy.map((i) => i.name), ["Khora Prime Blueprint", "Khora Prime Systems Blueprint", "Khora Prime Neuroptics Blueprint", "Khora Prime Chassis Blueprint"]);
    assert.deepEqual(r.recibo, [{ tipo: "platino", name: "Platinum", qty: 80 }], "la \"b\" del cursor no es un ítem");
  });

  test("el \"the following\" partido en dos líneas y lo que no es prime ni arcano", () => {
    assert.deepEqual(lee("Are you sure you want to accept this trade? You are\noffering:\nArcane Ice Storm ©© © © ©\nand will receive from NamelessKing102% the\nfollowing:\nPlatinum x 95\n» CANCEL").recibo[0].qty, 95);
    const r = lee("Are you sure you want to accept this trade? You are\noffering:\nArcane Velocity ©© ©\nAyatan Sah Sculpture\nT Ayatan Piv Sculpture I\nand will receive from SpectaclesYang && the following:\nPlatinum x 165\nOK @ CANCEL");
    assert.deepEqual(r.doy.map(({ tipo, name }) => `${tipo}:${name}`), ["arcano:Arcane Velocity", "otro:Ayatan Sah Sculpture", "otro:Ayatan Piv Sculpture"]);
  });

  test("el diálogo de éxito se reconoce aparte", () => {
    assert.equal(esTradeoHecho("The trade was successful!\nOK"), true);
    assert.equal(esTradeoHecho("Are you sure you want to accept this trade?"), false);
  });

  test("otro diálogo (el de éxito) o texto suelto, null", () => {
    assert.equal(lee("The trade was successful!\nOK"), null);
    assert.equal(lee(""), null);
  });

  test("el recorte va centrado y escala con el alto", () => {
    const d = dialogoTradeo(2517, 1425);
    assert.ok(Math.abs(d.x + d.w / 2 - 0.5) < 1e-9);
    assert.ok(d.x < 0.342 && d.x + d.w > 0.658, "cubre el diálogo medido (0,342-0,658)");
  });
});
