import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { decodePng } from "./_helpers/png.mjs";
import { installFakeDocument } from "./_helpers/fake-canvas.mjs";
import { makeRewardFrame } from "./_helpers/reward-frame.mjs";

// ===========================================================================
// Recorte de la pantalla de recompensas, sobre IMÁGENES: frames sintéticos con la geometría
// medida de una captura real, y —si están en la máquina— las capturas del usuario.
//
// Corre el pipeline REAL (detectRewardBand + la guarda) a través de FakeCanvas, incluido el
// downscale de detección, que es donde estaba el fallo: no basta con probar la guarda sobre
// rectángulos, porque el problema no era qué se rechazaba sino que la fila buena no llegaba
// nunca a proponerse.
// ===========================================================================

installFakeDocument();
const { detectPlausibleRewardBand } = await import("../deploy/js/utils/vision/plausibility.js");

// Mismo valor que processRewards. Si allí se cambia y aquí no, estos tests dejan de medir
// lo que corre en producción.
const DETECT_W = 720;

/** Reproduce el downscale de detección de processRewards. */
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

// ---------------------------------------------------------------------------
// Frames sintéticos: corren en cualquier máquina
// ---------------------------------------------------------------------------

// El bug que costó tres rondas de logs. Con DETECT_W=480 la fila de nombres se quedaba en ~5px
// tras el downscale y minBandH (6) la descartaba, así que la detección era CIEGA a las cards
// salvo a 1080p exactos y solo podía engancharse a texto más grueso del HUD. 1080p pasaba, que
// es justo por lo que nadie lo vio.
for (const [w, h] of [[2560, 1440], [1920, 1080], [3840, 2160], [1600, 900]]) {
  test(`${w}x${h}: encuentra la fila de recompensas, no el HUD`, () => {
    const { rect, det } = detectar(makeRewardFrame({ width: w, height: h }));

    assert.ok(rect, "la fila de cards debería detectarse a esta resolución");
    assert.equal(rect.cardCount, 4, "las cuatro cards");

    // La fila está pintada al 41 % del alto. El HUD que competía por masa (nombres de escuadra,
    // bonus, kill feed) está del 46 % para abajo: si el centro cae ahí, se cogió el HUD.
    const centro = (rect.y + rect.h / 2) / det.height;
    assert.ok(centro > 0.3 && centro < 0.5,
      `centro de la banda al ${(centro * 100).toFixed(0)}% — debería rondar el 41%`);
  });
}

test("el recorte sale a ancho completo aunque las cards ocupen media pantalla", () => {
  // En la captura real la fila ocupa el 50 % del ancho. Recortar a la caja de los nombres
  // detectados dejaba fuera las recompensas que no produjeron señal.
  const { rect, det } = detectar(makeRewardFrame());
  assert.equal(rect.x, 0);
  assert.equal(rect.w, det.width);
});

test("con una sola recompensa se cae al recorte fijo en vez de inventarse una banda", () => {
  // minCards=2: con un bloque no se distingue una recompensa suelta de la barra de título.
  // El recorte fijo cubre la card igual, así que rechazar no pierde nada.
  const { rect } = detectar(makeRewardFrame({ cards: 1 }));
  assert.equal(rect, null);
});

test("un frame sin pantalla de recompensas no produce recorte", () => {
  const vacio = makeRewardFrame({ cards: 0, hud: true });
  const { rect } = detectar(vacio);
  // Puede no detectar nada, o detectar HUD — pero si detecta algo, jamás en la mitad inferior.
  if (rect) {
    const centro = (rect.y + rect.h / 2) / Math.round(vacio.height * (DETECT_W / vacio.width));
    assert.ok(centro < 0.7, `banda del HUD inferior aceptada (centro ${(centro * 100).toFixed(0)}%)`);
  }
});

// ---------------------------------------------------------------------------
// Capturas reales del usuario: solo si están en la máquina (como inventory-captures)
// ---------------------------------------------------------------------------

const DIR = process.env.REWARD_CAPTURES_DIR
  || "/home/ppsoy/Imágenes/Capturas de pantalla/nofunciona";

const capturas = fs.existsSync(DIR)
  ? fs.readdirSync(DIR).filter((f) => f.toLowerCase().endsWith(".png")).sort()
  : [];

// Invariante que vale para CUALQUIER frame, sea o no de recompensas, así que no hace falta
// etiquetar las capturas: o no hay recorte (y se usa el fijo, que está calibrado), o el que hay
// es plausible y a ancho completo. Es la red que impide que un refactor del recorte cuele una
// geometría imposible sin que nadie se entere.
for (const f of capturas) {
  test(`captura real ${f}: o no hay recorte, o es utilizable`, () => {
    let img;
    try {
      img = decodePng(fs.readFileSync(path.join(DIR, f)));
    } catch {
      return; // PNG en un formato que el decodificador mínimo no cubre: no es fallo del recorte
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
