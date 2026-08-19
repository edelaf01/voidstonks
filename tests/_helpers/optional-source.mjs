import nodeTest from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function optionalSource(url) {
  const path = fileURLToPath(url);
  const missing = !existsSync(path);
  const nombre = path.slice(path.lastIndexOf("/") + 1);
  const reason = `${nombre} no está en este clon (.gitignore); estos tests solo corren en local`;

  if (!missing) return { src: readFileSync(path, "utf8"), missing, test: nodeTest };

  const test = (name, opts, fn) =>
    typeof opts === "function"
      ? nodeTest(name, { skip: reason }, opts)
      : nodeTest(name, { ...opts, skip: reason }, fn);

  return { src: "", missing, test };
}
