import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { creaManejador, resuelveFichero, tipoDe, PREFIJO_OVERLAY } from "../desktop/electron/src/servidor.js";
import { creaPermisos, PERMISOS_CONOCIDOS } from "../desktop/electron/src/permisos.js";
import { Seguidor, creaLectorEELog, bibliotecasSteam, rutaEELog } from "../desktop/electron/src/eelog.js";
import { peticionValida, firmaDe, rectEnDip } from "../desktop/electron/src/paneles.js";
import { htmlPanel, htmlBloque, coloca } from "../desktop/electron/overlay/paneles.js";

const temporal = () => fs.mkdtempSync(path.join(os.tmpdir(), "vs-electron-"));

function respuesta() {
  const r = { estado: 0, cabeceras: {}, cuerpo: "" };
  r.writeHead = (estado, cabeceras = {}) => { r.estado = estado; r.cabeceras = cabeceras; return r; };
  r.end = (txt = "") => { r.cuerpo += txt; r.terminada = true; return r; };
  return r;
}

test("el servidor solo contesta a voidstonks.localhost con su puerto", () => {
  const raiz = temporal();
  fs.writeFileSync(path.join(raiz, "index.html"), "<p>hola</p>");
  const maneja = creaManejador({ raizApp: raiz, raizOverlay: raiz, puerto: 47823 });
  for (const host of ["127.0.0.1:47823", "voidstonks.localhost:47824", "evil.example"]) {
    const res = respuesta();
    maneja({ method: "GET", url: "/", headers: { host } }, res);
    assert.equal(res.estado, 421, host);
  }
  const res = respuesta();
  maneja({ method: "POST", url: "/", headers: { host: "voidstonks.localhost:47823" } }, res);
  assert.equal(res.estado, 405);
});

test("el servidor no sale de su carpeta y prueba index.html y .html", () => {
  const raiz = temporal();
  fs.mkdirSync(path.join(raiz, "sub"));
  fs.writeFileSync(path.join(raiz, "index.html"), "a");
  fs.writeFileSync(path.join(raiz, "guide.html"), "b");
  fs.writeFileSync(path.join(raiz, "sub", "index.html"), "c");
  fs.writeFileSync(path.join(path.dirname(raiz), "secreto.txt"), "x");
  assert.equal(resuelveFichero(raiz, "/"), path.join(raiz, "index.html"));
  assert.equal(resuelveFichero(raiz, "/guide"), path.join(raiz, "guide.html"));
  assert.equal(resuelveFichero(raiz, "/sub/"), path.join(raiz, "sub", "index.html"));
  assert.equal(resuelveFichero(raiz, "/../secreto.txt"), null);
  assert.equal(resuelveFichero(raiz, "/%2e%2e/secreto.txt"), null);
  assert.equal(resuelveFichero(raiz, "/no-existe.js"), null);
  assert.equal(tipoDe("a/b.mjs"), "text/javascript; charset=utf-8");
  assert.equal(tipoDe("modelo.onnx"), "application/octet-stream");
});

test("el overlay se sirve desde su propia carpeta y la caché se valida por ETag", () => {
  const app = temporal(), ov = temporal();
  fs.writeFileSync(path.join(ov, "overlay.css"), "body{}");
  const maneja = creaManejador({ raizApp: app, raizOverlay: ov, puerto: 47823 });
  const pide = (cabeceras = {}) => {
    const res = respuesta();
    maneja({ method: "HEAD", url: `${PREFIJO_OVERLAY}overlay.css`, headers: { host: "voidstonks.localhost:47823", ...cabeceras } }, res);
    return res;
  };
  const primera = pide();
  assert.equal(primera.estado, 200);
  assert.equal(primera.cabeceras["Content-Type"], "text/css; charset=utf-8");
  assert.equal(pide({ "if-none-match": primera.cabeceras.ETag }).estado, 304);
});

test("los permisos se guardan, preguntan solo por lo nuevo e ignoran lo desconocido", () => {
  const ruta = path.join(temporal(), "datos", "permisos.json");
  const p = creaPermisos(ruta);
  assert.deepEqual(p.estado().pendientes, PERMISOS_CONOCIDOS);
  assert.equal(p.concedido("clip"), false);
  assert.equal(p.guardar({ clip: true, eelog: false, raro: true }), true);
  const otra = creaPermisos(ruta);
  assert.equal(otra.concedido("clip"), true);
  assert.equal(otra.concedido("raro"), false);
  assert.deepEqual(otra.estado().pendientes, ["overlay"]);
  assert.equal(otra.guardar(null), false);
});

test("el seguidor del EE.log corta por líneas y guarda la línea a medias", () => {
  const dir = temporal();
  const log = path.join(dir, "EE.log");
  fs.writeFileSync(log, "uno\r\ndos\ntre");
  const s = new Seguidor(0);
  assert.deepEqual(s.leer(log, fs.statSync(log).size), ["uno", "dos"]);
  fs.appendFileSync(log, "s\ncuatro\n");
  assert.deepEqual(s.leer(log, fs.statSync(log).size), ["tres", "cuatro"]);
  assert.deepEqual(s.leer(log, fs.statSync(log).size), []);
});

