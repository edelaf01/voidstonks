import { state } from "../../state.js";
import { TEXTS } from "../../config.js";
import { escapeHTML } from "../../utils/escape_html.js";
import { showToast } from "../ui_components.js";
import { sendBrowserNotification, startAlarmWatcher } from "../../services/farms/alerts.service.js";
import { fetchAllFissures, fetchActiveArbitration } from "../../services/farms/fissures.service.js";

export function handleFissureAlarmHits(hits) {
  const t = TEXTS[state.currentLang];
  if (!hits || hits.length === 0) return;
  const lines = hits.slice(0, 4).map(({ item }) => {
    const typeTxt = t.modes[(item.type || "").toLowerCase()] || item.type;
    return `${item.tier} · ${typeTxt} — ${item.node}${item.isStorm ? " (RJ)" : ""}${item.isSP ? " [SP]" : ""}`;
  });
  const more = hits.length > 4 ? ` +${hits.length - 4}` : "";
  sendBrowserNotification(t.fissureAlarms.firedTitle, lines.join("\n") + more);
  showToast(`<b>${escapeHTML(t.fissureAlarms.firedTitle)}</b><br>${lines.map(escapeHTML).join("<br>")}${more}`, {
    tag: "fissure-alarm",
    type: "success",
    duration: 30000,
    html: true,
  });
}

export function startFissureAlarmWatcher() {
  startAlarmWatcher(() => fetchAllFissures(), handleFissureAlarmHits, "fissure");
}

export function handleArbitrationAlarmHits(hits) {
  const t = TEXTS[state.currentLang];
  if (!hits || hits.length === 0) return;
  const lines = hits.map(({ item }) => {
    const typeTxt = t.modes[(item.type || "").toLowerCase()] || item.type;
    return `${item.tier ? `[${item.tier}] ` : ""}${typeTxt} — ${item.node}`;
  });
  sendBrowserNotification(t.arbyAlarms.firedTitle, lines.join("\n"));
  showToast(`<b>${escapeHTML(t.arbyAlarms.firedTitle)}</b><br>${lines.map(escapeHTML).join("<br>")}`, {
    tag: "arby-alarm",
    type: "success",
    duration: 30000,
    html: true,
  });
}

export function startArbitrationAlarmWatcher() {
  startAlarmWatcher(() => fetchActiveArbitration(), handleArbitrationAlarmHits, "arbitration");
}
