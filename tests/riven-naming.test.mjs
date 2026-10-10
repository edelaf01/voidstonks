import { test } from "node:test";
import assert from "node:assert/strict";
import { rivenFingerprint } from "../deploy/js/utils/rivens/riven_naming.js";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const { RIVEN_STATS } = await import("../deploy/js/config.js");
const { RIVEN_NAMING_DICT, normalizeStatName, generateRivenName } = await import(
  "../deploy/js/utils/rivens/riven_naming.js"
);

test("cada clave del diccionario es un slug que existe en RIVEN_STATS", () => {
  const slugsReales = new Set(RIVEN_STATS.map((s) => s.slug));
  const muertas = Object.keys(RIVEN_NAMING_DICT).filter((k) => !slugsReales.has(k));
  assert.deepEqual(muertas, [],
    "estas entradas no las va a encontrar nadie: el stat se cae del nombre sin avisar");
});

test("todos los stats tienen nombre", () => {
  const sinNombre = RIVEN_STATS.filter((s) => !RIVEN_NAMING_DICT[s.slug]).map((s) => s.slug).sort();
  assert.deepEqual(sinNombre, []);
});

test("ningún prefijo ni sufijo queda vacío", () => {
  for (const [slug, { prefix, suffix }] of Object.entries(RIVEN_NAMING_DICT)) {
    assert.ok(prefix && suffix, `${slug} necesita prefijo y sufijo`);
    assert.match(prefix, /^[A-Z]/, `${slug}: el prefijo se usa capitalizado`);
  }
});

test("las abreviaturas del OCR se expanden", () => {
  assert.equal(normalizeStatName("Crit Chance"), "Critical Chance");
  assert.equal(normalizeStatName("Crit Dmg"), "Critical Damage");
  assert.equal(normalizeStatName("Stats Chance"), "Status Chance");
  assert.equal(normalizeStatName("  Multishot  "), "Multishot");
});

test("la expansión no se come palabras que ya están completas", () => {
  assert.equal(normalizeStatName("Critical Chance"), "Critical Chance");
  assert.equal(normalizeStatName("Status Chance"), "Status Chance");
});

test("cadencia y velocidad de ataque son el mismo stat según el arma", () => {
  assert.equal(normalizeStatName("Fire Rate / Attack Speed", "Melee"), "Attack Speed");
  assert.equal(normalizeStatName("Fire Rate / Attack Speed", "Rifle"), "Fire Rate");
  assert.equal(normalizeStatName("Fire Rate / Attack Speed"), "Fire Rate", "por defecto, a distancia");
});

test("sin nombre devuelve cadena vacía", () => {
  for (const v of ["", null, undefined]) assert.equal(normalizeStatName(v), "");
});

const arma = { name: "Bramma", t: "Rifle", disposition: 1.0 };
const stat = (name, value) => ({ name, value });

const nombrar = (stats) => generateRivenName("Kuva Bramma", stats, arma, stats.length, false, 8);

test("un solo positivo usa su prefijo y su propio sufijo", () => {
  const n = nombrar([stat("Critical Chance", 100)]);
  assert.equal(n, "Kuva Bramma Critacron");
});

test("con dos positivos manda el prefijo del más fuerte y el sufijo del otro", () => {
  const fuerte = nombrar([stat("Critical Chance", 200), stat("Multishot", 10)]);
  assert.equal(fuerte, "Kuva Bramma Critacan", "Crita- (crítico) + -can (multidisparo)");

  const alReves = nombrar([stat("Critical Chance", 10), stat("Multishot", 200)]);
  assert.equal(alReves, "Kuva Bramma Saticron", "Sati- (multidisparo) + -cron (crítico)");
});

test("con tres, el del medio aporta su prefijo en minúscula tras un guion", () => {
  const n = nombrar([
    stat("Critical Chance", 300),
    stat("Multishot", 200),
    stat("Critical Damage", 100),
  ]);
  assert.equal(n, "Kuva Bramma Sati-critatis");
  assert.match(n, /^Kuva Bramma [A-Z][a-z]+-[a-z]+$/, "prefijo, guion, prefijo en minúscula y sufijo");
});

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

test("un stat sin entrada en la tabla no rompe el nombre", () => {
  const n = nombrar([stat("Inventado No Existe", 100), stat("Critical Chance", 50)]);
  assert.equal(n, "Kuva Bramma Critacron", "queda el nombre de un solo stat");

  assert.equal(nombrar([stat("Inventado No Existe", 100)]), "",
    "si no queda ninguno, mejor vacío que un nombre falso");
});

test("Alcance y Velocidad de proyectil sí aportan al nombre", () => {
  const melee = { name: "Nikana", t: "Melee", disposition: 1.0 };
  const conRango = generateRivenName("Nikana", [stat("Range", 100)], melee, 1, false, 8);
  assert.equal(conRango, "Nikana Loctitor", "Alcance usa el slug `range`");

  const conVelocidad = generateRivenName(
    "Kuva Bramma", [stat("Projectile Speed", 100)], arma, 1, false, 8);
  assert.equal(conVelocidad, "Kuva Bramma Concinak", "Velocidad de proyectil usa `projectile_flight_speed`");
});

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

const riven = (over = {}) => ({
  weaponName: "Kuva Bramma",
  stats: [
    { name: "Critical Chance", isPositive: true },
    { name: "Damage", isPositive: true },
    { name: "Zoom", isPositive: false },
  ],
  ...over,
});

test("la huella no depende del orden en que llegaron los stats", () => {
  const a = riven();
  const b = riven({ stats: [...a.stats].reverse() });
  assert.equal(rivenFingerprint(a), rivenFingerprint(b));
});

test("el signo sí cambia la huella: un curse no es un buff", () => {
  const a = riven();
  const b = riven({ stats: a.stats.map((s) => ({ ...s, isPositive: !s.isPositive })) });
  assert.notEqual(rivenFingerprint(a), rivenFingerprint(b));
});

test("sin carta hay huella igualmente, para poder comparar", () => {
  assert.equal(typeof rivenFingerprint(null), "string");
});

