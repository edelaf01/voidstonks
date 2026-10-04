import { BrowserWindow, ipcMain, screen } from "electron";
import { firmaDe, rectEnDip } from "./paneles.js";
import { ventanaDelJuego, sinGestor, zonasDeEntrada } from "./juego.js";

const mismoRect = (a, b) => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

function aDip(rect) {
  if (process.platform === "win32") return screen.screenToDipRect(null, rect);
  return rectEnDip(rect, screen.getPrimaryDisplay().scaleFactor);
}

const RE_GRUPO = /^[a-z]{1,16}$/;
const RE_ACCION = /^[a-z]{1,16}:[A-Za-z0-9]{1,16}$/;
const EN_WINDOWS = process.platform === "win32";

function rectsValidos(rects) {
  if (!Array.isArray(rects) || rects.length > 16) return [];
  return rects.filter((r) => [r?.x, r?.y, r?.width, r?.height].every(Number.isFinite));
}

export function creaOverlay({ url, preload, alAccion = () => {} }) {
  let ventana = null;
  let lista = null;
  const grupos = new Map();
  const deLaVentana = (e) => !!ventana && e.sender === ventana.webContents;

  ipcMain.on("overlay:accion", (e, grupo, accion) => {
    if (deLaVentana(e) && RE_GRUPO.test(grupo) && RE_ACCION.test(accion)) alAccion(grupo, accion);
  });
  ipcMain.on("overlay:raton", (e, dentro) => {
    if (EN_WINDOWS && deLaVentana(e)) ventana.setIgnoreMouseEvents(!dentro, { forward: true });
  });
  ipcMain.on("overlay:zonas", (e, rects) => {
    if (!EN_WINDOWS && deLaVentana(e)) zonasDeEntrada(ventana.getNativeWindowHandle(), rectsValidos(rects));
  });

  function crea(bounds) {
    const v = new BrowserWindow({
      ...bounds,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      focusable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      title: "VoidStonks overlay",
      webPreferences: { preload, sandbox: true, contextIsolation: true, backgroundThrottling: false, spellcheck: false },
    });
    v.setIgnoreMouseEvents(true, EN_WINDOWS ? { forward: true } : undefined);
    if (EN_WINDOWS) v.setAlwaysOnTop(true, "screen-saver");
    else sinGestor(v.getNativeWindowHandle());
    lista = new Promise((resolve) => {
      const alListo = (e) => {
        if (e.sender !== v.webContents) return;
        ipcMain.off("overlay:listo", alListo);
        resolve();
      };
      ipcMain.on("overlay:listo", alListo);
      v.once("closed", () => { ipcMain.off("overlay:listo", alListo); resolve(); });
    });
    v.once("closed", () => {
      if (ventana !== v) return;
      ventana = null;
      for (const g of grupos.values()) clearTimeout(g.reloj);
      grupos.clear();
    });
    v.loadURL(url);
    return v;
  }

  function quita(grupo) {
    const g = grupos.get(grupo);
    if (!g) return;
    clearTimeout(g.reloj);
    grupos.delete(grupo);
    if (!ventana) return;
    ventana.webContents.send("overlay:msg", { tipo: "quita", grupo });
    if (!grupos.size) ventana.hide();
  }

  async function muestra(p) {
    const juego = ventanaDelJuego();
    if (!juego) return false;
    const bounds = aDip(juego);
    if (!ventana) ventana = crea(bounds);
    else if (!mismoRect(ventana.getBounds(), bounds)) ventana.setBounds(bounds);
    const v = ventana;
    await lista;
    if (ventana !== v || v.isDestroyed()) return false;
    const previo = grupos.get(p.grupo);
    clearTimeout(previo?.reloj);
    const firma = firmaDe(p);
    if (firma !== previo?.firma) {
      v.webContents.send("overlay:msg", { tipo: "grupo", grupo: p.grupo, paneles: p.paneles, mismoAncho: !!p.mismoAncho });
    }
    const reloj = p.duracionMs > 0 ? setTimeout(() => quita(p.grupo), p.duracionMs) : null;
    grupos.set(p.grupo, { firma, reloj });
    if (!v.isVisible()) v.showInactive();
    return true;
  }

  return {
    paneles(p) {
      if (p.paneles.length) return muestra(p);
      quita(p.grupo);
      return Promise.resolve(true);
    },
    quitaTodos() {
      for (const g of [...grupos.keys()]) quita(g);
    },
    cierra() {
      this.quitaTodos();
      if (ventana && !ventana.isDestroyed()) ventana.destroy();
      ventana = null;
    },
  };
}
