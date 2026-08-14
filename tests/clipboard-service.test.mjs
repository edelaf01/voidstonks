// Copia al portapapeles del escáner (auto-copy).
//
// El problema real: mientras se juega, la pestaña NO tiene el foco y
// navigator.clipboard.writeText falla con "Document is not focused" — el auto-copy fallaba en
// silencio. De ahí la cascada extensión -> clipboard nativo -> cola hasta recuperar el foco.
//
// Cada peldaño de esa cascada es invisible desde la UI: si uno se rompe, el usuario solo ve
// que "a veces no copia". Por eso se fijan aquí, incluido el aviso diferido, que dejó de ser
// un showToast dentro del service para que el service no dependiera del DOM.

import { test } from "node:test";
import assert from "node:assert/strict";

const ORIGIN = "https://voidstonks.pages.dev";
const listeners = {};
const enviados = [];

globalThis.window = {
  location: { origin: ORIGIN },
  addEventListener: (tipo, fn) => ((listeners[tipo] ||= []).push(fn)),
  removeEventListener: (tipo, fn) => {
    listeners[tipo] = (listeners[tipo] || []).filter((f) => f !== fn);
  },
  postMessage: (data, targetOrigin) => enviados.push({ data, targetOrigin }),
};
const disparar = (tipo, ev) => [...(listeners[tipo] || [])].forEach((fn) => fn(ev));

let escrituraFalla = false;
const escritos = [];
// defineProperty y no asignación: Node trae su propio `navigator` como getter de solo lectura.
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: {
    clipboard: {
      writeText: async (t) => {
        if (escrituraFalla) throw new Error("Document is not focused");
        escritos.push(t);
      },
    },
  },
});

const { ClipboardService } = await import("../deploy/js/services/clipboard.service.js");

test("sin extensión ni foco perdido, copia por el portapapeles nativo", async () => {
  escrituraFalla = false;
  assert.equal(await ClipboardService.copy("hola"), "clipboard");
  assert.equal(escritos.at(-1), "hola");
});

// Este es el caso que motivó todo: jugando, la pestaña no tiene foco y writeText lanza.
test("si el portapapeles rechaza por falta de foco, el texto se encola", async () => {
  escrituraFalla = true;
  assert.equal(await ClipboardService.copy("pendiente"), "queued");
});

test("al recuperar el foco se vacía la cola y se avisa por el hook", async () => {
  escrituraFalla = true;
  await ClipboardService.copy("para luego");

  let avisos = 0;
  ClipboardService.onPendingCopied = () => avisos++;

  escrituraFalla = false;
  disparar("focus");
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(escritos.at(-1), "para luego");
  assert.equal(avisos, 1, "el aviso lo pone la UI, no el service");

  // Sin nada pendiente, otro focus no vuelve a avisar.
  disparar("focus");
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(avisos, 1);
  ClipboardService.onPendingCopied = null;
});

// El hook es opcional a propósito: el service tiene que funcionar aunque nadie lo rellene
// (p. ej. si el modal del escáner no se ha cargado todavía).
test("sin hook, vaciar la cola no revienta", async () => {
  ClipboardService.onPendingCopied = null;
  escrituraFalla = true;
  await ClipboardService.copy("sin hook");
  escrituraFalla = false;
  disparar("focus");
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(escritos.at(-1), "sin hook");
});

test("la extensión se detecta por su aviso y entonces tiene prioridad", async () => {
  disparar("message", { source: globalThis.window, data: { type: "VOIDSTONKS_AUTOCOPY_READY" } });
  assert.equal(ClipboardService.extensionReady, true);

  const antes = enviados.length;
  const p = ClipboardService.copy("por extensión");
  const msg = enviados.at(-1);
  assert.equal(enviados.length, antes + 1, "debe mandarse el mensaje a la extensión");
  assert.equal(msg.data.type, "VOIDSTONKS_AUTOCOPY");
  assert.equal(msg.data.text, "por extensión");

  // targetOrigin explícito, nunca "*": el texto copiado no debe quedar expuesto a otros frames.
  assert.equal(msg.targetOrigin, ORIGIN);
  assert.notEqual(msg.targetOrigin, "*");

  disparar("message", {
    source: globalThis.window,
    data: { type: "VOIDSTONKS_AUTOCOPY_ACK", id: msg.data.id, ok: true },
  });
  assert.equal(await p, "extension");
});

// Si la extensión está instalada pero no contesta (offscreen caído), sin el timeout la copia
// se quedaría colgada para siempre y el usuario no vería ni el fallback.
test("si la extensión no contesta, se cae al portapapeles nativo", async () => {
  ClipboardService.extensionReady = true;
  escrituraFalla = false;
  const via = await ClipboardService.copy("sin respuesta"); // nadie manda el ACK
  assert.equal(via, "clipboard");
  assert.equal(escritos.at(-1), "sin respuesta");
});

test("un ACK con otro id no resuelve la copia que está esperando", async () => {
  ClipboardService.extensionReady = true;
  const p = ClipboardService.copy("id correcto");
  const msg = enviados.at(-1);

  disparar("message", {
    source: globalThis.window,
    data: { type: "VOIDSTONKS_AUTOCOPY_ACK", id: msg.data.id + 999, ok: true },
  });
  disparar("message", {
    source: globalThis.window,
    data: { type: "VOIDSTONKS_AUTOCOPY_ACK", id: msg.data.id, ok: true },
  });
  assert.equal(await p, "extension");
});

test("el service no importa nada: es lógica pura sobre APIs del navegador", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync("deploy/js/services/clipboard.service.js", "utf8");
  assert.equal(src.match(/^import /gm), null, "un service de esta capa no debe pintar ni traducir");
});
