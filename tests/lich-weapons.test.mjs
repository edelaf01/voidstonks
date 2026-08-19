// "weapons in rotation" in Farms (Eleanor / Ergo Glast)
// no api publishes these stores: the active batch is computed from a fixed epoch and the valence bonus is
// read from the wikitext; both fail silently, so they are pinned here
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { optionalSource } from "./_helpers/optional-source.mjs";

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const { src: workerCodeSrc, missing: sinWorker, test } = optionalSource(
  new URL("../worker-code.js", import.meta.url),
);

/**
 * worker internals without importing it: named exports are not an option, since Cloudflare requires every
 * named export to be a function or an ExportedHandler and an `export const` crashes the worker at startup
 * the source up to `export default` is side-effect free, so it is evaluated as is
 */
function workerInternals() {
  const src = workerCodeSrc;
  // anchored at line start: a comment naming the handler would cut the source in half (it happened)
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
} = sinWorker ? {} : workerInternals();

const serviceSrc = read("../deploy/js/services/farms/lich_weapons.service.js");
const uiSrc = read("../deploy/js/ui.components/market/ui_lich_weapons.js");
const farmsSrc = read("../deploy/js/ui.components/farms/ui_farms.js");
// TEXTS is imported as an object instead of grepping the source: the key existing in both languages is the
// real invariant; the source is still read for the localhost guard in resolveWorkerUrl
const { TEXTS } = await import("../deploy/js/config.js");
const configSrc = read("../deploy/js/config.js");
const htmlSrc = read("../deploy/index.html");

const batchAt = (iso) => (AdversaryWeapons.window(CODA_EPOCH, Date.parse(iso)).index % 2 === 0 ? "A" : "B");

test("la ventana empieza y acaba en fronteras de 4 días desde la época", () => {
  const w = AdversaryWeapons.window(CODA_EPOCH, Date.parse("2025-03-19T13:37:00Z"));
  assert.equal(new Date(w.start).toISOString(), "2025-03-18T00:00:00.000Z");
  assert.equal(new Date(w.end).toISOString(), "2025-03-22T00:00:00.000Z");
  assert.equal(w.end - w.start, ROTATION_MS);
});

test("el instante exacto de la rotación ya pertenece a la ventana nueva", () => {
  // with `<=` instead of `<` in the floor, the 00:00 UTC cut would stay one tick in the old batch and the
  // counter would go negative
  const w = AdversaryWeapons.window(CODA_EPOCH, CODA_EPOCH + ROTATION_MS);
  assert.equal(w.index, 1);
  assert.equal(w.start, CODA_EPOCH + ROTATION_MS);
});

test("Eleanor alterna A y B en ventanas consecutivas (ciclo de 8 días)", () => {
  assert.equal(batchAt("2025-03-18T00:00:00Z"), "A"); // the epoch starts batch A
  assert.equal(batchAt("2025-03-21T23:59:59Z"), "A");
  assert.equal(batchAt("2025-03-22T00:00:00Z"), "B");
  assert.equal(batchAt("2025-03-26T00:00:00Z"), "A"); // full cycle: +8 days
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
  // so the wikitext parser can read both batch tables at once: with no repeated names a row cannot overwrite
  // another
  const all = [...CODA_BATCHES.A, ...CODA_BATCHES.B];
  assert.equal(new Set(all).size, all.length, "un arma no puede estar en los dos lotes");
  assert.equal(all.length, 14);
});

test("Ergo Glast no tiene lotes: su catálogo es fijo y solo rota el bonus", () => {
  assert.equal(GLAST_WEAPONS.length, 5);
  const w = AdversaryWeapons.window(GLAST_EPOCH, Date.parse("2026-08-09T12:00:00Z"));
  assert.equal(new Date(w.end).toISOString(), "2026-08-11T00:00:00.000Z");
});

