import { readFile, writeFile, rename, rm } from "node:fs/promises";

const LINUX_SIN_LLAVERO = new Set(["basic_text", "unknown"]);
const PLATAFORMAS = new Set(["pc", "ps4", "xbox", "switch", "mobile"]);

export function cifradoDeElectron(safeStorage, plataforma = process.platform) {
  return {
    disponible: () => {
      try {
        if (!safeStorage.isEncryptionAvailable()) return false;
        return plataforma !== "linux" || !LINUX_SIN_LLAVERO.has(safeStorage.getSelectedStorageBackend());
      } catch {
        return false;
      }
    },
    cifra: (texto) => safeStorage.encryptString(texto),
    descifra: (datos) => safeStorage.decryptString(datos)
  };
}

const validas = (d) =>
  !!d && typeof d === "object" &&
  typeof d.email === "string" && d.email.length > 0 && d.email.length <= 254 &&
  typeof d.password === "string" && d.password.length > 0 && d.password.length <= 256 &&
  PLATAFORMAS.has(d.platform) &&
  (d.nombre === null || (typeof d.nombre === "string" && d.nombre.length <= 64));

export function creaCredenciales({
  ruta,
  cifrado,
  leeFichero = readFile,
  escribeFichero = writeFile,
  renombra = rename,
  borraFichero = (r) => rm(r, { force: true })
}) {
  const borra = () => borraFichero(ruta).catch(() => {});
  return {
    disponible: () => cifrado.disponible(),
    async lee() {
      if (!cifrado.disponible()) return null;
      let bruto;
      try {
        bruto = await leeFichero(ruta);
      } catch {
        return null;
      }
      try {
        const d = JSON.parse(cifrado.descifra(bruto));
        if (validas(d)) return { email: d.email, password: d.password, platform: d.platform, nombre: d.nombre };
      } catch { }
      await borra();
      return null;
    },
    async guarda({ email, password, platform, nombre = null }) {
      const d = { email, password, platform, nombre: typeof nombre === "string" ? nombre.slice(0, 64) : null };
      if (!cifrado.disponible() || !validas(d)) return false;
      const temporal = `${ruta}.tmp`;
      await borraFichero(temporal).catch(() => {});
      await escribeFichero(temporal, cifrado.cifra(JSON.stringify(d)), { mode: 0o600 });
      await renombra(temporal, ruta);
      return true;
    },
    borra
  };
}
