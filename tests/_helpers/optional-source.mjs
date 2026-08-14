// sources that exist on the repo owner's machine but not in a clone: `worker-code.js` and the ML API cache are gitignored
// without this the suite went red right after cloning, since a top-level readFileSync failed the whole file

import nodeTest from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * reads an optional source and returns the `test` that file must use
 * when the source is missing, everything registered with that `test` is skipped with a readable reason
 * @param {URL} url
 */
export function optionalSource(url) {
  const path = fileURLToPath(url);
  const missing = !existsSync(path);
  const nombre = path.slice(path.lastIndexOf("/") + 1);
  const reason = `${nombre} no está en este clon (.gitignore); estos tests solo corren en local`;

  if (!missing) return { src: readFileSync(path, "utf8"), missing, test: nodeTest };

  // same signature as node:test: test(name, fn) or test(name, options, fn)
  const test = (name, opts, fn) =>
    typeof opts === "function"
      ? nodeTest(name, { skip: reason }, opts)
      : nodeTest(name, { ...opts, skip: reason }, fn);

  return { src: "", missing, test };
}
