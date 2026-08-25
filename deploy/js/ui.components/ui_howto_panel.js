import { escapeHTML } from "../utils/escape_html.js";

/**
 * Panel de "cómo se usa", a pantalla completa y con los pasos numerados.
 *
 * Lo tenía solo el escáner de móvil, escrito dentro de MobileScanner. En escritorio se pasaba
 * del aviso de permisos a un HUD de siete botones sobre la nada, sin decir qué hacer, así que
 * se saca aquí y lo usan los dos con sus propios pasos.
 *
 * Los pasos se inyectan como HTML porque llevan <b> a propósito: salen de assets/texts.js y no
 * deben interpolar nunca nada que venga de fuera. El título y el botón sí se escapan.
 */
export function showHowToPanel({ title = "", steps = [], gotIt = "OK", onDismiss } = {}) {
    document.getElementById("scanner-howto")?.remove();

    const panel = document.createElement("div");
    panel.id = "scanner-howto";
    panel.style.cssText = "position:fixed; inset:0; background:rgba(6,10,15,0.92);"
        + " backdrop-filter:blur(8px); z-index:3000020; display:flex; flex-direction:column;"
        + " align-items:center; justify-content:center; gap:18px; padding:28px; text-align:center;"
        + " font-family:'Outfit',sans-serif;";

    const filas = steps.map((step, i) => `
      <div style="display:flex; gap:12px; align-items:flex-start; text-align:left; max-width:340px;">
        <div style="flex:0 0 22px; height:22px; border-radius:50%; background:rgba(0,229,255,0.15); border:1px solid rgba(0,229,255,0.5); color:#00e5ff; font-size:11px; font-weight:900; display:flex; align-items:center; justify-content:center;">${i + 1}</div>
        <div style="color:#dde; font-size:13px; line-height:1.5;">${step}</div>
      </div>`).join("");

    panel.innerHTML = `
      <div style="color:#00e5ff; font-weight:900; font-size:13px; letter-spacing:2px;">${escapeHTML(title)}</div>
      <div style="display:flex; flex-direction:column; gap:14px;">${filas}</div>
      <button id="scanner-howto-ok" type="button" style="margin-top:6px; background:rgba(0,229,255,0.14); border:1px solid rgba(0,229,255,0.4); color:#00e5ff; font-size:12px; font-weight:900; padding:11px 34px; border-radius:12px; cursor:pointer;">${escapeHTML(gotIt)}</button>
    `;

    panel.querySelector("#scanner-howto-ok").onclick = () => {
        panel.remove();
        onDismiss?.();
    };
    document.body.appendChild(panel);
}
