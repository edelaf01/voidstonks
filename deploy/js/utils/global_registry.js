// registers globals for inline HTML handlers and scripts with collision detection

const registry = new Map();

export function exposeGlobals(entries, owner = "desconocido") {
  for (const [name, value] of Object.entries(entries)) {
    const prev = registry.get(name);
    // republishing the same value is harmless on module reload, only a different value collides
    if (prev && prev.owner !== owner && prev.value !== value) {
      console.warn(
        `[global_registry] "${name}" ya lo publicaba ${prev.owner}; ahora lo pisa ${owner}.`,
      );
    }
    registry.set(name, { owner, value });
    globalThis[name] = value;
  }
}

export function listGlobals() {
  return [...registry.keys()].sort();
}

export function ownerOf(name) {
  return registry.get(name)?.owner ?? null;
}

globalThis.__vsRegistry = { list: listGlobals, ownerOf };
