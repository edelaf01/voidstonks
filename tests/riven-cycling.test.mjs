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
    recetasDelTipo, combinacionesDe, RECETAS_COMBINAR, planesDeFusion,
} = await import("../deploy/js/utils/rivens/riven_cycling.js");
const { consejoCicloHtml, cicloRivenHtml, tablaCicloHtml, textoKuva, textoCiclos, combinarOverlay, objetivoFusionHtml, combinarCartaHtml } =
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
    assert.ok(poolDeStats(1).includes("Zoom"), "las escopetas sí sacan Zoom");
    for (let t = 0; t <= 4; t++) {
        const pool = poolDeStats(t);
        assert.ok(!RECETAS_COMBINAR.some((r) => pool.includes(r.resultado)), "un stat fusionado nunca sale al ciclar");
    }
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
    assert.equal(RECETAS_COMBINAR.length, 22);
    assert.equal(recetasDelTipo(0).length, 18);
    assert.equal(recetasDelTipo(1).length, 18);
    assert.equal(recetasDelTipo(2).length, 18);
    assert.equal(recetasDelTipo(4).length, 16);
    const melee = recetasDelTipo(3);
    assert.equal(melee.length, 14);
    assert.ok(melee.some((r) => r.resultado === "Parry Angle"));
    assert.ok(!melee.some((r) => r.b === "Multishot"));
});

test("un riven puede combinar dos de sus stats, sean positivos o negativos", () => {
    const r = combinacionesDe([pos("Crit Chance"), pos("Multishot"), neg("Zoom")], 0);
    assert.deepEqual(r.map((x) => `${x.a}+${x.b}`).sort(), ["Critical Chance+Multishot", "Critical Chance+Zoom"]);
    assert.ok(r.every((x) => x.resultado === "Weak Point Critical Chance"));
});

test("un riven con un stat fusionado no puede fundir más stats", () => {
    const r = combinacionesDe([pos("Gas"), pos("Toxin"), pos("Heat")], 0);
    assert.deepEqual(r, []);
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
    assert.match(ya, /SPLICE STATS/);
    assert.doesNotMatch(ya, /NOT OUT YET/);
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
    assert.match(html, /Daño a Punto Débil/);
    assert.equal(tablaCicloHtml({ tipo: "Melee", buscados: ["Multishot"], negOk: [], isEs: true }), "");
});

test("un stat combinado se queda en todas las cartas del ciclo", () => {
    const pool = poolDeStats(0);
    const n = pool.length;
    assert.equal(probPorCiclo({ pool, buscados: ["Gas"], k: 1, negOk: pool, typeIdx: 0, fusionado: "Gas" }), 1);
    cerca(probPorCiclo({ pool, buscados: ["Gas", "Critical Chance"], k: 2, negOk: pool, typeIdx: 0, fusionado: "Gas" }),
        1.5 / n, "falta el otro buscado: 1/n en las de 2 positivos y 2/n en las de 3");
});

test("el combinado cuenta para el objetivo si vale como un buscado", () => {
    const pesos = { Toxin: 0.9, Heat: 0.9, "Critical Chance": 0.8, "Critical Damage": 0.8 };
    const args = { typeIdx: 0, buscados: ["Critical Chance", "Critical Damage"], negOk: ["Zoom"],
        stats: [pos("Gas"), pos("Crit Chance"), neg("Zoom")] };
    const c = consejoDeCiclo({ ...args, pesos });
    assert.equal(c.fusionado, "Gas");
    assert.equal(c.cumple, true);
    assert.equal(consejoDeCiclo({ ...args, pesos: null }).cumple, false);
    assert.equal(consejoDeCiclo({ ...args, pesos, stats: [pos("Gas"), pos("Viral"), pos("Crit Chance")] }), null);
});

const PESOS_FUSION = { Toxin: 0.7, Heat: 0.7, "Critical Chance": 0.9, "Critical Damage": 0.9, Multishot: 0.6 };
const OBJ_FUSION = { typeIdx: 0, pesos: PESOS_FUSION, buscados: ["Critical Chance", "Critical Damage", "Multishot"], negOk: ["Zoom"], ciclosHechos: 9 };

