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

/** A closed trade: prime parts given are taken off and received ones added. `previo` feeds undoRewardCommit. */
export function aplicaTradeo(primeInventory, { doy = [], recibo = [] } = {}) {
    const inventario = { ...primeInventory };
    const previo = new Map();
    const movidas = [];
    for (const [lista, signo] of [[doy, -1], [recibo, 1]]) {
        for (const { tipo, name, qty = 1 } of lista) {
            if (tipo !== "prime" || !name) continue;
            const antes = contadorDe(inventario[name]);
            const despues = Math.max(0, antes + signo * qty);
            if (despues === antes) continue;
            if (!previo.has(name)) previo.set(name, Object.hasOwn(inventario, name) ? inventario[name] : undefined);
            inventario[name] = despues;
            movidas.push(`${signo > 0 ? "+" : "−"}${name}${qty > 1 ? ` ×${qty}` : ""}`);
        }
    }
    return { inventario, previo, movidas };
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

/**
 * Manual pick on the rewards screen when something else was already picked. One screen gives ONE part,
 * so re-picking CHANGES the choice.
 *
 * `aplicaYa` is false when the modal syncs on close: the part is not in the inventory yet.
 */
export function pickManualReward(primeInventory, pendientes, previa, nueva, aplicaYa = true) {
    const inventario = { ...primeInventory };
    const cola = [...pendientes];
    if (previa === nueva) return { inventario, pendientes: cola, cambio: false };

    if (previa) {
        const i = cola.lastIndexOf(previa);
        if (i !== -1) cola.splice(i, 1);
        if (aplicaYa && contadorDe(inventario[previa]) > 0) inventario[previa] = contadorDe(inventario[previa]) - 1;
    }
    cola.push(nueva);
    if (aplicaYa) inventario[nueva] = contadorDe(inventario[nueva]) + 1;
    return { inventario, pendientes: cola, cambio: true };
}
