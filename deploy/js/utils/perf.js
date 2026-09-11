// per phase stopwatch for the scanner loop
export function cronometro(etiqueta, minimoMs = 0) {
    const fases = [];
    let marca = performance.now();
    const inicio = marca;
    return {
        fase(nombre) {
            const ahora = performance.now();
            fases.push([nombre, ahora - marca]);
            marca = ahora;
        },
        // only prints when the frame cost something: the loop runs every 300 ms or it is noise
        fin(extra = "") {
            const total = performance.now() - inicio;
            if (total < minimoMs) return total;
            const detalle = fases.map(([n, ms]) => `${n} ${ms.toFixed(0)}`).join(" · ");
            console.log(`[PERF] ${etiqueta} ${total.toFixed(0)} ms = ${detalle}${extra ? ` · ${extra}` : ""}`);
            return total;
        },
    };
}
