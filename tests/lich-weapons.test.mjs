// Apartado "Armas en rotación" de Farms (Eleanor / Ergo Glast).
//
// Ninguna API publica estas tiendas: el lote activo se CALCULA a partir de una época fija
// y el bonus de valencia se lee del wikitext. Los dos son silenciosos al fallar —un ciclo
// desfasado enseña el lote equivocado con toda la confianza del mundo, y un cambio de
// maquetación en la wiki deja las tarjetas sin bonus— así que se fijan aquí.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { optionalSource } from "./_helpers/optional-source.mjs";

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const { src: workerCodeSrc, missing: sinWorker, test } = optionalSource(
  new URL("../worker-code.js", import.meta.url),
);

/**
 * Interioridades del worker sin importarlo.
 *
 * No se pueden exportar con nombre: Cloudflare exige que todo export con nombre sea una
 * función o un ExportedHandler, y un `export const CODA_EPOCH = <número>` tumba el worker
 * al arrancar ("Incorrect type for map entry"). Ya pasó una vez y el deploy se rechazó.
 *
 * El fuente hasta `export default` son solo constantes y objetos sin efectos secundarios,
 * así que se evalúa tal cual y se devuelve lo que hace falta medir.
 */
function workerInternals() {
  const src = workerCodeSrc;
  // Anclado a principio de línea: un comentario que mencione el handler por su nombre
  // truncaría el fuente a la mitad si se buscara la cadena suelta (ya pasó).
  const head = src.slice(0, src.search(/^export default\b/m));
  assert.ok(!/^export /m.test(head), "el worker no puede tener exports con nombre: no arranca");
  return new Function(
    `${head}\nreturn { AdversaryWeapons, CODA_EPOCH, GLAST_EPOCH, ROTATION_MS, CODA_BATCHES, GLAST_WEAPONS, VALENCE_ROW_RE };`,
  )();
}

const {
  AdversaryWeapons,
  CODA_EPOCH,
  GLAST_EPOCH,
  ROTATION_MS,
  CODA_BATCHES,
  GLAST_WEAPONS,
  VALENCE_ROW_RE,
  // Sin worker-code.js no hay nada que evaluar; los tests de este fichero ya salen en skip.
} = sinWorker ? {} : workerInternals();

const serviceSrc = read("../deploy/js/services/farms/lich_weapons.service.js");
const uiSrc = read("../deploy/js/ui.components/market/ui_lich_weapons.js");
const farmsSrc = read("../deploy/js/ui.components/farms/ui_farms.js");
// TEXTS se importa como objeto en vez de grepear el fuente: comprobar que la clave existe en
// las dos ramas es el invariante real, y así no se rompe cuando TEXTS cambia de fichero (pasó
// al sacarlo de config.js a assets/texts.js). El fuente se sigue leyendo aparte para lo que sí
// es una comprobación de código: la guarda de localhost de resolveWorkerUrl.
const { TEXTS } = await import("../deploy/js/config.js");
const configSrc = read("../deploy/js/config.js");
const htmlSrc = read("../deploy/index.html");

const batchAt = (iso) => (AdversaryWeapons.window(CODA_EPOCH, Date.parse(iso)).index % 2 === 0 ? "A" : "B");

// ---- Rotación ----

test("la ventana empieza y acaba en fronteras de 4 días desde la época", () => {
  const w = AdversaryWeapons.window(CODA_EPOCH, Date.parse("2025-03-19T13:37:00Z"));
  assert.equal(new Date(w.start).toISOString(), "2025-03-18T00:00:00.000Z");
  assert.equal(new Date(w.end).toISOString(), "2025-03-22T00:00:00.000Z");
  assert.equal(w.end - w.start, ROTATION_MS);
});

test("el instante exacto de la rotación ya pertenece a la ventana nueva", () => {
  // Con `<=` en vez de `<` en el floor, el corte de las 00:00 UTC se quedaría un tick
  // en el lote viejo y el contador saldría en negativo.
  const w = AdversaryWeapons.window(CODA_EPOCH, CODA_EPOCH + ROTATION_MS);
  assert.equal(w.index, 1);
  assert.equal(w.start, CODA_EPOCH + ROTATION_MS);
});

