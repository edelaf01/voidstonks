import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { installFakeDocument, FakeCanvas } from "./_helpers/fake-canvas.mjs";
import { mulberry32, buildItemPool, makeRewardFrame, addTintJunk, addUIBackground, UI_BACKGROUND_WORDS, REQUIEMS } from "./_helpers/synthetic-pool.mjs";

installFakeDocument(); // before dynamic import: vision.service.js creates canvases at load time

const { OCRService } = await import("../deploy/js/services/scanner/ocr.service.js");
const { VisionService, NAME_TEXT_COLORS } = await import("../deploy/js/services/scanner/vision.service.js");
const { state } = await import("../deploy/js/state.js");

// parseRewards with SYNTHETIC frames of VOID FISSURE/REWARDS
// geometry modelled after real 2560x1440 captures (crop imgW = 1614, column centres ~440/683/925/1167,
// names at y≈248, badges at y≈40)
// pins regressions: tint junk requiem anchor must NOT steal columns, neighbour 2nd line must NOT poison
// main-BP penalty, long name in last column is NOT truncated, 2-3 line names match

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
    assert.equal(res[1].owned, 10);  // "10 Owned" badge falls into Paris window
    assert.equal(res[3].crafted, 1);
  });

  test("nombre a 2 líneas (Yareli Prime Chassis / Blueprint) matchea con owned del badge", () => {
    const res = parse([
      w("2", 885, 40), w("Owned", 940, 40),
      w("Akbolto", 365, 248), w("Prime", 440, 248), w("Receiver", 515, 248),
      w("Paris", 615, 248), w("Prime", 683, 248), w("String", 750, 248),
      w("Yareli", 855, 240), w("Prime", 925, 240), w("Chassis", 995, 240),
      w("Blueprint", 925, 262), // 2nd line, centred below the 1st
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
    // regression v2.64: pre-nextAnchor exclusion zone truncated "Prime String" and requiem Ris (1 token, ratio
    // 1.0) won consolidation
    const res = parse([
      w("Akbolto", 365, 248), w("Prime", 440, 248), w("Receiver", 515, 248),
      w("Paris", 615, 248), w("Prime", 683, 248), w("String", 750, 248),
      w("RIS", 770, 300), // watermark/tint junk normalised to requiem, right after "String"
      w("Forma", 1120, 248), w("Blueprint", 1200, 248),
    ]);
    assert.ok(names(res).includes("Paris Prime String"));
    assert.ok(!names(res).includes("Ris"), "el requiem espurio no debe aparecer como recompensa");
  });

  test("la 2ª línea del vecino (Neuroptics a la IZQUIERDA de su ancla) no mata al main blueprint", () => {
    // real frame "no funciona-gunseng": NEUROPTICS@886 sits 13 px left of anchor GRENDEL@899, entering Gunsen
    // window
    // main-BP -0.6 penalty must only consider words <=0.13W from its own anchor
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
    // candidate "Volt Prime Blueprint" sees SYSTEMS next to its anchor (<=0.13W) and gets pruned; complete
    // item with Systems wins
    const res = parse([
      w("Volt", 855, 240), w("Prime", 925, 240), w("Systems", 995, 240),
      w("Blueprint", 925, 262),
    ]);
    assert.deepEqual(names(res), ["Volt Prime Systems Blueprint"]);
  });

  test("nombre largo en la ÚLTIMA columna (sin nextAnchor) no se amputa", () => {
    // original Quassus case: last token sits at ~0.24W from anchor; MARGIN_RIGHT 0.26 covers it WITHOUT
    // extending window to the edge (imgW swallowed junk)
    const res = parse([
      w("Akbolto", 365, 248), w("Prime", 440, 248), w("Receiver", 515, 248),
      w("Quassus", 1220, 248), w("Prime", 1390, 248), w("Blueprint", 1600, 248),
    ]);
    assert.deepEqual(names(res), ["Akbolto Prime Receiver", "Quassus Prime Blueprint"]);
  });
});

