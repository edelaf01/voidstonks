// El lanzador de escritorio (desktop/launcher) sirve la app en el mismo origen y hace de puente nativo.
// La cabecera propia es la que el lanzador exige para las rutas que escriben.
const NATIVO = { "X-VoidStonks": "1" };
const puente = () => globalThis.voidstonksNativo;

export async function latirAlLanzador() {
  if (puente()) return true;
  try {
    const res = await fetch("/__voidstonks/alive", { method: "POST" });
    return res.ok;
  } catch {
    return false;
  }
}

export async function capacidadesDelLanzador() {
  if (puente()) return puente().capacidades().catch(() => null);
  try {
    const res = await fetch("/__voidstonks/caps", { cache: "no-store" });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

export async function guardarPermisosEnLanzador(permisos) {
  if (puente()) return puente().guardarPermisos(permisos).catch(() => false);
  try {
    const res = await fetch("/__voidstonks/permisos", {
      method: "POST",
      headers: { ...NATIVO, "Content-Type": "application/json" },
      body: JSON.stringify(permisos),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function copiarConLanzador(texto) {
  if (puente()) return puente().copiar(texto).catch(() => false);
  try {
    const res = await fetch("/__voidstonks/clip", { method: "POST", headers: NATIVO, body: texto });
    return res.ok;
  } catch {
    return false;
  }
}

export async function panelesEnJuego(datos, { keepalive = false } = {}) {
  if (puente()) return puente().paneles(datos).catch(() => false);
  try {
    const res = await fetch("/__voidstonks/paneles", {
      method: "POST",
      keepalive,
      headers: { ...NATIVO, "Content-Type": "application/json" },
      body: JSON.stringify(datos),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Devuelve la función que corta el seguimiento.
export function seguirEELogDelLanzador({ cola = 0, alLeer, alEstado }) {
  if (puente()) {
    return puente().seguirEELog(cola, (nombre, datos) => (nombre === "lineas" ? alLeer(datos.split("\n")) : alEstado?.(nombre, datos)));
  }
  const fuente = new EventSource(`/__voidstonks/eelog?cola=${cola}`);
  fuente.addEventListener("lineas", (e) => alLeer(e.data.split("\n")));
  for (const nombre of ["ruta", "falta", "reinicio"]) {
    fuente.addEventListener(nombre, (e) => alEstado?.(nombre, e.data));
  }
  // EventSource reconecta solo; mientras tanto el log no describe nada.
  fuente.addEventListener("error", () => alEstado?.("error", ""));
  return () => fuente.close();
}
