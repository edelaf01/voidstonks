import { state } from "../state.js";
import { TEXTS } from "../config.js";
import { showToast } from "../ui.components/ui_components.js";

/**
 * Clipboard copy for scanner results. While playing, the tab has no focus and
 * navigator.clipboard fails, so it tries in order:
 * 1) the "VoidStonks AutoCopy" extension (MV3 offscreen document), which copies without focus;
 * 2) navigator.clipboard.writeText, when the tab is focused;
 * 3) a pending copy that runs when the window gets focus back.
 */
export const ClipboardService = {
    extensionReady: false,
    _pending: null,
    _seq: 0,

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
            const t = TEXTS[state.currentLang]?.rewardScanner;
            showToast(t?.toastCopied || "Copiado al portapapeles");
        } catch {}
    },
};

ClipboardService.init();
