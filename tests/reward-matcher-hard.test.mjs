import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { installFakeDocument } from "./_helpers/fake-canvas.mjs";
import { makeRewardFrame, REWARD_IMG_W } from "./_helpers/synthetic-pool.mjs";
import { catalogoPrime, comoItemsDatabase } from "./_helpers/prime-catalog.mjs";
import { mulberry32, degradaRotulo, confunde } from "./_helpers/ocr-degrade.mjs";
import { recuperaPorSufijo, recuperaComponente } from "../deploy/js/utils/inventory/component_recover.js";
import { tieneEvidenciaPropia, tokensSinInformacion } from "../deploy/js/utils/inventory/ocr_words.js";

// MATCHER against the REAL catalog (~580 names from repo JSON) with corrupted text as it arrives in
// production
// previous tests used 20-300 synthetic names where any dirty read matches; against the full catalog
// "Braton Prime Stock" must compete with "Braton Prime Barrel" and "Boltor Prime Stock"
// measures the matcher and column layout without OCR (covered in reward-names-pass.test.mjs)

installFakeDocument();
const { OCRService } = await import("../deploy/js/services/scanner/ocr.service.js");
const { state } = await import("../deploy/js/state.js");

const CATALOGO = catalogoPrime();
state.itemsDatabase = comoItemsDatabase(CATALOGO);
OCRService.cachedDbItems = [];
OCRService.knownParts = new Set();
OCRService._vocabCache = null;
OCRService.initMatcherData();

// same columns produced by detection: one per card, one step wide
const PITCH = 242, CENTER = REWARD_IMG_W / 2;
const columnasDe = (k) => Array.from({ length: k }, (_, i) => {
  const cx = CENTER + (i - (k - 1) / 2) * PITCH;
  return { x0: (cx - PITCH / 2) / REWARD_IMG_W, x1: (cx + PITCH / 2) / REWARD_IMG_W };
});

function lee(items, { rand = mulberry32(1), narrow = false } = {}) {
  const frame = makeRewardFrame(items, { rand, narrow });
  return OCRService.parseRewards({ ...frame, columnas: columnasDe(items.length) })
    .map((r) => r.name);
}

describe("el componente perdido es el fallo caro", () => {
  // losing the component word does not leave the name incomplete: it turns into ANOTHER real piece (usually
  // more valuable), and auto-commit adds it
  test("un componente ilegible para la normalización sigue rescatándose", () => {
    // "noatoptics" scores 0.76 against NEUROPTICS: below the 0.85 discard threshold of normalizeOCRWords, but
    // above the 0.6 rescue threshold
    // discarding it earlier caused the card to commit as "Zephyr Prime Blueprint"
    const leidos = lee([
      ["Zephyr", "Prime", "noatoptics", "Blueprint"],
      "Forma Blueprint", "Forma Blueprint", "Caliban Prime Blueprint",
    ]);
    assert.deepEqual(leidos, ["Zephyr Prime Neuroptics Blueprint", "Forma Blueprint",
      "Forma Blueprint", "Caliban Prime Blueprint"]);
  });

  test("y el plano principal legítimo NO se convierte en una pieza con componente", () => {
    // the other side of rescue: "Caliban Prime Blueprint" is a real reward; closest component match is
    // "Crafted" (0.45 against CARAPACE), separated by the 0.6 threshold
    const leidos = lee(["Caliban Prime Blueprint", "Lex Prime Blueprint",
      "Trumna Prime Blueprint", "Forma Blueprint"]);
    assert.deepEqual(leidos, ["Caliban Prime Blueprint", "Lex Prime Blueprint",
      "Trumna Prime Blueprint", "Forma Blueprint"]);
  });

  test("cada componente del juego se rescata desde su forma destrozada", () => {
    const rnd = mulberry32(7);
    for (const pieza of ["Hydroid Prime Neuroptics Blueprint", "Gyre Prime Chassis Blueprint",
      "Xaku Prime Systems Blueprint", "Nidus Prime Neuroptics Blueprint"]) {
      const tokens = pieza.split(" ");
      const i = tokens.length - 2;                       // the component word
      const roto = [...tokens];
      roto[i] = confunde(tokens[i], rnd, 0.3);
      const leidos = lee([roto, "Forma Blueprint", "Braton Prime Stock", "Lex Prime Receiver"]);
      assert.ok(leidos.includes(pieza), `"${roto.join(" ")}" -> ${leidos[0]} (esperado ${pieza})`);
    }
  });
});

describe("fuzz sobre el catálogo entero", () => {
  // sweep across 4 random catalog pieces with ONE corruption
  // pins two key invariants without fixing the implementation: NEVER INVENT (phantom items get committed)
  // and survive isolated corruption (the other three cards must not be lost)
  const AVERIAS = ["limpio", "confusion", "pierde", "funde"];

  for (const averia of AVERIAS) {
    test(`avería "${averia}": no inventa piezas y conserva las sanas`, () => {
      const rnd = mulberry32(42);
      let sanasOk = 0, sanasTot = 0, inventadas = [];
      for (let it = 0; it < 120; it++) {
        const piezas = Array.from({ length: 4 }, () => CATALOGO[Math.floor(rnd() * CATALOGO.length)]);
        if (new Set(piezas).size !== 4) continue;
        const tocada = Math.floor(rnd() * 4);
        const items = piezas.map((p, i) => i === tocada && averia !== "limpio"
          ? degradaRotulo(p.split(" "), averia, rnd) : p);
        const leidos = lee(items, { rand: rnd });

        piezas.forEach((p, i) => {
          if (i === tocada && averia !== "limpio") return;
          sanasTot++;
          if (leidos.includes(p)) sanasOk++;
        });
        // degraded card may succeed, fail, or drop; it must NEVER turn into an item NOT on screen
        for (const n of leidos) if (!piezas.includes(n)) inventadas.push(`${items[tocada]} -> ${n}`);
      }
      const ratioSanas = sanasOk / sanasTot;
      // loose floors pin current behaviour without over-fitting: breaking changes crash them without fussing
      // over decimals
      assert.ok(ratioSanas > 0.9, `solo sobrevive el ${(ratioSanas * 100).toFixed(0)}% de las tarjetas sanas`);
      assert.ok(inventadas.length / sanasTot < 0.12,
        `${inventadas.length} piezas inventadas sobre ${sanasTot}: ${inventadas.slice(0, 5).join(" | ")}`);
    });
  }
});

