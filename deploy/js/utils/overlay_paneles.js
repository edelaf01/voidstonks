// Paneles del overlay para las pantallas del escáner (las recompensas van en inventory/reward_labels.js).

// Bajo la barra de créditos y antes de la mesa de venta, que empieza al 19 % del alto.
export const MAX_FILAS_KIOSKO = 5;

export function panelKiosko(items, titulo) {
  if (!items?.length) return null;
  return {
    x: 0.985, y: 0.085, anclaje: "derecha",
    bloques: [
      { tipo: "titulo", texto: titulo, tono: "ducado" },
      {
        tipo: "lista",
        filas: items.slice(0, MAX_FILAS_KIOSKO).map(({ name, qty, plat, ratio, ducats }) => [
          { texto: `${qty}× ${name}` },
          ...(plat == null ? [] : [{ texto: `${plat}p`, tono: "cian" }]),
          ...(ratio == null ? [] : [{ texto: `${ratio === Infinity ? "∞" : ratio.toFixed(1)} d/pl` }]),
          ...(ducats == null ? [] : [{ texto: String(ducats), tono: "ducado" }]),
        ]),
      },
    ],
  };
}

// Rivens: a la izquierda del ciclo de Kuva, que tiene las cartas en el centro.
const POS_RIVEN = { x: 0.015, y: 0.2, anclaje: "izquierda" };
const TONO_GRADO = { S: "gradoS", A: "gradoA", B: "gradoB", C: "gradoC", F: "gradoF" };

export const tonoGrado = (grado) => TONO_GRADO[(grado || "")[0]] || "blanco";

const filasStats = (stats) => stats.map((s) => [
  { texto: s.texto, tono: s.positivo ? "verde" : "rojo" },
  ...(s.grado ? [{ texto: `[${s.grado}]`, tono: tonoGrado(s.grado) }] : []),
]);

/** Una carta: { arma, valor, min, max, grado, score, stats: [{ texto, positivo, grado }], rotulos } */
export function panelRiven({ arma, valor = null, min = null, max = null, grado = null, score = null, stats = [], rotulos }) {
  const filas = [];
  if (valor != null) filas.push([{ texto: rotulos.valor, tono: "gris" }, { texto: `~${valor}p`, tono: "oro" }, { texto: `${min}–${max}p`, tono: "gris" }]);
  if (grado) filas.push([{ texto: rotulos.grado, tono: "gris" }, { texto: grado, tono: tonoGrado(grado) }, { texto: `${score}/100`, tono: "gris" }]);
  return {
    ...POS_RIVEN,
    bloques: [
      { tipo: "titulo", texto: arma, tono: "cian" },
      ...(filas.length ? [{ tipo: "lista", filas }, { tipo: "separador" }] : []),
      { tipo: "lista", filas: filasStats(stats) },
    ],
  };
}

/** El ciclo: { arma, ganador: 0|1, tiradas: [{ rotulo, precio, score, stats }], rotulos } */
export function panelRivenComparacion({ arma, ganador, tiradas, rotulos }) {
  const bloques = [
    { tipo: "titulo", texto: arma, tono: "cian" },
    { tipo: "chips", chips: [{ texto: `${tiradas[ganador].rotulo} ${rotulos.mejor}`, tipo: "valor" }] },
  ];
  tiradas.forEach((tr, i) => {
    bloques.push({ tipo: "separador" }, {
      tipo: "lista",
      filas: [
        [{ texto: tr.rotulo, tono: i === ganador ? "verde" : "gris" }, { texto: `~${tr.precio}p`, tono: "oro" }, { texto: `${tr.score}/100`, tono: "gris" }],
        ...filasStats(tr.stats),
      ],
    });
  });
  return { ...POS_RIVEN, borde: "valor", bloques };
}

export const MAX_RELIQUIAS = 8;
export const POR_ERA = 2;
export const ORDEN_ERAS = ["Lith", "Meso", "Neo", "Axi", "Requiem"];
const POS_RELIQUIAS = { x: 0.985, y: 0.08, anclaje: "derecha" };

const plantilla = (texto, datos) => String(texto || "").replace(/\{(\w+)\}/g, (_, k) => datos[k] ?? "");
const sinPrime = (set) => String(set || "").replace(/ Prime$/, "");

function piezaClave(parts = []) {
  return parts.find((pz) => pz.missing === 1) || [...parts].sort((a, b) => a.missing - b.missing)[0] || null;
}

function filaReliquia(p, t, refinoActual) {
  const datos = [p.odds ? `${Math.round(p.odds * 100)}%` : "", p.value ? `~${Math.round(p.value)}p` : ""].filter(Boolean).join(" · ");
  const pz = piezaClave(p.parts);
  const estado = !pz ? { texto: "", tono: "apagado" }
    : pz.missing === 1 ? { texto: plantilla(t.relicsCloses, { set: sinPrime(pz.set) }), tono: "verde" }
      : { texto: plantilla(t.relicsMissing, { set: sinPrime(pz.set), m: pz.missing, t: pz.total }), tono: "apagado" };
  const refino = p.refino
    ? { texto: t.relicsRefShort?.[p.refino] || p.refino, tono: p.refino === refinoActual ? "cian" : "naranja" }
    : { texto: "", tono: "apagado" };
  return [{ texto: `${p.relic} ×${p.owned}`, tono: "blanco" }, { texto: datos, tono: "oro" }, estado, refino];
}

function filasPorEra(picks, t, refinoActual) {
  const filas = [];
  let usadas = 0;
  for (const era of ORDEN_ERAS) {
    const suyas = picks.filter((p) => p.tier === era).slice(0, Math.min(POR_ERA, MAX_RELIQUIAS - usadas));
    if (!suyas.length) continue;
    filas.push([{ texto: era.toUpperCase(), tono: "cian" }], ...suyas.map((p) => filaReliquia(p, t, refinoActual)));
    usadas += suyas.length;
    if (usadas >= MAX_RELIQUIAS) break;
  }
  return filas;
}

export function panelReliquias(picks, era, t, { reliquiasEnApp = 1, refino = null, escuadra = null } = {}) {
  const titulo = [t.relicsTitle, era, picks?.length ? plantilla(t.relicsUseful, { n: picks.length }) : ""].filter(Boolean).join(" · ");
  const bloques = [{ tipo: "titulo", texto: titulo, tono: "cian" }];
  if (refino && escuadra) {
    bloques.push({ tipo: "estado", texto: plantilla(t.relicsSetup, { ref: t.relicsRefNames?.[refino] || refino, n: escuadra }), tono: "cian" });
  }
  if (!picks?.length) {
    bloques.push({ tipo: "lista", filas: [[{ texto: reliquiasEnApp ? t.relicsNone : t.relicsEmpty, tono: "gris" }]] });
    return { ...POS_RELIQUIAS, bloques };
  }
  const filas = era
    ? picks.slice(0, MAX_RELIQUIAS).map((p) => filaReliquia(p, t, refino))
    : filasPorEra(picks, t, refino);
  bloques.push({ tipo: "separador" }, { tipo: "lista", filas });
  return { ...POS_RELIQUIAS, bloques };
}
