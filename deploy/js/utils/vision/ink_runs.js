/**
 * Cuánto se parece a TEXTO una máscara en blanco y negro: tramos de tinta por píxel de tinta.
 *
 * Las letras son muchos trazos cortos por fila; una mancha de arte, pocos y largos. Medido en
 * la pantalla de fisura, donde la densidad no distinguía nada porque ambas máscaras rondaban el
 * 9%: el arte de las tarjetas puntúa 0.023 y el texto 0.125.
 */
export function inkRunRatio(data, w, h) {
    let tramos = 0, tinta = 0;
    for (let y = 0; y < h; y++) {
        let dentro = false;
        for (let x = 0; x < w; x++) {
            if (data[(y * w + x) * 4] < 128) { tinta++; if (!dentro) { tramos++; dentro = true; } }
            else dentro = false;
        }
    }
    return tinta ? tramos / tinta : 0;
}
