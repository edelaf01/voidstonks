/**
 * Máscara de "esto es texto de la UI" a partir de los colores de tema.
 *
 * El juego no pinta el color del tema tal cual: lo dibuja a distintas opacidades sobre el fondo,
 * así que el MISMO texto aparece en toda una rampa de brillos. Medido en la captura de VOID
 * RELICS en rojo: el color puro (248,56,48) sale en 6.053 píxeles, pero la rampa 120→152 del
 * mismo tono suma 33.540 — y está a distancia 111 del tema, muy lejos de la tolerancia de 44
 * con la que se comparaba antes. Resultado: Tesseract sacaba 1 palabra de la pantalla entera.
 *
 * Comparando por TONO (se escala el píxel al brillo del tema y se mide allí) salen 64, y
 * exigiendo además contraste con la vecindad —que es lo que separa una letra del arte de fondo
 * teñido del mismo color— salen 81.
 */

/** Tolerancia de color, la misma que usaba la comparación absoluta. */
const TOL_SQ = 1944;
const RADIO = 7;
const CONTRASTE_MIN = 20;
/** Por debajo de esto el escalado amplifica ruido de un píxel casi negro. */
const BRILLO_MIN = 40;

function integralLuma(data, w, h) {
    const luma = new Float32Array(w * h);
    for (let i = 0, p = 0; p < w * h; p++, i += 4) {
        luma[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }
    const suma = new Float64Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            suma[(y + 1) * (w + 1) + x + 1] = luma[y * w + x] + suma[y * (w + 1) + x + 1]
                + suma[(y + 1) * (w + 1) + x] - suma[y * (w + 1) + x];
        }
    }
    return { luma, suma };
}

/** ¿El píxel es el color del tema a cualquier opacidad? */
export function matchesThemeHue(r, g, b, theme) {
    const max = Math.max(r, g, b);
    if (max < BRILLO_MIN) return false;
    const escala = Math.max(theme.r, theme.g, theme.b) / max;
    const dr = r * escala - theme.r, dg = g * escala - theme.g, db = b * escala - theme.b;
    return dr * dr + dg * dg + db * db < TOL_SQ;
}

/**
 * Pinta la imagen en blanco y negro dejando en negro lo que parece texto del tema.
 * Modifica `imageData` en sitio y devuelve cuántos píxeles marcó.
 */
export function themeTextMask(imageData, themes) {
    const { data, width: w, height: h } = imageData;
    const { luma, suma } = integralLuma(data, w, h);
    // Cuánto tiene que destacar un píxel: RELATIVO al rango de la imagen, nunca más exigente
    // que CONTRASTE_MIN. Con el listón fijo, un rótulo tenue sobre fondo teñido del mismo tono
    // (diferencia medida: 14) se caía entero, que es el fallo que dejaba la pasada sin nombres.
    const orden = Float32Array.from(luma).sort();
    const pct = (q) => orden[Math.min(orden.length - 1, Math.floor(orden.length * q))];
    const minContraste = Math.min(CONTRASTE_MIN, Math.max(6, (pct(0.99) - pct(0.5)) * 0.12));
    let marcados = 0;
    for (let y = 0; y < h; y++) {
        const ya = Math.max(0, y - RADIO), yb = Math.min(h, y + RADIO + 1);
        for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            let texto = false;
            for (const t of themes) {
                if (matchesThemeHue(data[i], data[i + 1], data[i + 2], t)) { texto = true; break; }
            }
            if (texto) {
                const xa = Math.max(0, x - RADIO), xb = Math.min(w, x + RADIO + 1);
                const media = (suma[yb * (w + 1) + xb] - suma[ya * (w + 1) + xb]
                    - suma[yb * (w + 1) + xa] + suma[ya * (w + 1) + xa]) / ((yb - ya) * (xb - xa));
                // El listón, RELATIVO al nivel local cuando la zona es oscura. Un tema oscuro
                // dibuja su rótulo con el mismo contraste relativo que uno brillante pero con
                // la mitad de diferencia absoluta de luma —medido sobre la escena sintética:
                // Tenno (6,106,74) da 22.9 y Stalker (255,61,51) da 43.9— así que un listón en
                // unidades de luma deja fuera los temas oscuros ENTEROS. El mínimo del par
                // conserva el valor calibrado donde hay luz y solo afloja donde no la hay.
                const l = luma[y * w + x];
                texto = l - media > Math.max(6, Math.min(minContraste, media * 0.25));
            }
            if (texto) marcados++;
            data[i] = data[i + 1] = data[i + 2] = texto ? 0 : 255;
        }
    }
    return marcados;
}
