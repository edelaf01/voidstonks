// texts of the "My orders" tab, checked on the OBJECT instead of counting matches in the source
// the real invariant is "the key exists in both languages and is not empty"

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
