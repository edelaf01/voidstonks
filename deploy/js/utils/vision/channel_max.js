/**
 * Escala de grises por canal MÁXIMO, invertida (Tesseract espera texto oscuro sobre claro).
 *
 * No vale `grayscale(100%)`: sus pesos de luminancia dejan el rojo puro en 54 de 255, así que
 * con el tema ROJO el texto quedaba a la altura de su fondo. Medido en VOID RELICS en rojo:
 * grayscale 0 nombres / 0 contadores, canal máximo 17 y 19.
 */
export function maxChannelInvert(ctx, width, height) {
    if (!width || !height) return;
    const img = ctx.getImageData(0, 0, width, height);
    const px = img.data;
    for (let i = 0; i < px.length; i += 4) {
        px[i] = px[i + 1] = px[i + 2] = 255 - Math.max(px[i], px[i + 1], px[i + 2]);
    }
    ctx.putImageData(img, 0, 0);
}
