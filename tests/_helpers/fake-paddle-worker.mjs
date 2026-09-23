import { arrancaWorkerPaddle } from "../../deploy/js/repositories/paddle.worker.js";

export class BitmapFalso {
  constructor(width = 8, height = 4) { this.width = width; this.height = height; this.cerrado = false; }
  close() { this.cerrado = true; }
}

export function canvasFalso(registro = []) {
  return (w, h) => ({
    width: w, height: h,
    getContext(tipo, opts) { registro.push(["getContext", opts]); return { drawImage: (img) => registro.push(["drawImage", img]) }; },
  });
}

export function crearWorkerFalso({ importar, crearCanvas = canvasFalso(), muereAlArrancar = false, consola = null } = {}) {
  const creados = [];
  class WorkerFalso {
    constructor(url, opts) {
      this.url = String(url); this.opts = opts; this.terminado = false;
      creados.push(this);
      const { port1, port2 } = new MessageChannel();
      this._port = port1; this._otro = port2;
      port1.onmessage = (ev) => this.onmessage?.(ev);
      if (muereAlArrancar) setTimeout(() => this.onerror?.({ message: "script del worker no encontrado" }), 0);
      else arrancaWorkerPaddle(port2, { importar, crearCanvas, consola });
    }
    postMessage(msg, transfer) { this.enviados ??= []; this.enviados.push({ msg, transfer }); this._port.postMessage(msg); }
    terminate() { this.terminado = true; this._port.close(); this._otro.close(); }
  }
  return { WorkerFalso, creados };
}

export function libreriaFalsa({ recognize = async () => ({ text: "OK", lines: [] }), proveedores = ["wasm"] } = {}) {
  const inits = [];
  class PaddleOcrService {
    constructor(opts) { this.opts = opts; this.options = { session: { executionProviders: proveedores } }; inits.push(opts); }
    async initialize() {}
    recognize(canvas) { return recognize(canvas); }
  }
  return { mod: { PaddleOcrService, V5_MODEL: { nombre: "grande" } }, inits };
}
