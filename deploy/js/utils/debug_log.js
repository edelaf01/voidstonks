/**
 * Toggle global de logs de consola.
 *
 * En DESPLIEGUE debe quedar en `false`: silencia console.log / info / debug / warn
 * en toda la app (los ~136 logs de scanner, visión, etc.). `console.error` SIEMPRE
 * se conserva — los errores reales deben verse.
 *
 * Para depurar en LOCAL, o bien pon `DEBUG_LOGS = true` aquí (recuerda volver a
 * false antes de desplegar), o SIN tocar código ejecuta en la consola del navegador:
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
const enabled = DEBUG_LOGS
    || stored === "1"
    || (FORCE_LOGS_WHILE_DEBUGGING && stored !== "0");

if (!enabled && typeof console !== "undefined") {
    const noop = () => {};
    console.log = noop;
    console.info = noop;
    console.debug = noop;
    console.warn = noop;
}
