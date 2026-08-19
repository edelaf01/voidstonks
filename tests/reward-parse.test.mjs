import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { installFakeDocument, FakeCanvas } from "./_helpers/fake-canvas.mjs";
import { mulberry32, buildItemPool, makeRewardFrame, addTintJunk, addUIBackground, UI_BACKGROUND_WORDS, REQUIEMS } from "./_helpers/synthetic-pool.mjs";

installFakeDocument();

const { OCRService } = await import("../deploy/js/services/scanner/ocr.service.js");
const { VisionService, NAME_TEXT_COLORS } = await import("../deploy/js/services/scanner/vision.service.js");
const { state } = await import("../deploy/js/state.js");

const DB_ITEMS = [
  "Akbolto Prime Receiver", "Akbolto Prime Blueprint",
  "Paris Prime String", "Paris Prime Blueprint", "Paris Prime Grip", "Paris Prime Upper Limb",
  "Yareli Prime Chassis Blueprint", "Yareli Prime Systems Blueprint", "Yareli Prime Blueprint",
  "Nezha Prime Chassis Blueprint", "Mesa Prime Chassis Blueprint", "Ivara Prime Chassis Blueprint",
  "Forma Blueprint",
  "Ris", "Lohk", "Xata", "Vome", "Jahu", "Fass", "Netra", "Khra",
  "Quassus Prime Blueprint", "Braton Prime Receiver", "Braton Prime Barrel", "Braton Prime Blueprint",
  "Bronco Prime Receiver", "Bronco Prime Blueprint",
  "Grendel Prime Neuroptics Blueprint", "Grendel Prime Chassis Blueprint", "Grendel Prime Blueprint",
  "Gunsen Prime Blueprint", "Gunsen Prime Blade", "Gunsen Prime Handle",
  "Volt Prime Blueprint", "Volt Prime Systems Blueprint",
];

const IMG_W = 1614;
const w = (text, cx, cy) => ({ text, bbox: { x0: cx - 20, x1: cx + 20, y0: cy - 8, y1: cy + 8 } });

function parse(words, dbItems = DB_ITEMS, imageW = IMG_W) {
  state.itemsDatabase = Object.fromEntries(dbItems.map(n => [n, [{ ducats: 15 }]]));
  OCRService.cachedDbItems = [];
  OCRService.knownParts = new Set();
  OCRService.initMatcherData();
  return OCRService.parseRewards({ words, imageW });
}

const names = res => res.map(r => r.name);