test("Eleanor alterna A y B en ventanas consecutivas (ciclo de 8 días)", () => {
  assert.equal(batchAt("2025-03-18T00:00:00Z"), "A"); // la época es el arranque del lote A
  assert.equal(batchAt("2025-03-21T23:59:59Z"), "A");
  assert.equal(batchAt("2025-03-22T00:00:00Z"), "B");
  assert.equal(batchAt("2025-03-26T00:00:00Z"), "A"); // vuelta completa: +8 días
});

test("el lote activo coincide con la fórmula que publica la wiki", () => {
  // {{#expr: floor((( now - 2025-03-18 ) mod (86400*8)) / (86400*4))}}
  const wikiIndex = (ms) => Math.floor(((ms - CODA_EPOCH) % (8 * 86400000)) / ROTATION_MS);
  for (let day = 0; day < 40; day++) {
    const ms = CODA_EPOCH + day * 86400000 + 3600000;
    assert.equal(batchAt(new Date(ms).toISOString()), wikiIndex(ms) === 0 ? "A" : "B", `día +${day}`);
  }
});

test("los dos lotes de Eleanor son disjuntos y cubren las 14 armas Coda", () => {
  // De ahí que el parser del wikitext pueda leer las tablas de los dos lotes de golpe:
  // sin nombres repetidos no hay forma de que una fila pise a la otra.
  const all = [...CODA_BATCHES.A, ...CODA_BATCHES.B];
  assert.equal(new Set(all).size, all.length, "un arma no puede estar en los dos lotes");
  assert.equal(all.length, 14);
});

test("Ergo Glast no tiene lotes: su catálogo es fijo y solo rota el bonus", () => {
  assert.equal(GLAST_WEAPONS.length, 5);
  const w = AdversaryWeapons.window(GLAST_EPOCH, Date.parse("2026-08-09T12:00:00Z"));
  assert.equal(new Date(w.end).toISOString(), "2026-08-11T00:00:00.000Z");
});

// ---- Bonus de valencia (wikitext) ----

test("el parser lee las dos maquetaciones de fila que usa la wiki", () => {
  // Coda_Weapons escribe el arma en plano; Tenet_Weapons la envuelve en {{Weapon|...}}.
  const wikitext = `
    <tr><td>Coda Catabolyst</td><td>{{D|Toxin}}</td><td>{{ValenceBonusPercentageColor|37.4}}</td></tr>
    <tr><td>Dual Coda Torxica</td><td>{{D|Impact}}</td><td>{{ValenceBonusPercentageColor|25.1}}</td></tr>
    <tr><td>{{Weapon|Tenet Ferrox}}</td><td>{{D|Impact}}</td><td>{{ValenceBonusPercentageColor|30.3}}</td></tr>
    <tr><td>{{Weapon|Tenet Exec}}</td><td> {{D|Magnetic}}</td><td>{{ValenceBonusPercentageColor|52.3}}</td></tr>
    <tr><td>{{Weapon|Tenet Agendus}}</td><td> {{D|Magnetic}}</td><td>{{ValenceBonusPercentageColor|25}}</td></tr>
  `;
  const rows = [...wikitext.matchAll(VALENCE_ROW_RE)].map((m) => [m[1], m[2], m[3]]);
  assert.deepEqual(rows, [
    ["Coda Catabolyst", "Toxin", "37.4"],
    ["Dual Coda Torxica", "Impact", "25.1"],
    ["Tenet Ferrox", "Impact", "30.3"],
    ["Tenet Exec", "Magnetic", "52.3"],
    ["Tenet Agendus", "Magnetic", "25"],
  ]);
});

test("las cabeceras y las filas de otras tablas no se cuelan como bonus", () => {
  const wikitext = `
    <tr><th>Weapon</th><th>Element</th><th>Bonus %</th></tr>
    <tr><td>Coda Hema</td><td>{{D|Electricity}}</td><td>35.1</td></tr>
    <tr><td>Coda Pox</td><td>{{D|Magnetic}}</td><td>{{ValenceBonusPercentageColor|32.9}}</td></tr>
  `;
  const rows = [...wikitext.matchAll(VALENCE_ROW_RE)].map((m) => m[1]);
  // La fila de Hema no lleva la plantilla de color: sin ella no es un bonus reportado.
  assert.deepEqual(rows, ["Coda Pox"]);
});

