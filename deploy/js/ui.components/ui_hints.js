/**
 * Botón "?" con panel, y pistas de una línea. Estilos en `css/components/ui-kit.css`.
 *
 * No usa el tooltip global: `styles.css` oculta `#global-tooltip` por debajo de 768px, y
 * levantar esa regla afectaría a los ~200 tooltips de datos del resto de la app.
 */

let openPanel = null;

function closeOpenPanel() {
  if (!openPanel) return;
  openPanel.classList.remove("open");
  openPanel.__btn?.setAttribute("aria-expanded", "false");
  openPanel = null;
}

// Un solo listener para todos los "?" de la app.
document.addEventListener("click", (e) => {
  if (!openPanel) return;
  if (e.target.closest(".vs-help")) return;
  closeOpenPanel();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeOpenPanel();
});

/** `body` admite varios párrafos. Todos los textos llegan ya traducidos. */
export function createHelpButton({ title = "", body = "", label = "", align = "left" } = {}) {
  const wrap = document.createElement("span");
  wrap.className = "vs-help";

  // <button> y no <span>: sobre un elemento no interactivo el toque se pierde en táctil
  // (ver utils/tap.js), y además así entra en la navegación por teclado.
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "vs-help-btn";
  btn.textContent = "?";
  btn.setAttribute("aria-label", label || title || "?");
  btn.setAttribute("aria-expanded", "false");

  const panel = document.createElement("div");
  panel.className = `vs-help-panel vs-help-${align}`;
  panel.__btn = btn;

  if (title) {
    const h = document.createElement("div");
    h.className = "vs-help-title";
    h.textContent = title;
    panel.appendChild(h);
  }

  for (const para of Array.isArray(body) ? body : [body]) {
    if (!para) continue;
    const p = document.createElement("p");
    p.className = "vs-help-text";
    p.textContent = para;
    panel.appendChild(p);
  }

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const wasOpen = panel === openPanel;
    closeOpenPanel();
    if (!wasOpen) {
      panel.classList.add("open");
      btn.setAttribute("aria-expanded", "true");
      openPanel = panel;
    }
  });

  wrap.appendChild(btn);
  wrap.appendChild(panel);
  return wrap;
}

/**
 * `storageKey` la recuerda cerrada entre sesiones (una pista que reaparece en cada
 * búsqueda deja de ser ayuda); sin clave se muestra siempre y no lleva aspa.
 * Devuelve null si el usuario ya la descartó.
 */
export function createTip({ text, icon = "👆", storageKey = "", variant = "" } = {}) {
  if (!text) return null;
  if (storageKey && localStorage.getItem(storageKey) === "1") return null;

  const tip = document.createElement("div");
  tip.className = `vs-tip${variant ? ` vs-tip-${variant}` : ""}`;
  tip.setAttribute("role", "note");

  const ico = document.createElement("span");
  ico.className = "vs-tip-icon";
  ico.textContent = icon;
  ico.setAttribute("aria-hidden", "true");

  const txt = document.createElement("span");
  txt.className = "vs-tip-text";
  txt.textContent = text;

  tip.appendChild(ico);
  tip.appendChild(txt);

  if (storageKey) {
    const close = document.createElement("button");
    close.type = "button";
    close.className = "vs-tip-close";
    close.textContent = "×";
    close.setAttribute("aria-label", "OK");
    close.addEventListener("click", (e) => {
      e.stopPropagation();
      localStorage.setItem(storageKey, "1");
      tip.remove();
    });
    tip.appendChild(close);
  }

  return tip;
}