describe("parseRewards: frames sintéticos multilínea", () => {

  test("4 columnas a 1 línea con owned/crafted por columna", () => {
    const res = parse([
      w("10", 640, 40), w("Owned", 700, 40),
      w("2", 885, 40), w("Owned", 940, 40),
      w("2", 1120, 40), w("Crafted", 1180, 40),
      w("Akbolto", 365, 248), w("Prime", 440, 248), w("Receiver", 515, 248),
      w("Paris", 615, 248), w("Prime", 683, 248), w("String", 750, 248),
      w("Bronco", 855, 248), w("Prime", 925, 248), w("Receiver", 995, 248),
      w("Forma", 1120, 248), w("Blueprint", 1200, 248),
    ]);
    assert.deepEqual(names(res), ["Akbolto Prime Receiver", "Paris Prime String", "Bronco Prime Receiver", "Forma Blueprint"]);
    assert.equal(res[1].owned, 10);
    assert.equal(res[3].crafted, 1);
  });

  test("nombre a 2 líneas (Yareli Prime Chassis / Blueprint) matchea con owned del badge", () => {
    const res = parse([
      w("2", 885, 40), w("Owned", 940, 40),
      w("Akbolto", 365, 248), w("Prime", 440, 248), w("Receiver", 515, 248),
      w("Paris", 615, 248), w("Prime", 683, 248), w("String", 750, 248),
      w("Yareli", 855, 240), w("Prime", 925, 240), w("Chassis", 995, 240),
      w("Blueprint", 925, 262),
      w("Forma", 1120, 248), w("Blueprint", 1200, 248),
    ]);
    assert.ok(names(res).includes("Yareli Prime Chassis Blueprint"));
    const yareli = res.find(r => r.name === "Yareli Prime Chassis Blueprint");
    assert.equal(yareli.owned, 2);
    assert.equal(res.length, 4);
  });

  test("nombre a 3 líneas (Grendel Prime / Neuroptics / Blueprint) matchea", () => {
    const res = parse([
      w("Braton", 365, 248), w("Prime", 440, 248), w("Receiver", 515, 248),
      w("Grendel", 855, 226), w("Prime", 925, 226),
      w("Neuroptics", 890, 248),
      w("Blueprint", 925, 270),
      w("Forma", 1120, 248), w("Blueprint", 1200, 248),
    ]);
    assert.deepEqual(names(res), ["Braton Prime Receiver", "Grendel Prime Neuroptics Blueprint", "Forma Blueprint"]);
  });

  test("ancla espuria de requiem (basura 'ris' del tinte) no roba la columna de Paris", () => {
    const res = parse([
      w("Akbolto", 365, 248), w("Prime", 440, 248), w("Receiver", 515, 248),
      w("Paris", 615, 248), w("Prime", 683, 248), w("String", 750, 248),
      w("RIS", 770, 300),
      w("Forma", 1120, 248), w("Blueprint", 1200, 248),
    ]);
    assert.ok(names(res).includes("Paris Prime String"));
    assert.ok(!names(res).includes("Ris"), "el requiem espurio no debe aparecer como recompensa");
  });

  test("la 2ª línea del vecino (Neuroptics a la IZQUIERDA de su ancla) no mata al main blueprint", () => {
    const res = parse([
      w("Braton", 365, 248), w("Prime", 440, 248), w("Receiver", 515, 248),
      w("Gunsen", 614, 246), w("Prime", 679, 246), w("Blueprint", 751, 248),
      w("Grendel", 899, 224), w("Prime", 965, 224),
      w("Neuroptics", 886, 248), w("Blueprint", 980, 248),
      w("Quassus", 1113, 248), w("Prime", 1180, 248), w("Blueprint", 1250, 248),
    ]);
    assert.deepEqual(names(res), [
      "Braton Prime Receiver", "Gunsen Prime Blueprint",
      "Grendel Prime Neuroptics Blueprint", "Quassus Prime Blueprint",
    ]);
  });

  test("la penalización main-BP SIGUE activa con la parte del propio nombre", () => {
    const res = parse([
      w("Volt", 855, 240), w("Prime", 925, 240), w("Systems", 995, 240),
      w("Blueprint", 925, 262),
    ]);
    assert.deepEqual(names(res), ["Volt Prime Systems Blueprint"]);
  });

  test("nombre largo en la ÚLTIMA columna (sin nextAnchor) no se amputa", () => {
    // last token sits at ~0.24W from anchor; MARGIN_RIGHT 0.26 covers it without extending to the edge
    const res = parse([
      w("Akbolto", 365, 248), w("Prime", 440, 248), w("Receiver", 515, 248),
      w("Quassus", 1220, 248), w("Prime", 1390, 248), w("Blueprint", 1600, 248),
    ]);
    assert.deepEqual(names(res), ["Akbolto Prime Receiver", "Quassus Prime Blueprint"]);
  });
});

