// La unidad tipográfica de una pantalla: el tamaño del ✓, MEDIDO en el frame y validado.
//
// Todo el pipeline venía expresando recortes como fracciones del alto del frame, y eso es una
// suposición sobre la escala del HUD que el usuario elige en las opciones del juego. Medido
// sobre el corpus: en 10 de 11 capturas de fin de misión el lado del ✓ es 0.0208 del alto
// exacto, pero en una no, y ahí no se detecta ni una casilla.
//
// Lo que este módulo tiene que garantizar NO es acertar siempre: es no MENTIR nunca. Medir el
// tamaño a secas elige ruido de interfaz —comprobado, en esa captura devolvía 9.1 donde el real
// ronda 20— y un tamaño malo cacheado envenena el contexto entero.
import { test } from "node:test";
import assert from "node:assert/strict";
import { unidadTipografica } from "../deploy/js/utils/vision/ancla_rejilla.js";

const ZONA = { w: 1600, h: 900 };
/** Un ✓: cuadrado y hueco por dentro (anillo), como el del juego. */
const check = (x, y, lado = 30) => ({ x, y, w: lado, h: lado, area: Math.round(lado * lado * 0.35) });
/** Rejilla de ✓ con el paso dado, uno por casilla. */
const rejilla = (cols, filas, paso = 240, lado = 30, x0 = 100, y0 = 100) => {
    const out = [];
    for (let f = 0; f < filas; f++) for (let c = 0; c < cols; c++) out.push(check(x0 + c * paso, y0 + f * paso, lado));
    return out;
};

test("mide el lado y el paso de una rejilla de anclas", () => {
    const u = unidadTipografica(rejilla(5, 3), ZONA);
    assert.equal(Math.round(u.lado), 30);
    assert.equal(u.paso, 240);
    assert.equal(u.cols, 5);
});

test("el tamaño sale del frame, no de una fracción del alto", () => {
    // La MISMA pantalla con el HUD a otra escala: el módulo no puede tener nada cableado al
    // alto del frame, que aquí no cambia. Es el caso de temas/mission-red.png.
    const u = unidadTipografica(rejilla(5, 3, 163, 20), ZONA);
    assert.equal(Math.round(u.lado), 20);
    assert.equal(u.paso, 163);
});

test("el ruido de fondo que se repite pero no se alinea no vale", () => {
    // Los iconos y el arte también aparecen muchas veces; lo que no hacen es formar retícula.
    // Posiciones deterministas pero SIN paso común: un generador congruencial da la dispersión
    // del arte de fondo sin depender de Math.random.
    const ruido = [];
    let s = 12345;
    for (let i = 0; i < 12; i++) {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        const x = 40 + (s % 1400);
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        ruido.push(check(x, 40 + (s % 800), 18));
    }
    assert.equal(unidadTipografica(ruido, ZONA), null);
});

test("una casilla no mide cuarenta anclas de ancho", () => {
    // El filtro que separa la rejilla del ruido alineado por casualidad. Medido en el corpus:
    // las lecturas buenas dan paso/lado de 8.0 y 14.0; las falsas, 24, 31, 41 y hasta 99.
    assert.equal(unidadTipografica(rejilla(4, 2, 900, 20), ZONA), null, "paso/lado = 45");
    assert.ok(unidadTipografica(rejilla(4, 2, 280, 20), ZONA), "paso/lado = 14 sí vale");
});

test("ni dos anclas de ancho", () => {
    // Sin suelo, al rechazar el tamaño bueno el bucle caía a uno más pequeño y colaba otro ruido.
    assert.equal(unidadTipografica(rejilla(4, 2, 40, 20), ZONA), null, "paso/lado = 2");
});

test("solo se mira el tamaño DOMINANTE, no todos los que haya", () => {
    // El ✓ es lo que más se repite: hay uno por casilla. Probar bins menores "por si acaso" es
    // exactamente cómo se colaba el ruido; si el dominante no valida, la respuesta es ninguna.
    const dominante = rejilla(5, 3, 240, 30);      // 15 anclas, pero con paso imposible más abajo
    const minoria = rejilla(3, 1, 60, 12, 50, 50); // 3 anclas pequeñas que SÍ formarían retícula
    const u = unidadTipografica([...dominante, ...minoria], ZONA);
    assert.equal(Math.round(u.lado), 30, "gana el dominante, no la minoría alineada");
});

test("lo que no es un anillo no es un ancla", () => {
    // Un bloque sólido (relleno ~1) es texto o arte; un ✓ es un círculo hueco.
    const solidos = rejilla(5, 3).map((c) => ({ ...c, area: c.w * c.h }));
    assert.equal(unidadTipografica(solidos, ZONA), null);
});

test("con menos de tres anclas no se inventa nada", () => {
    assert.equal(unidadTipografica([check(10, 10), check(250, 10)], ZONA), null);
    assert.equal(unidadTipografica([], ZONA), null);
});
