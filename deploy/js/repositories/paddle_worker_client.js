import { mensajeInit, mensajeReconoce, transferiblesDe, crearLlamadasPendientes } from "../utils/vision/paddle_rpc.js";

export class PaddleWorkerClient {
    constructor({ crearWorker, aBitmap, onMuerte = () => {}, timeoutInitMs = 90000, timeoutMs = 20000, programa, cancela }) {
        this._aBitmap = aBitmap;
        this._onMuerte = onMuerte;
        this._timeoutInitMs = timeoutInitMs;
        this._timeoutMs = timeoutMs;
        this._pendientes = crearLlamadasPendientes({ programa, cancela });
        this._vivo = true;
        this._worker = crearWorker();
        this._worker.onmessage = (ev) => this._recibe(ev.data);
        //TODO better to try catch this? prob
        this._worker.onerror = (e) => this._muere(new Error(e?.message || "error del worker de Paddle"));
        this._worker.onmessageerror = () => this._muere(new Error("mensaje ilegible del worker de Paddle"));
    }

    get vivo() { return this._vivo; }

    init(config) { return this._pide((id) => [mensajeInit(id, config), []], this._timeoutInitMs); }

    async recognize(fuente) {
        if (!this._vivo) throw new Error("worker de Paddle terminado");
        const imagen = await this._aBitmap(fuente);
        return this._pide((id) => [mensajeReconoce(id, imagen), transferiblesDe(imagen)], this._timeoutMs);
    }

    terminate() {
        if (!this._vivo) return;
        this._vivo = false;
        this._pendientes.rechazaTodas(new Error("worker de Paddle terminado"));
        this._worker.terminate?.();
    }

    _pide(construye, timeoutMs) {
        if (!this._vivo) return Promise.reject(new Error("worker de Paddle terminado"));
        const { id, promesa } = this._pendientes.registra(timeoutMs, () => this._muere(new Error(`worker de Paddle sin respuesta en ${timeoutMs} ms`)));
        const [msg, transfer] = construye(id);
        this._worker.postMessage(msg, transfer);
        return promesa;
    }

    _recibe(msg) {
        if (msg?.tipo === "log") { (console[msg.nivel] || console.log)("[Paddle worker]", ...(msg.args || [])); return; }
        if (msg?.tipo === "resultado") this._pendientes.resuelve(msg.id, msg.resultado);
        else if (msg?.tipo === "error") this._pendientes.rechaza(msg.id, Object.assign(new Error(msg.error?.message || "error en el worker de Paddle"), { name: msg.error?.name || "Error" }));
    }

    _muere(e) {
        if (!this._vivo) return;
        this._pendientes.rechazaTodas(e);
        this.terminate();
        this._onMuerte(e);
    }
}
