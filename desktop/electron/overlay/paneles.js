const TONOS = new Set([
  "blanco", "gris", "cian", "oro", "ducado", "verde", "morado", "naranja", "apagado", "rojo",
  "gradoS", "gradoA", "gradoB", "gradoC", "gradoF",
]);
const CHIPS = new Set(["valor", "valor-justo", "set", "set-cerca", "pl", "duc"]);
const BORDES = new Set(["valor", "pl", "duc", "set"]);
const ANCLAJES = new Set(["izquierda", "derecha"]);

export const ICONO_PLAT = "/assets/relic_contents/platinum.webp";
export const ICONO_DUCADO = "/assets/Ducats.webp";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const tono = (t, defecto) => `tono-${TONOS.has(t) ? t : defecto}`;

function htmlLista(filas) {
  const cols = Math.max(1, ...filas.map((f) => f.length));
  const celdas = filas.flatMap((fila) => Array.from({ length: cols }, (_, i) => {
    const pt = fila[i];
    if (!pt) return `<span></span>`;
    return `<span class="${i ? "dato" : "nombre"} ${tono(pt.tono, i ? "gris" : "blanco")}">${esc(pt.texto)}</span>`;
  }));
  const columnas = cols > 1 ? `minmax(0, 1fr) repeat(${cols - 1}, max-content)` : "minmax(0, 1fr)";
  return `<div class="lista" style="grid-template-columns: ${columnas}">${celdas.join("")}</div>`;
}

export function htmlBloque(b) {
  switch (b?.tipo) {
    case "titulo":
      return `<div class="titulo ${tono(b.tono, "ducado")}">${esc(b.texto)}</div>`;
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
    default:
      return "";
  }
}

export function htmlPanel(p) {
  const borde = BORDES.has(p.borde) ? ` borde-${p.borde}` : "";
  return `<div class="panel${borde}">${(p.bloques || []).map(htmlBloque).join("")}</div>`;
}

export function coloca(paneles, anchos, { ancho, alto }, mismoAncho = false) {
  const maximo = ancho * 0.34;
  const ws = anchos.map((w) => Math.min(w, maximo));
  const comun = Math.max(0, ...ws);
  return paneles.map((p, i) => {
    const w = mismoAncho ? Math.min(maximo, Math.max(comun, ancho / 10)) : ws[i];
    let x = (Number(p.x) || 0) * ancho;
    const anclaje = ANCLAJES.has(p.anclaje) ? p.anclaje : "centro";
    if (anclaje === "derecha") x -= w;
    else if (anclaje === "centro") x -= w / 2;
    x = Math.max(0, Math.min(x, ancho - w));
    return { left: Math.round(x), top: Math.round((Number(p.y) || 0) * alto), width: Math.ceil(w) };
  });
}
