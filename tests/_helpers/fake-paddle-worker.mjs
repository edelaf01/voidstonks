// Un `Worker` de mentira sobre un MessageChannel de Node: en un extremo el cliente de la página,
// en el otro el `arrancaWorkerPaddle` REAL con una librería falsa. Así el protocolo viaja por
// structured clone de verdad y lo que se prueba es lo que corre en el navegador.
import { arrancaWorkerPaddle } from "../../deploy/js/repositories/paddle.worker.js";

export class BitmapFalso {
  constructor(width = 8, height = 4) { this.width = width; this.height = height; this.cerrado = false; }
  close() { this.cerrado = true; }
}

/** Canvas del worker de mentira: solo registra el orden de las llamadas. */
export function canvasFalso(registro = []) {
  return (w, h) => ({
    width: w, height: h,
    getContext(tipo, opts) { registro.push(["getContext", opts]); return { drawImage: (img) => registro.push(["drawImage", img]) }; },
  });
}

/**
 * @param {object} o
 * @param {(url:string)=>Promise<object>} o.importar   lo que "descarga" la librería en el worker
 * @param {boolean} [o.muereAlArrancar]  dispara onerror en el siguiente tick (script 404, error de parseo)
 */
export function crearWorkerFalso({ importar, crearCanvas = canvasFalso(), muereAlArrancar = false, consola = null } = {}) {
  const creados = [];
  class WorkerFalso {
    constructor(url, opts) {
      this.url = String(url); this.opts = opts; this.terminado = false;
      creados.push(this);
      const { port1, port2 } = new MessageChannel();
      this._port = port1; this._otro = port2;
      port1.onmessage = (ev) => this.onmessage?.(ev);
      // Script 404 o error de parseo: nadie atiende al otro lado y el navegador dispara onerror.
      if (muereAlArrancar) setTimeout(() => this.onerror?.({ message: "script del worker no encontrado" }), 0);
      else arrancaWorkerPaddle(port2, { importar, crearCanvas, consola });
    }
    postMessage(msg, transfer) { this.enviados ??= []; this.enviados.push({ msg, transfer }); this._port.postMessage(msg); }
    terminate() { this.terminado = true; this._port.close(); this._otro.close(); }
  }
  return { WorkerFalso, creados };
}

/** Librería falsa con la forma que usa el worker: PaddleOcrService + modelos por nombre. */
export function libreriaFalsa({ recognize = async () => ({ text: "OK", lines: [] }), proveedores = ["wasm"] } = {}) {
  const inits = [];
  class PaddleOcrService {
    constructor(opts) { this.opts = opts; this.options = { session: { executionProviders: proveedores } }; inits.push(opts); }
    async initialize() {}
    recognize(canvas) { return recognize(canvas); }
  }
  return { mod: { PaddleOcrService, V5_MODEL: { nombre: "grande" } }, inits };
}
