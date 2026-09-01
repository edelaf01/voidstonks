import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { installFakeDocument } from "./_helpers/fake-canvas.mjs";
import { makeRewardFrame, REWARD_IMG_W } from "./_helpers/synthetic-pool.mjs";
import { catalogoPrime, comoItemsDatabase } from "./_helpers/prime-catalog.mjs";
import { mulberry32, degradaRotulo, confunde } from "./_helpers/ocr-degrade.mjs";
import { recuperaPorSufijo, recuperaComponente } from "../deploy/js/utils/inventory/component_recover.js";
import { tieneEvidenciaPropia, tokensSinInformacion } from "../deploy/js/utils/inventory/ocr_words.js";

// ===========================================================================
// El MATCHER contra el catálogo REAL (los ~580 nombres que salen de los JSON del repo) y con
// el texto llegando destrozado como llega de verdad.
//
// Los tests de recompensas que había medían un problema más fácil que el real por dos motivos:
// el catálogo era una lista inventada de 20-300 nombres —con 20 vecinos cualquier lectura sucia
// acierta— y el texto entraba limpio. Con el catálogo entero, "Braton Prime Stock" compite con
// "Braton Prime Barrel" y con "Boltor Prime Stock", que es la competencia de verdad.
//
// Las averías (glifo confundido, palabra perdida, palabras fundidas) están medidas sobre las
// capturas del usuario en tema rojo; ver tests/_helpers/ocr-degrade.mjs.
//
// Lo que este fichero NO cubre: el OCR. Aquí se entra con palabras, así que mide el matcher y
// el reparto por columnas, no la lectura. La lectura se barre en reward-names-pass.test.mjs.
// ===========================================================================

installFakeDocument();
const { OCRService } = await import("../deploy/js/services/scanner/ocr.service.js");
const { state } = await import("../deploy/js/state.js");

const CATALOGO = catalogoPrime();
state.itemsDatabase = comoItemsDatabase(CATALOGO);
OCRService.cachedDbItems = [];
OCRService.knownParts = new Set();
OCRService._vocabCache = null;
OCRService.initMatcherData();

// Mismas columnas que produce la detección: una por tarjeta, de un paso de ancho.
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
  // Cuando se pierde la palabra del componente el nombre no queda incompleto: se convierte en
  // OTRA pieza que existe y que suele valer más, y el alta automática la suma.
  test("un componente ilegible para la normalización sigue rescatándose", () => {
    // "noatoptics" puntúa 0.76 contra NEUROPTICS: por debajo del 0.85 con el que
    // normalizeOCRWords descarta, por encima del 0.6 que le basta al rescate. Antes se tiraba
    // antes de llegar a él y la tarjeta entraba como "Zephyr Prime Blueprint".
    const leidos = lee([
      ["Zephyr", "Prime", "noatoptics", "Blueprint"],
      "Forma Blueprint", "Forma Blueprint", "Caliban Prime Blueprint",
    ]);
    assert.deepEqual(leidos, ["Zephyr Prime Neuroptics Blueprint", "Forma Blueprint",
      "Forma Blueprint", "Caliban Prime Blueprint"]);
  });

  test("y el plano principal legítimo NO se convierte en una pieza con componente", () => {
    // El otro lado del rescate: "Caliban Prime Blueprint" es una recompensa real. El token que
    // más se le parece a un componente en esa tarjeta es "Crafted" (0.45 contra CARAPACE), y el
    // umbral del rescate es 0.6 — el margen que separa los dos casos.
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
      const i = tokens.length - 2;                       // la palabra del componente
      const roto = [...tokens];
      roto[i] = confunde(tokens[i], rnd, 0.3);
      const leidos = lee([roto, "Forma Blueprint", "Braton Prime Stock", "Lex Prime Receiver"]);
      assert.ok(leidos.includes(pieza), `"${roto.join(" ")}" -> ${leidos[0]} (esperado ${pieza})`);
    }
  });
});

