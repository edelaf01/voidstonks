// clipboard copy for scanner results without focus via extension, writeText or on focus return
export const ClipboardService = {
    extensionReady: false,
    _pending: null,
    _seq: 0,

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
            // own origin, not "*": the content script only accepts allowlisted origins
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
        } catch {}
    },
};

ClipboardService.init();
