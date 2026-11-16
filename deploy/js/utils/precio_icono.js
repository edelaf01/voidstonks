const conIcono = (icono) => (n, clase = "") => {
  const span = Object.assign(document.createElement("span"), { className: clase, textContent: n == null ? "" : String(n) });
  if (n != null) {
    const ico = Object.assign(document.createElement("span"), { className: icono });
    ico.setAttribute("aria-hidden", "true");
    span.appendChild(ico);
  }
  return span;
};

export const fmtPlat = conIcono("plat-icon-inline");
export const fmtDuc = conIcono("ducat-icon-inline");
