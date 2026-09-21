/**
 * Cede el hilo entre dos bloques síncronos para que el navegador pinte y atienda el input.
 *
 * Un await sobre promesa resuelta es microtarea: no repinta; hace falta una MACROTAREA. Y no
 * vale setTimeout(0): el bucle del escáner se reprograma con setTimeout, así que a partir del
 * 5º nivel anidado el navegador clampa a 4 ms y las ~30 cesiones por página de inventario eran
 * ~100 ms muertos. scheduler.yield() reanuda en cuanto se ha pintado; sin él, un MessageChannel:
 * macrotarea sin clamp. setTimeout queda de último recurso.
 */
export function creaCedeHilo({ scheduler, MessageChannel } = globalThis) {
    // `() => scheduler.yield()` y no el método suelto: desprendido del objeto lanza "Illegal invocation".
    if (typeof scheduler?.yield === "function") return () => scheduler.yield();
    if (typeof MessageChannel === "function") {
        // Canal por llamada y cerrado al llegar: uno compartido con onmessage mantiene vivo el
        // proceso de Node (los tests no terminan) y con unref() pierde el mensaje.
        return () => new Promise((resolve) => {
            const { port1, port2 } = new MessageChannel();
            port1.onmessage = () => { port1.close(); resolve(); };
            port2.postMessage(null);
        });
    }
    return () => new Promise((resolve) => setTimeout(resolve, 0));
}

export const cedeHilo = creaCedeHilo();
