/**
 * Toggle global de logs de consola.
 *
 * En DESPLIEGUE debe quedar en `false`: silencia console.log / info / debug / warn
 * en toda la app (los ~136 logs de scanner, visión, etc.). `console.error` SIEMPRE
 * se conserva — los errores reales deben verse.
 *
 * Para depurar en LOCAL, o bien pon `DEBUG_LOGS = true` aquí (solo tiene efecto en
 * localhost: en producción se ignora), o SIN tocar código ejecuta en la consola del navegador:
 *     localStorage.setItem("vs_debug_logs", "1")   // y recarga
 *     localStorage.removeItem("vs_debug_logs")     // para volver a silenciar
 *
 * Este módulo debe importarse EL PRIMERO en main.js para que el parche de `console`
 * se aplique antes de que cualquier otro módulo llegue a loguear.
 */
export const DEBUG_LOGS = false;

// Interruptor para dejar los logs ACTIVOS por defecto durante una investigación, sin tocar
// DEBUG_LOGS (que debe seguir en false: `tests/debug-log.test.mjs` falla si se despliega en
// true, y esa guarda vale la pena conservarla). En false, que es lo normal en producción.
// Con él puesto, se silencian caso por caso con:
//     localStorage.setItem("vs_debug_logs", "0")   // y recarga
const FORCE_LOGS_WHILE_DEBUGGING = false;

const stored = typeof localStorage !== "undefined" ? localStorage.getItem("vs_debug_logs") : null;
// Los interruptores de CÓDIGO solo valen en local: aunque se despliegue con uno en true, en
// voidstonks.com los logs siguen silenciados. En producción solo enciende el flag de
// localStorage, que es de cada navegador y no se despliega.
const hostname = globalThis.location?.hostname ?? "";
const esLocal = hostname === "" || hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
const enabled = stored === "1"
    || (esLocal && (DEBUG_LOGS || (FORCE_LOGS_WHILE_DEBUGGING && stored !== "0")));
/** El mismo interruptor para lo demás que es de depurar (la grabadora del escáner): en producción, apagado. */
export const DEBUG_ACTIVO = enabled;

if (!enabled && typeof console !== "undefined") {
    const noop = () => {};
    console.log = noop;
    console.info = noop;
    console.debug = noop;
    console.warn = noop;
}