describe("parseRewards: pool aleatoria de objetos (fisuras)", () => {
  const POOL = buildItemPool();

  function pickDistinct(rand, k) {
    const chosen = [];
    while (chosen.length < k) {
      const it = POOL[Math.floor(rand() * POOL.length)];
      if (!chosen.includes(it)) chosen.push(it);
    }
    return chosen;
  }

  test("60 frames aleatorios (2-4 recompensas, 1-3 líneas): se recuperan todas", () => {
    const rand = mulberry32(0xC0FFEE);
    for (let i = 0; i < 60; i++) {
      const k = 2 + Math.floor(rand() * 3);
      const items = pickDistinct(rand, k);
      const frame = makeRewardFrame(items, { rand, narrow: rand() < 0.5 });
      const res = parse(frame.words, POOL, frame.imageW);
      assert.deepEqual(
        res.map(r => r.name), items,
        `semilla iter ${i}: esperaba [${items}] y salió [${res.map(r => r.name)}]`,
      );
    }
  });

  test("30 frames con basura de tinte (posibles anclas espurias): sin fantasmas ni pérdidas", () => {
    const rand = mulberry32(0xBADA55);
    for (let i = 0; i < 30; i++) {
      const k = 3 + Math.floor(rand() * 2);
      // real requiems only drop alone: excluded here so any requiem appearing in output is a phantom
      const items = pickDistinct(rand, k).map(it => REQUIEMS.includes(it) ? "Forma Blueprint" : it);
      const unique = [...new Set(items)];
      const frame = addTintJunk(makeRewardFrame(unique, { rand, narrow: true }), rand, 2 + Math.floor(rand() * 3));
      const res = parse(frame.words, POOL, frame.imageW);
      const got = res.map(r => r.name);
      for (const it of unique) assert.ok(got.includes(it), `iter ${i}: perdido "${it}" en [${got}]`);
      for (const g of got) {
        assert.ok(!REQUIEMS.includes(g), `iter ${i}: requiem fantasma "${g}" colado por la basura`);
      }
    }
  });

  test("palabras de la UI de fondo no adoptan un nombre del catálogo ni roban recompensas", () => {
    const rand = mulberry32(0xF205);
    const POOL = buildItemPool();
    for (let i = 0; i < 40; i++) {
      const k = 2 + Math.floor(rand() * 3);
      const items = [];
      while (items.length < k) {
        const it = POOL[Math.floor(rand() * POOL.length)];
        if (!items.includes(it) && !REQUIEMS.includes(it)) items.push(it);
      }
      const frame = addUIBackground(makeRewardFrame(items, { rand, narrow: rand() < 0.5 }), rand, 3 + Math.floor(rand() * 4));
      const got = parse(frame.words, POOL, frame.imageW).map(r => r.name);
      assert.deepEqual(got, items, `iter ${i}: la UI de fondo alteró el resultado`);
    }
  });

  test("cada palabra de la UI de fondo, aislada, no matchea ninguna recompensa", () => {
    const POOL = buildItemPool();
    for (const w of UI_BACKGROUND_WORDS) {
      const frame = makeRewardFrame(["Akbolto Prime Receiver"], { rand: mulberry32(1) });
      frame.words.push({ text: w, bbox: { x0: 900, x1: 980, y0: 292, y1: 308 } });
      const got = parse(frame.words, POOL, frame.imageW).map(r => r.name);
      assert.deepEqual(got, ["Akbolto Prime Receiver"], `"${w}" fabricó una recompensa fantasma`);
    }
  });

  test("badges owned/crafted se atribuyen a su columna", () => {
    const rand = mulberry32(0xFEED);
    const items = ["Akbolto Prime Receiver", "Paris Prime String", "Yareli Prime Chassis Blueprint", "Forma Blueprint"];
    const frame = makeRewardFrame(items, {
      rand,
      badges: [null, { owned: 10 }, { owned: 2 }, { crafted: true }],
    });
    const res = parse(frame.words, POOL, frame.imageW);
    assert.deepEqual(res.map(r => r.name), items);
    assert.equal(res[1].owned, 10);
    assert.equal(res[2].owned, 2);
    assert.equal(res[3].crafted, 1);
  });
});

const FRAME_W = 400, FRAME_H = 200;

function makeFrame(bg, textColor) {
  const data = new Uint8ClampedArray(FRAME_W * FRAME_H * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = bg[0]; data[i + 1] = bg[1]; data[i + 2] = bg[2]; data[i + 3] = 255;
  }
  for (let y = 55; y < 70; y++) {
    for (let x = 40; x < 360; x += 40) {
      for (const xx of [x, x + 1]) {
        const o = (y * FRAME_W + xx) * 4;
        data[o] = textColor[0]; data[o + 1] = textColor[1]; data[o + 2] = textColor[2];
      }
    }
  }
  return { width: FRAME_W, height: FRAME_H, data };
}

function maskStats(cvs) {
  const ctx = cvs.getContext("2d");
  const d = ctx.getImageData(0, 0, cvs.width, cvs.height).data;
  let black = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] === 0) black++;
  return { black, total: d.length / 4 };
}

