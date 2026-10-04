import {
  capacidadesDelLanzador,
  guardarPermisosEnLanzador,
  copiarConLanzador,
  panelesEnJuego,
  escucharAccionesDelOverlay,
} from "../repositories/launcher.repository.js";
import { oneTimeNoticeSeen, markOneTimeNoticeSeen, leePanelesOcultos, guardaPanelesOcultos } from "../repositories/storage.repository.js";

export { leePanelesOcultos, guardaPanelesOcultos };

export const RECOMPENSAS_DURACION_MS = 20_000;
export const PANTALLA_RECOMPENSAS_MS = 15_500;

export function duracionRecompensas(desde, ahora = Date.now()) {
  return desde ? Math.max(3000, PANTALLA_RECOMPENSAS_MS - (ahora - desde)) : RECOMPENSAS_DURACION_MS;
}

export function enLanzador(hostname = globalThis.location?.hostname) {
  return hostname === "voidstonks.localhost";
}

let capacidades = null;

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

let overlayActivo = false;
export function activaOverlay(si) {
  overlayActivo = !!si && enLanzador();
}

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

const alPulsar = new Map();
let escuchandoOverlay = false;

export function alPulsarEnOverlay(grupo, fn, { escucha = escucharAccionesDelOverlay } = {}) {
  alPulsar.set(grupo, fn);
  if (escuchandoOverlay) return;
  escuchandoOverlay = true;
  escucha((g, accion) => alPulsar.get(g)?.(accion));
}

export function quitarTodosAlSalir({ manda = panelesEnJuego } = {}) {
  if (!overlayActivo) return;
  for (const { resuelve } of cola.values()) resuelve(false);
  cola.clear();
  for (const grupo of visibles) manda({ grupo, paneles: [] });
  visibles.clear();
}
