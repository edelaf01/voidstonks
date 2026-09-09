// adds mission end rewards to the prime parts inventory

const contadorDe = (valor) => (Number.isFinite(Number(valor)) ? Number(valor) : 0);

export function applyRewardCommit(primeInventory, items, pendingManualAdds = []) {
    const inventario = { ...primeInventory };
    const previo = new Map();
    const anadidas = [];
    const pendientes = [...pendingManualAdds];

    for (const item of items || []) {
        const name = item?.name;
        if (!name) continue;

        const qty = Math.floor(Number(item.qty ?? 1));
        if (!(qty > 0)) continue;

        // already counted when picked, but only one copy: with "×3" the other two are the squad's
        const manual = pendientes.indexOf(name);
        if (manual !== -1) pendientes.splice(manual, 1);
        const suma = manual === -1 ? qty : qty - 1;
        if (suma <= 0) continue;

        if (!previo.has(name)) {
            previo.set(name, Object.hasOwn(inventario, name) ? inventario[name] : undefined);
        }
        inventario[name] = contadorDe(inventario[name]) + suma;
        anadidas.push(suma > 1 ? `${name} ×${suma}` : name);
    }
    return { inventario, previo, anadidas, pendientes };
}

export function undoRewardCommit(primeInventory, previo) {
    const inventario = { ...primeInventory };
    for (const [name, valor] of previo) {
        if (valor === undefined) delete inventario[name];
        else inventario[name] = valor;
    }
    return inventario;
}

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