test("el lector empieza por la cola, avisa si falta el log y detecta el reinicio del juego", () => {
  const dir = temporal();
  const log = path.join(dir, "EE.log");
  let ruta = "";
  const lector = creaLectorEELog({ cola: 8, buscaRuta: () => ruta });
  assert.equal(lector.ruta, "");
  assert.deepEqual(lector.tick(), [["falta", ""]]);
  assert.deepEqual(lector.tick(), [], "solo avisa una vez");
  fs.writeFileSync(log, "linea vieja\nnueva\n");
  ruta = log;
  assert.deepEqual(lector.tick(), [["lineas", "linea vieja\nnueva"]], "tras faltar se lee entero");
  fs.writeFileSync(log, "x\n");
  assert.deepEqual(lector.tick(), [["reinicio", log], ["lineas", "x"]]);

  const otro = creaLectorEELog({ cola: 6, buscaRuta: () => log });
  fs.writeFileSync(log, "0123456789\nabc\n");
  assert.deepEqual(otro.tick(), [["lineas", "abc"]], "la primera línea de la cola llega cortada y se tira");
});

test("las bibliotecas de Steam salen del libraryfolders.vdf y el EE.log del prefijo más reciente", () => {
  const home = temporal();
  const steam = path.join(home, ".local", "share", "Steam");
  const otra = path.join(home, "juegos");
  fs.mkdirSync(path.join(steam, "steamapps"), { recursive: true });
  fs.mkdirSync(otra);
  fs.writeFileSync(path.join(steam, "steamapps", "libraryfolders.vdf"), `"libraryfolders" { "0" { "path" "${steam}" } "1" { "path" "${otra}" } }`);
  const libs = bibliotecasSteam({ home });
  assert.deepEqual(libs, [fs.realpathSync(steam), fs.realpathSync(otra)]);
  const log = path.join(otra, "steamapps", "compatdata", "230410", "pfx", "drive_c", "users", "steamuser", "AppData", "Local", "Warframe", "EE.log");
  fs.mkdirSync(path.dirname(log), { recursive: true });
  fs.writeFileSync(log, "");
  assert.equal(rutaEELog({ env: {}, plataforma: "linux", home }), fs.realpathSync(path.dirname(log)) + path.sep + "EE.log");
  assert.equal(rutaEELog({ env: { VOIDSTONKS_EELOG: "/x/EE.log" } }), "/x/EE.log");
});

test("las peticiones de paneles se validan como en el lanzador", () => {
  assert.equal(peticionValida({ grupo: "riven", paneles: [] }), true);
  assert.equal(peticionValida({ grupo: "Riven", paneles: [] }), false);
  assert.equal(peticionValida({ grupo: "x", paneles: Array(9).fill({}) }), false);
  assert.equal(peticionValida({ grupo: "x", paneles: [{ bloques: [{ tipo: "lista", filas: Array(41).fill([]) }] }] }), false);
  assert.equal(peticionValida(null), false);
  assert.notEqual(firmaDe({ paneles: [{ x: 1 }] }), firmaDe({ paneles: [{ x: 1 }], mismoAncho: true }));
  assert.deepEqual(rectEnDip({ x: 300, y: 150, width: 2560, height: 1440 }, 1.5), { x: 200, y: 100, width: 1707, height: 960 });
});

test("los paneles se pintan con las clases de la app y escapan el texto", () => {
  const html = htmlPanel({ borde: "valor", bloques: [
    { tipo: "titulo", texto: "<b>Kiosko</b>" },
    { tipo: "chips", chips: [{ texto: "TE LLEVAS ≈5p", tipo: "valor" }, { texto: "x", tipo: "raro" }] },
    { tipo: "estado", texto: "4 en juego", tono: "verde" },
    { tipo: "separador" },
    { tipo: "precio", plat: "5", ducados: "45" },
  ] });
  assert.match(html, /^<div class="panel borde-valor">/);
  assert.match(html, /&#60;b&#62;Kiosko&#60;\/b&#62;/);
  assert.match(html, /chip chip-valor/);
  assert.match(html, /chip chip-pl">x</, "un tipo desconocido cae en uno conocido");
  assert.match(html, /Ducats\.webp/);
  assert.equal(htmlPanel({ borde: "x\" onload=\"", bloques: [] }), `<div class="panel"></div>`);
  assert.equal(htmlBloque({ tipo: "precio", plat: "?" }).includes("duc"), false);
});

test("las listas rellenan las filas cortas y la primera columna es la que encoge", () => {
  const html = htmlBloque({ tipo: "lista", filas: [
    [{ texto: "ACTUAL", tono: "gris" }, { texto: "~85p", tono: "oro" }, { texto: "63/100" }],
    [{ texto: "+120% Multishot", tono: "verde" }, { texto: "[A]", tono: "gradoA" }],
  ] });
  assert.match(html, /grid-template-columns: minmax\(0, 1fr\) repeat\(2, max-content\)/);
  assert.equal(html.match(/<span/g).length, 6);
  assert.match(html, /dato tono-gradoA/);
});

test("los paneles se anclan, no se salen del juego y con mismoAncho miden igual", () => {
  const vista = { ancho: 2000, alto: 1000 };
  const [c, d, i] = coloca([{ x: 0.5, y: 0.44 }, { x: 0.985, y: 0.1, anclaje: "derecha" }, { x: 0, y: 0.2, anclaje: "izquierda" }], [200, 300, 100], vista);
  assert.deepEqual(c, { left: 900, top: 440, width: 200 });
  assert.equal(d.left + d.width, 1970);
  assert.equal(i.left, 0);
  const [borde] = coloca([{ x: 0.99, y: 0 }], [300], vista);
  assert.equal(borde.left + borde.width, 2000);
  const iguales = coloca([{ x: 0.3, y: 0 }, { x: 0.6, y: 0 }], [150, 180], vista, true);
  assert.deepEqual(iguales.map((p) => p.width), [200, 200], "nunca por debajo del 10% del ancho");
  assert.equal(coloca([{ x: 0.5, y: 0 }], [5000], vista)[0].width, 680, "como mucho un 34%");
});
