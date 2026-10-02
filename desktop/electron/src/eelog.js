import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const WARFRAME_APP_ID = "230410";
export const MAX_COLA = 1 << 20;
const MAX_POR_TICK = 1 << 20;
const DENTRO_DEL_PREFIJO = ["steamapps", "compatdata", WARFRAME_APP_ID, "pfx", "drive_c", "users", "steamuser", "AppData", "Local", "Warframe", "EE.log"];

export function bibliotecasSteam({ home = os.homedir(), leer = fs.readFileSync, real = fs.realpathSync } = {}) {
  const raices = [
    path.join(home, ".local", "share", "Steam"),
    path.join(home, ".steam", "steam"),
    path.join(home, ".var", "app", "com.valvesoftware.Steam", ".local", "share", "Steam"),
  ];
  const vistas = new Set();
  const libs = [];
  const anade = (p) => {
    try {
      const r = real(p);
      if (!vistas.has(r)) { vistas.add(r); libs.push(r); }
    } catch { /* no existe */ }
  };
  for (const raiz of raices) {
    anade(raiz);
    let vdf;
    try { vdf = leer(path.join(raiz, "steamapps", "libraryfolders.vdf"), "utf8"); } catch { continue; }
    for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) anade(m[1].replaceAll("\\\\", "\\"));
  }
  return libs;
}

export function rutaEELog({ env = process.env, plataforma = process.platform, stat = fs.statSync, ...deps } = {}) {
  if (env.VOIDSTONKS_EELOG) return env.VOIDSTONKS_EELOG;
  const cands = plataforma === "win32"
    ? [path.join(env.LOCALAPPDATA || "", "Warframe", "EE.log")]
    : bibliotecasSteam(deps).map((lib) => path.join(lib, ...DENTRO_DEL_PREFIJO));
  let mejor = "", cuando = -1;
  for (const c of cands) {
    try {
      const t = stat(c).mtimeMs;
      if (t > cuando) { mejor = c; cuando = t; }
    } catch { /* no existe */ }
  }
  return mejor;
}

export class Seguidor {
  constructor(pos = -1) {
    this.pos = pos;
    this.resto = Buffer.alloc(0);
    this.tirar = false;
  }

  leer(ruta, hasta, { abrir = fs.openSync, leerBytes = fs.readSync, cerrar = fs.closeSync } = {}) {
    if (hasta <= this.pos) return [];
    let fd;
    try { fd = abrir(ruta, "r"); } catch { return []; }
    let n = 0;
    const buf = Buffer.alloc(Math.min(hasta - this.pos, MAX_POR_TICK));
    try { n = leerBytes(fd, buf, 0, buf.length, this.pos); } catch { n = 0; } finally { cerrar(fd); }
    this.pos += n;
    const datos = Buffer.concat([this.resto, buf.subarray(0, n)]);
    const corte = datos.lastIndexOf(0x0a);
    if (corte < 0) { this.resto = datos; return []; }
    this.resto = Buffer.from(datos.subarray(corte + 1));
    let lineas = datos.subarray(0, corte).toString("utf8").split("\n");
    if (this.tirar) { lineas = lineas.slice(1); this.tirar = false; }
    return lineas.map((l) => l.replace(/\r$/, ""));
  }
}

export function creaLectorEELog({ cola = 0, buscaRuta = rutaEELog, stat = fs.statSync, io } = {}) {
  cola = Math.min(Math.max(Number(cola) || 0, 0), MAX_COLA);
  let ruta = buscaRuta();
  let s = new Seguidor();
  let falta = false;
  return {
    get ruta() { return ruta; },
    tick() {
      const eventos = [];
      if (!ruta) ruta = buscaRuta();
      let info = null;
      try { if (ruta) info = stat(ruta); } catch { info = null; }
      if (!info) {
        if (!falta) { eventos.push(["falta", ruta]); falta = true; }
        s = new Seguidor(0);
        return eventos;
      }
      if (s.pos < 0) {
        s.pos = Math.max(info.size - cola, 0);
        s.tirar = s.pos > 0;
      } else if (info.size < s.pos) {
        eventos.push(["reinicio", ruta]);
        s = new Seguidor(0);
      }
      falta = false;
      const lineas = s.leer(ruta, info.size, io);
      if (lineas.length) eventos.push(["lineas", lineas.join("\n")]);
      return eventos;
    },
  };
}
