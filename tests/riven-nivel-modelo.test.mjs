import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

globalThis.localStorage = { getItem: () => null, setItem: () => {} };

const MODELO = {
  armas: {
    Larkspur: { nivel: 4.66, log_n: 3, tipo: "Rifle" },
    Boar: { nivel: 4.569, log_n: 3, tipo: "Shotgun" },
    Braton: { nivel: 4.086, log_n: 3, tipo: "Rifle" },
    Redeemer: { nivel: 6, log_n: 3, tipo: "Melee" }
  },
  efectos: { pos_local: {}, pos_global: {}, neg_local: {}, neg_global: {} },
  ref_pos: {},
  ref_neg: {},
  mag_por_defecto: 0.5,
  stats_pos: [],
  stats_neg: [],
  tipos: [],
  modelo: { base: [0, 0, 0, 0, 0], arboles: [[], [], [], [], []] },
  rho: 0.7
};

globalThis.fetch = async (url) => {
  const base = String(url).split("/").pop().split("?")[0];
  if (base === "de10.json") {
    const buf = fs.readFileSync(new URL("./fixtures/de10_fijo.json", import.meta.url));
    return { ok: true, json: async () => JSON.parse(buf.toString()) };
  }
  if (base === "nivel_y_tirada.json") {
    return { ok: true, json: async () => JSON.parse(JSON.stringify(MODELO)) };
  }
  return { ok: false, status: 404, json: async () => ({}) };
};

const N = await import("../deploy/js/utils/rivens/riven_ml.js");
const NT = await import("../deploy/js/utils/rivens/riven_nivel.js");

const STATS = [
  { name: "Critical Chance", value: 120, isPositive: true },
  { name: "Critical Damage", value: 120, isPositive: true },
  { name: "Zoom", value: 30, isPositive: false }
];

const QS = [0.25, 0.5, 0.8, 0.9, 0.95];

test("desfaseNivel devuelve NaN con argumentos nulos o sin propiedades requeridas", () => {
  assert.ok(Number.isNaN(NT.desfaseNivel(null, { familias: {} })));
  assert.ok(Number.isNaN(NT.desfaseNivel({}, { familias: {} })));
  assert.ok(Number.isNaN(NT.desfaseNivel({ armas: {} }, null)));
  assert.ok(Number.isNaN(NT.desfaseNivel({ armas: {} }, {})));
});

test("desfaseNivel calcula la mediana con n impar y n par", () => {
  const mImpar = {
    armas: {
      A: { nivel: 1 },
      B: { nivel: 2 },
      C: { nivel: 3 }
    }
  };
  const deImpar = {
    familias: {
      a: [2, 1, 100, 3, 10],
      b: [4, 1, 100, 3, 10],
      c: [3.5, 1, 100, 3, 10]
    }
  };
  assert.equal(NT.desfaseNivel(mImpar, deImpar), 1);

  const mPar = {
    armas: {
      A: { nivel: 1 },
      B: { nivel: 2 },
      C: { nivel: 3 },
      D: { nivel: 4 }
    }
  };
  const dePar = {
    familias: {
      a: [2, 1, 100, 3, 10],
      b: [4, 1, 100, 3, 10],
      c: [6, 1, 100, 3, 10],
      d: [8, 1, 100, 3, 10]
    }
  };
  assert.equal(NT.desfaseNivel(mPar, dePar), 2.5);
});

test("desfaseNivel solo cuenta familias con pop10 mayor o igual a 3 y una vez por familia", () => {
  const m = {
    armas: {
      Kohm: { nivel: 2 },
      "Kuva Kohm": { nivel: 999 },
      Braton: { nivel: 4 },
      Ignis: { nivel: 0 }
    }
  };
  const de = {
    familias: {
      kohm: [4, 1, 100, 3, 10],
      braton: [5, 1, 100, 3, 10],
      ignis: [100, 1, 100, 2.9, 10]
    }
  };
  assert.equal(NT.desfaseNivel(m, de), 1.5);
});