test("un arma sin fila en la wiki simplemente se queda sin bonus", () => {
  const built = AdversaryWeapons.build(["Coda Mire"], {}, {});
  assert.equal(built.length, 1, "el arma se emite aunque falten stats y bonus");
  assert.equal(built[0].bonus, null);
  assert.equal(built[0].name, "Coda Mire");
});

test("el desglose de daño descarta los tipos a cero", () => {
  const stats = { "Coda Mire": { damage: { total: 100, toxin: 100, heat: 0, slash: 0 } } };
  const [w] = AdversaryWeapons.build(["Coda Mire"], stats, {});
  assert.deepEqual(w.damage, [{ type: "toxin", value: 100 }]);
});

// ---- Contratos del cliente ----

test("solo se reintenta mientras falte algún bonus", () => {
  // El lote y las stats están fijados hasta la rotación: una vez reportados todos los
  // bonus no hay nada que refrescar y seguir pidiendo cada 30 min sería gasto puro.
  const workerSrc = read("../worker-code.js");
  const handler = workerSrc.slice(workerSrc.indexOf("async 'lich_weapons'"));
  assert.match(handler, /const pending = data\.vendors\.some\(/);
  assert.match(handler, /pending \? Math\.min\(1800, remaining\) : remaining/);
  // El ttl nunca puede pasarse del corte: serviría el lote viejo tras rotar.
  assert.match(handler, /remaining = Math\.floor\(\(Math\.min\(coda\.end, glast\.end\) - now\)/);
});

test("el cliente no tiene caché propia que tape al worker", () => {
  // El worker es la fuente de verdad y ya mide su Cache-Control (30 min con bonus
  // pendientes, hasta la rotación cuando están todos), así que preguntar siempre no gasta
  // red: contesta la caché HTTP del navegador. Una caducidad propia en IndexedDB sí tapaba
  // los datos nuevos, que es justo lo que no debe pasar.
  assert.ok(!/expiryTime/.test(serviceSrc), "una caducidad propia vuelve a tapar al worker");
  assert.ok(
    !/if \(!force && cached/.test(serviceSrc),
    "no debe haber atajo que devuelva la copia local sin preguntar",
  );
  const body = serviceSrc.slice(serviceSrc.indexOf("export async function fetchLichWeapons"));
  assert.match(body, /const res = await getLichWeapons\(force\);/);
  assert.ok(
    body.indexOf("getLichWeapons(force)") < body.indexOf("lastKnownGood()"),
    "se pregunta primero y solo se cae a la copia local si la petición falla",
  );
});

test("la copia de rescate no revive una rotación ya terminada", () => {
  // Enseñar el lote anterior manda al jugador a la tienda a por un arma que ya no está.
  const fn = serviceSrc.slice(serviceSrc.indexOf("async function lastKnownGood"));
  assert.match(fn.slice(0, fn.indexOf("\n}")), /soonestEnd > serverNow\(\) \? vendors : \[\]/);
});

test("el desvío a un worker local solo vale desde localhost y avisa", () => {
  // En producción, quien pudiera escribir en el localStorage del usuario redirigiría todas
  // las peticiones —incluidas las que llevan el JWT de warframe.market— a un servidor ajeno.
  const fn = configSrc.slice(configSrc.indexOf("function resolveWorkerUrl"));
  const body = fn.slice(0, fn.indexOf("\n}"));
  assert.match(body, /\["localhost", "127\.0\.0\.1", "\[::1\]"\]\.includes\(loc\.hostname\)/);
  assert.match(body, /\/\^https\?:\\\/\\\/\/\.test\(raw\)/, "solo http(s): el valor acaba en fetch()");
  // Un desvío olvidado deja la app entera sin datos y nada en pantalla apunta a la causa.
  assert.match(body, /console\.warn\(/, "el desvío activo debe anunciarse en consola");
  assert.match(body, /vs_worker_url/);
});

test("assets/ml no se sirve como inmutable", () => {
  // curiosidades.json lo reescribe el bot a diario; bajo la regla /assets/* el navegador
  // se lo quedaba un año y el visitante recurrente nunca veía los datos nuevos.
  const headers = read("../deploy/_headers");
  const rule = headers.slice(headers.indexOf("/assets/ml/*"));
  assert.ok(rule.length > 0, "falta la regla para /assets/ml/*");
  assert.ok(!/immutable/.test(rule.slice(0, rule.indexOf("\n\n") + 1 || rule.length)));
  assert.match(rule, /must-revalidate/);
});

test("la URL lleva versión para no comer la respuesta cacheada de antes del deploy", () => {
  // Mientras el handler no existía, el worker contestaba a este tipo con su fallback
  // {"status":"Ready"} y max-age=86400: el navegador se lo guardaba 24 h y seguía
  // sirviéndoselo a sí mismo, así que el apartado salía vacío con el worker ya correcto.
  const repoSrc = read("../deploy/js/repositories/api.repository.js");
  const fn = repoSrc.slice(repoSrc.indexOf("export async function getLichWeapons"));
  assert.match(fn.slice(0, fn.indexOf("\n}")), /type=lich_weapons&v=\d/);
});

test("el fallback de tipo desconocido no se cachea durante horas", () => {
  // Es la respuesta que reciben los clientes de un endpoint aún sin desplegar: cachearla
  // un día deja la pestaña vacía mucho después de que el worker esté bien.
  const workerSrc = read("../worker-code.js");
  const line = workerSrc.split("\n").find((l) => l.includes('status: "Ready"'));
  const ttl = Number(line.match(/,\s*200,\s*(\d+)/)?.[1]);
  assert.ok(ttl <= 300, `ttl del fallback demasiado largo: ${ttl}s`);
  assert.match(line, /,\s*200,\s*\d+,\s*false,\s*0\)/, "tampoco debe servirse stale");
});

test("el refetch al rotar estrena URL para saltarse toda caché HTTP", () => {
  // Justo al rotar, la respuesta cacheada (navegador y edge) es precisamente la que ya no
  // vale: sin cambiar de URL seguiría sirviéndose el lote anterior.
  assert.match(serviceSrc, /export async function fetchLichWeapons\(force = false\)/);
  assert.match(serviceSrc, /getLichWeapons\(force\)/, "el force debe llegar a la petición");
  assert.match(uiSrc, /renderLichWeaponsTab\(true\)/);

  // El `&_cb=` en sí lo pone fetchRotating (la política común de los datos que rotan, ver
  // http-cache-policy.test.mjs); aquí basta con que las armas se acojan a esa vía.
  const repoSrc = read("../deploy/js/repositories/api.repository.js");
  const fn = repoSrc.slice(repoSrc.indexOf("export async function getLichWeapons"));
  assert.match(fn.slice(0, fn.indexOf("\n}")), /return fetchRotating\([^)]*\{ force \}\)/);
});

test("el contador usa serverNow, no el reloj del sistema", () => {
  // Con el reloj del equipo adelantado, Date.now() marcaría la ventana como caducada y
  // dispararía refetch en bucle (el mismo fallo que ya se corrigió en fisuras y bounties).
  assert.ok(!/\bDate\.now\(\)\s*[-<>]/.test(uiSrc), "el contador no debe medir con Date.now()");
  assert.match(uiSrc, /const now = serverNow\(\)/);
  assert.match(uiSrc, /isClockSynced\(\)/);
});

test("el freno del refetch vive fuera del render", () => {
  const render = uiSrc.slice(uiSrc.indexOf("function startRotationTimers"));
  assert.ok(!/\b(let|const|var)\s+rotationReloadAt\b/.test(render), "declarado dentro, nunca frena");
  assert.match(uiSrc, /^let rotationReloadAt\s*=/m);
});

test("salir del apartado para el contador de rotación", () => {
  // Sin esto el intervalo sigue latiendo cada segundo contra nodos ocultos.
  assert.match(farmsSrc, /stopRotationTimers\(\)/);
  assert.match(uiSrc, /export function stopRotationTimers/);
});

test("todo dato ajeno pasa por escapeHTML antes de ir a innerHTML", () => {
  // Nombres, elementos y URLs vienen del worker (wiki + warframestat), no del catálogo local.
  for (const expr of ["escapeHTML(w.name)", "escapeHTML(w.wikiUrl)", "escapeHTML(meta.label)"]) {
    assert.ok(uiSrc.includes(expr), `falta ${expr}`);
  }
  assert.ok(!/\$\{w\.name\}/.test(uiSrc), "w.name sin escapar");
  assert.ok(!/\$\{w\.wikiUrl\}/.test(uiSrc), "w.wikiUrl sin escapar");
});

test("el icono del tipo de daño no puede romper el atributo", () => {
  const utilSrc = read("../deploy/js/utils/damage_types.js");
  assert.match(utilSrc, /replaceAll\(\/\[\^a-z\]\/g, ""\)/, "el tipo acaba en src y alt: solo letras");
});

// ---- Recordatorios de rotación ----

/** Carga el matcher real de alerts.service sin arrastrar el DOM que usa el resto. */
function weaponMatcher() {
  const src = read("../deploy/js/services/farms/alerts.service.js");
  const start = src.indexOf("  weapon(rule, w) {");
  assert.notEqual(start, -1, "falta el matcher weapon");
  let depth = 0, i = src.indexOf("{", start), j = i;
  while (j < src.length) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) break;
    j++;
  }
  return new Function("rule", "w", src.slice(i + 1, j));
}