describe("fuzz sobre el catálogo entero", () => {
  // Barrido: la pantalla real son 4 piezas cualesquiera del catálogo con UNA avería. Lo que se
  // mide no es un porcentaje bonito sino las dos propiedades que importan y que se pueden
  // afirmar sin fijar la implementación:
  //   - NO INVENTAR: una pieza devuelta que no estaba en pantalla se da de alta igual.
  //   - no perderlo todo: con una sola avería, las otras tres tarjetas tienen que sobrevivir.
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
        // La degradada puede salir bien, mal o no salir; lo que no puede es salir como una
        // pieza que NO está en pantalla.
        for (const n of leidos) if (!piezas.includes(n)) inventadas.push(`${items[tocada]} -> ${n}`);
      }
      const ratioSanas = sanasOk / sanasTot;
      // Los suelos son deliberadamente holgados: fijan el comportamiento actual sin convertir
      // el test en una medida de la implementación. Lo que se persigue es que un cambio que
      // rompa el matcher los hunda, no clavar un decimal.
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
    // El caso que se perdía: sin componente que podar, el rescate ni se intentaba y la tarjeta
    // desaparecía. Medido en una captura a 1440p, el OCR devolvió "calisax" por "Caliban":
    // contra las 152 piezas "<X> Prime Blueprint" saca 0,714 y le saca 0,257 al segundo.
    assert.equal(rescata(["calisax", "Prime", "Blueprint"]), "Caliban Prime Blueprint");
  });

  test("gana la cola más larga: si el componente se leyó, se usa", () => {
    assert.equal(rescata(["hydrbid", "Prime", "Neuroptics", "Blueprint"]),
      "Hydroid Prime Neuroptics Blueprint");
  });

  test("la basura del arte no llega a nombre", () => {
    // Sin margen claro sobre el segundo no se devuelve nada: inventar una pieza es peor que no
    // leerla, porque el alta es automática y de suma.
    assert.equal(rescata(["qt", "Prime", "Blueprint"]), null);
    assert.equal(rescata(["came", "Prime", "Blueprint"]), null);
    assert.equal(rescata(["Prime", "Blueprint"]), null, "sin candidato a nombre base no hay nada que rescatar");
  });

  test("un token de dos letras no compite por el nombre base", () => {
    // `similarityOCR` divide por la longitud del más largo: "Ag" saca 0,667 contra "Mag" con un
    // solo error y hundía el margen del rescate legítimo de 0,257 a 0,048.
    assert.equal(rescata(["Ag", "calisax", "Prime", "Blueprint"]), "Caliban Prime Blueprint");
  });

  test("sin cola de al menos dos palabras no se intenta", () => {
    // "Forma Blueprint" no se adivina, se lee: con una cola de un solo token el catálogo no
    // queda podado y el rescate estaría escogiendo entre demasiadas piezas.
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
    // El "Bo" de ruido del arte tomando prestado el BLUEPRINT de la tarjeta vecina.
    const palabras = [{ text: "BO", x: 800 }, { text: "BLUEPRINT", x: 900 }];
    assert.equal(tieneEvidenciaPropia(["BO", "BLUEPRINT"], palabras, OCRService.tokensGenericos), false);
    // Con un token propio de tres letras sí: "Lex Prime Blueprint" es una recompensa real.
    const lex = [{ text: "LEX", x: 800 }, { text: "BLUEPRINT", x: 900 }];
    assert.equal(tieneEvidenciaPropia(["LEX", "BLUEPRINT"], lex, OCRService.tokensGenericos), true);
  });
});

test("con un catálogo pequeño no se declara genérico nada", () => {
  // Si no, con `state.itemsDatabase` a medias —se llena desde la API— todos los tokens saldrían
  // en más del 20 % del catálogo, ninguna coincidencia tendría evidencia propia y el escáner
  // dejaría de casar NADA. El suelo de muestra es lo que lo impide.
  const pocos = [{ searchWords: ["BRATON", "STOCK"] }, { searchWords: ["FORMA", "BLUEPRINT"] }];
  assert.equal(tokensSinInformacion(pocos).size, 0);
  // Con catálogo de verdad sí distingue.
  assert.ok(tokensSinInformacion(OCRService.cachedDbItems).has("BLUEPRINT"));
});

test("el componente pegado a la palabra anterior se rescata por el sufijo", () => {
  // Los motores de red pegan sin dejar mayúscula ("VorunaPimethassis" por "Voruna Prime
  // Chassis"). Entero puntúa 0,55 contra CHASSIS y por sufijo 0,86, mientras que el ruido del
  // arte no pasa de 0,45 ni por sufijo — ese hueco es lo que hace segura la comprobación.
  const existe = (n) => CATALOGO.includes(n);
  const sim = (a, b) => OCRService.similarityOCR(a, b);
  assert.equal(recuperaComponente("Voruna Prime Blueprint", ["VorunaPimethassis"], existe, sim),
    "Voruna Prime Chassis Blueprint");
  // Y el plano pelado legítimo sigue a salvo: ningún token de ruido llega al listón por sufijo.
  assert.equal(recuperaComponente("Caliban Prime Blueprint", ["Crafted", "wolovescake", "TheDeathstroke"], existe, sim),
    "Caliban Prime Blueprint");
});
