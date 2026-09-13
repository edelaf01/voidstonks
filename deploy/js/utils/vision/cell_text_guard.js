// detects whether OCR text read in an inventory cell is garbage
export function isGarbledCellText(words) {
    if (!words || !words.length) return false;
    const tokens = words.join(" ").toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
    if (tokens.length > 8) return true;
    // a real name has at most one single-glyph fragment ("AL" + "4"), two or more is noise
    let sueltos = 0;
    for (let i = 0; i < tokens.length; i++) {
        if (tokens[i].length !== 1) continue;
        sueltos++;
        if (/^[A-Z]$/.test(tokens[i]) && /^\d+$/.test(tokens[i + 1] || "")) i++;
    }
    return sueltos >= 2;
}