test("con las dos fuentes en el riven, combinar ya cumple el objetivo", () => {
    const planes = planesDeFusion({ ...OBJ_FUSION, stats: [pos("Toxin"), pos("Heat"), pos("Crit Chance")] });
    assert.equal(planes[0].receta.resultado, "Gas");
    assert.equal(planes[0].fuentes, null);
    assert.equal(planes[0].cumple, true);
    assert.equal(planes[0].total, 0);
    assert.equal(planes[0].compensa, true);
});

test("con una fuente se bloquea hasta que salga la otra y luego se cicla con el combinado fijo", () => {
    const n = poolDeStats(0).length;
    const planes = planesDeFusion({ ...OBJ_FUSION, stats: [pos("Toxin"), pos("Crit Chance")] });
    const gas = planes.find((p) => p.receta.resultado === "Gas");
    assert.equal(gas.fuentes.bloquea, "Toxin");
    assert.equal(gas.fuentes.negativo, false);
    assert.equal(gas.fuentes.falta, "Heat");
    cerca(gas.fuentes.p, 1 / (n - 1), "2 positivos con Toxin fijo: el otro sale de n-1");
    assert.equal(gas.fuentes.kuva, kuvaEsperada(gas.fuentes.p, 9, true));
    assert.equal(gas.despues.bloquea, null);
    assert.equal(gas.total, gas.fuentes.kuva + gas.despues.kuva);
    assert.equal(gas.cumple, false);
    assert.deepEqual(planesDeFusion({ ...OBJ_FUSION, stats: [pos("Gas"), pos("Toxin")] }), []);
});

test("la ficha del riven pinta el consejo y los planes de combinar", () => {
    const stats = [pos("Toxin"), pos("Crit Chance")];
    const html = consejoCicloHtml({ ...OBJ_FUSION, rolls: 9, tipo: "Rifle", isEs: true, stats });
    assert.match(html, /APUNTAR A UN STAT COMBINADO/);
    assert.match(html, /Bloquea \+Toxina hasta que salga Calor/);

    const deseados = { best: OBJ_FUSION.buscados, mid: [], pesos: PESOS_FUSION };
    const conValor = [{ name: "Toxin", value: 90 }, { name: "Critical Chance", value: 100 }, { name: "Zoom", value: -30 }];
    const ficha = cicloRivenHtml({ stats: conValor, meta: {}, tipo: "Rifle", deseados, rolls: 9, isEs: true });
    assert.match(ficha, /¿BLOQUEAR UN STAT\?/);
    assert.match(ficha, /APUNTAR A UN STAT COMBINADO/);
    assert.equal(cicloRivenHtml({ stats: [], meta: {}, tipo: "Rifle", deseados, isEs: true }), "");
});

test("el overlay avisa cuando los stats actuales se combinan en uno que el arma quiere", () => {
    const c = combinarOverlay({ ...OBJ_FUSION, rolls: 9, tipo: "Rifle", isEs: true,
        stats: [pos("Toxin"), pos("Heat"), pos("Crit Chance")] });
    assert.equal(c.rotulo, "PUEDES COMBINAR");
    assert.deepEqual(c.listas, [{ indice: 0, texto: "Gas = Toxina + Calor", veredicto: { texto: "cumple la meta", tono: "verde" } }]);
    assert.equal(c.titulo, null);
    assert.equal(c.paso, null);
    assert.equal(c.opciones.find((o) => o.indice === 0).estado, "lista");
});

test("el aviso también salta si combinar quita un negativo malo, aunque no cumpla la meta", () => {
    const { listas } = combinarOverlay({ ...OBJ_FUSION, rolls: 9, tipo: "Rifle", isEs: false,
        stats: [pos("Zoom"), pos("Toxin"), neg("Crit Chance")] });
    assert.equal(listas.length, 1);
    assert.match(listas[0].texto, / = Crit Chance \+ Zoom$/);
    assert.deepEqual(listas[0].veredicto, { texto: "better", tono: "verde" });
});

