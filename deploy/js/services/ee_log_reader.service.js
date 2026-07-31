import { translateColor } from "../ui.components/kubrow_translations.js";

/**
 * EELogReaderService
 * Lee el EE.log de Warframe EN VIVO desde el navegador vía File System Access API.
 *
 * El usuario elige la carpeta de Warframe UNA vez; guardamos el handle en IndexedDB
 * (persiste entre sesiones). Cuando el escáner detecta contexto KUBROW pedimos los
 * últimos colores: en vez de leer el archivo entero (multi-MB) leemos solo la COLA
 * (últimos TAIL_BYTES) con File.slice() — barato y sin bloquear la UI.
 *
 * Los colores del EE.log son la VERDAD ABSOLUTA (códigos de asset exactos), así que
 * cuando están disponibles sustituyen a la visión artificial del scanner de kubrows.
 */

const DB_NAME = "voidstonks-fs";
const STORE = "handles";
const HANDLE_KEY = "warframe-dir";
const LOG_FILENAME = "EE.log";
// Un bloque de spot-building de un kubrow ocupa pocos KB; 256 KB de cola sobra
// para capturar el evento más reciente sin leer el log completo.
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
  /** Handle de directorio de Warframe (en memoria durante la sesión). */
  _dirHandle: null,
  /** Última lectura cacheada: { colors, tier, timestamp, at }. */
  _lastRead: null,

  /** ¿Soporta el navegador la File System Access API? */
  isSupported() {
    return typeof globalThis.showDirectoryPicker === "function";
  },

  /**
   * Restaura el handle guardado (si existe) al arrancar. No pide permiso todavía;
   * eso se hace bajo gesto del usuario en connect() o de forma perezosa al leer.
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
   * Pide al usuario la carpeta de Warframe (donde vive EE.log) y persiste el handle.
   * Debe llamarse desde un gesto del usuario (click). Devuelve true si quedó lista.
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

  /** Olvida la carpeta conectada. */
  async disconnect() {
    this._dirHandle = null;
    this._lastRead = null;
    try {
      await idbSet(HANDLE_KEY, null);
    } catch { /* noop */ }
  },

  /** ¿Está la carpeta conectada (handle presente)? */
  isConnected() {
    return !!this._dirHandle;
  },

  /**
   * Verifica/solicita permiso de lectura sobre el handle guardado.
   * queryPermission no pide UI; requestPermission sí (necesita gesto de usuario).
   */
  async ensurePermission(interactive = false) {
    if (!this._dirHandle) return false;
    const opts = { mode: "read" };
    if ((await this._dirHandle.queryPermission(opts)) === "granted") return true;
    if (!interactive) return false;
    return (await this._dirHandle.requestPermission(opts)) === "granted";
  },

  /**
   * Lee la cola del EE.log y devuelve el bloque de texto (string). Eficiente:
   * solo trae los últimos TAIL_BYTES vía File.slice().
   */
  async _readTail() {
    if (!this._dirHandle) return null;
    const fileHandle = await this._dirHandle.getFileHandle(LOG_FILENAME);
    const file = await fileHandle.getFile();
    const start = Math.max(0, file.size - TAIL_BYTES);
    const blob = file.slice(start, file.size);
    return { text: await blob.text(), mtime: file.lastModified, size: file.size };
  },

  /**
   * Extrae los colores del ÚLTIMO kubrow construido por el juego (basta ENTRAR a la
   * vista del companion en el Arsenal; no hace falta cambiar color).
   *
   * El juego NO siempre reescribe el set completo al volver a ver el kubrow: si un
   * slot (Mundane/Mid/Vibrant/Accent/Eyes) ya está cacheado en memoria, ese
   * spot-building no se repite y el EE.log solo registra los slots que cambiaron
   * (a veces uno solo, aunque hayan pasado minutos desde la visita anterior). Por eso
   * NO basta con quedarnos con el último bloque de líneas: ACUMULAMOS todos los
   * spot-builds de kubrow de la cola leída, dejando que cada categoría nueva SUSTITUYA
   * a la anterior del mismo tipo (mismo kubrow, slot refrescado). No cerramos el set
   * por tiempo: la cola ya es acotada (TAIL_BYTES) y solo se reinicia de verdad al
   * arrancar el juego, momento en que aparece el CATÁLOGO y borra el acumulado.
   *
   * Distinguimos el CATÁLOGO (precarga masiva al arrancar el juego) porque ese bloque
   * es grande (>CATALOG_FRAME_THRESHOLD líneas seguidas sin huecos) y mezcla Catbrow;
   * un set real de kubrow nunca mezcla Catbrow. NO se deduplica dentro de un slot (un
   * kubrow puede repetir el mismo color en dos categorías). Devuelve nombres reales,
   * p.ej. ["Sedna Grey", ...].
   */
  _extractColors(text) {
    if (!text) return [];

    const MAX_SLOTS = 6;
    const CATALOG_FRAME_THRESHOLD = 8;
    // Hueco (segundos, timestamp del EE.log) que separa spot-builds del catálogo.
    const MAX_GAP_SECONDS = 0.05;

    const reTs = /^\s*([\d.]+)\s/;
    const reKubrow = /\/KubrowPet\/Colors\/KubrowPetColor([A-Za-z]+)/;
    const reCatbrow = /\/CatbrowPet\/Colors\//;
    const reAnyPetColor = /\/(?:Kubrow|Catbrow)Pet\/Colors\//;
    // Categoría del slot ignorando el sufijo de color (MidD -> Mid, VibrantF -> Vibrant).
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

    // 1. Agrupar en frames por ventana temporal corta (gap <= MAX_GAP_SECONDS entre
    //    hits consecutivos). Sin timestamp (NaN) cada hit va en su propio frame.
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

    // 2. Descartar catálogo (frames grandes o que mezclan Catbrow).
    const validFrames = frames.filter((f) => f.total <= CATALOG_FRAME_THRESHOLD && f.catbrow === 0 && f.kubrow.length > 0);
    if (!validFrames.length) return [];

    // 3. Acumular frames válidos consecutivos en un set: cada categoría nueva
    //    SUSTITUYE a la anterior del mismo tipo (refresco de slot cacheado, mismo
    //    kubrow). Un frame con slot Eyes SIEMPRE se recarga al ver un companion (es
    //    la señal más fiable de "el jugador está viendo un kubrow ahora"), así que
    //    reinicia el acumulado antes de aplicarse: evita mezclar colores de un kubrow
    //    distinto visto antes en la misma cola.
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
   * Devuelve los colores de kubrow más recientes del EE.log, o null si no hay
   * carpeta conectada / permiso / evento de kubrow en la cola.
   * Resultado: { colors: string[], mtime, at } — o null.
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