test("desfaseNivel ignora niveles no finitos y devuelve NaN si no hay familias válidas", () => {
  const m = {
    armas: {
      A: { nivel: null },
      B: { nivel: NaN },
      C: { nivel: 2 }
    }
  };
  const de = {
    familias: {
      a: [10, 1, 100, 5, 10],
      b: [20, 1, 100, 5, 10],
      c: [5, 1, 100, 5, 10]
    }
  };
  assert.equal(NT.desfaseNivel(m, de), 3);

  const mSinValidas = {
    armas: {
      A: { nivel: 1 }
    }
  };
  const deSinValidas = {
    familias: {
      a: [5, 1, 100, 2, 10]
    }
  };
  assert.ok(Number.isNaN(NT.desfaseNivel(mSinValidas, deSinValidas)));
});

test("desfaseNivel recalcula con un de10 distinto para el mismo modelo", () => {
  const m = { armas: { A: { nivel: 1 } } };
  const d1 = { familias: { a: [3, 1, 100, 5, 10] } };
  const v1 = NT.desfaseNivel(m, d1);
  assert.equal(v1, 2);
  const d2 = { familias: { a: [10, 1, 100, 5, 10] } };
  assert.equal(NT.desfaseNivel(m, d2), 9);
});

test("filaConNivelModelo preserva identidad en casos no aplicables y sustituye nivel con desfase", () => {
  const modelo = NT.prepararNivelTirada({
    armas: {
      Known: { nivel: 4.5 },
      NonFinite: { nivel: NaN },
      Anchor: { nivel: 5.0 }
    },
    modelo: {},
    efectos: {}
  });
  const deValido = {
    familias: {
      anchor: [5.5, 1.0, 1000, 5, 10]
    }
  };
  const deSinOffset = {
    familias: {
      anchor: [5.5, 1.0, 1000, 1, 10]
    }
  };

  assert.equal(NT.filaConNivelModelo(modelo, deValido, "Known", null), null);

  const filaPop3 = [4.0, 1.0, 1000, 3, 10];
  assert.equal(NT.filaConNivelModelo(modelo, deValido, "Known", filaPop3), filaPop3);

  const filaPopMayor = [4.0, 1.0, 1000, 5, 10];
  assert.equal(NT.filaConNivelModelo(modelo, deValido, "Known", filaPopMayor), filaPopMayor);

  const filaBaja = [4.0, 1.0, 1000, 1.5, 10];
  assert.equal(NT.filaConNivelModelo(modelo, deValido, "UnknownWeapon", filaBaja), filaBaja);
  assert.equal(NT.filaConNivelModelo(modelo, deValido, "NonFinite", filaBaja), filaBaja);
  assert.equal(NT.filaConNivelModelo(modelo, deSinOffset, "Known", filaBaja), filaBaja);

  const filaClon = [...filaBaja];
  const resultado = NT.filaConNivelModelo(modelo, deValido, "Known", filaBaja);
  assert.notEqual(resultado, filaBaja);
  assert.deepEqual(filaBaja, filaClon);

  assert.deepEqual(resultado.slice(1), filaBaja.slice(1));
  assert.deepEqual(resultado, [5.0, 1.0, 1000, 1.5, 10]);
});

test("integración: Redeemer sin DE en vivo usa fuente modelo y escala con el nivel", async () => {
  const nt = await NT.cargarNivelTirada();
  const redeemer = { name: "Redeemer", t: "Melee" };
  const band = await N.predictRivenMLBand(redeemer, STATS, redeemer, null, 75);
  assert.equal(band.fuente, "modelo");
  assert.equal(band.p50, 665);
  const origNivel = nt.armas.Redeemer.nivel;
  try {
    nt.armas.Redeemer.nivel += 1;
    const band2 = await N.predictRivenMLBand(redeemer, STATS, redeemer, null, 75);
    assert.equal(band2.fuente, "modelo");
    assert.ok(Math.abs(band2.p50 / band.p50 - Math.E) < 0.005);
  } finally {
    nt.armas.Redeemer.nivel = origNivel;
  }
});

