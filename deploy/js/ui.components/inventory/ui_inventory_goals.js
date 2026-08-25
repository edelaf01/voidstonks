import { state, saveAppState } from "../../state.js";
import { DROP_CHANCES } from "../../config.js";
import { getSetName, getRequiredCount } from "../../utils/ui_utils.js";
import { relicSetValue, describeRelicRuns } from "../../utils/inventory/relic_set_value.js";
import { escapeHTML } from "../ui_components.js";
import { exposeGlobals } from "../../utils/global_registry.js";

const T = {
    es: { sets: "Runs a set", plat: "Plat/run", ducats: "Ducados/run", ratio: "Ducados por plat",
        recent: "Recientes", onlyActive: "Solo farmeables (no vaulted)", lastPart: "última pieza",
        missing: "faltan", nothing: "nada que te falte", runs: "runs" },
    en: { sets: "Runs to set", plat: "Plat/run", ducats: "Ducats/run", ratio: "Ducats per plat",
        recent: "Recent", onlyActive: "Farmable only (not vaulted)", lastPart: "last part",
        missing: "missing", nothing: "nothing you need", runs: "runs" },
};
const texts = () => T[state.currentLang === "es" ? "es" : "en"];

function relicRuns(relicName, stock) {
    return relicSetValue(state.relicsDatabase[relicName], {
        setsDatabase: state.setsDatabase, primeInventory: state.primeInventory,
        getSetName, getRequiredCount, stock,
        dropChances: DROP_CHANCES[state.refinement] || DROP_CHANCES.Rad,
        squadSize: state.squadSize || 4,
    });
}

export function compareByGoalSets(a, b) {
    const rank = (r) => (r.bestSetStarted ? r.bestSetMissing : Number.MAX_SAFE_INTEGER);
    return (rank(a) - rank(b)) || (b.odds - a.odds) || (a.runs - b.runs);
}

export { relicRuns };

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

export function filterInvGoal(goal) {
    state.invGoal = goal;
    saveAppState();
    globalThis.renderInventory?.();
}

export function toggleInvOnlyActive(checked) {
    state.invOnlyActive = !!checked;
    saveAppState();
    globalThis.renderInventory?.();
}

exposeGlobals({ filterInvGoal, toggleInvOnlyActive }, "ui.components/inventory/ui_inventory_goals.js");
