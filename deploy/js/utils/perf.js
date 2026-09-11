/**
 * Cronómetro por fases para el bucle del escáner.
 *
 * Existe porque medir offline engaña: el banco de tests usa un canvas falso cuyo `drawImage`
 * interpola en JavaScript, mientras que el del navegador es nativo. Un reparto medido ahí puede
 * salir del revés, y decidir dónde optimizar con esos números es tirar el trabajo.
 *
 * Sale por console.log, así que en producción lo silencia debug_log.js salvo que se active con
 * localStorage.setItem("vs_debug_logs", "1").
 */
export function cronometro(etiqueta, minimoMs = 0) {
    const fases = [];
    let marca = performance.now();
    const inicio = marca;
    return {
        /** Cierra la fase abierta y le pone nombre. */
        fase(nombre) {
            const ahora = performance.now();
            fases.push([nombre, ahora - marca]);
            marca = ahora;
        },
        /** Solo imprime si el frame costó algo: el bucle corre cada 300 ms y si no, es ruido. */
        fin(extra = "") {
            const total = performance.now() - inicio;
            if (total < minimoMs) return total;
            const detalle = fases.map(([n, ms]) => `${n} ${ms.toFixed(0)}`).join(" · ");
            console.log(`[PERF] ${etiqueta} ${total.toFixed(0)} ms = ${detalle}${extra ? ` · ${extra}` : ""}`);
            return total;
        },
    };
}
