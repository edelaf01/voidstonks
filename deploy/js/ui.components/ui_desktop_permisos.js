// Permisos de la app de escritorio: se preguntan la primera vez y cuando una versión trae uno nuevo.
import { guardarPermisos } from "../services/desktop.service.js";

const bilingue = (es, en) => `<span class="lang-es">${es}</span><span class="lang-en">${en}</span>`;

const PERMISOS = [
  {
    id: "eelog",
    disponible: () => true,
    titulo: ["Leer el registro del juego (EE.log)", "Read the game log (EE.log)"],
    texto: [
      "Para saber en qué pantalla estás y qué reliquia llevas equipada. Solo se lee y no sale de tu equipo.",
      "To know which screen you are on and which relic you have equipped. It is only read and never leaves your computer.",
    ],
  },
  {
    id: "clip",
    disponible: (caps) => caps.clip,
    titulo: ["Copiar con el juego delante", "Copy while the game has focus"],
    texto: [
      "El escáner y LFG escriben el mensaje en tu portapapeles aunque la app no tenga el foco.",
      "The scanner and LFG put the message on your clipboard even when the app is not focused.",
    ],
  },
  {
    id: "overlay",
    disponible: (caps) => caps.overlay,
    titulo: ["Etiquetas encima del juego", "Labels over the game"],
    texto: [
      "Precio y ducados bajo cada tarjeta en la pantalla de recompensas, como WFInfo. No se pueden pulsar: el ratón sigue en el juego.",
      "Price and ducats under each card on the rewards screen, like WFInfo. They can't be clicked: the mouse stays in the game.",
    ],
  },
];

let modal = null;

export function abrirPermisos(caps, { alGuardar } = {}) {
  modal?.remove();
  const visibles = PERMISOS.filter((p) => p.disponible(caps));
  const marcado = (id) => (caps.pendientes?.includes(id) ? true : !!caps.permisos?.[id]);
  modal = document.createElement("div");
  modal.id = "ds-permisos";
  modal.innerHTML = `
    <div class="ds-permisos-caja" role="dialog" aria-modal="true" aria-labelledby="ds-permisos-titulo">
      <h2 id="ds-permisos-titulo">${bilingue("Permisos de la app de escritorio", "Desktop app permissions")}</h2>
      <p class="ds-permisos-intro">${bilingue(
        "Estas funciones solo existen en la versión de escritorio. Puedes cambiarlas cuando quieras desde «Permisos», abajo.",
        "These features only exist in the desktop version. You can change them any time from “Permissions” at the bottom.")}</p>
      ${visibles.map((p) => `
        <label class="ds-permiso">
          <input type="checkbox" data-permiso="${p.id}" ${marcado(p.id) ? "checked" : ""} />
          <span><strong>${bilingue(...p.titulo)}</strong><small>${bilingue(...p.texto)}</small></span>
        </label>`).join("")}
      <div class="ds-permisos-botones">
        <button type="button" class="ds-permisos-luego">${bilingue("Ahora no", "Not now")}</button>
        <button type="button" class="ds-permisos-guardar">${bilingue("Guardar", "Save")}</button>
      </div>
      <p class="ds-permisos-error" hidden>${bilingue("No se pudo guardar. ¿Sigue abierto el lanzador?", "Could not save. Is the launcher still running?")}</p>
    </div>`;
  document.body.appendChild(modal);

  modal.querySelector(".ds-permisos-luego").addEventListener("click", () => {
    modal.remove();
    modal = null;
  });
  modal.querySelector(".ds-permisos-guardar").addEventListener("click", async () => {
    // Los que no se enseñan (el sistema no los permite) también se dan por preguntados.
    const elegidos = Object.fromEntries(PERMISOS.map((p) => [p.id, false]));
    for (const caja of modal.querySelectorAll("[data-permiso]")) elegidos[caja.dataset.permiso] = caja.checked;
    if (!(await guardarPermisos(elegidos))) {
      modal.querySelector(".ds-permisos-error").hidden = false;
      return;
    }
    modal.remove();
    modal = null;
    alGuardar?.(elegidos);
  });
}
