import { esEscritorio, carcasaActiva } from "../utils/shell.js";
import {
  enLanzador, capacidadesNativas, copiarNativo, activaOverlay, mostrarPaneles, quitarPaneles,
  quitarTodosAlSalir, estrenaAutoCopia, duracionRecompensas, leePanelesOcultos, guardaPanelesOcultos,
} from "../services/desktop.service.js";
import { ClipboardService } from "../services/clipboard.service.js";
import { EELogLive } from "../services/scanner/eelog_live.service.js";
import { ScannerModal } from "./ui_scanner_modal.js";
import { panelesDeRecompensas } from "../utils/inventory/reward_labels.js";
import { showToast } from "./ui_components.js";
import { state, saveAppState } from "../state.js";
import { TEXTS } from "../config.js";
import { alternarInspectorEELog } from "./ui_eelog_inspector.js";
import { abrirPermisos } from "./ui_desktop_permisos.js";
import { conectaEscaner } from "./ui_desktop_escaner.js";

const bilingue = (es, en) => `<span class="lang-es">${es}</span><span class="lang-en">${en}</span>`;

const ICONO_OVERLAY = `<svg class="tab-icon-img ds-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="7" width="15" height="12" rx="2"/><rect x="9" y="3" width="13" height="9" rx="2" fill="currentColor" fill-opacity=".25"/></svg>`;
const ICONO_LOG = `<svg class="tab-icon-img ds-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 3h9l4 4v14H6z"/><path d="M9 11h7M9 15h7M9 19h4"/></svg>`;

function botonLateral(id, icono, es, en, alPulsar) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.id = id;
  btn.className = "tab-btn ds-tool";
  const img = icono.startsWith("<") ? icono : `<img src="${icono}" class="tab-icon-img" alt="" />`;
  btn.innerHTML = `${img}${bilingue(es, en)}`;
  btn.addEventListener("click", alPulsar);
  return btn;
}

const PANELES_FIJOS = [["inventory-container", "inv-toggle-btn"], ["best-missions-container", "mission-toggle-btn"]];

function fijaPaneles() {
  const cerrados = new Set(leePanelesOcultos());
  const apunta = (panel) => {
    if (!carcasaActiva()) return;
    if (panel.classList.contains("open")) cerrados.delete(panel.id);
    else cerrados.add(panel.id);
    guardaPanelesOcultos([...cerrados]);
  };
  const vigia = new MutationObserver((cambios) => cambios.forEach((c) => apunta(c.target)));
  const prepara = () => {
    for (const [id, boton] of PANELES_FIJOS) {
      const panel = document.getElementById(id);
      if (!panel || panel.dataset.dsFijo) continue;
      panel.dataset.dsFijo = "1";
      setTimeout(() => {
        if (carcasaActiva() && !cerrados.has(id) && !panel.classList.contains("open")) document.getElementById(boton)?.click();
        vigia.observe(panel, { attributes: true, attributeFilter: ["class"] });
      }, 0);
    }
  };
  prepara();
  new MutationObserver(prepara).observe(document.body, { childList: true });
}

function montarHerramientas(barra) {
  const grupo = document.createElement("div");
  grupo.className = "ds-tools";
  barra.appendChild(grupo);
  return grupo;
}

function ensenaRecompensas(paneles) {
  if (paneles.length) mostrarPaneles("recompensas", paneles, { mismoAncho: true, duracionMs: duracionRecompensas(EELogLive.juego.recompensas?.desde) });
}

let enCicloRiven = false;

function quitaLoQueCerroElJuego() {
  if (EELogLive.estado !== "leyendo") return;
  const { juego } = EELogLive;
  if (EELogLive.modoEscaner()?.modo !== "forzado") quitarPaneles("recompensas");
  if (!juego.eligiendoReliquia) quitarPaneles("reliquias");
  if (!juego.menus.includes("InventoryTest")) quitarPaneles("kiosko");
  if (enCicloRiven && !juego.riven) quitarPaneles("riven");
  enCicloRiven = !!juego.riven;
}

