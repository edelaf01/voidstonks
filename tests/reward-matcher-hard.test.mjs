import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { installFakeDocument } from "./_helpers/fake-canvas.mjs";
import { makeRewardFrame, REWARD_IMG_W } from "./_helpers/synthetic-pool.mjs";
import { catalogoPrime, comoItemsDatabase } from "./_helpers/prime-catalog.mjs";
import { mulberry32, degradaRotulo, confunde } from "./_helpers/ocr-degrade.mjs";
import { recuperaPorSufijo, recuperaComponente } from "../deploy/js/utils/inventory/component_recover.js";
import { tieneEvidenciaPropia, tokensSinInformacion } from "../deploy/js/utils/inventory/ocr_words.js";

installFakeDocument();
const { OCRService } = await import("../deploy/js/services/scanner/ocr.service.js");
const { state } = await import("../deploy/js/state.js");

const CATALOGO = catalogoPrime();
state.itemsDatabase = comoItemsDatabase(CATALOGO);
OCRService.cachedDbItems = [];
OCRService.knownParts = new Set();
OCRService._vocabCache = null;
OCRService.initMatcherData();

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
  test("un componente ilegible para la normalización sigue rescatándose", () => {
    // "noatoptics" scores 0.76 against NEUROPTICS, between the 0.85 discard and 0.6 rescue thresholds
    const leidos = lee([
      ["Zephyr", "Prime", "noatoptics", "Blueprint"],
      "Forma Blueprint", "Forma Blueprint", "Caliban Prime Blueprint",
    ]);
    assert.deepEqual(leidos, ["Zephyr Prime Neuroptics Blueprint", "Forma Blueprint",
      "Forma Blueprint", "Caliban Prime Blueprint"]);
  });

  test("y el plano principal legítimo NO se convierte en una pieza con componente", () => {
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
      const i = tokens.length - 2;
      const roto = [...tokens];
      roto[i] = confunde(tokens[i], rnd, 0.3);
      const leidos = lee([roto, "Forma Blueprint", "Braton Prime Stock", "Lex Prime Receiver"]);
      assert.ok(leidos.includes(pieza), `"${roto.join(" ")}" -> ${leidos[0]} (esperado ${pieza})`);
    }
  });
});

describe("fuzz sobre el catálogo entero", () => {
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
        for (const n of leidos) if (!piezas.includes(n)) inventadas.push(`${items[tocada]} -> ${n}`);
      }
      const ratioSanas = sanasOk / sanasTot;
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
    assert.equal(rescata(["calisax", "Prime", "Blueprint"]), "Caliban Prime Blueprint");
  });

  test("gana la cola más larga: si el componente se leyó, se usa", () => {
    assert.equal(rescata(["hydrbid", "Prime", "Neuroptics", "Blueprint"]),
      "Hydroid Prime Neuroptics Blueprint");
  });

  test("la basura del arte no llega a nombre", () => {
    assert.equal(rescata(["qt", "Prime", "Blueprint"]), null);
    assert.equal(rescata(["came", "Prime", "Blueprint"]), null);
    assert.equal(rescata(["Prime", "Blueprint"]), null, "sin candidato a nombre base no hay nada que rescatar");
  });

  test("un token de dos letras no compite por el nombre base", () => {
    assert.equal(rescata(["Ag", "calisax", "Prime", "Blueprint"]), "Caliban Prime Blueprint");
  });

  test("sin cola de al menos dos palabras no se intenta", () => {
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
    const palabras = [{ text: "BO", x: 800 }, { text: "BLUEPRINT", x: 900 }];
    assert.equal(tieneEvidenciaPropia(["BO", "BLUEPRINT"], palabras, OCRService.tokensGenericos), false);
    const lex = [{ text: "LEX", x: 800 }, { text: "BLUEPRINT", x: 900 }];
    assert.equal(tieneEvidenciaPropia(["LEX", "BLUEPRINT"], lex, OCRService.tokensGenericos), true);
  });
});

test("con un catálogo pequeño no se declara genérico nada", () => {
  const pocos = [{ searchWords: ["BRATON", "STOCK"] }, { searchWords: ["FORMA", "BLUEPRINT"] }];
  assert.equal(tokensSinInformacion(pocos).size, 0);
  assert.ok(tokensSinInformacion(OCRService.cachedDbItems).has("BLUEPRINT"));
});

test("el componente pegado a la palabra anterior se rescata por el sufijo", () => {
  const existe = (n) => CATALOGO.includes(n);
  const sim = (a, b) => OCRService.similarityOCR(a, b);
  assert.equal(recuperaComponente("Voruna Prime Blueprint", ["VorunaPimethassis"], existe, sim),
    "Voruna Prime Chassis Blueprint");
  assert.equal(recuperaComponente("Caliban Prime Blueprint", ["Crafted", "wolovescake", "TheDeathstroke"], existe, sim),
    "Caliban Prime Blueprint");
});
