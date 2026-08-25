/**
 * Debug overlay of the inventory scan: paints over the grid crop what the scanner THINKS it read in each cell,
 * to diagnose a pass with a single screenshot. Cell coordinates come in full frame space and are moved to the
 * crop by subtracting the zone origin.
 */
export function createCellOverlay(ctx, zone, cellW, cellH) {
    // resolved cell, shared by prime parts (green accent) and relics (cyan): `accent` is the only difference
    const drawResolved = ({ cell, name, qtyResult, text, accent, qty }) => {
        const relX = cell.sx - zone.x;
        const relY = cell.sy - zone.y;

        // opaque block at the bottom: fully covers the card's real name
        ctx.fillStyle = "rgba(10, 15, 28, 0.98)";
        ctx.fillRect(relX, relY + cellH - 50, cellW, 50);
        ctx.fillStyle = accent;
        ctx.fillRect(relX, relY + cellH - 50, cellW, 1.5);

        // RAW OCR read (amber) + raw badge text
        ctx.fillStyle = "#ffb300";
        ctx.font = "italic 9px system-ui, -apple-system, sans-serif";
        const rawText = text.join(" ");
        const badgeRawText = qtyResult.raw ? qtyResult.raw.trim().replaceAll(/\s+/g, " ") : "Ø";
        const maxCharsItem = Math.floor(cellW / 5.5);
        ctx.fillText(rawText.length > maxCharsItem ? rawText.slice(0, maxCharsItem - 3) + "..." : rawText,
            relX + 6, relY + cellH - 37);
        ctx.fillText(`BDG: "${badgeRawText}"`, relX + 6, relY + cellH - 25);

        // name already matched against the catalog
        ctx.fillStyle = accent;
        ctx.font = "bold 12px system-ui, -apple-system, sans-serif";
        ctx.fillText(name, relX + 6, relY + cellH - 8);

        // quantity pill right above the physical badge
        const shiftLeft = (cell.c === 0) ? 14 : 2;
        ctx.fillStyle = "rgba(0, 0, 0, 0.85)";
        ctx.fillRect(relX - shiftLeft, relY + 4, 44 + (shiftLeft - 2), 18);
        ctx.fillStyle = accent;
        ctx.font = "bold 11px monospace";
        ctx.fillText(`x${qty}`, relX - shiftLeft + 8, relY + 17);

        // badge area box: the FIXED box of extractBadgeBright
        ctx.strokeStyle = accent;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(relX, cell.sy + Math.round(cellH * 0.08) - zone.y,
            Math.round(cellW * 0.40), Math.round(cellH * 0.17));
    };

    // unresolved cell: red border and block, shared by the one that matched nothing and the one dropped for not
    // fitting the page type. `status` stays in English like the rest of the overlay
    const drawFailed = ({ cell, text, line2, status }) => {
        const relX = cell.sx - zone.x;
        const relY = cell.sy - zone.y;
        ctx.strokeStyle = "rgba(255, 30, 80, 0.6)";
        ctx.lineWidth = 2;
        ctx.strokeRect(relX + 2, relY + 2, cellW - 4, cellH - 4);
        ctx.fillStyle = "rgba(25, 10, 15, 0.98)";
        ctx.fillRect(relX, relY + cellH - 50, cellW, 50);
        ctx.fillStyle = "rgba(255, 30, 80, 0.7)";
        ctx.fillRect(relX, relY + cellH - 50, cellW, 1.5);
        ctx.fillStyle = "#ff5252";
        ctx.font = "italic 9px system-ui, -apple-system, sans-serif";
        const maxCharsItem = Math.floor(cellW / 5.5);
        ctx.fillText(text.length > maxCharsItem ? text.slice(0, maxCharsItem - 3) + "..." : text,
            relX + 6, relY + cellH - 37);
        ctx.fillText(line2, relX + 6, relY + cellH - 25);
        ctx.fillStyle = "#8c9eff";
        ctx.font = "bold 12px system-ui, -apple-system, sans-serif";
        ctx.fillText(status, relX + 6, relY + cellH - 8);
    };

    return { drawResolved, drawFailed };
}
