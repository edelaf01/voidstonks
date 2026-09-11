// grayscale by max channel, inverted so red theme text does not blend with background
export function maxChannelInvert(ctx, width, height) {
    if (!width || !height) return;
    const img = ctx.getImageData(0, 0, width, height);
    const px = img.data;
    for (let i = 0; i < px.length; i += 4) {
        px[i] = px[i + 1] = px[i + 2] = 255 - Math.max(px[i], px[i + 1], px[i + 2]);
    }
    ctx.putImageData(img, 0, 0);
}
