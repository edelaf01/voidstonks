// execCommand("copy") sobre un textarea es la técnica documentada para offscreen docs:
// navigator.clipboard.writeText exige documento enfocado y aquí no lo hay nunca.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "offscreen-copy") return;
  const ta = document.getElementById("clip");
  ta.value = msg.text;
  ta.select();
  const ok = document.execCommand("copy");
  sendResponse({ ok });
});
