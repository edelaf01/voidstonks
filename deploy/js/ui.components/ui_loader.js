/**
 * Reusable loading indicators, styles in css/components/ui-kit.css. They return nodes, not HTML, and
 * import nothing so any module can use them without cycles.
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

// better than the spinner when the card count is known: no layout jump
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

/** `skeleton` > 0 paints that many skeletons instead of the spinner. */
export function showLoadingIn(container, { label = "", skeleton = 0 } = {}) {
  if (!container) return null;
  const node = skeleton > 0 ? createSkeletonList(skeleton) : createLoadingBlock(label);
  container.replaceChildren(node);
  return node;
}

export function setInputLoading(input, busy) {
  if (!input) return;

  let wrap = input.parentElement;
  // the wrapper is created once: moving the input in the DOM drops its focus and closes the mobile keyboard
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
