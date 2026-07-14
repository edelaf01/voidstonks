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

const enabled = DEBUG_LOGS
    || (typeof localStorage !== "undefined" && localStorage.getItem("vs_debug_logs") === "1");

if (!enabled && typeof console !== "undefined") {
    const noop = () => {};
    console.log = noop;
    console.info = noop;
    console.debug = noop;
    console.warn = noop;
}
