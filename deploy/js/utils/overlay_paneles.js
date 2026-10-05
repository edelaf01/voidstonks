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

const POS_RIVEN = { x: 0.015, y: 0.2, anclaje: "izquierda" };
const TONO_GRADO = { S: "gradoS", A: "gradoA", B: "gradoB", C: "gradoC", F: "gradoF" };

export const tonoGrado = (grado) => TONO_GRADO[(grado || "")[0]] || "blanco";

const tirada = (s) => (s.grado ? `${s.grado}${Number.isFinite(s.pct) ? ` · p${Math.round(s.pct)}` : ""}` : "");

const filasStats = (stats, rotulos = {}) => {
  const conCampos = stats.some((s) => s.calidad || s.grado);
  return [
    ...(conCampos && rotulos.atributo ? [[{ texto: "", tono: "gris" }, { texto: rotulos.atributo, tono: "gris" }, { texto: rotulos.tirada, tono: "gris" }]] : []),
    ...stats.map((s) => [
      { texto: s.texto, tono: s.positivo ? "verde" : "rojo" },
      ...(conCampos ? [s.calidad ? { texto: s.calidad.texto, tono: s.calidad.tono } : { texto: "", tono: "gris" }, { texto: tirada(s), tono: tonoGrado(s.grado) }] : []),
    ]),
  ];
};

export function panelRiven({ arma, valor = null, min = null, max = null, grado = null, score = null, stats = [], rotulos }) {
  const filas = [];
  if (valor != null) filas.push([{ texto: rotulos.valor, tono: "gris" }, { texto: `~${valor}p`, tono: "oro" }, { texto: `${min}–${max}p`, tono: "gris" }]);
  if (grado) filas.push([{ texto: rotulos.grado, tono: "gris" }, { texto: grado, tono: tonoGrado(grado) }, { texto: `${score}/100`, tono: "gris" }]);
  return {
    ...POS_RIVEN,
    bloques: [
      { tipo: "titulo", texto: arma, tono: "cian" },
      ...(filas.length ? [{ tipo: "lista", filas }, { tipo: "separador" }] : []),
      { tipo: "lista", filas: filasStats(stats, rotulos) },
    ],
  };
}

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
        ...filasStats(tr.stats, i === 0 ? rotulos : {}),
      ],
    });
  });
  return { ...POS_RIVEN, borde: "valor", bloques };
}

export const MAX_RELIQUIAS = 6;
export const POR_ERA = 2;
export const ORDEN_ERAS = ["Lith", "Meso", "Neo", "Axi", "Requiem"];
const POS_RELIQUIAS = { x: 0.985, y: 0.08, anclaje: "derecha", anchoMin: 0.2 };

const plantilla = (texto, datos) => String(texto || "").replace(/\{(\w+)\}/g, (_, k) => datos[k] ?? "");
const sinPrime = (set) => String(set || "").replace(/ Prime$/, "");

function piezaClave(parts = []) {
  return parts.find((pz) => pz.missing === 1) || [...parts].sort((a, b) => a.missing - b.missing)[0] || null;
}

function unicasPorSet(picks) {
  const vistas = new Map();
  const out = [];
  for (const p of picks) {
    const clave = `${p.tier}|${(p.clave || piezaClave(p.parts))?.set ?? p.relic}`;
    if (vistas.has(clave)) {
      vistas.get(clave).otras += 1;
      continue;
    }
    const fila = { ...p, otras: 0 };
    vistas.set(clave, fila);
    out.push(fila);
  }
  return out;
}

const conImagen = (celda, ruta) => (ruta ? { ...celda, imagen: ruta } : celda);
const pct = (x) => (x > 0 && x < 0.01 ? "<1%" : `${Math.round((x || 0) * 100)}%`);
const corta = (pieza, set) => String(pieza || "").replace(set ? `${set} ` : "", "").replace(" Prime", "");
const nombreRefino = (r, t) => t.relicsRefNames?.[r] || r || "";
const celdaMejor = (r, t, tono, sufijo = "") => ({ texto: plantilla(t.relicsBestRef, { ref: nombreRefino(r, t) }) + sufijo, tono });
const celdaRefino = (p, t, sufijo = "") => celdaMejor(p.refino, t, "cian", p.refino === "Intact" ? "" : sufijo);

