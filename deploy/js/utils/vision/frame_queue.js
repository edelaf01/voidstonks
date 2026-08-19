/**
 * Cola acotada de recortes de vídeo con POOL de canvas.
 *
 * Sirve para separar SACAR la foto de PROCESARLA: capturar cuesta ~5 ms y procesar
 * una página del inventario ~1,5 s (binarizar 18 celdas + OCR), así que encadenarlos
 * obliga a esperar entre página y página. Encolando, el usuario sigue scrolleando y
 * el consumidor va vaciando por detrás.
 *
 * Dos decisiones que no se deducen del código:
 *
 * - **Pool en vez de un canvas nuevo por foto.** Un frame de 1440p son ~15 MB; el
 *   escáner ya tumbó la pestaña una vez porque los canvases se acumulaban más rápido
 *   de lo que el GC los liberaba. Reutilizando como mucho `max` buffers, la memoria
 *   queda acotada y no hay churn.
 * - **Llena = rechaza, no descarta.** Devolver false deja que el llamante NO marque
 *   la página como vista, así que se vuelve a intentar en cuanto haya sitio. Tirar la
 *   foto más vieja perdería ítems que ya no se van a volver a mirar.
 *
 * El consumidor puede ir desordenado o repetir páginas sin problema: los resultados
 * del escáner son un Map por nombre canónico y las cantidades votan por moda.
 */
export function createFrameQueue({ max = 3, process }) {
    const pool = [];
    const queue = [];
    let busy = false;

    const acquire = (w, h) => {
        const cvs = pool.pop() || document.createElement("canvas");
        // Asignar width/height borra el canvas aunque el valor no cambie: solo se toca
        // si de verdad cambió el tamaño, para reaprovechar el buffer tal cual.
        if (cvs.width !== w) cvs.width = w;
        if (cvs.height !== h) cvs.height = h;
        return cvs;
    };

    const drain = async () => {
        if (busy) return;
        busy = true;
        try {
            while (queue.length) {
                const job = queue.shift();
                try {
                    await process(job);
                } catch (e) {
                    // Un frame que revienta no puede parar la cola: se pierde ese y se sigue.
                    console.error("[FrameQueue] fallo procesando un frame:", e);
                } finally {
                    if (pool.length < max) pool.push(job.cvs);
                }
            }
        } finally {
            busy = false;
        }
    };

    return {
        get size() { return queue.length; },
        get isFull() { return queue.length >= max; },
        get isBusy() { return busy; },

        /**
         * Copia la región indicada de `source` en un canvas del pool y la encola.
         * Devuelve false si la cola está llena (el llamante debe reintentar luego).
         */
        enqueue(source, sx, sy, sw, sh, meta = null) {
            if (queue.length >= max) return false;
            const cvs = acquire(sw, sh);
            cvs.getContext("2d", { willReadFrequently: true })
                .drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);
            queue.push({ cvs, meta });
            drain();
            return true;
        },

        /** Vacía lo pendiente devolviendo los canvas al pool (cambio de pantalla, stop…). */
        clear() {
            while (queue.length) {
                const job = queue.pop();
                if (pool.length < max) pool.push(job.cvs);
            }
        },
    };
}
