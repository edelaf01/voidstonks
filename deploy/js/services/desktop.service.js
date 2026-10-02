import {
  latirAlLanzador,
  capacidadesDelLanzador,
  guardarPermisosEnLanzador,
  copiarConLanzador,
  panelesEnJuego,
} from "../repositories/launcher.repository.js";
import { oneTimeNoticeSeen, markOneTimeNoticeSeen } from "../repositories/storage.repository.js";

export const LATIDO_MS = 30_000;
// Si nadie avisa del cierre (sin EE.log) el lanzador quita las recompensas solo; la pantalla dura 15 s.
export const RECOMPENSAS_DURACION_MS = 20_000;

export function enLanzador(hostname = globalThis.location?.hostname) {
  return hostname === "voidstonks.localhost";
}

// El lanzador sigue sirviendo mientras alguna ventana dé señales.
export function mantenerLanzador({ intervalo = LATIDO_MS, late = latirAlLanzador } = {}) {
  late();
  return setInterval(late, intervalo);
}

let capacidades = null;

// { so, clip, eelog: ruta|"", overlay, permisos: {id: bool}, pendientes: [id] }, o null fuera del lanzador.
export function capacidadesNativas({ pide = capacidadesDelLanzador } = {}) {
  if (!enLanzador()) return Promise.resolve(null);
  capacidades ??= pide();
  return capacidades;
}

export async function guardarPermisos(permisos, { guarda = guardarPermisosEnLanzador } = {}) {
  const ok = await guarda(permisos);
  if (ok) capacidades = null;
  return ok;
}

export function copiarNativo(texto, { copia = copiarConLanzador } = {}) {
  return enLanzador() ? copia(texto) : Promise.resolve(false);
}

const CLAVE_AUTOCOPIA = "vs_autocopia_escritorio";

export function estrenaAutoCopia(permisos, { visto = oneTimeNoticeSeen, marca = markOneTimeNoticeSeen } = {}) {
  if (!permisos?.clip || visto(CLAVE_AUTOCOPIA)) return false;
  marca(CLAVE_AUTOCOPIA);
  return true;
}

// Lo activa la carcasa con el permiso del overlay; en la web nunca.
let overlayActivo = false;
export function activaOverlay(si) {
  overlayActivo = !!si && enLanzador();
}

// Cada pantalla es un grupo (recompensas, kiosko, riven, inventario) que el lanzador sustituye entero.
const visibles = new Set();
const CONTEXTOS_DE_GRUPO = {
  recompensas: ["REWARD"], kiosko: ["INVENTORY"], riven: ["INVENTORY_MODS", "ITEM_DETAILS"], reliquias: ["RELICS"],
};

const cola = new Map();
let vaciando = false;

function encola(datos, manda) {
  return new Promise((resuelve) => {
    cola.get(datos.grupo)?.resuelve(false);
    cola.delete(datos.grupo);
    cola.set(datos.grupo, { datos, manda, resuelve });
    if (!vaciando) vacia();
  });
}

async function vacia() {
  vaciando = true;
  while (cola.size) {
    const [grupo, { datos, manda, resuelve }] = cola.entries().next().value;
    cola.delete(grupo);
    resuelve(await manda(datos).catch(() => false));
  }
  vaciando = false;
}

export function mostrarPaneles(grupo, paneles, { mismoAncho = false, duracionMs = 0 } = {}, { manda = panelesEnJuego } = {}) {
  if (!overlayActivo) return Promise.resolve(false);
  visibles.add(grupo);
  return encola({ grupo, paneles, mismoAncho, duracionMs }, manda);
}

export function quitarPaneles(grupo, { manda = panelesEnJuego } = {}) {
  if (!overlayActivo || !visibles.delete(grupo)) return Promise.resolve(false);
  return encola({ grupo, paneles: [] }, manda);
}

export function ajustaPanelesAlContexto(contexto, deps) {
  return Promise.all([...visibles].filter((g) => !CONTEXTOS_DE_GRUPO[g]?.includes(contexto)).map((g) => quitarPaneles(g, deps)));
}

export function quitarTodosLosPaneles(deps) {
  return Promise.all([...visibles].map((g) => quitarPaneles(g, deps)));
}

export function quitarTodosAlSalir({ manda = panelesEnJuego } = {}) {
  if (!overlayActivo) return;
  for (const { resuelve } of cola.values()) resuelve(false);
  cola.clear();
  for (const grupo of visibles) manda({ grupo, paneles: [] }, { keepalive: true });
  visibles.clear();
}
