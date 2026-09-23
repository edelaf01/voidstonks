/**
 * Muestras de rendimiento para la grabadora: heap JS, retraso del bucle de eventos y tareas
 * largas. Es lo único que el propio JS puede medir de "cuánto gasta el escáner"; la memoria de
 * los workers y de la GPU la da el administrador de tareas del navegador, no esto.
 *
 * El retraso del bucle es el CPU que nota el jugador: un timer de 100 ms que dispara a los 400
 * significa que el hilo principal estuvo 300 ms ocupado.
 */
export function creaMuestreador({ cadaMs = 10000, sondaMs = 100, ahora = () => Date.now(), programa = setTimeout, perf = globalThis.performance, Observador = globalThis.PerformanceObserver } = {}) {
    let ultima = 0, retrasoMax = 0, largasMs = 0, largasN = 0, observador = null;
    let sondaEn = 0;
    const sonda = () => {
        const t0 = ahora();
        programa(() => { retrasoMax = Math.max(retrasoMax, ahora() - t0 - sondaMs); sondaEn = 0; }, sondaMs);
    };
    if (typeof Observador === "function") {
        try {
            observador = new Observador((lista) => { for (const e of lista.getEntries()) { largasMs += e.duration; largasN++; } });
            observador.observe({ type: "longtask", buffered: true });
        } catch { observador = null; }
    }
    return {
        /** Devuelve una muestra cada `cadaMs`; entre medias lanza la sonda de retraso y devuelve null. */
        tick(meta = {}) {
            const t = ahora();
            if (!sondaEn) { sondaEn = t; sonda(); }
            if (ultima && t - ultima < cadaMs) return null;
            ultima = t;
            const m = perf?.memory;
            const muestra = {
                time: new Date(t).toISOString(),
                heapMB: m ? Math.round(m.usedJSHeapSize / 1048576) : null,
                heapTotalMB: m ? Math.round(m.totalJSHeapSize / 1048576) : null,
                retrasoMaxMs: Math.round(retrasoMax),
                tareasLargasMs: Math.round(largasMs), tareasLargas: largasN,
                ...meta,
            };
            retrasoMax = 0; largasMs = 0; largasN = 0;
            return muestra;
        },
        para() { observador?.disconnect(); observador = null; },
    };
}
