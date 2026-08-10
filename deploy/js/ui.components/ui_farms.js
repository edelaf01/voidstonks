import { state } from "../state.js";
import { TEXTS } from "../config.js";
import { exposeGlobals } from "../utils/global_registry.js";
import { renderBountiesTab } from "./ui_bounties.js";
import {
  renderLichWeaponsTab,
  getFarmsSubview,
  setFarmsSubview,
  stopRotationTimers,
} from "./ui_lich_weapons.js";

/**
 * Farms tiene dos apartados independientes (bounties y armas en rotación) y este módulo
 * es el único que decide cuál está vivo. Vive aparte de ui_bounties.js para no meter la
 * navegación dentro del render de las misiones, y para que ninguno de los dos apartados
 * tenga que importar al otro.
 */

/** Pinta la pestaña Farms completa: subnav + el apartado activo. */
export function renderFarmsTab() {
  const view = getFarmsSubview();
  const t = TEXTS[state.currentLang];

  const bountiesPane = document.getElementById("bounties-list-container");
  const weaponsPane = document.getElementById("lich-weapons-container");
  bountiesPane?.classList.toggle("hidden", view !== "bounties");
  weaponsPane?.classList.toggle("hidden", view !== "weapons");

  document.querySelectorAll(".farms-sub-btn").forEach((btn) => {
    const active = btn.dataset.subview === view;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", String(active));
    const label = btn.dataset.subview === "weapons" ? t.lichWeapons.tab : t.farmsBountiesTab;
    const span = btn.querySelector(".farms-sub-label");
    if (span) span.textContent = label;
  });

  if (view === "weapons") {
    renderLichWeaponsTab();
  } else {
    // El contador de rotación seguiría latiendo cada segundo contra nodos ocultos.
    stopRotationTimers();
    renderBountiesTab();
  }
}

/**
 * Cambia de apartado. La elección se recuerda entre recargas: quien entra a Farms para
 * ver la rotación de armas suele volver a lo mismo.
 * @param {"bounties"|"weapons"} view
 */
export function switchFarmsSubview(view) {
  if (getFarmsSubview() === view) return;
  setFarmsSubview(view);
  renderFarmsTab();
}

exposeGlobals({ switchFarmsSubview }, "ui.components/ui_farms.js");
