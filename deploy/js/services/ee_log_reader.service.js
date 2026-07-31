import { translateColor } from "../ui.components/kubrow_translations.js";

/**
 * Reads Warframe's EE.log live through the File System Access API. The user picks the Warframe
 * folder once and the handle is kept in IndexedDB. Only the tail (TAIL_BYTES) is read.
 * Its kubrow colors are exact asset codes, so they replace the vision guess.
 */

const DB_NAME = "voidstonks-fs";
const STORE = "handles";
const HANDLE_KEY = "warframe-dir";
const LOG_FILENAME = "EE.log";
const TAIL_BYTES = 256 * 1024;

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, val) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(val, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export const EELogReaderService = {
  _dirHandle: null,
  /** { colors, tier, timestamp, at } */
  _lastRead: null,

  isSupported() {
    return typeof globalThis.showDirectoryPicker === "function";
  },

  /**
   * Restores the saved handle; permission is asked later under a user gesture.
   */
  async init() {
    if (!this.isSupported()) return false;
    try {
      const saved = await idbGet(HANDLE_KEY);
      if (saved) {
        this._dirHandle = saved;
        return true;
      }
    } catch (e) {
      console.warn("[EELogReader] init:", e);
    }
    return false;
  },

  /**
   * Asks for the Warframe folder and stores the handle. Needs a user gesture. True when ready.
   */
  async connect() {
    if (!this.isSupported()) {
      throw new Error("Tu navegador no soporta File System Access API (usa Chrome/Edge de escritorio).");
    }
    const handle = await globalThis.showDirectoryPicker({ mode: "read" });
    this._dirHandle = handle;
    try {
      await idbSet(HANDLE_KEY, handle);
    } catch (e) {
      console.warn("[EELogReader] no se pudo persistir el handle:", e);
    }
    return true;
  },

  async disconnect() {
    this._dirHandle = null;
    this._lastRead = null;
    try {
      await idbSet(HANDLE_KEY, null);
    } catch {}
  },

  isConnected() {
    return !!this._dirHandle;
  },

  /**
   * queryPermission shows no UI; requestPermission does and needs a user gesture.
   */
  async ensurePermission(interactive = false) {
    if (!this._dirHandle) return false;
    const opts = { mode: "read" };
    if ((await this._dirHandle.queryPermission(opts)) === "granted") return true;
    if (!interactive) return false;
    return (await this._dirHandle.requestPermission(opts)) === "granted";
  },

  async _readTail() {
    if (!this._dirHandle) return null;
    const fileHandle = await this._dirHandle.getFileHandle(LOG_FILENAME);
    const file = await fileHandle.getFile();
    const start = Math.max(0, file.size - TAIL_BYTES);
    const blob = file.slice(start, file.size);
    return { text: await blob.text(), mtime: file.lastModified, size: file.size };
  },

  /**
   * Colors of the last kubrow the game built. The game only logs the slots that changed, so every
   * kubrow spot-build in the tail is accumulated, each category replacing the previous one.
   * The startup catalog (big blocks mixing Catbrow) is dropped. Returns real names,
   * e.g. ["Sedna Grey", ...].
   */
  _extractColors(text) {
    if (!text) return [];

    const MAX_SLOTS = 6;
    const CATALOG_FRAME_THRESHOLD = 8;
    // gap in seconds (EE.log timestamp) between catalog spot-builds
    const MAX_GAP_SECONDS = 0.05;

    const reTs = /^\s*([\d.]+)\s/;
    const reKubrow = /\/KubrowPet\/Colors\/KubrowPetColor([A-Za-z]+)/;
    const reCatbrow = /\/CatbrowPet\/Colors\//;
    const reAnyPetColor = /\/(?:Kubrow|Catbrow)Pet\/Colors\//;
    // MidD -> Mid, VibrantF -> Vibrant
    const reCategory = /^(Mundane|Mid|Vibrant|Accent|Eyes)/;

    const lines = text.split("\n");
    const hits = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!reAnyPetColor.test(line)) continue;
      const tsM = line.match(reTs);
      const ts = tsM ? parseFloat(tsM[1]) : NaN;
      const isCatbrow = reCatbrow.test(line);
      const km = isCatbrow ? null : line.match(reKubrow);
      hits.push({
        line: i,
        ts,
        isCatbrow,
        code: km ? "KubrowPetColor" + km[1] : null,
        suffix: km ? km[1] : null,
      });
    }
    if (!hits.length) return [];

    // 1. group into frames by short time gaps; without timestamp each hit is its own frame
    const frames = [];
    let current = null;
    for (const h of hits) {
      const gapOk = current && !Number.isNaN(h.ts) && !Number.isNaN(current.lastTs)
        ? (h.ts - current.lastTs) <= MAX_GAP_SECONDS
        : false;
      if (!current || !gapOk) {
        current = { kubrow: [], catbrow: 0, total: 0, line: h.line, lastTs: h.ts };
        frames.push(current);
      }
      current.total++;
      current.lastTs = Number.isNaN(h.ts) ? current.lastTs : h.ts;
      if (h.isCatbrow) { current.catbrow++; continue; }
      if (h.code) {
        current.kubrow.push({
          code: h.code,
          isEyes: /Eyes/i.test(h.code),
          category: (h.suffix.match(reCategory) || [null, h.suffix])[1],
          line: h.line,
        });
        current.line = h.line;
      }
    }

    // 2. drop the catalog
    const validFrames = frames.filter((f) => f.total <= CATALOG_FRAME_THRESHOLD && f.catbrow === 0 && f.kubrow.length > 0);
    if (!validFrames.length) return [];

    // 3. accumulate valid frames, each new category replacing the same one. A frame with Eyes is
    // always reloaded when viewing a companion, so it resets the set first.
    let slots = new Map(); // category -> {code, isEyes, line}
    for (const f of validFrames) {
      if (f.kubrow.some((h) => h.isEyes)) slots = new Map();
      for (const h of f.kubrow) slots.set(h.category, { code: h.code, isEyes: h.isEyes, line: h.line });
    }
    if (!slots.size) return [];

    return [...slots.values()]
      .filter((h) => !h.isEyes)
      .sort((a, b) => a.line - b.line)
      .slice(0, MAX_SLOTS)
      .map((h) => translateColor(h.code));
  },

  /**
   * Latest kubrow colors from EE.log: { colors, mtime, at }, or null without folder, permission
   * or kubrow event.
   */
  async getLatestKubrowColors() {
    if (!this._dirHandle) return null;
    try {
      if (!(await this.ensurePermission(false))) return null;
      const tail = await this._readTail();
      if (!tail) return null;
      const colors = this._extractColors(tail.text);
      if (colors.length === 0) return null;
      this._lastRead = { colors, mtime: tail.mtime, at: Date.now() };
      return this._lastRead;
    } catch (e) {
      console.warn("[EELogReader] getLatestKubrowColors:", e);
      return null;
    }
  },
};

export default EELogReaderService;
