/** Adds mission end rewards to the Prime parts inventory. */

/** The stored counter, sanitized. A hand import can leave "5": "5"+1 gave "51". */
const contadorDe = (valor) => (Number.isFinite(Number(valor)) ? Number(valor) : 0);

/** `previo` keeps just enough to undo; `pendientes` are the ones the user already logged. */
export function applyRewardCommit(primeInventory, items, pendingManualAdds = []) {
    const inventario = { ...primeInventory };
    const previo = new Map();
    const anadidas = [];
    const pendientes = [...pendingManualAdds];

    for (const item of items || []) {
        const name = item?.name;
        if (!name) continue;

        // 0, negative or NaN corrupt the counter (NaN is stored as null)
        const qty = Math.floor(Number(item.qty ?? 1));
        if (!(qty > 0)) continue;

        // already counted when picked, but only ONE copy: with "×3" the other two are the squad's
        const manual = pendientes.indexOf(name);
        if (manual !== -1) pendientes.splice(manual, 1);
        const suma = manual === -1 ? qty : qty - 1;
        if (suma <= 0) continue;

        // saved if the key EXISTED: the real inventory has parts at 0
        if (!previo.has(name)) {
            previo.set(name, Object.hasOwn(inventario, name) ? inventario[name] : undefined);
        }
        inventario[name] = contadorDe(inventario[name]) + suma;
        anadidas.push(suma > 1 ? `${name} ×${suma}` : name);
    }
    return { inventario, previo, anadidas, pendientes };
}

/** Puts the inventory back as it was before the add (the "undo" button). */
export function undoRewardCommit(primeInventory, previo) {
    const inventario = { ...primeInventory };
    for (const [name, valor] of previo) {
        // undefined = the key was not there; leaving it at 0 would show it in the list
        if (valor === undefined) delete inventario[name];
        else inventario[name] = valor;
    }
    return inventario;
}
