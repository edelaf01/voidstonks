import { WF_THEMES } from "../../deploy/js/utils/vision/wf_themes.js";

/**
 * Generador de pantallas de recompensas SINTÉTICAS.
 *
 * Existe porque los fallos que reporta el usuario llegan como capturas de 5 MB de una
 * partida concreta: irreproducibles, imposibles de versionar y buenas para UN caso. Aquí se
 * fabrica la misma pantalla con las variables que de verdad la rompen —color del tema, ruido
 * del arte de fondo, contraste— y se puede barrer el espacio entero en milisegundos.
 *
 * No dibuja letras: los glifos solo los necesita el OCR, y el OCR no corre en los tests. Lo
 * que sí reproduce es lo que mira la visión: el título del color del tema (de donde sale el
 * acento), los ✓ circulares de cada casilla y el fondo con el que compiten.
 */

/**
 * Los 13 temas que conoce el escáner, tal cual los declara el código: así el barrido usa la
 * paleta de verdad y no una lista paralela que se queda vieja. Se añaden dos casos que no son
 * temas del juego pero sí aparecen: el blanco puro (algunas pantallas dibujan el nombre así) y
 * un tono apagado, para el extremo de bajo contraste.
 */
export const TEMAS = Object.fromEntries([
    ...WF_THEMES.map((t) => [t.name.toLowerCase().replaceAll(" ", "-"), [t.r, t.g, t.b]]),
    ["blanco", [255, 255, 255]],
    ["apagado", [125, 48, 34]],
]);

// Alias de los que se nombran en tests concretos.
TEMAS.naranja = TEMAS.default;
TEMAS.rojo = TEMAS.stalker;
TEMAS.claro = TEMAS.blanco;

const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));

/**
 * @param {object} o
 * @param {number[]} o.tema        RGB del color de acento.
 * @param {number} o.recompensas   Cuántas casillas dibujar (el detector exige >= 4).
 * @param {number} o.desplazaY     Baja la fila esa fracción del alto (panel scrolleado).
 * @param {number} o.ruido         0 = fondo liso; 1 = fondo saturado de arte del juego.
 * @param {number} o.contraste     Multiplica el brillo del acento (0.5 = tema apagado).
 * @param {number} o.semilla       Para que el ruido sea reproducible entre ejecuciones.
 */
