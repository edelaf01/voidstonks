/**
 * Preprocesado del recorte de recompensas para el OCR.
 *
 * Sustituye a `ctx.filter = "grayscale(100%) contrast(…) brightness(…)"`. El grayscale de CSS
 * usa pesos de luminancia y con el tinte rojo del juego el texto queda a la altura de su fondo:
 * medido sobre una captura de fisura, tras binarizar quedaban 1.669 píxeles de texto y el OCR
 * leía "yo, 7 a"; con el canal máximo quedan 6.046 y lee los nombres.
 *
 * Va en aritmética y no en `ctx.filter` a propósito: el filtro solo existe en el navegador, así
 * que ningún test podía reproducir este fallo — la suite estaba verde con esto roto.
 */
import { inkRunRatio } from "./ink_runs.js";

/** Distancia cromática al color medido y suelo de luminancia, barridos sobre cinco capturas. */
const TEMA_DIST = 0.36;
const TEMA_LUMA_MIN = 40;
/**
 * Techos de luminancia a probar, en veces la del color medido. El arte de la tarjeta mete
 * vetas MUCHO más brillantes que el rótulo —una dorada cruzaba la "o" de "Hydroid" y el OCR
 * leía "neiuaibei"—, y como comparten tono no las quita la distancia cromática: teniendo el
 * color medido se puede pedir además que el píxel brille COMO ÉL.
 *
 * Se prueban los dos porque una constante fija no vale para las dos pantallas: con techo 1.3
 * sale "Hydroid" en la captura comprimida pero se pierde el "Neuroptics" de otra (y queda
 * "Voruna Prime Blueprint", que es OTRA pieza); sin techo, al revés. Gana el que dé la máscara
 * más parecida a texto, la misma comparación que elige el color.
 */
const TECHOS = [Infinity, 1.3];
/**
 * Tinta mínima para que una máscara compita. `inkRunRatio` mide tramos POR PÍXEL de tinta, así
 * que una máscara casi borrada puntúa altísimo: en una captura ganaba una con el 0.47% del
 * recorte y ratio 0.77 —el rótulo entero deshecho en motas— frente a las buenas, que rondaban
 * 2.7-3.6% con ratio 0.33, y el resultado era "Voruna Prime Blueprint" en vez de "...Prime
 * Neuroptics Blueprint", que es OTRA pieza. Los cuatro rótulos de una pantalla ocupan entre el
 * 2.4% y el 4.8% medido en cinco capturas.
 */
const TINTA_MIN = 0.01;
/** Alturas de franja de rótulo a probar, en fracción del alto del recorte. */
const ALTURAS_ROTULO = [0.10, 0.14, 0.18];
const RADIO = 5;
/**
 * Votos mínimos para que un tema entre en la comparación: por debajo son cuatro píxeles
 * sueltos del arte y su máscara puntúa lo que sea por casualidad.
 */
const VOTOS_MIN = 30;
/**
 * Cuánto tiene que sobresalir un píxel de su vecindad para contar como trazo, en percentil del
 * propio recorte y nunca en valor absoluto.
 *
 * `PCT_TINTA` es el de la máscara. `PCTS_VOTO` son los de la votación: cada uno da una
 * estimación distinta del color —la mediana sobre trazos cada vez más marcados— y se prueban
 * las tres. Medido contra la app sobre las cinco capturas que fallaban (ítems leídos, de 20):
 * esta escalera saca los 20; con un solo percentil salen 12, bajando el listón a 0.25 salen 11
 * —el color pasa a ser la mediana de píxeles de fondo— y añadiendo 0.5 a la escalera, 10.
 */
const PCT_TINTA = 0.5;
const PCTS_VOTO = [0.75, 0.85, 0.92];

/**
 * Cuánto sobresale cada píxel de su vecindad, y el percentil de esa medida.
 *
 * Todo listón de contraste sale de aquí, RELATIVO al propio recorte: uno fijo se lleva por
 * delante los rótulos tenues de las capturas oscuras y deja pasar el fondo en las claras.
 */
