import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { creaManejador, resuelveFichero, tipoDe, PREFIJO_OVERLAY } from "../desktop/electron/src/servidor.js";
import { creaPermisos, PERMISOS_CONOCIDOS } from "../desktop/electron/src/permisos.js";
import { Seguidor, creaLectorEELog, bibliotecasSteam, rutaEELog } from "../desktop/electron/src/eelog.js";
import { peticionValida, firmaDe, rectEnDip } from "../desktop/electron/src/paneles.js";
import { creaRegistroConsola } from "../desktop/electron/src/consola.js";
import { creaZoom, zoomPorDefecto } from "../desktop/electron/src/zoom.js";
import { HOSTS_PROPIOS, conCorsDeLaApp, conOrigenLocalParaWfm } from "../desktop/electron/src/cors.js";
import { htmlPanel, htmlBloque, coloca, zonasEnPixeles } from "../desktop/electron/overlay/paneles.js";

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
  assert.equal(peticionValida({ grupo: "x", paneles: [{ bloques: [{ tipo: "rejilla", cols: 6, celdas: Array(41).fill(null) }] }] }), false);
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

test("la rejilla pone una tarjeta por celda, respeta los huecos y escapa el texto", () => {
  const html = htmlBloque({ tipo: "rejilla", cols: 2, celdas: [
    { lineas: [{ texto: "Arcane <Grace>" }, { texto: "21", tono: "oro" }] },
    null,
    { lineas: [{ texto: "Molt Efficiency" }, { texto: "DISSOLVE", tono: "cian" }] },
  ] });
  assert.match(html, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.equal((html.match(/class="celda"/g) || []).length, 2);
  assert.equal((html.match(/class="celda vacia"/g) || []).length, 1);
  assert.match(html, /<span class="nombre tono-blanco">Arcane &#60;Grace&#62;<\/span><span class="dato tono-oro">21<\/span>/);
  assert.match(html, /<span class="dato tono-cian">DISSOLVE<\/span>/);
  assert.match(htmlBloque({ tipo: "rejilla", cols: "99\" onload=\"", celdas: [] }), /repeat\(1, /);
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
  const juntas = coloca([{ x: 0.4, y: 0 }, { x: 0.52, y: 0 }], [400, 300], vista, true);
  assert.deepEqual(juntas.map((p) => p.width), [232, 232], "las tarjetas iguales no se pisan: como mucho el hueco entre ellas");
  assert.equal(coloca([{ x: 0.5, y: 0 }], [5000], vista)[0].width, 680, "como mucho un 34%");
  assert.deepEqual(coloca([{ x: 1, y: 0, anclaje: "derecha", anchoMin: 0.2 }], [300], vista)[0], { left: 1600, top: 0, width: 400 }, "con anchoMin no cambia de ancho según el contenido");
});

test("los paneles con botones se marcan como interactivos y sus botones llevan la acción", () => {
  const html = htmlPanel({ bloques: [
    { tipo: "botones", rotulo: "Refino", botones: [{ texto: "Rad", accion: "refino:Rad", activo: true }, { texto: "x", accion: "mal accion" }] },
  ] });
  assert.match(html, /^<div class="panel interactivo">/);
  assert.match(html, /<button type="button" class="boton activo" data-accion="refino:Rad">Rad<\/button>/);
  assert.equal((html.match(/<button/g) || []).length, 1, "una acción con formato raro no se pinta");
  assert.doesNotMatch(htmlPanel({ bloques: [{ tipo: "titulo", texto: "x" }] }), /interactivo/);
});

test("las zonas clicables pasan a píxeles reales y se descartan las vacías", () => {
  assert.deepEqual(zonasEnPixeles([{ left: 10.4, top: 20.6, width: 100.2, height: 50 }, { left: 0, top: 0, width: 0, height: 10 }], 1.5),
    [{ x: 15, y: 30, width: 151, height: 75 }]);
});

test("con Warframe solo se lee: ni entrada, ni procesos, y lo nativo que escribe va a la ventana propia", () => {
  const carpeta = new URL("../desktop/electron/src/", import.meta.url);
  const fuentes = fs.readdirSync(carpeta).filter((f) => /\.(c?js)$/.test(f)).map((f) => [f, fs.readFileSync(new URL(f, carpeta), "utf8")]);
  const prohibido = /SendInput|PostMessage|SendMessage|keybd_event|mouse_event|SetForegroundWindow|SetWindowPos|ShowWindow|SetWindowLong|XSendEvent|XTest|XWarpPointer|XSetInputFocus|XRaiseWindow|XGrab|OpenProcess|ReadProcessMemory|WriteProcessMemory|CreateRemoteThread|child_process|robotjs|nut-js/;
  for (const [f, src] of fuentes) assert.doesNotMatch(src, prohibido, f);

  const juego = fuentes.find(([f]) => f === "juego.js")[1];
  const nativas = [...juego.matchAll(/func\("[^"(]*?\*?(\w+)\(/g)].map((m) => m[1]).sort();
  assert.deepEqual(nativas, [
    "ClientToScreen", "FindWindowW", "GetClientRect", "IsIconic", "IsWindowVisible",
    "XChangeWindowAttributes", "XDefaultRootWindow", "XFetchName", "XFree", "XGetClassHint", "XGetWindowAttributes",
    "XOpenDisplay", "XQueryTree", "XSetErrorHandler", "XShapeCombineRectangles", "XSync", "XTranslateCoordinates",
  ]);
  for (const llamada of juego.matchAll(/f\.(XChangeWindowAttributes|XShapeCombineRectangles)\(d, (\w+)/g)) assert.equal(llamada[2], "w");
  assert.equal(juego.match(/const w = ventanaDeAsa\(asa\);/g)?.length, 2);

  const overlay = fuentes.find(([f]) => f === "ventana-overlay.js")[1];
  const asas = [...overlay.matchAll(/(?:sinGestor|zonasDeEntrada)\(([\w.]+(?:\(\))?)/g)].map((m) => m[1]);
  assert.deepEqual(asas, ["ventana.getNativeWindowHandle()", "v.getNativeWindowHandle()"]);

  const eelog = fuentes.find(([f]) => f === "eelog.js")[1];
  assert.deepEqual([...eelog.matchAll(/abrir\(ruta, "(\w+)"\)/g)].map((m) => m[1]), ["r"]);
});

test("la consola de la app se guarda con su hora y no crece sin límite", async () => {
  const ruta = path.join(temporal(), "consola.log");
  const anota = creaRegistroConsola(ruta, { ahora: () => new Date("2026-10-03T09:46:09.123Z"), max: 120 });
  anota("info", "[MC] 18 casillas\nsegunda línea");
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(fs.readFileSync(ruta, "utf8"), "2026-10-03T09:46:09.123Z info [MC] 18 casillas | segunda línea\n");
  for (let i = 0; i < 4; i++) anota("warning", "x".repeat(40));
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(fs.existsSync(`${ruta}.1`), "pasado el tope se rota a .1");
  assert.ok(fs.statSync(ruta).size <= 120);
});

test("el overlay solo carga imágenes de assets/ de la propia app", () => {
  assert.equal(htmlBloque({ tipo: "titulo", texto: "Steflos Barrel", imagen: "assets/relic_contents/prime_barrel.webp" }),
    '<div class="titulo tono-ducado"><img class="img" src="/assets/relic_contents/prime_barrel.webp" alt="">Steflos Barrel</div>');
  for (const mala of ["../secreto.webp", "assets/../x.webp", "https://evil.example/x.png", "javascript:alert(1)", "assets/x.webp\" onerror=\"x", "/etc/passwd"]) {
    assert.ok(!htmlBloque({ tipo: "titulo", texto: "x", imagen: mala }).includes("<img"), mala);
  }
  assert.match(htmlBloque({ tipo: "lista", filas: [[{ texto: "Blade 11%", imagen: "assets/relic_contents/blade.webp" }]] }), /<img class="img" src="\/assets\/relic_contents\/blade.webp" alt="">Blade 11%/);
});

test("el zoom de la app arranca según la pantalla, se ajusta con límites y se recuerda", () => {
  assert.deepEqual([zoomPorDefecto(1920), zoomPorDefecto(2560), zoomPorDefecto(1366)], [1.1, 1.2, 1]);
  const ruta = path.join(temporal(), "zoom.json");
  const z = creaZoom(ruta, { porDefecto: 1.2 });
  assert.equal(z.get(), 1.2);
  assert.equal(z.sube(), 1.3);
  for (let i = 0; i < 20; i++) z.sube();
  assert.equal(z.get(), 2, "como mucho el doble");
  assert.equal(creaZoom(ruta, { porDefecto: 1 }).get(), 2, "se recuerda entre arranques");
  assert.equal(z.reinicia(), 1.2);
  fs.writeFileSync(ruta, "{basura");
  assert.equal(creaZoom(ruta, { porDefecto: 1.1 }).get(), 1.1);
});

test("las respuestas de los workers propios llevan el origen de la app de escritorio, y solo esas", () => {
  assert.deepEqual(HOSTS_PROPIOS, ["https://api.voidstonks.com/*", "https://*.edelamf0.workers.dev/*"]);
  const origen = "http://voidstonks.localhost:47823";
  const fuera = conCorsDeLaApp({ "access-control-allow-origin": ["https://voidstonks.com"], "Access-Control-Allow-Credentials": ["true"], "content-type": ["application/json"], vary: ["Origin"] }, origen);
  assert.deepEqual(fuera, { "content-type": ["application/json"], vary: ["Origin"], "Access-Control-Allow-Origin": [origen] });
  assert.deepEqual(conCorsDeLaApp(undefined, origen), { "Access-Control-Allow-Origin": [origen] });
});

test("solo las rutas de cuenta de WFM pedidas por la app salen con origen localhost", () => {
  const app = "http://voidstonks.localhost:47823";
  const cab = { Origin: app, "X-WFM-Token": "t" };
  assert.deepEqual(conOrigenLocalParaWfm("https://api.voidstonks.com/?type=wfm_login", cab, app), { "X-WFM-Token": "t", Origin: "http://localhost:47823" });
  assert.equal(conOrigenLocalParaWfm("https://api.voidstonks.com/?type=prices_snapshot", cab, app), cab, "lo demás no se toca");
  const ajeno = { origin: "https://evil.example" };
  assert.equal(conOrigenLocalParaWfm("https://api.voidstonks.com/?type=wfm_login", ajeno, app), ajeno, "otro origen no se disfraza");
  assert.equal(conOrigenLocalParaWfm("no es url", cab, app), cab);
});
