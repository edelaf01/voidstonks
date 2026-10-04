const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("voidstonksNativo", {
  desarrollo: process.argv.includes("--vs-desarrollo"),
  capacidades: () => ipcRenderer.invoke("vs:caps"),
  guardarPermisos: (permisos) => ipcRenderer.invoke("vs:permisos", permisos),
  copiar: (texto) => ipcRenderer.invoke("vs:copiar", String(texto)),
  paneles: (datos) => ipcRenderer.invoke("vs:paneles", datos),
  alAccion(fn) {
    const oyente = (_e, grupo, accion) => fn(grupo, accion);
    ipcRenderer.on("vs:accion", oyente);
    return () => ipcRenderer.removeListener("vs:accion", oyente);
  },
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
