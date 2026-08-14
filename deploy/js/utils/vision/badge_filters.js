export function offBandComponentIndices(components) {
    let anchor = null;
    for (const c of components) {
        if (c.erased) continue;
        if (!anchor || c.avgLuma > anchor.avgLuma) anchor = c;
    }
    if (!anchor) return [];

    const anchorCy = (anchor.minY + anchor.maxY) / 2;
    const anchorH = anchor.height;
    const toErase = [];
    for (let i = 0; i < components.length; i++) {
        const c = components[i];
        if (c.erased || c === anchor) continue;
        const cy = (c.minY + c.maxY) / 2;
        if (Math.abs(cy - anchorCy) > 0.5 * Math.min(c.height, anchorH)) {
            toErase.push(i);
        }
    }
    return toErase;
}
