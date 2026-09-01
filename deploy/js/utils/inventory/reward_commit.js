/** Alta de las recompensas de fin de misión en el inventario de piezas Prime. */

/** El contador guardado, saneado. Un import a mano puede dejar un "5": "5"+1 daba "51". */
const contadorDe = (valor) => (Number.isFinite(Number(valor)) ? Number(valor) : 0);

/** `previo` guarda lo justo para deshacer; `pendientes` son las que el usuario ya se apuntó. */
export function applyRewardCommit(primeInventory, items, pendingManualAdds = []) {
    const inventario = { ...primeInventory };
    const previo = new Map();
    const anadidas = [];
    const pendientes = [...pendingManualAdds];

    for (const item of items || []) {
        const name = item?.name;
        if (!name) continue;

        // Un 0, un negativo o un NaN dejan el contador corrupto (NaN se guarda como null).
        const qty = Math.floor(Number(item.qty ?? 1));
        if (!(qty > 0)) continue;

        // Ya contada al elegirla, pero solo UNA copia: con "×3" las otras dos son de la escuadra.
        const manual = pendientes.indexOf(name);
        if (manual !== -1) pendientes.splice(manual, 1);
        const suma = manual === -1 ? qty : qty - 1;
        if (suma <= 0) continue;

        // Se guarda si la clave EXISTÍA: el inventario real trae piezas a 0 y borrarlas al
        // deshacer no deja lo que había.
        if (!previo.has(name)) {
            previo.set(name, Object.hasOwn(inventario, name) ? inventario[name] : undefined);
        }
        inventario[name] = contadorDe(inventario[name]) + suma;
        anadidas.push(suma > 1 ? `${name} ×${suma}` : name);
    }
    return { inventario, previo, anadidas, pendientes };
}

/** Devuelve el inventario al estado que tenía antes del alta (el botón "deshacer"). */
export function undoRewardCommit(primeInventory, previo) {
    const inventario = { ...primeInventory };
    for (const [name, valor] of previo) {
        // undefined = la clave no estaba; dejarla a 0 la haría aparecer en la lista.
        if (valor === undefined) delete inventario[name];
        else inventario[name] = valor;
    }
    return inventario;
}
