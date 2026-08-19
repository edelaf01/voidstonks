/**
 * Generador de frames sintéticos de la pantalla VOID FISSURE/REWARDS.
 *
 * Existe porque las capturas reales de recompensas pesan ~6 MB y no caben en el repo, así que
 * sin esto los tests de recorte solo corren en la máquina que las tenga. La geometría está
 * MEDIDA sobre una captura real de 2560x1440 que se leyó bien (Fang Prime Blueprint / Forma
 * Blueprint / Euphona Prime Barrel / Quassus Prime Handle):
 *
 *   - fila de nombres en y≈593 (41 % del alto)
 *   - texto de las cards de x≈666 a x≈1907 — la mitad del ancho del frame, no el 84 % que
 *     asume el recorte fijo
 *   - barra de título arriba del todo, nombres de escuadra debajo de las cards, y el bonus de
 *     Steel Path más abajo
 *
 * Lo importante son los CONFUSORES, no las cards: el HUD inferior (nombres de escuadra + bonus
 * + kill feed) tiene MÁS masa de texto que cuatro nombres de ítem, y es con quien se quedaba
 * `pickBest`. Un frame de prueba que solo pinte la fila buena no prueba nada.
 */

/** PRNG determinista (mulberry32), como el generador de frames de inventario. */
function mulberry32(seed) {
    return function () {
        seed |= 0;
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Rellena un rectángulo con trazos verticales que imitan glifos.
 *
 * Dos cosas que hay que respetar o el frame no sirve, y las dos se descubrieron porque la
 * detección no veía NADA a 1440p mientras funcionaba a 1080p:
 *
 * - El grosor escala con la altura del texto, como en una tipografía real. Con un 3-on/2-off
 *   fijo, el downscale a 480px de ancho (5,3× desde 1440p) deja el periodo por debajo de un
 *   píxel y lo promedia a gris plano.
 * - El ancho de cada trazo VARÍA. Un patrón perfectamente periódico entra en aliasing contra el
 *   muestreo por `strideX` del perfil de filas: se muestrea siempre la misma fase y no se ve ni
 *   un borde. El texto real es irregular y por eso las capturas de verdad sí se detectan.
 */
function texto(data, width, x0, y0, x1, y1, [r, g, b], seed = 7) {
    const cuerpo = Math.max(4, y1 - y0);
    const rnd = mulberry32(seed + x0 + y0);
    for (let x = x0; x < x1;) {
        const trazo = Math.max(2, Math.round(cuerpo * (0.25 + rnd() * 0.45)));
        const hueco = Math.max(2, Math.round(cuerpo * (0.18 + rnd() * 0.35)));
        const hasta = Math.min(x1, x + trazo);
        for (let y = y0; y < y1; y++) {
            for (let xx = x; xx < hasta; xx++) {
                const i = (y * width + xx) * 4;
                data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
            }
        }
        x = hasta + hueco;
    }
}

/** Rectángulo sólido (paneles translúcidos de las cards, fondo). */
function bloque(data, width, x0, y0, x1, y1, [r, g, b]) {
    for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
            const i = (y * width + x) * 4;
            data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
        }
    }
}

/**
 * @param {object} [opts]
 * @param {number} [opts.width=2560]
 * @param {number} [opts.height=1440]
 * @param {number} [opts.cards=4]      cuántas recompensas pintar
 * @param {boolean} [opts.hud=true]    pinta título, nombres de escuadra y bonus (los confusores)
 * @param {[number,number,number]} [opts.tinte] color de fondo; por defecto el rojo/óxido de Marte,
 *        que es donde la pasada de nombres por tono se cae (tinte ≈ color del tema).
 * @returns {{width:number, height:number, data:Uint8ClampedArray}} ImageData-like
 */
export function makeRewardFrame(opts = {}) {
    const {
        width = 2560, height = 1440, cards = 4, hud = true,
        tinte = [92, 38, 30],
    } = opts;

    const data = new Uint8ClampedArray(width * height * 4);
    bloque(data, width, 0, 0, width, height, tinte);

    const NARANJA = [240, 134, 17];   // texto del tema (Default)
    const CREMA = [236, 230, 214];    // nombres de ítem
    const PANEL = [38, 26, 24];       // panel translúcido de la card

    // Fila de cards: centrada, ocupando la mitad del ancho (medido en la captura real).
    const filaX0 = Math.round(width * 0.26);
    const filaX1 = Math.round(width * 0.75);
    const anchoCard = (filaX1 - filaX0) / cards;
    const nombreY = Math.round(height * 0.412);
    const altoTexto = Math.max(2, Math.round(height * 0.019));

    for (let i = 0; i < cards; i++) {
        const cx0 = Math.round(filaX0 + i * anchoCard);
        const cx1 = Math.round(filaX0 + (i + 1) * anchoCard) - 4;
        bloque(data, width, cx0, Math.round(height * 0.16), cx1, Math.round(height * 0.44), PANEL);
        // Nombre: centrado en su card y sin llegar a los bordes, como en el juego.
        const margen = Math.round((cx1 - cx0) * 0.08);
        texto(data, width, cx0 + margen, nombreY, cx1 - margen, nombreY + altoTexto, CREMA);
        // Badge "N Owned / Crafted" encima del arte.
        texto(data, width, cx0 + margen, Math.round(height * 0.175),
            cx0 + margen + Math.round((cx1 - cx0) * 0.45), Math.round(height * 0.19), NARANJA);
    }

    if (!hud) return { data, width, height };

    // --- Confusores, con las posiciones del log que hacía fallar el recorte ---

    // Barra de título "VOID FISSURE/REWARDS" (arriba del todo): salía como "1 cards y=0".
    texto(data, width, Math.round(width * 0.15), Math.round(height * 0.055),
        Math.round(width * 0.43), Math.round(height * 0.08), NARANJA);

    // Nombres de escuadra bajo las cards + bonus de Steel Path + kill feed. JUNTOS tienen más
    // masa de texto que los cuatro nombres de ítem: son los que ganaban por masa y producían la
    // banda de y=667 alto 773 con la que el escáner leía "TheDeathstroke76 / Steel Path Bonus".
    for (let fila = 0; fila < 3; fila++) {
        const y = Math.round(height * (0.46 + fila * 0.028));
        texto(data, width, Math.round(width * 0.26), y,
            Math.round(width * 0.72), y + altoTexto, NARANJA);
    }
    for (let fila = 0; fila < 2; fila++) {
        const y = Math.round(height * (0.60 + fila * 0.03));
        texto(data, width, Math.round(width * 0.38), y,
            Math.round(width * 0.60), y + altoTexto, NARANJA);
    }

    return { data, width, height };
}
