// clipboard.writeText needs a focused document, which offscreen never has
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "offscreen-copy") return;
  const ta = document.getElementById("clip");
  ta.value = msg.text;
  ta.select();
  const ok = document.execCommand("copy");
  sendResponse({ ok });
});