test("el parser lee las dos maquetaciones de fila que usa la wiki", () => {
  // Coda_Weapons writes the weapon plain; Tenet_Weapons wraps it in {{Weapon|...}}
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
  // Hema's row lacks the colour template: without it there is no reported bonus
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

test("solo se reintenta mientras falte algún bonus", () => {
  // batch and stats are fixed until rotation: once every bonus is reported, polling every 30 min is pure
  // waste
  const workerSrc = read("../worker-code.js");
  const handler = workerSrc.slice(workerSrc.indexOf("async 'lich_weapons'"));
  assert.match(handler, /const pending = data\.vendors\.some\(/);
  assert.match(handler, /pending \? Math\.min\(1800, remaining\) : remaining/);
  // the ttl can never pass the cut, or the old batch is served after rotating
  assert.match(handler, /remaining = Math\.floor\(\(Math\.min\(coda\.end, glast\.end\) - now\)/);
});

test("el cliente no tiene caché propia que tape al worker", () => {
  // the worker is the source of truth and sets Cache-Control (30 min with bonuses pending, until rotation
  // once complete), so always asking costs no network; a private expiry in IndexedDB hid new data
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
  const fn = serviceSrc.slice(serviceSrc.indexOf("async function lastKnownGood"));
  assert.match(fn.slice(0, fn.indexOf("\n}")), /soonestEnd > serverNow\(\) \? vendors : \[\]/);
});

test("el desvío a un worker local solo vale desde localhost y avisa", () => {
  // in production, whoever could write the user's localStorage would redirect every request, warframe.market
  // jwt included, to a foreign server
  const fn = configSrc.slice(configSrc.indexOf("function resolveWorkerUrl"));
  const body = fn.slice(0, fn.indexOf("\n}"));
  assert.match(body, /\["localhost", "127\.0\.0\.1", "\[::1\]"\]\.includes\(loc\.hostname\)/);
  assert.match(body, /\/\^https\?:\\\/\\\/\/\.test\(raw\)/, "solo http(s): el valor acaba en fetch()");
  assert.match(body, /console\.warn\(/, "el desvío activo debe anunciarse en consola");
  assert.match(body, /vs_worker_url/);
});

test("assets/ml no se sirve como inmutable", () => {
  // the bot rewrites curiosidades.json daily; under the /assets/* rule browsers kept it for a year
  const headers = read("../deploy/_headers");
  const rule = headers.slice(headers.indexOf("/assets/ml/*"));
  assert.ok(rule.length > 0, "falta la regla para /assets/ml/*");
  assert.ok(!/immutable/.test(rule.slice(0, rule.indexOf("\n\n") + 1 || rule.length)));
  assert.match(rule, /must-revalidate/);
});

test("la URL lleva versión para no comer la respuesta cacheada de antes del deploy", () => {
  // before the handler existed the worker answered this type with its {"status":"Ready"} fallback and
  // max-age=86400, so browsers kept serving themselves an empty section after the worker was fixed
  const repoSrc = read("../deploy/js/repositories/api.repository.js");
  const fn = repoSrc.slice(repoSrc.indexOf("export async function getLichWeapons"));
  assert.match(fn.slice(0, fn.indexOf("\n}")), /type=lich_weapons&v=\d/);
});

test("el fallback de tipo desconocido no se cachea durante horas", () => {
  // that is what clients get from an endpoint not yet deployed: caching it a day leaves the tab empty long
  // after the worker is fine
  const workerSrc = read("../worker-code.js");
  const line = workerSrc.split("\n").find((l) => l.includes('status: "Ready"'));
  const ttl = Number(line.match(/,\s*200,\s*(\d+)/)?.[1]);
  assert.ok(ttl <= 300, `ttl del fallback demasiado largo: ${ttl}s`);
  assert.match(line, /,\s*200,\s*\d+,\s*false,\s*0\)/, "tampoco debe servirse stale");
});

test("el refetch al rotar estrena URL para saltarse toda caché HTTP", () => {
  assert.match(serviceSrc, /export async function fetchLichWeapons\(force = false\)/);
  assert.match(serviceSrc, /getLichWeapons\(force\)/, "el force debe llegar a la petición");
  assert.match(uiSrc, /renderLichWeaponsTab\(true\)/);

  // fetchRotating adds the `&_cb=` itself (shared policy for rotating data, see http-cache-policy.test.mjs);
  // here it is enough that weapons go through it
  const repoSrc = read("../deploy/js/repositories/api.repository.js");
  const fn = repoSrc.slice(repoSrc.indexOf("export async function getLichWeapons"));
  assert.match(fn.slice(0, fn.indexOf("\n}")), /return fetchRotating\([^)]*\{ force \}\)/);
});

test("el contador usa serverNow, no el reloj del sistema", () => {
  // with the machine clock ahead, Date.now() would mark the window expired and refetch in a loop
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
  // otherwise the interval keeps ticking every second against hidden nodes
  assert.match(farmsSrc, /stopRotationTimers\(\)/);
  assert.match(uiSrc, /export function stopRotationTimers/);
});

test("todo dato ajeno pasa por escapeHTML antes de ir a innerHTML", () => {
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

/** loads the real alerts.service matcher without the DOM the rest of it needs */
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
  // the limit is inclusive: asking for ≥33.6 with a 33.6 must fire
  assert.equal(matches(regla({ minPercent: 33.6 }), arma()), true);
});

test("el elemento se compara sin depender de mayúsculas", () => {
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
  // claiming a match without the data would make up the alert; dedup is per (rule, weapon, rotation), so it
  // stays watched within the same window
  assert.equal(matches(regla(), arma({ bonus: null })), false);
});

test("cada arma tiene su propia clave de deduplicado", () => {
  // without the name in the key, two weapons of the same `type` would share it and only the first would
  // alert
  const alerts = read("../deploy/js/services/farms/alerts.service.js");
  assert.match(alerts, /item\.uName \|\| item\.name \|\| item\.type/);
  assert.match(alerts, /item\.factionKey \|\| item\.vendorKey \|\| item\.node/);
});

test("el rango del selector es el que el juego puede rodar", () => {
  // a reminder at ≥70% would never fire and the user would wait forever
  const alerts = read("../deploy/js/services/farms/alerts.service.js");
  assert.match(alerts, /VALENCE_MIN = 25/);
  assert.match(alerts, /VALENCE_MAX = 60/);
  assert.match(alerts, /Math\.min\(VALENCE_MAX, Math\.max\(VALENCE_MIN,/);
  assert.match(alerts, /ALARM_KINDS = \[.*"weapon"\]/);
});

test("el selector de arma ofrece el catálogo entero, no solo el lote activo", () => {
  const workerSrc = read("../worker-code.js");
  assert.match(workerSrc, /catalogue: \[\.\.\.CODA_BATCHES\.A, \.\.\.CODA_BATCHES\.B\]\.sort\(\)/);
  assert.match(uiSrc, /Array\.isArray\(v\.catalogue\)/);
});

test("el watcher de armas se registra con su propio kind", () => {
  // with the default kind ("bounty") weapons would be checked with the mission matcher
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
  // Actions sets the variable even when the workflow_dispatch input is empty, and cron runs always leave it
  // empty: int("") crashed the retrain because the os.environ.get default only covers a missing key
  const ml = read("../scripts-actu/ML-rivenvaluation/ML_local.py");
  const crudas = [...ml.matchAll(/(?:int|float)\(os\.environ\.get\("((?:XGB|SLIM)_[A-Z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(crudas, [], "deben pasar por _env_num, que trata la cadena vacía como ausente");
  assert.match(ml, /def _env_num\(name, default, cast=int\)/);
  // the per-quantile budget relies on the same "empty == not forced" convention
  assert.match(ml, /if not os\.environ\.get\("XGB_N", ""\)\.strip\(\):/);
});

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
  // switchTab called renderBountiesTab(), which ignores the saved subview and always opens on missions
  const uiJs = read("../deploy/js/ui.js");
  assert.ok(!uiJs.includes("renderBountiesTab("), "ui.js debe delegar en renderFarmsTab");
  assert.match(uiJs, /renderFarmsTab\(\)/);
});

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
  // build() copies `category` as is; a missing label shows the english text
  for (const cat of ["Primary", "Secondary", "Melee"]) {
    assert.ok(uiSrc.includes("t.lichWeapons.categories[w.category]"), "el render debe traducir la categoría");
    for (const lang of ["es", "en"]) {
      assert.ok(TEXTS[lang].lichWeapons.categories?.[cat], `sin etiqueta ${lang} para ${cat}`);
    }
  }
});
