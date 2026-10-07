/**
 * Registry of functions exposed to the global scope.
 *
 * `deploy/index.html` has inline handlers (`onclick="foo()"`) the browser resolves against `globalThis`, so
 * every function called from the HTML has to be published there. The same goes for the scanner scripts
 * (`live_calibration.js`), loaded as plain <script> and unable to import.
 *
 * Over `globalThis.foo = foo` it adds:
 *  - One point everything published goes through, inspectable at runtime (`globalThis.__vsRegistry.list()`).
 *  - COLLISION detection: two modules publishing the same name overwrite each other silently and the last
 *    one to load wins. Here it warns on the console.
 *  - `tests/global-registry.test.mjs` can cross what the HTML calls with what the JS publishes, and fail when
 *    a button is left without its function.
 *
 * It is NOT a dependency injection container: modules use plain `import`. This is only the bridge to the HTML
 * and non module scripts.
 *
 * Usage:
 *     import { exposeGlobals } from "./global_registry.js";
 *     exposeGlobals({ switchTab, changeLanguage }, "main.js");
 */

const registry = new Map(); // name -> module that published it

/**
 * Publishes functions/values on globalThis keeping track of who published them.
 * @param {Record<string, unknown>} entries  name -> value pairs
 * @param {string} owner  publishing module (informative only, to diagnose collisions)
 */
export function exposeGlobals(entries, owner = "desconocido") {
  for (const [name, value] of Object.entries(entries)) {
    const prev = registry.get(name);
    // republishing the SAME value is harmless (a module reloaded with ?v=). A different value under a taken name
    // is a collision: the second wins and the first disappears without notice
    if (prev && prev.owner !== owner && prev.value !== value) {
      console.warn(
        `[global_registry] "${name}" ya lo publicaba ${prev.owner}; ahora lo pisa ${owner}.`,
      );
    }
    registry.set(name, { owner, value });
    globalThis[name] = value;
  }
}

/** Published names, sorted. Handy from the browser console. */
export function listGlobals() {
  return [...registry.keys()].sort();
}

/** Who published a given name. */
export function ownerOf(name) {
  return registry.get(name)?.owner ?? null;
}

// entry point to inspect from the console without importing anything
globalThis.__vsRegistry = { list: listGlobals, ownerOf };
