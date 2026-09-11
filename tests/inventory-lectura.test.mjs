// Qué LEE el escáner sobre capturas reales del inventario, con la verdad contada a mano.
//
// El otro test de capturas (inventory-captures.test.mjs) comprueba la GEOMETRÍA —que la rejilla
// salga donde toca— pero no que lo leído sea correcto. Aquí se exige la lectura exacta, que es
// lo único que el usuario nota.
//
// Las capturas viven fuera del repo (pesan ~5 MB cada una) y el test se SALTA si no están.
// Para añadir un caso: deja el PNG en la carpeta y apunta aquí sus 18 cantidades.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { decodePng, encodePng } from "./_helpers/png.mjs";
import { installFakeDocument } from "./_helpers/fake-canvas.mjs";

installFakeDocument();
const { VisionService } = await import("../deploy/js/services/scanner/vision.service.js");
const { OCRService } = await import("../deploy/js/services/scanner/ocr.service.js");
const { leeCantidadBadge } = await import("../deploy/js/services/scanner/badge_read.service.js");
const { cellNameMask, electPageNameColor } = await import("../deploy/js/services/scanner/name_color.service.js");
const { OCRRepository } = await import("../deploy/js/repositories/ocr.repository.js");
const { comoItemsDatabase } = await import("./_helpers/prime-catalog.mjs");
const { state } = await import("../deploy/js/state.js");

state.itemsDatabase = comoItemsDatabase();

const DIR = process.env.INVENTORY_CAPTURES_DIR
  || "/home/ppsoy/Imágenes/Capturas de pantalla/inventario";
const RAIZ = path.dirname(fileURLToPath(import.meta.url));

// Verdad contada a mano sobre cada captura, en orden de lectura (fila 0 de izquierda a derecha).
const CAPTURAS = {
  // Tema rojo oscuro (Stalker pintado tenue, badge rgb(153,31,35)). Las dos celdas de Neuroptics
  // —cuyo arte es un casco prime blanco y grande que sube hasta la altura del badge— devolvían
  // cadena vacía: la K-means se llevaba el casco como "tinta" y el badge se iba al fondo.
  // Reportada en vivo: la celda de Neuroptics salía UNMATCHED. Su máscara por color de página
  // trae MUCHA más tinta que las vecinas (27414 frente a ~19000) porque se traga el casco blanco
  // del arte, y de ahí sale "BARUUK BAIN NEUROPTICS BLUEPRINT" — una letra inventada sobre una
  // forma que no lo es. La relectura con el color PROPIO de la celda la recupera.
  "baruuk.png": {
    dir: "/home/ppsoy/Imágenes/Capturas de pantalla/nofunciona/implementar",
    nombres: [
      "Baruuk Prime Chassis Blueprint", "Baruuk Prime Neuroptics Blueprint",
      "Baruuk Prime Systems Blueprint", "Baruuk Prime Blueprint",
      "Baza Prime Receiver", "Baza Prime Blueprint",
      "Bo Prime Handle", "Bo Prime Ornament", "Bo Prime Blueprint",
      "Boar Prime Barrel", "Boar Prime Receiver", "Boar Prime Stock",
      "Boar Prime Blueprint", "Boltor Prime Barrel", "Boltor Prime Receiver",
      "Boltor Prime Stock", "Boltor Prime Blueprint", "Braton Prime Barrel",
    ],
  },
  // `desvio` = esta captura tiene medido cuánto aguanta la rejilla desalineada.
  "arreglar_malcount.png": {
    desvio: 16,
    badges: [27, 27, 27, 26, 22, 20, 20, 19, 17, 16, 16, 16, 16, 15, 14, 14, 13, 13],
    nombres: [
      "Boltor Prime Receiver", "Khora Prime Chassis Blueprint", "Rhino Prime Blueprint",
      "Nyx Prime Chassis Blueprint", "Revenant Prime Neuroptics Blueprint", "Mag Prime Systems Blueprint",
      "Octavia Prime Chassis Blueprint", "Dakra Prime Blueprint", "Wukong Prime Systems Blueprint",
      "Boar Prime Receiver", "Gara Prime Systems Blueprint", "Harrow Prime Blueprint",
      "Khora Prime Systems Blueprint", "Fang Prime Blueprint", "Gara Prime Neuroptics Blueprint",
      "Lex Prime Receiver", "Boar Prime Barrel", "Khora Prime Neuroptics Blueprint",
    ],
  },
};

const hayTesseract = spawnSync("tesseract", ["--version"], { stdio: "ignore" }).status === 0;

function lee(archivo, dir = DIR) {
  const img = decodePng(fs.readFileSync(path.join(dir, archivo)));
  const calib = VisionService.detectGridAutoCalib(img, img.width, img.height);
  assert.ok(calib, "el auto-grid debe encontrar la rejilla");
  const z = calib.gridZone;
  const tema = VisionService.detectThemeFromSnapshot(img, z.x, z.y, z.w, z.h);
  const auto = VisionService.buildAutoGrid(img, z, tema, calib);
  return { img, tema, auto };
}

function ocrCLI(cvs) {
  const f = path.join(fs.mkdtempSync(path.join(RAIZ, "..", ".ocr-")), "c.png");
  fs.writeFileSync(f, encodePng({ width: cvs.width, height: cvs.height, data: cvs.data }));
  const r = spawnSync("tesseract", [f, "-", "--tessdata-dir", path.join(RAIZ, "..", "deploy", "js"), "--psm", "6"],
    { encoding: "utf8" });
  fs.rmSync(path.dirname(f), { recursive: true, force: true });
  return (r.stdout || "").trim().split(/\s+/).filter(Boolean).map((w) => w.toUpperCase());
}

