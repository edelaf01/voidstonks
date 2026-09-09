import { lanes, bestLattice } from "./mission_complete_grid.js";
/**
 * La UNIDAD TIPOGRÁFICA de una pantalla, medida en el frame y validada antes de creérsela.
 *
 * Todo el pipeline de visión venía expresando sus recortes como fracciones del alto del frame
 * (`height * 0.0208` para el lado del checkmark, `cellH * 0.50` para la banda del nombre…), y
 * eso es una SUPOSICIÓN sobre la escala del HUD, que el usuario elige en las opciones del juego.
 * Medido: en 10 de 11 capturas de fin de misión el lado del ✓ es exactamente 0.0208 del alto,
 * pero en una (temas/mission-red.png) no, y ahí no se detecta ni una casilla.
 *
 * El ancla es el ✓ de cada casilla: aparece una vez por celda y siempre igual. Medirlo da a la
 * vez DÓNDE está la rejilla y a QUÉ ESCALA está dibujada, así que el resto de recortes pueden
 * expresarse en múltiplos suyos en lugar de en fracciones del frame.
 *
 * Lo que no puede hacerse es medirlo a secas: el "tamaño que más se repite" elige ruido de
 * interfaz en cuanto el ✓ no domina —comprobado, en mission-red devuelve 9.1 donde el real
 * ronda 20—. Por eso un tamaño solo vale si sus anclas forman RETÍCULA: el ruido se repite pero
 * no se alinea. Es la diferencia entre un 4x6 plausible y un "7x11" que no es una rejilla.
 */

// Un ✓ es un anillo: cuadrado y hueco por dentro. Los extremos dejan fuera el texto (relleno
// alto) y las manchas de arte (relleno bajo o desproporcionadas).
const CUADRADO = { ladoMin: 8, arTol: 0.15, rellenoMin: 0.20, rellenoMax: 0.55 };
/**
 * Tolerancia de tamaño al agrupar anclas. Con bins geométricos estrechos (8%) el MISMO ✓ se
 * repartía en cuatro grupos en cuanto la captura venía reescalada: medido en temas/mission-red,
 * los cinco ✓ de una fila miden 23, 19, 18 y 17 px por el remuestreo, y así ninguno reunía
 * bastantes para formar retícula. Se agrupa por ventana deslizante alrededor de cada tamaño
 * observado, que tolera esa dispersión sin mezclar tamaños de verdad distintos.
 */
const TOL_TAMANO = 1.35;
/**
 * Columnas mínimas. Con dos basta para que CUALQUIER par de puntos defina un paso, así que el
 * ruido disperso "encuentra" retícula siempre. Las pantallas reales tienen 5 columnas en fin de
 * misión y 3-4 en recompensas, así que tres es exigente sin dejar fuera nada real.
 */
const MIN_COLS = 3;
/** Y la retícula tiene que EXPLICAR las anclas, no encajar tres de doce por casualidad. */
const COBERTURA_MIN = 0.6;
/**
 * Cuántas anclas caben en el paso de la retícula. Es el filtro que separa la rejilla del RUIDO
 * de fondo: los iconos y el arte también se repiten, pero al alinearlos sale un paso absurdo
 * respecto a su tamaño. Medido sobre el corpus: las lecturas buenas dan 8.0 (fin de misión) y
 * 14.0 (recompensas), y las falsas 24, 31, 41 y hasta 99. El corte en 20 cae en un hueco
 * enorme, y es una RELACIÓN entre dos cosas medidas, no una fracción del frame.
 *
 * Por abajo también: una casilla no mide dos anclas de ancho. Sin ese suelo, al rechazar el bin
 * bueno el bucle caía a uno más pequeño y colaba otro ruido con paso ridículo.
 */
const PASO_MIN = 4;
const PASO_MAX = 20;
/**
 * El ✓ es, con diferencia, lo que MÁS se repite: hay uno por casilla y nada más en el panel se
 * comporta así. Los bins muy por debajo del mayor son ruido, y probarlos "por si acaso" es
 * justamente cómo se colaba: si el bin bueno no valida, la respuesta correcta es NINGUNA.
 */
const POBLACION_MIN = 0.6;

/**
 * @param comps componentes conexos de la máscara del acento, {x, y, w, h, area}.
 * @param zona  {w, h} de la región donde se buscaron.
 * @returns {{lado, paso, cols, filas, anclas}} o null si ningún tamaño forma retícula.
 */
export function unidadTipografica(comps, zona) {
    const cuadrados = comps.filter((c) => {
        if (c.w < CUADRADO.ladoMin || c.h < CUADRADO.ladoMin) return false;
        if (Math.abs(c.w - c.h) > Math.max(2, Math.max(c.w, c.h) * CUADRADO.arTol)) return false;
        const relleno = c.area / (c.w * c.h);
        return relleno > CUADRADO.rellenoMin && relleno < CUADRADO.rellenoMax;
    });
    if (cuadrados.length < 3) return null;

    // Un grupo por cada tamaño observado: los que caben en su ventana de tolerancia. Se
    // deduplican por el conjunto de miembros, que con pocas anclas sale más barato que
    // cualquier clustering de verdad.
    const lados = cuadrados.map((c) => (c.w + c.h) / 2);
    const vistos = new Set();
    const grupos = [];
    for (const centro of lados) {
        const g = cuadrados.filter((_, i) => lados[i] >= centro / TOL_TAMANO && lados[i] <= centro * TOL_TAMANO);
        if (g.length < 3) continue;
        const firma = g.map((c) => `${c.x},${c.y}`).join("|");
        if (vistos.has(firma)) continue;
        vistos.add(firma);
        grupos.push(g);
    }
    if (!grupos.length) return null;

    // De más poblado a menos: el ✓ es lo que más se repite, pero se COMPRUEBA, no se asume.
    const mayorPoblacion = Math.max(...grupos.map((g) => g.length));
    const candidatos = grupos
        .filter((g) => g.length >= mayorPoblacion * POBLACION_MIN)
        .sort((a, b) => b.length - a.length);
    for (const grupo of candidatos) {
        const lado = grupo.reduce((s, c) => s + (c.w + c.h) / 2, 0) / grupo.length;
        // Separación de carriles a media ancla: dos ✓ de la misma columna nunca caen más lejos.
        const sep = lado * 0.5;
        const { pitch: pasoX, positions: cols } = bestLattice(lanes(grupo.map((c) => c.x), sep), lado, zona.w);
        if (!pasoX || cols.length < MIN_COLS) continue;
        const enRetícula = grupo.filter((c) => {
            const k = Math.round((c.x - cols[0]) / pasoX);
            return Math.abs(c.x - cols[0] - k * pasoX) <= lado * 0.5;
        }).length;
        if (enRetícula < grupo.length * COBERTURA_MIN) continue;
        // Ruido alineado por casualidad: la casilla no mide ni 2 anclas ni 40.
        if (pasoX > lado * PASO_MAX || pasoX < lado * PASO_MIN) continue;
        const { positions: filas } = bestLattice(lanes(grupo.map((c) => c.y), sep), lado, zona.h);
        // La casilla es cuadrada: un paso muy distinto del lado esperado delata una retícula
        // apoyada en fantasmas. No se fija el múltiplo —cambia por pantalla— pero sí que exista.
        return { lado, paso: pasoX, cols: cols.length, filas: filas.length, anclas: grupo };
    }
    return null;
}