describe("la cola del rótulo poda el catálogo cuando la primera palabra es ilegible", () => {
  const sim = (a, b) => OCRService.similarityOCR(a, b);
  const rescata = (tokens, opts) => recuperaPorSufijo(tokens, CATALOGO, sim, opts);

  test("un plano pelado se rescata por 'PRIME BLUEPRINT'", () => {
    // missing case: without a component to prune, rescue was never attempted and the card disappeared
    // in a 1440p capture OCR returned "calisax" for "Caliban": scores 0.714 against 152 "<X> Prime Blueprint"
    // items, leading second place by 0.257
    assert.equal(rescata(["calisax", "Prime", "Blueprint"]), "Caliban Prime Blueprint");
  });

  test("gana la cola más larga: si el componente se leyó, se usa", () => {
    assert.equal(rescata(["hydrbid", "Prime", "Neuroptics", "Blueprint"]),
      "Hydroid Prime Neuroptics Blueprint");
  });

  test("la basura del arte no llega a nombre", () => {
    // returns nothing without a clear margin over the second: inventing an item is worse than missing it
    // because commit adds to inventory
    assert.equal(rescata(["qt", "Prime", "Blueprint"]), null);
    assert.equal(rescata(["came", "Prime", "Blueprint"]), null);
    assert.equal(rescata(["Prime", "Blueprint"]), null, "sin candidato a nombre base no hay nada que rescatar");
  });

  test("un token de dos letras no compite por el nombre base", () => {
    // similarityOCR divides by the length of the longer string: "Ag" scores 0.667 against "Mag" with one
    // error, collapsing the rescue margin from 0.257 to 0.048
    assert.equal(rescata(["Ag", "calisax", "Prime", "Blueprint"]), "Caliban Prime Blueprint");
  });

  test("sin cola de al menos dos palabras no se intenta", () => {
    // forma Blueprint must be read, not guessed: a single-token tail leaves the catalog unpruned and rescue
    // would pick across too many candidates
    assert.equal(rescata(["forna", "Blueprint"]), null);
  });
});

describe("tokens que no distinguen nada", () => {
  test("PRIME y BLUEPRINT son genéricos; el resto no", () => {
    const g = OCRService.tokensGenericos;
    assert.ok(g.has("BLUEPRINT"), "sale en el 54 % del catálogo");
    for (const t of ["NEUROPTICS", "CHASSIS", "BARREL", "STOCK", "CALIBAN"]) {
      assert.ok(!g.has(t), `${t} sí distingue`);
    }
  });

  test("una coincidencia que solo se sostiene en dos letras y un genérico se rechaza", () => {
    // art noise "Bo" borrowing BLUEPRINT from the neighbouring card
    const palabras = [{ text: "BO", x: 800 }, { text: "BLUEPRINT", x: 900 }];
    assert.equal(tieneEvidenciaPropia(["BO", "BLUEPRINT"], palabras, OCRService.tokensGenericos), false);
    // a 3-letter token suffices: "Lex Prime Blueprint" is a real reward
    const lex = [{ text: "LEX", x: 800 }, { text: "BLUEPRINT", x: 900 }];
    assert.equal(tieneEvidenciaPropia(["LEX", "BLUEPRINT"], lex, OCRService.tokensGenericos), true);
  });
});

test("con un catálogo pequeño no se declara genérico nada", () => {
  // with a partially filled state.itemsDatabase from the API, all tokens appear in >20 % of the catalog,
  // losing distinct evidence and matching NOTHING: minimum sample size prevents this
  const pocos = [{ searchWords: ["BRATON", "STOCK"] }, { searchWords: ["FORMA", "BLUEPRINT"] }];
  assert.equal(tokensSinInformacion(pocos).size, 0);
  // with a real catalog it distinguishes
  assert.ok(tokensSinInformacion(OCRService.cachedDbItems).has("BLUEPRINT"));
});

test("el componente pegado a la palabra anterior se rescata por el sufijo", () => {
  // neural network engines glue tokens without uppercase ("VorunaPimethassis" for "Voruna Prime Chassis")
  // scores 0.55 full and 0.86 by suffix against CHASSIS, while art noise stays below 0.45: that gap makes
  // the check safe
  const existe = (n) => CATALOGO.includes(n);
  const sim = (a, b) => OCRService.similarityOCR(a, b);
  assert.equal(recuperaComponente("Voruna Prime Blueprint", ["VorunaPimethassis"], existe, sim),
    "Voruna Prime Chassis Blueprint");
  // plain blueprint stays safe: no noise token reaches the suffix threshold
  assert.equal(recuperaComponente("Caliban Prime Blueprint", ["Crafted", "wolovescake", "TheDeathstroke"], existe, sim),
    "Caliban Prime Blueprint");
});
