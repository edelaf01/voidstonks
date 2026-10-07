const TONOS = new Set([
  "blanco", "gris", "cian", "oro", "ducado", "verde", "morado", "naranja", "apagado", "rojo",
  "gradoS", "gradoA", "gradoB", "gradoC", "gradoF",
]);
const CHIPS = new Set(["valor", "valor-justo", "set", "set-cerca", "pl", "duc"]);
const BORDES = new Set(["valor", "pl", "duc", "set"]);
const ANCLAJES = new Set(["izquierda", "derecha"]);
const RE_ACCION = /^[a-z]{1,16}:[A-Za-z0-9]{1,16}$/;

export const ICONO_PLAT = "/assets/relic_contents/platinum.webp";
export const ICONO_DUCADO = "/assets/Ducats.webp";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const ICONOS = { plat: ICONO_PLAT, ducado: ICONO_DUCADO };
const icono = (nombre) => (ICONOS[nombre] ? `<img class="ico" src="${ICONOS[nombre]}" alt="">` : "");
const RE_IMAGEN = /^\/?assets\/[\w-]+(?:\/[\w-]+)*\.(?:webp|png|svg)$/;
const imagen = (ruta) => (RE_IMAGEN.test(ruta || "") ? `<img class="img" src="/${ruta.replace(/^\//, "")}" alt="">` : "");
const tono = (t, defecto) => `tono-${TONOS.has(t) ? t : defecto}`;

function htmlLista(filas) {
  const cols = Math.max(1, ...filas.map((f) => f.length));
  const celdas = filas.flatMap((fila) => Array.from({ length: cols }, (_, i) => {
    const pt = fila[i];
    if (!pt) return `<span></span>`;
    return `<span class="${i ? "dato" : "nombre"} ${tono(pt.tono, i ? "gris" : "blanco")}">${imagen(pt.imagen)}${esc(pt.texto)}${pt.texto ? icono(pt.icono) : ""}</span>`;
  }));
  const columnas = cols > 1 ? `minmax(0, 1fr) repeat(${cols - 1}, max-content)` : "minmax(0, 1fr)";
  return `<div class="lista" style="grid-template-columns: ${columnas}">${celdas.join("")}</div>`;
}

function htmlRejilla(b) {
  const cols = Math.min(12, Math.max(1, Math.round(Number(b.cols) || 1)));
  const celdas = (Array.isArray(b.celdas) ? b.celdas : []).slice(0, 48).map((c) => {
    const lineas = Array.isArray(c?.lineas) ? c.lineas : [];
    if (!lineas.length) return `<div class="celda vacia"></div>`;
    return `<div class="celda">${lineas.map((l, i) => `<span class="${i ? "dato" : "nombre"} ${tono(l?.tono, i ? "gris" : "blanco")}">${esc(l?.texto)}</span>`).join("")}</div>`;
  });
  return `<div class="rejilla" style="grid-template-columns: repeat(${cols}, minmax(0, 1fr))">${celdas.join("")}</div>`;
}

export function htmlBloque(b) {
  switch (b?.tipo) {
    case "titulo":
      return `<div class="titulo ${tono(b.tono, "ducado")}">${imagen(b.imagen)}${esc(b.texto)}</div>`;
    case "chips":
      return `<div class="chips">${(b.chips || []).map((c) => `<span class="chip chip-${CHIPS.has(c.tipo) ? c.tipo : "pl"}">${esc(c.texto)}</span>`).join("")}</div>`;
    case "estado":
      return `<div class="estado-fila"><span class="estado ${tono(b.tono, "verde")}">${esc(b.texto)}</span></div>`;
    case "separador":
      return `<div class="separador"></div>`;
    case "precio": {
      const duc = b.ducados ? `<span class="duc"><img src="${ICONO_DUCADO}" alt="">${esc(b.ducados)}</span>` : "";
      return `<div class="precio"><span class="plat"><img src="${ICONO_PLAT}" alt="">${esc(b.plat)}</span>${duc}</div>`;
    }
    case "lista":
      return htmlLista(Array.isArray(b.filas) ? b.filas : []);
    case "rejilla":
      return htmlRejilla(b);
    case "botones": {
      const botones = (b.botones || []).filter((x) => RE_ACCION.test(x?.accion || ""));
      const rotulo = b.rotulo ? `<span class="rotulo">${esc(b.rotulo)}</span>` : "";
      return `<div class="botones">${rotulo}${botones.map((x) => `<button type="button" class="boton${x.activo ? " activo" : ""}" data-accion="${esc(x.accion)}">${esc(x.texto)}</button>`).join("")}</div>`;
    }
    default:
      return "";
  }
}

export function htmlPanel(p) {
  const borde = BORDES.has(p.borde) ? ` borde-${p.borde}` : "";
  const interactivo = (p.bloques || []).some((b) => b?.tipo === "botones") ? " interactivo" : "";
  return `<div class="panel${borde}${interactivo}">${(p.bloques || []).map(htmlBloque).join("")}</div>`;
}

export function zonasEnPixeles(rects, escala = 1) {
  return rects
    .filter((r) => r.width > 0 && r.height > 0)
    .map((r) => ({
      x: Math.floor(r.left * escala), y: Math.floor(r.top * escala),
      width: Math.ceil(r.width * escala), height: Math.ceil(r.height * escala),
    }));
}

export function coloca(paneles, anchos, { ancho, alto }, mismoAncho = false) {
  const maximo = ancho * 0.34;
  const ws = anchos.map((w) => Math.min(w, maximo));
  const comun = Math.max(0, ...ws);
  const xs = paneles.map((p) => (Number(p.x) || 0) * ancho).sort((a, b) => a - b);
  const hueco = Math.min(Infinity, ...xs.slice(1).map((x, i) => x - xs[i] - 8));
  return paneles.map((p, i) => {
    const w = mismoAncho ? Math.min(maximo, hueco, Math.max(comun, ancho / 10)) : Math.min(maximo, Math.max(ws[i], (Number(p.anchoMin) || 0) * ancho));
    let x = (Number(p.x) || 0) * ancho;
    const anclaje = ANCLAJES.has(p.anclaje) ? p.anclaje : "centro";
    if (anclaje === "derecha") x -= w;
    else if (anclaje === "centro") x -= w / 2;
    x = Math.max(0, Math.min(x, ancho - w));
    return { left: Math.round(x), top: Math.round((Number(p.y) || 0) * alto), width: Math.ceil(w) };
  });
}
