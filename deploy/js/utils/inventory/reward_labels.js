export const Y_RECOMPENSAS = 0.44;

function numero(plat) {
  return plat < 10 ? plat.toFixed(1) : String(Math.round(plat));
}

const plantilla = (texto, datos) => String(texto || "").replace(/\{(\w+)\}/g, (_, k) => datos[k] ?? "");
const sinPrime = (set) => String(set || "").replace(/ Prime$/, "");
const TONO_DESTINO = { sell: "oro", set: "morado", ducats: "cian" };

export function desgloseSet(pieza, { primeInventory = {}, setsDatabase = {}, getSetName, getRequiredCount = () => 1 } = {}) {
  const set = getSetName?.(pieza);
  const piezas = setsDatabase[set];
  if (!Array.isArray(piezas) || !piezas.includes(pieza)) return null;
  const lista = piezas.map((name) => ({ name, tengo: primeInventory[name] || 0, pide: Math.max(1, getRequiredCount(set, name) || 1) }));
  return { set, completos: Math.min(...lista.map((p) => Math.floor(p.tengo / p.pide))), piezas: lista };
}

function filasDelSet(it, d, t, precioDelSet = 0) {
  return [
    [{ texto: plantilla(t.lblSetsOwned, { n: d.completos }), tono: d.completos ? "verde" : "gris" }],
    ...(precioDelSet > 0 ? [[{ texto: t.lblSetPrice, tono: "gris" }, { texto: String(Math.round(precioDelSet)), tono: "oro", icono: "plat" }]] : []),
    ...d.piezas.map((pz) => [
      { texto: pz.name.replace(`${d.set} `, ""), tono: pz.name === it.name ? "cian" : "gris" },
      { texto: pz.pide > 1 ? `${pz.tengo}/${pz.pide}` : String(pz.tengo), tono: pz.tengo >= pz.pide ? "verde" : pz.tengo ? "blanco" : "apagado" },
    ]),
  ];
}

function filasDetalle(it, v, tienes, t, desglose = null, precioDelSet = 0) {
  const filas = [];
  if (v?.set) {
    filas.push([
      { texto: sinPrime(v.set), tono: "morado" },
      v.left === 0 ? { texto: t.lblSetCloses, tono: "verde" } : { texto: plantilla(t.lblSetLeft, { n: v.left }), tono: "gris" },
    ]);
  }
  if (v?.plat > 0 && v.route !== "none") {
    const valor = v.route === "ducats" ? it.ducats : numero(v.route === "set" ? v.setGain : v.sale);
    filas.push([{ texto: t.lblRoute, tono: "gris" }, {
      texto: plantilla(t[`lblRoute_${v.route}`], { v: valor }), tono: TONO_DESTINO[v.route], icono: v.route === "ducats" ? "ducado" : "plat",
    }]);
  }
  if (desglose) filas.push(...filasDelSet(it, desglose, t, precioDelSet));
  else if (typeof tienes === "number") filas.push([{ texto: t.lblInApp, tono: "gris" }, { texto: String(tienes), tono: tienes > 0 ? "blanco" : "apagado" }]);
  return filas;
}

export function panelesDeRecompensas(items, { anchoReferencia, mejor = null, mejores = null, cerca = null, precioSet = 0, valores = null, inventario = null, t, iconoDe = null, sets = null }) {
  const n = items.length;
  return items.map((it, i) => {
    const conX = typeof it.xPos === "number" && it.xPos > 0 && anchoReferencia > 0;
    const x = conX ? it.xPos / anchoReferencia : 0.5 + (i - (n - 1) / 2) * 0.126;
    const esMejor = mejor?.name === it.name && mejor.value.plat >= 1;
    const set = cerca?.name === it.name ? cerca : null;
    const pl = mejores?.plat?.has(it.name), duc = mejores?.ducats?.has(it.name);

    const imagen = iconoDe?.(it.name);
    const bloques = [{ tipo: "titulo", texto: String(it.name || "").replace(" Prime", ""), tono: "blanco", ...(imagen ? { imagen } : {}) }];
    if (esMejor) {
      bloques.push({ tipo: "chips", chips: [{ texto: t.tagBestValue.replace("{plat}", numero(mejor.value.plat)), tipo: mejor.clear ? "valor" : "valor-justo" }] });
    }
    const porque = [];
    if (set) {
      const cierra = set.left === 0;
      porque.push({ texto: `${cierra ? t.tagBestSet : t.tagBestSetNear}${cierra && precioSet > 0 ? ` · ${precioSet}p` : ""}`, tipo: cierra ? "set" : "set-cerca" });
    }
    if (pl) porque.push({ texto: t.tagBestPl, tipo: "pl" });
    if (duc) porque.push({ texto: t.tagBestDuc, tipo: "duc" });
    if (porque.length) bloques.push({ tipo: "chips", chips: porque });

    if (it.crafted) bloques.push({ tipo: "estado", texto: "Crafted", tono: "apagado" });
    else if (!it.ownedRead) bloques.push({ tipo: "estado", texto: t.lblUnread, tono: "naranja" });
    else bloques.push({ tipo: "estado", texto: `${it.owned} ${t.lblSeen}`, tono: "verde" });

    const desglose = sets && inventario ? desgloseSet(it.name, { ...sets, primeInventory: inventario }) : null;
    const detalle = filasDetalle(it, valores?.get(it.name), inventario ? (inventario[it.name] || 0) : null, t, desglose, desglose ? sets.precioSetDe?.(desglose.set) || 0 : 0);
    if (detalle.length) bloques.push({ tipo: "lista", filas: detalle });

    bloques.push({ tipo: "separador" }, {
      tipo: "precio", plat: it.price > 0 ? String(it.price) : "?", ducados: it.ducats > 0 ? String(it.ducats) : "",
    });
    const borde = esMejor ? "valor" : set?.left === 0 ? "set" : pl ? "pl" : duc ? "duc" : "";
    return { x, y: Y_RECOMPENSAS, borde, bloques };
  });
}
