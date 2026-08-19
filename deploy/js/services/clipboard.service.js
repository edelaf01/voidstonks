/**
 * Copia robusta al portapapeles para resultados del scanner (auto-copy).
 * Problema real: mientras se juega, la pestaña NO tiene el foco y
 * navigator.clipboard.writeText falla con "Document is not focused" — el auto-copy
 * del modal fallaba en silencio. Cascada de intentos:
 *   1) Extensión "VoidStonks AutoCopy" (documento offscreen MV3): copia SIN foco.
 *      La app la detecta por el postMessage VOIDSTONKS_AUTOCOPY_READY del content script.
 *   2) navigator.clipboard.writeText: vale si la pestaña está enfocada.
 *   3) Cola de pendiente: se copia solo cuando la ventana recupera el foco (con toast).
 * Genérico a propósito: cualquier feature (recompensas hoy, tasación riven mañana)
 * puede llamar a ClipboardService.copy(text).
 */
export const ClipboardService = {
    extensionReady: false,
    _pending: null,
    _seq: 0,

    // La cola se vacía sola al recuperar el foco, así que no hay `await` de nadie a quien
    // devolverle el resultado: quien quiera avisar pone aquí su callback. Antes el service
    // llamaba a showToast directamente, y eso le ataba el DOM a una capa que no pinta.
    onPendingCopied: null,

    init() {
        window.addEventListener("message", (ev) => {
            if (ev.source !== window || !ev.data) return;
            if (ev.data.type === "VOIDSTONKS_AUTOCOPY_READY") {
                this.extensionReady = true;
                console.log("[ClipboardService] Extensión AutoCopy detectada.");
            }
        });
        window.addEventListener("focus", () => this._flushPending());
    },

    // Devuelve por qué vía se copió: "extension" | "clipboard" | "queued"
    async copy(text) {
        if (this.extensionReady) {
            const ok = await this._copyViaExtension(text);
            if (ok) return "extension";
        }
        try {
            await navigator.clipboard.writeText(text);
            return "clipboard";
        } catch {
            this._pending = text;
            return "queued";
        }
    },

    _copyViaExtension(text) {
        return new Promise((resolve) => {
            const id = ++this._seq;
            const onAck = (ev) => {
                if (ev.source !== window || ev.data?.type !== "VOIDSTONKS_AUTOCOPY_ACK" || ev.data.id !== id) return;
                window.removeEventListener("message", onAck);
                clearTimeout(timer);
                resolve(!!ev.data.ok);
            };
            const timer = setTimeout(() => {
                window.removeEventListener("message", onAck);
                resolve(false);
            }, 800);
            window.addEventListener("message", onAck);
            // targetOrigin explícito (propio origen), no "*": el content script solo acepta
            // mensajes de orígenes en su allowlist y así no exponemos el texto a otros frames.
            window.postMessage({ type: "VOIDSTONKS_AUTOCOPY", text, id }, window.location.origin);
        });
    },

    async _flushPending() {
        if (!this._pending) return;
        const text = this._pending;
        try {
            await navigator.clipboard.writeText(text);
            this._pending = null;
            this.onPendingCopied?.();
        } catch { /* la ventana aún no acepta escritura; se reintenta en el próximo focus */ }
    },
};

ClipboardService.init();
