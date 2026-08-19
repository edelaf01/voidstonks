// Los textos de la pestaña "Mis órdenes", para comprobarlos sobre el OBJETO y no contando
// apariciones en el fuente.
//
// Contar `clave:` en el .js daba 2 (ES + EN) y funcionaba... hasta que la tabla se movió a
// assets/orders_texts.js y siete tests se pusieron rojos sin que faltara ningún texto. El
// invariante real es "la clave existe en los dos idiomas y no está vacía", y ese no se rompe
// al mover código.

import assert from "node:assert/strict";
import { ORDERS_TEXTS } from "../../deploy/js/assets/orders_texts.js";

export { ORDERS_TEXTS };

export function assertBilingual(keys) {
  for (const key of keys) {
    for (const lang of ["es", "en"]) {
      const valor = ORDERS_TEXTS[lang][key];
      assert.equal(typeof valor, "string", `${key} falta en ${lang}`);
      assert.ok(valor.trim().length > 0, `${key} está vacío en ${lang}`);
    }
  }
}
