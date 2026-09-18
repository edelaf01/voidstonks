/** Is what the OCR read in an inventory cell garbage? Outside the scanner loop so it can be pinned with cases. */
export function isGarbledCellText(words) {
    if (!words || !words.length) return false;
    const tokens = words.join(" ").toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
    if (tokens.length > 8) return true;
    // fragments of ONE glyph: a real name has at most one (a code split by the OCR, "AL" + "4"). Two or more is
    // noise. A split letter and digit code ("K" + "2") is two glyphs in a row but ONE fragment: counted together
    let sueltos = 0;
    for (let i = 0; i < tokens.length; i++) {
        if (tokens[i].length !== 1) continue;
        sueltos++;
        if (/^[A-Z]$/.test(tokens[i]) && /^\d+$/.test(tokens[i + 1] || "")) i++;
    }
    return sueltos >= 2;
}
