import { state } from "../state.js";
import { EELogLive } from "../services/scanner/eelog_live.service.js";
import { nombrePantalla, nombreInterno } from "../utils/eelog_events.js";
import { escapeHTML } from "../utils/escape_html.js";

const MAX_FILAS = 80;
const bilingue = (es, en) => `<span class="lang-es">${es}</span><span class="lang-en">${en}</span>`;

let panel = null;

const en = () => state.currentLang === "en";

function montar() {
  const el = document.createElement("aside");
  el.id = "ds-eelog";
  el.innerHTML = `
    <header class="ds-eelog-head">
      <strong>EE.log</strong>
      <span class="ds-eelog-estado"></span>
      <button type="button" class="ds-eelog-cerrar" aria-label="Cerrar / Close">×</button>
    </header>
    <div class="ds-eelog-ruta"></div>
    <dl class="ds-eelog-ahora">
      <dt>${bilingue("Pantalla", "Screen")}</dt><dd class="ds-eelog-pantalla">-</dd>
      <dt>${bilingue("Reliquia", "Relic")}</dt><dd class="ds-eelog-reliquia">-</dd>
      <dt>${bilingue("Escáner", "Scanner")}</dt><dd class="ds-eelog-modo">-</dd>
    </dl>
    <ol class="ds-eelog-eventos"></ol>`;
  el.querySelector(".ds-eelog-cerrar").addEventListener("click", () => el.classList.remove("open"));
  document.body.appendChild(el);
  EELogLive.escuchar(pintar);
  return el;
}

const hora = (t) => (Number.isFinite(t)
  ? `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`
  : "");

function textoEvento(ev) {
  if (ev.tipo === "pantalla") {
    const ctx = ev.contexto ? ` <b class="ds-eelog-ctx">${ev.contexto}</b>` : "";
    return escapeHTML(nombrePantalla(ev.swf, state.currentLang)) + ctx;
  }
  if (ev.tipo === "reliquia") return escapeHTML(`${en() ? "Relic" : "Reliquia"}: ${ev.nombre} [${ev.refinamiento}]`);
  if (ev.tipo === "mision") {
    return escapeHTML(ev.fase === "empieza" ? `${en() ? "Mission" : "Misión"}: ${ev.nombre}` : (en() ? "Back to the ship" : "Vuelta a la nave"));
  }
  if (ev.tipo === "recompensas") {
    return ev.fase === "llenas" ? `${en() ? "Rewards shown" : "Recompensas a la vista"} <b class="ds-eelog-ctx">REWARD</b>`
      : (en() ? "Rewards closed" : "Recompensas cerradas");
  }
  if (ev.tipo === "propia") return escapeHTML(`${en() ? "Your reward" : "Tu recompensa"}: ${nombreInterno(ev.ruta)}`);
  if (ev.tipo === "menu") return escapeHTML(`${ev.modulo} ${ev.visible ? "↑" : "↓"}`);
  if (ev.tipo === "inventario") {
    if (ev.kiosco) return `${en() ? "Ducat kiosk" : "Kiosko de ducados"} <b class="ds-eelog-ctx">DUCAT_KIOSK</b>`;
    return escapeHTML(`${en() ? "Inventory" : "Inventario"}: ${ev.modo}`);
  }
  return escapeHTML(ev.texto.slice(0, 160));
}

function textoModo(m) {
  if (!m) return "-";
  if (m.modo === "dormido") return en() ? "On hold during the mission" : "En espera durante la misión";
  if (m.modo === "forzado") {
    const n = m.tarjetas ? ` · ${m.tarjetas} ${en() ? "cards" : "tarjetas"}` : "";
    return `${en() ? "Reading rewards" : "Leyendo recompensas"}${n}`;
  }
  return en() ? "Reads every screen" : "Lee todas las pantallas";
}

function pintar(live) {
  if (!inspectorAbierto()) return;
  const estados = {
    leyendo: en() ? "Reading" : "Leyendo",
    falta: en() ? "Waiting for the game" : "Esperando al juego",
    parado: en() ? "Stopped" : "Parado",
    error: en() ? "Reconnecting" : "Reconectando",
  };
  const estado = panel.querySelector(".ds-eelog-estado");
  estado.textContent = estados[live.estado] || live.estado;
  estado.dataset.estado = live.estado;
  panel.querySelector(".ds-eelog-ruta").textContent = live.ruta
    || (en() ? "EE.log not found: is Warframe installed?" : "No se encuentra el EE.log: ¿está instalado Warframe?");
  panel.querySelector(".ds-eelog-pantalla").innerHTML = live.pantalla ? textoEvento(live.pantalla) : "-";
  panel.querySelector(".ds-eelog-reliquia").textContent = live.reliquia
    ? `${live.reliquia.nombre} [${live.reliquia.refinamiento}]`
    : "-";
  panel.querySelector(".ds-eelog-modo").textContent = textoModo(live.modoEscaner());
  panel.querySelector(".ds-eelog-eventos").innerHTML = live.eventos.filter((ev) => ev.tipo !== "tarjeta").slice(-MAX_FILAS).reverse()
    .map((ev) => `<li data-tipo="${ev.tipo}"><time>${hora(ev.t)}</time><span>${textoEvento(ev)}</span></li>`)
    .join("");
}

export function inspectorAbierto() {
  return !!panel?.classList.contains("open");
}

export function cerrarInspectorEELog() {
  panel?.classList.remove("open");
}

export function alternarInspectorEELog() {
  panel ??= montar();
  const abrir = !inspectorAbierto();
  panel.classList.toggle("open", abrir);
  if (abrir) {
    EELogLive.iniciar();
    pintar(EELogLive);
  }
  return abrir;
}
