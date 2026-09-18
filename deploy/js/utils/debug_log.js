/**
 * Global console log toggle.
 *
 * On DEPLOY it must stay `false`: it silences console.log / info / debug / warn app wide. `console.error` is
 * ALWAYS kept.
 *
 * To debug LOCALLY, either set `DEBUG_LOGS = true` here (only works on localhost, ignored in production), or
 * WITHOUT touching code run in the browser console:
 *     localStorage.setItem("vs_debug_logs", "1")   // and reload
 *     localStorage.removeItem("vs_debug_logs")     // to silence again
 *
 * This module must be imported FIRST in main.js so the `console` patch applies before any other module logs.
 */
export const DEBUG_LOGS = false;

// keeps logs ON by default during an investigation without touching DEBUG_LOGS (which must stay false:
// `tests/debug-log.test.mjs` fails if deployed as true). With it on, they are silenced case by case with:
//     localStorage.setItem("vs_debug_logs", "0")   // and reload
const FORCE_LOGS_WHILE_DEBUGGING = false;

const stored = typeof localStorage !== "undefined" ? localStorage.getItem("vs_debug_logs") : null;
// the CODE switches only work locally: even deployed as true, logs stay silenced on voidstonks.com. In
// production only the localStorage flag turns them on, and it belongs to each browser
const hostname = globalThis.location?.hostname ?? "";
const esLocal = hostname === "" || hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
const enabled = stored === "1"
    || (esLocal && (DEBUG_LOGS || (FORCE_LOGS_WHILE_DEBUGGING && stored !== "0")));

if (!enabled && typeof console !== "undefined") {
    const noop = () => {};
    console.log = noop;
    console.info = noop;
    console.debug = noop;
    console.warn = noop;
}
