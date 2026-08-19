import { state } from "../../state.js";
import { TEXTS } from "../../config.js";
import { escapeHTML } from "../../utils/escape_html.js";
import { showToast } from "../ui_components.js";
import { sendBrowserNotification, startAlarmWatcher } from "../../services/farms/alerts.service.js";
import { fetchAllFissures, fetchActiveArbitration } from "../../services/farms/fissures.service.js";

/**
 * Avisos de las alarmas de fisuras y arbitración: el toast y la notificación del navegador que
 * salen cuando una regla dispara.
 *
 * `alerts.service.js` decide QUÉ dispara; esto decide cómo se enseña. Estaban juntos dentro de
 * ui_fissures.js, que ya rondaba el límite de tamaño con dos pantallas dentro.
 */

// emite evaluateAlarms según la preferencia global.
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
    html: true, // el mensaje monta <b>/<br> y ya escapa cada dato que interpola
  });
}

export function startFissureAlarmWatcher() {
  startAlarmWatcher(() => fetchAllFissures(), handleFissureAlarmHits, "fissure");
}

// Toast + notificación cuando salta una alarma de arbitración.
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
    html: true, // el mensaje monta <b>/<br> y ya escapa cada dato que interpola
  });
}

export function startArbitrationAlarmWatcher() {
  startAlarmWatcher(() => fetchActiveArbitration(), handleArbitrationAlarmHits, "arbitration");
}