test("integración: arma con pop baja en DE en vivo no queda anclada al suelo", async () => {
  const wPop1 = {
    name: "Redeemer",
    t: "Melee",
    de_rerolled: { median: 4000, pop: 1 }
  };
  const bandPop1 = await N.predictRivenMLBand(wPop1, STATS, wPop1, null, 75);
  assert.equal(bandPop1.floor, 1800);
  assert.ok(bandPop1.p25 < bandPop1.floor);
  assert.ok(bandPop1.p50 < bandPop1.floor);

  const wPop3 = {
    name: "Redeemer",
    t: "Melee",
    de_rerolled: { median: 4000, pop: 3 }
  };
  const bandPop3 = await N.predictRivenMLBand(wPop3, STATS, wPop3, null, 75);
  assert.ok(bandPop3.p25 >= bandPop3.floor);
  assert.equal(bandPop3.p50, bandPop3.floor);

  const wUnPop1 = {
    name: "Redeemer",
    t: "Melee",
    de_rerolled: { median: 4000, pop: 5 },
    de_unrolled: { median: 2000, pop: 1 }
  };
  const bandUnPop1 = await N.predictRivenMLBand(wUnPop1, STATS, wUnPop1, null, 75);
  assert.equal(bandUnPop1.floor, 900);
  assert.ok(bandUnPop1.p50 < bandUnPop1.floor);

  const wSoloUn = {
    name: "Redeemer",
    t: "Melee",
    de_unrolled: { median: 4000, pop: 1 }
  };
  const bandSoloUn = await N.predictRivenMLBand(wSoloUn, STATS, wSoloUn, null, 75);
  assert.equal(bandSoloUn.floor, 1800);
  assert.ok(bandSoloUn.p50 < bandSoloUn.floor);

  const wUnMayor = {
    name: "Redeemer",
    t: "Melee",
    de_rerolled: { median: 2000, pop: 1 },
    de_unrolled: { median: 3000, pop: 10 }
  };
  const bandUnMayor = await N.predictRivenMLBand(wUnMayor, STATS, wUnMayor, null, 75);
  assert.equal(bandUnMayor.floor, 900);
  assert.equal(bandUnMayor.p50, 665);
});

test("integración: arma popular mantiene precios idénticos", async () => {
  const de10 = await NT.cargarDe10();
  const larkspur = { name: "Larkspur", t: "Rifle" };
  const band = await N.predictRivenMLBand(larkspur, STATS, larkspur, null, 75);
  assert.equal(band.fuente, "de10");
  assert.deepEqual(
    [band.p25, band.p50, band.p80, band.p90, band.p95],
    NT.preciosDe10(de10.familias.larkspur, 0.5, QS, 0.7).map(Math.round)
  );

  const larkLive = {
    name: "Larkspur",
    t: "Rifle",
    de_rerolled: { median: 450, pop: 12, stddev: 300, max_price: 3000 },
    de_unrolled: { median: 357, pop: 8 }
  };
  const bandLive = await N.predictRivenMLBand(larkLive, STATS, larkLive, null, 75);
  assert.equal(bandLive.fuente, "de10");
  assert.equal(bandLive.floor, 161);
  const raw = NT.preciosDe10(de10.familias.larkspur, 0.5, QS, 0.7);
  const q = raw.map(v => Math.max(161, Math.round(v)));
  for (let i = 1; i < q.length; i++) q[i] = Math.max(q[i], q[i - 1]);
  assert.deepEqual([bandLive.p25, bandLive.p50, bandLive.p80, bandLive.p90, bandLive.p95], q);
});
