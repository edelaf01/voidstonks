/**
 * Overlay de depuración del escaneo de inventario: pinta sobre el recorte de la rejilla
 * lo que el escáner CREE que ha leído en cada celda, para poder diagnosticar una pasada
 * con solo una captura de pantalla.
 *
 * Todas las coordenadas de las celdas vienen en el sistema del frame completo; aquí se
 * pasan al del recorte restando el origen de la zona.
 */
export function createCellOverlay(ctx, zone, cellW, cellH) {
    // Celda resuelta. La comparten las partes prime (acento verde) y las reliquias
    // (cian): `accent` es lo único que las distingue de un vistazo.
    const drawResolved = ({ cell, name, qtyResult, text, accent, qty }) => {
        const relX = cell.sx - zone.x;
        const relY = cell.sy - zone.y;

        // Bloque opaco abajo: tapa por completo el nombre real de la tarjeta.
        ctx.fillStyle = "rgba(10, 15, 28, 0.98)";
        ctx.fillRect(relX, relY + cellH - 50, cellW, 50);
        ctx.fillStyle = accent;
        ctx.fillRect(relX, relY + cellH - 50, cellW, 1.5);

        // Lectura CRUDA del OCR (ámbar) + texto crudo del badge.
        ctx.fillStyle = "#ffb300";
        ctx.font = "italic 9px system-ui, -apple-system, sans-serif";
        const rawText = text.join(" ");
        const badgeRawText = qtyResult.raw ? qtyResult.raw.trim().replaceAll(/\s+/g, " ") : "Ø";
        const maxCharsItem = Math.floor(cellW / 5.5);
        ctx.fillText(rawText.length > maxCharsItem ? rawText.slice(0, maxCharsItem - 3) + "..." : rawText,
            relX + 6, relY + cellH - 37);
        ctx.fillText(`BDG: "${badgeRawText}"`, relX + 6, relY + cellH - 25);

        // Nombre ya casado contra el catálogo.
        ctx.fillStyle = accent;
        ctx.font = "bold 12px system-ui, -apple-system, sans-serif";
        ctx.fillText(name, relX + 6, relY + cellH - 8);

        // Píldora de cantidad justo encima del badge físico.
        const shiftLeft = (cell.c === 0) ? 14 : 2;
        ctx.fillStyle = "rgba(0, 0, 0, 0.85)";
        ctx.fillRect(relX - shiftLeft, relY + 4, 44 + (shiftLeft - 2), 18);
        ctx.fillStyle = accent;
        ctx.font = "bold 11px monospace";
        ctx.fillText(`x${qty}`, relX - shiftLeft + 8, relY + 17);

        // Recuadro del área de badge: la caja FIJA de extractBadgeBright.
        ctx.strokeStyle = accent;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(relX, cell.sy + Math.round(cellH * 0.08) - zone.y,
            Math.round(cellW * 0.40), Math.round(cellH * 0.17));
    };

    // Celda sin resolver: borde y bloque rojos. Lo comparten la que no casó con nada
    // y la descartada por no cuadrar con el tipo de página — para el inventario son
    // lo mismo. `status` va en inglés como el resto del overlay.
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
