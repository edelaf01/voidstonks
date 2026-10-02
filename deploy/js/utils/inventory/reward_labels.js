// Paneles del overlay para la pantalla de recompensas: la misma insignia que pinta el modal
// (ui_scanner_modal.createBadge), con sus textos y sus criterios, puesta bajo cada tarjeta del juego.

export const Y_RECOMPENSAS = 0.44;

function numero(plat) {
  return plat < 10 ? plat.toFixed(1) : String(Math.round(plat));
}

const plantilla = (texto, datos) => String(texto || "").replace(/\{(\w+)\}/g, (_, k) => datos[k] ?? "");
const sinPrime = (set) => String(set || "").replace(/ Prime$/, "");
const TONO_DESTINO = { sell: "oro", set: "morado", ducats: "cian" };

function filasDetalle(it, v, tienes, t) {
  const filas = [];
  if (v?.set) {
    filas.push([
      { texto: sinPrime(v.set), tono: "morado" },
      v.left === 0 ? { texto: t.lblSetCloses, tono: "verde" } : { texto: plantilla(t.lblSetLeft, { n: v.left }), tono: "gris" },
    ]);
  }
  if (v?.plat > 0 && v.route !== "none") {
    const valor = v.route === "ducats" ? it.ducats : numero(v.route === "set" ? v.setGain : v.sale);
    filas.push([{ texto: t.lblRoute, tono: "gris" }, { texto: plantilla(t[`lblRoute_${v.route}`], { v: valor }), tono: TONO_DESTINO[v.route] }]);
  }
  if (typeof tienes === "number") filas.push([{ texto: t.lblInApp, tono: "gris" }, { texto: String(tienes), tono: tienes > 0 ? "blanco" : "apagado" }]);
  return filas;
}

/**
 * @param items  recompensas con { name, price, ducats, owned, ownedRead, crafted, xPos }
 * @param mejor  pickBestReward(); mejores = mejoresPorMoneda(); cerca = pickBestForSets()
 */
export function panelesDeRecompensas(items, { anchoReferencia, mejor = null, mejores = null, cerca = null, precioSet = 0, valores = null, inventario = null, t }) {
  const n = items.length;
  return items.map((it, i) => {
    const conX = typeof it.xPos === "number" && it.xPos > 0 && anchoReferencia > 0;
    // Sin posición, la fila de tarjetas va centrada y repartida a partes iguales.
    const x = conX ? it.xPos / anchoReferencia : 0.5 + (i - (n - 1) / 2) * 0.126;
    const esMejor = mejor?.name === it.name && mejor.value.plat >= 1;
    const set = cerca?.name === it.name ? cerca : null;
    const pl = mejores?.plat?.has(it.name), duc = mejores?.ducats?.has(it.name);

    const bloques = [];
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

    const detalle = filasDetalle(it, valores?.get(it.name), inventario ? (inventario[it.name] || 0) : null, t);
    if (detalle.length) bloques.push({ tipo: "lista", filas: detalle });

    bloques.push({ tipo: "separador" }, {
      tipo: "precio", plat: it.price > 0 ? String(it.price) : "?", ducados: it.ducats > 0 ? String(it.ducats) : "",
    });
    const borde = esMejor ? "valor" : set?.left === 0 ? "set" : pl ? "pl" : duc ? "duc" : "";
    return { x, y: Y_RECOMPENSAS, borde, bloques };
  });
}
