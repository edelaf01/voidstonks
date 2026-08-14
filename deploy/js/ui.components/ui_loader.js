/**
 * Indicadores de carga reutilizables. Estilos en `css/components/ui-kit.css`.
 *
 * Devuelven nodos, no HTML: se insertan sobre contenido existente sin recrearlo y ningún
 * texto puede acabar interpretado como markup. Sin imports a propósito, para que cualquier
 * módulo pueda usarlo sin arriesgar ciclos.
 */

export function createSpinner(size = "md") {
  const el = document.createElement("span");
  el.className = `vs-spinner vs-spinner-${size}`;
  el.setAttribute("aria-hidden", "true");
  return el;
}

export function createLoadingBlock(label = "") {
  const box = document.createElement("div");
  box.className = "vs-loading-block";
  box.setAttribute("role", "status");
  box.setAttribute("aria-live", "polite");
  box.appendChild(createSpinner("md"));
  if (label) {
    const txt = document.createElement("span");
    txt.className = "vs-loading-label";
    txt.textContent = label;
    box.appendChild(txt);
  }
  return box;
}

// Preferible al spinner cuando ya se sabe cuántas tarjetas van a aparecer: al sustituirlos
// no hay salto de layout.
export function createSkeletonList(count = 3) {
  const wrap = document.createElement("div");
  wrap.className = "vs-skeleton-list";
  wrap.setAttribute("aria-hidden", "true");
  for (let i = 0; i < count; i++) {
    const row = document.createElement("div");
    row.className = "vs-skeleton-row";

    const icon = document.createElement("span");
    icon.className = "vs-skeleton-icon";

    const lines = document.createElement("div");
    lines.className = "vs-skeleton-lines";
    for (const cls of ["vs-skeleton-line wide", "vs-skeleton-line"]) {
      const line = document.createElement("span");
      line.className = cls;
      lines.appendChild(line);
    }

    row.appendChild(icon);
    row.appendChild(lines);
    wrap.appendChild(row);
  }
  return wrap;
}

/** `skeleton` > 0 pinta ese número de esqueletos en vez del spinner. */
export function showLoadingIn(container, { label = "", skeleton = 0 } = {}) {
  if (!container) return null;
  const node = skeleton > 0 ? createSkeletonList(skeleton) : createLoadingBlock(label);
  container.replaceChildren(node);
  return node;
}

export function setInputLoading(input, busy) {
  if (!input) return;

  let wrap = input.parentElement;
  // El envoltorio se crea una vez y se conserva: recrearlo en cada tecla mueve el input
  // en el DOM, y al moverlo el navegador le quita el foco y cierra el teclado en móvil.
  if (!wrap || !wrap.classList.contains("vs-input-loading")) {
    wrap = document.createElement("div");
    wrap.className = "vs-input-loading";
    input.parentElement?.insertBefore(wrap, input);
    wrap.appendChild(input);
    const spinner = createSpinner("sm");
    spinner.classList.add("vs-input-spinner");
    wrap.appendChild(spinner);
  }
  wrap.classList.toggle("is-busy", !!busy);
  input.setAttribute("aria-busy", busy ? "true" : "false");
}