describe("prepareRewardNamesCanvas: escalera de máscaras y gate", () => {

  test("fondo oscuro + texto crema: máscara laxa aísla el texto", () => {
    const frame = makeFrame([90, 30, 30], [245, 243, 238]);
    const cvs = VisionService.prepareRewardNamesCanvas(frame, FRAME_W, FRAME_H, 1);
    assert.ok(cvs instanceof FakeCanvas, "debe devolver canvas, no null");
    const { black, total } = maskStats(cvs);
    assert.ok(black > 0, "el texto debe quedar en negro");
    assert.ok(black / total < 0.10, `máscara limpia, densidad ${black / total}`);
  });

  test("fondo rosado brillante (tinte Steel Path): la laxa revienta y la ESTRICTA rescata", () => {
    const frame = makeFrame([217, 135, 135], [250, 248, 245]);
    const cvs = VisionService.prepareRewardNamesCanvas(frame, FRAME_W, FRAME_H, 1);
    assert.ok(cvs instanceof FakeCanvas, "la máscara estricta debe rescatar el frame");
    const { black, total } = maskStats(cvs);
    assert.ok(black > 0, "las letras deben sobrevivir a la máscara estricta");
    assert.ok(black / total < 0.10, `solo letras, densidad ${black / total}`);
  });

  test("tinte saturado que cubre todo: el TINT_CAP lo descarta y la laxa aísla el texto", () => {
    const frame = makeFrame([178, 36, 36], [248, 246, 240]);
    const cvs = VisionService.prepareRewardNamesCanvas(frame, FRAME_W, FRAME_H, 1);
    assert.ok(cvs instanceof FakeCanvas);
    const { black, total } = maskStats(cvs);
    assert.ok(black > 0 && black / total < 0.10);
  });

  test("fondo casi blanco: ninguna máscara aísla letras -> null (pasada saltada)", () => {
    const frame = makeFrame([235, 226, 222], [250, 248, 245]);
    const cvs = VisionService.prepareRewardNamesCanvas(frame, FRAME_W, FRAME_H, 1);
    assert.equal(cvs, null);
  });
});

describe("prepareRewardNamesCanvas: barrido fuente × fondo × luminancia", () => {
  const BGS = [
    { name: "oscuro neutro", rgb: [40, 40, 45] },
    { name: "tinte rojo oscuro", rgb: [90, 30, 30] },
    { name: "tinte rojo medio", rgb: [150, 60, 60] },
    { name: "rosa Steel Path", rgb: [217, 135, 135] },
  ];
  const TEXTS = [{ name: "White", r: 255, g: 255, b: 255 }, ...NAME_TEXT_COLORS.filter(t => t.name !== "White")];

  const toHsv = ([r, g, b]) => {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let h = 0;
    if (d !== 0) {
      if (mx === r) h = ((g - b) / d) % 6;
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6; if (h < 0) h += 1;
    }
    return [h, mx === 0 ? 0 : d / mx, mx];
  };
  const hueDist = (a, b) => { let d = Math.abs(a - b); return d > 0.5 ? 1 - d : d; };

  const textPixelsInCrop = () => {
    const pts = [];
    for (let y = 55; y < 70; y++) for (let x = 40; x < 360; x += 40) pts.push([x - 32, y - 37], [x + 1 - 32, y - 37]);
    return pts;
  };

  for (const bg of BGS) {
    for (const txt of TEXTS) {
      test(`texto ${txt.name} sobre ${bg.name}`, () => {
        const frame = makeFrame(bg.rgb, [txt.r, txt.g, txt.b]);
        const cvs = VisionService.prepareRewardNamesCanvas(frame, FRAME_W, FRAME_H, 1);

        if (cvs === null) return;

        const { black, total } = maskStats(cvs);
        assert.ok(black / total <= 0.10, `máscara densa ${(black / total).toFixed(2)} debió gatearse`);

        const [hT, sT, vT] = toHsv([txt.r, txt.g, txt.b]);
        const [hB, sB, vB] = toHsv(bg.rgb);
        const neutralBright = vT > 0.85 && sT < 0.28;
        const selectableHue = vT > 0.62 && sT > 0.55;
        const bgInHueMask = vB > 0.30 && sB > 0.45;
        const hueClash = bgInHueMask && hueDist(hT, hB) < 0.15;

        if (neutralBright || (selectableHue && !hueClash)) {
          const ctx = cvs.getContext("2d");
          const d = ctx.getImageData(0, 0, cvs.width, cvs.height).data;
          const pts = textPixelsInCrop();
          const alive = pts.filter(([x, y]) => d[(y * cvs.width + x) * 4] === 0).length;
          assert.ok(alive / pts.length >= 0.6,
            `texto aislable pero solo ${alive}/${pts.length} píxeles sobrevivieron`);
        }
      });
    }
  }
});