function celdaGanancia(p, pz, t, sufijo = "") {
  const g = p.ganancia;
  if (!p.mejorRefino || p.mejorRefino === p.refino) return [celdaMejor(p.refino, t, "verde")];
  if (!g) return [celdaMejor(p.mejorRefino, t, "naranja", sufijo)];
  const pieza = g.pieza !== pz?.name ? `${corta(g.pieza, g.set)} ` : "";
  return [{ texto: `${plantilla(t.relicsAtRef, { ref: t.relicsRefShort?.[g.refino] || g.refino })} ${pieza}${pct(g.chance)}${sufijo}`, tono: "naranja" }];
}

function filaSets(p, t, conRefino, iconoDe) {
  const pz = p.clave || piezaClave(p.parts);
  const otras = p.otras ? ` +${p.otras}` : "";
  const estado = !pz ? { texto: "", tono: "apagado" }
    : pz.missing === 1 ? { texto: plantilla(t.relicsCloses, { set: sinPrime(pz.set) }) + otras, tono: "verde" }
      : { texto: plantilla(t.relicsMissing, { set: sinPrime(pz.set), m: pz.missing, t: pz.total }) + otras, tono: "apagado" };
  return [
    { texto: `${p.relic} ×${p.owned}`, tono: "blanco" },
    estado,
    conImagen({ texto: pz ? `${corta(pz.name, pz.set)} ${pct(pz.chance)}` : "", tono: "gris" }, pz && iconoDe?.(pz.name)),
    pz?.price ? { texto: String(Math.round(pz.price)), tono: "oro", icono: "plat" } : { texto: "", tono: "oro" },
    ...(conRefino ? [celdaRefino(p, t)] : celdaGanancia(p, pz, t)),
  ];
}

function filaValor(p, t, conRefino, icono, iconoDe) {
  const m = p.mejor || {};
  const sufijo = p.porVestigio > 0 && p.mejorRefino !== "Intact"
    ? ` · ${plantilla(t.relicsPerTrace, { n: p.porVestigio.toFixed(2), u: icono === "ducado" ? " duc" : "p" })}` : "";
  return [
    { texto: `${p.relic} ×${p.owned}`, tono: "blanco" },
    conImagen({ texto: corta(m.name), tono: "gris" }, m.name && iconoDe?.(m.name)),
    { texto: String(Math.round(m.valor || 0)), tono: icono === "ducado" ? "ducado" : "oro", icono },
    { texto: pct(m.chance), tono: "gris" },
    ...(conRefino ? [celdaRefino(p, t, sufijo)] : celdaGanancia(p, m, t, sufijo)),
  ];
}

function filasPorEra(picks, fila) {
  const filas = [];
  let usadas = 0;
  for (const era of ORDEN_ERAS) {
    const suyas = picks.filter((p) => p.tier === era).slice(0, Math.min(POR_ERA, MAX_RELIQUIAS - usadas));
    if (!suyas.length) continue;
    filas.push([{ texto: era.toUpperCase(), tono: "cian" }], ...suyas.map(fila));
    usadas += suyas.length;
    if (usadas >= MAX_RELIQUIAS) break;
  }
  return filas;
}

export const OBJETIVOS_BOTONES = ["sets", "plat", "ducados"];
export const REFINOS_BOTONES = ["Any", "Intact", "Exceptional", "Flawless", "Rad"];

export function controlesReliquias(t, { refino, escuadra, era, objetivo = "sets" }) {
  return [
    { tipo: "botones", rotulo: t.relicsGoalLabel, botones: OBJETIVOS_BOTONES.map((o) => ({ texto: t.relicsGoals?.[o] || o, accion: `objetivo:${o}`, activo: o === objetivo })) },
    { tipo: "botones", rotulo: t.relicsRefLabel, botones: REFINOS_BOTONES.map((r) => ({ texto: r === "Any" ? t.relicsAnyRef || r : t.relicsRefShort?.[r] || r, accion: `refino:${r}`, activo: r === (refino || "Any") })) },
    { tipo: "botones", rotulo: t.relicsSquadLabel, botones: [1, 2, 3, 4].map((n) => ({ texto: String(n), accion: `escuadra:${n}`, activo: n === escuadra })) },
    { tipo: "botones", rotulo: t.relicsEraLabel, botones: ["ALL", ...ORDEN_ERAS].map((e) => ({ texto: e === "ALL" ? t.relicsAllEras : e.slice(0, 3), accion: `era:${e}`, activo: (era || "ALL") === e })) },
  ];
}

