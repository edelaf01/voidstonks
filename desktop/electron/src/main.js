import { app, BrowserWindow, clipboard, desktopCapturer, dialog, ipcMain, Menu, screen, session, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { arrancaServidor, PREFIJO_OVERLAY } from "./servidor.js";
import { creaPermisos } from "./permisos.js";
import { creaLectorEELog, rutaEELog } from "./eelog.js";
import { peticionValida } from "./paneles.js";
import { estadoDelJuego, puedePintar, ventanaDelJuego } from "./juego.js";
import { creaEligeFuente } from "./captura.js";
import { creaOverlay } from "./ventana-overlay.js";
import { creaVigiaDelJuego } from "./vigia-juego.js";
import { creaRegistroConsola } from "./consola.js";
import { creaZoom, zoomPorDefecto } from "./zoom.js";
import { HOSTS_PROPIOS, conCorsDeLaApp, conOrigenLocalParaWfm } from "./cors.js";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ_PAQUETE = path.resolve(AQUI, "..");
const DESARROLLO = !app.isPackaged;
const PERMITIDOS = new Set(["clipboard-sanitized-write", "clipboard-read", "notifications", "media", "display-capture", "fullscreen"]);

app.setName("VoidStonks");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
const SOBRE_X11 = "--ozone-platform=x11";
const relanzaEnX11 = process.platform === "linux" && !!process.env.DISPLAY && !process.argv.includes(SOBRE_X11);
if (relanzaEnX11) {
  app.relaunch({ execPath: process.env.APPIMAGE || process.execPath, args: [...process.argv.slice(1), SOBRE_X11] });
  app.exit(0);
}

const unica = !relanzaEnX11 && app.requestSingleInstanceLock();
if (!unica && !relanzaEnX11) app.quit();

function raizApp() {
  if (process.env.VOIDSTONKS_DIR) return path.resolve(process.env.VOIDSTONKS_DIR);
  return app.isPackaged ? path.join(process.resourcesPath, "app") : path.resolve(RAIZ_PAQUETE, "..", "..", "deploy");
}

const origenDe = (url) => {
  try { return new URL(url).origin; } catch { return ""; }
};

let principal = null;

app.on("second-instance", () => {
  if (!principal) return;
  if (principal.isMinimized()) principal.restore();
  principal.focus();
});

app.on("window-all-closed", () => app.quit());

app.whenReady().then(async () => {
  if (!unica) return;
  Menu.setApplicationMenu(null);
  const servidor = await arrancaServidor({ raizApp: raizApp(), raizOverlay: path.join(RAIZ_PAQUETE, "overlay") });
  const { origen } = servidor;
  const permisos = creaPermisos(path.join(app.getPath("userData"), "permisos.json"));
  const overlay = creaOverlay({
    url: `${origen}${PREFIJO_OVERLAY}index.html`,
    preload: path.join(AQUI, "overlay-preload.cjs"),
    alAccion: (grupo, accion) => {
      if (principal && !principal.isDestroyed()) principal.webContents.send("vs:accion", grupo, accion);
    },
  });
  const esDeLaApp = (e) => !!principal && e.sender === principal.webContents && origenDe(e.senderFrame?.url) === origen;

  session.defaultSession.webRequest.onHeadersReceived({ urls: HOSTS_PROPIOS }, (detalles, responde) => {
    responde({ responseHeaders: conCorsDeLaApp(detalles.responseHeaders, origen) });
  });
  if (DESARROLLO) {
    session.defaultSession.webRequest.onBeforeSendHeaders({ urls: HOSTS_PROPIOS }, (detalles, responde) => {
      responde({ requestHeaders: conOrigenLocalParaWfm(detalles.url, detalles.requestHeaders, origen) });
    });
  }

  session.defaultSession.setPermissionRequestHandler((_wc, permiso, cb, detalles) => {
    cb(PERMITIDOS.has(permiso) && origenDe(detalles.requestingUrl) === origen);
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permiso, origenPeticion) => PERMITIDOS.has(permiso) && origenPeticion === origen);
  const eligeFuente = creaEligeFuente({ plataforma: process.platform, env: process.env, juegoEnX11: () => !!ventanaDelJuego(), listaFuentes: () => desktopCapturer.getSources({ types: ["window", "screen"], thumbnailSize: { width: 0, height: 0 } }) });
  session.defaultSession.setDisplayMediaRequestHandler(async (_peticion, responde) => {
    try {
      const fuente = await eligeFuente();
      responde(fuente ? { video: fuente } : {});
    } catch (e) {
      console.error("[captura]", e);
      responde({});
    }
  }, { useSystemPicker: true });

  ipcMain.handle("vs:caps", (e) => {
    if (!esDeLaApp(e)) return null;
    const { concedidos, pendientes } = permisos.estado();
    return {
      so: process.platform === "win32" ? "windows" : process.platform,
      clip: true,
      eelog: rutaEELog(),
      overlay: puedePintar(),
      permisos: concedidos,
      pendientes,
    };
  });

  ipcMain.handle("vs:permisos", (e, nuevos) => {
    if (!esDeLaApp(e)) return false;
    const ok = permisos.guardar(nuevos);
    if (!permisos.concedido("overlay")) overlay.quitaTodos();
    if (!permisos.concedido("eelog")) paraTodosLosSeguidores();
    return ok;
  });

  ipcMain.handle("vs:copiar", (e, texto) => {
    if (!esDeLaApp(e) || !permisos.concedido("clip") || typeof texto !== "string" || texto.length > 64 * 1024) return false;
    clipboard.writeText(texto);
    return true;
  });

  ipcMain.handle("vs:paneles", (e, datos) => {
    if (!esDeLaApp(e) || !permisos.concedido("overlay") || !peticionValida(datos)) return false;
    return overlay.paneles(datos);
  });

  const seguidores = new Map();
  const paraSeguidor = (id) => {
    clearInterval(seguidores.get(id));
    seguidores.delete(id);
  };
  function paraTodosLosSeguidores() {
    for (const id of [...seguidores.keys()]) paraSeguidor(id);
  }

  ipcMain.on("vs:eelog-seguir", (e, cola) => {
    if (!esDeLaApp(e) || !permisos.concedido("eelog")) return;
    const wc = e.sender;
    paraSeguidor(wc.id);
    const lector = creaLectorEELog({ cola });
    wc.send("vs:eelog", "ruta", lector.ruta);
    seguidores.set(wc.id, setInterval(() => {
      if (wc.isDestroyed() || !permisos.concedido("eelog")) return paraSeguidor(wc.id);
      for (const [nombre, datos] of lector.tick()) wc.send("vs:eelog", nombre, datos);
    }, 500));
  });

  ipcMain.on("vs:eelog-parar", (e) => paraSeguidor(e.sender.id));

  const vigia = creaVigiaDelJuego({ estado: estadoDelJuego });
  ipcMain.on("vs:juego-seguir", (e) => {
    if (esDeLaApp(e)) vigia.sigue(e.sender);
  });
  ipcMain.on("vs:juego-parar", (e) => vigia.para(e.sender.id));

  principal = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 480,
    minHeight: 560,
    show: false,
    backgroundColor: "#0e1014",
    title: "VoidStonks",
    icon: path.join(RAIZ_PAQUETE, "build", "icon.png"),
    webPreferences: {
      preload: path.join(AQUI, "preload.cjs"),
      sandbox: true,
      contextIsolation: true,
      backgroundThrottling: false,
      spellcheck: false,
      additionalArguments: DESARROLLO ? ["--vs-desarrollo"] : [],
    },
  });
  const wc = principal.webContents;
  const anota = creaRegistroConsola(path.join(app.getPath("userData"), "consola.log"));
  wc.on("console-message", (e, nivel, mensaje) => anota(e.level ?? nivel, e.message ?? mensaje));
  const zoom = creaZoom(path.join(app.getPath("userData"), "zoom.json"), { porDefecto: zoomPorDefecto(screen.getPrimaryDisplay().size.width) });
  wc.on("did-finish-load", () => wc.setZoomFactor(zoom.get()));
  principal.once("ready-to-show", () => principal.show());
  principal.on("closed", () => {
    overlay.cierra();
    principal = null;
  });
  wc.on("did-navigate", () => {
    paraSeguidor(wc.id);
    vigia.para(wc.id);
    overlay.cierra();
  });
  wc.on("before-input-event", (_e, input) => {
    if (input.type !== "keyDown") return;
    if (input.key === "F12") wc.toggleDevTools();
    if (input.key === "F5") wc.reloadIgnoringCache();
    if (input.control || input.meta) {
      if (input.key === "+" || input.key === "=") wc.setZoomFactor(zoom.sube());
      else if (input.key === "-") wc.setZoomFactor(zoom.baja());
      else if (input.key === "0") wc.setZoomFactor(zoom.reinicia());
    }
  });
  wc.setWindowOpenHandler(({ url }) => {
    if (origenDe(url) === origen) return { action: "allow", overrideBrowserWindowOptions: { autoHideMenuBar: true, backgroundColor: "#0e1014" } };
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  wc.on("will-navigate", (e, url) => {
    if (origenDe(url) === origen) return;
    e.preventDefault();
    if (/^https?:/.test(url)) shell.openExternal(url);
  });
  app.on("before-quit", () => {
    paraTodosLosSeguidores();
    vigia.paraTodos();
    overlay.cierra();
    servidor.cerrar();
  });
  principal.loadURL(`${origen}/`);
}).catch((e) => {
  dialog.showErrorBox("VoidStonks", String(e?.message || e));
  app.exit(1);
});
