import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { decodePng, encodePng } from "./_helpers/png.mjs";
import { installFakeDocument } from "./_helpers/fake-canvas.mjs";

installFakeDocument();
const { VisionService } = await import("../deploy/js/services/scanner/vision.service.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "_fixtures", "inventory_ballistica_banshee_2531x1412.png");
const TESSDATA = path.join(__dirname, "..", "deploy", "js");

const GRID = { gx: 87, gy: 281, cellW: 277, cellH: 296, dy: -44 };

const THEME = { name: "Default", r: 227, g: 128, b: 20, actualR: 246, actualG: 129, actualB: 3 };

const CELLS = [
  { name: "r2c1 Ballistica Prime BP", r: 2, c: 1, qty: "3", cropW: 57 },
  { name: "r2c5 Banshee Prime BP", r: 2, c: 5, qty: "9", cropW: 56 },
  { name: "r0c2 Astilla Prime BP", r: 0, c: 2, qty: "3", cropW: 57 },
  { name: "r1c2 Atlas Prime BP", r: 1, c: 2, qty: "11", cropW: 69 },
  { name: "r2c2 Banshee Prime Chassis", r: 2, c: 2, qty: "3", cropW: 56 },
  { name: "r2c4 Banshee Prime Systems", r: 2, c: 4, qty: "2", cropW: 56 },
];

const snapshot = decodePng(fs.readFileSync(FIXTURE));

function cellAt(r, c) {
  return { sx: GRID.gx + c * GRID.cellW, sy: GRID.gy + r * GRID.cellH + GRID.dy };
}

function extract(snap, r, c) {
  return VisionService.extractBadgeByColor(snap, cellAt(r, c), GRID.cellW, GRID.cellH, THEME);
}

const hasTesseract = spawnSync("tesseract", ["--version"], { stdio: "ignore" }).status === 0;

function ocrBadge(badgeCvs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "badge-ocr-"));
  const file = path.join(dir, "badge.png");
  fs.writeFileSync(file, encodePng({ width: badgeCvs.width, height: badgeCvs.height, data: badgeCvs.data }));
  const res = spawnSync("tesseract", [
    file, "-", "--tessdata-dir", TESSDATA, "--psm", "7",
    "-c", "tessedit_char_whitelist= 0123456789",
  ], { encoding: "utf8" });
  fs.rmSync(dir, { recursive: true, force: true });
  return (res.stdout || "").replaceAll(/\s/g, "");
}

for (const cell of CELLS) {
  test(`extractBadgeByColor píxeles: ${cell.name} (qty real ${cell.qty})`, () => {
    const badge = extract(snapshot, cell.r, cell.c);
    assert.ok(badge, "debe devolver un canvas de badge");
    assert.ok(Math.abs(badge.cropH - 42) <= 3, `cropH ${badge.cropH} debería ser ~42 (banda del badge)`);
    assert.ok(Math.abs(badge.cropW - cell.cropW) <= 3, `cropW ${badge.cropW} debería ser ~${cell.cropW}`);
    assert.ok(badge.cropW < 70, `cropW ${badge.cropW} no debe alcanzar el arte del ítem (pre-fix: 97)`);
  });
}

// thin art line is stretched to h=18 in fixture to verify that the band filter drops it

test("extractBadgeByColor: línea de arte alargada junto al 3 de Ballistica no entra al crop (BUG 1)", () => {
  const snap = { width: snapshot.width, height: snapshot.height, data: snapshot.data.slice() };
  const { sx, sy } = cellAt(2, 1);
  const lineX = sx + 77;
  for (let y = sy - 12 + 26; y <= sy - 12 + 31; y++) {
    const o = (y * snap.width + lineX) * 4;
    snap.data[o] = THEME.actualR; snap.data[o + 1] = THEME.actualG; snap.data[o + 2] = THEME.actualB;
  }
  const badge = extract(snap, 2, 1);
  assert.ok(badge, "debe devolver un canvas de badge");
  assert.ok(badge.cropW < 70, `cropW ${badge.cropW}: la línea de arte (x=77) habría estirado el crop a ~86`);
});

for (const cell of CELLS) {
  test(`extractBadgeByColor OCR: ${cell.name} -> ${cell.qty}`, { skip: !hasTesseract && "tesseract no instalado" }, () => {
    const badge = extract(snapshot, cell.r, cell.c);
    assert.ok(badge, "debe devolver un canvas de badge");
    const digits = ocrBadge(badge);
    assert.ok(digits.endsWith(cell.qty), `OCR '${digits}' debería terminar en '${cell.qty}'`);
  });
}