const matches = weaponMatcher();
const arma = (over = {}) => ({
  name: "Coda Hirudo", vendorKey: "eleanor", bonus: { element: "Electricity", percent: 33.6 }, ...over,
});
const regla = (over = {}) => ({ vendor: "any", weapon: "any", element: "any", minPercent: 25, ...over });

test("el recordatorio salta por porcentaje mínimo", () => {
  assert.equal(matches(regla({ minPercent: 30 }), arma()), true);
  assert.equal(matches(regla({ minPercent: 45 }), arma()), false);
  // El límite es inclusivo: pedir ≥33.6 con un 33.6 debe saltar.
  assert.equal(matches(regla({ minPercent: 33.6 }), arma()), true);
});

test("el elemento se compara sin depender de mayúsculas", () => {
  // La wiki escribe "Electricity"; el selector guarda la misma cadena, pero un cambio de
  // maquetación allí no debe silenciar el recordatorio por una mayúscula.
  assert.equal(matches(regla({ element: "electricity" }), arma()), true);
  assert.equal(matches(regla({ element: "Heat" }), arma()), false);
});

test("los filtros de tienda y arma acotan", () => {
  assert.equal(matches(regla({ vendor: "glast" }), arma()), false);
  assert.equal(matches(regla({ vendor: "eleanor" }), arma()), true);
  assert.equal(matches(regla({ weapon: "Coda Mire" }), arma()), false);
  assert.equal(matches(regla({ weapon: "Coda Hirudo" }), arma()), true);
});

