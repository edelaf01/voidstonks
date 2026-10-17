// bridges page postMessage to the extension service worker
// the manifest also matches localhost, so ev.source alone is not enough: check the origin
const ALLOWED_ORIGINS = ["https://edelaf01.github.io"];
function isAllowedOrigin(origin) {
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  try {
    const u = new URL(origin);
    return u.hostname === "localhost" || u.hostname === "127.0.0.1";
  } catch (e) {
    return false;
  }
}

window.addEventListener("message", (ev) => {
  if (ev.source !== window || !isAllowedOrigin(ev.origin) || !ev.data || ev.data.type !== "VOIDSTONKS_AUTOCOPY") return;
  chrome.runtime.sendMessage({ type: "copy", text: String(ev.data.text || "") }, (res) => {
    window.postMessage(
      {
        type: "VOIDSTONKS_AUTOCOPY_ACK",
        ok: !chrome.runtime.lastError && !!res?.ok,
        id: ev.data.id,
      },
      ev.origin
    );
  });
});

const announce = () => window.postMessage({ type: "VOIDSTONKS_AUTOCOPY_READY" }, window.location.origin);
if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", announce);
} else {
  announce();
}
