import { test } from "node:test";
import assert from "node:assert/strict";

// El módulo debug_log.js parchea `console` AL IMPORTARSE según DEBUG_LOGS (false en
// despliegue) o el flag localStorage. Como el efecto es al cargar el módulo y se
// cachea, cada caso usa un query-string distinto para forzar una evaluación fresca.
// Detección por IDENTIDAD: ponemos un spy propio en console.* antes de importar; si
// el módulo silencia, lo reemplaza por su noop (!= spy); si no, lo deja intacto (== spy).

// TEMPORAL (diagnóstico del cuelgue del escáner): con FORCE_LOGS_WHILE_DEBUGGING = true
// los logs pasan por defecto, así que sin localStorage ya NO se silencia. El silenciado
// se sigue verificando con el opt-out explícito ("0"), que es el camino que quedará
// cuando se retire el override. `console.error` intacto en todos los casos.
test("vs_debug_logs=0 (opt-out): silencia log/info/debug/warn, conserva error", async () => {
  const orig = { log: console.log, info: console.info, debug: console.debug, warn: console.warn, error: console.error };
  const spyLog = () => {}, spyErr = () => {};
  console.log = console.info = console.debug = console.warn = spyLog;
  console.error = spyErr;
  globalThis.localStorage = { getItem: (k) => (k === "vs_debug_logs" ? "0" : null) };

  await import("../deploy/js/utils/debug_log.js?case=off");
  const patched = { log: console.log, warn: console.warn, error: console.error };
  Object.assign(console, orig); // restaurar antes de asertar (no romper el runner)
  delete globalThis.localStorage;

  assert.notEqual(patched.log, spyLog, "console.log debe quedar parcheado a noop");
  assert.notEqual(patched.warn, spyLog, "console.warn debe quedar parcheado a noop");
  assert.equal(patched.error, spyErr, "console.error NUNCA debe tocarse");
});

test("localStorage vs_debug_logs=1: no toca console (logs pasan)", async () => {
  const orig = { log: console.log };
  const spyLog = () => {};
  console.log = spyLog;
  globalThis.localStorage = { getItem: (k) => (k === "vs_debug_logs" ? "1" : null) };

  await import("../deploy/js/utils/debug_log.js?case=on");
  const after = console.log;
  Object.assign(console, orig);
  delete globalThis.localStorage;

  assert.equal(after, spyLog, "con el flag activo console.log no debe parchearse");
});

test("DEBUG_LOGS es false por defecto (no dejar logs en despliegue)", async () => {
  const { DEBUG_LOGS } = await import("../deploy/js/utils/debug_log.js?case=const");
  assert.equal(DEBUG_LOGS, false, "DEBUG_LOGS debe estar en false para no filtrar logs a producción");
});
