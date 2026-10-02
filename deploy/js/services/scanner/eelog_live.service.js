import { seguirEELogDelLanzador } from "../../repositories/launcher.repository.js";
import { parseLinea } from "../../utils/eelog_events.js";
import { ESTADO_JUEGO_INICIAL, siguienteEstado, modoEscaner } from "../../utils/eelog_estado.js";

const MAX_EVENTOS = 200;
const COLA_INICIAL = 1024 * 1024;

export const EELogLive = {
  ruta: "",
  estado: "parado",
  eventos: [],
  juego: ESTADO_JUEGO_INICIAL,
  pantalla: null,
  reliquia: null,
  _oyentes: new Set(),
  _cortar: null,

  escuchar(fn) {
    this._oyentes.add(fn);
    return () => this._oyentes.delete(fn);
  },

  iniciar({ sigue = seguirEELogDelLanzador } = {}) {
    if (this._cortar) return;
    this._cortar = sigue({
      cola: COLA_INICIAL,
      alLeer: (lineas) => this.leer(lineas),
      alEstado: (nombre, datos) => this.cambiaEstado(nombre, datos),
    });
  },

  parar() {
    this._cortar?.();
    this._cortar = null;
    this.estado = "parado";
    this._avisa();
  },

  leer(lineas) {
    let hay = this.estado !== "leyendo";
    this.estado = "leyendo";
    for (const linea of lineas) {
      const ev = parseLinea(linea);
      if (!ev) continue;
      hay = true;
      this.eventos.push(ev);
      this.juego = siguienteEstado(this.juego, ev);
      if (ev.tipo === "pantalla") this.pantalla = ev;
      if (ev.tipo === "reliquia") this.reliquia = ev;
    }
    if (this.eventos.length > MAX_EVENTOS) this.eventos.splice(0, this.eventos.length - MAX_EVENTOS);
    if (hay) this._avisa();
  },

  cambiaEstado(nombre, datos) {
    if (nombre === "ruta" || nombre === "reinicio" || nombre === "error") {
      this.eventos = [];
      this.pantalla = null;
      this.reliquia = null;
      this.juego = ESTADO_JUEGO_INICIAL;
    }
    if (nombre === "ruta") {
      this.ruta = datos;
      this.estado = datos ? "leyendo" : "falta";
    } else if (nombre === "falta" || nombre === "error") {
      this.estado = nombre;
    } else if (nombre === "reinicio") {
      this.estado = "leyendo";
    }
    this._avisa();
  },

  modoEscaner(ahora = Date.now()) {
    return this.estado === "leyendo" ? modoEscaner(this.juego, ahora) : null;
  },

  _avisa() {
    for (const fn of this._oyentes) fn(this);
  },
};
