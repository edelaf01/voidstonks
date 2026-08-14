// Nombre generado de un riven ("Visi-critacan").
//
// El juego lo compone a partir de los stats positivos, y la app lo reproduce para dos cosas:
// enseñarlo en la tarjeta y, en el escáner, corregir por Levenshtein lo que leyó el OCR de la
// pantalla. Si la tabla no cuadra con la del juego, el escáner "corrige" hacia un nombre que no
// existe y la tarjeta enseña otro distinto del que el jugador tiene delante.
//
// La tabla estaba duplicada en ui_rivens.js y riven_ocr.service.js, y había derivado.

import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const { RIVEN_STATS } = await import("../deploy/js/config.js");
const { RIVEN_NAMING_DICT, normalizeStatName, generateRivenName } = await import(
  "../deploy/js/utils/rivens/riven_naming.js"
);

// ESTE es el test que habría cazado la deriva. `generateRivenName` busca
// `RIVEN_NAMING_DICT[statDef.slug]` con el slug que sale de RIVEN_STATS: una clave que no exista
// ahí es una entrada muerta, y el stat correspondiente desaparece del nombre en silencio.
//
// Pasaba de verdad: la copia de ui_rivens.js usaba `melee_range` y `flight_speed`, que no son
// slugs reales (son `range` y `projectile_flight_speed`). Un riven con Alcance o Velocidad de
// proyectil se nombraba ignorando ese stat.
test("cada clave del diccionario es un slug que existe en RIVEN_STATS", () => {
  const slugsReales = new Set(RIVEN_STATS.map((s) => s.slug));
  const muertas = Object.keys(RIVEN_NAMING_DICT).filter((k) => !slugsReales.has(k));
  assert.deepEqual(muertas, [],
    "estas entradas no las va a encontrar nadie: el stat se cae del nombre sin avisar");
});

// Al revés no se exige: hay stats que el diccionario todavía no nombra y sus fragmentos no se
// inventan (un fragmento equivocado hace que el escáner "corrija" hacia un nombre inexistente).
// Lo que sí se congela es CUÁLES faltan, para que al añadir uno se note.
test("los stats que aún no tienen nombre son exactamente estos tres", () => {
  const sinNombre = RIVEN_STATS.filter((s) => !RIVEN_NAMING_DICT[s.slug]).map((s) => s.slug).sort();
  assert.deepEqual(sinNombre, ["finisher_damage", "heavy_attack_efficiency", "initial_combo"]);
});

test("ningún prefijo ni sufijo queda vacío", () => {
  for (const [slug, { prefix, suffix }] of Object.entries(RIVEN_NAMING_DICT)) {
    assert.ok(prefix && suffix, `${slug} necesita prefijo y sufijo`);
    assert.match(prefix, /^[A-Z]/, `${slug}: el prefijo se usa capitalizado`);
  }
});

// --- normalizeStatName -------------------------------------------------------------------

// El OCR y la API escriben los stats abreviados; el resto del código usa la forma larga.
test("las abreviaturas del OCR se expanden", () => {
  assert.equal(normalizeStatName("Crit Chance"), "Critical Chance");
  assert.equal(normalizeStatName("Crit Dmg"), "Critical Damage");
  assert.equal(normalizeStatName("Stats Chance"), "Status Chance");
  assert.equal(normalizeStatName("  Multishot  "), "Multishot");
});

// "Crit" solo se expande como palabra: sin el \b, "Critical" se convertiría en "Criticalical".
test("la expansión no se come palabras que ya están completas", () => {
  assert.equal(normalizeStatName("Critical Chance"), "Critical Chance");
  assert.equal(normalizeStatName("Status Chance"), "Status Chance");
});

// Es un solo stat con dos nombres: el juego lo llama cadencia en las de fuego y velocidad de
// ataque en las cuerpo a cuerpo. Resolverlo mal busca un rango que no existe para ese arma.
test("cadencia y velocidad de ataque son el mismo stat según el arma", () => {
  assert.equal(normalizeStatName("Fire Rate / Attack Speed", "Melee"), "Attack Speed");
  assert.equal(normalizeStatName("Fire Rate / Attack Speed", "Rifle"), "Fire Rate");
  assert.equal(normalizeStatName("Fire Rate / Attack Speed"), "Fire Rate", "por defecto, a distancia");
});

test("sin nombre devuelve cadena vacía", () => {
  for (const v of ["", null, undefined]) assert.equal(normalizeStatName(v), "");
});

// --- generateRivenName -------------------------------------------------------------------

// Arma de mentira con rangos planos: así la fuerza de cada stat la fija su valor y se puede
// comprobar el ORDEN, que es lo que decide qué fragmento va en cada sitio.
const arma = { name: "Bramma", t: "Rifle", disposition: 1.0 };
const stat = (name, value) => ({ name, value });

/** Con rango 8 y sin negativo, el rango del stat es el nominal. */
const nombrar = (stats) => generateRivenName("Kuva Bramma", stats, arma, stats.length, false, 8);