for (const [archivo, verdad] of Object.entries(CAPTURAS)) {
  const dir = verdad.dir || DIR;
  const falta = !fs.existsSync(path.join(dir, archivo)) && `sin ${archivo} en ${dir}`;

  test(`${archivo}: las 18 cantidades`, { skip: falta || (!verdad.badges && "sin verdad de badges") }, async () => {
    const { img, tema, auto } = lee(archivo, dir);
    const fallos = [];
    for (const cell of auto.cellRects) {
      const i = cell.r * auto.cols + cell.c;
      if (i >= verdad.badges.length) continue;
      const q = await leeCantidadBadge(img, cell, auto.cellW, auto.cellH, tema);
      if (q.qty !== verdad.badges[i]) fallos.push(`r${cell.r}c${cell.c}: ${q.qty} (real ${verdad.badges[i]})`);
    }
    assert.deepEqual(fallos, []);
  });

  test(`${archivo}: los 18 nombres`, { skip: falta || (!hayTesseract && "tesseract no instalado") }, async () => {
    const { img, tema, auto } = lee(archivo, dir);
    // Igual que producción: primero se vota UN color de nombre para toda la página y ese es el
    // que binariza cada celda. Sin eso se mide el color celda a celda y el arte gana en las
    // cards con una pieza metálica grande — leer con pageColor=null es la ruta de RESPALDO,
    // no la que corre el escáner.
    OCRRepository.recognize = async (_w, cvs) => ({ data: { words: ocrCLI(cvs).map((text) => ({ text })) } });
    const colorPagina = await electPageNameColor({}, img, auto.cellRects.map((cell) => ({ cell })),
      auto.cellW, Math.round(auto.cellH * 0.50), Math.round(auto.cellH * 0.48), tema);
    assert.ok(colorPagina, "debe elegirse un color de nombre para la página");

    const fallos = [];
    for (const cell of auto.cellRects) {
      const i = cell.r * auto.cols + cell.c;
      if (i >= verdad.nombres.length) continue;
      const banda = [Math.round(auto.cellH * 0.50), Math.round(auto.cellH * 0.48)];
      const { cvs } = cellNameMask(img, cell, auto.cellW, ...banda, tema, colorPagina);
      let m = OCRService.getValidItemMatch(ocrCLI(cvs));
      // El mismo rescate que scanner.service.js: antes de rendirse, la celda se relee con SU
      // color. El de la página lo vota el conjunto y en una card con arte claro y grande no
      // aísla el nombre — es justo lo que pasa en la celda de Neuroptics de baruuk.png.
      if (!m) {
        const propio = cellNameMask(img, cell, auto.cellW, ...banda, tema, null);
        m = OCRService.getValidItemMatch(ocrCLI(propio.cvs));
      }
      if (m?.originalName !== verdad.nombres[i]) {
        fallos.push(`r${cell.r}c${cell.c}: ${m?.originalName || "sin match"} (real ${verdad.nombres[i]})`);
      }
    }
    assert.deepEqual(fallos, []);
  });

  test(`${archivo}: el recorte del nombre aguanta una rejilla desalineada`,
    { skip: falta || (!hayTesseract && "tesseract no instalado") || (!verdad.desvio && "sin desvío medido") },
    async () => {
      // En vivo la rejilla no cae siempre clavada y en el overlay se ven restos de la celda de
      // al lado colándose por delante ("ZA BAZA PRIME BLUEPRINT", "NN 3 BOAR PRIME STOCK").
      // La reacción natural —estrechar el recorte— es la equivocada, y por eso está medido aquí:
      // el nombre va CENTRADO y ocupa casi toda la celda, así que estrechar corta el nombre
      // antes que el ruido. Con 16 px de desfase, ancho completo saca 18/18 y al 86% baja a
      // 14/18. El ruido de delante lo absorbe getValidItemMatch; perder letras del nombre, no.
      const { img, tema, auto } = lee(archivo, dir);
      OCRRepository.recognize = async (_w, cvs) => ({ data: { words: ocrCLI(cvs).map((text) => ({ text })) } });
      const y = Math.round(auto.cellH * 0.50), h = Math.round(auto.cellH * 0.48);
      const color = await electPageNameColor({}, img, auto.cellRects.map((cell) => ({ cell })), auto.cellW, y, h, tema);

      const aciertos = (desfase, ancho) => {
        const w = Math.round(auto.cellW * ancho);
        const margen = Math.round((auto.cellW - w) / 2);
        let ok = 0;
        for (const cell of auto.cellRects) {
          const i = cell.r * auto.cols + cell.c;
          const { cvs } = cellNameMask(img, { ...cell, sx: cell.sx + desfase + margen }, w, y, h, tema, color);
          if (OCRService.getValidItemMatch(ocrCLI(cvs))?.originalName === verdad.nombres[i]) ok++;
        }
        return ok;
      };

      assert.equal(aciertos(verdad.desvio, 1), 18,
        `el ancho completo tiene que aguantar ${verdad.desvio} px de desvío`);
      assert.ok(aciertos(verdad.desvio, 0.86) < aciertos(verdad.desvio, 1),
        "si estrechar dejara de perder nombres, revisa esta decisión con la medida en la mano");
    });
}
