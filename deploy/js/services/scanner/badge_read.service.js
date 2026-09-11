/**
 * Lectura del badge de cantidad de una celda del inventario (el "✓ 9" de la esquina).
 *
 * Fuera del bucle de scanner.service.js para poder medirlo contra capturas reales: el orden de
 * las dos pasadas se decidió a ojo y estaba al revés, y ningún test lo cubría porque todos
 * entraban por extractBadgeByColor directamente, ya con el tema correcto.
 */
import { VisionService } from "./vision.service.js";
import { OCRService } from "./ocr.service.js";

/**
 * Primero por COLOR de tema; solo si no sale dígito, por brillo.
 *
 * El orden estaba invertido porque se suponía que el brillo era el robusto "que no depende del
 * tema". Medido sobre tests/_fixtures/inventory_ballistica_banshee (16 badges) con el tema
 * correcto y con CUATRO temas equivocados a propósito: la pasada por color acierta 16/16 en
 * todos salvo azul (14/16); la de brillo, 0/16 en todos. Sus dos únicas respuestas no vacías
 * eran erróneas (5 leído "8", 2 leído "8") y, por ir primera, ganaban a la buena.
 *
 * @returns { qty, raw } — `qty` cae a 1 si no se lee ningún dígito.
 */
/**
 * Cuánto se va en badges dentro del bucle de celdas. Va aquí y no en scanner.service.js porque
 * ahí el badge se lee intercalado con el OCR y no hay frontera donde poner un cronómetro.
 * Medirlo en el NAVEGADOR es la única forma fiable: el banco offline usa un canvas cuyo
 * `drawImage` interpola en JavaScript, así que infla justo la parte que se querría mover.
 */
export const relojBadges = { ms: 0, n: 0 };

export async function leeCantidadBadge(snapshot, cell, cellW, cellH, theme) {
    const t0 = performance.now();
    try {
        return await leeBadge(snapshot, cell, cellW, cellH, theme);
    } finally {
        relojBadges.ms += performance.now() - t0;
        relojBadges.n++;
    }
}

async function leeBadge(snapshot, cell, cellW, cellH, theme) {
    const porColor = await OCRService.extractCellQuantity(null,
        VisionService.extractBadgeByColor(snapshot, cell, cellW, cellH, theme));
    if (/\d/.test(porColor.raw || "")) return porColor;

    // Respaldo: cuando la de color acierta, esto ni corre.
    const porBrillo = await OCRService.extractCellQuantity(null,
        VisionService.extractBadgeBright(snapshot, cell, cellW, cellH));
    return /\d/.test(porBrillo.raw || "") ? porBrillo : porColor;
}