test("con una sola fuente el combinado sale a un stat y el recomendado va marcado", () => {
    const c = combinarOverlay({ ...OBJ_FUSION, rolls: 9, tipo: "Rifle", isEs: false,
        stats: [pos("Toxin"), pos("Crit Chance")] });
    assert.equal(c.rotulo, "YOU CAN SPLICE");
    assert.deepEqual(c.listas, []);
    const gas = c.opciones.find((o) => o.indice === 0);
    assert.equal(gas.estado, "falta");
    assert.equal(gas.falta, "Heat");
    const recomendadas = c.opciones.filter((o) => o.recomendada);
    assert.equal(recomendadas.length, 1);
    assert.equal(recomendadas[0].estado, "falta");
    assert.equal(c.opciones.find((o) => o.indice === 6).estado, "otra");
    assert.deepEqual(c.cerca, [{ texto: "★ Gas = Toxin + Heat", tono: "blanco" }, { texto: "needs Heat", tono: "gris" }]);
});

test("sin nada listo la carta dice lo que tiene a un stat, o que ya lleva un combinado", () => {
    const cerca = (stats) => combinarOverlay({ ...OBJ_FUSION, rolls: 9, tipo: "Rifle", isEs: true, stats }).cerca;
    assert.deepEqual(cerca([pos("Crit Damage"), pos("Damage")]), [{ texto: "Nada listo · a un stat: Daño a Punto Débil, Daño de Estado", tono: "gris" }]);
    assert.deepEqual(cerca([pos("Puncture"), pos("Punch Through")]), [{ texto: "Nada que combinar", tono: "gris" }]);
    assert.deepEqual(cerca([pos("Gas"), pos("Damage")]), [{ texto: "Ya tiene Gas", tono: "gris" }]);
});

test("un riven que ya cumple el objetivo avisa de que combinar empeora y no recomienda nada", () => {
    const c = combinarOverlay({ ...OBJ_FUSION, rolls: 9, tipo: "Rifle", isEs: true,
        stats: [pos("Crit Chance"), pos("Crit Damage"), neg("Zoom")] });
    assert.equal(c.listas.length, 1);
    assert.deepEqual(c.listas[0].veredicto, { texto: "empeora", tono: "naranja" });
    assert.ok(!c.opciones.some((o) => o.recomendada));
});

test("con un objetivo elegido cada carta dice qué le falta para llegar", () => {
    const base = { ...OBJ_FUSION, rolls: 9, tipo: "Rifle", isEs: true, objetivo: 3 };
    const falta = combinarOverlay({ ...base, stats: [pos("Electric"), pos("Damage"), pos("Multishot")] });
    assert.equal(falta.titulo, "Buscas: Radiación");
    assert.equal(falta.objetivo, 3);
    assert.equal(falta.paso[0].texto, "Bloquea +Electricidad hasta Calor");
    assert.match(falta.paso[1].texto, /^~\d+ ciclos$/);
    assert.match(falta.paso[2].texto, / kuva$/);

    const lista = combinarOverlay({ ...base, stats: [pos("Heat"), pos("Electric"), pos("Damage")] });
    assert.deepEqual(lista.listas.find((l) => l.indice === 3).veredicto, { texto: "tu objetivo", tono: "verde" });
    assert.equal(lista.paso, null);

    const otra = combinarOverlay({ ...base, stats: [pos("Gas"), pos("Damage")] });
    assert.deepEqual(otra.paso, [{ texto: "ya tiene Gas", tono: "naranja" }]);
    const hecha = combinarOverlay({ ...base, objetivo: 0, stats: [pos("Gas"), pos("Damage")] });
    assert.deepEqual(hecha.paso, [{ texto: "conseguido", tono: "verde" }]);

    const lejos = combinarOverlay({ ...base, objetivo: 6, stats: [pos("Electric"), pos("Damage")] });
    assert.equal(lejos.paso[0].texto, "Cicla hasta Daño a Corpus + Daño a Grineer");
});

test("un objetivo de otro tipo de arma se ignora", () => {
    const c = combinarOverlay({ ...OBJ_FUSION, rolls: 9, tipo: "Rifle", isEs: true, objetivo: 18,
        stats: [pos("Electric"), pos("Damage")] });
    assert.equal(c.objetivo, null);
    assert.equal(c.titulo, null);
    assert.equal(c.paso, null);
});

