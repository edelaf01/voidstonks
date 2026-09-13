/**
 * ¿Es basura lo que el OCR ha leído en una celda del inventario?
 *
 * Fuera del bucle del escáner para poder fijarlo con casos: "LITH K 2 RELIC EXCEPTIONAL" se
 * leía perfectamente y el matcher la resolvía, pero este filtro la tiraba antes por contar
 * "K" y "2" como dos fragmentos sueltos, y la reliquia salía como ilegible.
 */
export function isGarbledCellText(words) {
    if (!words || !words.length) return false;
    const tokens = words.join(" ").toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
    if (tokens.length > 8) return true;
    // Fragmentos de UN glifo: un nombre real trae como mucho uno (un código partido por el OCR,
    // "AL" + "4"). Dos o más es ruido. Un código de letra y dígito partido ("K" + "2") son dos
    // glifos seguidos pero UN fragmento: se cuentan juntos.
    let sueltos = 0;
    for (let i = 0; i < tokens.length; i++) {
        if (tokens[i].length !== 1) continue;
        sueltos++;
        if (/^[A-Z]$/.test(tokens[i]) && /^\d+$/.test(tokens[i + 1] || "")) i++;
    }
    return sueltos >= 2;
}
