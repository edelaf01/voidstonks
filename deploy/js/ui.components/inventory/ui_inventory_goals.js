import { state } from "../../state.js";
import { DROP_CHANCES } from "../../config.js";
import { getSetName, getRequiredCount } from "../../utils/ui_utils.js";
import { relicSetValue, describeRelicRuns } from "../../utils/inventory/relic_set_value.js";
import { escapeHTML } from "../ui_components.js";
import { exposeGlobals } from "../../utils/global_registry.js";

/**
 * Chips de OBJETIVO del inventario de reliquias: qué quieres sacar de abrirlas, no qué
 * métrica ordenar. Salieron de ui_inventory.js, que ya lleva tres áreas dentro (reliquias,
 * piezas prime y Ducanator) y no admite más.
 */

// Rótulos de los chips y de la etiqueta de fila. Bilingües como toda la UI, y aquí y no en
// TEXTS porque solo los usa este módulo (config.js ya arrastra 3.100 líneas de deuda).
const T = {
    es: { sets: "Runs a set", plat: "Plat/run", ducats: "Ducados/run", ratio: "Ducados por plat",
        recent: "Recientes", onlyActive: "Solo farmeables (no vaulted)", lastPart: "última pieza",
        missing: "faltan", nothing: "nada que te falte", runs: "runs" },
    en: { sets: "Runs to set", plat: "Plat/run", ducats: "Ducats/run", ratio: "Ducats per plat",
        recent: "Recent", onlyActive: "Farmable only (not vaulted)", lastPart: "last part",
        missing: "missing", nothing: "nothing you need", runs: "runs" },
};
const texts = () => T[state.currentLang === "es" ? "es" : "en"];

/**
 * Lo que aporta una reliquia a tus sets. Lo que te FALTA sale del inventario de PIEZAS
 * PRIME; las copias de la reliquia solo pesan en `odds` (12 copias hacen casi seguro lo
 * que con 1 es una tirada suelta).
 */
function relicRuns(relicName, stock) {
    return relicSetValue(state.relicsDatabase[relicName], {
        setsDatabase: state.setsDatabase, primeInventory: state.primeInventory,
        getSetName, getRequiredCount, stock,
        dropChances: DROP_CHANCES[state.refinement] || DROP_CHANCES.Rad,
        squadSize: state.squadSize || 4,
    });
}

/** Orden del objetivo "sets": el mejor primero. */
export function compareByGoalSets(a, b) {
    // Primero los sets EMPEZADOS a los que menos les queda: terminar algo que ya tienes a
    // medias vale más que empezar otro. Entre esos, lo que de verdad puedes cerrar con las
    // copias que tienes, y por último las runs por apertura.
    const rank = (r) => (r.bestSetStarted ? r.bestSetMissing : Number.MAX_SAFE_INTEGER);
    return (rank(a) - rank(b)) || (b.odds - a.odds) || (a.runs - b.runs);
}

export { relicRuns };

/** Etiqueta del objetivo "sets" para una fila. */
export function goalMetaHtml(relicName, stock) {
    const d = describeRelicRuns(relicRuns(relicName, stock), texts());
    if (d.none) return `<span class="inv-goal-tag none">${escapeHTML(d.none)}</span>`;
    return `<span class="inv-goal-tag">${escapeHTML(d.runs)}</span>`
        + `<span class="inv-goal-set">${escapeHTML(d.set)}</span>`
        + (d.more ? `<span class="inv-goal-more">${d.more}</span>` : "");
}

export function renderInvGoalChips() {
    const t = texts();
    document.querySelectorAll("#inv-goals-row .inv-goal-btn").forEach((btn) => {
        btn.textContent = t[btn.dataset.goal] || btn.dataset.goal;
        btn.classList.toggle("active", (state.invGoal || "sets") === btn.dataset.goal);
    });
    const lbl = document.getElementById("inv-only-active-label");
    if (lbl) lbl.textContent = t.onlyActive;
    const chk = document.getElementById("inv-only-active");
    if (chk) chk.checked = !!state.invOnlyActive;
}

// renderInventory vive en ui_inventory.js, que ya importa este módulo: llamarlo por
// import cerraría el ciclo que rompe la carga (ver CLAUDE.md). Va por globalThis.
export function filterInvGoal(goal) {
    state.invGoal = goal;
    globalThis.renderInventory?.();
}

export function toggleInvOnlyActive(checked) {
    state.invOnlyActive = !!checked;
    globalThis.renderInventory?.();
}

exposeGlobals({ filterInvGoal, toggleInvOnlyActive }, "ui.components/inventory/ui_inventory_goals.js");
