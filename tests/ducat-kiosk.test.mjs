// El kiosko de ducados: qué líneas del panel son piezas, cuándo hubo venta y cuánto se resta.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  esKioscoDucados, esDialogoVenta, parseVentaKiosco,
  KIOSCO_INICIAL, siguienteEstadoKiosco, applyDucatSale, vuelcaSesion, parseDucados,
} from "../deploy/js/utils/inventory/ducat_kiosk.js";

// Resolver de prueba: reconoce dos piezas por su primera palabra, como haría el matcher.
const resolver = (palabras) => {
  const p = palabras.join(" ").toUpperCase();
  if (p.includes("VADARYA")) return "Vadarya Prime Receiver";
  if (p.includes("BOLTOR")) return "Boltor Prime Blueprint";
  return null;
};

test("la cabecera del kiosko se reconoce con los garbles del OCR y en español", () => {
  for (const t of ["INVENTORY/DUCAT KIOSK", "INVENTORY DUCAT K1OSK", "INVENTARIO/QUIOSCO DE DUCADOS", "KI0SK"]) {
    assert.equal(esKioscoDucados(t), true, t);
  }
  assert.equal(esKioscoDucados("INVENTORY/SELL"), false);
  assert.equal(esKioscoDucados(""), false);
});

test("el diálogo de venta se reconoce en inglés y en español, y no el botón SELL PRICE", () => {
  assert.equal(esDialogoVenta("Are you sure you want to sell 2 Items for 90?"), true);
  assert.equal(esDialogoVenta("¿Seguro que quieres vender 2 objetos por 90?"), true);
  assert.equal(esDialogoVenta("SELL PRICE"), false);
  assert.equal(esDialogoVenta(""), false);
});

test("cada línea del panel da pieza, cantidad y ducados; sin 'N X' la cantidad es una", () => {
  const items = parseVentaKiosco([
    "2 X Vadarya Prime Receiver 90",
    "3x Boltor Prime Blueprint 45",
    "Vadarya Prime Receiver 45",
  ], resolver);
  assert.deepEqual(items, [
    { name: "Vadarya Prime Receiver", qty: 3, ducats: 90 },
    { name: "Boltor Prime Blueprint", qty: 3, ducats: 45 },
  ]);
});

test("las líneas sin pieza reconocida, el TOTAL y la basura se tiran", () => {
  assert.deepEqual(parseVentaKiosco(["TOTAL 90", "|| _", "2 X Nadie Sabe Que 10", ""], resolver), []);
});

test("venta: lista, diálogo, y el panel vacío dos veces seguidas", () => {
  const lista = [{ name: "Vadarya Prime Receiver", qty: 2, ducats: 90 }];
  let s = siguienteEstadoKiosco(KIOSCO_INICIAL, { items: lista, dialogo: false }).estado;
  s = siguienteEstadoKiosco(s, { items: null, dialogo: true }).estado;
  assert.equal(s.enDialogo, true);
  let r = siguienteEstadoKiosco(s, { items: [], dialogo: false });
  assert.equal(r.venta, null, "una lectura vacía sola no confirma nada");
  r = siguienteEstadoKiosco(r.estado, { items: [], dialogo: false });
  assert.deepEqual(r.venta, lista);
  assert.deepEqual(r.estado, KIOSCO_INICIAL);
});

test("con NO la lista sigue ahí y no hay venta", () => {
  const lista = [{ name: "Vadarya Prime Receiver", qty: 2, ducats: 90 }];
  let s = siguienteEstadoKiosco(KIOSCO_INICIAL, { items: lista, dialogo: false }).estado;
  s = siguienteEstadoKiosco(s, { items: null, dialogo: true }).estado;
  const r = siguienteEstadoKiosco(s, { items: lista, dialogo: false });
  assert.equal(r.venta, null);
  assert.equal(r.estado.enDialogo, false);
  assert.deepEqual(r.estado.lista, lista);
});

test("quitar las piezas a mano vacía la lista sin venta, y un frame perdido no la borra", () => {
  const lista = [{ name: "Boltor Prime Blueprint", qty: 1, ducats: 45 }];
  let s = siguienteEstadoKiosco(KIOSCO_INICIAL, { items: lista, dialogo: false }).estado;
  let r = siguienteEstadoKiosco(s, { items: [], dialogo: false });
  assert.deepEqual(r.estado.lista, lista, "la primera vacía no pisa la lista");
  r = siguienteEstadoKiosco(r.estado, { items: [], dialogo: false });
  assert.equal(r.venta, null);
  assert.deepEqual(r.estado.lista, []);
});

