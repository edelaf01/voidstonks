/**
 * files in the origin private file system, scanner debug data
 */
export const OPFSRepository = {
    _dir: null,

    async abrir(nombre) {
        this._dir = null;
        try {
            const root = await globalThis.navigator?.storage?.getDirectory?.();
            if (!root) return false;
            this._dir = await root.getDirectoryHandle(nombre, { create: true });
            return true;
        } catch { return false; }
    },

    async escribe(nombre, blob) {
        if (!this._dir) return false;
        try {
            const fh = await this._dir.getFileHandle(nombre, { create: true });
            const w = await fh.createWritable();
            await w.write(blob);
            await w.close();
            return true;
        } catch { return false; }
    },

    /** @returns {Promise<Uint8Array|null>} */
    async lee(nombre) {
        if (!this._dir) return null;
        try {
            const f = await (await this._dir.getFileHandle(nombre)).getFile();
            return new Uint8Array(await f.arrayBuffer());
        } catch { return null; }
    },

    async borra(nombre) {
        if (!this._dir) return false;
        try { await this._dir.removeEntry(nombre); return true; } catch { return false; }
    },

    async vacia() {
        if (!this._dir) return false;
        try {
            const nombres = [];
            for await (const n of this._dir.keys()) nombres.push(n);
            for (const n of nombres) await this._dir.removeEntry(n, { recursive: true });
            return true;
        } catch { return false; }
    },
};