export function pantallaRecompensas({
    tema = TEMAS.naranja, recompensas = 4, ruido = 0, contraste = 1, tinte = 0, tinteColor = null,
    width = 1280, height = 720, semilla = 7, desplazaY = 0,
} = {}) {
    const data = new Uint8ClampedArray(width * height * 4).fill(255);
    const put = (x, y, [r, g, b]) => {
        if (x < 0 || y < 0 || x >= width || y >= height) return;
        const i = (y * width + x) * 4;
        data[i] = clamp(r); data[i + 1] = clamp(g); data[i + 2] = clamp(b); data[i + 3] = 255;
    };
    const rect = (x0, y0, w, h, color) => {
        for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) put(x, y, color);
    };

    // Fondo del juego. Con `tinte`, teñido del MISMO tono que el texto: es lo que hace el arte
    // de algunas misiones (una captura real del usuario sale entera roja con el título encima),
    // y es el caso duro de verdad — separar letra de fondo cuando comparten color, no cuando
    // contrastan. Se mantiene oscuro: el arte queda por debajo del panel, no lo tapa.
    // `tinteColor` separa el tono del FONDO del tono del TEXTO: en una captura real del
    // usuario el título va en blanco sobre un fondo rojo brillante, y ese desajuste es
    // precisamente lo que despista a la estimación del color del tema.
    const tono = tinteColor || tema;
    const base = tinte > 0
        ? tono.map((c) => 12 + c * 0.55 * tinte)
        : [12, 10, 14];
    rect(0, 0, width, height, base);

    // Ruido: manchas del arte de la misión. NO del color del tema, para que la máscara de
    // acento tenga que distinguirlas de verdad.
    let s = semilla;
    const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let n = 0; n < Math.round(ruido * 220); n++) {
        const cx = rnd() * width, cy = rnd() * height, rad = 6 + rnd() * 40;
        const color = tinte > 0
            ? tono.map((c) => 20 + c * (0.35 + rnd() * 0.45) * tinte)
            : [60 + rnd() * 180, 60 + rnd() * 160, 60 + rnd() * 140];
        // Con degradado dentro de la mancha, no color plano: el arte de una misión es una foto
        // y sus colores varían píxel a píxel. Con manchas planas se formaban grupos de color
        // exactos de cientos de píxeles —algo que en una captura real no pasa— y el banco medía
        // un problema inventado por él mismo.
        for (let y = -rad; y <= rad; y++) for (let x = -rad; x <= rad; x++) {
            if (x * x + y * y > rad * rad) continue;
            const caida = 1 - Math.sqrt(x * x + y * y) / rad * 0.45;
            put(Math.round(cx + x), Math.round(cy + y), color.map((c) => c * caida + (rnd() - 0.5) * 14));
        }
    }

    const acento = tema.map((c) => c * contraste);
    // El panel de recompensas: en el juego el arte de la misión queda DETRÁS de un fondo
    // oscuro semiopaco, y por eso los ✓ no compiten con él. Sin esto el generador sería más
    // duro que la realidad y mediría un fallo que el usuario no ve.
    const panel = { x: Math.floor(width * 0.46), y: Math.floor(height * 0.18), w: Math.floor(width * 0.50), h: Math.floor(height * 0.22) };
    for (let y = panel.y; y < panel.y + panel.h; y++) {
        for (let x = panel.x; x < panel.x + panel.w; x++) {
            const i = (y * width + x) * 4;
            data[i] = data[i] * 0.18 + 14; data[i + 1] = data[i + 1] * 0.18 + 12; data[i + 2] = data[i + 2] * 0.18 + 16;
        }
    }
    // Título "MISSION COMPLETE": de ahí saca estimateAccentColor el color del tema. Se dibuja
    // como LETRAS y no como una barra maciza, que es la diferencia que importa: en la pantalla
    // real los trazos son pocos píxeles y el fondo de la franja es mayoría, así que un fondo
    // teñido puede secuestrar la medida. Con una barra llena eso no pasa nunca y el banco daba
    // por bueno un caso que en una captura de verdad falla.
    const tituloY = Math.floor(height * 0.03), tituloH = Math.floor(height * 0.05);
    const trazo = Math.max(2, Math.round(tituloH * 0.18));
    let tx = Math.floor(width * 0.36);
    for (const palabra of [7, 8]) {              // "MISSION" "COMPLETE"
        for (let l = 0; l < palabra; l++) {
            rect(tx, tituloY, trazo, tituloH, acento);                       // asta izquierda
            rect(tx + trazo * 2, tituloY, trazo, tituloH, acento);           // asta derecha
            rect(tx, tituloY + Math.floor(tituloH / 2), trazo * 3, trazo, acento); // travesaño
            tx += trazo * 4;
        }
        tx += trazo * 3;
    }

    // Casillas: el ✓ del juego va dentro de un círculo, así que el anillo es fiel y además
    // cae en la horquilla de relleno que exige el detector (0.28-0.52).
    const S = Math.round(height * 0.0208);
    const grosor = Math.max(1, Math.round(S * 0.15));
    // desplazaY imita el panel scrolleado: la fila visible cae más abajo de lo que le toca.
    const x0 = Math.floor(width * 0.50), paso = Math.round(width * 0.11);
    // 0.252 deja la fila donde la tiene la pantalla real (medido: casilla en el 24.3% del alto).
    const y0 = Math.floor(height * (0.252 + desplazaY));
    const casillas = [];
    for (let i = 0; i < recompensas; i++) {
        const cx = x0 + i * paso;
        rect(cx, y0, S, grosor, acento);
        rect(cx, y0 + S - grosor, S, grosor, acento);
        rect(cx, y0, grosor, S, acento);
        rect(cx + S - grosor, y0, grosor, S, acento);
        casillas.push({ x: cx, y: y0, s: S });
    }
    return { img: { data, width, height }, casillas, acento: acento.map(clamp) };
}

/**
 * El RÓTULO de una recompensa: la caja del nombre tal y como la pinta el juego —centrado,
 * partido en una, dos o tres líneas—. Cada palabra es un rectángulo de tinta: los glifos solo
 * los necesita el OCR, y lo que se mide aquí (cuántas líneas hay y cuánta tinta cubre lo
 * leído) no depende de la forma de las letras.
 *
 * Tamaño tomado de las capturas del usuario: la tarjeta ocupa ~0.096 del ancho y ~0.16 del
 * alto del frame, y el rótulo vive en su franja inferior.
 *
 * @param {string[]} lineas  palabras por línea, p.ej. [["XAKU","PRIME","NEUROPTICS"],["BLUEPRINT"]]
 */