function analisisLocal(px, w, h) {
    const luma = new Float32Array(w * h);
    for (let i = 0, p = 0; p < w * h; p++, i += 4) {
        luma[p] = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    }
    const sum = new Float64Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            sum[(y + 1) * (w + 1) + x + 1] = luma[y * w + x] + sum[y * (w + 1) + x + 1]
                + sum[(y + 1) * (w + 1) + x] - sum[y * (w + 1) + x];
        }
    }
    const exceso = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
        const ya = Math.max(0, y - RADIO), yb = Math.min(h, y + RADIO + 1);
        for (let x = 0; x < w; x++) {
            const xa = Math.max(0, x - RADIO), xb = Math.min(w, x + RADIO + 1);
            const media = (sum[yb * (w + 1) + xb] - sum[ya * (w + 1) + xb]
                - sum[yb * (w + 1) + xa] + sum[ya * (w + 1) + xa]) / ((yb - ya) * (xb - xa));
            exceso[y * w + x] = luma[y * w + x] - media;
        }
    }
    const pos = Float32Array.from(exceso.filter((v) => v > 0)).sort();
    const umbral = (q) => (pos.length ? pos[Math.min(pos.length - 1, Math.floor(pos.length * q))] : 0);
    return { exceso, umbral };
}

let colorCache = null;

/** Lo llama el escáner al cambiar de contexto: el color solo puede cambiar con la pantalla. */
export function olvidaColorTexto() { colorCache = null; }

/**
 * Color EXACTO del texto del recorte, usando los temas conocidos como guía.
 *
 * No se pregunta "de qué color es el tema" sobre la imagen entera —ahí ganan el arte y el
 * tinte—: se miran solo los píxeles que DESTACAN de su vecindad (los trazos), se vota a qué
 * tema conocido se parece cada uno por TONO (no por brillo, que varía con la opacidad), y del
 * tema ganador se devuelve la MEDIANA de sus píxeles reales. Así el color sale medido, no
 * supuesto, pero anclado a la lista cerrada de temas para no derivar hacia el fondo.
 */
/** Color real del tema más votado entre los píxeles que destacan de su vecindad. */
function votaColor(px, w, h, temas, exceso, minVoto) {
    const votos = new Map();
    for (let p = 0; p < w * h; p++) {
        const i = p * 4;
        const mx = Math.max(px[i], px[i + 1], px[i + 2]);
        if (mx < TEMA_LUMA_MIN || exceso[p] < minVoto) continue;
        let mejor = -1, dMin = Infinity;
        for (let t = 0; t < temas.length; t++) {
            const e = Math.max(temas[t].r, temas[t].g, temas[t].b) / mx;
            const d = Math.abs(px[i] * e - temas[t].r) + Math.abs(px[i + 1] * e - temas[t].g)
                + Math.abs(px[i + 2] * e - temas[t].b);
            if (d < dMin) { dMin = d; mejor = t; }
        }
        if (dMin > 120) continue;
        if (!votos.has(mejor)) votos.set(mejor, { r: [], g: [], b: [] });
        const v = votos.get(mejor);
        v.r.push(px[i]); v.g.push(px[i + 1]); v.b.push(px[i + 2]);
    }
    let gana = null, top = VOTOS_MIN;
    for (const [, v] of votos) if (v.r.length > top) { top = v.r.length; gana = v; }
    if (!gana) return null;
    const med = (a) => { a.sort((x, y) => x - y); return a[a.length >> 1]; };
    return [med(gana.r), med(gana.g), med(gana.b)];
}

/** ¿El píxel `i` es del color `col` (tono y brillo parecidos) y destaca de su vecindad? */
function esTexto(px, i, col, cl, techo, destaca) {
    const lum = (px[i] + px[i + 1] + px[i + 2]) / 3;
    if (!(lum > TEMA_LUMA_MIN) || lum > cl * techo || !destaca) return false;
    const dr = px[i] / lum - col[0] / cl, dg = px[i + 1] / lum - col[1] / cl,
        db = px[i + 2] / lum - col[2] / cl;
    return Math.sqrt(dr * dr + dg * dg + db * db) < TEMA_DIST;
}

/**
 * Cuánto se parece a TEXTO una máscara candidata; 0 si tiene tan poca tinta que no puede ser
 * el rótulo. El listón de tinta no es un detalle: `inkRunRatio` cuenta tramos POR PÍXEL de
 * tinta, así que una máscara BORRADA puntúa altísimo y gana. Pasó — ver `TINTA_MIN`.
 */
export function puntuaMascara(m, tinta, w, h) {
    return tinta < w * h * TINTA_MIN ? 0 : inkRunRatio(m, w, h);
}

