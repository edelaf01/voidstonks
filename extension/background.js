// El service worker no tiene DOM ni puede escribir el portapapeles; delega en un
// documento offscreen (razón CLIPBOARD), que es la vía soportada en MV3 para copiar
// SIN que la ventana del navegador tenga el foco (el caso real: el juego enfocado).
async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["CLIPBOARD"],
    justification: "Copiar resultados del scanner al portapapeles mientras el juego tiene el foco.",
  });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "copy") return;
  (async () => {
    try {
      await ensureOffscreen();
      const res = await chrome.runtime.sendMessage({ type: "offscreen-copy", text: msg.text });
      sendResponse({ ok: !!res?.ok });
    } catch (e) {
      sendResponse({ ok: false, error: String(e) });
    }
  })();
  return true; // respuesta asíncrona
});
