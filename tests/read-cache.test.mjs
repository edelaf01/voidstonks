// Lecturas por objeto, válidas mientras su recorte no cambie (utils/vision/read_cache.js).
//
// Fin de misión releía las 20 casillas en cada vuelta de una pantalla quieta. La caché
// devuelve la lectura guardada si el hash del recorte sigue dentro de la tolerancia, y nada si
// la casilla cambió (otra recompensa al desplazar el panel) o nunca se leyó.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createReadCache } from "../deploy/js/utils/vision/read_cache.js";

const hash = (v) => v.toString(16).padStart(2, "0").repeat(144);

test("devuelve la lectura guardada mientras el recorte sea el mismo, con ruido de vídeo", () => {
  const c = createReadCache(8);
  c.set("r0c2", hash(0x40), { name: "Lith K12", reliquia: true });
  assert.deepEqual(c.get("r0c2", hash(0x40)), { name: "Lith K12", reliquia: true });
  assert.deepEqual(c.get("r0c2", hash(0x45)), { name: "Lith K12", reliquia: true }, "5 de luma es ruido");
});

test("un recorte distinto o una casilla nunca leída no devuelven nada", () => {
  const c = createReadCache(8);
  c.set("r0c2", hash(0x40), { name: null, reliquia: false });
  assert.equal(c.get("r0c2", hash(0x60)), null, "otra recompensa en la misma casilla");
  assert.equal(c.get("r1c0", hash(0x40)), null);
});

test("una lectura sin resultado también se guarda: no se vuelve a pagar el OCR", () => {
  const c = createReadCache();
  c.set("r0c0", hash(0x10), { name: null, reliquia: false });
  assert.deepEqual(c.get("r0c0", hash(0x10)), { name: null, reliquia: false });
});

test("clear vacía todo (al salir de la pantalla)", () => {
  const c = createReadCache();
  c.set("a", hash(1), { name: "x" });
  assert.equal(c.size, 1);
  c.clear();
  assert.equal(c.size, 0);
  assert.equal(c.get("a", hash(1)), null);
});
