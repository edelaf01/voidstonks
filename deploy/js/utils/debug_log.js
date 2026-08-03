export const DEBUG_LOGS = false;

const FORCE_LOGS_WHILE_DEBUGGING = true;

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
