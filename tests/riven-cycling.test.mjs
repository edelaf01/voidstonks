// Ciclar rivens con bloqueo de stat (Update 44) y combinar stats (Glacial Defiance, provisional):
// deploy/js/utils/rivens/riven_cycling.js y su pintado, ui.components/rivens/ui_riven_cycling.js.
//
// Las probabilidades se comprueban contra cuentas hechas a mano: un pool de juguete de 5 stats donde
// se pueden contar las combinaciones, y el pool real de rifle (24 stats, 5 que no salen en negativo).
import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const {
    costeCiclo, kuvaEsperada, poolDeStats, claveStat, probPorCiclo, consejoDeCiclo,
    recetasDelTipo, combinacionesDe,
} = await import("../deploy/js/utils/rivens/riven_cycling.js");
const { consejoCicloHtml, tablaCicloHtml, textoKuva, textoCiclos } =
    await import("../deploy/js/ui.components/rivens/ui_riven_cycling.js");

const cerca = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} != ${b}`);

test("el ciclo cuesta según los que lleva el riven, con tope en 3.500 y el doble bloqueando", () => {
    assert.equal(costeCiclo(0), 900);
    assert.equal(costeCiclo(8), 3150);
    assert.equal(costeCiclo(9), 3500);
    assert.equal(costeCiclo(40), 3500);
    assert.equal(costeCiclo(9, true), 7000);
    assert.equal(costeCiclo(-2), 900);
    const nueve = [0, 1, 2, 3, 4, 5, 6, 7, 8].reduce((s, n) => s + costeCiclo(n), 0);
    assert.equal(nueve, 16450, "los nueve primeros ciclos suman 16.450");
});

test("la kuva esperada suma cada ciclo por la probabilidad de llegar a pagarlo", () => {
    assert.equal(kuvaEsperada(0.5, 9), 7000, "ya en el tope: 3.500 / 0,5");
    assert.equal(kuvaEsperada(0.5, 9, true), 14000);
    assert.equal(kuvaEsperada(1, 3), 1400, "acierto seguro: solo se paga el siguiente");
    // 900 + 500 + 300 + 175 + 106,25 + 62,5 + 36,72 + 21,48 + 12,30 + 0,00195·3500/0,5
    assert.equal(kuvaEsperada(0.5, 0), 2128);
    assert.equal(kuvaEsperada(0, 9), Infinity);
});

test("el pool sale de los stats con valor base en ese tipo de arma", () => {
    const rifle = poolDeStats(0);
    assert.equal(rifle.length, 24);
    assert.ok(rifle.includes("Zoom") && !rifle.includes("Range"));
    const melee = poolDeStats(3);
    assert.ok(melee.includes("Attack Speed") && melee.includes("Range"));
    assert.ok(!melee.includes("Multishot") && !melee.includes("Fire Rate"));
    assert.ok(!poolDeStats(1).includes("Zoom"), "las escopetas no sacan Zoom");
});

test("cada fuente llama a los stats a su manera y todas acaban en la misma clave", () => {
    assert.equal(claveStat("Crit Chance", 0), "Critical Chance");
    assert.equal(claveStat("Critical Damage", 0), "Critical Damage");
    assert.equal(claveStat("Base Damage / Melee Damage", 0), "Damage");
    assert.equal(claveStat("Fire Rate / Attack Speed", 3), "Attack Speed");
    assert.equal(claveStat("Fire Rate / Attack Speed", 0), "Fire Rate");
    assert.equal(claveStat("Damage Vs Grineer", 0), "Damage to Grineer");
    assert.equal(claveStat("Toxin Damage", 0), "Toxin");
    assert.equal(claveStat("Finisher Damage", 3), "Finisher Damage");
    assert.equal(claveStat("Channeling Efficiency", 3), "Heavy Attack Efficiency");
    assert.equal(claveStat("Weapon Recoil", 0), "Recoil");
    assert.equal(claveStat("Algo raro", 0), null);
});

// Pool de juguete: buscados A y B (hacen falta los dos), negativo aceptable E.
const JUGUETE = { pool: ["A", "B", "C", "D", "E"], buscados: ["A", "B"], k: 2, negOk: ["E"], typeIdx: 0 };

test("sin bloqueo se promedian las cuatro configuraciones, cada una al 25 %", () => {
    // 2-0: 1/10 · 2-1: 1/10·1/3 · 3-0: 3/10 · 3-1: (1/10)(0 + 1/2 + 1/2) → media 2/15
    cerca(probPorCiclo(JUGUETE), 2 / 15, "sin bloqueo");
});

test("con un stat bloqueado la configuración no cambia y ese stat no se vuelve a sortear", () => {
    const bloqueaA = { stat: "A", negativo: false };
    cerca(probPorCiclo({ ...JUGUETE, config: { pos: 2, neg: true }, bloqueado: bloqueaA }), 1 / 12, "A fijo en 2+1");
    cerca(probPorCiclo({ ...JUGUETE, config: { pos: 3, neg: false }, bloqueado: bloqueaA }), 1 / 2, "A fijo en 3+0");
    const bloqueaE = { stat: "E", negativo: true };
    cerca(probPorCiclo({ ...JUGUETE, config: { pos: 2, neg: true }, bloqueado: bloqueaE }), 1 / 6, "negativo E fijo");
    assert.equal(probPorCiclo({ ...JUGUETE, config: { pos: 2, neg: false }, bloqueado: bloqueaE }), 0,
        "no se bloquea un negativo que la carta no tiene");
});

const RIFLE = {
    typeIdx: 0, ciclosHechos: 9,
    buscados: ["Critical Damage", "Critical Chance", "Multishot", "Base Damage / Melee Damage"],
    negOk: ["Zoom", "Recoil", "Impact Damage"],
};
const pos = (name, calidad) => ({ name, isPositive: true, calidad });
const neg = (name) => ({ name, isPositive: false });
// Sin bloqueo, en rifle: (6/276 + 6/276·3/17 + 124/2024 + 21,794/2024) / 4
const P_SIN_RIFLE = 0.0244020;

test("un buscado solo en un 3+0: bloquearlo cuesta el doble pero sale muy a cuenta", () => {
    const c = consejoDeCiclo({ ...RIFLE, stats: [pos("Crit Damage"), pos("Zoom"), pos("Punch Through")] });
    assert.equal(c.cumple, false);
    assert.ok(Math.abs(c.sinBloqueo.p - P_SIN_RIFLE) < 1e-6, `sin bloqueo ${c.sinBloqueo.p}`);
    assert.equal(c.bloqueo.stat, "Critical Damage");
    cerca(c.bloqueo.p, 63 / 253, "falta 1 de 3 buscados entre 2 de 23");
    assert.equal(c.bloqueo.kuva, Math.round(7000 / (63 / 253)));
    assert.equal(c.conviene, true);
});

test("entre dos buscados se bloquea el que mejor rodó, porque conserva su valor", () => {
    const c = consejoDeCiclo({ ...RIFLE, stats: [pos("Crit Chance", 40), pos("Crit Damage", 90), neg("Multishot")] });
    assert.equal(c.cumple, false, "el negativo en Multidisparo lo arruina");
    assert.equal(c.bloqueo.stat, "Critical Damage");
    cerca(c.bloqueo.p, (3 / 23) * (3 / 17), "otro buscado y un negativo aceptable");
    assert.equal(c.conviene, false, "en 2+1 el doble de kuva no se recupera");
});

test("sin positivos buscados se puede bloquear el negativo inofensivo", () => {
    const c = consejoDeCiclo({ ...RIFLE, stats: [pos("Zoom"), pos("Punch Through"), neg("Impact")] });
    assert.equal(c.bloqueo.negativo, true);
    cerca(c.bloqueo.p, 6 / 253, "los dos positivos tienen que ser buscados");
});

test("un riven que ya cumple lo dice", () => {
    const c = consejoDeCiclo({ ...RIFLE, stats: [pos("Crit Chance"), pos("Crit Damage"), neg("Zoom")] });
    assert.equal(c.cumple, true);
});

test("sin datos para calcular no se inventa un consejo", () => {
    assert.equal(consejoDeCiclo({ ...RIFLE, stats: [pos("Crit Chance"), pos("Algo raro")] }), null);
    assert.equal(consejoDeCiclo({ ...RIFLE, stats: [pos("Crit Chance"), pos("Zoom"), pos("Multishot"), pos("Recoil")] }), null);
    assert.equal(consejoDeCiclo({ ...RIFLE, typeIdx: 3, buscados: ["Multishot"], stats: [pos("Range"), pos("Crit Chance")] }), null,
        "un melee no tiene Multidisparo que buscar");
});

test("las recetas de combinar dependen del tipo de arma", () => {
    assert.equal(recetasDelTipo(0).length, 18);
    assert.equal(recetasDelTipo(1).length, 16, "sin las dos de Zoom");
    const melee = recetasDelTipo(3);
    assert.equal(melee.length, 12);
    assert.ok(melee.some((r) => r.resultado[1] === "Parry Angle"));
    assert.ok(!melee.some((r) => r.b === "Multishot"));
});

test("un riven puede combinar dos de sus stats, sean positivos o negativos", () => {
    const r = combinacionesDe([pos("Crit Chance"), pos("Multishot"), neg("Zoom")], 0);
    assert.deepEqual(r.map((x) => `${x.a}+${x.b}`).sort(), ["Critical Chance+Multishot", "Critical Chance+Zoom"]);
    assert.ok(r.every((x) => x.resultado[1] === "Weak Point Critical Chance"));
});

test("los textos de kuva y de ciclos de media", () => {
    assert.equal(textoKuva(143431, true), "~143k");
    assert.equal(textoKuva(7000, false), "~7,000");
    assert.equal(textoKuva(7000, true), "~7.000", "en español también con punto de miles");
    assert.equal(textoKuva(Infinity, true), "imposible");
    assert.equal(textoCiclos(P_SIN_RIFLE, true), "~41 ciclos");
    assert.equal(textoCiclos(1, true), "~1 ciclo");
    assert.equal(textoCiclos(0, false), "never happens");
});

test("el bloque del escáner recomienda qué bloquear y cuánto se ahorra", () => {
    const html = consejoCicloHtml({ ...RIFLE, rolls: 9, tipo: "Rifle", isEs: true,
        stats: [pos("Crit Damage"), pos("Zoom"), pos("Punch Through")] });
    assert.match(html, /Sin bloquear <small>\(3\.500\/ciclo\)<\/small><\/span>\s*<strong>~41 ciclos/);
    assert.match(html, /Bloqueando \+Daño Crítico <small>\(7\.000\/ciclo\)<\/small><\/span>\s*<strong>~4 ciclos /);
    assert.match(html, /Bloquea \+Daño Crítico: ahorras ~115k kuva/);

    const ya = consejoCicloHtml({ ...RIFLE, rolls: 9, tipo: "Rifle", isEs: false,
        stats: [pos("Crit Chance"), pos("Multishot"), neg("Zoom")] });
    assert.match(ya, /already meets the goal/);
    assert.match(ya, /SPLICE STATS \(NOT OUT YET\)/);
    assert.match(ya, /Weak Point Critical Chance/);

    assert.equal(consejoCicloHtml({ ...RIFLE, tipo: "Rifle", isEs: true, stats: [pos("Algo raro"), pos("Zoom")] }), "");
});

test("con pocos ciclos hechos cada fila enseña lo que cuesta el siguiente, doble si se bloquea", () => {
    const html = consejoCicloHtml({ ...RIFLE, rolls: 2, tipo: "Rifle", isEs: false,
        stats: [pos("Crit Damage"), pos("Zoom"), pos("Punch Through")] });
    assert.match(html, /No lock <small>\(1,200\/cycle\)/);
    assert.match(html, /Locking \+Crit Damage <small>\(2,400\/cycle\)/);
});

test("sin el número de ciclos se supone un riven ya ciclado, y el aviso lo dice", () => {
    const html = consejoCicloHtml({ ...RIFLE, rolls: null, tipo: "Rifle", isEs: true,
        stats: [pos("Crit Damage"), pos("Zoom"), pos("Punch Through")] });
    assert.match(html, /supuestos: no se leyó el número/);
});

test("la calculadora de la ficha dice qué hacer con cada tipo de riven", () => {
    const html = tablaCicloHtml({ tipo: "Rifle", buscados: RIFLE.buscados, negOk: RIFLE.negOk, isEs: true });
    assert.match(html, /Sin bloquear nada tardas ~41 ciclos \(~143k kuva\)/);
    assert.match(html, /<tr class="mejor"><th>3 positivos<\/th><td>Bloquea un stat bueno: ~4 ciclos \(~28k kuva\)/);
    // 2+1: el otro positivo tiene que ser bueno Y el negativo inofensivo; bloqueando no compensa.
    assert.match(html, /<tr class=""><th>2 positivos y 1 negativo<\/th><td>No bloquees: ~41 ciclos/);
    assert.match(html, /Daño a punto débil/);
    assert.equal(tablaCicloHtml({ tipo: "Melee", buscados: ["Multishot"], negOk: [], isEs: true }), "");
});
