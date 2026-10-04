import fs from "node:fs";
import path from "node:path";

export const PERMISOS_CONOCIDOS = ["eelog", "clip", "overlay"];

export function creaPermisos(ruta) {
  let cargados = null;

  const actuales = () => {
    if (!cargados) {
      let p = {};
      try { p = JSON.parse(fs.readFileSync(ruta, "utf8")) || {}; } catch { p = {}; }
      cargados = {
        concedidos: p.concedidos && typeof p.concedidos === "object" ? p.concedidos : {},
        preguntados: Array.isArray(p.preguntados) ? p.preguntados : [],
      };
    }
    return cargados;
  };

  return {
    concedido: (id) => actuales().concedidos[id] === true,

    estado() {
      const p = actuales();
      const concedidos = {};
      const pendientes = [];
      for (const id of PERMISOS_CONOCIDOS) {
        concedidos[id] = p.concedidos[id] === true;
        if (!p.preguntados.includes(id)) pendientes.push(id);
      }
      return { concedidos, pendientes };
    },

    guardar(nuevos) {
      if (!nuevos || typeof nuevos !== "object") return false;
      const p = actuales();
      const concedidos = { ...p.concedidos };
      const preguntados = [...p.preguntados];
      for (const id of PERMISOS_CONOCIDOS) {
        if (typeof nuevos[id] !== "boolean") continue;
        concedidos[id] = nuevos[id];
        if (!preguntados.includes(id)) preguntados.push(id);
      }
      const nuevo = { concedidos, preguntados };
      fs.mkdirSync(path.dirname(ruta), { recursive: true, mode: 0o700 });
      fs.writeFileSync(ruta, JSON.stringify(nuevo, null, 2), { mode: 0o600 });
      cargados = nuevo;
      return true;
    },
  };
}
