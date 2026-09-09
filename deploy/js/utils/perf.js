/**
 * Per phase stopwatch for the scanner loop. Offline numbers mislead: the test bench uses a fake canvas whose
 * `drawImage` interpolates in JavaScript, while the browser's is native.
 *
 * It goes through console.log, so in production debug_log.js silences it unless enabled with
 * localStorage.setItem("vs_debug_logs", "1").
 */
export function cronometro(etiqueta, minimoMs = 0) {
    const fases = [];
    let marca = performance.now();
    const inicio = marca;
    return {
        /** Closes the open phase and names it. */
        fase(nombre) {
            const ahora = performance.now();
            fases.push([nombre, ahora - marca]);
            marca = ahora;
        },
        /** Only prints when the frame cost something: the loop runs every 300 ms and otherwise it is noise. */
        fin(extra = "") {
            const total = performance.now() - inicio;
            if (total < minimoMs) return total;
            const detalle = fases.map(([n, ms]) => `${n} ${ms.toFixed(0)}`).join(" · ");
            console.log(`[PERF] ${etiqueta} ${total.toFixed(0)} ms = ${detalle}${extra ? ` · ${extra}` : ""}`);
            return total;
        },
    };
}
