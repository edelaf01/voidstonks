// Fuentes que existen en la máquina del dueño del repo pero no en un clon.
//
// `worker-code.js` y el cache de la API de ML están en .gitignore a propósito, y siete
// ficheros de test los leen. Al versionar tests/ eso dejaba la suite en rojo nada más clonar:
// los tests que leen en top-level ni siquiera llegaban a ejecutarse, porque el readFileSync
// petaba al importar el módulo y node --test contaba el fichero entero como fallo.
//
// La alternativa —publicar worker-code.js— se descartó: no tiene secretos literales (todo
// sale de bindings env.*), pero expone endpoints, allowlists y política de caché del backend.

import nodeTest from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Lee un fuente opcional y devuelve, junto a él, el `test` que debe usar ese fichero.
 *
 * Si el fuente no está, `test` marca como skip TODO lo que se registre con él, con un motivo
 * legible en la salida. Se salta el fichero entero y no solo los casos que tocan ese fuente:
 * distinguirlos exigiría anotar los ~126 tests uno a uno, y el caso solo se da en un clon.
 *
 * @param {URL} url  ruta del fuente, normalmente `new URL("../worker-code.js", import.meta.url)`
 */
export function optionalSource(url) {
  const path = fileURLToPath(url);
  const missing = !existsSync(path);
  const nombre = path.slice(path.lastIndexOf("/") + 1);
  const reason = `${nombre} no está en este clon (.gitignore); estos tests solo corren en local`;

  if (!missing) return { src: readFileSync(path, "utf8"), missing, test: nodeTest };

  // Misma firma que node:test — test(nombre, fn) o test(nombre, opciones, fn).
  const test = (name, opts, fn) =>
    typeof opts === "function"
      ? nodeTest(name, { skip: reason }, opts)
      : nodeTest(name, { ...opts, skip: reason }, fn);

  return { src: "", missing, test };
}