export function panelReliquias(picks, era, t, { reliquiasEnApp = 1, refino = null, escuadra = null, objetivo = "sets", iconoDe = null } = {}) {
  const sets = objetivo === "sets";
  const lista = sets ? unicasPorSet(picks || []) : (picks || []);
  const cuenta = sets && picks?.length ? plantilla(t.relicsUseful, { n: picks.length }) : "";
  const bloques = [{ tipo: "titulo", texto: [t.relicsTitle, era, cuenta].filter(Boolean).join(" · "), tono: "cian" }];
  if (escuadra) bloques.push(...controlesReliquias(t, { refino, escuadra, era, objetivo }));
  if (!lista.length) {
    const texto = !reliquiasEnApp ? t.relicsEmpty : sets ? t.relicsNone : t.relicsNoValue;
    bloques.push({ tipo: "lista", filas: [[{ texto, tono: "gris" }]] });
    return { ...POS_RELIQUIAS, bloques };
  }
  const fila = sets ? (p) => filaSets(p, t, !refino, iconoDe) : (p) => filaValor(p, t, !refino, objetivo === "ducados" ? "ducado" : "plat", iconoDe);
  const filas = era ? lista.slice(0, MAX_RELIQUIAS).map(fila) : filasPorEra(lista, fila);
  bloques.push({ tipo: "separador" }, { tipo: "lista", filas });
  return { ...POS_RELIQUIAS, bloques };
}

export function panelInventario({ detectados = 0, auto = false, escaneando = false, capturada = false }, t) {
  return {
    x: 0.985,
    y: 0.085,
    anclaje: "derecha",
    bloques: [
      { tipo: "titulo", texto: t.statusInventory, tono: "ducado" },
      {
        tipo: "estado",
        texto: capturada ? t.autoScanCaptured : (escaneando ? t.autoScanScanning : `${t.lblDetected}: ${detectados}`),
        tono: capturada ? "verde" : (escaneando ? "cian" : "verde")
      },
      {
        tipo: "botones",
        botones: [
          { texto: t.ovlScanPage, accion: "inv:escanear" },
          { texto: t.ovlAuto, accion: "inv:auto", activo: !!auto },
          { texto: t.ovlSave, accion: "inv:guardar" }
        ]
      }
    ]
  };
}

export function panelArcanos(filas, t) {
  if (!filas?.length) return null;
  return {
    x: 0.985, y: 0.085, anclaje: "derecha",
    bloques: [
      { tipo: "titulo", texto: t.scannerHUD.statusArcanes, tono: "ducado" },
      {
        tipo: "lista",
        filas: filas.slice(0, 18).map(({ name, qty, maxRank, rangosMax, accion }) => {
          let textoVeredicto = "…";
          let tonoVeredicto = "gris";
          if (accion === "sell_max") {
            textoVeredicto = `${t.vosfor.verdictSell} R${maxRank}`;
            tonoVeredicto = "verde";
          } else if (accion === "sell_r0") {
            textoVeredicto = t.vosfor.verdictSellR0;
            tonoVeredicto = "verde";
          } else if (accion === "dissolve") {
            textoVeredicto = t.vosfor.verdictDissolve;
            tonoVeredicto = "cian";
          } else if (accion === "even") {
            textoVeredicto = t.vosfor.verdictEven;
            tonoVeredicto = "gris";
          }

          return [
            { texto: name },
            { texto: String(qty) },
            { texto: rangosMax > 0 ? `${rangosMax}×R${maxRank}` : "" },
            { texto: textoVeredicto, tono: tonoVeredicto },
          ];
        }),
      },
    ],
  };
}
