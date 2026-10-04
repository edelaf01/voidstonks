import fs from "node:fs";

const MAX_BYTES = 5 * 1024 * 1024;

export function creaRegistroConsola(ruta, { ahora = () => new Date(), max = MAX_BYTES } = {}) {
  let fd = null;
  let escritos = 0;
  const abre = () => {
    try { escritos = fs.statSync(ruta).size; } catch { escritos = 0; }
    if (escritos > max) {
      try { fs.renameSync(ruta, `${ruta}.1`); } catch { }
      escritos = 0;
    }
    fd = fs.openSync(ruta, "a", 0o600);
  };
  abre();
  return (nivel, texto) => {
    const linea = `${ahora().toISOString()} ${nivel} ${String(texto ?? "").replace(/\r?\n/g, " | ")}\n`;
    try {
      escritos += fs.writeSync(fd, linea);
      if (escritos > max) {
        fs.closeSync(fd);
        abre();
      }
    } catch { }
  };
}
