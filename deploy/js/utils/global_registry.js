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