test("restar la venta deja el contador a 0 como mínimo y avisa de lo que no estaba", () => {
  const inv = { "Vadarya Prime Receiver": 4, "Boltor Prime Blueprint": 1 };
  const { inventario, restadas, ausentes } = applyDucatSale(inv, [
    { name: "Vadarya Prime Receiver", qty: 2 },
    { name: "Boltor Prime Blueprint", qty: 3 },
    { name: "Nadie Sabe Que", qty: 1 },
  ]);
  assert.deepEqual(inventario, { "Vadarya Prime Receiver": 2, "Boltor Prime Blueprint": 0 });
  assert.deepEqual(restadas, [
    { name: "Vadarya Prime Receiver", qty: 2, quedan: 2 },
    { name: "Boltor Prime Blueprint", qty: 1, quedan: 0 },
  ]);
  assert.deepEqual(ausentes, ["Nadie Sabe Que"]);
  assert.equal(inv["Vadarya Prime Receiver"], 4, "el inventario de entrada no se toca");
});

test("volcar la sesión pisa los contadores leídos y respeta los que no tuvieron badge", () => {
  const inv = { "Vadarya Prime Receiver": 4, "Boltor Prime Blueprint": 2 };
  const sesion = new Map([["Vadarya Prime Receiver", 2], ["Boltor Prime Blueprint", null], ["Cedo Prime Blueprint", null]]);
  assert.deepEqual(vuelcaSesion(inv, sesion), {
    "Vadarya Prime Receiver": 2,
    "Boltor Prime Blueprint": 2,
    "Cedo Prime Blueprint": 1,
  });
  assert.equal(inv["Vadarya Prime Receiver"], 4, "el inventario de entrada no se toca");
});

test("los ducados son el último número de la barra, con los iconos leídos como letras", () => {
  assert.equal(parseDucados("AP || 414,126,394 1,480 ih 9"), 9);
  assert.equal(parseDucados("$3 414,126,394 @1,480 534"), 534);
  assert.equal(parseDucados(""), null);
  assert.equal(parseDucados("sin números"), null);
});

// El diálogo dura un instante y el escáner puede estar leyendo una página justo entonces: si
// los ducados subieron lo que valía la lista, la venta cuenta aunque no se viera el diálogo.
test("sin ver el diálogo, la venta se confirma por la subida de ducados", () => {
  const lista = [{ name: "Vadarya Prime Receiver", qty: 2, ducats: 90 }];
  let s = siguienteEstadoKiosco(KIOSCO_INICIAL, { items: lista, dialogo: false, ducados: 9 }).estado;
  assert.equal(s.ducadosConLista, 9);
  let r = siguienteEstadoKiosco(s, { items: [], dialogo: false, ducados: 99 });
  r = siguienteEstadoKiosco(r.estado, { items: [], dialogo: false, ducados: 99 });
  assert.deepEqual(r.venta, lista);
  assert.equal(r.estado.ducadosConLista, 99, "el nuevo saldo es la referencia para la siguiente");
});

test("quitar las piezas a mano no sube los ducados: sin venta", () => {
  const lista = [{ name: "Vadarya Prime Receiver", qty: 2, ducats: 90 }];
  let s = siguienteEstadoKiosco(KIOSCO_INICIAL, { items: lista, dialogo: false, ducados: 9 }).estado;
  let r = siguienteEstadoKiosco(s, { items: [], dialogo: false, ducados: 9 });
  r = siguienteEstadoKiosco(r.estado, { items: [], dialogo: false, ducados: 9 });
  assert.equal(r.venta, null);
});

test("una subida de ducados muy por debajo del valor de la lista no cuenta como venta", () => {
  const lista = [{ name: "Vadarya Prime Receiver", qty: 2, ducats: 90 }];
  let s = siguienteEstadoKiosco(KIOSCO_INICIAL, { items: lista, dialogo: false, ducados: 500 }).estado;
  let r = siguienteEstadoKiosco(s, { items: [], dialogo: false, ducados: 510 }); // un dígito mal leído
  r = siguienteEstadoKiosco(r.estado, { items: [], dialogo: false, ducados: 510 });
  assert.equal(r.venta, null);
});