// random pool: reward frames generated from ~300 items (prime warframes/weapons, requiems, Forma) with
// random multiline layouts and tint noise
// fixed seeds for reproducibility; matcher sees the ENTIRE pool as DB (300 distractors), not just what is
// on screen

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
      // real requiems only drop alone: excluded here so any requiem appearing in output is proven to be a junk
      // PHANTOM
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
    // real case: background nickname "Post" normalised to "FROST", creating a phantom anchor that stole
    // neighbour's "Prime Chassis Blueprint" and yielded "Frost Prime Chassis Blueprint" instead of "Styanax
    // Prime Chassis BP"
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

// prepareRewardNamesCanvas: mask ladder (hue -> loose neutral -> strict neutral) and density gate
// synthetic RGBA frames: uniform background + sparse "text" (~1-2% bright pixels)

const FRAME_W = 400, FRAME_H = 200; // reward crop: x 32..368, y 37..87 (ch=51)

function makeFrame(bg, textColor) {
  const data = new Uint8ClampedArray(FRAME_W * FRAME_H * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = bg[0]; data[i + 1] = bg[1]; data[i + 2] = bg[2]; data[i + 3] = 255;
  }
  // "letters": 2 px columns every 40 px inside the crop band
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
    const frame = makeFrame([90, 30, 30], [245, 243, 238]); // dark red background (fails v>0.78)
    const cvs = VisionService.prepareRewardNamesCanvas(frame, FRAME_W, FRAME_H, 1);
    assert.ok(cvs instanceof FakeCanvas, "debe devolver canvas, no null");
    const { black, total } = maskStats(cvs);
    assert.ok(black > 0, "el texto debe quedar en negro");
    assert.ok(black / total < 0.10, `máscara limpia, densidad ${black / total}`);
  });

  test("fondo rosado brillante (tinte Steel Path): la laxa revienta y la ESTRICTA rescata", () => {
    // bg v=0.85 s=0.38 passes loose mask (v>0.78, s<0.45) -> density ~1.0 -> strict step (v>0.85, s<0.28)
    // rejects it and preserves cream letters
    const frame = makeFrame([217, 135, 135], [250, 248, 245]);
    const cvs = VisionService.prepareRewardNamesCanvas(frame, FRAME_W, FRAME_H, 1);
    assert.ok(cvs instanceof FakeCanvas, "la máscara estricta debe rescatar el frame");
    const { black, total } = maskStats(cvs);
    assert.ok(black > 0, "las letras deben sobrevivir a la máscara estricta");
    assert.ok(black / total < 0.10, `solo letras, densidad ${black / total}`);
  });

  test("tinte saturado que cubre todo: el TINT_CAP lo descarta y la laxa aísla el texto", () => {
    // bg v=0.7 s=0.8 enters hue histogram but bin exceeds 18% of crop (background, not letters) -> Hd null ->
    // loose neutral: bg fails v>0.78
    const frame = makeFrame([178, 36, 36], [248, 246, 240]);
    const cvs = VisionService.prepareRewardNamesCanvas(frame, FRAME_W, FRAME_H, 1);
    assert.ok(cvs instanceof FakeCanvas);
    const { black, total } = maskStats(cvs);
    assert.ok(black > 0 && black / total < 0.10);
  });

  test("fondo casi blanco: lo aísla la máscara por color de tema", () => {
    // bg v=0.92 s=0.09 passes both loose and strict masks (density ~1.0) and previously returned null
    // resolved by theme mask measuring HUE similarity and local contrast rather than absolute brightness; pure
    // white (WFInfo Deadlock) gives this frame a competing theme
    const frame = makeFrame([235, 226, 222], [250, 248, 245]);
    const cvs = VisionService.prepareRewardNamesCanvas(frame, FRAME_W, FRAME_H, 1);
    assert.ok(cvs instanceof FakeCanvas, "la máscara por tema debe rescatar el frame");
    const { black, total } = maskStats(cvs);
    // "letters" are 8 columns of 2 px × 15 rows = 240 px: checks that it isolates THE TEXT rather than marking
    // arbitrary pixels
    assert.equal(black, 240, "debe quedarse con las columnas de texto y nada más");
    assert.ok(black / total < 0.10, `máscara limpia, densidad ${black / total}`);
  });

  // gate is the core purpose of the ladder: a dense mask injects hundreds of junk words into mergedWords
  // creating spurious anchors ("Ri/ris" -> requiem "Ris")
  // an additional ladder step must not allow arbitrary frames to return data
  test("sin letras que aislar: null (pasada saltada)", () => {
    const frame = makeFrame([235, 226, 222], [250, 248, 245]);
    // clears the "letters", leaving raw off-white background
    for (let i = 0; i < frame.data.length; i += 4) {
      frame.data[i] = 235; frame.data[i + 1] = 226; frame.data[i + 2] = 222;
    }
    assert.equal(VisionService.prepareRewardNamesCanvas(frame, FRAME_W, FRAME_H, 1), null);
  });

  test("letras sin contraste real contra el fondo: null", () => {
    // difference of 3 per channel: unreadable by OCR, any mask keeping this would be marking compression noise
    const frame = makeFrame([235, 226, 222], [238, 229, 225]);
    assert.equal(VisionService.prepareRewardNamesCanvas(frame, FRAME_W, FRAME_H, 1), null);
  });
});

