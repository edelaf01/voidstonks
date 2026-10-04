const puente = () => globalThis.voidstonksNativo;

export async function capacidadesDelLanzador() {
  return puente()?.capacidades().catch(() => null) ?? null;
}

export async function guardarPermisosEnLanzador(permisos) {
  return puente()?.guardarPermisos(permisos).catch(() => false) ?? false;
}

export async function copiarConLanzador(texto) {
  return puente()?.copiar(texto).catch(() => false) ?? false;
}

export async function panelesEnJuego(datos) {
  return puente()?.paneles(datos).catch(() => false) ?? false;
}

export function escucharAccionesDelOverlay(fn) {
  return puente()?.alAccion?.(fn) || (() => {});
}

export function seguirEELogDelLanzador({ cola = 0, alLeer, alEstado }) {
  if (!puente()) return () => {};
  return puente().seguirEELog(cola, (nombre, datos) => (nombre === "lineas" ? alLeer(datos.split("\n")) : alEstado?.(nombre, datos)));
}
