import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installFakeDocument, FakeCanvas } from "./_helpers/fake-canvas.mjs";
import { decodePng } from "./_helpers/png.mjs";

installFakeDocument();
const { OCRService } = await import("../deploy/js/services/scanner/ocr.service.js");
const { emparejaArcano, filaArcano, esContextoArcanos, tirasDeNombreArcano, rejillaArcanos, paginaArcanosBasura } = await import("../deploy/js/utils/inventory/arcanos_disolucion.js");
const { firmaTexto, mismoTexto } = await import("../deploy/js/utils/vision/frame_hash.js");

test("esContextoArcanos", () => {
  assert.equal(esContextoArcanos("ARCANE_DISSOLUTION"), true);
  assert.equal(esContextoArcanos("INVENTORY_ARCANES"), true);
  assert.equal(esContextoArcanos("INVENTORY"), false);
  assert.equal(esContextoArcanos(undefined), false);
});

const tradables = {
  "arcane_camisado": ["Arcane Camisado", "Camisado Arcano", 5],
  "arcane_concentration": ["Arcane Concentration", "Concentración Arcana", 5],
  "arcane_consequence": ["Arcane Consequence", "Consecuencia Arcana", 5],
  "akimbo_slip_shot": ["Akimbo Slip Shot", "Akimbo Slip Shot", 5]
};

const similitud = (a, b) => OCRService.similarityOCR(a, b);

test("emparejaArcano: OCR cases", () => {
  assert.equal(emparejaArcano("Arcane Camisado", tradables, similitud)?.slug, "arcane_camisado");
  assert.equal(emparejaArcano("Arcane\nConcentration", tradables, similitud)?.slug, "arcane_concentration");
  assert.equal(emparejaArcano("Arcane Consequenc", tradables, similitud)?.slug, "arcane_consequence");
  assert.equal(emparejaArcano("Arcane Concentration", tradables, similitud)?.slug, "arcane_concentration");
  assert.equal(emparejaArcano("ee 4 ,,", tradables, similitud), null);
});

test("filaArcano: rangosMax calculation", () => {
  const meta5 = { maxRank: 5 };
  assert.equal(filaArcano({ slug: "a", name: "A", qty: 143 }, meta5, null).rangosMax, 6);

  const meta3 = { maxRank: 3 };
  assert.equal(filaArcano({ slug: "b", name: "B", qty: 143 }, meta3, null).rangosMax, 14);
});

test("veredictoArcano: 5 ramas de acción", async () => {
  const { veredictoArcano } = await import("../deploy/js/utils/inventory/arcanos_disolucion.js");
  const t = { vosfor: { verdictSell: "Vender", verdictSellR0: "Vender R0", verdictDissolve: "Disolver", verdictEven: "Conservar" } };

  assert.deepEqual(veredictoArcano({ accion: "sell_max", maxRank: 5 }, t), { texto: "Vender R5", tono: "verde" });
  assert.deepEqual(veredictoArcano({ accion: "sell_r0", maxRank: 5 }, t), { texto: "Vender R0", tono: "verde" });
  assert.deepEqual(veredictoArcano({ accion: "dissolve", maxRank: 5 }, t), { texto: "Disolver", tono: "cian" });
  assert.deepEqual(veredictoArcano({ accion: "even", maxRank: 5 }, t), { texto: "Conservar", tono: "gris" });
  assert.deepEqual(veredictoArcano({ accion: "pending", maxRank: 5 }, t), { texto: "…", tono: "gris" });
});

test("la firma de las tiras de nombre no ve la animación de los arcanos y sí el scroll o un nombre nuevo", () => {
  const img = decodePng(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "_fixtures/inventory_arcanes_1920x1080.png")));
  const rejilla = { gridX: 70, gridY: 182, cellW: 207, cellH: 222, cols: 6, rows: 4 };
  const lienzo = (cambia) => {
    const data = new Uint8ClampedArray(img.data);
    cambia?.(data);
    const cvs = new FakeCanvas(img.width, img.height);
    cvs.getContext("2d").putImageData({ width: img.width, height: img.height, data }, 0, 0);
    return cvs;
  };
  const pinta = (data, x0, x1, y0, y1, f) => {
    for (let y = y0; y < Math.min(y1, img.height); y++) for (let x = x0; x < x1; x++) f(data, (y * img.width + x) * 4);
  };
  const tiras = tirasDeNombreArcano(rejilla, { x: 0, y: 0 }, img.width, img.height);
  assert.equal(tiras.length, 4);
  const firma = (cvs) => firmaTexto(cvs, tiras);
  const base = firma(lienzo());

  const animado = lienzo((d) => {
    for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) {
      pinta(d, 70 + Math.round((c + 0.2) * 207), 70 + Math.round((c + 0.8) * 207), 182 + Math.round((r + 0.17) * 222), 182 + Math.round((r + 0.67) * 222),
        (px, i) => { if (px[i + 2] > 120) for (let k = 0; k < 3; k++) px[i + k] = Math.min(255, px[i + k] + 70); });
    }
  });
  assert.equal(mismoTexto(base, firma(animado)), true);
  assert.equal(mismoTexto(base, firma(lienzo((d) => d.copyWithin(0, 60 * img.width * 4)))), false);
  assert.equal(mismoTexto(base, firma(lienzo((d) => pinta(d, 290, 470, 340, 366, (px, i) => { px[i] = px[i + 1] = 22; px[i + 2] = 30; })))), false);
});