test("un solo positivo usa su prefijo y su propio sufijo", () => {
  const n = nombrar([stat("Critical Chance", 100)]);
  assert.equal(n, "Kuva Bramma Critacron");
});

// Con dos, el segundo solo aporta el sufijo: es la regla del juego y la que hace que el orden
// por fuerza importe.
test("con dos positivos manda el prefijo del más fuerte y el sufijo del otro", () => {
  const fuerte = nombrar([stat("Critical Chance", 200), stat("Multishot", 10)]);
  assert.equal(fuerte, "Kuva Bramma Critacan", "Crita- (crítico) + -can (multidisparo)");

  // Invertidas las fuerzas, se invierten los papeles.
  const alReves = nombrar([stat("Critical Chance", 10), stat("Multishot", 200)]);
  assert.equal(alReves, "Kuva Bramma Saticron", "Sati- (multidisparo) + -cron (crítico)");
});

// El orden NO es por valor bruto sino por fuerza relativa: cada stat se compara con el centro
// de SU rango. 200 % de multidisparo es una tirada mucho mejor que 300 % de probabilidad de
// crítico, porque el rango del multidisparo es más estrecho. De ahí que aquí mande "Sati-".
test("con tres, el del medio aporta su prefijo en minúscula tras un guion", () => {
  const n = nombrar([
    stat("Critical Chance", 300),
    stat("Multishot", 200),
    stat("Critical Damage", 100),
  ]);
  assert.equal(n, "Kuva Bramma Sati-critatis");
  assert.match(n, /^Kuva Bramma [A-Z][a-z]+-[a-z]+$/, "prefijo, guion, prefijo en minúscula y sufijo");
});

// La consecuencia práctica de lo anterior, aislada: subir el valor de un stat sin tocar los
// demás puede cambiar quién pone el prefijo.
test("el orden lo decide la fuerza relativa, no el número más grande", () => {
  const pocoMultishot = nombrar([stat("Critical Chance", 200), stat("Multishot", 10)]);
  const muchoMultishot = nombrar([stat("Critical Chance", 200), stat("Multishot", 200)]);
  assert.notEqual(pocoMultishot, muchoMultishot,
    "el mismo 200 % de crítico cambia de papel según lo bueno que sea el otro stat");
});

test("el nombre va capitalizado y lleva el arma delante", () => {
  const n = nombrar([stat("Multishot", 50)]);
  assert.ok(n.startsWith("Kuva Bramma "), n);
  const generado = n.slice("Kuva Bramma ".length);
  assert.match(generado, /^[A-Z]/, "la primera letra del nombre generado va en mayúscula");
});

test("sin positivos o sin datos del arma no se inventa un nombre", () => {
  assert.equal(generateRivenName("Kuva Bramma", [], arma, 0, false, 8), "");
  assert.equal(generateRivenName("Kuva Bramma", null, arma, 0, false, 8), "");
  assert.equal(generateRivenName("Kuva Bramma", [stat("Multishot", 50)], null, 1, false, 8), "");
});

// Un stat que el juego no nombra (o que no encaja en el arma) se descarta, y el nombre se
// compone con los que quedan en vez de salir a medias.
test("un stat sin entrada en la tabla no rompe el nombre", () => {
  const n = nombrar([stat("Inventado No Existe", 100), stat("Critical Chance", 50)]);
  assert.equal(n, "Kuva Bramma Critacron", "queda el nombre de un solo stat");

  assert.equal(nombrar([stat("Inventado No Existe", 100)]), "",
    "si no queda ninguno, mejor vacío que un nombre falso");
});

// Es lo que arregló la extracción: antes estos dos slugs no estaban en la tabla del componente
// y su stat desaparecía del nombre.
test("Alcance y Velocidad de proyectil sí aportan al nombre", () => {
  const melee = { name: "Nikana", t: "Melee", disposition: 1.0 };
  const conRango = generateRivenName("Nikana", [stat("Range", 100)], melee, 1, false, 8);
  assert.equal(conRango, "Nikana Loctatox", "Alcance usa el slug `range`");

  const conVelocidad = generateRivenName(
    "Kuva Bramma", [stat("Projectile Speed", 100)], arma, 1, false, 8);
  assert.equal(conVelocidad, "Kuva Bramma Concinak", "Velocidad de proyectil usa `projectile_flight_speed`");
});

// El escáner corrige por Levenshtein contra los nombres posibles: si el componente y el OCR
// usaran tablas distintas, "corregiría" hacia un nombre que la tarjeta nunca enseña.
test("el escáner y la tarjeta comparten la misma tabla", async () => {
  const { readFileSync } = await import("node:fs");
  for (const f of [
    "deploy/js/ui.components/rivens/ui_rivens.js",
    "deploy/js/services/rivens/riven_ocr.service.js",
  ]) {
    const src = readFileSync(f, "utf8");
    assert.ok(!/const RIVEN_NAMING_DICT\s*=/.test(src),
      `${f} vuelve a tener su propia copia de la tabla`);
  }
});
