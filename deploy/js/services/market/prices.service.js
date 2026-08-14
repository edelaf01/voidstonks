/**
 * Precios de warframe.market para la UI.
 *
 * Es la pieza que faltaba para cerrar la migración que dejó `api.js` a medias. Aquel barrel
 * reexportaba la caché de precios directamente desde `repositories/`, así que cinco componentes
 * llegaban al repositorio sin que lo pareciera: el contrato de capas prohíbe ese salto y el
 * barrel lo tapaba. Al quitarlo hacía falta un intermediario de verdad, no otro alias.
 *
 * Hoy solo reexpone. Cuando haga falta política de precios que hoy no existe —descartar un
 * valor sospechoso, mezclar el precio en vivo del socket con el cacheado, decidir cuándo un
 * dato es demasiado viejo para enseñarlo— su sitio es este, no el repositorio (que solo sabe
 * de red y de IndexedDB) ni el componente (que solo sabe de pintar).
 */
export {
    MEMORY_CACHE,
    getPriceValue,
    addToQueue,
    preloadPricesToMemory,
    ensurePriceSnapshot,
} from "../../repositories/storage.repository.js";
