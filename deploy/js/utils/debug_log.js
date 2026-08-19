export const DEBUG_LOGS = false;

// keeps logs ON by default during an investigation without touching DEBUG_LOGS (which must stay false:
// `tests/debug-log.test.mjs` fails if deployed as true). With it on, they are silenced case by case with:
//     localStorage.setItem("vs_debug_logs", "0")   // and reload
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
