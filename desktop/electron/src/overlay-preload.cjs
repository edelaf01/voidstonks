const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("overlay", {
  alRecibir: (fn) => ipcRenderer.on("overlay:msg", (_e, msg) => fn(msg)),
  listo: () => ipcRenderer.send("overlay:listo"),
  accion: (grupo, accion) => ipcRenderer.send("overlay:accion", String(grupo), String(accion)),
  zonas: (rects) => ipcRenderer.send("overlay:zonas", rects),
  raton: (dentro) => ipcRenderer.send("overlay:raton", !!dentro),
});