async function pruebaOverlay() {
  const t = TEXTS[state.currentLang].rewardScanner;
  const items = [
    { name: "A", price: 2, ducats: 15, owned: 5, ownedRead: true },
    { name: "B", price: 5, ducats: 45, owned: 4, ownedRead: true },
    { name: "C", price: 1, ducats: 45, crafted: true },
    { name: "D", price: 4, ducats: 15, ownedRead: false },
  ];
  const paneles = panelesDeRecompensas(items, {
    anchoReferencia: 0, mejor: { name: "B", value: { plat: 5.2 }, clear: true },
    mejores: { plat: new Set(["B"]), ducats: new Set(["B", "C"]) }, cerca: { name: "D", left: 0 }, precioSet: 65, t,
  });
  if (!(await mostrarPaneles("recompensas", paneles, { mismoAncho: true, duracionMs: 6000 }))) {
    showToast(state.currentLang === "en" ? "Warframe's window was not found: is the game open?" : "No se encuentra la ventana de Warframe: ¿está abierto el juego?");
  }
}

let caps = null;

async function refrescaCapacidades() {
  caps = await capacidadesNativas();
  ClipboardService.nativo = caps?.permisos?.clip ? copiarNativo : null;
  if (estrenaAutoCopia(caps?.permisos) && !state.autoCopyScanResults) {
    state.autoCopyScanResults = true;
    saveAppState();
  }
  activaOverlay(caps?.permisos?.overlay);
  if (caps?.permisos?.eelog) EELogLive.iniciar();
  else EELogLive.parar();
  return caps;
}

const permisos = () => abrirPermisos(caps, { alGuardar: refrescaCapacidades });

const conPermiso = (id, accion) => () => (caps?.permisos?.[id] ? accion() : permisos());

async function montarNativas(grupo) {
  if (!(await refrescaCapacidades())) return;
  ScannerModal.onPaneles = ensenaRecompensas;
  conectaEscaner();
  EELogLive.escuchar(quitaLoQueCerroElJuego);
  globalThis.addEventListener("pagehide", quitarTodosAlSalir);
  if (caps.overlay) {
    const btn = botonLateral("ds-btn-overlay", ICONO_OVERLAY, "Overlay", "Overlay", conPermiso("overlay", pruebaOverlay));
    btn.dataset.tooltip = "Prueba: paneles de ejemplo encima del juego / Test: sample panels over the game";
    grupo.prepend(btn);
  }
  const log = botonLateral("ds-btn-eelog", ICONO_LOG, "Registro", "Game log", conPermiso("eelog", alternarInspectorEELog));
  log.dataset.tooltip = "EE.log";
  grupo.prepend(log);

  const enlace = document.createElement("button");
  enlace.type = "button";
  enlace.className = "ds-link";
  enlace.innerHTML = bilingue("Permisos", "Permissions");
  enlace.addEventListener("click", permisos);
  document.querySelector("#ds-status .ds-updates")?.after(enlace);

  if (caps.pendientes?.length) permisos();
}

function montarEstado() {
  const barra = document.createElement("footer");
  barra.id = "ds-status";
  barra.innerHTML = `
    <span class="ds-net"><i class="ds-dot"></i><span class="ds-net-txt"></span></span>
    <button type="button" class="ds-link ds-updates">${bilingue("Novedades", "Updates")}</button>
    <a class="ds-link" href="guide.html">${bilingue("Guía", "Guide")}</a>
    <a class="ds-link" href="privacy.html">${bilingue("Privacidad", "Privacy")}</a>
    <span class="ds-credit">${bilingue("No afiliado a Digital Extremes", "Not affiliated with Digital Extremes")}</span>`;
  document.body.appendChild(barra);
  barra.querySelector(".ds-updates").addEventListener("click", () => globalThis.openUpdateHistory?.());

  const txt = barra.querySelector(".ds-net-txt");
  const pinta = () => {
    const online = navigator.onLine !== false;
    barra.classList.toggle("is-offline", !online);
    txt.innerHTML = online ? bilingue("Conectado", "Online") : bilingue("Sin conexión", "Offline");
  };
  globalThis.addEventListener("online", pinta);
  globalThis.addEventListener("offline", pinta);
  pinta();
}

export function initDesktopShell() {
  if (!esEscritorio()) return;
  const barra = document.querySelector("#main-card .card-top-bar");
  const grupo = barra ? montarHerramientas(barra) : null;
  fijaPaneles();
  montarEstado();
  if (!enLanzador() || !grupo) return;
  montarNativas(grupo).catch(console.warn);
}