test("el selector agrupa los combinados por lo cerca que están y marca el elegido", () => {
    const c = combinarOverlay({ ...OBJ_FUSION, rolls: 9, tipo: "Rifle", isEs: true, objetivo: 3,
        stats: [pos("Toxin"), pos("Electric"), pos("Damage")] });
    const html = objetivoFusionHtml(c, true);
    const grupos = [...html.matchAll(/<optgroup label="([^"]+)">/g)].map((m) => m[1]);
    assert.deepEqual(grupos, ["YA PUEDES COMBINAR", "TE FALTA UN STAT", "RESTO"]);
    assert.match(html, /<option value="">Ninguno<\/option>/);
    assert.match(html, /<option class="lista" value="1">✓ Corrosivo = Toxina \+ Electricidad/);
    assert.match(html, /<option class="falta" value="3" selected>Radiación = Calor \+ Electricidad · falta Calor<\/option>/);
    assert.equal(objetivoFusionHtml(null, true), "");
    assert.equal(objetivoFusionHtml([], false), "");
});

test("con dos cartas el selector toma lo mejor de cada una sin mezclar sus faltas", () => {
    const base = { ...OBJ_FUSION, rolls: 9, tipo: "Rifle", isEs: true };
    const a = combinarOverlay({ ...base, stats: [pos("Toxin"), pos("Electric"), pos("Damage")] });
    const b = combinarOverlay({ ...base, stats: [pos("Heat"), pos("Damage"), pos("Crit Chance")] });
    const html = objetivoFusionHtml([a, b], true);
    assert.match(html, /<option class="lista" value="1">✓ Corrosivo/);
    assert.match(html, /<option class="falta" value="3">Radiación = Calor \+ Electricidad<\/option>/);
    assert.match(html, /<option class="falta" value="2">Viral = Toxina \+ Frío · falta Frío<\/option>/);
});

test("cada carta enseña sus combinados listos y su paso hacia el objetivo", () => {
    const c = combinarOverlay({ ...OBJ_FUSION, rolls: 9, tipo: "Rifle", isEs: true, objetivo: 3,
        stats: [pos("Toxin"), pos("Electric"), pos("Damage")] });
    const html = combinarCartaHtml(c);
    assert.match(html, /<div class="riven-combinar-lista"><span>Corrosivo = Toxina \+ Electricidad<\/span>/);
    assert.match(html, /<strong class="mal">empeora<\/strong>/);
    assert.match(html, /<div class="riven-combinar-paso"><span>Bloquea \+Electricidad hasta Calor<\/span><strong>~\d+ ciclos · ~[\d.k]+ kuva<\/strong>/);
    const hecha = combinarOverlay({ ...OBJ_FUSION, rolls: 9, tipo: "Rifle", isEs: true, objetivo: 0, stats: [pos("Gas"), pos("Damage")] });
    assert.equal(combinarCartaHtml(hecha), '<div class="riven-combinar-carta"><div class="riven-combinar-paso"><span class="ok">conseguido</span></div></div>');
    assert.equal(combinarCartaHtml(null), "");
    assert.equal(combinarCartaHtml(combinarOverlay({ ...OBJ_FUSION, rolls: 9, tipo: "Rifle", isEs: true, stats: [pos("Crit Damage"), pos("Damage")] })),
        '<div class="riven-combinar-carta"><div class="riven-combinar-paso"><span class="tenue">Nada listo · a un stat: Daño a Punto Débil, Daño de Estado</span></div></div>');
    assert.doesNotMatch(html, /★/, "con algo listo o un paso no se enseña el más cercano");
    assert.equal(combinarCartaHtml({ listas: [], paso: null, cerca: null }), "");
});

test("el HUD del escáner puede pedir el consejo de ciclo sin los bloques de combinar", () => {
    const stats = [pos("Toxin"), pos("Crit Chance")];
    const html = consejoCicloHtml({ ...OBJ_FUSION, rolls: 9, tipo: "Rifle", isEs: true, stats, conCombinar: false });
    assert.match(html, /¿BLOQUEAR UN STAT\?/);
    assert.doesNotMatch(html, /APUNTAR A UN STAT COMBINADO|COMBINAR STATS/);
});