// sweep of FONT colors (real NAME_TEXT_COLORS catalog) × BACKGROUNDS with varying luminance/tint
// contract: (1) NEVER returns a dense mask (>10% = junk creating spurious anchors), gated to null
// (2) when text color is isolable, letters survive in black; non-isolable combos are covered by grayscale
// pass

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

  // text pixels of synthetic frame in crop coordinates (scale=1)
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

        if (cvs === null) return; // gate: contract (1) met by definition

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

// card geometry is the ONLY thing separating a valid correction from junk: "LOVOS"->LAVOS and
// "FRONT"->FROST are both 1 glyph away and unique
// the first falls inside a card, the second is background HUD
test("un glifo mal se corrige dentro de una tarjeta, pero no fuera", () => {
  const W = 1690;
  const palabra = (t, x) => ({ text: t, confidence: 85, bbox: { x0: x, y0: 10, x1: x + 90, y1: 30 } });
  const words = [palabra("Lovos", 500), palabra("Prime", 600), palabra("Ehassis", 700), palabra("Blueprint", 500)];
  const columnas = [{ x0: 0.02, x1: 0.28 }, { x0: 0.27, x1: 0.53 }, { x0: 0.52, x1: 0.78 }];

  // without columns the card is anchored by "PRIME", which distinguishes labels from HUD: no background junk
  // pairs PRIME with a component word
  // previously refused to correct without plausible columns and lost the entire card (measured in a real
  // capture, "calisax" for "Caliban")
  const sinCols = OCRService.parseRewards({ words, imageW: W });
  assert.deepEqual(sinCols.map((r) => r.name), ["Lavos Prime Chassis Blueprint"]);

  // without that anchor nothing is corrected
  const soloHud = OCRService.parseRewards({
    words: [palabra("Front", 500), palabra("Ehassis", 700), palabra("Blueprint", 500)], imageW: W,
  });
  assert.deepEqual(soloHud.map((r) => r.name), [], "sin PRIME cerca no es un rótulo, es HUD");

  const conCols = OCRService.parseRewards({ words, imageW: W, columnas });
  assert.deepEqual(conCols.map((r) => r.name), ["Lavos Prime Chassis Blueprint"]);

  // same word OUTSIDE any column remains uncorrected
  const fuera = OCRService.parseRewards({
    words: [palabra("Lovos", 1600), ...words.slice(1)], imageW: W, columnas,
  });
  assert.deepEqual(fuera.map((r) => r.name), []);
});
