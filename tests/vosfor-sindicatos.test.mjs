import { test } from "node:test";
import assert from "node:assert/strict";
import { rentaSindicatos, slugsDeSindicatos } from "../deploy/js/utils/vosfor_sindicatos.js";

const data = {
  tradables: { cascadia_flare: ["Cascadia Flare", "Destello Cascadia", 5], molt_vigor: ["Molt Vigor", "Vigor Muda", 3], magus_lockdown: ["Magus Lockdown", "Bloqueo Magus", 5] },
  sindicatos: [
    { id: "VoxSyndicate", en: "Vox Solaris", es: "Vox Solaris", ofertas: [{ slug: "magus_lockdown", standing: 10000, rango: 0 }] },
    { id: "ZarimanSyndicate", en: "The Holdfasts", es: "Los Inquebrantables", ofertas: [
      { slug: "cascadia_flare", standing: 5500, rango: 1 },
      { slug: "molt_vigor", standing: 5000, rango: 2 },
    ] },
  ],
};
const stats = new Map([
  ["cascadia_flare", { r0: 11, max: 330 }],
  ["molt_vigor", { r0: 4, max: 90 }],
]);
const deps = { stats, precioSuelto: (st) => st.r0, precioMax: (st) => st.max };

test("platino por cada 1.000 de reputación, suelto o comprando las copias del rango máximo", () => {
  const [holdfasts, vox] = rentaSindicatos(data, deps);
  assert.equal(holdfasts.id, "ZarimanSyndicate", "primero el sindicato que más rinde");
  const flare = holdfasts.filas.find((f) => f.slug === "cascadia_flare");
  assert.equal(flare.copias, 21);
  assert.equal(+flare.porMilSuelto.toFixed(3), +(11 * 1000 / 5500).toFixed(3));
  assert.equal(+flare.porMilSet.toFixed(3), +(330 * 1000 / (5500 * 21)).toFixed(3));
  assert.equal(flare.mejor, "set");
  const vigor = holdfasts.filas.find((f) => f.slug === "molt_vigor");
  assert.equal(vigor.copias, 10, "los de rango máximo 3 piden 10 copias");
  assert.equal(vigor.mejor, "set");
  assert.deepEqual(holdfasts.filas.map((f) => f.slug), ["cascadia_flare", "molt_vigor"]);
  assert.deepEqual(vox.filas.map((f) => [f.cargado, f.renta]), [[false, 0]], "sin precio aún no se inventa nada");
});

test("los arcanos de todos los sindicatos, sin repetir, para pedir sus precios", () => {
  assert.deepEqual(slugsDeSindicatos(data).sort(), ["cascadia_flare", "magus_lockdown", "molt_vigor"]);
  assert.deepEqual(slugsDeSindicatos({}), []);
});

const conVosfor = { ...data, arcanes: { cascadia_flare: { vosfor: 22 }, molt_vigor: { vosfor: 22 } } };

test("vosfor por cada 1.000 de reputación y su equivalente en platino", () => {
  const [holdfasts] = rentaSindicatos(conVosfor, { ...deps, tasaPl: 0.5, orden: "vos" });
  assert.equal(holdfasts.mejorVos.slug, "molt_vigor");
  assert.equal(+holdfasts.mejorVos.vosPorMil.toFixed(3), 4.4);
  assert.equal(+holdfasts.mejorVos.plEquivalente.toFixed(3), 2.2);
  assert.deepEqual(holdfasts.filas.map((f) => f.slug), ["molt_vigor", "cascadia_flare"]);
  assert.equal(holdfasts.mejorPl.slug, "cascadia_flare");
  assert.equal(holdfasts.disolverRindeMas, false);
  assert.equal(rentaSindicatos(conVosfor, { ...deps, tasaPl: 2 })[0].disolverRindeMas, true);
});

test("un arcano sin valor de vosfor queda sin dato", () => {
  const vox = rentaSindicatos(conVosfor, deps).find((s) => s.id === "VoxSyndicate");
  assert.equal(vox.filas[0].vosfor, null);
  assert.equal(vox.filas[0].vosPorMil, null);
  assert.equal(vox.mejorVos, null);
  assert.equal(vox.disolverRindeMas, false);
});
