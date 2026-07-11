// Puente página <-> extensión. La web no puede hablar con chrome.runtime directamente,
// así que la app manda postMessage a su propia ventana y este content script lo reenvía
// al service worker. El ACK vuelve por el mismo canal con el id de la petición.
//
// SEGURIDAD: el manifest inyecta este script también en localhost/127.0.0.1 (cualquier
// puerto) para desarrollo, así que ev.source === window NO basta: cualquier app local
// podría postMessage y escribir el portapapeles del usuario vía el puente. Validamos
// además ev.origin contra una allowlist (dominio de producción + loopback de dev) antes
// de reenviar nada al service worker. Es la defensa principal frente al manifest amplio.
const ALLOWED_ORIGINS = ["https://edelaf01.github.io"];
function isAllowedOrigin(origin) {
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  try {
    const u = new URL(origin);
    // Solo loopback para el flujo de desarrollo local (cualquier puerto).
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
      // ACK devuelto solo al origen que lo pidió (ya validado), no a "*".
      ev.origin
    );
  });
});

// Señal de presencia: la app solo intenta la vía extensión si ha visto este mensaje.
// Restringido al propio origen de la página (no "*") para no filtrarlo a frames de terceros.
const announce = () => window.postMessage({ type: "VOIDSTONKS_AUTOCOPY_READY" }, window.location.origin);
if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", announce);
} else {
  announce();
}
