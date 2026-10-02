const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("voidstonksNativo", {
  capacidades: () => ipcRenderer.invoke("vs:caps"),
  guardarPermisos: (permisos) => ipcRenderer.invoke("vs:permisos", permisos),
  copiar: (texto) => ipcRenderer.invoke("vs:copiar", String(texto)),
  paneles: (datos) => ipcRenderer.invoke("vs:paneles", datos),
  seguirEELog(cola, alEvento) {
    const oyente = (_e, nombre, datos) => alEvento(nombre, datos);
    ipcRenderer.on("vs:eelog", oyente);
    ipcRenderer.send("vs:eelog-seguir", Number(cola) || 0);
    return () => {
      ipcRenderer.removeListener("vs:eelog", oyente);
      ipcRenderer.send("vs:eelog-parar");
    };
  },
});