test("un arma sin bonus reportado no dispara", () => {
  // Afirmar que cumple sin tener el dato sería inventarse el aviso; y como el deduplicado
  // es por (regla, arma, rotación), seguirá vigilada dentro de la misma ventana.
  assert.equal(matches(regla(), arma({ bonus: null })), false);
});

test("cada arma tiene su propia clave de deduplicado", () => {
  // Sin el nombre en la clave, dos armas del mismo `type` la compartirían y solo avisaría
  // de la primera de la rotación.
  const alerts = read("../deploy/js/services/farms/alerts.service.js");
  assert.match(alerts, /item\.uName \|\| item\.name \|\| item\.type/);
  assert.match(alerts, /item\.factionKey \|\| item\.vendorKey \|\| item\.node/);
});

test("el rango del selector es el que el juego puede rodar", () => {
  // Un recordatorio a ≥70% no saltaría jamás y el usuario lo esperaría para siempre.
  const alerts = read("../deploy/js/services/farms/alerts.service.js");
  assert.match(alerts, /VALENCE_MIN = 25/);
  assert.match(alerts, /VALENCE_MAX = 60/);
  assert.match(alerts, /Math\.min\(VALENCE_MAX, Math\.max\(VALENCE_MIN,/);
  assert.match(alerts, /ALARM_KINDS = \[.*"weapon"\]/);
});

test("el selector de arma ofrece el catálogo entero, no solo el lote activo", () => {
  // Un recordatorio se pone justo sobre un arma que HOY no está en la tienda.
  const workerSrc = read("../worker-code.js");
  assert.match(workerSrc, /catalogue: \[\.\.\.CODA_BATCHES\.A, \.\.\.CODA_BATCHES\.B\]\.sort\(\)/);
  assert.match(uiSrc, /Array\.isArray\(v\.catalogue\)/);
});

test("el watcher de armas se registra con su propio kind", () => {
  // Con el kind por defecto ("bounty") las armas se evaluarían con el matcher de misiones.
  assert.match(uiSrc, /startAlarmWatcher\(alarmSource, handleAlarmHits, "weapon"\)/);
  assert.match(uiSrc, /evaluateAlarms\("weapon", flattenForAlarms\(vendors\)\)/);
});

test("el aviso de recordatorio escapa lo que interpola", () => {
  const fn = uiSrc.slice(uiSrc.indexOf("function handleAlarmHits"));
  const body = fn.slice(0, fn.indexOf("\n}"));
  assert.match(body, /html: true/);
  assert.match(body, /lines\.map\(escapeHTML\)/);
  assert.match(body, /escapeHTML\(title\)/);
});

test("los hiperparámetros del reentreno no se leen crudos del entorno", () => {
  // Actions define la variable IGUALMENTE cuando el input de workflow_dispatch va vacío, y
  // en los runs por cron va vacío siempre: int("") reventaba el reentreno antes de entrenar
  // nada porque el default de os.environ.get solo cubre la clave ausente (cron 2026-08-10).
  const ml = read("../scripts-actu/ML-rivenvaluation/ML_local.py");
  const crudas = [...ml.matchAll(/(?:int|float)\(os\.environ\.get\("((?:XGB|SLIM)_[A-Z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(crudas, [], "deben pasar por _env_num, que trata la cadena vacía como ausente");
  assert.match(ml, /def _env_num\(name, default, cast=int\)/);
  // El presupuesto por cuantil depende de la MISMA convención "vacío == sin forzar".
  assert.match(ml, /if not os\.environ\.get\("XGB_N", ""\)\.strip\(\):/);
});

// ---- Cableado de la pestaña ----

test("los dos botones del subnav invocan una función publicada", () => {
  assert.match(htmlSrc, /data-subview="bounties"/);
  assert.match(htmlSrc, /data-subview="weapons"/);
  assert.match(htmlSrc, /globalThis\.switchFarmsSubview\('weapons'\)/);
  assert.match(farmsSrc, /exposeGlobals\(\{ switchFarmsSubview \}/);
});

test("el HTML tiene el contenedor que rellena el render", () => {
  assert.match(htmlSrc, /id="lich-weapons-container"/);
  assert.match(htmlSrc, /href="css\/components\/lich-weapons\.css/);
});

test("Farms se pinta por el despachador, no llamando a un apartado suelto", () => {
  // switchTab llamaba a renderBountiesTab(): dejarlo así ignoraría la subvista guardada
  // y al entrar en Farms siempre saldrían las misiones.
  const uiJs = read("../deploy/js/ui.js");
  assert.ok(!uiJs.includes("renderBountiesTab("), "ui.js debe delegar en renderFarmsTab");
  assert.match(uiJs, /renderFarmsTab\(\)/);
});

// ---- Textos ----

test("los textos del apartado existen en los dos idiomas con las mismas claves", () => {
  const es = TEXTS.es.lichWeapons;
  const en = TEXTS.en.lichWeapons;
  assert.ok(es && en, "debe haber bloque es y bloque en");
  assert.deepEqual(Object.keys(es).sort(), Object.keys(en).sort());
  assert.ok("bonusSource" in es, "el aviso de origen del bonus es obligatorio");
});

test("las claves de moneda del worker tienen traducción", () => {
  const workerSrc = read("../worker-code.js");
  const currencies = [...workerSrc.matchAll(/currency: "([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(currencies)].sort(), ["Corrupted Holokey", "Live Heartcell"]);
  for (const c of currencies) {
    for (const lang of ["es", "en"]) {
      assert.ok(TEXTS[lang].lichWeapons.currencies?.[c], `sin traducción ${lang} para ${c}`);
    }
  }
});

test("las categorías que devuelve warframestat tienen etiqueta", () => {
  // build() copia `category` tal cual; si la etiqueta falta, la tarjeta enseña el inglés.
  for (const cat of ["Primary", "Secondary", "Melee"]) {
    assert.ok(uiSrc.includes("t.lichWeapons.categories[w.category]"), "el render debe traducir la categoría");
    for (const lang of ["es", "en"]) {
      assert.ok(TEXTS[lang].lichWeapons.categories?.[cat], `sin etiqueta ${lang} para ${cat}`);
    }
  }
});
