/**
 * Registro de funciones expuestas al ámbito global.
 *
 * POR QUÉ EXISTE: `deploy/index.html` tiene ~118 handlers inline (`onclick="foo()"`).
 * El navegador los resuelve contra `globalThis`, así que toda función invocada desde el
 * HTML tiene que estar publicada ahí — no es descuido, es el único mecanismo posible sin
 * reescribir el HTML a addEventListener. Lo mismo aplica a los scripts del scanner
 * (`live_calibration.js`, `live_grid_editor.js`), que se cargan como <script> plano y no
 * pueden importar.
 *
 * QUÉ APORTA sobre `globalThis.foo = foo`:
 *  - Un único punto por el que pasa todo lo publicado, inspeccionable en runtime
 *    (`globalThis.__vsRegistry.list()`).
 *  - Detecta COLISIONES: dos módulos publicando el mismo nombre se pisan en silencio,
 *    y el último en cargar gana. Aquí avisa por consola.
 *  - Permite que `tests/global-registry.test.mjs` cruce lo que el HTML invoca contra lo
 *    que el JS publica, y falle si un botón se queda sin su función.
 *
 * NO es un contenedor de inyección de dependencias: entre módulos se usa `import` normal.
 * Esto es solo el puente hacia el HTML y los scripts no-módulo.
 *
 * Uso:
 *     import { exposeGlobals } from "./global_registry.js";
 *     exposeGlobals({ closeScanner, captureRelics }, "scanner/scanner_controller.js");
 */

const registry = new Map(); // nombre -> módulo que lo publicó

/**
 * Publica funciones/valores en globalThis dejando constancia de quién las publicó.
 * @param {Record<string, unknown>} entries  pares nombre -> valor
 * @param {string} owner  módulo que publica (solo informativo, para diagnosticar choques)
 */
export function exposeGlobals(entries, owner = "desconocido") {
  for (const [name, value] of Object.entries(entries)) {
    const prev = registry.get(name);
    // Republicar el MISMO valor es inocuo (un módulo recargado con ?v=). Publicar un valor
    // distinto bajo un nombre ya tomado sí es un choque: el segundo gana y el primero
    // desaparece sin aviso, que es justo el fallo difícil de encontrar.
    if (prev && prev.owner !== owner && prev.value !== value) {
      console.warn(
        `[global_registry] "${name}" ya lo publicaba ${prev.owner}; ahora lo pisa ${owner}.`,
      );
    }
    registry.set(name, { owner, value });
    globalThis[name] = value;
  }
}

/** Nombres publicados, ordenados. Útil desde la consola del navegador. */
export function listGlobals() {
  return [...registry.keys()].sort();
}

/** Quién publicó un nombre dado. */
export function ownerOf(name) {
  return registry.get(name)?.owner ?? null;
}

// Punto de entrada para inspeccionar desde la consola sin importar nada.
globalThis.__vsRegistry = { list: listGlobals, ownerOf };
