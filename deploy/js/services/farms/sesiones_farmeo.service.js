import { EELogLive } from "../scanner/eelog_live.service.js";
import { escucha } from "../../utils/ganchos.js";
import { dbHelper, getPriceValue } from "../../repositories/storage.repository.js";
import { getSlug } from "../../utils/slugs.utils.js";
import { ESTADO_SESION_INICIAL, siguienteSesion } from "../../utils/inventory/sesiones_farmeo.js";

const CLAVE = "vs_sesiones_farmeo";
const MAX = 500;

let estado = ESTADO_SESION_INICIAL;
let sesiones = [];
let cargadas = false;
let lista = null;
let ultimo = null;
let iniciado = false;

export const normalizaReliquia = (n) => String(n || "").replace(/\s*\brelic\b.*$/i, "").replace(/\s*\((intact|exceptional|flawless|radiant)\)\s*$/i, "").trim().toLowerCase();

const guarda = (s) => {
  const i = sesiones.findIndex((x) => x.id === s.id);
  if (i >= 0) sesiones[i] = s; else sesiones.push(s);
  if (sesiones.length > MAX) sesiones = sesiones.slice(-MAX);
  dbHelper.set(CLAVE, sesiones).catch(console.error);
  globalThis.scheduleFarmRoutesRefresh?.();
};

const despacha = (evento) => {
  estado = siguienteSesion(estado, evento);
  if (estado.cambio) guarda(estado.cambio);
};

const traduce = (ev) => {
  const ahora = Date.now();
  if (ev.tipo === "nivel" && ev.empieza) return { tipo: "inicio", ahora, t: ev.t };
  if (ev.tipo === "mision" && ev.fase === "empieza") return { tipo: "mision", nombre: ev.nombre };
  if (ev.tipo === "reliquia") return { tipo: "reliquia", nombre: ev.nombre };
  if (ev.tipo === "recompensas" && ev.fase === "llenas") return { tipo: "recompensas", ahora, t: ev.t };
  if (ev.tipo === "recompensas" && ev.fase === "cerradas") return { tipo: "cierre", ahora, t: ev.t };
  return null;
};

const alLog = (log) => {
  const eventos = log?.eventos;
  if (!Array.isArray(eventos) || !eventos.length) return;
  if (eventos !== lista) { lista = eventos; ultimo = eventos[eventos.length - 1]; return; }
  const desde = eventos.lastIndexOf(ultimo);
  const nuevos = desde >= 0 ? eventos.slice(desde + 1) : [];
  ultimo = eventos[eventos.length - 1];
  for (const ev of nuevos) {
    const traducido = traduce(ev);
    if (traducido) despacha(traducido);
  }
};

const alConfirmar = async ({ items, gastada } = {}) => {
  const lista = Array.isArray(items) ? items.filter((i) => i?.name && !i.reliquia) : [];
  if (gastada) despacha({ tipo: "reliquia", nombre: typeof gastada === "string" ? gastada : gastada.name });
  if (!lista.length) return;
  const valorados = await Promise.all(lista.map(async (i) => {
    const raw = await getPriceValue(i.name, getSlug(i.name)).catch(() => null);
    const plat = Number.parseInt(raw, 10);
    return { name: i.name, qty: i.qty, plat: Number.isFinite(plat) ? plat : 0 };
  }));
  despacha({ tipo: "confirmadas", items: valorados, ahora: Date.now() });
};

export async function initSesionesFarmeo() {
  if (iniciado) return;
  iniciado = true;
  try {
    const previas = await dbHelper.get(CLAVE);
    if (Array.isArray(previas)) sesiones = [...previas, ...sesiones].slice(-MAX);
  } catch (e) { console.error(e); }
  cargadas = true;
  EELogLive.escuchar(alLog);
  escucha("recompensas-confirmadas", alConfirmar);
  globalThis.scheduleFarmRoutesRefresh?.();
}

export const leeSesiones = () => sesiones.slice();
export const sesionesCargadas = () => cargadas;

export function minutosDeReliquia(nombre) {
  const clave = normalizaReliquia(nombre);
  if (!clave) return null;
  const medidas = sesiones.filter((s) => Number.isFinite(s.minutos) && s.minutos > 0 && normalizaReliquia(s.reliquia) === clave);
  if (!medidas.length) return null;
  return medidas.reduce((a, s) => a + s.minutos, 0) / medidas.length;
}
