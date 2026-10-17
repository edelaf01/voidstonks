// the service worker has no dom, so copying goes through an offscreen document
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
  return true;
});
