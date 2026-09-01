/**
 * How much a black and white mask looks like TEXT: ink runs per ink pixel. Letters are many short strokes
 * per row; an art blob, few long ones. Density alone tells nothing apart when both masks are around 9%.
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
