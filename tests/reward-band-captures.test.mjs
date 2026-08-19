import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { decodePng } from "./_helpers/png.mjs";
import { installFakeDocument } from "./_helpers/fake-canvas.mjs";
import { makeRewardFrame } from "./_helpers/reward-frame.mjs";

// reward screen crop on IMAGES: synthetic frames matching real geometry, and user captures if present
// runs the REAL pipeline (detectRewardBand + guard) through FakeCanvas, including detection downscaling
// testing only the guard on rectangles missed that the true row was never proposed in the first place

installFakeDocument();
const { detectPlausibleRewardBand } = await import("../deploy/js/utils/vision/plausibility.js");

// matches processRewards: if changed there, tests must track it to keep measuring production behavior
const DETECT_W = 720;

/** reproduces the detection downscaling of processRewards */
function detectar(img) {
  const s = DETECT_W / img.width;
  const h = Math.round(img.height * s);
  const cvs = globalThis.document.createElement("canvas");
  cvs.width = DETECT_W;
  cvs.height = h;
  cvs.getContext("2d").drawImage(img, 0, 0, DETECT_W, h);
  const det = cvs.getContext("2d").getImageData(0, 0, DETECT_W, h);
  return { rect: detectPlausibleRewardBand(det), det };
}

// at DETECT_W=480 the name row was ~5px after downscaling and minBandH (6) discarded it
// detection was BLIND to cards at all resolutions except 1080p, latching onto thicker HUD text instead
for (const [w, h] of [[2560, 1440], [1920, 1080], [3840, 2160], [1600, 900]]) {
  test(`${w}x${h}: encuentra la fila de recompensas, no el HUD`, () => {
    const { rect, det } = detectar(makeRewardFrame({ width: w, height: h }));

    assert.ok(rect, "la fila de cards debería detectarse a esta resolución");
    assert.equal(rect.cardCount, 4, "las cuatro cards");

    // cards row sits at 41% height: competing HUD elements (squad names, bonuses, kill feed) sit at 46% and
    // below, so a centre there picked the HUD
    const centro = (rect.y + rect.h / 2) / det.height;
    assert.ok(centro > 0.3 && centro < 0.5,
      `centro de la banda al ${(centro * 100).toFixed(0)}% — debería rondar el 41%`);
  });
}

test("el recorte sale a ancho completo aunque las cards ocupen media pantalla", () => {
  // card row spans 50% width in real captures: cropping to the detected name box excluded rewards with weak
  // signal
  const { rect, det } = detectar(makeRewardFrame());
  assert.equal(rect.x, 0);
  assert.equal(rect.w, det.width);
});

test("con una sola recompensa se cae al recorte fijo en vez de inventarse una banda", () => {
  // minCards=2: a single block cannot be distinguished from the title bar, and the fallback crop covers it
  // anyway
  const { rect } = detectar(makeRewardFrame({ cards: 1 }));
  assert.equal(rect, null);
});

test("un frame sin pantalla de recompensas no produce recorte", () => {
  const vacio = makeRewardFrame({ cards: 0, hud: true });
  const { rect } = detectar(vacio);
  // may detect nothing or detect HUD, but never in the bottom half
  if (rect) {
    const centro = (rect.y + rect.h / 2) / Math.round(vacio.height * (DETECT_W / vacio.width));
    assert.ok(centro < 0.7, `banda del HUD inferior aceptada (centro ${(centro * 100).toFixed(0)}%)`);
  }
});

const DIR = process.env.REWARD_CAPTURES_DIR
  || "/home/ppsoy/Imágenes/Capturas de pantalla/nofunciona";

const capturas = fs.existsSync(DIR)
  ? fs.readdirSync(DIR).filter((f) => f.toLowerCase().endsWith(".png")).sort()
  : [];

// invariant for ANY frame: either no crop (falling back to calibrated default) or a plausible full-width
// crop
// catches refactors introducing impossible geometry on unlabeled captures
for (const f of capturas) {
  test(`captura real ${f}: o no hay recorte, o es utilizable`, () => {
    let img;
    try {
      img = decodePng(fs.readFileSync(path.join(DIR, f)));
    } catch {
      return; // PNG format unsupported by minimal decoder: not a crop failure
    }
    const { rect, det } = detectar(img);
    if (!rect) return;

    assert.equal(rect.x, 0, "recorte parcial: perdería las cards no detectadas");
    assert.equal(rect.w, det.width);
    assert.ok(rect.cardCount >= 2, "una sola mancha no es una fila de recompensas");
    assert.ok(rect.h <= det.height * 0.35, "eso es medio HUD, no una franja de nombres");
    assert.ok((rect.y + rect.h / 2) <= det.height * 0.70, "banda en la mitad inferior");
  });
}