/** Máscara del color `col`, y cuántos píxeles marcó. */
function mascaraColor(px, w, h, col, exceso, minTinta, techo) {
    const cl = (col[0] + col[1] + col[2]) / 3 || 1;
    const m = new Uint8Array(w * h * 4).fill(255);
    let tinta = 0;
    for (let p = 0; p < w * h; p++) {
        const i = p * 4;
        if (esTexto(px, i, col, cl, techo, exceso[p] > minTinta)) { m[i] = m[i + 1] = m[i + 2] = 0; tinta++; }
    }
    return { m, tinta };
}

/**
 * Máscara SIN color: solo "destaca de su vecindad". Compite con las de color por el mismo
 * criterio, y existe porque cuando la votación no encuentra tema el preproceso se caía a un
 * mapeo de brillo GLOBAL, que es exactamente lo que no se puede hacer aquí: el arte de la
 * tarjeta es lo más brillante del recorte y el rótulo lo más tenue, así que el corte global se
 * queda el arte y disuelve el texto. Medido sobre una captura en rojo a 1440p: el lienzo salía
 * con el arte en negro macizo y los rótulos en motas sueltas, y Tesseract leía 2 de 3.
 */
function mascaraContraste(px, w, h, exceso, minTinta) {
    const m = new Uint8Array(w * h * 4).fill(255);
    let tinta = 0;
    for (let p = 0; p < w * h; p++) {
        const i = p * 4;
        const lum = (px[i] + px[i + 1] + px[i + 2]) / 3;
        if (lum > TEMA_LUMA_MIN && exceso[p] > minTinta) { m[i] = m[i + 1] = m[i + 2] = 0; tinta++; }
    }
    return { m, tinta };
}

export function colorDelTexto(px, w, h, temas, local = null) {
    // La pantalla de recompensas dura ~10 s y se relee cada 800 ms con tres presets: sin caché
    // el color (y el barrido de candidatos) se recalcularía una docena de veces.
    // `false` = ya se midió y no había color de tema, distinto de `null` = sin medir.
    if (colorCache !== null) return colorCache || null;
    const { exceso, umbral } = local || analisisLocal(px, w, h);
    const minTinta = umbral(PCT_TINTA);
    let mejor = null, mejorRatio = 0;
    // Gana la máscara con más tramos de tinta por píxel: las letras son muchos trazos cortos
    // por fila, y el arte, el overlay del juego o el fondo teñido, pocos y largos
    // (ink_runs.js). Decidirlo midiendo es lo único que sirve para todas las capturas: por
    // votos ganaba el tinte de fondo en unas y el contador de FPS en blanco en otras.
    const vistos = new Set();
    const prueba = (col) => {
        if (!col || vistos.has(col.join())) return;
        vistos.add(col.join());
        for (const techo of TECHOS) {
            const { m, tinta } = mascaraColor(px, w, h, col, exceso, minTinta, techo);
            const ratio = puntuaMascara(m, tinta, w, h);
            if (ratio > mejorRatio) { mejorRatio = ratio; mejor = { color: col, techo }; }
        }
    };
    for (const q of PCTS_VOTO) prueba(votaColor(px, w, h, temas, exceso, umbral(q)));
    // La de contraste juega en la misma liga: si ninguna de color se parece más a texto que
    // ella, es que no hay color de tema que aislar y el rótulo hay que sacarlo por contraste.
    {
        const { m, tinta } = mascaraContraste(px, w, h, exceso, minTinta);
        const ratio = puntuaMascara(m, tinta, w, h);
        if (ratio > mejorRatio) { mejorRatio = ratio; mejor = { color: null, techo: Infinity }; }
    }
    if (!mejor) { colorCache = false; return null; }
    colorCache = mejor;
    return colorCache;
}

