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
