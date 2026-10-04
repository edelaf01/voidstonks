// global console log toggle that silences logs on deploy and keeps console.error
export const DEBUG_LOGS = false;

const FORCE_LOGS_WHILE_DEBUGGING = false;

const stored = typeof localStorage !== "undefined" ? localStorage.getItem("vs_debug_logs") : null;
// code switches only work locally: in production only the localStorage flag turns logs on
const hostname = globalThis.location?.hostname ?? "";
const esLocal = hostname === "" || hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
const enEscritorio = hostname === "voidstonks.localhost";
const enabled = stored === "1"
    || (esLocal && (DEBUG_LOGS || (FORCE_LOGS_WHILE_DEBUGGING && stored !== "0")));
export const DEBUG_ACTIVO = enabled;

if (!enabled && !enEscritorio && typeof console !== "undefined") {
    const noop = () => {};
    console.log = noop;
    console.info = noop;
    console.debug = noop;
    console.warn = noop;
}