test("rejillaArcanos respeta la posición en la página, recorta filas vacías y sin posición va en orden", () => {
  assert.deepEqual(rejillaArcanos([]), { cols: 0, celdas: [] });
  const a = { name: "A", r: 1, c: 0 }, b = { name: "B", r: 2, c: 3 };
  const { cols, celdas } = rejillaArcanos([b, a]);
  assert.equal(cols, 4);
  assert.deepEqual(celdas.map((f) => f?.name ?? null), ["A", null, null, null, null, null, null, "B"]);
  const sinSitio = rejillaArcanos([{ name: "X" }, { name: "Y" }, { name: "Z" }], 2);
  assert.equal(sinSitio.cols, 2);
  assert.deepEqual(sinSitio.celdas.map((f) => f?.name ?? null), ["X", "Y", "Z", null]);
});

test("filaArcano lleva la posición y los precios de R0 y rango máximo del veredicto", () => {
  const meta = { maxRank: 5, fusionLimit: 5 };
  const f = filaArcano({ slug: "a", name: "A", qty: 30, r: 2, c: 4 }, meta, { bestAction: "sell_max", sell: 3.5, sellR5: 90 });
  assert.deepEqual([f.r, f.c, f.precioR0, f.precioMax, f.accion], [2, 4, 3.5, 90, "sell_max"]);
  assert.deepEqual([filaArcano({ name: "B", qty: 1 }, meta, null).precioR0, filaArcano({ name: "B", qty: 1 }, meta, null).accion], [null, "pending"]);
});

test("lineasArcano: nombre sin el prefijo Arcane y el veredicto justo debajo", async () => {
  const { lineasArcano } = await import("../deploy/js/utils/inventory/arcanos_disolucion.js");
  const t = { vosfor: { verdictSell: "Vender", verdictSellR0: "Vender R0", verdictDissolve: "Disolver", verdictEven: "Conservar" } };
  const l = lineasArcano({ name: "Arcane Grace", qty: 21, maxRank: 5, rangosMax: 1, accion: "sell_max", precioR0: 4.5, precioMax: 120 }, t);
  assert.equal(l[0].texto, "Grace");
  assert.deepEqual(l[1], { texto: "Vender R5", tono: "verde" });
  assert.equal(l.length, 5);
});

test("paginaArcanosBasura: solo con rejilla recién anclada por color, lote, al menos 3 celdas con texto y menos de la mitad casando", () => {
  const reconoce = (ws) => ws[0] === "ARCANE";
  const lote = (...filas) => new Map(filas.map((ws, i) => [`r0c${i}`, ws]));
  const base = { modoArcanos: true, reciennacida: true, calib: { colorAnchored: true }, reconoce };
  const basura = lote(["ARCANE", "GRACE"], ["ZZ"], ["QQ"], ["XX"]);

  assert.equal(paginaArcanosBasura({ ...base, lote: basura }), true);
  assert.equal(paginaArcanosBasura({ ...base, modoArcanos: false, lote: basura }), false);
  assert.equal(paginaArcanosBasura({ ...base, reciennacida: false, lote: basura }), false);
  assert.equal(paginaArcanosBasura({ ...base, calib: {}, lote: basura }), false);
  assert.equal(paginaArcanosBasura({ ...base, calib: null, lote: basura }), false);
  assert.equal(paginaArcanosBasura({ ...base, lote: null }), false);
  assert.equal(paginaArcanosBasura({ ...base, lote: lote(["ZZ"], ["QQ"]) }), false);
  assert.equal(paginaArcanosBasura({ ...base, lote: lote(["ARCANE", "A"], ["ARCANE", "B"], ["ZZ"], ["QQ"]) }), false);
  assert.equal(paginaArcanosBasura({ ...base, lote: lote(["ARCANE", "A"], null, ["ZZ"], null, ["QQ"], null, ["XX"]) }), true);
});
