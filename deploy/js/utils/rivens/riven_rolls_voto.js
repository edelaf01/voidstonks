const VENTANA = 6;

function masVotado(valores, previo) {
    const cuenta = new Map();
    for (const v of valores) cuenta.set(v, (cuenta.get(v) || 0) + 1);
    let mejor = cuenta.has(previo) ? previo : null;
    for (const [v, n] of cuenta) if (mejor === null || n > cuenta.get(mejor)) mejor = v;
    return mejor;
}

export function creaVotoRolls(ventana = VENTANA) {
    let lecturas = [];
    let previos = [];
    return (cartas) => {
        for (const c of cartas) {
            if (c?.weaponName && Number.isInteger(c.rolls)) lecturas.push({ arma: c.weaponName, rolls: c.rolls });
        }
        lecturas = lecturas.slice(-ventana);
        const salida = cartas.map((c, i) => {
            if (!c?.weaponName) return c;
            const rolls = masVotado(lecturas.filter((l) => l.arma === c.weaponName).map((l) => l.rolls), previos[i]);
            return rolls === null || rolls === c.rolls ? c : { ...c, rolls };
        });
        previos = salida.map((c) => c?.rolls ?? null);
        return salida;
    };
}
