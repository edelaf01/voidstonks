/**
 * Pide el mercado de las tarjetas cuando se acercan a la pantalla: cada ítem sin caché cuesta dos peticiones a
 * warframe.market, y en una lista larga casi nada se llega a ver. Las tandas van de una en una.
 */
export function mercadoAlVerse(pide, { margen = "400px", esperaMs = 120 } = {}) {
    const cola = new Set();
    let timer = null;
    let cadena = Promise.resolve();
    const lanza = () => {
        timer = null;
        const slugs = [...cola];
        cola.clear();
        cadena = cadena.then(() => pide(slugs)).catch(() => {});
    };
    const apunta = (slug) => {
        cola.add(slug);
        timer ??= setTimeout(lanza, esperaMs);
    };
    const obs = typeof IntersectionObserver === "function"
        ? new IntersectionObserver((entradas) => {
            for (const e of entradas) {
                if (!e.isIntersecting) continue;
                obs.unobserve(e.target);
                apunta(e.target.dataset.slug);
            }
        }, { rootMargin: margen })
        : null;
    return {
        observa(tarjetas) {
            obs?.disconnect();
            for (const t of tarjetas) {
                if (!t.dataset?.slug) continue;
                if (obs) obs.observe(t);
                else apunta(t.dataset.slug);
            }
        },
    };
}