/**
 * La franja del RÓTULO dentro de un recorte, en filas del propio recorte.
 *
 * Existe porque el recorte calibrado contiene la tarjeta ENTERA —arte arriba, rótulo debajo— y
 * el arte se lleva por delante todo lo que se mida en global: la votación de color elige su
 * tono, el percentil de contraste sube hasta tapar las letras y, aunque la máscara conserve el
 * texto, Tesseract no lo segmenta con el arte alrededor. Medido sobre una captura en rojo a
 * 1440p: la máscara buena era legible A OJO y el OCR devolvía 0 de 3; ciñendo el recorte a la
 * franja del rótulo, 3 de 3.
 *
 * Se busca con `inkRunRatio` POR FRANJA en vez de sobre el recorte entero, que es lo que hacía
 * que el arte ganara: una fila de texto son muchos trazos cortos (medido 0,33-0,38 tramos por
 * píxel de tinta) y una de arte, pocos y largos (0,18-0,31). Sobre la máscara de CONTRASTE,
 * que es la única que contiene el texto cuando arte y rótulo comparten tono.
 *
 * Se barren varias ALTURAS de franja y gana la mejor puntuada, en vez de fijar una: el alto del
 * rótulo depende de la escala de UI y de si el nombre ocupa una línea o dos, y con un valor fijo
 * la ventana se come parte del arte y el máximo se va a otro sitio — medido en la misma captura,
 * con 0,10 y 0,14 la franja cae en el 78-94 % del recorte (el rótulo) y con 0,18 se va al 0-18 %.
 */
export function franjaDeRotulo(px, w, h, { alturas = ALTURAS_ROTULO } = {}) {
    if (!w || !h) return null;
    const { exceso, umbral } = analisisLocal(px, w, h);
    const { m } = mascaraContraste(px, w, h, exceso, umbral(PCT_TINTA));
    let mejor = null, mejorR = 0;
    for (const frac of alturas) {
        const alto = Math.max(8, Math.round(h * frac));
        if (alto >= h) continue;
        for (let y = 0; y + alto <= h; y += Math.max(2, alto >> 2)) {
            const sub = m.subarray(y * w * 4, (y + alto) * w * 4);
            let tinta = 0;
            for (let i = 0; i < sub.length; i += 4) if (sub[i] < 128) tinta++;
            const r = puntuaMascara(sub, tinta, w, alto);
            if (r > mejorR) { mejorR = r; mejor = { y0: y, y1: y + alto }; }
        }
    }
    return mejor;
}

export const REWARD_PRESETS = {
    STANDARD: { contraste: 4.0, brillo: 1.3 },
    LOW_LIGHT: { contraste: 3.2, brillo: 1.9 },
    HIGH_GLARE: { contraste: 2.6, brillo: 0.85 },
};

export function maxChannelPreset(ctx, width, height, preset = "STANDARD", temas = null) {
    // "COLOR" = devolver el recorte tal cual. Lo usa el motor de red, que lee el color directo:
    // binarizar para él sería tirar información que sabe aprovechar.
    if (!width || !height || preset === "COLOR") return;
    const { contraste, brillo } = REWARD_PRESETS[preset] || REWARD_PRESETS.STANDARD;
    const img = ctx.getImageData(0, 0, width, height);
    const px = img.data;
    // El tono NO basta: el juego tiñe el fondo del mismo color del tema, así que pedir solo
    // parecido cromático marcaba el 39% del recorte en una captura y el OCR no leía nada. Lo
    // que separa una letra del fondo teñido es DESTACAR de su vecindad, igual que en la
    // máscara de temas. Sin color medido se cae al canal máximo, que no depende de ninguno.
    const local = temas && temas.length ? analisisLocal(px, width, height) : null;
    const elegido = local ? colorDelTexto(px, width, height, temas, local) : null;
    const color = elegido?.color || null;
    const minTinta = local ? local.umbral(PCT_TINTA) : 0;
    const cl = color ? (color[0] + color[1] + color[2]) / 3 || 1 : 1;
    for (let p = 0, i = 0; i < px.length; i += 4, p++) {
        let v;
        if (color) {
            v = esTexto(px, i, color, cl, elegido.techo, local.exceso[p] > minTinta) ? 1 : 0;
        } else if (elegido) {
            // Ganó la máscara de contraste: el listón es el percentil del propio recorte, no un
            // brillo absoluto.
            const lum = (px[i] + px[i + 1] + px[i + 2]) / 3;
            v = lum > TEMA_LUMA_MIN && local.exceso[p] > minTinta ? 1 : 0;
        } else {
            v = Math.max(px[i], px[i + 1], px[i + 2]) / 255;
            v = Math.min(1, Math.max(0, (v - 0.5) * contraste + 0.5)) * brillo;
        }
        px[i] = px[i + 1] = px[i + 2] = Math.min(255, Math.max(0, Math.round(v * 255)));
    }
    ctx.putImageData(img, 0, 0);
}