export function rotuloRecompensa({
    lineas = [["XAKU", "PRIME", "NEUROPTICS"], ["BLUEPRINT"]],
    tema = TEMAS.naranja, ruido = 0, contraste = 1, ancho = 246, alto = 60, semilla = 3,
} = {}) {
    const width = ancho, height = alto;
    const data = new Uint8ClampedArray(width * height * 4);
    const fondo = [16, 14, 18];
    for (let i = 0; i < data.length; i += 4) {
        data[i] = fondo[0]; data[i + 1] = fondo[1]; data[i + 2] = fondo[2]; data[i + 3] = 255;
    }
    let s = semilla;
    const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    // Arte de la misión detrás del rótulo, tenue: el panel lo atenúa pero no lo borra.
    for (let n = 0; n < Math.round(ruido * 40); n++) {
        const cx = rnd() * width, cy = rnd() * height, rad = 3 + rnd() * 12;
        const c = [30 + rnd() * 60, 28 + rnd() * 55, 34 + rnd() * 60];
        for (let y = -rad; y <= rad; y++) for (let x = -rad; x <= rad; x++) {
            const px = Math.round(cx + x), py = Math.round(cy + y);
            if (x * x + y * y > rad * rad || px < 0 || py < 0 || px >= width || py >= height) continue;
            const i = (py * width + px) * 4;
            data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2];
        }
    }
    const tinta = tema.map((c) => c * contraste);
    const altoLinea = Math.round(height / (lineas.length + 0.6));
    const altoGlifo = Math.round(altoLinea * 0.55);
    const anchoLetra = Math.round(altoGlifo * 0.62), hueco = Math.max(3, Math.round(anchoLetra * 0.9));
    const cajas = [];
    lineas.forEach((palabras, fila) => {
        const anchos = palabras.map((p) => p.length * anchoLetra);
        const total = anchos.reduce((a, b) => a + b, 0) + hueco * (palabras.length - 1);
        let x = Math.round((width - total) / 2);                    // CENTRADO, como el juego
        const y = Math.round(altoLinea * (fila + 0.4));
        palabras.forEach((palabra, k) => {
            for (let yy = y; yy < y + altoGlifo; yy++) {
                for (let xx = x; xx < x + anchos[k]; xx++) {
                    // Trazo discontinuo: una barra maciza no se parece a una palabra ni para
                    // contar tinta ni para medir su extensión.
                    if ((xx - x) % anchoLetra >= anchoLetra - 2) continue;
                    const i = (yy * width + xx) * 4;
                    data[i] = clamp(tinta[0]); data[i + 1] = clamp(tinta[1]); data[i + 2] = clamp(tinta[2]);
                }
            }
            cajas.push({ texto: palabra, fila, x0: x, x1: x + anchos[k] - 1, y0: y, y1: y + altoGlifo - 1 });
            x += anchos[k] + hueco;
        });
    });
    return { img: { data, width, height }, cajas, lineas };
}

/**
 * Pantalla VOID FISSURE/REWARDS: tarjetas con ARTE BRILLANTE arriba y RÓTULO TENUE debajo,
 * todo sobre un fondo teñido del mismo tono que el texto.
 *
 * Esa desproporción es el caso real y no la reproducía nada: medido en una captura, el arte
 * llega a canal máximo ~250 y los rótulos se quedan en ~150, así que una máscara con suelo de
 * brillo se queda el arte y tira el texto. `brilloRotulo` es la fracción del brillo del tema
 * con la que se pintan los rótulos, para poder barrer ese eje.
 */
export function pantallaFisura({
    tema = TEMAS.stalker, tarjetas = 3, width = 2560, height = 1440,
    brilloRotulo = 0.6, tinte = 0.55, manchasArte = 40, semilla = 11,
} = {}) {
    const data = new Uint8ClampedArray(width * height * 4).fill(255);
    const put = (x, y, [r, g, b]) => {
        if (x < 0 || y < 0 || x >= width || y >= height) return;
        const i = (y * width + x) * 4;
        data[i] = clamp(r); data[i + 1] = clamp(g); data[i + 2] = clamp(b); data[i + 3] = 255;
    };
    const rect = (x0, y0, w, h, c) => {
        for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) put(x, y, c);
    };
    let s = semilla;
    const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

    rect(0, 0, width, height, [12 + tema[0] * tinte * 0.5, 12 + tema[1] * tinte * 0.5, 12 + tema[2] * tinte * 0.5]);

    const pasoX = Math.floor(width * 0.155);
    const x0 = Math.floor(width * 0.19);
    const arteY = Math.floor(height * 0.19), arteH = Math.floor(height * 0.13);
    const rotuloY = Math.floor(height * 0.325), rotuloH = Math.floor(height * 0.016);
    const rotulos = [];
    for (let i = 0; i < tarjetas; i++) {
        const cx = x0 + i * pasoX;
        // arte: manchas claras, lo más brillante del frame
        for (let k = 0; k < manchasArte; k++) {
            const w = Math.floor(arteH * (0.15 + rnd() * 0.25));
            rect(cx + Math.floor(rnd() * (pasoX - w)), arteY + Math.floor(rnd() * (arteH - w)), w, w,
                [200 + rnd() * 55, 195 + rnd() * 55, 170 + rnd() * 60]);
        }
        // rótulo: trazos del color del tema, atenuados
        const tinta = [tema[0] * brilloRotulo, tema[1] * brilloRotulo, tema[2] * brilloRotulo];
        const grosor = Math.max(2, Math.round(rotuloH * 0.22));
        for (let letra = 0; letra < 9; letra++) {
            const lx = cx + Math.floor(pasoX * 0.12) + letra * Math.floor(rotuloH * 0.9);
            rect(lx, rotuloY, grosor, rotuloH, tinta);
            rect(lx, rotuloY + Math.floor(rotuloH / 2), Math.floor(rotuloH * 0.5), grosor, tinta);
        }
        rotulos.push({ x: cx, y: rotuloY, h: rotuloH });
    }
    return {
        img: { data, width, height },
        rotulos,
        banda: { x: 0, y: arteY, w: width, h: rotuloY + rotuloH * 3 - arteY },
    };
}
