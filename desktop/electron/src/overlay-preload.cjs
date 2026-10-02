const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("overlay", {
  alRecibir: (fn) => ipcRenderer.on("overlay:msg", (_e, msg) => fn(msg)),
  listo: () => ipcRenderer.send("overlay:listo"),
});
